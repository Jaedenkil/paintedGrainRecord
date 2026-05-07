// @ts-check

/**
 * @fileoverview
 * 引擎启动引导脚本 - 应用程序的真实入口点。
 *
 * 职责：
 * 1. 打印引擎版本信息和启动横幅
 * 2. 创建 Engine 实例
 * 3. 注册核心插件（渲染系统等）
 * 4. 启动游戏循环
 * 5. 处理全局未捕获异常
 *
 * 这个文件是在 index.html 中通过 `<script type="module">` 加载的。
 * 不要在此文件中引入渲染以外的游戏逻辑模块。
 *
 * @module engine/boot
 */

import { Engine, EngineState } from './core/Engine.mjs';
import { EventBus } from './core/EventBus.mjs';
import { Logger } from './utils/Logger.mjs';

// ==================== 加载进度 UI 控制 ====================

/**
 * 进度步骤定义。
 * 每一步包含进度百分比和描述，在对应操作完成后发射 loading:progress 事件。
 * 百分比值 = 累进，最后一步必须为 1（100%）。
 */
const PROGRESS_STEPS = Object.freeze([
    { pct: 0.00, label: '启动' },
    { pct: 0.15, label: '引擎核心就绪' },
    { pct: 0.30, label: '渲染模块加载' },
    { pct: 0.45, label: '渲染插件注册' },
    { pct: 0.70, label: 'GPU 管线就绪' },
    { pct: 0.90, label: '游戏循环启动' },
    { pct: 1.00, label: '加载完成' }
]);

const eventBus = EventBus.getInstance();

/**
 * 发射加载进度事件，更新标题下方细线宽度。
 * @param {number} pct - 0~1 的进度值
 * @param {string} [label] - 日志标签
 */
function emitProgress(pct, label) {
    eventBus.emit('loading:progress', { percent: pct });
    if (label) Logger.info(`[进度] ${(pct * 100).toFixed(0)}% — ${label}`);
}

// 预先设置进度 DOM 监听（在首次 emit 之前）
const progressFill = document.getElementById('loading-progress');
eventBus.on('loading:progress', ({ percent }) => {
    if (progressFill) {
        progressFill.style.width = `${(percent * 100).toFixed(1)}%`;
    }
});

// ==================== 启动横幅 ====================

Logger.info('╔════════════════════════════════════════╗');
Logger.info('║       云汲仙田录 · PaintedGrainEngine   ║');
Logger.info('║       天道初启 · 万象更新               ║');
Logger.info('╚════════════════════════════════════════╝');

// ==================== 创建引擎实例 ====================

const engine = new Engine();
Logger.info(`引擎实例已创建 (${engine.info.name} v${engine.info.version})`);
emitProgress(PROGRESS_STEPS[1].pct, PROGRESS_STEPS[1].label);

// ==================== 全局异常兜底 ====================

/**
 * 全局未捕获异常处理
 * 确保任何未预期的错误都能在控制台看到
 */
window.addEventListener('error', (event) => {
    Logger.error('[全局] 未捕获的错误:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('[全局] 未处理的 Promise 拒绝:', event.reason);
});

// ==================== 注册渲染系统插件 ====================

try {
    const { renderSystem } = await import('./render/RenderSystem.mjs');
    emitProgress(PROGRESS_STEPS[2].pct, PROGRESS_STEPS[2].label);

    engine.use(renderSystem);
    emitProgress(PROGRESS_STEPS[3].pct, PROGRESS_STEPS[3].label);

    // 等待渲染系统初始化完成
    const renderInitPromise = engine.getPluginInitPromise('RenderSystem');
    if (renderInitPromise) {
        await renderInitPromise;
        Logger.info('渲染系统初始化完成');
    }
    emitProgress(PROGRESS_STEPS[4].pct, PROGRESS_STEPS[4].label);
} catch (err) {
    Logger.error('渲染系统注册/初始化失败:', err);
    throw err;
}

// ==================== 启动引擎 ====================

engine.start();
Logger.info('引擎已启动，游戏循环开始运行');
emitProgress(PROGRESS_STEPS[5].pct, PROGRESS_STEPS[5].label);

// ==================== 暴露引擎到全局（仅用于 DevTools 调试） ====================

if (import.meta.env?.MODE === 'development' || true) {
    window.__engine = engine;
    Logger.info('引擎实例已暴露到 window.__engine（开发调试用）');
}

// ==================== 完成加载，触发淡出 ====================

emitProgress(PROGRESS_STEPS[6].pct, PROGRESS_STEPS[6].label);

// 短暂停顿让进度条动画走完，然后淡出遮罩
await new Promise(resolve => setTimeout(resolve, 400));

const loadingOverlay = document.getElementById('loading-overlay');
if (loadingOverlay) {
    loadingOverlay.classList.add('hidden');
    Logger.info('加载遮罩已隐藏');
}

// 移除进度监听（不再需要）
eventBus.off('loading:progress');

export { engine };
