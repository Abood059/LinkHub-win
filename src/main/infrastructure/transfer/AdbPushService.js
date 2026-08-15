// src/main/infrastructure/transfer/AdbPushService.js
'use strict';

const path = require('path');
const EventEmitter = require('events');

/**
 * AdbPushService
 * 
 * المسؤولية: تنسيق عمليات transfer (Orchestration فقط)
 * - تنسيق عمليات transfer الفردية والمتعددة
 * - إرسال أحداث التقدم والstate
 * - إدارة Verify من الشروط الأساسية
 * 
 * يفوض Tasks المتخصصة إلى:
 * - FileTransferExecutor: تنفيذ transfer الفعلي
 * - TransferProgressTracker: حساب التقدم
 * - FileDeleter: Delete fileات
 */
class AdbPushService extends EventEmitter {
    constructor({ fileTransferExecutor, progressTracker, fileDeleter, logger = null }) {
        super();
        
        if (!fileTransferExecutor) {
            throw new Error('fileTransferExecutor is required for AdbPushService');
        }
        if (!progressTracker) {
            throw new Error('progressTracker is required for AdbPushService');
        }
        if (!fileDeleter) {
            throw new Error('fileDeleter is required for AdbPushService');
        }
        
        this._fileTransferExecutor = fileTransferExecutor;
        this._progressTracker = progressTracker;
        this._fileDeleter = fileDeleter;
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
        // تحديد path Target على device
        const fileName = path.basename(localPath);
        const targetRemotePath = remotePath || `/sdcard/Download/${fileName}`;

        // الحصول على حجم file الأصلي
        const originalSize = await this._progressTracker.getLocalFileSize(localPath);

        if (originalSize === 0) {
            return {
                success: false,
                message: `File is empty or not found: ${localPath}`,
                progress: 0
            };
        }

        // إرسال حدث Starting transfer
        this.emit('transferStarted', {
            localPath,
            remotePath: targetRemotePath,
            deviceId,
            totalSize: originalSize
        });

        // Starting polling للتقدم كل 300ms
        let progressInterval = null;
        let isTransferComplete = false;

        const startProgressPolling = () => {
            progressInterval = setInterval(async () => {
                if (isTransferComplete) {
                    clearInterval(progressInterval);
                    return;
                }

                try {
                    const progressData = await this._progressTracker.calculateProgress(deviceId, targetRemotePath, originalSize);
                    
                    this.emit('progressUpdate', {
                        localPath,
                        remotePath: targetRemotePath,
                        deviceId,
                        progress: progressData.progress,
                        transferredBytes: progressData.transferredBytes,
                        totalBytes: progressData.totalBytes
                    });
                } catch (error) {
                    if (this._logger) {
                        this._logger.warn(`[AdbPushService] Failed to poll progress: ${error.message}`);
                    }
                }
            }, 300);
        };

        startProgressPolling();

        // تنفيذ transfer
        const result = await this._fileTransferExecutor.executePush(deviceId, localPath, targetRemotePath);

        // إيقاف polling
        isTransferComplete = true;
        if (progressInterval) {
            clearInterval(progressInterval);
        }

        if (result.success) {
            // حساب التقدم النهائي بعد transfer
            const progressData = await this._progressTracker.calculateProgress(deviceId, targetRemotePath, originalSize);
            
            // إرسال تحديث التقدم النهائي
            this.emit('progressUpdate', {
                localPath,
                remotePath: targetRemotePath,
                deviceId,
                progress: progressData.progress,
                transferredBytes: progressData.transferredBytes,
                totalBytes: progressData.totalBytes
            });
            
            // Delete file المؤقت بعد transfer الناجح
            if (deleteAfterTransfer) {
                await this._fileDeleter.deleteLocalFile(localPath);
            }

            this.emit('transferComplete', {
                localPath,
                remotePath: targetRemotePath,
                deviceId,
                progress: progressData.progress,
                transferredBytes: progressData.transferredBytes,
                totalBytes: progressData.totalBytes
            });

            return {
                success: true,
                message: `File transferred successfully to ${targetRemotePath}`,
                progress: progressData.progress
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
