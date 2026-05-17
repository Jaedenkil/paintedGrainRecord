// @ts-check

/**
 * @fileoverview
 * BlockRenderer 网格→场景桥接器单元测试（T12）
 *
 * 测试覆盖：
 * - 构造与基础属性（blockCount、blockTypes）
 * - 动态添加/移除/查询方块（addBlock / removeBlock / hasBlock / getBlock）
 * - 覆盖模式（相同位置重复 addBlock）
 * - 图层分流逻辑（gz=0 → Layer 1, gz≥1 → Layer 2）
 * - clear 清空场景
 * - destroy 资源释放
 * - _normalizeGrid 网格标准化（2D/3D 自动检测）
 * - 事件订阅与响应
 * - 边界情况：空网格、null 跳过、多次销毁
 *
 * @module render/__tests__/BlockRenderer.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';
import { ScreenToWorld } from '../../input/ScreenToWorld.mjs';

// ============================================================
// PIXI 全局 Mock（与 BlockSprite.test.mjs 保持一致）
// 必须在任何 BlockSprite 模块导入之前同步安装。
// ============================================================

class PIXIContainerMock {
    constructor() {
        this.children = [];
        this.name = '';
        this.parent = null;
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
        this._destroyed = false;
        this.sortableChildren = false;
        this.eventMode = 'none';
        this.cursor = 'default';
        /** @private @type {Object<string, Function[]>} */
        this.hitArea = null;
        this.visible = true;
        this.alpha = 1;
        this.tint = 0xffffff;
        this.rotation = 0;
        this.scale = { x: 1, y: 1, set: (sx, sy) => { this.scale.x = sx; this.scale.y = sy; } };
        this.position = { x: 0, y: 0, set: (px, py) => { this.position.x = px; this.position.y = py; } };
        /** @private @type {Object<string, Function[]>} */
        this._listeners = {};
    }
    addChild(child) {
        this.children.push(child);
        child.parent = this;
        return child;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parent = null;
            return child;
        }
        return null;
    }
    /**
     * 注册事件监听（模拟 PIXI.EventEmitter.on）。
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    on(event, handler) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
        return this;
    }
    /**
     * 移除指定事件的一个监听（模拟 PIXI.EventEmitter.removeListener）。
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    removeListener(event, handler) {
        if (this._listeners[event]) {
            this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        }
        return this;
    }
    /**
     * 移除指定事件的所有监听。
     * @param {string} event
     * @returns {this}
     */
    removeAllListeners(event) {
        if (this._listeners[event]) {
            delete this._listeners[event];
        }
        return this;
    }
    /**
     * 触发事件（测试用，模拟 PIXI 内部事件派发）。
     * @param {string} event
     * @param {...*} args
     * @returns {this}
     */
    emit(event, ...args) {
        if (this._listeners[event]) {
            for (const handler of this._listeners[event]) {
                handler(...args);
            }
        }
        return this;
    }
    destroy(options) {
        this._destroyed = true;
        if (options && options.children) {
            for (const child of this.children) {
                if (typeof child.destroy === 'function') {
                    child.destroy(true);
                }
            }
        }
        this.children = [];
        this._listeners = {};
    }
    getChildByName(name) {
        return this.children.find(c => c.name === name) || null;
    }
}

class PIXISpriteMock extends PIXIContainerMock {
    constructor() {
        super();
        this.anchor = { x: 0, y: 0, set: (ax, ay) => { this.anchor.x = ax; this.anchor.y = ay; } };
        this._texture = null;
        this.position = { x: 0, y: 0, set: (px, py) => { this.position.x = px; this.position.y = py; } };
        this.scale = { x: 1, y: 1, set: (sx, sy) => { this.scale.x = sx; this.scale.y = sy; } };
        this._textureApplied = false;
        this.visible = true;
    }

    set texture(val) {
        this._texture = val;
        this._textureApplied = true;
    }
    get texture() { return this._texture; }
}

/** @type {Object<string, { path: string, _isMock: boolean }>} */
const textureRegistry = {};

// ════════════════════════════════════════════════════════════
// 同步安装 PIXI 全局 Mock
// 必须在任何 import('../BlockSprite.mjs') 之前执行
// ════════════════════════════════════════════════════════════

/**
 * 最小化 Canvas Mock，使 imageDataToPixiTexture 中的
 * document.createElement('canvas') / getContext('2d') / putImageData
 * 在 Node.js 环境中不会崩溃。
 */
class CanvasMock {
    constructor(w, h) {
        this.width = w || 1;
        this.height = h || 1;
    }
    getContext() {
        return {
            putImageData: () => {},
            drawImage: () => {}
        };
    }
    toDataURL() { return ''; }
}

// 模拟全局 document（仅提供 createElement 用于 canvas）
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        createElement(tag) {
            if (tag === 'canvas') return new CanvasMock();
            return {};
        }
    };
}

global.PIXI = {
    Container: PIXIContainerMock,
    Sprite: class extends PIXISpriteMock {
        constructor() { super(); }
    },
    Polygon: class {
        /**
         * @param {...number} points - 多边形顶点坐标
         */
        constructor(...points) {
            this.points = points;
            this.type = 'polygon';
        }
    },
    Texture: {
        from(source) {
            const path = (typeof source === 'string') ? source : 'canvas-source';
            if (!textureRegistry[path]) {
                textureRegistry[path] = { path, _isMock: true, width: 16, height: 16 };
            }
            return textureRegistry[path];
        },
        fromURL(path) {
            if (!textureRegistry[path]) {
                textureRegistry[path] = { path, _isMock: true, width: 16, height: 16 };
            }
            return Promise.resolve(textureRegistry[path]);
        }
    }
};

function uninstallPIXIMock() {
    delete global.PIXI;
}

// 注：BlockSprite.setIsoFaces / setAssembledTexture 内部调用的
// imageDataToPixiTexture 使用 document.createElement('canvas')。
// 全局 document mock（见上）已使这些调用在 Node.js 中正常运行。
// 无需额外原型 mock。

// ============================================================
// LayerStack Mock
// ============================================================

/**
 * 模拟的 LayerStack，用于测试 BlockRenderer 的图层交互。
 * 每个 layer 是一个简单的 PIXIContainerMock。
 */
class LayerStackMock {
    constructor() {
        /** @type {PIXIContainerMock[]} */
        this.layers = [];
        for (let i = 0; i < 8; i++) {
            this.layers.push(new PIXIContainerMock());
        }
        /** @type {PIXIContainerMock} 模拟 rootContainer（cameraContainer） */
        this._rootContainer = new PIXIContainerMock();
        /** @type {Array<{layer: number, child: object, action: string}>} */
        this.history = [];
    }

    /**
     * @param {number} layerIndex
     * @param {object} child
     */
    addToLayer(layerIndex, child) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) {
            throw new Error(`Layer index out of bounds: ${layerIndex}`);
        }
        this.layers[layerIndex].addChild(child);
        this.history.push({ layer: layerIndex, child, action: 'add' });
    }

    /**
     * @param {number} layerIndex
     * @param {object} child
     */
    removeFromLayer(layerIndex, child) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) {
            throw new Error(`Layer index out of bounds: ${layerIndex}`);
        }
        const result = this.layers[layerIndex].removeChild(child);
        this.history.push({ layer: layerIndex, child, action: 'remove' });
        return result;
    }

    /**
     * @param {number} layerIndex
     * @returns {PIXIContainerMock}
     */
    getLayer(layerIndex) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) {
            throw new Error(`Layer index out of bounds: ${layerIndex}`);
        }
        return this.layers[layerIndex];
    }

    /**
     * 获取模拟的 rootContainer（对应相机容器）。
     * @returns {PIXIContainerMock}
     */
    getRootContainer() {
        return this._rootContainer;
    }

    clear() {
        for (const layer of this.layers) {
            layer.children = [];
        }
        this.history = [];
    }

    destroy() {
        for (const layer of this.layers) {
            layer.destroy({ children: true });
        }
        this.layers = [];
        this.history = [];
    }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建模拟的缓存纹理数据对象。
 * 模拟 batchLoadAndTransform 的返回值，
 * 使 BlockRenderer._createAndPlaceBlock 走缓存路径。
 *
 * @returns {{ top: Object, left: Object, right: Object, assembled?: Object }}
 */
function createMockCachedTextures() {
    const makeImageData = (w, h) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
        colorSpace: 'srgb'
    });
    return {
        top: makeImageData(24, 12),
        left: makeImageData(12, 17),
        right: makeImageData(12, 17),
        assembled: makeImageData(36, 29)
    };
}

// ============================================================
// IsoGridOverlay Mock（用于 bindGridClick 测试）
// ============================================================

/**
 * 模拟的 IsoGridOverlay，仅实现 bindGridClick / bindGridHover 所需的接口。
 */
class GridOverlayMock {
    constructor() {
        this.eventMode = 'none';
        this.cursor = 'default';
        /** @private @type {Object<string, Function[]>} */
        this._listeners = {};
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    on(event, handler) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
        return this;
    }

    /**
     * @param {string} event
     * @param {Function} handler
     * @returns {this}
     */
    removeListener(event, handler) {
        if (this._listeners[event]) {
            this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        }
        return this;
    }

    /** @returns {boolean} 是否绑定了指定事件的监听 */
    hasListener(event) {
        return !!(this._listeners[event] && this._listeners[event].length > 0);
    }

    /** @returns {this} */
    highlightCell() { return this; }

    /** @returns {this} */
    clearHighlight() { return this; }

    /** @returns {this} */
    highlightBlockEdges() { return this; }

    /** @returns {this} */
    highlightColumn() { return this; }
}

// ============================================================
// 顶层 Setup / Teardown（在所有 describe 之前执行）
// ============================================================

after(() => {
    uninstallPIXIMock();
});

// ============================================================
// 测试：构造与基础属性
// ============================================================

describe('BlockRenderer - T12: 构造与基础属性', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('new BlockRenderer(layerStack) → 实例非 null, blockCount = 0', () => {
        const renderer = new BlockRenderer(layerStack);

        assert.ok(renderer instanceof BlockRenderer);
        assert.strictEqual(renderer.blockCount, 0);
        assert.deepStrictEqual(renderer.blockTypes, []);
    });

    it('可传入自定义 EventBus 实例', () => {
        const customBus = EventBus.getInstance();
        const renderer = new BlockRenderer(layerStack, customBus);

        assert.ok(renderer instanceof BlockRenderer);
        assert.strictEqual(renderer.blockCount, 0);
    });

    it('不传入 EventBus 应自动使用单例', () => {
        const renderer = new BlockRenderer(layerStack);

        assert.ok(renderer instanceof BlockRenderer);
        assert.strictEqual(renderer.blockCount, 0);
    });

    it('blockTypes 初始为空数组', () => {
        const renderer = new BlockRenderer(layerStack);

        assert.deepStrictEqual(renderer.blockTypes, []);
    });
});

// ============================================================
// 测试：addBlock 动态添加
// ============================================================

describe('BlockRenderer - T12: addBlock 动态添加', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {LayerStackMock} */
    let layerStack;
    /** @type {*} */
    let renderer;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);

        // 注入缓存纹理数据，使 addBlock 走缓存路径（跳过真实图片加载）
        renderer._useIsoTransform = true;
        renderer._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures(),
            'dirt': createMockCachedTextures()
        };
    });

    afterEach(() => {
        renderer.destroy();
        EventBus.getInstance().clear();
    });

    it('addBlock(0, 0, 0, "grass") → blockCount = 1, hasBlock = true', async () => {
        const block = await renderer.addBlock(0, 0, 0, 'grass');

        assert.ok(block !== null, '应返回 BlockSprite 实例');
        assert.strictEqual(renderer.blockCount, 1);
        assert.strictEqual(renderer.hasBlock(0, 0, 0), true);
    });

    it('addBlock 后 getBlock 返回正确的 BlockSprite', async () => {
        await renderer.addBlock(1, 2, 0, 'stone');
        const block = renderer.getBlock(1, 2, 0);

        assert.ok(block !== undefined);
        assert.strictEqual(block.blockType, 'stone');
        assert.strictEqual(block.gridX, 1);
        assert.strictEqual(block.gridY, 2);
        assert.strictEqual(block.gridZ, 0);
    });

    it('相同位置重复 addBlock 应覆盖（先移除旧方块再添加新方块）', async () => {
        await renderer.addBlock(3, 3, 0, 'grass');
        assert.strictEqual(renderer.blockCount, 1);

        // 第二次添加应覆盖
        await renderer.addBlock(3, 3, 0, 'stone');
        assert.strictEqual(renderer.blockCount, 1, '覆盖后数量应仍为 1');

        const block = renderer.getBlock(3, 3, 0);
        assert.ok(block !== undefined);
        // 新方块的类型应为 stone
        assert.strictEqual(block.blockType, 'stone');
    });

    it('多个不同位置添加 → blockCount 累加', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 0, 0, 'dirt');
        await renderer.addBlock(0, 1, 0, 'stone');
        await renderer.addBlock(2, 2, 0, 'grass');

        assert.strictEqual(renderer.blockCount, 4);
    });

    it('未知方块类型应优雅降级（不抛异常）', async () => {
        // 未知类型不在 _cachedTextures 中，会走回退路径
        // 回退路径中 createWithIsoTransform 仍会尝试加载真实图片，
        // 但由于 setIsoFaces 被 mock，不会触发 Canvas API
        const block = await renderer.addBlock(5, 5, 0, 'nonexistent_type');

        // 重点是整个流程不抛异常
        assert.ok(true, '未知类型不应抛异常');
    });
});

// ============================================================
// 测试：removeBlock 动态移除
// ============================================================

describe('BlockRenderer - T12: removeBlock 动态移除', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = { 'grass': createMockCachedTextures() };

        // 预添加测试方块
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 1, 0, 'grass');
        await renderer.addBlock(2, 2, 1, 'grass');
    });

    afterEach(() => {
        renderer.destroy();
        EventBus.getInstance().clear();
    });

    it('removeBlock(0, 0, 0) → 返回 true, hasBlock = false', () => {
        const result = renderer.removeBlock(0, 0, 0);

        assert.strictEqual(result, true);
        assert.strictEqual(renderer.hasBlock(0, 0, 0), false);
        assert.strictEqual(renderer.blockCount, 2);
    });

    it('移除不存在的方块 → 返回 false', () => {
        const result = renderer.removeBlock(99, 99, 99);

        assert.strictEqual(result, false);
        assert.strictEqual(renderer.blockCount, 3);
    });

    it('移除后 getBlock 返回 undefined', () => {
        renderer.removeBlock(1, 1, 0);

        assert.strictEqual(renderer.getBlock(1, 1, 0), undefined);
    });

    it('全部移除后 blockCount = 0', () => {
        renderer.removeBlock(0, 0, 0);
        renderer.removeBlock(1, 1, 0);
        renderer.removeBlock(2, 2, 1);

        assert.strictEqual(renderer.blockCount, 0);
    });
});

// ============================================================
// 测试：图层分流逻辑
// ============================================================

describe('BlockRenderer - T12: 图层分流逻辑', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures()
        };
    });

    afterEach(() => {
        renderer.destroy();
        EventBus.getInstance().clear();
    });

    it('gz=0 的方块应添加到 Layer 1 (Ground)', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');

        const layer1 = layerStack.getLayer(1);
        assert.strictEqual(layer1.children.length, 1, 'Layer 1 应有 1 个子节点');

        const layer0 = layerStack.getLayer(0);
        assert.strictEqual(layer0.children.length, 0, 'Layer 0 应为空');
    });

    it('gz≥1 的方块应添加到 Layer 2 (Structures)', async () => {
        await renderer.addBlock(0, 0, 1, 'stone');

        const layer2 = layerStack.getLayer(2);
        assert.strictEqual(layer2.children.length, 1, 'Layer 2 应有 1 个子节点');

        const layer1 = layerStack.getLayer(1);
        assert.strictEqual(layer1.children.length, 0, 'Layer 1 应为空');
    });

    it('gz=0 和 gz=1 的方块应分流到不同图层', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(0, 0, 1, 'stone');

        assert.strictEqual(layerStack.getLayer(1).children.length, 1, 'Layer 1: 地面方块');
        assert.strictEqual(layerStack.getLayer(2).children.length, 1, 'Layer 2: 结构方块');
    });

    it('gz=2 也应分流到 Layer 2', async () => {
        await renderer.addBlock(0, 0, 2, 'stone');

        assert.strictEqual(layerStack.getLayer(2).children.length, 1);
        assert.strictEqual(layerStack.getLayer(1).children.length, 0);
    });

    it('removeBlock 应从正确的图层移除', async () => {
        await renderer.addBlock(3, 3, 0, 'grass');
        await renderer.addBlock(3, 3, 1, 'stone');

        assert.strictEqual(layerStack.getLayer(1).children.length, 1);
        assert.strictEqual(layerStack.getLayer(2).children.length, 1);

        renderer.removeBlock(3, 3, 1);

        assert.strictEqual(layerStack.getLayer(2).children.length, 0, '移除后 Layer 2 应为空');
        assert.strictEqual(layerStack.getLayer(1).children.length, 1, 'Layer 1 不受影响');
    });
});

// ============================================================
// 测试：clear 清空场景
// ============================================================

describe('BlockRenderer - T12: clear 清空场景', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = { 'grass': createMockCachedTextures() };

        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 0, 0, 'grass');
        await renderer.addBlock(2, 0, 0, 'grass');
    });

    afterEach(() => {
        renderer.destroy();
        EventBus.getInstance().clear();
    });

    it('clear() → blockCount = 0', () => {
        assert.strictEqual(renderer.blockCount, 3);

        renderer.clear();

        assert.strictEqual(renderer.blockCount, 0);
    });

    it('clear() 后 hasBlock 返回 false', () => {
        renderer.clear();

        assert.strictEqual(renderer.hasBlock(0, 0, 0), false);
        assert.strictEqual(renderer.hasBlock(1, 0, 0), false);
        assert.strictEqual(renderer.hasBlock(2, 0, 0), false);
    });

    it('clear() 后对应的 Layer 子节点应被移除', () => {
        const layer1 = layerStack.getLayer(1);
        assert.ok(layer1.children.length > 0, 'clear 前 Layer 1 应有子节点');

        renderer.clear();

        assert.strictEqual(layer1.children.length, 0, 'clear 后 Layer 1 应为空');
    });

    it('多次 clear() 不报错', () => {
        renderer.clear();
        assert.doesNotThrow(() => {
            renderer.clear();
            renderer.clear();
        });
    });
});

// ============================================================
// 测试：destroy 销毁
// ============================================================

describe('BlockRenderer - T12: destroy 销毁', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = { 'grass': createMockCachedTextures() };

        await renderer.addBlock(4, 4, 0, 'grass');
        await renderer.addBlock(5, 5, 0, 'grass');
    });

    it('destroy() → blockCount = 0', () => {
        renderer.destroy();

        assert.strictEqual(renderer.blockCount, 0);
    });

    it('destroy() 后事件订阅应已解绑（触发事件不崩溃）', () => {
        renderer.destroy();

        const bus = EventBus.getInstance();
        assert.doesNotThrow(() => {
            bus.emit('block:placed', { gx: 0, gy: 0, gz: 0, blockType: 'grass' });
            bus.emit('block:removed', { gx: 0, gy: 0, gz: 0 });
        });
    });

    it('多次 destroy() 不报错', () => {
        renderer.destroy();
        assert.doesNotThrow(() => {
            renderer.destroy();
            renderer.destroy();
        });
    });
});

// ============================================================
// 测试：BlockGridOperator._normalizeGrid 网格标准化（该方法已重构至 BlockGridOperator）
// ============================================================

/**
 * 创建最小化 BlockGridManager Mock 供 BlockGridOperator 使用。
 * @returns {*} Mock 对象
 */
function createGridManagerMock() {
    return {
        _blockMap: new Map(),
        _blockTypes: [],
        _layerStack: new LayerStackMock(),
        blockCount: 0,
        hasBlock: () => false,
        getBlock: () => undefined,
        removeBlock: () => {},
        interactionManager: null,
        debugManager: null
    };
}

describe('BlockRenderer - T12: _normalizeGrid 网格标准化', () => {
    /** @type {typeof import('../block/BlockGridOperator.mjs').BlockGridOperator} */
    let BlockGridOperator;

    before(async () => {
        const mod = await import('../block/BlockGridOperator.mjs');
        BlockGridOperator = mod.BlockGridOperator;
    });

    it('2D 网格应识别为非 3D 并返回 heightLayers = [0]', () => {
        const operator = new BlockGridOperator(createGridManagerMock());
        const grid2d = [
            ['grass', 'grass'],
            ['grass', 'stone']
        ];

        const result = operator._normalizeGrid(grid2d);

        assert.strictEqual(result.grid, grid2d);
        assert.deepStrictEqual(result.heightLayers, [0]);
    });

    it('3D 网格应识别并返回正确的 heightLayers', () => {
        const operator = new BlockGridOperator(createGridManagerMock());
        const grid3d = [
            [['grass', 'grass'], ['grass', 'dirt']],
            [[null, 'stone'], [null, null]]
        ];

        const result = operator._normalizeGrid(grid3d);

        assert.deepStrictEqual(result.heightLayers, [0, 1]);
    });

    it('3D 网格中有空层应跳过', () => {
        const operator = new BlockGridOperator(createGridManagerMock());
        const grid3d = [
            [['grass', 'grass'], ['grass', 'dirt']],
            [],
            [[null, 'stone'], [null, null]]
        ];

        const result = operator._normalizeGrid(grid3d);

        assert.deepStrictEqual(result.heightLayers, [0, 2]);
    });

    it('空数组 → heightLayers = [0]', () => {
        const operator = new BlockGridOperator(createGridManagerMock());
        const result = operator._normalizeGrid([]);

        assert.deepStrictEqual(result.heightLayers, [0]);
    });
});

// ============================================================
// 测试：事件订阅
// ============================================================

describe('BlockRenderer - T12: 事件订阅', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;
    /** @type {import('../../core/EventBus.mjs').EventBus} */
    let bus;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
        const bsMod = await import('../BlockSprite.mjs');
        BlockSprite = bsMod.BlockSprite;
    });

    beforeEach(() => {
        bus = EventBus.getInstance();
        bus.clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack, bus);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures()
        };
    });

    afterEach(() => {
        renderer.destroy();
        bus.clear();
    });

    it('block:placed 事件触发后应尝试添加方块（异步，不崩溃）', (_, done) => {
        // addBlock 是异步的，事件处理器内部使用 .catch 忽略错误
        // 主要验证事件触发不会导致崩溃
        bus.emit('block:placed', { gx: 5, gy: 5, gz: 0, blockType: 'grass' });

        // 给异步操作一点时间
        setTimeout(() => {
            assert.ok(true, 'block:placed 事件触发未导致崩溃');
            done();
        }, 50);
    });

    it('block:removed 事件触发后应移除指定方块的映射', () => {
        // 直接添加方块到 blockMap（绕过 addBlock 的异步纹理加载）
        const mockBlock = new BlockSprite({ blockType: 'stone' });
        mockBlock.setGridPosition(2, 3, 0);
        renderer._blockMap.set('2,3,0', mockBlock);
        renderer._layerStack.addToLayer(1, mockBlock);

        assert.strictEqual(renderer.hasBlock(2, 3, 0), true);

        // 发送移除事件
        bus.emit('block:removed', { gx: 2, gy: 3, gz: 0 });

        assert.strictEqual(renderer.hasBlock(2, 3, 0), false);
    });

    it('事件数据不完整时应静默忽略', () => {
        assert.doesNotThrow(() => {
            bus.emit('block:placed', {});
            bus.emit('block:removed', {});
        });
    });
});

// ============================================================
// 测试：SceneGraph 集成路径（T11 + T12 汇合）
// ============================================================

describe('BlockRenderer - T12: SceneGraph 集成', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {typeof import('../SceneGraph.mjs').SceneGraph} */
    let SceneGraph;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;
    /** @type {import('../SceneGraph.mjs').SceneGraph} */
    let sceneGraph;
    /** @type {import('../../core/EventBus.mjs').EventBus} */
    let bus;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
        const sgMod = await import('../SceneGraph.mjs');
        SceneGraph = sgMod.SceneGraph;
    });

    beforeEach(() => {
        bus = EventBus.getInstance();
        bus.clear();
        layerStack = new LayerStackMock();
        sceneGraph = new SceneGraph(/** @type {any} */ (layerStack));
        renderer = new BlockRenderer(layerStack, bus, sceneGraph);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures()
        };
    });

    afterEach(() => {
        renderer.destroy();
        bus.clear();
    });

    it('传入 SceneGraph 后 blockCount 初始为 0', () => {
        assert.strictEqual(renderer.blockCount, 0);
        assert.strictEqual(sceneGraph.count, 0);
    });

    it('addBlock 后 SceneGraph 节点数量同步增加', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');

        assert.strictEqual(renderer.blockCount, 1);
        assert.strictEqual(sceneGraph.count, 1);
    });

    it('addBlock 后可通过 SceneGraph.get 查询 RenderNode', async () => {
        await renderer.addBlock(1, 2, 0, 'stone');
        const block = renderer.getBlock(1, 2, 0);
        assert.ok(block !== undefined);

        const nodeId = /** @type {number|undefined} */ (block._sceneNodeId);
        assert.ok(typeof nodeId === 'number', '方块应持有 sceneNodeId');

        const node = sceneGraph.get(nodeId);
        assert.ok(node !== undefined, 'SceneGraph 应能查到该节点');
        assert.strictEqual(node.container, block);
        assert.strictEqual(node.layerIndex, 1); // gz=0 → Layer 1 (Ground)
    });

    it('removeBlock 后 SceneGraph 节点数减少', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        assert.strictEqual(sceneGraph.count, 1);

        renderer.removeBlock(0, 0, 0);

        assert.strictEqual(sceneGraph.count, 0);
        assert.strictEqual(renderer.blockCount, 0);
    });

    it('removeBlock 后对应 RenderNode 从 SceneGraph 中移除', async () => {
        await renderer.addBlock(3, 3, 0, 'grass');
        const block = renderer.getBlock(3, 3, 0);
        const nodeId = /** @type {number} */ (block._sceneNodeId);

        renderer.removeBlock(3, 3, 0);

        assert.strictEqual(sceneGraph.get(nodeId), undefined);
    });

    it('clear() 后 SceneGraph 节点数为 0', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 0, 0, 'stone');
        assert.strictEqual(sceneGraph.count, 2);

        renderer.clear();

        assert.strictEqual(sceneGraph.count, 0);
    });

    it('gz=1 的方块通过 SceneGraph 添加到 Layer 2', async () => {
        await renderer.addBlock(0, 0, 1, 'stone');
        const block = renderer.getBlock(0, 0, 1);
        const nodeId = /** @type {number} */ (block._sceneNodeId);
        const node = sceneGraph.get(nodeId);

        assert.ok(node !== undefined);
        assert.strictEqual(node.layerIndex, 2); // gz≥1 → Layer 2 (Structures)
    });

    it('不传 SceneGraph 时 _sceneGraph 为 null', () => {
        const r2 = new BlockRenderer(new LayerStackMock());
        assert.strictEqual(r2._sceneGraph, null);
        r2.destroy();
    });

    it('destroy 后 SceneGraph 引用被清除', async () => {
        await renderer.addBlock(2, 2, 0, 'grass');
        renderer.destroy();

        // 清除后 sceneGraph 引用已被置 null
        // 验证场景图也被清空
        assert.strictEqual(sceneGraph.count, 0);
    });

    it('多个方块 add/remove 后 SceneGraph 保持一致', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 1, 0, 'stone');
        await renderer.addBlock(2, 2, 1, 'stone');
        assert.strictEqual(sceneGraph.count, 3);

        renderer.removeBlock(1, 1, 0);
        assert.strictEqual(sceneGraph.count, 2);

        await renderer.addBlock(3, 3, 0, 'grass');
        assert.strictEqual(sceneGraph.count, 3);

        renderer.clear();
        assert.strictEqual(sceneGraph.count, 0);
    });
});

// ============================================================
// 测试：网格点击交互（ScreenToWorld 逆变换拾取管道）
// ============================================================

/**
 * 创建测试用 ScreenToWorld 实例。
 * 使用默认 Camera 参数：x=0, y=0, zoom=1, viewWidth=800, viewHeight=600
 * @returns {ScreenToWorld}
 */
function createTestScreenToWorld() {
    const mockCamera = { x: 0, y: 0, zoom: 1, viewWidth: 800, viewHeight: 600 };
    return new ScreenToWorld(mockCamera);
}

describe('BlockRenderer - 网格点击交互', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {LayerStackMock} */
    let layerStack;
    /** @type {GridOverlayMock} */
    let gridOverlay;
    /** @type {ScreenToWorld} */
    let stw;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        gridOverlay = new GridOverlayMock();
        stw = createTestScreenToWorld();
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('bindGridClick 设置 _gridClickEnabled = true', () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        renderer.bindGridClick(gridOverlay);

        assert.strictEqual(renderer._gridClickEnabled, true);
        renderer.destroy();
    });

    it('bindGridClick 在 rootContainer 上注册 pointerdown（无需 eventMode，由 ScreenToWorld 数学拾取替代）', () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        renderer.bindGridClick(gridOverlay);

        const root = layerStack.getRootContainer();
        // 新架构使用 ScreenToWorld 逆变换拾取，不依赖 PIXI eventMode
        assert.ok(root._listeners['pointerdown'] && root._listeners['pointerdown'].length > 0,
            'rootContainer 应有 pointerdown 监听');
        renderer.destroy();
    });

    it('点击方块坐标触发 removeBlock（ScreenToWorld 逆变换拾取）', async () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        await renderer.addBlock(2, 2, 0, 'grass');
        assert.strictEqual(renderer.blockCount, 1);

        renderer.bindGridClick(gridOverlay);

        // 模拟点击 block(2,2,0) 的屏幕坐标
        // screenX = 400 + (2-2)*12 = 400, screenY = 300 + (2+2)*6 = 324
        const mockEvent = { global: { x: 400, y: 324 } };
        const root = layerStack.getRootContainer();
        root.emit('pointerdown', mockEvent);

        // 方块应已被移除
        assert.strictEqual(renderer.blockCount, 0);
        assert.strictEqual(renderer.hasBlock(2, 2, 0), false);
        renderer.destroy();
    });

    it('点击空白格点添加随机方块', async () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        // 先添加一个方块确保底层渲染就绪
        await renderer.addBlock(0, 0, 0, 'grass');
        renderer.bindGridClick(gridOverlay);

        // 模拟点击空白位置 (gx=3, gy=2) 的屏幕坐标
        // screenX = 400 + (3-2)*12 = 412, screenY = 300 + (3+2)*6 = 330
        const mockEvent = { global: { x: 412, y: 330 } };
        const root = layerStack.getRootContainer();
        root.emit('pointerdown', mockEvent);

        // 等待 addBlock 异步完成
        await new Promise(resolve => setTimeout(resolve, 50));

        // (3, 2, 0) 应出现一个随机方块
        assert.strictEqual(renderer.hasBlock(3, 2, 0), true);
        renderer.destroy();
    });

    it('unbindGridClick 移除 rootContainer 监听并重置标志', () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        renderer.bindGridClick(gridOverlay);
        assert.strictEqual(renderer._gridClickEnabled, true);

        const root = layerStack.getRootContainer();
        assert.ok(root._listeners['pointerdown'] && root._listeners['pointerdown'].length > 0);

        renderer.unbindGridClick();

        assert.strictEqual(renderer._gridClickEnabled, false);
        // 监听器应从 rootContainer 移除
        assert.strictEqual(root._listeners['pointerdown'] ? root._listeners['pointerdown'].length : 0, 0);
        renderer.destroy();
    });

    it('新方块可通过 rootContainer 全局 handler 点击删除', async () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        renderer.bindGridClick(gridOverlay);

        // 在 bindGridClick 之后添加新方块
        await renderer.addBlock(1, 1, 0, 'stone');
        assert.strictEqual(renderer.blockCount, 1);

        // 模拟点击 block(1,1,0) 的屏幕坐标
        // screenX = 400 + (1-1)*12 = 400, screenY = 300 + (1+1)*6 = 312
        const mockEvent = { global: { x: 400, y: 312 } };
        const root = layerStack.getRootContainer();
        root.emit('pointerdown', mockEvent);

        // 方块应被移除
        assert.strictEqual(renderer.blockCount, 0);
        renderer.destroy();
    });

    it('未设置 ScreenToWorld 时点击不触发（优雅降级）', async () => {
        const renderer = new BlockRenderer(layerStack);
        // 故意不调用 setScreenToWorld
        await renderer.addBlock(0, 0, 0, 'grass');
        assert.strictEqual(renderer.blockCount, 1);

        renderer.bindGridClick(gridOverlay);

        const mockEvent = { global: { x: 400, y: 300 } };
        const root = layerStack.getRootContainer();
        root.emit('pointerdown', mockEvent);

        // 无 ScreenToWorld → _getHitBlock 返回 null → 不应触发任何操作
        assert.strictEqual(renderer.blockCount, 1);
        renderer.destroy();
    });

    it('destroy 时自动解绑点击', () => {
        const renderer = new BlockRenderer(layerStack);
        renderer.setScreenToWorld(stw);
        renderer.bindGridClick(gridOverlay);
        assert.strictEqual(renderer._gridClickEnabled, true);

        renderer.destroy();

    });
});


// ============================================================
// 方块调试日志 (enableBlockDebug / disableBlockDebug)
// ============================================================

describe('BlockRenderer - 方块调试日志', () => {
    /** @type {typeof import('../BlockRenderer.mjs').BlockRenderer} */
    let BlockRenderer;
    /** @type {*} */
    let renderer;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../BlockRenderer.mjs');
        BlockRenderer = mod.BlockRenderer;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        renderer = new BlockRenderer(layerStack);
        renderer._useIsoTransform = true;
        renderer._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures(),
            'dirt': createMockCachedTextures()
        };
    });

    afterEach(() => {
        renderer.destroy();
        EventBus.getInstance().clear();
    });

    it('enableBlockDebug 设置 _blockDebugEnabled = true', () => {
        assert.strictEqual(renderer._blockDebugEnabled, false);
        renderer.enableBlockDebug();
        assert.strictEqual(renderer._blockDebugEnabled, true);
    });

    it('enableBlockDebug 为已有方块添加 pointerdown 监听', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 0, 0, 'stone');
        const blockA = renderer.getBlock(0, 0, 0);
        const blockB = renderer.getBlock(1, 0, 0);

        // 此时应无 pointerdown 监听
        assert.strictEqual(
            blockA._listeners['pointerdown'] ? blockA._listeners['pointerdown'].length : 0,
            0
        );

        renderer.enableBlockDebug();

        // 两个方块均应有 pointerdown 监听
        assert.ok(blockA._listeners['pointerdown'] && blockA._listeners['pointerdown'].length > 0,
            'blockA 应有 pointerdown 监听');
        assert.ok(blockB._listeners['pointerdown'] && blockB._listeners['pointerdown'].length > 0,
            'blockB 应有 pointerdown 监听');

        // eventMode 应为 static
        assert.strictEqual(blockA.eventMode, 'static');
        assert.strictEqual(blockB.eventMode, 'static');

        // hitArea 应为菱形 Polygon
        assert.ok(blockA.hitArea, 'blockA 应有 hitArea');
        assert.strictEqual(blockA.hitArea.type, 'polygon');
        assert.ok(blockB.hitArea, 'blockB 应有 hitArea');
    });

    it('enableBlockDebug 后添加的新方块也自动绑定 pointerdown', async () => {
        renderer.enableBlockDebug();

        await renderer.addBlock(3, 3, 0, 'dirt');
        const block = renderer.getBlock(3, 3, 0);

        assert.ok(block._listeners['pointerdown'] && block._listeners['pointerdown'].length > 0,
            '新方块应有 pointerdown 监听');
        assert.strictEqual(block.eventMode, 'static');
    });

    it('disableBlockDebug 移除所有方块的 pointerdown 监听', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        await renderer.addBlock(1, 1, 0, 'stone');
        renderer.enableBlockDebug();

        const blockA = renderer.getBlock(0, 0, 0);
        const blockB = renderer.getBlock(1, 1, 0);
        assert.ok(blockA._listeners['pointerdown'].length > 0);
        assert.ok(blockB._listeners['pointerdown'].length > 0);

        renderer.disableBlockDebug();

        assert.strictEqual(renderer._blockDebugEnabled, false);
        assert.strictEqual(
            blockA._listeners['pointerdown'] ? blockA._listeners['pointerdown'].length : 0,
            0,
            'blockA 的 pointerdown 监听已被移除'
        );
        assert.strictEqual(
            blockB._listeners['pointerdown'] ? blockB._listeners['pointerdown'].length : 0,
            0,
            'blockB 的 pointerdown 监听已被移除'
        );
    });

    it('emit pointerdown 触发 console.group / console.table 调用', async () => {
        // 替换 console 方法为 spy
        const originalGroup = console.group;
        const originalTable = console.table;
        const groupCalls = [];
        const tableCalls = [];

        console.group = (...args) => { groupCalls.push(args); };
        console.table = (data) => { tableCalls.push(data); };

        try {
            await renderer.addBlock(0, 0, 0, 'grass');
            renderer.enableBlockDebug();

            const block = renderer.getBlock(0, 0, 0);
            const mockEvent = { getLocalPosition: () => ({ x: 0, y: 0 }) };
            block.emit('pointerdown', mockEvent);

            // console.group 应被调用至少一次
            assert.ok(groupCalls.length > 0, 'console.group 应被调用');
            // console.table 应被调用
            assert.ok(tableCalls.length > 0, 'console.table 应被调用');

            // console.table 参数应包含关键字段
            const data = tableCalls[0];
            assert.ok(data, 'console.table 应有数据');
            assert.strictEqual(data['纹理类型'], 'grass');
            assert.strictEqual(data['网格列 (gx)'], 0);
            assert.strictEqual(data['网格行 (gy)'], 0);
            assert.strictEqual(data['高度层 (gz)'], 0);
            assert.ok(typeof data['物块 ID'] === 'number', '物块 ID 应为数字');
            assert.strictEqual(data['可见'], true);
            assert.strictEqual(data['选中'], false);
        } finally {
            console.group = originalGroup;
            console.table = originalTable;
        }
    });

    it('重复 enableBlockDebug 不重复绑定（幂等）', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        renderer.enableBlockDebug();
        renderer.enableBlockDebug(); // 第二次调用

        const block = renderer.getBlock(0, 0, 0);
        // pointerdown 监听应只有 1 个（未被重复添加）
        assert.strictEqual(block._listeners['pointerdown'].length, 1);
    });

    it('destroy 自动调用 disableBlockDebug', async () => {
        await renderer.addBlock(0, 0, 0, 'grass');
        renderer.enableBlockDebug();
        assert.strictEqual(renderer._blockDebugEnabled, true);

        renderer.destroy();

        assert.strictEqual(renderer._blockDebugEnabled, false);
    });
});
