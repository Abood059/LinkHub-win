// src/main/infrastructure/media/CompletionHandler.js
'use strict';

const { moveDownloadedFile, sanitizeFileName } = require('./YtdlpUtils');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * فئة مسؤولة عن معالجة اكتمال download بنجاح ونقل fileات
 */
class CompletionHandler {
    constructor(pathService, logger = null, adbPushService = null) {
        this._pathService = pathService;
        this._logger = logger;
        this._adbPushService = adbPushService;
        this._transferOrchestrator = null;
    }

    /**
     * تعيين TransferOrchestrator للتكامل مع service transfer
     * @param {Object} transferOrchestrator - مثيل من TransferOrchestrator
     */
    setTransferOrchestrator(transferOrchestrator) {
        this._transferOrchestrator = transferOrchestrator;
        if (this._logger) {
            this._logger.info('[CompletionHandler] TransferOrchestrator set successfully');
        }
    }

    /**
     * معالجة اكتمال download بنجاح
     */
    async handleDownloadSuccess(entry, processId, finalOutputPath, deviceIds, url, title, actualFilename = null) {
        if (!entry) return;

        // اكتمال download يُحدد بخروج process بنجاح (exit 0)
        entry.percent = 100;
        if (entry.totalSize && entry.downloadedBytes < entry.totalSize) {
            entry.downloadedBytes = entry.totalSize;
        }
        entry.completedAt = new Date().toISOString();

        // Save downloadId للاستخدام في transfer
        const downloadId = processId;

        try {
            let tempFilePath;

            // استخدام actualFilename من حدث ytDlpEvent أولاً
            if (actualFilename) {
                // Verify من وجود file مع إعادة محاولة قصيرة
                let fileExists = false;
                for (let i = 0; i < 5; i++) {
                    try {
                        const fileStats = await fs.stat(actualFilename);
                        if (fileStats.isFile()) {
                            tempFilePath = actualFilename;
                            fileExists = true;
                            if (this._logger && typeof this._logger.info === 'function') {
                                this._logger.info(`Using actualFilename from ytDlpEvent: ${actualFilename}`);
                            }
                            break;
                        }
                    } catch (err) {
                        if (i < 4) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                }

                if (!fileExists) {
                    if (this._logger && typeof this._logger.warn === 'function') {
                        this._logger.warn(`actualFilename not found after retries, falling back to search: ${actualFilename}`);
                    }
                    tempFilePath = await this._findFileBySearch(finalOutputPath, title);
                }
            } else {
                // استخدام منطق Search التقليدي كـ fallback
                tempFilePath = await this._findFileBySearch(finalOutputPath, title);
            }

            if (!tempFilePath) {
                throw new Error(`No downloaded file found. yt-dlp exited with code 0 but failed to create the file.`);
            }

            // نقل file إلى مجلد التنزيلات النهائي (ديناميكي يعمل على جميع الأنظمة)
            const downloadsDir = path.join(os.homedir(), 'Downloads');
            const { finalPath, tempPath } = await moveDownloadedFile(tempFilePath, title, deviceIds, downloadsDir);

            entry.status = 'completed';
            entry.outputPath = finalPath;

            // transfer التلقائي للأجهزة إذا تم تحديدها
            let transferResult = null;
            if (this._logger) {
                this._logger.info(`[CompletionHandler] Checking automatic transfer - deviceIds: ${deviceIds}, adbPushService: ${!!this._adbPushService}, transferOrchestrator: ${!!this._transferOrchestrator}`);
            }
            
            // استخدام TransferOrchestrator إذا كان متاحاً (للنقل المتعدد)
            if (deviceIds && deviceIds.length > 0 && this._transferOrchestrator) {
                try {
                    // استخدام TransferOrchestrator للنقل المتعدد
                    transferResult = await this._transferOrchestrator.startDownloadTransfer(downloadId, deviceIds, finalPath);
                    
                    if (transferResult.success) {
                        if (this._logger) {
                            this._logger.info(`File transfer started successfully to devices ${deviceIds.join(', ')} via TransferOrchestrator`);
                        }
                    } else {
                        if (this._logger) {
                            this._logger.warn(`File transfer to devices ${deviceIds.join(', ')} failed via TransferOrchestrator: ${transferResult.message}`);
                        }
                    }
                } catch (err) {
                    if (this._logger) {
                        this._logger.error(`Error during automatic transfer to devices ${deviceIds.join(', ')} via TransferOrchestrator: ${err.message}`);
                    }
                    transferResult = { success: false, message: err.message };
                }
            }

            if (entry.resolve) {
                entry.resolve({
                    success: true,
                    outputPath: finalPath,
                    tempPath: tempPath,
                    processId,
                    transferResult
                });
            }
        } catch (err) {
            if (this._logger && typeof this._logger.error === 'function') {
                this._logger.error(`Failed to move file: ${err.message}`);
            }
            entry.status = 'failed';
            if (entry.reject) {
                entry.reject(new Error(`Download completed but file transfer failed: ${err.message}`));
            }
        }
    }

    /**
     * Search عن file المحمل باستخدام منطق Search التقليدي
     */
    async _findFileBySearch(finalOutputPath, title) {
        try {
            // استخدام path الصحيح من PathService للملفات المؤقتة للتحميل
            const searchPath = this._pathService ? this._pathService.getDownloadsTempDir() : finalOutputPath;
            
            // Verify مما إذا كان path مجلداً (الstate الجديدة) أو ملفاً (الstate القديمة)
            const stats = await fs.stat(searchPath);
            
            if (stats.isDirectory()) {
                // path هو مجلد - Search عن file النهائي باستخدام عنوان Video
                // yt-dlp يسمي file النهائي بناءً على عنوان Video ويDelete fileات المؤقتة تلقائياً
                const files = await fs.readdir(searchPath);
                
                if (this._logger && typeof this._logger.info === 'function') {
                    this._logger.info(`Searching in directory: ${searchPath}, found ${files.length} items`);
                }
                
                // Verify من وجود أي ملفات
                if (files.length === 0) {
                    if (this._logger && typeof this._logger.error === 'function') {
                        this._logger.error(`Directory is empty: ${searchPath}`);
                    }
                    return null;
                }
                
                // تنظيف عنوان Video لمطابقة اسم file الذي أنشأه yt-dlp
                const sanitizedTitle = sanitizeFileName(title);
                
                // إنشاء نسخة مبسطة من Address للمطابقة المرنة (fuzzy matching)
                // إزالة جميع الأحرف غير الأبجدية Numberية للمقارنة
                const fuzzyTitle = title.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                
                // Search عن file الذي يبدأ بAddress المنظف
                let finalFile = null;
                
                for (const file of files) {
                    const filePath = path.join(searchPath, file);
                    const fileStats = await fs.stat(filePath);
                    
                    if (fileStats.isFile()) {
                        // Verify مما إذا كان اسم file يبدأ بAddress المنظف
                        const fileNameWithoutExt = path.basename(file, path.extname(file));
                        // Normalize actual file name to replace spaces with underscores like sanitizeFileName
                        const normalizedFileName = fileNameWithoutExt.replace(/\s+/g, '_');
                        // إنشاء نسخة مبسطة من اسم file للمطابقة المرنة
                        const fuzzyFileName = fileNameWithoutExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                        
                        // استخدام مطابقة جزئية للتعامل مع الأحرف الخاصة والاختلافات في التنسيق
                        if (normalizedFileName === sanitizedTitle || 
                            normalizedFileName.includes(sanitizedTitle) ||
                            sanitizedTitle.includes(normalizedFileName) ||
                            fuzzyFileName === fuzzyTitle ||
                            fuzzyFileName.includes(fuzzyTitle) ||
                            fuzzyTitle.includes(fuzzyFileName)) {
                            finalFile = filePath;
                            break;
                        }
                    }
                }
                
                // إذا لم يتم العثور على file في Directory المحدد، ابحث في Directory الأب
                // yt-dlp قد يضع file المدموج في Directory الأب عند الدمج
                if (!finalFile) {
                    const parentDir = path.dirname(searchPath);
                    try {
                        const parentFiles = await fs.readdir(parentDir);
                        if (this._logger && typeof this._logger.info === 'function') {
                            this._logger.info(`Searching in parent directory: ${parentDir}, found ${parentFiles.length} items`);
                        }
                        for (const file of parentFiles) {
                            const filePath = path.join(parentDir, file);
                            const fileStats = await fs.stat(filePath);
                            
                            if (fileStats.isFile()) {
                                const fileNameWithoutExt = path.basename(file, path.extname(file));
                                // Normalize actual file name to replace spaces with underscores like sanitizeFileName
                                const normalizedFileName = fileNameWithoutExt.replace(/\s+/g, '_');
                                // إنشاء نسخة مبسطة من اسم file للمطابقة المرنة
                                const fuzzyFileName = fileNameWithoutExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                                // استخدام مطابقة جزئية للتعامل مع الأحرف الخاصة والاختلافات في التنسيق
                                if (normalizedFileName === sanitizedTitle || 
                                    normalizedFileName.includes(sanitizedTitle) ||
                                    sanitizedTitle.includes(normalizedFileName) ||
                                    fuzzyFileName === fuzzyTitle ||
                                    fuzzyFileName.includes(fuzzyTitle) ||
                                    fuzzyTitle.includes(fuzzyFileName)) {
                                    finalFile = filePath;
                                    break;
                                }
                            }
                        }
                    } catch (err) {
                        if (this._logger && typeof this._logger.error === 'function') {
                            this._logger.error(`Error searching in parent directory: ${err.message}`);
                        }
                    }
                }
                
                if (!finalFile) {
                    if (this._logger && typeof this._logger.error === 'function') {
                        this._logger.error(`No downloaded file found matching title: ${sanitizedTitle}`);
                    }
                    return null;
                }
                
                return finalFile;
            } else {
                // path هو ملف - استخدامه مباشرة (للتوافق مع الstate القديمة)
                return finalOutputPath;
            }
        } catch (err) {
            if (this._logger && typeof this._logger.error === 'function') {
                this._logger.error(`Error in _findFileBySearch: ${err.message}`);
            }
            return null;
        }
    }
}

module.exports = CompletionHandler;
