// @ts-check

/**
 * @fileoverview
 * 渲染系统插件 - 引擎渲染管线的初始化与管理。
 *
 * 职责：
 * - 管理渲染管线生命周期（初始化、调整大小、销毁）
 * - 编排初始化顺序：RendererAdapter → LayerStack → Camera2D
 * - 注册为 GameLoop 的 variable 系统
 * - 暴露公共 API：adapter / layerStack / camera
 * - 处理窗口 resize 事件（T6）
 *
 * 场景图结构：
 * ```
 * stage
 *   ├── cameraContainer (Layer 0-6, 受 Camera2D 变换)
 *   └── uiContainer (Layer 7, 固定不动)
 * ```
 *
 * 每帧渲染流程：
 * 1. camera.update(dt) — 更新相机平滑跟随
 * 2. adapter.render(stage) — 渲染整帧
 *
 * 设计原则：
 * - 不直接引用任何游戏逻辑模块，通过 EventBus 通信
 * - PixiJS 通过 CDN 加载为全局变量 `window.PIXI`
 * - 遵循"引擎核心不依赖第三方库"原则，PixiJS 仅限 render/ 目录
 *
 * @module render/RenderSystem
 */

import { PixiRendererAdapter } from './PixiRendererAdapter.mjs';
import { LayerStack } from './LayerStack.mjs';
import { Camera2D } from './Camera2D.mjs';
import { SortManager, DEFAULT_LAYER_TYPES } from './SortManager.mjs';
import { SceneGraph } from './SceneGraph.mjs';
import { getErrorMessage } from '../utils/error.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('RenderSystem');

/**
 * 渲染系统配置默认值
 * @type {Readonly<RenderSystemOptions>}
 */
const DEFAULT_OPTIONS = Object.freeze({
    width: 960,
    height: 540,
    backgroundColor: 0x0d0d0d,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    cameraSmoothing: 0.1,
    cameraMinZoom: 0.5,
    cameraMaxZoom: 3.0
});

/**
 * 渲染系统配置
 * @typedef {Object} RenderSystemOptions
 * @property {number} [width=960] - 画布宽度（像素）
 * @property {number} [height=540] - 画布高度（像素）
 * @property {number} [backgroundColor=0x1a1a2e] - 背景色（十六进制）
 * @property {boolean} [antialias=false] - 是否抗锯齿（像素风格应关闭）
 * @property {boolean} [roundPixels=true] - 像素对齐（防止子像素偏移模糊）
 * @property {number} [resolution=1] - 分辨率倍数
 * @property {number} [cameraSmoothing=0.1] - 相机平滑系数
 * @property {number} [cameraMinZoom=0.5] - 相机最小缩放
 * @property {number} [cameraMaxZoom=3.0] - 相机最大缩放
 */

/**
 * 渲染系统插件
 *
 * 通过 `engine.use(renderSystem)` 注册到引擎。
 * 初始化后自动编排：RendererAdapter → LayerStack → Camera2D。
 *
 * @example
 * ```javascript
 * import { Engine } from '../core/Engine.mjs';
 * import { renderSystem } from './RenderSystem.mjs';
 *
 * const engine = new Engine();
 * engine.use(renderSystem);
 * engine.start();
 *
 * // 初始化完成后可访问公共 API
 * renderSystem.adapter    // PixiRendererAdapter 实例
 * renderSystem.layerStack // LayerStack 实例
 * renderSystem.camera     // Camera2D 实例
 * ```
 */
export const renderSystem = {
    name: 'RenderSystem',

    /** @type {PixiRendererAdapter|null} */
    adapter: null,

    /** @type {LayerStack|null} */
    layerStack: null,

    /** @type {Camera2D|null} */
    camera: null,

    /** @type {SortManager|null} */
    sortManager: null,

    /** @type {SceneGraph|null} */
    sceneGraph: null,

    /**
     * 窗口 resize 绑定的处理函数（用于取消监听）
     * @private @type {((evt: UIEvent) => void)|null}
     */
    _resizeHandler: null,

    /**
     * 安装渲染系统（引擎插件接口）
     *
     * 异步初始化流程：
     * 1. 校验 PIXI 全局和 #game-container
     * 2. 创建 PixiRendererAdapter 并初始化
     * 3. 创建 cameraContainer + uiContainer 作为舞台子节点
     * 4. 创建 LayerStack（图层管理栈）
     * 5. 创建 Camera2D（相机系统）
     * 6. 注册为 GameLoop variable 系统
     * 7. 绑定窗口 resize 事件（T6）
     * 8. 发射 render:initialized 事件
     *
     * @param {import('../core/Engine.mjs').Engine} engine - 引擎实例
     * @throws {Error} PIXI 未加载或 #game-container 不存在
     */
    install(engine) {
        log.info('正在安装渲染系统...');

        // -------- 1. 校验依赖 --------
        if (typeof PIXI === 'undefined') {
            throw new Error(
                '[RenderSystem] PIXI 全局对象不存在。请确保 pixi.js 脚本在渲染系统之前加载。'
            );
        }
        log.info('PIXI 全局对象校验通过');

        // -------- 2. 获取 DOM 容器 --------
        const container = document.getElementById('game-container');
        if (!container) {
            throw new Error(
                '[RenderSystem] DOM 容器 #game-container 不存在。'
            );
        }
        log.info('DOM 容器 #game-container 已获取');

        const opts = { ...DEFAULT_OPTIONS };

        // -------- 3. 创建 PixiRendererAdapter 并初始化 --------
        const adapter = new PixiRendererAdapter();

        /** @type {Promise<void>} */
        const initPromise = adapter.init(container, {
            width: opts.width,
            height: opts.height,
            backgroundColor: opts.backgroundColor,
            antialias: opts.antialias,
            roundPixels: opts.roundPixels,
            resolution: opts.resolution
        }).then(() => {
            // getApp() 返回类型包含 null（destroy 后），但在 .then() 回调中保证已初始化
            const app = /** @type {import('pixi.js').Application} */ (adapter.getApp());

            // -------- 4. 创建场景容器结构 --------
            // stage
            //   ├── cameraContainer (Layer 0-6, 受相机变换影响)
            //   └── uiContainer (Layer 7, 固定不动)
            const cameraContainer = new PIXI.Container();
            cameraContainer.name = 'CameraContainer';
            cameraContainer.eventMode = 'static'; // 允许事件传递到子节点（T12 网格点击交互必需）
            app.stage.addChild(cameraContainer);

            const uiContainer = new PIXI.Container();
            uiContainer.name = 'UIContainer';
            app.stage.addChild(uiContainer);

            // -------- 5. 创建 LayerStack --------
            const layerStack = new LayerStack(cameraContainer, uiContainer);

            // -------- 6. 创建 Camera2D --------
            const camera = new Camera2D(cameraContainer, {
                smoothing: opts.cameraSmoothing,
                minZoom: opts.cameraMinZoom,
                maxZoom: opts.cameraMaxZoom,
                viewWidth: opts.width,
                viewHeight: opts.height
            });

            // 暴露公共引用
            renderSystem.adapter = adapter;
            renderSystem.layerStack = layerStack;
            renderSystem.camera = camera;

            // -------- 7. 创建 SortManager（T10 Y-Sort）--------
            const sortManager = new SortManager(layerStack);

            // 应用层类型：静态层关闭自动排序，动态层保持自动排序
            for (let i = 0; i < DEFAULT_LAYER_TYPES.length; i++) {
                layerStack.setLayerType(i, DEFAULT_LAYER_TYPES[i]);
            }

            renderSystem.sortManager = sortManager;

            // -------- 8. 创建 SceneGraph（T11）--------
            const sceneGraph = new SceneGraph(layerStack, sortManager);
            renderSystem.sceneGraph = sceneGraph;

            // -------- 9. 注册为 variable 系统（含 Y-Sort）--------
            engine.loop.addSystem({
                type: 'variable',
                name: 'RenderSystem',
                update: (dt) => {
                    camera.update(dt);
                    sortManager.tick();         // Y-Sort 排序（T10）
                    adapter.render(app.stage);
                }
            });

            // -------- 9. 绑定窗口 resize 事件（T6）--------
            /** @param {UIEvent} _evt */
            const resizeHandler = (_evt) => {
                const w = window.innerWidth;
                const h = window.innerHeight;
                adapter.resize(w, h);
                camera.setViewport(w, h);
                engine.eventBus.emit('render:resized', {
                    width: w,
                    height: h
                });
            };

            window.addEventListener('resize', resizeHandler);
            renderSystem._resizeHandler = resizeHandler;

            // -------- 9. 发射初始化完成事件 --------
            engine.eventBus.emit('render:initialized', {
                adapter,
                layerStack,
                camera,
                canvas: adapter.getCanvas(),
                options: opts
            });
log.info(`初始化完成 (${opts.width}×${opts.height})`);

        }).catch((/** @type {unknown} */ err) => {
            log.error('初始化失败:', getErrorMessage(err));
            throw err;
        });

        // 存储 Promise 供外部等待初始化完成
        engine.registerPluginInitPromise('RenderSystem', initPromise);
    },

    /**
     * 销毁渲染系统，释放所有资源
     *
     * 清理顺序：
     * 1. 移除 window.resize 监听
     * 2. 销毁相机（取消跟随、释放容器引用）
     * 3. 销毁图层栈（清空所有图层）
     * 4. 销毁适配器（移除 canvas、销毁 PIXI 应用）
     */
    destroy() {
        // 移除 resize 监听
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
// 销毁场景图管理器（T11）
if (this.sceneGraph) {
    this.sceneGraph.destroy();
    this.sceneGraph = null;
}

// 销毁排序管理器
if (this.sortManager) {
    this.sortManager.destroy();
    this.sortManager = null;
}


        // 销毁相机
        if (this.camera) {
            this.camera.destroy();
            this.camera = null;
        }

        // 销毁图层栈
        if (this.layerStack) {
            this.layerStack.destroy();
            this.layerStack = null;
        }

        // 销毁适配器
        if (this.adapter) {
            this.adapter.destroy();
            this.adapter = null;
        }
    }
};
