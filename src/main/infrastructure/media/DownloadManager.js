// src/main/infrastructure/media/DownloadManager.js
'use strict';

const EventEmitter = require('events');
const DownloadStateManager = require('./DownloadStateManager');
const RetryHandler = require('./RetryHandler');
const CompletionHandler = require('./CompletionHandler');
const FailureHandler = require('./FailureHandler');

/**
 * DownloadManager
 * Responsible for إدارة state downloadات في memory فقط
 * Principles:
 * - يوفر دوال استعلامية للذاكرة (findActiveDownload, getDownloadEntry, getDownloadStatus)
 * - لا يحتوي على منطق أعمال ولا يتخذ قرارات
 * - ينسق بين الcomponents (ProgressHandler, RetryHandler, CompletionHandler, FailureHandler)
 * - Synchronization مع قاعدة data مسؤولية DownloadSyncService (service خارجية مستقلة)
 */
class DownloadManager extends EventEmitter {
    constructor({ logger = null, pathService = null, adbPushService = null }) {
        super();
        this._logger = logger;
        this._pathService = pathService;

        // Initialize all components
        this._stateManager = new DownloadStateManager();
        this._retryHandler = new RetryHandler();
        this._completionHandler = new CompletionHandler(pathService, logger, adbPushService);
        this._failureHandler = new FailureHandler({ logger });
    }

    /**
     * إنشاء إدخال تحميل جديد
     */
    createDownloadEntry(processId, data) {
        return this._stateManager.createDownloadEntry(processId, data);
    }

    /**
     * Update an existing download entry or create it if absent.
     */
    upsertDownloadEntry(processId, data, isResuming = false) {
        return this._stateManager.upsertDownloadEntry(processId, data, isResuming);
    }

    /**
     * الحصول على إدخال download
     */
    getDownloadEntry(processId) {
        return this._stateManager.getDownloadEntry(processId);
    }

    /**
     * تحديث state download
     */
    updateDownloadStatus(processId, status) {
        this._stateManager.updateDownloadStatus(processId, status);
    }

    /**
     * تحديث مرجع process
     */
    updateDownloadProcess(processId, process) {
        this._stateManager.updateDownloadProcess(processId, process);
    }

    /**
     * إزالة إدخال download
     */
    removeDownloadEntry(processId) {
        this._stateManager.removeDownloadEntry(processId);
    }

    /**
     * الحصول على state download
     */
    getDownloadStatus(processId) {
        return this._stateManager.getDownloadStatus(processId);
    }

    /**
     * معالجة بيانات التقدم من stdout/stderr
     * ملاحظة: التقدم يُعالج الآن مباشرة في YtdlpAdapter عبر _handleProgress
     * هذه Function محفوظة للتوافق فقط
     */
    handleProgressData(chunk, streamType, processId, onProgress, formatId) {
        const entry = this._stateManager.getDownloadEntry(processId);
        if (!entry) return;

        // التقدم يُعالج الآن مباشرة في YtdlpAdapter عبر _handleProgress
        // هذه Function محفوظة للتوافق فقط
    }

    /**
     * Verify مما إذا كان يجب إعادة المحاولة
     */
    shouldRetry(entry, exitCode) {
        return this._retryHandler.shouldRetry(entry, exitCode);
    }

    /**
     * معالجة إعادة المحاولة
     */
    handleRetry(entry, processId, url, formatId, options, startDownloadCallback, exitCode) {
        this._retryHandler.handleRetry(
            entry, processId, url, formatId, options, 
            startDownloadCallback, exitCode,
            (pid) => this._stateManager.getDownloadEntry(pid)
        );
    }

    /**
     * معالجة اكتمال download بنجاح
     */
    async handleDownloadSuccess(processId, finalOutputPath, deviceIds, url, title, actualFilename = null) {
        const entry = this._stateManager.getDownloadEntry(processId);
        if (!entry) return;

        await this._completionHandler.handleDownloadSuccess(
            entry, processId, finalOutputPath, deviceIds, url, title, actualFilename
        );
    }

    /**
     * معالجة فشل download
     */
    handleDownloadFailure(processId, exitCode, deviceIds, url, title) {
        const entry = this._stateManager.getDownloadEntry(processId);
        if (!entry) return;

        this._failureHandler.handleDownloadFailure(
            entry, processId, exitCode, deviceIds, url, title
        );
    }

    /**
     * معالجة Error process
     */
    handleProcessError(processId, err, deviceIds, url) {
        const entry = this._stateManager.getDownloadEntry(processId);
        if (!entry) return;

        this._failureHandler.handleProcessError(
            entry, processId, err, deviceIds, url
        );
    }


    /**
     * Restore downloads from database into memory
     * @param {Object} repository - Download repository
     */
    async restoreMemoryFromDatabase(repository) {
        if (!repository) {
            console.warn('[DownloadManager] No repository provided for memory restoration');
            return;
        }

        try {
            // FIX: Added await to ensure data is fetched before passing to StateManager
            const downloadsData = await repository.findAllDownloads();
            this._stateManager.restoreFromRepository(downloadsData);
        } catch (error) {
            console.error('[DownloadManager] Failed to restore memory from database:', error);
        }
    }

    /**
     * Search عن تحميل نشط في memory بناءً على Link وID التنسيق
     */
    findActiveDownload(url, formatId) {
        return this._stateManager.findActiveDownload(url, formatId);
    }

    /**
     * تنظيف إدخال معلق في memory
     * يُستخدم عند فشل Starting process بعد إنشاء Input
     * @param {string} processId - ID process
     */
    cleanupOrphanedEntry(processId) {
        const entry = this._stateManager.getDownloadEntry(processId);
        if (!entry) {
            console.warn(`[DownloadManager] No entry found to cleanup for ${processId}`);
            return;
        }

        // Cancel مراجع resolve و reject لتجنب تسرب memory
        entry.resolve = null;
        entry.reject = null;

        // Delete Input من memory
        this._stateManager.removeDownloadEntry(processId);
    }

    /**
     * الحصول على جميع downloadات النشطة
     */
    getActiveDownloads() {
        return this._stateManager.getActiveDownloads();
    }

    /**
     * الحصول على جميع downloadات من memory بتنسيق قاعدة data
     * @returns {Array} قائمة جميع downloadات بتنسيق مطابق لقاعدة data
     */
    getAllDownloads() {
        return this._stateManager.getAllDownloads();
    }

}

module.exports = DownloadManager;
