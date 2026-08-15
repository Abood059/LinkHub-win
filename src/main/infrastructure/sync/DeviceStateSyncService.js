// src/main/infrastructure/sync/DeviceStateSyncService.js
'use strict';

/**
 * DeviceStateSyncService
 * 
 * service تجميع state Devices وإرسالها للواجهة بشكل منفصل
 * Reduces IPC load by batching changes and sending them periodically
 */
class DeviceStateSyncService {
    constructor(windowManager, deviceRegistry, options = {}) {
        if (!windowManager) {
            throw new Error('WindowManager is required for DeviceStateSyncService');
        }
        if (!deviceRegistry) {
            throw new Error('DeviceRegistry is required for DeviceStateSyncService');
        }

        this._windowManager = windowManager;
        this._deviceRegistry = deviceRegistry;
        this._interval = options.interval || 1000; // 1 second default
        this._timer = null;
        this._isRunning = false;

        // الstate المجمعة
        this._state = {
            devices: [],
            timestamp: Date.now()
        };

        // الstate السابقة للمقارنة (لإطلاق أحداث منفصلة)
        this._previousState = {
            devices: new Map() // deviceId -> deviceData
        };

        // Dirty flag للإشارة إلى وجود تغييرات
        this._hasChanges = false;
    }

    /**
     * Starting الservice
     */
    start() {
        if (this._isRunning) return;

        this._isRunning = true;

        // تحميل الstate الأولية وإرسالها فوراً
        this._loadInitialDeviceState();
        this._broadcastState();

        // Starting المؤقت Periodic للإرسال
        this._timer = setInterval(() => {
            this._broadcastState();
        }, this._interval);
    }

    /**
     * إيقاف الservice
     */
    stop() {
        if (!this._isRunning) return;

        this._isRunning = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }


    /**
     * الحصول على الstate الحالية
     */
    getState() {
        return {
            devices: this._state.devices,
            timestamp: this._state.timestamp
        };
    }

    // ============================================================================
    // تحديثات Devices
    // ============================================================================

    onDeviceStateChanged(data) {
        // تحديث الstate من DeviceRegistry مع Verify من Changes
        this._loadDeviceState();
        // Send يتم دورياً عبر setInterval
    }

    onDevicePaired(data) {
        // تحديث الstate من DeviceRegistry مع Verify من Changes
        this._loadDeviceState();
        // Send يتم دورياً عبر setInterval
    }

    onDeviceRemoved(data) {
        // تحديث الstate من DeviceRegistry مع Verify من Changes
        this._loadDeviceState();
        // Send يتم دورياً عبر setInterval
    }

    // ============================================================================
    // Internal methods
    // ============================================================================

    /**
     * تحميل الstate الأولية للأجهزة من DeviceRegistry
     */
    _loadInitialDeviceState() {
        this._loadDeviceState();
        this._hasChanges = true;
    }

    /**
     * تحميل state Devices من DeviceRegistry مع Verify من Changes
     */
    _loadDeviceState() {
        const devices = this._deviceRegistry.getAllDevices();
        const newDevices = devices.map(device => {
            const runtimeState = this._deviceRegistry.getRuntimeState(device.id);
            return {
                device: device.toJSON(),
                runtimeState: runtimeState ? runtimeState.toJSON() : {},
                isPersistent: device.isFavorite // isPersistent indicates if device is saved in database
            };
        });

        // Verify من وجود تغييرات
        if (this._hasStateChanged(newDevices)) {
            this._state.devices = newDevices;
            this._hasChanges = true;
        }
    }

    /**
     * Verify من تغير state Devices
     */
    _hasStateChanged(newDevices) {
        // إذا كان العدد مختلف، فهناك تغيير
        if (newDevices.length !== this._state.devices.length) {
            return true;
        }

        // مقارنة كل جهاز
        for (let i = 0; i < newDevices.length; i++) {
            const newDevice = newDevices[i];
            const oldDevice = this._state.devices[i];

            // Verify من ID device
            if (newDevice.device.id !== oldDevice.device.id) {
                return true;
            }

            // Verify من state المفضلة (isFavorite)
            if (newDevice.device.isFavorite !== oldDevice.device.isFavorite) {
                return true;
            }

            // Verify من الstate التشغيلية
            const newRuntime = newDevice.runtimeState || {};
            const oldRuntime = oldDevice.runtimeState || {};

            if (newRuntime.status !== oldRuntime.status ||
                newRuntime.adbTarget !== oldRuntime.adbTarget) {
                return true;
            }
        }

        return false;
    }

    /**
     * إرسال الstate للواجهة
     */
    _broadcastState() {
        if (!this._hasChanges) return;

        const currentState = this.getState();
        
        // إرسال الstate الموحدة
        this._windowManager.broadcast('device:state:update', currentState);
        
        // مقارنة وإطلاق أحداث منفصلة
        this._diffAndEmitDevices(currentState.devices);
        
        this._hasChanges = false;
        this._state.timestamp = Date.now();
        
        // تحديث الstate السابقة
        this._updatePreviousState(currentState);
    }

    // ============================================================================
    // Diffing methods لإطلاق أحداث منفصلة
    // ============================================================================

    /**
     * مقارنة state Devices وإطلاق أحداث منفصلة
     */
    _diffAndEmitDevices(currentDevices) {
        const currentMap = new Map();
        currentDevices.forEach(d => currentMap.set(d.device.id, d));

        // أجهزة جديدة
        for (const [id, deviceData] of currentMap) {
            if (!this._previousState.devices.has(id)) {
                this._windowManager.broadcast('device:added', deviceData);
            }
        }

        // أجهزة محذوفة
        for (const id of this._previousState.devices.keys()) {
            if (!currentMap.has(id)) {
                this._windowManager.broadcast('device:removed', { deviceId: id });
            }
        }

        // أجهزة تغيرت حالتها
        for (const [id, deviceData] of currentMap) {
            const prev = this._previousState.devices.get(id);
            if (prev && this._deviceStateChanged(prev, deviceData)) {
                this._windowManager.broadcast('device:stateChanged', deviceData);
            }
        }
    }

    /**
     * Verify من تغيير state جهاز
     */
    _deviceStateChanged(prev, current) {
        const prevRuntime = prev.runtimeState || {};
        const currRuntime = current.runtimeState || {};
        
        return prevRuntime.status !== currRuntime.status ||
               prevRuntime.adbTarget !== currRuntime.adbTarget ||
               prev.device.isFavorite !== current.device.isFavorite;
    }

    /**
     * تحديث الstate السابقة
     */
    _updatePreviousState(currentState) {
        this._previousState.devices.clear();
        currentState.devices.forEach(d => {
            this._previousState.devices.set(d.device.id, JSON.parse(JSON.stringify(d)));
        });
    }
}

module.exports = DeviceStateSyncService;
