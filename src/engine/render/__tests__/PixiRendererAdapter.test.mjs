// @ts-check

/**
 * @fileoverview
 * PixiRendererAdapter 单元测试
 *
 * 测试覆盖：
 * - 适配器继承自 RendererAdapter
 * - init() 正确创建 PIXI Application 并挂载 canvas
 * - render() 调用底层渲染器
 * - resize() 更新尺寸
 * - destroy() 释放资源
 * - PIXI 不可用时抛出错误
 * - 发射 render:initialized 事件
 *
 * @module render/__tests__/PixiRendererAdapter.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';

// ============================================================
// PIXI 全局 Mock
// ============================================================

/** @type {PIXIApplicationMock|null} */
let mockApp = null;

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
        // 使用 mock canvas 对象，避免 Node.js 无 DOM 环境的问题
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

/** @type {typeof PIXIApplicationMock|null} */
let SavedPIXI = null;

/**
 * 模拟的 HTMLElement，替代 document.createElement
 * @returns {{ style: {}, appendChild: Function, removeChild: Function, contains: Function }}
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

function installPIXIMock() {
    SavedPIXI = /** @type {any} */ (global).PIXI;
    mockApp = new PIXIApplicationMock();

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
    mockApp = null;
}

// ============================================================
// 测试
// ============================================================

describe('PixiRendererAdapter - 初始化', () => {
    /** @type {import('../PixiRendererAdapter.mjs').PixiRendererAdapter} */
    let adapter;
    /** @type {ReturnType<createMockContainer>} */
    let container;

    before(() => {
        installPIXIMock();
    });

    after(() => {
        uninstallPIXIMock();
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        container = createMockContainer();
    });

    afterEach(async () => {
        EventBus.getInstance().clear();
        if (adapter) {
            await adapter.destroy();
        }
    });

    it('应继承自 RendererAdapter', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        const { RendererAdapter } = await import('../RendererAdapter.mjs');
        adapter = new PixiRendererAdapter();
        assert.ok(adapter instanceof RendererAdapter);
    });

    it('init() 应创建 PIXI Application 并挂载 canvas', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();

        assert.strictEqual(adapter.isInitialized, false);
        await adapter.init(container, {
            width: 960,
            height: 540,
            backgroundColor: 0x1a1a2e,
            antialias: false,
            roundPixels: true
        });

        assert.strictEqual(adapter.isInitialized, true);
        const canvas = adapter.getCanvas();
        assert.ok(canvas !== null, 'canvas 不应为 null');
        assert.strictEqual(canvas.tagName, 'CANVAS', '应返回类似 canvas 的对象');
        assert.strictEqual(container.children.length, 1);
        assert.strictEqual(container.children[0], canvas);
    });

    it('init() 应发射 render:adapter-ready 事件', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();

        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:adapter-ready', (data) => {
            events.push(data);
        });

        await adapter.init(container);

        assert.strictEqual(events.length, 1);
        assert.ok(events[0].renderer !== undefined);
        assert.ok(events[0].stage !== undefined);
        assert.ok(events[0].canvas !== undefined);
        assert.ok(events[0].options !== undefined);
    });

    it('重复 init() 应被忽略', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();

        await adapter.init(container);
        const canvas1 = adapter.getCanvas();

        await adapter.init(container); // 第二次
        const canvas2 = adapter.getCanvas();

        assert.strictEqual(canvas1, canvas2, '重复 init 不应创建新 canvas');
    });
});

describe('PixiRendererAdapter - 渲染与操纵', () => {
    /** @type {import('../PixiRendererAdapter.mjs').PixiRendererAdapter} */
    let adapter;
    /** @type {ReturnType<createMockContainer>} */
    let container;

    before(() => {
        installPIXIMock();
    });

    after(() => {
        uninstallPIXIMock();
    });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = createMockContainer();
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();
        await adapter.init(container);
    });

    afterEach(async () => {
        EventBus.getInstance().clear();
        if (adapter) {
            await adapter.destroy();
        }
    });

    it('render() 应调用底层渲染器', () => {
        const stage = new PIXIContainerMock();
        adapter.render(stage);
        assert.strictEqual(
            adapter.getRenderer()._lastStage,
            stage
        );
    });

    it('resize() 应更新渲染器尺寸', () => {
        adapter.resize(640, 360);
        const renderer = adapter.getRenderer();
        assert.strictEqual(renderer.width, 640);
        assert.strictEqual(renderer.height, 360);
    });

    it('resize() 应发射 render:adapter-resized 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:adapter-resized', (data) => {
            events.push(data);
        });

        adapter.resize(800, 600);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].width, 800);
        assert.strictEqual(events[0].height, 600);
    });

    it('getRenderer() 应返回底层渲染器', () => {
        const renderer = adapter.getRenderer();
        assert.ok(renderer !== null);
        assert.strictEqual(typeof renderer.render, 'function');
    });

    it('getCanvas() 应返回 Canvas 元素', () => {
        const canvas = adapter.getCanvas();
        assert.ok(canvas !== null, 'canvas 不应为 null');
        assert.strictEqual(canvas.tagName, 'CANVAS', '应返回类似 canvas 的对象');
    });

    it('getApp() 应返回 PIXI Application 实例', () => {
        const app = adapter.getApp();
        assert.ok(app instanceof PIXIApplicationMock);
    });

    it('getStage() 应返回舞台根节点', () => {
        const stage = adapter.getStage();
        assert.ok(stage instanceof PIXIContainerMock);
    });
});

describe('PixiRendererAdapter - 销毁', () => {
    /** @type {import('../PixiRendererAdapter.mjs').PixiRendererAdapter} */
    let adapter;
    /** @type {ReturnType<createMockContainer>} */
    let container;

    before(() => {
        installPIXIMock();
    });

    after(() => {
        uninstallPIXIMock();
    });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = createMockContainer();
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();
        await adapter.init(container);
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('destroy() 应释放资源并标记未初始化', async () => {
        await adapter.destroy();
        assert.strictEqual(adapter.isInitialized, false);
        assert.strictEqual(adapter.getRenderer(), null);
        assert.strictEqual(adapter.getCanvas(), null);
        assert.strictEqual(adapter.getApp(), null);
    });

    it('destroy() 应从容器中移除 canvas', async () => {
        const canvas = adapter.getCanvas();
        assert.ok(container.contains(canvas));

        await adapter.destroy();
        assert.ok(!container.contains(canvas));
    });

    it('重复 destroy() 不应报错', async () => {
        await adapter.destroy();
        await adapter.destroy(); // 第二次
        assert.strictEqual(adapter.isInitialized, false);
    });
});

describe('PixiRendererAdapter - 初始化前状态', () => {
    /** @type {import('../PixiRendererAdapter.mjs').PixiRendererAdapter} */
    let adapter;

    before(() => {
        installPIXIMock();
    });

    after(() => {
        uninstallPIXIMock();
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('未初始化时 render() 应抛出错误', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();
        assert.throws(() => {
            adapter.render(null);
        }, /未初始化/);
    });

    it('未初始化时 getRenderer() 应返回 null', async () => {
        const { PixiRendererAdapter } = await import('../PixiRendererAdapter.mjs');
        adapter = new PixiRendererAdapter();
        assert.strictEqual(adapter.getRenderer(), null);
    });
});
