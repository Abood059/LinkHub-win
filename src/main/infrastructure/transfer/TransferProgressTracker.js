// src/main/infrastructure/transfer/TransferProgressTracker.js
'use strict';

const fs = require('fs').promises;

/**
 * TransferProgressTracker
 * 
 * المسؤولية: حساب وتتبع تقدم transfer
 * - حساب التقدم بناءً على حجم file المنقول
 * - الحصول على حجم file المحلي
 * - الحصول على حجم file البعيد
 * 
 * NO business logic, NO file operations, NO event emission
 */
class TransferProgressTracker {
    constructor({ adbExecutor, logger = null }) {
        if (!adbExecutor) {
            throw new Error('adbExecutor is required for TransferProgressTracker');
        }
        this._adbExecutor = adbExecutor;
        this._logger = logger;
    }

    /**
     * حساب نسبة اكتمال transfer بناءً على حجم file على الهاتف مقسوم على Size الأصلي
     * @param {string} deviceId - ID device
     * @param {string} remotePath - path على device
     * @param {number} originalSize - Size الأصلي للملف بالبايت
     * @returns {Promise<{progress: number, transferredBytes: number, totalBytes: number}>}
     */
    async calculateProgress(deviceId, remotePath, originalSize) {
        try {
            const remoteSize = await this.getRemoteFileSize(deviceId, remotePath);
            
            if (originalSize <= 0) {
                return {
                    progress: 1,
                    transferredBytes: remoteSize,
                    totalBytes: originalSize
                };
            }

            const progress = Math.min(remoteSize / originalSize, 1);
            
            return {
                progress,
                transferredBytes: remoteSize,
                totalBytes: originalSize
            };
        } catch (error) {
            if (this._logger) {
                this._logger.warn(`[TransferProgressTracker] Failed to calculate progress: ${error.message}`);
            }
            return {
                progress: 1,
                transferredBytes: 0,
                totalBytes: originalSize
            };
        }
    }

    /**
     * الحصول على حجم file المحلي
     * @param {string} filePath - مسار file
     * @returns {Promise<number>} - Size بالبايت
     */
    async getLocalFileSize(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.size;
        } catch (error) {
            if (this._logger) {
                this._logger.error(`[TransferProgressTracker] Failed to get local file size: ${error.message}`);
            }
            return 0;
        }
    }

    /**
     * الحصول على حجم file على device البعيد
     * @param {string} deviceId - ID device
     * @param {string} remotePath - path على device
     * @returns {Promise<number>} - Size بالبايت
     */
    async getRemoteFileSize(deviceId, remotePath) {
        try {
            const sanitizedSerial = this._adbExecutor._sanitizeSerialOrTarget ? 
                this._adbExecutor._sanitizeSerialOrTarget(deviceId) : deviceId;
            
            // استخدام أمر shell مع escaping صحيح للمسار
            // نستخدم علامات اقتباس مفردة حول path للحماية من المسافات والأحرف الخاصة
            const escapedPath = remotePath.replace(/'/g, "'\\''");
            const sizeCommand = ['stat', '-c', '%s', `'${escapedPath}'`];
            const sizeOutput = await this._adbExecutor._executeShellCommand(sanitizedSerial, sizeCommand);
            
            const size = parseInt(sizeOutput.trim());
            return isNaN(size) ? 0 : size;
        } catch (error) {
            if (this._logger) {
                this._logger.warn(`[TransferProgressTracker] Failed to get remote file size: ${error.message}`);
            }
            return 0;
        }
    }
}

module.exports = TransferProgressTracker;
