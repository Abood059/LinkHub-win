'use strict';

/**
 * DownloadOrchestrator
 * Responsible for coordinating download operations and making business logic decisions
 * Principles:
 * - Memory is the single source of truth during runtime
 * - Never accesses database
 * - Checks if download exists in memory and decides: start new, resume existing, or prevent duplication
 */
class DownloadOrchestrator {
    constructor({
        ytdlpAdapter,
        downloadManager,
        deviceRegistry = null,
        adbPushService = null,
        downloadRepository = null,
        logger = null
    }) {
        this._ytdlpAdapter = ytdlpAdapter;
        this._downloadManager = downloadManager;
        this._deviceRegistry = deviceRegistry;
        this._adbPushService = adbPushService;
        this._downloadRepository = downloadRepository;
        this._logger = logger;
    }

    async inspectLink(url) {
        if (!url) {
            throw new Error('URL is required');
        }
        return this._ytdlpAdapter.inspectFormats(url);
    }

    async getMetadata(url) {
        if (!url) {
            throw new Error('URL is required');
        }
        return this._ytdlpAdapter.extractMetadata(url);
    }

    async startDownload(url, formatId, deviceIds = null, options = {}) {
        console.log('[DownloadOrchestrator] === Starting startDownload ===');
        console.log('[DownloadOrchestrator] url:', url);
        console.log('[DownloadOrchestrator] formatId:', formatId);
        console.log('[DownloadOrchestrator] deviceIds:', deviceIds);
        console.log('[DownloadOrchestrator] options:', options);
        if (!url || !formatId) {
            console.log('[DownloadOrchestrator] Error: url or formatId missing');
            throw new Error('url and formatId are required');
        }

        // If there is a processId, it's a resume - skip duplicate check
        if (options.processId) {
            console.log('[DownloadOrchestrator] processId exists - resume, skip duplicate check');
            const adapterOptions = { ...options, deviceIds, formatsData: options.formatsData };
            console.log('[DownloadOrchestrator] adapterOptions:', adapterOptions);
            const result = this._ytdlpAdapter.startDownload(url, formatId, adapterOptions);
            console.log('[DownloadOrchestrator] startDownload result from adapter:', result);
            return result;
        }

        // Search in memory for active download for same URL and quality
        const activeProcessId = this._ytdlpAdapter.findActiveDownload(url, formatId);
        console.log('[DownloadOrchestrator] Searching for active download in memory');
        console.log('[DownloadOrchestrator] activeProcessId:', activeProcessId);
        if (activeProcessId) {
            // Download exists in memory - prevent duplication
            console.log('[DownloadOrchestrator] Download exists in memory');
            const entry = this._ytdlpAdapter.getDownloadEntry(activeProcessId);
            console.log('[DownloadOrchestrator] entry:', entry);
            const result = {
                existing: true,
                downloadId: activeProcessId,
                status: entry ? entry.status : 'unknown',
                title: entry ? entry.title : options.title || 'Unknown'
            };
            console.log('[DownloadOrchestrator] Returning existing download result:', result);
            return result;
        }

        // No download in memory - start new download
        console.log('[DownloadOrchestrator] No download in memory - starting new download');
        const adapterOptions = { ...options, deviceIds, formatsData: options.formatsData };
        console.log('[DownloadOrchestrator] adapterOptions:', adapterOptions);
        const result = this._ytdlpAdapter.startDownload(url, formatId, adapterOptions);
        console.log('[DownloadOrchestrator] startDownload result from adapter:', result);
        return result;
    }

    /**
     * Stop download process
     * @param {string} fileId - File/process ID
     * @returns {Object} Result object showing stop status from YtdlpAdapter
     */
    stopDownload(fileId) {
        console.log('[DownloadOrchestrator] === Starting stopDownload ===');
        console.log('[DownloadOrchestrator] fileId:', fileId);
        if (!fileId) {
            console.log('[DownloadOrchestrator] Error: fileId missing');
            throw new Error('fileId is required');
        }
        const result = this._ytdlpAdapter.stopDownload(fileId);
        console.log('[DownloadOrchestrator] stopDownload result:', result);
        return result;
    }

    async resumeDownload(processId, url, formatId, deviceIds = null, options = {}) {
        console.log('[DownloadOrchestrator] === Starting resumeDownload ===');
        console.log('[DownloadOrchestrator] processId:', processId);
        console.log('[DownloadOrchestrator] url:', url);
        console.log('[DownloadOrchestrator] formatId:', formatId);
        console.log('[DownloadOrchestrator] deviceIds:', deviceIds);
        console.log('[DownloadOrchestrator] options:', options);
        if (!url || !formatId) {
            console.log('[DownloadOrchestrator] Error: url or formatId missing');
            throw new Error('url and formatId are required');
        }

        // إذا لم يتم تمرير processId، ابحث عن تحميل متطابق في memory
        if (!processId) {
            console.log('[DownloadOrchestrator] processId null - Search عن تحميل متطابق');
            processId = this._ytdlpAdapter.findActiveDownload(url, formatId);
            console.log('[DownloadOrchestrator] processId الموجود:', processId);
            if (!processId) {
                console.log('[DownloadOrchestrator] Error: لم يتم العثور على تحميل نشط');
                throw new Error('لم يتم العثور على تحميل نشط لهذا Link والجودة');
            }
        }

        // Verify من وجود Input في memory
        const entry = this._ytdlpAdapter.getDownloadEntry(processId);
        console.log('[DownloadOrchestrator] entry:', entry);
        if (!entry) {
            console.log('[DownloadOrchestrator] Error: لم يتم العثور على إدخال');
            throw new Error('لم يتم العثور على تحميل نشط لهذا Link والجودة');
        }

        // Verify من state process قبل الاستئناف
        const isRunning = this._ytdlpAdapter.isProcessRunning(processId);
        console.log('[DownloadOrchestrator] isProcessRunning:', isRunning);

        if (isRunning) {
            // process قيد التشغيل - إنهاء process الحالية فقط دون تغيير الstate في memory
            console.log('[DownloadOrchestrator] process قيد التشغيل - إنهاء process الحالية');
            const stopResult = this._ytdlpAdapter.stopProcessOnly(processId);
            console.log('[DownloadOrchestrator] stopProcessOnly result:', stopResult);
            if (this._logger) {
                this._logger.info(`resumeDownload: Stopped running process ${processId}`, stopResult);
            }
        }

        // Starting download الجديد
        console.log('[DownloadOrchestrator] Starting download الجديد');
        const result = this.startDownload(url, formatId, deviceIds, { ...options, processId });
        console.log('[DownloadOrchestrator] result startDownload:', result);
        return result;
    }

    /**
     * الحصول على state download النشط
     * @param {string} processId - ID process
     * @returns {string|null} state download أو null إذا لم يكن موجوداً
     */
    getDownloadStatus(processId) {
        return this._ytdlpAdapter.getDownloadStatus(processId);
    }

    /**
     * Search عن تحميل نشط في memory بناءً على Link وID التنسيق
     * @param {string} url - رابط download
     * @param {string} formatId - ID التنسيق
     * @returns {string|null} processId إذا وجد، null إذا لم يوجد
     */
    findActiveDownload(url, formatId) {
        return this._ytdlpAdapter.findActiveDownload(url, formatId);
    }

    /**
     * معالجة اكتمال download ونقل file للجهاز إذا لزم الأمر
     * @param {string} downloadId - ID download
     * @param {string} tempPath - path المؤقت للملف
     * @param {Array} deviceIds - مصفوفة IDات Devices (اختياري)
     */
    async handleDownloadComplete(downloadId, tempPath, deviceIds = null) {
        if (!tempPath) {
            if (this._logger) {
                this._logger.warn(`No temp path provided for download ${downloadId}`);
            }
            return;
        }

        if (!deviceIds || deviceIds.length === 0 || !this._adbPushService) {
            // لا يوجد أجهزة للنقل، file تم نقله بالفعل لمجلد downloadات
            return;
        }

        try {
            // نقل file للأجهزة المحددة
            for (const deviceId of deviceIds) {
                const result = await this._adbPushService.pushAndDelete(tempPath, deviceId);
            
                if (result.success) {
                    if (this._logger) {
                        this._logger.info(`File transferred successfully to device ${deviceId}`);
                    }
                    // إرسال إشعار للواجهة
                    this._ytdlpAdapter.emit('transferComplete', {
                        downloadId,
                        deviceId,
                        message: result.message
                    });
                } else {
                    if (this._logger) {
                        this._logger.error(`Failed to transfer file to device ${deviceId}: ${result.message}`);
                    }
                    // إرسال إشعار بالفشل
                    this._ytdlpAdapter.emit('transferError', {
                        downloadId,
                        deviceId,
                        error: result.message
                    });
                }
            }
        } catch (err) {
            if (this._logger) {
                this._logger.error(`Error during file transfer: ${err.message}`);
            }
            this._ytdlpAdapter.emit('transferError', {
                downloadId,
                deviceId,
                error: err.message
            });
        }
    }

    /**
     * الحصول على خريطة downloadات النشطة من memory
     * @returns {Object} خريطة downloadات النشطة
     */
    getActiveDownloads() {
        return this._ytdlpAdapter.getActiveDownloads();
    }

    /**
     * نقل ملف موجود إلى جهاز
     * @param {string} localPath - path المحلي للملف
     * @param {string} deviceId - ID device
     * @returns {Promise<Object>} result transfer
     */
    async transferFileToDevice(localPath, deviceId) {
        if (!localPath) {
            throw new Error('Local path is required');
        }
        if (!deviceId) {
            throw new Error('Device ID is required');
        }
        if (!this._adbPushService) {
            throw new Error('AdbPushService not available');
        }
        return this._adbPushService.pushFromDownloads(localPath, deviceId);
    }


    /**
     * الحصول على Log التاريخي للتحميلات
     * @returns {Array} قائمة جميع downloadات
     */
    getDownloadHistory() {
        return this._downloadManager.getAllDownloads();
    }

    /**
     * Delete تحميل من memory فقط (دون Delete من قاعدة data)
     * @param {string} processId - ID process
     * @returns {Object} كائن result يوضح state الDelete
     */
    deleteDownloadFromMemory(processId) {
        console.log('[DownloadOrchestrator] === Starting deleteDownloadFromMemory ===');
        console.log('[DownloadOrchestrator] processId:', processId);
        if (!processId) {
            console.log('[DownloadOrchestrator] Error: processId missing');
            throw new Error('processId is required');
        }

        const result = this._ytdlpAdapter.removeDownloadEntry(processId);
        console.log('[DownloadOrchestrator] result deleteDownloadFromMemory:', result);
        return result;
    }

    /**
     * الحصول على تفاصيل download من قاعدة data
     * @param {string} downloadId - ID download
     * @returns {Object|null} تفاصيل download أو null إذا لم يوجد
     */
    getDownloadDetails(downloadId) {
        console.log('[DownloadOrchestrator] === Starting getDownloadDetails ===');
        console.log('[DownloadOrchestrator] downloadId:', downloadId);
        if (!downloadId) {
            console.log('[DownloadOrchestrator] Error: downloadId missing');
            throw new Error('downloadId is required');
        }

        if (!this._downloadRepository) {
            console.log('[DownloadOrchestrator] Error: downloadRepository غير متوفر');
            throw new Error('downloadRepository not available');
        }

        const download = this._downloadRepository.findDownloadById(downloadId);
        console.log('[DownloadOrchestrator] result getDownloadDetails:', download);
        return download;
    }

}

module.exports = DownloadOrchestrator;