// src/main/infrastructure/media/YtdlpAdapter.js
'use strict';

const EventEmitter = require('events');
const path = require('path');
const { app } = require('electron');

// Safe handling of YTDlpWrap import whether ES Module or CommonJS
const YTDlpWrapModule = require('yt-dlp-wrap-plus');
const YTDlpWrap = YTDlpWrapModule.default || YTDlpWrapModule;

const DownloadManager = require('./DownloadManager');
const NetworkChecker = require('./NetworkChecker');
const MetadataExtractor = require('./MetadataExtractor');
const DownloadEventHandler = require('./DownloadEventHandler');
const ProcessManager = require('./ProcessManager');
const { createTempDirectory, calculateTotalSize } = require('./YtdlpUtils');

/**
 * دالة جلب مسار yt-dlp.exe المخصصة لويندوز
 */
function getDynamicYtDlpPath(customPath) {
    if (customPath) return customPath;

    const fileName = 'yt-dlp.exe';

    // في state Application Source (Packaged Electron App)
    if (app && app.isPackaged) {
        return path.join(process.resourcesPath, 'bin', 'win', fileName);
    }

    // في بيئة Development (Development) - الصعود لوصول مجلد resources الرئيسي
    return path.join(__dirname, '../../../../resources/bin/win', fileName);
}

class YtdlpAdapter extends EventEmitter {
    constructor({
        processSupervisor,
        ytdlpPath = null,
        toolPathResolver = null,
        logger = null,
        pathService = null,
        adbPushService = null
    }) {
        super();
        this._logger = logger;
        this._pathService = pathService;
        this._windowManager = null;

        // تحديد مسار yt-dlp.exe الخاص بـ Windows
        const resolvedPath = getDynamicYtDlpPath(ytdlpPath);
        this._ytDlpWrap = new YTDlpWrap(resolvedPath);

        // Initialize helper modules
        this._downloadManager = new DownloadManager({ logger, pathService, adbPushService });
        this._networkChecker = new NetworkChecker(logger);
        this._metadataExtractor = new MetadataExtractor(this._ytDlpWrap, this._networkChecker, logger);
        this._processManager = new ProcessManager(processSupervisor, toolPathResolver, logger);
        this._eventHandler = new DownloadEventHandler(this._downloadManager, logger, null);
    }

    setWindowManager(windowManager) {
        this._windowManager = windowManager;
        this._eventHandler.setWindowManager(windowManager);
    }

    async checkInternetConnection(timeout = 5000) {
        return this._networkChecker.checkInternetConnection(timeout);
    }

    async inspectFormats(url) {
        return this._metadataExtractor.inspectFormats(url);
    }

    async extractMetadata(url) {
        return this._metadataExtractor.extractMetadata(url);
    }

    async startDownload(url, formatId, options = {}) {
        if (!formatId || typeof formatId !== 'string' || formatId.trim() === '') {
            throw new Error('formatId is required and must be a non-empty string');
        }

        if (!/^[a-zA-Z0-9+\-]+$/.test(formatId.trim())) {
            throw new Error(`Invalid formatId: ${formatId}. Format ID must contain only letters, numbers, +, or -`);
        }

        const isConnected = await this.checkInternetConnection();
        if (!isConnected) {
            throw new Error('No internet connection. Please check your network connection and try again.');
        }

        const { outputPath, onProgress, deviceIds, title, formatsData, processId: existingProcessId } = options;

        const processId = existingProcessId || `ytdlp-dl-${Date.now()}`;
        const isResuming = !!existingProcessId;

        let finalOutputPath = outputPath;

        if (isResuming) {
            const existingEntry = this._downloadManager.getDownloadEntry(processId);
            if (existingEntry && existingEntry.outputPath) {
                finalOutputPath = existingEntry.outputPath;
            }
        }

        if (!finalOutputPath) {
            const tempDir = await createTempDirectory(this._pathService);
            finalOutputPath = tempDir;
        }

        try {
            const fs = require('fs').promises;
            await fs.access(finalOutputPath, fs.constants.W_OK);
            if (this._logger) {
                this._logger.info(`Output path is writable: ${finalOutputPath}`);
            }
        } catch (err) {
            const error = new Error(`Cannot write to output path: ${finalOutputPath}. Error: ${err.message}`);
            if (this._logger) {
                this._logger.error(error.message);
            }
            throw error;
        }

        let { totalSize, hasSizeInfo } = calculateTotalSize(formatId, formatsData);

        const outputTemplate = path.join(finalOutputPath, '%(title)s.%(ext)s');
        const args = [
            '--ignore-config',
            '-f', formatId,
            '-o', outputTemplate,
            '--newline',
            url
        ];

        const controller = new AbortController();

        try {
            const emitter = this._ytDlpWrap.exec(args, {}, controller.signal);

            this._processManager.registerProcessWithSupervisor(processId, emitter.ytDlpProcess, controller, {
                url, formatId, outputPath: finalOutputPath, deviceIds
            });

            this._downloadManager.upsertDownloadEntry(processId, {
                resolve: null,
                reject: null,
                url,
                formatId,
                outputPath: finalOutputPath,
                controller,
                process: emitter.ytDlpProcess,
                deviceIds,
                title,
                totalSize,
                hasSizeInfo
            }, isResuming);

            this._downloadManager.updateDownloadStatus(processId, 'downloading');

            emitter.on('progress', (progress) => {
                this._eventHandler.handleProgress(processId, progress, onProgress);
            });

            emitter.on('ytDlpEvent', (eventType, eventData) => {
                if (eventType === 'download') {
                    const match = eventData.match(/Destination: (.+)$/);
                    if (match) {
                        this._eventHandler.handleFilename(processId, match[1]);
                    }
                }
            });

            emitter.on('close', (code) => {
                this._eventHandler.handleClose(processId, finalOutputPath, code, deviceIds, url, title, this.startDownload.bind(this));
            });

            emitter.on('error', (err) => {
                this._eventHandler.handleError(processId, err, deviceIds, url);
            });

            return new Promise((resolve, reject) => {
                const entry = this._downloadManager.getDownloadEntry(processId);
                if (entry) {
                    entry.resolve = resolve;
                    entry.reject = reject;
                } else {
                    reject(new Error('Download entry not found after process start'));
                }
            });

        } catch (error) {
            if (this._downloadManager.getDownloadEntry(processId)) {
                this._downloadManager.cleanupOrphanedEntry(processId);
            }
            throw error;
        }
    }

    stopDownload(processId) {
        if (!processId) {
            if (this._logger) {
                this._logger.warn('stopDownload: Invalid processId (null or empty)');
            }
            return { success: false, reason: 'invalid_processId' };
        }

        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) {
            if (this._logger) {
                this._logger.warn(`stopDownload: Entry not found for processId: ${processId}`);
            }
            return { success: false, reason: 'entry_not_found', processId };
        }

        entry.manuallyStopped = true;

        if (entry.controller) {
            entry.controller.abort();
        }

        this._processManager.stopProcess(processId, entry);
        this._downloadManager.updateDownloadStatus(processId, 'stopped');

        return { success: true, wasRunning: true };
    }

    isProcessRunning(processId) {
        const entry = this._downloadManager.getDownloadEntry(processId);
        return this._processManager.isProcessRunning(processId, entry);
    }

    getDownloadStatus(processId) {
        return this._downloadManager.getDownloadStatus(processId);
    }

    findActiveDownload(url, formatId) {
        return this._downloadManager.findActiveDownload(url, formatId);
    }

    getDownloadEntry(processId) {
        return this._downloadManager.getDownloadEntry(processId);
    }

    updateDownloadStatus(processId, status) {
        return this._downloadManager.updateDownloadStatus(processId, status);
    }

    stopProcessOnly(processId) {
        if (!processId) {
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn('stopProcessOnly: Invalid processId (null or empty)');
            }
            return { success: false, reason: 'invalid_processId' };
        }

        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) {
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn(`stopProcessOnly: Entry not found for processId: ${processId}`);
            }
            return { success: false, reason: 'entry_not_found', processId };
        }

        return this._processManager.stopProcess(processId, entry, false);
    }

    getActiveDownloads() {
        return this._downloadManager.getActiveDownloads();
    }

    removeDownloadEntry(processId) {
        if (!processId) {
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn('removeDownloadEntry: Invalid processId (null or empty)');
            }
            return { success: false, reason: 'invalid_processId' };
        }

        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) {
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn(`removeDownloadEntry: Entry not found for processId: ${processId}`);
            }
            return { success: false, reason: 'entry_not_found', processId };
        }

        this._processManager.stopProcess(processId, entry, false);
        this._downloadManager.removeDownloadEntry(processId);

        return { success: true, processId };
    }
}

module.exports = YtdlpAdapter;