const { app, BrowserWindow } = require('electron');
console.log('app:', typeof app);
console.log('BrowserWindow:', typeof BrowserWindow);
if (app) {
    console.log('SUCCESS: Electron API is accessible');
    process.exit(0);
} else {
    // Try to find alternative access
    const electron = require('electron');
    console.log('electron type:', typeof electron);
    console.log('electron keys:', Object.keys(electron).slice(0,20));
    process.exit(1);
}
