// src/main/infrastructure/adb/AdbCommandExecutor.js
'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

class AdbCommandExecutor {
    constructor({
        processSupervisor,
        logger = null,
        adbPath = null,
        toolPathResolver = null   // New: unified path resolver
    }) {
        this._processSupervisor = processSupervisor;
        this._logger = logger;
        this._toolPathResolver = toolPathResolver;

        // Determine ADB path (priority: passed adbPath > toolPathResolver > old path)
        if (adbPath) {
            this._adbPath = adbPath;
        } else if (this._toolPathResolver) {
            this._adbPath = this._toolPathResolver.getAdbPath();
        } else {
            // Fallback: old method (for compatibility with old code)
            this._adbPath = this._resolveAdbPathLegacy();
        }
    }

    /**
     * Validate and sanitize serial/target input to prevent command injection
     * @param {string} input - The serial or target to validate
     * @returns {string} The validated input
     * @throws {Error} If input contains dangerous characters
     */
    _sanitizeSerialOrTarget(input) {
        if (!input || typeof input !== 'string') {
            throw new Error('Serial or target must be a non-empty string');
        }

        // Allow alphanumeric, hyphens, underscores, dots, colons, and spaces
        // Reject characters commonly used in command injection: ;, &, |, `, $, (, ), <, >
        const dangerousPattern = /[;&|`$()<>]/;
        if (dangerousPattern.test(input)) {
            throw new Error(`Invalid serial or target: contains dangerous characters`);
        }

        // Trim whitespace
        return input.trim();
    }

    async getDevices() {
        try {
            // Correct call compatible with your code for executing quick ADB commands
            const output = await this._executeQuickAdbCommand(['devices']);
            
            // Verify that output is text and not empty
            if (!output || typeof output !== 'string') {
                return [];
            }
    
            // Split text into lines flexibly, handling (\n) and (\r\n) equally across systems
            const lines = output.split(/\r?\n/);
    
            // Additional verification to ensure there are valid lines for processing
            if (!Array.isArray(lines) || lines.length <= 1) {
                return [];
            }
    
            // Filter and analyze lines with complete safety
            return lines
                .slice(1) // Skip first line headers "List of devices attached"
                .filter(line => line.trim() !== '') // Ignore empty lines
                .map(line => {
                    const [id, state] = line.split(/\s+/); // Split based on spaces between ID and state
                    return { serial: id, state: state || 'unknown' }; // Return the structure expected by your system (serial and state)
                })
                .filter(device => device.serial && device.state); // Ensure successful parsing for each device
    
        } catch (error) {
            // Protect your time cycle (every 5 seconds) from collapse and print clean error without crashing Electron
            if (this._logger && typeof this._logger.warn === 'function') {
                this._logger.warn(`[ADB] Failed to get devices list: ${error.message || error}`);
            } else {
                console.warn('[ADB] Failed to get devices list:', error.message || error);
            }
            return [];
        }
    }
    
    async getDeviceInfo(
        serial
    ) {
        const sanitizedSerial = this._sanitizeSerialOrTarget(serial);

        const [
            model,
            version,
            arch
        ] = await Promise.all([
            this._executeShellCommand(
                sanitizedSerial,
                [
                    'getprop',
                    'ro.product.model'
                ]
            ),
            this._executeShellCommand(
                sanitizedSerial,
                [
                    'getprop',
                    'ro.build.version.release'
                ]
            ),
            this._executeShellCommand(
                sanitizedSerial,
                [
                    'getprop',
                    'ro.product.cpu.abi'
                ]
            )
        ]);

        const result = {
            serial: sanitizedSerial,
            model:
                model.trim(),
            version:
                version.trim(),
            arch:
                arch.trim()
        };

        // Log to terminal (main process)
        console.log('[AdbCommandExecutor] Device info from ADB:', result);
        console.log('[AdbCommandExecutor] Model raw:', model, 'trimmed:', model.trim());
        console.log('[AdbCommandExecutor] Version raw:', version, 'trimmed:', version.trim());
        console.log('[AdbCommandExecutor] Arch raw:', arch, 'trimmed:', arch.trim());
        return result;
    }

    async connect(
        target
    ) {
        const sanitizedTarget = this._sanitizeSerialOrTarget(target);
        return this._executeQuickAdbCommand([
            'connect',
            sanitizedTarget
        ]);
    }

    async pair(
        host,
        pairingCode
    ) {
        const sanitizedHost = this._sanitizeSerialOrTarget(host);
        // Pairing code should only contain digits
        if (!pairingCode || !/^\d+$/.test(pairingCode)) {
            throw new Error('Pairing code must contain only digits');
        }
        return this._executeQuickAdbCommand([
            'pair',
            sanitizedHost,
            pairingCode
        ]);
    }

    async disconnect(
        target = null
    ) {
        const args =
            target
                ? [
                      'disconnect',
                      this._sanitizeSerialOrTarget(target)
                  ]
                : [
                      'disconnect'
                  ];

        return this._executeQuickAdbCommand(
            args
        );
    }

    /**
     * نقل ملف للجهاز باستخدام adb push
     * @param {string} serial - ID device
     * @param {string} localPath - path المحلي للملف
     * @param {string} remotePath - path Target على device
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async pushFile(serial, localPath, remotePath) {
        const sanitizedSerial = this._sanitizeSerialOrTarget(serial);
        
        // Verify من صحة pathات
        if (!localPath || typeof localPath !== 'string') {
            throw new Error('Local path is required and must be a string');
        }
        if (!remotePath || typeof remotePath !== 'string') {
            throw new Error('Remote path is required and must be a string');
        }

        try {
            const args = [
                '-s',
                sanitizedSerial,
                'push',
                localPath,
                remotePath
            ];
            
            await this._executeQuickAdbCommand(args);
            
            return {
                success: true,
                message: `File transferred successfully to ${remotePath}`
            };
        } catch (error) {
            if (this._logger) {
                this._logger.error(`Failed to push file to device: ${error.message}`);
            }
            return {
                success: false,
                message: `Failed to transfer file: ${error.message}`
            };
        }
    }

    /**
     * تنفيذ أمر push باستخدام دالة طويلة الأمد
     * @param {string} serial - ID device
     * @param {string} localPath - path المحلي للملف
     * @param {string} remotePath - path Target على device
     * @param {Function} onProgress - callback للتقدم (اختياري)
     * @returns {Promise<{success: boolean, message: string}>}
     */
    pushFileLongRunning(serial, localPath, remotePath, onProgress = null) {
        const sanitizedSerial = this._sanitizeSerialOrTarget(serial);
        
        // Verify من صحة pathات
        if (!localPath || typeof localPath !== 'string') {
            throw new Error('Local path is required and must be a string');
        }
        if (!remotePath || typeof remotePath !== 'string') {
            throw new Error('Remote path is required and must be a string');
        }

        return new Promise((resolve, reject) => {
            const transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            try {
                const args = [
                    '-s',
                    sanitizedSerial,
                    'push',
                    localPath,
                    remotePath
                ];
                
                // استخدام startManagedProcess من ProcessSupervisor
                const child = this._processSupervisor.startManagedProcess({
                    processId: transferId,
                    binPath: this._adbPath,
                    args: args,
                    type: 'transfer',
                    metadata: { serial: sanitizedSerial, localPath, remotePath },
                    onData: (data, streamType) => {
                        // تحليل مخرجات ADB للحصول على التقدم
                        if (streamType === 'stdout' && onProgress) {
                            const progressMatch = data.match(/\[(\d+)%\]/);
                            if (progressMatch) {
                                const percent = parseInt(progressMatch[1]) / 100;
                                onProgress(percent);
                            }
                        }
                    }
                });
                
                child.on('exit', (code) => {
                    if (code === 0) {
                        resolve({
                            success: true,
                            message: `File transferred successfully to ${remotePath}`
                        });
                    } else {
                        resolve({
                            success: false,
                            message: `Transfer failed with exit code ${code}`
                        });
                    }
                });
                
                child.on('error', (error) => {
                    if (this._logger) {
                        this._logger.error(`Failed to push file to device: ${error.message}`);
                    }
                    resolve({
                        success: false,
                        message: `Failed to transfer file: ${error.message}`
                    });
                });
                
            } catch (error) {
                if (this._logger) {
                    this._logger.error(`Failed to start transfer: ${error.message}`);
                }
                resolve({
                    success: false,
                    message: `Failed to start transfer: ${error.message}`
                });
            }
        });
    }

    /**
     * Verify من اتصال device
     * @param {string} serial - ID device
     * @returns {Promise<boolean>}
     */
    async isDeviceConnected(serial) {
        const sanitizedSerial = this._sanitizeSerialOrTarget(serial);
        
        try {
            const devices = await this.getDevices();
            return devices.some(device => device.serial === sanitizedSerial && device.state === 'device');
        } catch (error) {
            if (this._logger) {
                this._logger.error(`Failed to check device connection: ${error.message}`);
            }
            return false;
        }
    }

    async _executeShellCommand(
        serial,
        shellArgs
    ) {
        const sanitizedSerial = this._sanitizeSerialOrTarget(serial);
        const result =
            await this._executeQuickAdbCommand(
                [
                    '-s',
                    sanitizedSerial,
                    'shell',
                    ...shellArgs
                ]
            );

        // executeQuickTaskArray returns a string, not an array
        return result;
    }

    async _executeQuickAdbCommand(
        args = []
    ) {
        return this._processSupervisor
            .executeQuickTaskArray(
                this._adbPath,
                args
            );
    }

    // Method القديمة محفوظة كخيار احتياطي (تم تعديل اسمها قليلاً)
    _resolveAdbPathLegacy() {
        const isWin =
            process.platform ===
            'win32';

        const appRoot = this._toolPathResolver ? this._toolPathResolver._appRoot : process.cwd();
        
        return path.join(
            appRoot,
            'resources',
            'bin',
            isWin
                ? 'win/adb.exe'
                : 'linux/adb'
        );
    }
}

module.exports =
    AdbCommandExecutor;