// src/main/infrastructure/adb/AdbPushService.js
'use strict';

const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');

class AdbPushService extends EventEmitter {
    constructor({ adbExecutor, logger = null }) {
        super();
        this._adbExecutor = adbExecutor;
        this._logger = logger;
    }

    /**
     * نقل ملف للجهاز مع تتبع التقدم
     * @param {string} localPath - path المحلي للملف
     * @param {string} deviceId - ID device
     * @param {string} remotePath - path Target على device (اختياري)
     * @param {boolean} deleteAfterTransfer - Delete file بعد transfer (اختياري)
     * @returns {Promise<{success: boolean, message: string, progress: number}>}
     */
    async pushFile(localPath, deviceId, remotePath = null, deleteAfterTransfer = false) {
        // Verify من اتصال device
        const isConnected = await this._adbExecutor.isDeviceConnected(deviceId);
        if (!isConnected) {
            return {
                success: false,
                message: 'Device is not connected',
                progress: 0
            };
        }

        // Verify من وجود file
        try {
            await fs.access(localPath);
        } catch (err) {
            return {
                success: false,
                message: `File not found: ${localPath}`,
                progress: 0
            };
        }

        // الحصول على حجم file الأصلي
        const originalSize = await this._getFileSize(localPath);

        // تحديد path Target على device
        const fileName = path.basename(localPath);
        const targetRemotePath = remotePath || `/sdcard/Download/${fileName}`;

        // إرسال حدث Starting transfer
        this.emit('transferStarted', {
            localPath,
            remotePath: targetRemotePath,
            deviceId,
            totalSize: originalSize
        });

        // نقل file
        const result = await this._adbExecutor.pushFile(deviceId, localPath, targetRemotePath);

        if (result.success) {
            // حساب التقدم بعد transfer
            const progress = await this._calculateProgress(deviceId, targetRemotePath, originalSize);
            
            // Delete file المؤقت بعد transfer الناجح
            if (deleteAfterTransfer) {
                try {
                    await fs.unlink(localPath);
                } catch (err) {
                    if (this._logger) {
                        this._logger.warn(`Failed to delete temp file: ${err.message}`);
                    }
                }
            }

            this.emit('transferComplete', {
                localPath,
                remotePath: targetRemotePath,
                deviceId,
                progress
            });

            return {
                success: true,
                message: `File transferred successfully to ${targetRemotePath}`,
                progress
            };
        } else {
            this.emit('transferFailed', {
                localPath,
                remotePath: targetRemotePath,
                deviceId,
                error: result.message
            });

            return {
                success: false,
                message: result.message,
                progress: 0
            };
        }
    }

    /**
     * نقل مجموعة ملفات للجهاز
     * @param {Array<string>} localPaths - مصفوفة pathات المحلية للملفات
     * @param {string} deviceId - ID device
     * @param {string} remoteDir - path Target على device (اختياري)
     * @param {boolean} deleteAfterTransfer - Delete fileات بعد transfer (اختياري)
     * @returns {Promise<Array<{success: boolean, message: string, progress: number, file: string}>>}
     */
    async pushFiles(localPaths, deviceId, remoteDir = null, deleteAfterTransfer = false) {
        const results = [];
        const targetRemoteDir = remoteDir || '/sdcard/Download/';

        for (const localPath of localPaths) {
            const fileName = path.basename(localPath);
            const remotePath = path.join(targetRemoteDir, fileName);
            
            const result = await this.pushFile(localPath, deviceId, remotePath, deleteAfterTransfer);
            results.push({
                ...result,
                file: localPath
            });
        }

        return results;
    }

    /**
     * حساب نسبة اكتمال transfer بناءً على حجم file على الهاتف مقسوم على Size الأصلي
     * @param {string} deviceId - ID device
     * @param {string} remotePath - path على device
     * @param {number} originalSize - Size الأصلي للملف بالبايت
     * @returns {Promise<number>} - نسبة التقدم بين 0 و 1
     */
    async _calculateProgress(deviceId, remotePath, originalSize) {
        try {
            const remoteSize = await this._getRemoteFileSize(deviceId, remotePath);
            
            if (originalSize <= 0) {
                return 1; // إذا كان Size الأصلي 0، نعتبر transfer مكتمل
            }

            const progress = Math.min(remoteSize / originalSize, 1);
            
            this.emit('progressUpdate', {
                deviceId,
                remotePath,
                progress,
                transferredBytes: remoteSize,
                totalBytes: originalSize
            });

            return progress;
        } catch (error) {
            if (this._logger) {
                this._logger.warn(`Failed to calculate progress: ${error.message}`);
            }
            return 1; // في state الError، نعتبر transfer مكتمل
        }
    }

    /**
     * الحصول على حجم file المحلي
     * @param {string} filePath - مسار file
     * @returns {Promise<number>} - Size بالبايت
     */
    async _getFileSize(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.size;
        } catch (error) {
            if (this._logger) {
                this._logger.error(`Failed to get file size: ${error.message}`);
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
    async _getRemoteFileSize(deviceId, remotePath) {
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
                this._logger.warn(`Failed to get remote file size: ${error.message}`);
            }
            return 0;
        }
    }

    /**
     * نقل ملف للجهاز وDeleteه بعد transfer (للملفات المؤقتة)
     * @param {string} localPath - path المحلي للملف
     * @param {string} deviceId - ID device
     * @returns {Promise<{success: boolean, message: string, progress: number}>}
     */
    async pushAndDelete(localPath, deviceId) {
        return this.pushFile(localPath, deviceId, null, true);
    }

    /**
     * نقل ملف من مجلد downloadات للجهاز (بدون Delete)
     * @param {string} localPath - path المحلي للملف
     * @param {string} deviceId - ID device
     * @returns {Promise<{success: boolean, message: string, progress: number}>}
     */
    async pushFromDownloads(localPath, deviceId) {
        return this.pushFile(localPath, deviceId, null, false);
    }
}

module.exports = AdbPushService;
