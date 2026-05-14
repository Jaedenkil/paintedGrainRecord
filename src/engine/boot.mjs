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

    // ──────────────────────────────────────────────
    // 渲染管线验证：通过 BlockRenderer 批量构建 2.5D 等轴地图
    // 目的：端到端验证 网格扫描 → 批量纹理加载 → 等轴变换 → 图层分流 → Y-Sort 排序
    // ──────────────────────────────────────────────
    const { BlockRenderer } = await import('./render/BlockRenderer.mjs');

    // ── 多素材平面地图（15×11，展示 14 种可用素材）──
    // 数据格式：gridData[y][x] = blockType | null
    // 布局说明：
    //   左上 → 草地与耕地混合区域
    //   中上 → 砖石建筑区
    //   右上 → 沙地与仙人掌/石柱过渡
    //   左下 → 森林泥土地
    //   中下 → 水塘环绕玉台
    //   右下 → 雪地与特殊材质区
    const demoGrid = [
        //  0         1         2         3         4         5         6         7         8         9         10        11        12        13        14
        ['grass',  'grass',  'grass',  'farm',   'farm',   'farm',   'brick',  'brick',  'brick',  'sand',   'sand',   'sand',   'sand',   'snow',   'snow'  ],
        ['grass',  'grass',  'farm',   'farm',   'farm',   'farm',   'brick',  'brick',  'brick',  'sand',   'sand',   'stone',  'sand',   'snow',   'snow'  ],
        ['grass',  'dirt',   'dirt',   'grass',  'farm',   'brick',  'brick',  'roof',   'roof',   'sand',   'sand',   'stone',  'stone',  'snow',   'cloud' ],
        ['grass',  'dirt',   'dirt',   'grass',  'farm',   'brick',  'roof',   'roof',   'roof',   'plank',  'sand',   'sand',   'stone',  'snow',   'cloud' ],
        ['dirt',   'dirt',   'dirt',   'grass',  'farm',   'brick',  'brick',  'roof',   'brick',  'plank',  'plank',  'jade',   'jade',   'snow',   'cloud' ],
        ['dirt',   'dirt',   'grass',  'grass',  'water',  'water',  'water',  'jade',   'water',  'water',  'water',  'jade',   'jade',   'jade',   'jade'  ],
        ['dirt',   'dirt',   'grass',  'water',  'water',  'jade',   'jade',   'jade',   'jade',   'jade',   'water',  'water',  'jade',   'jade',   'jade'  ],
        ['dirt',   'grass',  'grass',  'water',  'water',  'water',  'jade',   'jade',   'jade',   'water',  'water',  'magma',  'magma',  'magma',  'jade'  ],
        ['grass',  'grass',  'plank',  'plank',  'plank',  'plank',  'water',  'water',  'water',  'water',  'magma',  'magma',  'magma',  'magma',  'cloud' ],
        ['grass',  'grass',  'plank',  'plank',  'plank',  'plank',  'water',  'water',  'water',  'magma',  'magma',  'snow',   'snow',   'cloud',  'cloud' ],
        ['grass',  'grass',  'grass',  'plank',  'plank',  'water',  'water',  'water',  'magma',  'magma',  'snow',   'snow',   'snow',   'cloud',  'cloud' ],
    ];

    const renderer = new BlockRenderer(renderSystem.layerStack);
    await renderer.buildFromGrid(demoGrid, {
        useIsoTransform: true,
        useAssembled: false,
        interpolation: 'nearest',
        onProgress: (pct, label) => {
            emitProgress(0.45 + pct * 0.25, label);
        }
    });

    Logger.info(`✅ BlockRenderer 场景构建完成: ${renderer.blockCount} 个方块`);

    // ──── 初始显示所有方块，便于观察网格与物块贴合效果 ────
    // 物块默认显示，通过 window.__toggleBlocks() 可随时切换显隐。
    renderer.setBlocksVisible(true);

    // ──────────────────────────────────────────────
    // 相机定位 — 将视口中心对准 15×11 大地图的几何中心
    // 等轴坐标变换：screenX = (gx - gy) * TILE_HALF_W, screenY = (gx + gy) * TILE_HALF_H
    // TILE_HALF_W = 12 (ROTATED_SIZE/2), TILE_HALF_H = 6 (TOP_HEIGHT/2)
    // 地图中心网格坐标：(7, 5) ≈ ((15-1)/2, (11-1)/2)
    // ──────────────────────────────────────────────
    const MAP_COLS = 15;
    const MAP_ROWS = 11;
    const TILE_HALF_W = 12;
    const TILE_HALF_H = 6;
    const centerGx = (MAP_COLS - 1) / 2;  // 7
    const centerGy = (MAP_ROWS - 1) / 2;  // 5
    const centerScreenX = (centerGx - centerGy) * TILE_HALF_W;  // 24
    const centerScreenY = (centerGx + centerGy) * TILE_HALF_H; // 72
    renderSystem.camera.moveToImmediate(centerScreenX, centerScreenY);
    Logger.info(`相机已定位至地图中心: screen(${centerScreenX}, ${centerScreenY})`);

    // 暴露到全局（用于 DevTools 交互测试）
    window.__renderer = renderer;

    // ──────────────────────────────────────────────
    // 等轴菱形参考网格 — 调试顶面对齐用
    // ──────────────────────────────────────────────
    const { IsoGridOverlay } = await import('./render/IsoGridOverlay.mjs');

    const app = renderSystem.adapter.getApp();
    const cameraContainer = app.stage.getChildByName('CameraContainer');

    const gridOverlay = new IsoGridOverlay(15, 11, {
        visible: false,     // 默认隐藏，hover 物块时显示高亮
        alpha: 0.35,
        color: 0xd4a847,
        lineWidth: 1.5,
        showCenterDot: false,
        centerDotRadius: 1.5,
        centerDotColor: 0xffd966,
        showVertexDots: true,
        vertexDotRadius: 0.75,
        vertexDotColor: 0x8b6f3c,
        showGlow: true
    });

    cameraContainer.addChild(gridOverlay.container);

    // 绑定 hover 高亮：鼠标移入物块 → 显示对应网格线
    renderer.bindGridHover(gridOverlay);

    // 启用方块点击调试日志：点击任意方块，控制台输出完整调试快照
    renderer.enableBlockDebug();

    // 暴露到全局（用于 DevTools 交互调试）
    window.__gridOverlay = gridOverlay;
    window.__renderer = renderer; // 已在上方定义，此处保留用于统一暴露

    // 便捷调试方法：切换菱形网格显隐
    window.__toggleGrid = () => {
        gridOverlay.visible = !gridOverlay.visible;
        Logger.info(`菱形网格 ${gridOverlay.visible ? '显示' : '隐藏'} （当前 hover 高亮模式已激活）`);
        return gridOverlay.visible;
    };

    // 便捷调试方法：切换物块显隐
    // 控制器设计为轻量开关，仅控制 BlockRenderer 中所有方块的可见性，
    // 不影响菱形网格、辅助元素和 UI 图层。
    /** @type {boolean} */
    let _blocksVisible = false; // 初始隐藏
    window.__toggleBlocks = () => {
        _blocksVisible = !_blocksVisible;
        renderer.setBlocksVisible(_blocksVisible);
        Logger.info(`物块 ${_blocksVisible ? '显示' : '隐藏'}`);
        return _blocksVisible;
    };

    Logger.info('✅ IsoGridOverlay 菱形参考网格已加载（控制台输入 __toggleGrid() 切换可见性）');
    Logger.info('✅ 物块显隐控制器已就绪（控制台输入 __toggleBlocks() 切换方块显隐）');

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
