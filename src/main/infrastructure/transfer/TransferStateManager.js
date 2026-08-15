// src/main/infrastructure/transfer/TransferStateManager.js
'use strict';

const { randomUUID } = require('crypto');

/**
 * TransferStateManager
 * 
 * المسؤولية: إدارة state عمليات transfer في memory فقط
 * - إنشاء وتحديث وDelete عمليات transfer
 * - تخزين data في memory (Map)
 * - دوال استعلام سريعة
 * 
 * NO business logic, NO file operations, NO event emission
 * data تمحى عند Close Application
 */
class TransferStateManager {
    constructor({ logger = null }) {
        this._logger = logger;
        this._transfers = new Map(); // transferId -> transfer entry
    }

    /**
     * إنشاء entry جديد لعملية transfer
     * @param {string} transferId - ID transfer (UUID)
     * @param {Object} data - بيانات transfer
     * @returns {Object} - الـ entry المنشأ
     */
    createTransferEntry(transferId, data) {
        const entry = {
            transferId: transferId || randomUUID(),
            deviceId: data.deviceId || null,
            localPath: data.localPath || null,
            remotePath: data.remotePath || null,
            downloadId: data.downloadId || null,
            status: data.status || 'pending',
            progress: data.progress || 0,
            transferredBytes: data.transferredBytes || 0,
            totalBytes: data.totalBytes || 0,
            speed: data.speed || null,
            eta: data.eta || null,
            startedAt: data.startedAt || null,
            completedAt: data.completedAt || null,
            failedAt: data.failedAt || null,
            cancelledAt: data.cancelledAt || null,
            errorMessage: data.errorMessage || null
        };

        this._transfers.set(entry.transferId, entry);

        if (this._logger) {
            this._logger.info(`[TransferStateManager] Created transfer entry: ${entry.transferId}`);
        }

        return entry;
    }

    /**
     * الحصول على entry لعملية transfer
     * @param {string} transferId - ID transfer
     * @returns {Object|null} - الـ entry أو null
     */
    getTransferEntry(transferId) {
        return this._transfers.get(transferId) || null;
    }

    /**
     * تحديث entry لعملية transfer
     * @param {string} transferId - ID transfer
     * @param {Object} updates - الحقول المحدثة
     * @returns {boolean} - نجاح Update
     */
    updateTransferEntry(transferId, updates) {
        const entry = this._transfers.get(transferId);
        if (!entry) {
            if (this._logger) {
                this._logger.warn(`[TransferStateManager] Transfer not found: ${transferId}`);
            }
            return false;
        }

        // تحديث الحقول المحددة فقط
        Object.assign(entry, updates);

        if (this._logger) {
            this._logger.info(`[TransferStateManager] Updated transfer entry: ${transferId}`);
        }

        return true;
    }

    /**
     * Delete entry لعملية transfer
     * @param {string} transferId - ID transfer
     * @returns {boolean} - نجاح الDelete
     */
    removeTransferEntry(transferId) {
        const deleted = this._transfers.delete(transferId);

        if (deleted && this._logger) {
            this._logger.info(`[TransferStateManager] Removed transfer entry: ${transferId}`);
        }

        return deleted;
    }

    /**
     * الحصول على جميع عمليات transfer النشطة
     * @returns {Map} - Map من transferId -> entry
     */
    getActiveTransfers() {
        return this._transfers;
    }

    /**
     * الحصول على جميع عمليات transfer النشطة كمصفوفة
     * @returns {Array} - مصفوفة من entries
     */
    getActiveTransfersArray() {
        return Array.from(this._transfers.values());
    }

    /**
     * الحصول على عمليات transfer لجهاز معين
     * @param {string} deviceId - ID device
     * @returns {Array} - مصفوفة من entries
     */
    getTransfersByDeviceId(deviceId) {
        const transfers = [];
        for (const entry of this._transfers.values()) {
            if (entry.deviceId === deviceId) {
                transfers.push(entry);
            }
        }
        return transfers;
    }

    /**
     * الحصول على عمليات transfer لتحميل معين
     * @param {string} downloadId - ID download
     * @returns {Array} - مصفوفة من entries
     */
    getTransfersByDownloadId(downloadId) {
        const transfers = [];
        for (const entry of this._transfers.values()) {
            if (entry.downloadId === downloadId) {
                transfers.push(entry);
            }
        }
        return transfers;
    }

    /**
     * الحصول على عدد عمليات transfer النشطة
     * @returns {number} - العدد
     */
    getActiveTransfersCount() {
        return this._transfers.size;
    }

    /**
     * مسح جميع عمليات transfer
     */
    clearAllTransfers() {
        const count = this._transfers.size;
        this._transfers.clear();

        if (this._logger) {
            this._logger.info(`[TransferStateManager] Cleared all transfers (${count} entries)`);
        }
    }
}

module.exports = TransferStateManager;
