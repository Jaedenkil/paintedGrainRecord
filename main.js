// @ts-check

/**
 * @fileoverview
 * Electron 主进程入口。
 * 负责窗口管理、IPC 桥接和原生功能暴露。
 * 引擎核心运行在渲染进程中。
 */

import { app, BrowserWindow, Menu } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 创建主窗口
 */
function createWindow() {
    // 移除菜单栏（工具栏）
    Menu.setApplicationMenu(null);

    const win = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        webPreferences: {
            // 开启 contextIsolation（安全）
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    // 加载引擎入口 HTML
    win.loadFile(join(__dirname, 'index.html'));

    // 以独立窗口模式自动打开 DevTools 控制台
    win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
