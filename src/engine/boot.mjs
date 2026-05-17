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
    // 渲染管线验证：通过 VoxelWorld + SimpleWorldGenerator 构建 2.5D 等轴场景
    // 目的：端到端验证 体素数据层 → 网格扫描 → 批量纹理加载 → 等轴变换 → 图层分流 → Y-Sort 排序
    // ──────────────────────────────────────────────
    const { BlockRenderer } = await import('./render/BlockRenderer.mjs');
    const { buildVoxelDemoScene } = await import('./voxel/VoxelDemoScene.mjs');

    const renderer = new BlockRenderer(renderSystem.layerStack);

    // 构建体素世界演示场景（构建逻辑保持不动）
    const { gridWidth, gridHeight } = await buildVoxelDemoScene(renderer, {
        seed: 42,
        terrainHeight: 1,
        terrainBlockId: 1,  // grass
        radius: 1           // 3×3 Chunk = 48×48 网格
    });

    Logger.info(`✅ VoxelDemoScene 场景构建完成: ${renderer.blockCount} 个方块, ${gridWidth}×${gridHeight}`);

    // ── 屏幕→等轴坐标逆变换（鼠标拾取核心） ──
    const { ScreenToWorld } = await import('./input/ScreenToWorld.mjs');
    const screenToWorld = new ScreenToWorld(renderSystem.camera);
    renderer.setScreenToWorld(screenToWorld);
    Logger.info('✅ ScreenToWorld 逆变换已接入，点击方块可拾取/移除');

    // ── 视锥体裁剪（性能优化：仅渲染视口内方块） ──
    const { FrustumCuller } = await import('./render/block/FrustumCuller.mjs');

    /** @private @type {ReturnType<setTimeout>|null} */
    let _cullTimer = null;
    const CULL_DEBOUNCE_MS = 100; // 相机停止移动 100ms 后触发裁剪

    /**
     * 执行视锥体裁剪的内部函数。
     * 通过防抖避免相机平滑移动期间频繁全量遍历。
     */
    const _doCull = () => {
        renderer.cull(renderSystem.camera);
    };

    // 首次场景显示后立即裁剪（Scene.enter 会 setBlocksVisible(true)，之后需要裁剪）
    // 在 scene push 之后执行（见下方）

    // 监听相机移动事件（带防抖）
    engine.eventBus.on('render:camera-moved', () => {
        if (_cullTimer !== null) {
            clearTimeout(_cullTimer);
        }
        _cullTimer = setTimeout(() => {
            _cullTimer = null;
            _doCull();
        }, CULL_DEBOUNCE_MS);
    });

    Logger.info(`✅ 视锥体裁剪已就绪 (防抖 ${CULL_DEBOUNCE_MS}ms)`);

    // ──────────────────────────────────────────────
    // 等轴菱形参考网格 — 调试顶面对齐用
    // ──────────────────────────────────────────────
    const { IsoGridOverlay } = await import('./render/IsoGridOverlay.mjs');

    const app = renderSystem.adapter.getApp();
    const cameraContainer = app.stage.getChildByName('CameraContainer');

    const gridOverlay = new IsoGridOverlay(gridWidth, gridHeight, {
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

    // 绑定 hover + click：ScreenToWorld 逆变换拾取（一次性设置，内部含 hover 高亮）
    renderer.bindGridClick(gridOverlay);

    // 启用方块点击调试日志：点击任意方块，控制台输出完整调试快照（一次性设置）
    renderer.enableBlockDebug();

    // ──────────────────────────────────────────────
    // 注册 VoxelDemoScene 到场景管理器
    // enter() 会自动处理：相机定位 + 显示方块/网格
    // ──────────────────────────────────────────────
    const { VoxelDemoScene } = await import('./voxel/VoxelDemoSceneClass.mjs');

    const demoScene = new VoxelDemoScene({
        renderSystem,
        blockRenderer: renderer,
        gridOverlay,
        gridWidth,
        gridHeight
    });

    engine.scenes.register('voxel-demo', () => demoScene);
    engine.scenes.push('voxel-demo');
    // ↑ push() 触发 Scene.enter(): 相机定位 + setBlocksVisible(true) + gridOverlay.visible = true

    Logger.info(`相机已定位至地图中心: grid(${gridWidth}×${gridHeight})`);

    // ── 首次裁剪：场景进入后立即应用 ──
    // 注意：此时 Scene.enter 已调用 setBlocksVisible(true)，所有方块可见
    // 需要立即裁剪以隐藏视口外方块
    _doCull();
    Logger.info('✅ 首次视锥体裁剪已执行');

    // ── 暴露到全局（用于 DevTools 交互调试） ──
    window.__renderer = renderer;
    window.__screenToWorld = screenToWorld;
    window.__gridOverlay = gridOverlay;

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

    // 便捷调试方法：手动触发裁剪
    window.__cull = () => {
        _doCull();
        Logger.info('手动裁剪完成');
    };

    // 便捷调试方法：查询当前裁剪状态
    window.__cullBounds = () => {
        return renderer._culledBounds;
    };

    // 便捷调试方法：查询可见/总方块数
    window.__blockStats = () => {
        return {
            total: renderer.blockCount,
            visible: renderer.visibleBlockCount,
            hidden: renderer.blockCount - renderer.visibleBlockCount
        };
    };

    Logger.info('✅ IsoGridOverlay 菱形参考网格已加载（控制台输入 __toggleGrid() 切换可见性）');
    Logger.info('✅ 物块显隐控制器已就绪（控制台输入 __toggleBlocks() 切换方块显隐）');
    Logger.info('✅ 裁剪调试: __cull() 手动裁剪, __cullBounds() 查看范围, __blockStats() 统计');

    // ── ECS 全链路诊断台 ──
    // 在 document 上监听 keydown 以便诊断台检测按键状态
    const _diagKeys = new Set();
    document.addEventListener('keydown', (e) => { _diagKeys.add(e.code); });
    document.addEventListener('keyup', (e) => { _diagKeys.delete(e.code); });
    document.addEventListener('blur', () => { _diagKeys.clear(); });

    window.__diagnoseECS = () => {
        const lines = [];
        const push = (label, val) => lines.push(`  ${label.padEnd(22)} ${val}`);

        lines.push('═ ⚡ ECS 全链路诊断报告 ═');
        lines.push('');

        const eng = window.__engine;
        if (!eng) { lines.push('  ❌ window.__engine 不可用'); console.log(lines.join('\n')); return; }

        push('引擎状态', eng.state);
        push('是否运行中', String(eng.isRunning));
        push('GameLoop FPS', `${eng.loop.fps}`);
        push('GameLoop 运行中', String(eng.loop.isRunning));

        // 场景管理器
        const sm = eng.scenes;
        push('场景栈深度', String(sm.depth));
        const currentScene = sm.current;
        if (currentScene) {
            push('当前场景', `${currentScene.name} (active=${currentScene.isActive})`);
            // 尝试访问私有字段（开发诊断用）
            const vds = /** @type {any} */ (currentScene);
            push('ECS World 存在', String(!!vds._world));
            push('InputModule 存在', String(!!vds._inputModule));
            push('__frameCount', String(vds.__frameCount ?? 'N/A'));

            // 按键实时检测（通过 document 上的独立监听）
            const heldKeys = Array.from(_diagKeys).filter(k => k.startsWith('Key') || k.startsWith('Arrow'));
            push('物理按键(实时)', heldKeys.length > 0 ? heldKeys.join(', ') : '(无)');

            if (vds._inputModule) {
                const im = vds._inputModule;
                push('Input 已启动', String(im._started));
                push('KeyW(isDown)', String(im.isDown('move_up')));
                push('KeyA(isDown)', String(im.isDown('move_left')));
                push('KeyS(isDown)', String(im.isDown('move_down')));
                push('KeyD(isDown)', String(im.isDown('move_right')));
            }

            if (vds._world) {
                const w = vds._world;
                push('实体数量', String(w.entityCount));
                const entities = w.query('Position');
                push('Position 实体', `${entities.length} 个 (ID: ${entities.join(', ')})`);
                for (const id of entities) {
                    const pos = w.getComponent(id, 'Position');
                    if (pos) push(`  Entity#${id} pos`, `(${pos.gx}, ${pos.gy}, ${pos.wz}) type=${pos.type}`);
                }
                push('ECS 系统数', String(w._systems?.length ?? '?'));

                // EntityRenderSystem 诊断
                const renderSys = vds._entityRenderSystem;
                if (renderSys) {
                    push('EntityRender 存活', String(!renderSys._destroyed));
                    push('Sprite 映射数', String(renderSys._entitySprites?.size ?? '?'));
                    push('帧计数器', String(renderSys._frameCount));

                    // Sprite 可见性检查
                    const sprEntries = renderSys._entitySprites;
                    if (sprEntries && sprEntries.size > 0) {
                        const sg = renderSys._sceneGraph;
                        for (const [eid, info] of sprEntries) {
                            const node = sg ? sg.get(info.nodeId) : null;
                            if (node) {
                                const c = node.container;
                                const texUrl = (c.texture && c.texture.textureCacheIds && c.texture.textureCacheIds.length > 0)
                                    ? c.texture.textureCacheIds[0] : '?';
                                const texValid = c.texture ? c.texture.valid : false;
                                const tw = c.texture ? c.texture.width : -1;
                                const th = c.texture ? c.texture.height : -1;
                                push(`  Sprite#${info.nodeId}`,
                                    `visible=${c.visible} x=${c.x.toFixed(0)} y=${c.y.toFixed(0)} ` +
                                    `alpha=${c.alpha} tex=${texUrl} (${tw}x${th}, valid=${texValid})`);
                            } else {
                                push(`  Sprite#${info.nodeId}`, '❌ Node not found in SceneGraph');
                            }
                        }
                    }
                }
            }
        } else {
            push('当前场景', '❌ 无活跃场景');
        }

        console.log(lines.join('\n'));
        return lines.join('\n');
    };
    Logger.info('✅ ECS 诊断台已就绪: 控制台输入 __diagnoseECS() 查看');

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
