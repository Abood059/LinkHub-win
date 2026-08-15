'use strict';

const { app } = require('electron');
const ApplicationBootstrap = require('./bootstrap/ApplicationBootstrap');
const container = require('./bootstrap/container');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

let bootstrap = null;
// Flag to prevent duplication and infinite loop
let isCleanedUp = false; 

// This method will be called when Electron has finished initialization and is ready to create browser windows.
app.whenReady().then(async () => {
    try {
        bootstrap = new ApplicationBootstrap();
        await bootstrap.run();
    } catch (error) {
        app.quit();
    }
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On macOS, re-create a window when the dock icon is clicked and no windows are open.
app.on('activate', () => {
    if (bootstrap && bootstrap.getWindowManager()) {
        const mainWindow = bootstrap.getWindowManager().getWindow('main');
        if (!mainWindow) {
            bootstrap.createMainWindow();
        } else {
            mainWindow.show();
        }
    }
});

// Graceful shutdown: terminate all managed processes before quitting.
app.on('before-quit', async (event) => {
    // If cleanup was done previously, allow app to exit immediately without interception
    if (isCleanedUp) {
        return;
    }

    // Prevent temporary auto-close to allow time for async operations
    event.preventDefault();
    
    try {
        const processManager = container.resolve('processManager');
        if (processManager && typeof processManager.terminateAll === 'function') {
            await processManager.terminateAll();
        }

        const dbManager = container.resolve('databaseManager');
        if (dbManager && typeof dbManager.close === 'function') {
            await dbManager.close();
        }

        const errorService = container.resolve('errorCentralService');
        if (errorService && typeof errorService.flush === 'function') {
            await errorService.flush();
        }

    } catch (err) {
        // Error during shutdown
    } finally {
        // Raise flag that cleanup is complete
        isCleanedUp = true;
        // Now call app.quit() safely, when before-quit event fires again it will find isCleanedUp = true and exit immediately
        app.quit();
    }
});