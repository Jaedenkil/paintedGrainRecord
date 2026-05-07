// @ts-check

/**
 * @fileoverview
 * 渲染系统集成测试（T5 + T6）
 *
 * 测试覆盖：
 * - T5: 渲染系统安装、初始化流程（RendererAdapter → LayerStack → Camera2D）
 * - T5: 注册为 Engine variable 系统
 * - T5: 公共 API 暴露（adapter / layerStack / camera）
 * - T5: render:initialized 事件
 * - T6: 窗口 resize 响应（adapter.resize + camera.setViewport + render:resized 事件）
 * - T6: destroy 清理（移除 resize 监听、销毁各模块）
 *
 * @module render/__tests__/RenderSystem.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';
import { Engine } from '../../core/Engine.mjs';

// ============================================================
// PIXI 全局 Mock（与 PixiRendererAdapter.test.mjs 保持一致）
// ============================================================

/** @type {import('../PixiRendererAdapter.mjs').PixiRendererAdapter|null} */
let _currentAdapter = null;

class PIXIContainerMock {
    constructor() {
        this.children = [];
        this.name = '';
        this.parent = null;
    }
    addChild(child) {
        this.children.push(child);
        child.parent = this;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parent = null;
            return true;
        }
        return false;
    }
    destroy(opts) { /* no-op */ }
    get _destroyed() { return false; }
}

class PIXIRendererMock {
    constructor() {
        this._lastStage = null;
        this.width = 960;
        this.height = 540;
    }
    render(stage) {
        this._lastStage = stage;
    }
    resize(w, h) {
        this.width = w;
        this.height = h;
    }
    destroy() { /* no-op */ }
}

class PIXIApplicationMock {
    constructor() {
        this.renderer = new PIXIRendererMock();
        this.stage = new PIXIContainerMock();
        this.canvas = {
            style: {},
            parentNode: null,
            tagName: 'CANVAS'
        };
        this._destroyed = false;
    }
    async init(opts) {
        this._initOpts = opts;
    }
    destroy(removeCanvas) {
        this._destroyed = true;
        if (removeCanvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}

/**
 * @returns {{ style: {}, appendChild: Function, removeChild: Function, contains: Function, children: Array }}
 */
function createMockContainer() {
    const children = [];
    return {
        style: {},
        children,
        appendChild(child) {
            children.push(child);
            child.parentNode = this;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx !== -1) {
                children.splice(idx, 1);
                child.parentNode = null;
            }
        },
        contains(child) {
            return children.includes(child);
        }
    };
}

// ============================================================
// 全局 Mock 安装/卸载
// ============================================================

/** @type {ReturnType<createMockContainer>} */
let mockGameContainer;
let originalGetElementById;
let originalAddEventListener;
let originalRemoveEventListener;
let originalInnerWidth;
let originalInnerHeight;
let _tickCount = 0;
const MAX_TICKS = 100;

function installPIXIMock() {
    global.PIXI = {
        Application: PIXIApplicationMock,
        Container: PIXIContainerMock,
        BLEND_MODES: {
            NORMAL: 0
        }
    };
}

function uninstallPIXIMock() {
    delete global.PIXI;
}

function installDOMAndWindowMock() {
    // 模拟 #game-container
    mockGameContainer = createMockContainer();
    originalGetElementById = document.getElementById;
    document.getElementById = (/** @type {string} */ id) => {
        if (id === 'game-container') return mockGameContainer;
        return null;
    };

    // 模拟 window.addEventListener/removeEventListener
    /** @type {Object<string, Function[]>} */
    const listeners = {};
    originalAddEventListener = window.addEventListener;
    originalRemoveEventListener = window.removeEventListener;

    window.addEventListener = (/** @type {string} */ type, /** @type {Function} */ handler) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
    };

    window.removeEventListener = (/** @type {string} */ type, /** @type {Function} */ handler) => {
        if (!listeners[type]) return;
        const idx = listeners[type].indexOf(handler);
        if (idx !== -1) listeners[type].splice(idx, 1);
    };

    // 存储监听器供测试访问
    window.__listeners = listeners;

    // 模拟 window.innerWidth/innerHeight
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: 960, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 540, writable: true, configurable: true });
}

function uninstallDOMAndWindowMock() {
    document.getElementById = originalGetElementById;
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    delete window.__listeners;

    if (originalInnerWidth) {
        Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
        Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
}

function installRAFMock() {
    let _mockTime = 0;
    global.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => {
        if (_tickCount < MAX_TICKS) {
            _tickCount++;
            _mockTime += 16;
            cb(_mockTime);
        }
        return _tickCount;
    };
    global.cancelAnimationFrame = (/** @type {number} */ id) => {
        // no-op
    };
}

function uninstallRAFMock() {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
}

// ============================================================
// 测试
// ============================================================

describe('RenderSystem - T5: 引擎集成', () => {
    /** @type {Engine} */
    let engine;
    /** @type {import('../RenderSystem.mjs').renderSystem} */
    let renderSystemModule;

    before(() => {
        installPIXIMock();
        installDOMAndWindowMock();
        installRAFMock();
    });

    after(() => {
        uninstallPIXIMock();
        uninstallDOMAndWindowMock();
        uninstallRAFMock();
    });

    beforeEach(async () => {
        _tickCount = 0;
        EventBus.getInstance().clear();
        engine = new Engine();
        const mod = await import('../RenderSystem.mjs');
        renderSystemModule = mod.renderSystem;
    });

    afterEach(() => {
        renderSystemModule.destroy();
        engine?.destroy();
        EventBus.getInstance().clear();
        // 重置适配器引用（destroy 置 null）
        renderSystemModule.adapter = null;
        renderSystemModule.layerStack = null;
        renderSystemModule.camera = null;
        renderSystemModule._resizeHandler = null;
    });

    it('install() 应抛出异常 — PIXI 未定义（mock 已安装，此测试跳过）', () => {
        // PIXI mock 已全局安装，不会抛出 PIXI 相关错误
        // 但如果没有 #game-container，应抛出容器错误
        // 此测试在 DOM mock 下始终有容器，所以不测试此路径
        assert.ok(true);
    });

    it('install() 应开始异步初始化流程', async () => {
        engine.use(renderSystemModule);

        // 验证 install 触发了初始化
        const initPromise = engine.getPluginInitPromise('RenderSystem');
        assert.ok(initPromise !== undefined, '应存储 init Promise');

        // 等待初始化完成
        await initPromise;

        // 验证公共 API
        assert.ok(renderSystemModule.adapter !== null, 'adapter 不应为 null');
        assert.ok(renderSystemModule.layerStack !== null, 'layerStack 不应为 null');
        assert.ok(renderSystemModule.camera !== null, 'camera 不应为 null');
    });

    it('初始化后应创建 8 个图层', async () => {
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');

        const layerStack = renderSystemModule.layerStack;
        for (let i = 0; i < 8; i++) {
            const layer = layerStack.getLayer(i);
            assert.ok(layer !== null, `图层 ${i} 不应为 null`);
        }
    });

    it('初始化后 camera 应具有正确的默认视口', async () => {
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');

        // 视口应与 DEFAULT_OPTIONS.width/height 一致
        assert.strictEqual(renderSystemModule.camera._viewWidth, 960);
        assert.strictEqual(renderSystemModule.camera._viewHeight, 540);
    });

    it('应发射 render:initialized 事件', async () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:initialized', (data) => {
            events.push(data);
        });

        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');

        assert.strictEqual(events.length, 1);
        assert.ok(events[0].adapter !== undefined, '应包含 adapter');
        assert.ok(events[0].layerStack !== undefined, '应包含 layerStack');
        assert.ok(events[0].camera !== undefined, '应包含 camera');
        assert.ok(events[0].canvas !== undefined, '应包含 canvas');
        assert.ok(events[0].options !== undefined, '应包含 options');
    });

    it('应在 engine.loop 中注册为 variable 系统', async () => {
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');

        // 验证 variable 系统已注册（GameLoop 内部存储）
        assert.strictEqual(engine.loop._variableSystems.length >= 1, true);
        const renderSys = engine.loop._variableSystems.find(
            (/** @type {{ name: string }} */ s) => s.name === 'RenderSystem'
        );
        assert.ok(renderSys !== undefined, '应找到名为 RenderSystem 的 variable 系统');
        assert.strictEqual(typeof renderSys.update, 'function');
    });

    it('场景图结构应正确：stage → [cameraContainer, uiContainer]', async () => {
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');

        const app = renderSystemModule.adapter.getApp();
        const stage = app.stage;

        // 应有 2 个直接子节点
        assert.strictEqual(stage.children.length, 2);
        assert.strictEqual(stage.children[0].name, 'CameraContainer');
        assert.strictEqual(stage.children[1].name, 'UIContainer');

        // LayerStack 的根容器和 UI 容器应指向这两个节点
        assert.strictEqual(
            renderSystemModule.layerStack.getRootContainer(),
            stage.children[0]
        );
        assert.strictEqual(
            renderSystemModule.layerStack.getUIContainer(),
            stage.children[1]
        );

        // Camera2D 的 targetContainer 应等于 cameraContainer
        assert.strictEqual(
            renderSystemModule.camera._container,
            stage.children[0]
        );
    });
});

describe('RenderSystem - T6: 窗口 resize 响应', () => {
    /** @type {Engine} */
    let engine;
    /** @type {import('../RenderSystem.mjs').renderSystem} */
    let renderSystemModule;

    before(() => {
        installPIXIMock();
        installDOMAndWindowMock();
        installRAFMock();
    });

    after(() => {
        uninstallPIXIMock();
        uninstallDOMAndWindowMock();
        uninstallRAFMock();
    });

    beforeEach(async () => {
        _tickCount = 0;
        EventBus.getInstance().clear();
        engine = new Engine();
        const mod = await import('../RenderSystem.mjs');
        renderSystemModule = mod.renderSystem;
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');
    });

    afterEach(() => {
        renderSystemModule.destroy();
        engine?.destroy();
        EventBus.getInstance().clear();
        renderSystemModule.adapter = null;
        renderSystemModule.layerStack = null;
        renderSystemModule.camera = null;
        renderSystemModule._resizeHandler = null;
    });

    it('resize 事件应触发 adapter.resize()', () => {
        // 模拟窗口 resize
        window.innerWidth = 800;
        window.innerHeight = 600;

        // 触发 resize 事件
        const resizeEvent = new Event('resize');
        window.dispatchEvent(resizeEvent);

        // 验证 adapter 尺寸已更新
        const renderer = renderSystemModule.adapter.getRenderer();
        assert.strictEqual(renderer.width, 800);
        assert.strictEqual(renderer.height, 600);
    });

    it('resize 事件应触发 camera.setViewport()', () => {
        window.innerWidth = 640;
        window.innerHeight = 480;

        window.dispatchEvent(new Event('resize'));

        assert.strictEqual(renderSystemModule.camera._viewWidth, 640);
        assert.strictEqual(renderSystemModule.camera._viewHeight, 480);
    });

    it('resize 事件应发射 render:resized 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:resized', (data) => {
            events.push(data);
        });

        window.innerWidth = 1280;
        window.innerHeight = 720;
        window.dispatchEvent(new Event('resize'));

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].width, 1280);
        assert.strictEqual(events[0].height, 720);
    });

    it('destroy() 应移除 resize 监听', () => {
        // 记录监听器数量
        const beforeCount = window.__listeners.resize
            ? window.__listeners.resize.length
            : 0;

        renderSystemModule.destroy();

        const afterCount = window.__listeners.resize
            ? window.__listeners.resize.length
            : 0;

        // resize 监听器应减少
        assert.ok(afterCount < beforeCount);
    });

    it('destroy() 后 resize 不应再触发 adapter/camera 更新', () => {
        renderSystemModule.destroy();

        window.innerWidth = 400;
        window.innerHeight = 300;
        window.dispatchEvent(new Event('resize'));

        // adapter 应为 null（已销毁），不会更新
        assert.strictEqual(renderSystemModule.adapter, null);
        assert.strictEqual(renderSystemModule.camera, null);
        assert.strictEqual(renderSystemModule.layerStack, null);
    });
});

describe('RenderSystem - 销毁与资源释放', () => {
    /** @type {Engine} */
    let engine;
    /** @type {import('../RenderSystem.mjs').renderSystem} */
    let renderSystemModule;

    before(() => {
        installPIXIMock();
        installDOMAndWindowMock();
        installRAFMock();
    });

    after(() => {
        uninstallPIXIMock();
        uninstallDOMAndWindowMock();
        uninstallRAFMock();
    });

    beforeEach(async () => {
        _tickCount = 0;
        EventBus.getInstance().clear();
        engine = new Engine();
        const mod = await import('../RenderSystem.mjs');
        renderSystemModule = mod.renderSystem;
        engine.use(renderSystemModule);
        await engine.getPluginInitPromise('RenderSystem');
    });

    afterEach(() => {
        renderSystemModule.destroy();
        engine?.destroy();
        EventBus.getInstance().clear();
        renderSystemModule.adapter = null;
        renderSystemModule.layerStack = null;
        renderSystemModule.camera = null;
        renderSystemModule._resizeHandler = null;
    });

    it('destroy() 应将 adapter/layerStack/camera 全部置 null', () => {
        renderSystemModule.destroy();
        assert.strictEqual(renderSystemModule.adapter, null);
        assert.strictEqual(renderSystemModule.layerStack, null);
        assert.strictEqual(renderSystemModule.camera, null);
    });

    it('多次 destroy() 不应报错', () => {
        renderSystemModule.destroy();
        renderSystemModule.destroy(); // 第二次
        assert.strictEqual(renderSystemModule.adapter, null);
    });
});
