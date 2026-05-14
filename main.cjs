// @ts-check

/**
 * @fileoverview
 * Electron 主进程入口（CommonJS）。
 * 负责窗口管理、IPC 桥接和原生功能暴露。
 * 引擎核心运行在渲染进程中。
 *
 * 注意：此文件使用 CommonJS（.cjs），因为旧版 Electron 的
 * ESM 模块解析与 Node.js 的 ESM 加载器不兼容。
 * 引擎核心代码（src/engine/）使用 ESM（.mjs）。
 */

const path = require('path');

// ==================== Electron API 获取 ====================
// Electron v28 的模块拦截在某些环境中可能不工作（返回路径字符串）。
// 使用安全的 try-catch 回退策略，绝不会因原生绑定失败而崩溃。

/** @type {import('electron') | null} */
let electron = null;
try {
    const electronModule = require('electron');
    // 如果返回的是字符串（路径），说明模块拦截失败
    if (typeof electronModule === 'string') {
        console.warn(`[MainProcess] require('electron') 返回路径字符串: ${electronModule}`);
        console.warn('[MainProcess] 尝试通过原生绑定获取 API...');
        // 安全地尝试原生绑定（必须包裹在 try-catch 中，某些环境下会崩溃）
        try {
            // @ts-ignore - _linkedBinding 是 Electron 内部 API
            const binding = process._linkedBinding;
            if (typeof binding === 'function') {
                electron = {
                    app: binding('electron_browser_app') || binding('app'),
                    BrowserWindow: binding('electron_browser_base_window') || binding('electron_browser_window'),
                    Menu: binding('electron_browser_menu'),
                };
            }
        } catch (bindingErr) {
            console.error(`[MainProcess] 原生绑定获取失败:`, bindingErr.message);
            electron = null;
        }
    } else {
        // 正常的模块拦截生效
        electron = electronModule;
        console.log('[MainProcess] require(electron) 成功获取 API 对象');
    }
} catch (e) {
    console.error(`[MainProcess] require(electron) 失败: ${e.message}`);
    electron = null;
}

const app = electron?.app;
const BrowserWindow = electron?.BrowserWindow;
const Menu = electron?.Menu;

// ==================== 启动日志 ====================

if (!app || !BrowserWindow) {
    console.error('╔══════════════════════════════════════════════════════╗');
    console.error('║  错误：无法获取 Electron 主进程 API！               ║');
    console.error('║  请确保在 Electron 环境中运行此程序。                ║');
    console.error('║  运行方式: npx electron .                           ║');
    console.error('╚══════════════════════════════════════════════════════╝');
    process.exit(1);
}

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
