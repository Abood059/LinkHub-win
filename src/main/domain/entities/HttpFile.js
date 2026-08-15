const crypto = require('crypto');
const FileStatus = require('../value-objects/FileStatus');

/**
 * HttpFile Model
 * Data model for files downloaded via HTTP
 */
class HttpFile {
    constructor(data = {}) {
        // الخصائص الأساسية
        this.id = data.id || crypto.randomUUID();
        this.url = data.url || '';
        this.fileName = data.fileName || '';
        this.storagePath = data.storagePath || '';
        this.mimeType = data.mimeType || '';

        // خصائص state download
        this.status = data.status || 'pending'; // 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'

        // Initialize fileStatus وتعبئة data الممررة إن وجدت
        const statusData = data.fileStatus || {};
        this.fileStatus = new FileStatus({
            percentage: statusData.percentage !== undefined ? statusData.percentage : (data.progress !== undefined ? data.progress : 0),
            downloadedBytes: statusData.downloadedBytes !== undefined ? statusData.downloadedBytes : (data.downloadedBytes !== undefined ? data.downloadedBytes : 0),
            speed: statusData.speed !== undefined ? statusData.speed : (data.speed !== undefined ? data.speed : ''),
            eta: statusData.eta !== undefined ? statusData.eta : (data.eta !== undefined ? data.eta : ''),
            totalBytes: statusData.totalBytes !== undefined ? statusData.totalBytes : (data.sizeBytes !== undefined ? data.sizeBytes : null),
            isPaused: statusData.isPaused !== undefined ? statusData.isPaused : false
        });
    }

    /**
     * تحويل Object إلى JSON عادي
     */
    toJSON() {
        return {
            id: this.id,
            url: this.url,
            fileName: this.fileName,
            storagePath: this.storagePath,
            mimeType: this.mimeType,
            status: this.status,
            fileStatus: this.fileStatus.toJSON()
        };
    }

    /**
     * تحديث state التقدم
     */
    updateProgress(progressData) {
        if (!progressData) return;
        this.fileStatus.update({
            percentage: progressData.progress,
            downloadedBytes: progressData.downloadedBytes,
            speed: progressData.speed,
            eta: progressData.eta,
            totalBytes: progressData.totalBytes
        });
    }

    /**
     * تحديث الstate
     */
    setStatus(status) {
        this.status = status;
    }

    /**
     * Verify من اكتمال download
     */
    isCompleted() {
        return this.status === 'completed';
    }

    /**
     * Verify من فشل download
     */
    isFailed() {
        return this.status === 'failed';
    }

    /**
     * Verify من Cancel download
     */
    isCancelled() {
        return this.status === 'cancelled';
    }

    /**
     * Verify من أن download نشط
     */
    isActive() {
        return this.status === 'downloading' || this.status === 'pending';
    }
}

module.exports = HttpFile;
