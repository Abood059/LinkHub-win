// src/main/application/orchestrators/DeviceOrchestrator.js
'use strict';

const Device = require('../../domain/entities/Device');

/**
 * DeviceOrchestrator
 * Responsible for Coordinating device operations:
 * - Pairing and connection
 * - Managing state in DeviceRegistry
 * - Starting and stopping screen mirroring
 * - Managing favorites and trust
 *
 * Contains no technical execution logic (no spawn, no child_process, no direct ADB)
 */
class DeviceOrchestrator {
    constructor({ deviceRegistry, connectionService, scrcpyAdapter, deviceRepository = null, logger = null }) {
        this._deviceRegistry = deviceRegistry;
        this._connectionService = connectionService;
        this._scrcpyAdapter = scrcpyAdapter;
        this._deviceRepository = deviceRepository;
        this._logger = logger;
    }

    /**
     * Pair with wireless device using pairing code
     * @param {string} host - Address and port e.g. "192.168.1.10:37000"
     * @param {string} pairingCode - 6-digit code
     */
    async pairDevice(host, pairingCode) {
        if (!host || !pairingCode) {
            throw new Error('Host and pairing code are required');
        }
        return this._connectionService.pair(host, pairingCode);
    }

    /**
     * Connect to device (USB أو TCP/IP)
     * @param {string} target - serial لـ USB أو host:port لـ TCP/IP
     * @param {string} friendlyName - Optional friendly name
     */
    async connectDevice(target, friendlyName = null) {
        if (!target) {
            throw new Error('Target is required');
        }

        // Determine connection type
        const connectionType = target.includes(':') ? 'TCPIP' : 'USB';

        // If TCP-IP, execute connection command via ADB
        if (connectionType === 'TCPIP') {
            await this._connectionService.connect(target);
        }

        // Create device entity (بيانات أولية غير معروفة)
        const deviceId = `device-${target.replace(/:/g, '-')}-${Date.now()}`;
        const device = new Device({
            id: deviceId,
            deviceFriendlyName: friendlyName || target,
            model: 'Unknown',
            version: 'Unknown',
            arch: 'Unknown',
            isFavorite: false
        });

        // تسجيل device في الـ Registry
        this._deviceRegistry.registerDevice(device);

        // تحديث الstate التشغيلية
        this._deviceRegistry.updateState(device.id, {
            status: 'connected',
            adbTarget: target,
            connectionType,
            lastSeen: new Date()
        });

        // === جلب معلومات device الحقيقية من ADB (بعد Connection) ===
        try {
            const deviceInfo = await this._connectionService.getDeviceInfo(target);
            console.log('[DeviceOrchestrator] Device info from ADB:', deviceInfo);
            if (deviceInfo) {
                device.updateDetails(deviceInfo.model, deviceInfo.version, deviceInfo.arch);
                this._logger?.info(`Device info updated for ${target}: ${deviceInfo.model} (${deviceInfo.version})`);

                // تحديث الـ runtime state بمعلومات إضافية اختيارية
                this._deviceRegistry.updateState(device.id, {
                    model: deviceInfo.model,
                    version: deviceInfo.version,
                    arch: deviceInfo.arch
                });
                console.log('[DeviceOrchestrator] Device entity updated:', device.toJSON());
            }
        } catch (err) {
            this._logger?.warn(`Could not fetch detailed device info for ${target}: ${err.message}`);
            console.error('[DeviceOrchestrator] Error fetching device info:', err);
            // لا نمنع Connection بسبب فشل جلب التفاصيل، نستمر مع data الافتراضية
        }

        return device;
    }

    /**
     * Starting انعكاس الشاشة لجهاز معين
     * @param {string} deviceId - ID device Registered في الـ Registry
     * @param {Object} options - إعدادات إضافية (fullscreen, bitrate, etc.)
     */
    startStreaming(deviceId, options = {}) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }

        const runtimeState = this._deviceRegistry.getRuntimeState(deviceId);

        // SECURITY: Verify device is connected before allowing streaming
        if (runtimeState?.status !== 'connected') {
            throw new Error(`Device ${deviceId} is not connected (status: ${runtimeState?.status || 'unknown'})`);
        }

        const adbTarget = runtimeState?.adbTarget || device.id;

        return this._scrcpyAdapter.startMirroring(adbTarget, options);
    }

    /**
     * إيقاف انعكاس الشاشة لجهاز معين
     * @param {string} deviceId - ID device
     */
    stopStreaming(deviceId) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }
        const runtimeState = this._deviceRegistry.getRuntimeState(deviceId);
        const adbTarget = runtimeState?.adbTarget || device.id;
        return this._scrcpyAdapter.stopMirroring(adbTarget);
    }

    /**
     * قطع Connect to device معين
     * @param {string} deviceId - ID device
     */
    async disconnectDevice(deviceId) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }

        const runtimeState = this._deviceRegistry.getRuntimeState(deviceId);
        const adbTarget = runtimeState?.adbTarget || device.id;

        // قطع Connection عبر ADB
        await this._connectionService.disconnect(adbTarget);

        // تحديث state device إلى غير متصل
        this._deviceRegistry.updateState(deviceId, {
            status: 'offline',
            lastSeen: new Date()
        });

        return device;
    }

    /**
     * الحصول على جهاز مسجل
     */
    getDevice(deviceId) {
        return this._deviceRegistry.getDevice(deviceId);
    }

    /**
     * الحصول على جميع Devices Registeredة مع حالتها
     */
    getAllDevices() {
        return this._deviceRegistry.getAllDevices().map(device => ({
            device: device.toJSON(),
            runtimeState: this._deviceRegistry.getRuntimeState(device.id)?.toJSON() || null
        }));
   }

    /**
     * تعيين device كمفضل
     * @param {string} deviceId - ID device
     * @param {boolean} isFavorite - state المفضلة
     * @returns {Promise<Object>} device المحدث
     */
    async setDeviceFavorite(deviceId, isFavorite) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }

        // Sync immediately with registry (handles both memory and repository)
        this._deviceRegistry.syncDeviceFavorite(deviceId, isFavorite);

        // Emit event to notify UI about the device state change
        // This will trigger loadDevices() in the renderer
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.send('device:stateChanged', { deviceId, isFavorite });
        }

        return device.toJSON();
    }

    /**
     * تعيين device كموثوق
     * @param {string} deviceId - ID device
     * @param {boolean} isTrusted - state الموثوقية
     * @returns {Promise<Object>} device المحدث
     */
    async setDeviceTrusted(deviceId, isTrusted) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }

        // Update in memory
        device.setTrusted(isTrusted);

        // Sync with repository
        if (this._deviceRepository) {
            try {
                this._deviceRepository.updateTrusted(deviceId, isTrusted);
            } catch (error) {
                console.error('[DeviceOrchestrator] Failed to sync trusted status to repository:', error);
            }
        }

        return device.toJSON();
    }

    /**
     * الحصول على Devices المفضلة
     * @returns {Array} قائمة Devices المفضلة
     */
    getFavoriteDevices() {
        return this._deviceRegistry.getFavoriteDevices().map(device => device.toJSON());
    }

    /**
     * الحصول على Devices الموثوقة
     * @returns {Array} قائمة Devices الموثوقة
     */
    getTrustedDevices() {
        return this._deviceRegistry.getTrustedDevices().map(device => device.toJSON());
    }

    /**
     * تعيين اسم مخصص للجهاز
     * @param {string} deviceId - ID device
     * @param {string} customName - الاسم المخصص
     * @returns {Promise<Object>} device المحدث
     */
    async setDeviceCustomName(deviceId, customName) {
        const device = this._deviceRegistry.getDevice(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }

        // Update in memory
        device.setCustomName(customName);

        // Sync with repository
        if (this._deviceRepository) {
            try {
                this._deviceRepository.updateCustomName(deviceId, customName);
            } catch (error) {
                console.error('[DeviceOrchestrator] Failed to sync custom name to repository:', error);
            }
        }

        return device.toJSON();
    }
}

module.exports = DeviceOrchestrator;