// src/main/bootstrap/IpcBootstrap.js
'use strict';

/**
 * IpcBootstrap
 * Responsible for Register IPC handlers
 * 
 * Separates IPC integration from DI Container
 */
class IpcBootstrap {
    /**
     * Register IPC handlers from services registered in container
     * @param {BootstrapContainer} container - Service container
     */
    static register(container) {
        const deviceOrchestrator = container.resolve('deviceOrchestrator');
        const downloadOrchestrator = container.resolve('downloadOrchestrator');
        const transferOrchestrator = container.resolve('transferOrchestrator');

        if (!deviceOrchestrator || !downloadOrchestrator || !transferOrchestrator) {
            throw new Error('deviceOrchestrator, downloadOrchestrator, and transferOrchestrator are required for IPC registration');
        }

        const { registerIpcHandlers } = require('../infrastructure/ipc');
        registerIpcHandlers(deviceOrchestrator, downloadOrchestrator, transferOrchestrator);
    }
}

module.exports = IpcBootstrap;
