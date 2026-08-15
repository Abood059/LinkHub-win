// src/main/infrastructure/ipc/DownloadHandlers.js
'use strict';

/**
 * DownloadHandlers
 * Pure IPC transport layer
 * Principles:
 * - لا تحتوي على منطق أعمال أو بحث أو اتخاذ قرارات
 * - دورها الحصري: استقبال Requestات من UI → تحويلها إلى استدعاءات للخدمات → إعادة Results
 * - لا تبحث في قاعدة data لمنطق Starting/استئناف download
 */
class DownloadHandlers {
    constructor(downloadOrchestrator) {
        if (!downloadOrchestrator) {
            throw new Error('DownloadOrchestrator is required for DownloadHandlers');
        }
        this._downloadOrchestrator = downloadOrchestrator;
    }

    register(ipcMain) {
        if (!ipcMain || typeof ipcMain.handle !== 'function') {
            throw new Error('Valid ipcMain instance required');
        }

        ipcMain.handle('download:inspect', async (event, url) => {
            const result = this._downloadOrchestrator.inspectLink(url);
            return result;
        });

        ipcMain.handle('download:start', async (event, url, formatId, deviceIds = null, options = {}) => {
            const result = this._downloadOrchestrator.startDownload(url, formatId, deviceIds, options);
            return result;
        });

        ipcMain.handle('download:stop', async (event, processId) => {
            const result = this._downloadOrchestrator.stopDownload(processId);
            return result;
        });

        ipcMain.handle('download:resume', async (event, processId, url, formatId, deviceIds = null, options = {}) => {
            const result = this._downloadOrchestrator.resumeDownload(processId, url, formatId, deviceIds, options);
            return result;
        });

        ipcMain.handle('download:metadata', async (event, url) => {
            return this._downloadOrchestrator.getMetadata(url);
        });
        
        ipcMain.handle('download:active', async () => {
            return this._downloadOrchestrator.getActiveDownloads();
        });

        ipcMain.handle('download:transferToDevice', async (event, localPath, deviceId) => {
            return this._downloadOrchestrator.transferFileToDevice(localPath, deviceId);
        });


        ipcMain.handle('download:getHistory', async () => {
            return this._downloadOrchestrator.getDownloadHistory();
        });

        ipcMain.handle('download:deleteFromMemory', async (event, processId) => {
            return this._downloadOrchestrator.deleteDownloadFromMemory(processId);
        });

        ipcMain.handle('download:getDetails', async (event, downloadId) => {
            if (!downloadId) {
                throw new Error('downloadId is required');
            }
            return this._downloadOrchestrator.getDownloadDetails(downloadId);
        });

    }
}

module.exports = DownloadHandlers;