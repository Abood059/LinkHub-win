// src/main/infrastructure/transfer/FileTransferExecutor.js
'use strict';

/**
 * FileTransferExecutor
 * 
 * Responsibility: Execute actual transfer command via ADB
 * - تنفيذ أمر push لنقل fileات
 * - تنفيذ أمر pull لسحب fileات
 * 
 * NO business logic, NO progress tracking, NO event emission
 */
class FileTransferExecutor {
    constructor({ adbExecutor, logger = null }) {
        if (!adbExecutor) {
            throw new Error('adbExecutor is required for FileTransferExecutor');
        }
        this._adbExecutor = adbExecutor;
        this._logger = logger;
    }

    /**
     * تنفيذ أمر push لنقل ملف للجهاز
     * @param {string} deviceId - ID device
     * @param {string} localPath - path المحلي للملف
     * @param {string} remotePath - path Target على device
     * @param {Function} onProgress - callback للتقدم (اختياري)
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async executePush(deviceId, localPath, remotePath, onProgress = null) {
        try {
            // استخدام Function طويلة الأمد لتجنب تجمد UI
            const result = await this._adbExecutor.pushFileLongRunning(
                deviceId, 
                localPath, 
                remotePath,
                onProgress
            );
            
            if (this._logger) {
                this._logger.info(`[FileTransferExecutor] Push executed: ${localPath} -> ${remotePath} (${deviceId})`);
            }
            
            return result;
        } catch (error) {
            if (this._logger) {
                this._logger.error(`[FileTransferExecutor] Push failed: ${error.message}`);
            }
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * تنفيذ أمر pull لسحب ملف من device
     * @param {string} deviceId - ID device
     * @param {string} remotePath - path على device
     * @param {string} localPath - path المحلي Target
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async executePull(deviceId, remotePath, localPath) {
        try {
            const result = await this._adbExecutor.pullFile(deviceId, remotePath, localPath);
            
            if (this._logger) {
                this._logger.info(`[FileTransferExecutor] Pull executed: ${remotePath} -> ${localPath} (${deviceId})`);
            }
            
            return result;
        } catch (error) {
            if (this._logger) {
                this._logger.error(`[FileTransferExecutor] Pull failed: ${error.message}`);
            }
            return {
                success: false,
                message: error.message
            };
        }
    }
}

module.exports = FileTransferExecutor;
