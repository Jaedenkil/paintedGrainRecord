// @ts-check

/**
 * @fileoverview
 * BlockGridManager 单元测试（聚焦 getColumnInfo + LRU 缓存）。
 *
 * 测试覆盖：
 * - getColumnInfo 空列返回空数组
 * - getColumnInfo 单层列
 * - getColumnInfo 多层列（gz=0,1,2）
 * - getColumnInfo 结果按 gz 升序排列
 * - LRU 缓存命中返回相同引用
 * - addBlock 后缓存失效
 * - removeBlock 后缓存失效
 * - clear 后缓存清空
 * - 多列独立工作
 *
 * @module render/__tests__/BlockGridManager.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';

// ════════════════════════════════════════════════════════════
// PIXI 全局 Mock（与 BlockRenderer.test.mjs 保持一致的简化版）
// ════════════════════════════════════════════════════════════

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
        this.hitArea = null;
        this.visible = true;
        this.alpha = 1;
        this.tint = 0xffffff;
        this.rotation = 0;
        this.scale = { x: 1, y: 1, set: (sx, sy) => { this.scale.x = sx; this.scale.y = sy; } };
        this.position = { x: 0, y: 0, set: (px, py) => { this.position.x = px; this.position.y = py; } };
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
    on(event, handler) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
        return this;
    }
    removeListener(event, handler) {
        if (this._listeners[event]) {
            this._listeners[event] = this._listeners[event].filter(h => h !== handler);
        }
        return this;
    }
    removeAllListeners(event) {
        if (this._listeners[event]) {
            delete this._listeners[event];
        }
        return this;
    }
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
                if (typeof child.destroy === 'function') child.destroy(true);
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
        this._textureApplied = false;
    }
    set texture(val) { this._texture = val; this._textureApplied = true; }
    get texture() { return this._texture; }
}

// 模拟全局 PIXI
global.PIXI = {
    Container: PIXIContainerMock,
    Sprite: class extends PIXISpriteMock { constructor() { super(); } },
    /** PIXI.Graphics — 与 Container 相同的最小 mock，支持 clear/setStrokeStyle/setFillStyle */
    Graphics: class extends PIXIContainerMock {
        constructor() {
            super();
            this._strokeStyle = null;
            this._fillStyle = null;
            this._commands = [];
        }
        clear() { this._commands = []; return this; }
        setStrokeStyle(style) { this._strokeStyle = style; return this; }
        setFillStyle(style) { this._fillStyle = style; return this; }
        moveTo(x, y) { this._commands.push(['moveTo', x, y]); return this; }
        lineTo(x, y) { this._commands.push(['lineTo', x, y]); return this; }
        closePath() { this._commands.push(['closePath']); return this; }
        stroke() { this._commands.push(['stroke']); return this; }
        fill() { this._commands.push(['fill']); return this; }
        circle(x, y, r) { this._commands.push(['circle', x, y, r]); return this; }
        addChild(child) { super.addChild(child); return this; }
    },
    Polygon: class {
        constructor(...points) { this.points = points; this.type = 'polygon'; }
    },
    Texture: {
        from(source) { return { path: source, _isMock: true, width: 16, height: 16 }; },
        fromURL(path) { return Promise.resolve({ path, _isMock: true, width: 16, height: 16 }); }
    }
};

function uninstallPIXIMock() {
    delete global.PIXI;
}

// Canvas Mock（使 imageDataToPixiTexture 不崩溃）
class CanvasMock {
    constructor(w, h) { this.width = w || 1; this.height = h || 1; }
    getContext() { return { putImageData: () => {}, drawImage: () => {} }; }
    toDataURL() { return ''; }
}

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        createElement(tag) {
            if (tag === 'canvas') return new CanvasMock();
            return {};
        }
    };
}

// ════════════════════════════════════════════════════════════
// LayerStack Mock
// ════════════════════════════════════════════════════════════

class LayerStackMock {
    constructor() {
        this.layers = [];
        for (let i = 0; i < 8; i++) this.layers.push(new PIXIContainerMock());
        this._rootContainer = new PIXIContainerMock();
        this.history = [];
    }
    addToLayer(layerIndex, child) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) throw new Error(`Layer index out of bounds: ${layerIndex}`);
        this.layers[layerIndex].addChild(child);
        this.history.push({ layer: layerIndex, child, action: 'add' });
    }
    removeFromLayer(layerIndex, child) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) throw new Error(`Layer index out of bounds: ${layerIndex}`);
        const result = this.layers[layerIndex].removeChild(child);
        this.history.push({ layer: layerIndex, child, action: 'remove' });
        return result;
    }
    getLayer(layerIndex) {
        if (layerIndex < 0 || layerIndex >= this.layers.length) throw new Error(`Layer index out of bounds: ${layerIndex}`);
        return this.layers[layerIndex];
    }
    getRootContainer() { return this._rootContainer; }
    clear() { for (const layer of this.layers) layer.children = []; this.history = []; }
    destroy() { for (const layer of this.layers) layer.destroy({ children: true }); this.layers = []; this.history = []; }
}

// ════════════════════════════════════════════════════════════
// 模拟缓存纹理数据
// ════════════════════════════════════════════════════════════

function createMockCachedTextures() {
    const makeImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' });
    return { top: makeImageData(24, 12), left: makeImageData(12, 17), right: makeImageData(12, 17) };
}

// ════════════════════════════════════════════════════════════
// Teardown
// ════════════════════════════════════════════════════════════

after(() => { uninstallPIXIMock(); });

// ════════════════════════════════════════════════════════════
// 测试：getColumnInfo
// ════════════════════════════════════════════════════════════

describe('BlockGridManager - getColumnInfo', () => {
    /** @type {typeof import('../block/BlockGridManager.mjs').BlockGridManager} */
    let BlockGridManager;
    /** @type {import('../block/BlockGridManager.mjs').BlockGridManager} */
    let grid;
    /** @type {LayerStackMock} */
    let layerStack;

    before(async () => {
        const mod = await import('../block/BlockGridManager.mjs');
        BlockGridManager = mod.BlockGridManager;
    });

    beforeEach(() => {
        EventBus.getInstance().clear();
        layerStack = new LayerStackMock();
        grid = new BlockGridManager(/** @type {any} */ (layerStack));
        // 注入缓存纹理，使 addBlock 走同步路径
        grid._useIsoTransform = true;
        grid._cachedTextures = {
            'grass': createMockCachedTextures(),
            'stone': createMockCachedTextures(),
            'dirt': createMockCachedTextures(),
            'brick': createMockCachedTextures()
        };
    });

    afterEach(() => {
        grid.destroy();
        EventBus.getInstance().clear();
    });

    // ── 基础查询 ──

    it('空位置应返回空数组', () => {
        const result = grid.getColumnInfo(0, 0);
        assert.deepStrictEqual(result, []);
    });

    it('单层方块应返回 [{gz, blockType}]', async () => {
        await grid.addBlock(3, 2, 0, 'grass');
        const result = grid.getColumnInfo(3, 2);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].gz, 0);
        assert.strictEqual(result[0].blockType, 'grass');
    });

    it('多层方块应返回所有层的正确信息', async () => {
        await grid.addBlock(1, 1, 0, 'grass');
        await grid.addBlock(1, 1, 1, 'stone');
        await grid.addBlock(1, 1, 2, 'dirt');

        const result = grid.getColumnInfo(1, 1);

        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].gz, 0);
        assert.strictEqual(result[0].blockType, 'grass');
        assert.strictEqual(result[1].gz, 1);
        assert.strictEqual(result[1].blockType, 'stone');
        assert.strictEqual(result[2].gz, 2);
        assert.strictEqual(result[2].blockType, 'dirt');
    });

    it('结果应按 gz 升序排列', async () => {
        // 逆序添加
        await grid.addBlock(5, 5, 2, 'brick');
        await grid.addBlock(5, 5, 0, 'grass');
        await grid.addBlock(5, 5, 1, 'stone');

        const result = grid.getColumnInfo(5, 5);

        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].gz, 0);
        assert.strictEqual(result[1].gz, 1);
        assert.strictEqual(result[2].gz, 2);
    });

    // ── LRU 缓存 ──

    it('相同位置重复调用应返回相同的引用（缓存命中）', async () => {
        await grid.addBlock(2, 2, 0, 'grass');
        await grid.addBlock(2, 2, 1, 'stone');

        const result1 = grid.getColumnInfo(2, 2);
        const result2 = grid.getColumnInfo(2, 2);

        // 缓存命中时应返回同一个数组引用
        assert.strictEqual(result1, result2);
    });

    it('缓存仅在 LRU 容量内保持', async () => {
        // 设置小缓存容量
        grid._columnCacheMax = 3;

        await grid.addBlock(0, 0, 0, 'grass');
        await grid.addBlock(1, 1, 0, 'stone');
        await grid.addBlock(2, 2, 0, 'dirt');
        await grid.addBlock(3, 3, 0, 'brick');

        // 前三个缓存条目
        grid.getColumnInfo(0, 0);
        grid.getColumnInfo(1, 1);
        grid.getColumnInfo(2, 2);

        // 此时 (0,0) 应仍在缓存中
        assert.strictEqual(grid._columnCache.has('0,0'), true);

        // 查询 4 个不同的位置，触发 LRU 淘汰
        grid.getColumnInfo(3, 3); // 缓存满，淘汰最旧的 (0,0)

        // (0,0) 应被淘汰
        assert.strictEqual(grid._columnCache.has('0,0'), false);
        // (1,1) 和 (2,2) 仍在
        assert.strictEqual(grid._columnCache.has('1,1'), true);
        assert.strictEqual(grid._columnCache.has('2,2'), true);
        // (3,3) 在
        assert.strictEqual(grid._columnCache.has('3,3'), true);
    });

    // ── 缓存失效 ──

    it('addBlock 后缓存应失效', async () => {
        await grid.addBlock(0, 0, 0, 'grass');
        const result1 = grid.getColumnInfo(0, 0);
        assert.strictEqual(result1.length, 1);

        // 添加新层
        await grid.addBlock(0, 0, 1, 'stone');
        const result2 = grid.getColumnInfo(0, 0);

        // 缓存应已失效，返回新数组
        assert.notStrictEqual(result1, result2); // 不同引用
        assert.strictEqual(result2.length, 2);
        assert.strictEqual(result2[1].gz, 1);
        assert.strictEqual(result2[1].blockType, 'stone');
    });

    it('removeBlock 后缓存应失效', async () => {
        await grid.addBlock(4, 4, 0, 'grass');
        await grid.addBlock(4, 4, 1, 'stone');

        const result1 = grid.getColumnInfo(4, 4);
        assert.strictEqual(result1.length, 2);

        grid.removeBlock(4, 4, 1);

        const result2 = grid.getColumnInfo(4, 4);
        assert.strictEqual(result2.length, 1);
        assert.strictEqual(result2[0].gz, 0);
    });

    it('clear 后所有缓存应清空', async () => {
        await grid.addBlock(0, 0, 0, 'grass');
        grid.getColumnInfo(0, 0);

        assert.ok(grid._columnCache !== null);
        assert.strictEqual(grid._columnCache.size, 1);

        grid.clear();

        // clear 后 _columnCache 置为 null
        assert.strictEqual(grid._columnCache, null);
    });

    // ── 多列独立 ──

    it('不同位置的列应互不干扰', async () => {
        await grid.addBlock(0, 0, 0, 'grass');
        await grid.addBlock(0, 0, 1, 'stone');
        await grid.addBlock(1, 1, 0, 'dirt');

        const colA = grid.getColumnInfo(0, 0);
        const colB = grid.getColumnInfo(1, 1);

        assert.strictEqual(colA.length, 2);
        assert.strictEqual(colB.length, 1);
        assert.strictEqual(colB[0].blockType, 'dirt');
    });

    it('getColumnInfo 不应修改 _blockMap', async () => {
        await grid.addBlock(7, 7, 0, 'grass');
        const beforeSize = grid._blockMap.size;

        grid.getColumnInfo(7, 7);

        assert.strictEqual(grid._blockMap.size, beforeSize, '_blockMap 大小不应改变');
    });
});

// ════════════════════════════════════════════════════════════
// 测试：IsoGridGeometry.lerpColor（纯函数）
// ════════════════════════════════════════════════════════════
//
// 注意：使用动态 import 确保 PIXI mock 先设置完成。
// lerpColor 是纯函数，不依赖 this / PIXI.Graphics。

describe('IsoGridGeometry - lerpColor', () => {
    /** @private @type {import('../IsoGridGeometry.mjs').lerpColor} */
    let _lerpColor;

    before(async () => {
        const mod = await import('../IsoGridGeometry.mjs');
        _lerpColor = mod.lerpColor;
    });

    it('t=0 应返回 colorA', () => {
        const result = _lerpColor(0x8b6f3c, 0xffd966, 0);
        assert.strictEqual(result, 0x8b6f3c);
    });

    it('t=1 应返回 colorB', () => {
        const result = _lerpColor(0x8b6f3c, 0xffd966, 1);
        assert.strictEqual(result, 0xffd966);
    });

    it('t=0.5 应返回中间值', () => {
        const result = _lerpColor(0x8b6f3c, 0xffd966, 0.5);
        assert.strictEqual(result, 0xc5a451);
    });

    it('t=0.25 应在 1/4 处正确插值', () => {
        const result = _lerpColor(0x000000, 0xffffff, 0.25);
        assert.strictEqual(result, 0x404040);
    });

    it('相同的颜色应返回自身', () => {
        const result = _lerpColor(0xd4a847, 0xd4a847, 0.5);
        assert.strictEqual(result, 0xd4a847);
    });

    it('边界值 t=0 和 t=1 均精确', () => {
        assert.strictEqual(_lerpColor(0x123456, 0x789abc, 0), 0x123456);
        assert.strictEqual(_lerpColor(0x123456, 0x789abc, 1), 0x789abc);
    });
});
