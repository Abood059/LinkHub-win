// src/main/infrastructure/media/ProcessManager.js
'use strict';

/**
 * ProcessManager
 * Responsible for إدارة عمليات yt-dlp
 */
class ProcessManager {
    constructor(processSupervisor, toolPathResolver, logger = null) {
        this._processSupervisor = processSupervisor;
        this._toolPathResolver = toolPathResolver;
        this._logger = logger;
        this._ytdlpPath = this._resolveYtdlpPath();
    }

    /**
     * تحديد مسار yt-dlp
     * @param {string} explicitPath - مسار صريح
     * @returns {string} مسار yt-dlp
     */
    _resolveYtdlpPath(explicitPath = null) {
        if (explicitPath) return explicitPath;
        if (this._toolPathResolver) return this._toolPathResolver.getYtDlpPath();
        const fallbackPath = 'yt-dlp';
        if (this._logger && typeof this._logger.warn === 'function') {
            this._logger.warn(`ProcessManager: No toolPathResolver provided, using fallback: ${fallbackPath}`);
        }
        return fallbackPath;
    }

    /**
     * الحصول على مسار yt-dlp
     * @returns {string} مسار yt-dlp
     */
    getYtdlpPath() {
        return this._ytdlpPath;
    }

    /**
     * تسجيل عملية yt-dlp في ProcessSupervisor
     * @param {string} processId - ID process
     * @param {ChildProcess} process - كائن process من yt-dlp-wrap-plus
     * @param {AbortController} controller - للتحكم في الCancel
     * @param {Object} metadata - بيانات وصفية
     */
    registerProcessWithSupervisor(processId, process, controller, metadata) {
        if (!this._processSupervisor) {
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn('ProcessSupervisor not available, process will not be tracked');
            }
            return;
        }

        // استخدام UI الجديدة في ProcessSupervisor
        this._processSupervisor.registerExternalProcess(processId, process, controller, metadata);
    }

    /**
     * Verify من state عملية download
     * @param {string} processId - ID process
     * @param {Object} entry - إدخال download
     * @returns {boolean} true إذا كانت process قيد التشغيل، false إذا كانت متوقفة
     */
    isProcessRunning(processId, entry) {
        if (!entry) return false;

        // Verify من وجود process وحالتها
        if (entry.process) {
            // إذا كانت process موجودة، تحقق من حالتها
            return entry.status === 'downloading' || entry.status === 'starting';
        }

        return false;
    }

    /**
     * Stop download process
     * @param {string} processId - ID process
     * @param {Object} entry - إدخال download
     * @param {boolean} updateStatus - هل تحديث الstate في memory
     * @returns {Object} Result object showing stop status
     */
    stopProcess(processId, entry, updateStatus = true) {
        // إيقاف من Library عبر AbortController
        if (entry && entry.controller) {
            entry.controller.abort();
        }

        // إيقاف من ProcessSupervisor
        if (this._processSupervisor && this._processSupervisor.hasProcess(processId)) {
            this._processSupervisor.stopManagedProcess(processId);
        }

        return { success: true, wasRunning: true };
    }
}

module.exports = ProcessManager;
