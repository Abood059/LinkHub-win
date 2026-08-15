// src/main/infrastructure/media/DownloadEventHandler.js
'use strict';

const { adjustProgressForCombinedDownload } = require('./YtdlpUtils');

/**
 * DownloadEventHandler
 * Responsible for معالجة أحداث download من yt-dlp-wrap-plus
 */
class DownloadEventHandler {
    constructor(downloadManager, logger = null, windowManager = null) {
        this._downloadManager = downloadManager;
        this._logger = logger;
        this._windowManager = windowManager;
    }

    setWindowManager(windowManager) {
        this._windowManager = windowManager;
    }

    /**
     * معالجة حدث التقدم
     * @param {string} processId - ID process
     * @param {Object} progress - بيانات التقدم من yt-dlp-wrap-plus
     * @param {Function} onProgress - دالة رد Connection للتقدم
     */
    handleProgress(processId, progress, onProgress) {
        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) return;

        // حساب التقدم المعدل للتحميلات المركبة (فيديو+صوت)
        const adjustedProgress = adjustProgressForCombinedDownload(
            progress.percent,
            progress.totalSize,
            entry,
            progress
        );

        entry.percent = adjustedProgress.percent;
        entry.speed = progress.currentSpeed;
        entry.size = adjustedProgress.size;
        entry.eta = progress.eta;

        if (onProgress) {
            onProgress({
                percent: adjustedProgress.percent,
                speed: progress.currentSpeed,
                size: adjustedProgress.size,
                eta: progress.eta
            });
        }
    }

    /**
     * معالجة اسم file من حدث ytDlpEvent
     * @param {string} processId - ID process
     * @param {string} filename - اسم file
     */
    handleFilename(processId, filename) {
        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) return;

        entry.actualFilename = filename;
    }

    /**
     * معالجة حدث Close process
     * @param {string} processId - ID process
     * @param {string} outputPath - مسار Outputs
     * @param {number} code - كود الخروج
     * @param {Array} deviceIds - مصفوفة IDات Devices
     * @param {string} url - رابط download
     * @param {string} title - عنوان Video
     * @param {Function} startDownloadCallback - دالة إعادة download
     */
    async handleClose(processId, outputPath, code, deviceIds, url, title, startDownloadCallback) {
        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) return;

        // التعامل مع الإيقاف اليدوي - لا ترسل Error
        if (entry.manuallyStopped) {
            this._downloadManager.updateDownloadStatus(processId, 'stopped');
            return;
        }

        if (code === 0) {
            const result = await this._downloadManager.handleDownloadSuccess(
                processId,
                outputPath,
                deviceIds,
                url,
                title,
                entry.actualFilename
            );
            this._downloadManager.updateDownloadStatus(processId, 'completed');

            // إرسال حدث transfer التلقائي إذا تم transfer بنجاح
            if (result && result.transferResult) {
                this._sendTransferEvent(processId, deviceIds, result.transferResult);
            }
        } else {
            // Verify من إعادة المحاولة
            if (this._downloadManager.shouldRetry(entry, code)) {
                this._downloadManager.handleRetry(
                    entry,
                    processId,
                    url,
                    entry.formatId,
                    { outputPath, deviceIds, title },
                    startDownloadCallback,
                    code
                );
                return;
            } else {
                this._downloadManager.handleDownloadFailure(
                    processId,
                    code,
                    deviceIds,
                    url,
                    title
                );
                this._downloadManager.updateDownloadStatus(processId, 'failed');
            }
        }
    }

    /**
     * إرسال حدث transfer إلى UI
     * @param {string} processId - ID process
     * @param {Array} deviceIds - مصفوفة IDات Devices
     * @param {Object} transferResult - result transfer
     */
    _sendTransferEvent(processId, deviceIds, transferResult) {
        if (!this._windowManager) {
            return;
        }

        try {
            const windows = this._windowManager.getAllWindows();
            if (windows && windows.length > 0) {
                const mainWindow = windows[0];
                if (transferResult.success) {
                    mainWindow.webContents.send('transfer:complete', {
                        downloadId: processId,
                        deviceIds: deviceIds,
                        message: transferResult.message
                    });
                } else {
                    mainWindow.webContents.send('transfer:error', {
                        downloadId: processId,
                        deviceIds: deviceIds,
                        error: transferResult.message
                    });
                }
            }
        } catch (err) {
            if (this._logger) {
                this._logger.error(`Failed to send transfer event: ${err.message}`);
            }
        }
    }

    /**
     * معالجة حدث الError
     * @param {string} processId - ID process
     * @param {Error} err - كائن الError
     * @param {Array} deviceIds - مصفوفة IDات Devices
     * @param {string} url - رابط download
     */
    handleError(processId, err, deviceIds, url) {
        const entry = this._downloadManager.getDownloadEntry(processId);
        if (!entry) return;

        this._downloadManager.handleProcessError(
            processId,
            err,
            deviceIds,
            url
        );
        this._downloadManager.removeDownloadEntry(processId);
    }
}

module.exports = DownloadEventHandler;
