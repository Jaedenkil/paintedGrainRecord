// @ts-check

/**
 * @fileoverview
 * Electron 主进程入口（CommonJS）。
 * 负责窗口管理、IPC 桥接和原生功能暴露。
 * 引擎核心运行在渲染进程中。
 *
 * 注意：此文件使用 CommonJS（.cjs），因为 Electron v41 的
 * ESM 模块解析与 Node.js 的 ESM 加载器不兼容。
 * 引擎核心代码（src/engine/）使用 ESM（.mjs）。
 */

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// ==================== 启动日志 ====================

console.log('╔════════════════════════════════════════╗');
console.log('║  云汲仙田录 · Electron 主进程启动中...   ║');
console.log('╚════════════════════════════════════════╝');
console.log(`[MainProcess] Electron v${process.versions.electron}`);
console.log(`[MainProcess] Chrome  v${process.versions.chrome}`);
console.log(`[MainProcess] Node.js v${process.versions.node}`);
console.log(`[MainProcess] 平台: ${process.platform} ${process.arch}`);
console.log(`[MainProcess] 工作目录: ${__dirname}`);

// ==================== 创建主窗口 ====================

/**
 * 创建主窗口
 */
function createWindow() {
    console.log('[MainProcess] 正在创建主窗口...');

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
    win.loadFile(path.join(__dirname, 'index.html'));
    console.log('[MainProcess] index.html 已加载');

    // 以独立窗口模式自动打开 DevTools 控制台
    win.webContents.openDevTools({ mode: 'detach' });
    console.log('[MainProcess] DevTools 已打开');

    // 监听渲染进程控制台消息（将渲染进程日志转发到主进程）
    win.webContents.on('console-message', (_event, level, message) => {
        // 不做特殊处理，渲染进程日志已直接在 DevTools 中可见
        // 此监听仅用于确保控制台消息通道畅通
    });

    console.log('[MainProcess] 主窗口创建完成');
}

// ==================== 应用生命周期 ====================

app.whenReady().then(() => {
    console.log('[MainProcess] app.whenReady() 触发，启动创建窗口');
    createWindow();
    console.log('[MainProcess] 主进程启动流程完成');
});

app.on('window-all-closed', () => {
    console.log('[MainProcess] 所有窗口已关闭');
    if (process.platform !== 'darwin') {
        console.log('[MainProcess] 退出应用');
        app.quit();
    }
});

app.on('before-quit', () => {
    console.log('[MainProcess] 应用即将退出');
});

app.on('will-quit', () => {
    console.log('[MainProcess] 应用即将彻底退出');
});
