// @ts-check

/**
 * @fileoverview
 * SortManager 单元测试（T10 — Y-Sort 排序系统）。
 *
 * 测试覆盖：
 * - getSortKey 纯函数正确性
 * - SortManager 构造与默认配置
 * - markDirty + tick 静态层脏排序机制
 * - tick 动态层自动排序
 * - setLayerType 集成
 * - destroy 后安全
 *
 * @module __tests__/SortManager
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ==================== 模拟 PixiJS Container ====================

/** 模拟 PIXI.Container */
class MockPixiContainer {
    constructor() {
        /** @type {boolean} */
        this.sortableChildren = false;
        /** @type {boolean} */
        this._sortCalled = false;
        /** @type {Array<{ name: string, zIndex: number }>} */
        this.children = [];
    }

    /** 模拟 sortChildren */
    sortChildren() {
        if (this.sortableChildren) {
            this._sortCalled = true;
            this.children.sort((a, b) => a.zIndex - b.zIndex);
        }
    }
}

// ==================== 模拟 LayerStack ====================

/** 模拟 LayerStack */
class MockLayerStack {
    constructor(layerCount = 8) {
        /** @type {MockPixiContainer[]} */
        this._layers = [];
        for (let i = 0; i < layerCount; i++) {
            this._layers.push(new MockPixiContainer());
        }
    }

    /**
     * 模拟 LayerStack.getLayer()
     * @param {number} index
     * @returns {MockPixiContainer}
     */
    getLayer(index) {
        return this._layers[index];
    }

    /**
     * 模拟 setLayerType
     * @param {number} index
     * @param {string} type
     */
    setLayerType(index, type) {
        this._layers[index].sortableChildren = (type === 'dynamic');
    }
}

// ==================== 导入待测模块 ====================

import {
    SortManager,
    getSortKey,
    LayerType,
    DEFAULT_LAYER_TYPES,
    Z_BASE
} from '../SortManager.mjs';

// ==================== 测试套件 ====================

describe('SortManager - T10: getSortKey 纯函数', () => {
    it('(0, 0, 0) → 0', () => {
        assert.strictEqual(getSortKey(0, 0, 0), 0);
    });

    it('(3, 5, 0) = (3+5)*100 + 0 = 800', () => {
        assert.strictEqual(getSortKey(3, 5, 0), 800);
    });

    it('(5, 5, 1) = (5+5)*100 + 1 = 1001, 大于 (5,5,0)=1000', () => {
        assert.strictEqual(getSortKey(5, 5, 1), 1001);
        assert.ok(getSortKey(5, 5, 1) > getSortKey(5, 5, 0));
    });

    it('更大 (gx+gy) 的对象排在更后面（zIndex 更大）', () => {
        const a = getSortKey(2, 2, 0); // 400
        const b = getSortKey(10, 5, 0); // 1500
        assert.ok(b > a);
    });

    it('默认 gz=0', () => {
        assert.strictEqual(getSortKey(7, 3), getSortKey(7, 3, 0));
    });

    it('负数坐标仍正确', () => {
        // (-3, -2, 0) = (-5)*100 + 0 = -500
        assert.strictEqual(getSortKey(-3, -2, 0), -500);
    });
});

describe('SortManager - T10: 构造与默认层类型', () => {
    it('构造后不报错', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        assert.ok(sm instanceof SortManager);
        sm.destroy();
    });

    it('默认层类型数组长度为 8', () => {
        assert.strictEqual(DEFAULT_LAYER_TYPES.length, 8);
    });

    it('前 4 层为 STATIC', () => {
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(DEFAULT_LAYER_TYPES[i], LayerType.STATIC);
        }
    });

    it('后 4 层为 DYNAMIC', () => {
        for (let i = 4; i < 8; i++) {
            assert.strictEqual(DEFAULT_LAYER_TYPES[i], LayerType.DYNAMIC);
        }
    });

    it('自定义层类型', () => {
        const layerStack = new MockLayerStack();
        const customTypes = ['dynamic', 'static', 'static', 'static', 'static', 'static', 'static', 'static'];
        const sm = new SortManager(layerStack, customTypes);
        assert.ok(sm instanceof SortManager);
        sm.destroy();
    });
});

describe('SortManager - T10: markDirty + tick 静态层', () => {
    it('静态层 markDirty 后 tick 触发 sortChildren', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);

        // 应用层类型（静态层 sortableChildren = false）
        layerStack.setLayerType(0, LayerType.STATIC);
        layerStack.setLayerType(1, LayerType.STATIC);

        const layer0 = layerStack.getLayer(0);
        const layer1 = layerStack.getLayer(1);

        // 初始未脏，tick 不触发排序
        sm.tick();
        assert.strictEqual(layer0._sortCalled, false);
        assert.strictEqual(layer1._sortCalled, false);

        // 标记 Ground 层脏
        sm.markDirty(1);
        assert.strictEqual(layer1._sortCalled, false); // 尚未 tick

        // tick 触发排序
        sm.tick();
        assert.strictEqual(layer0._sortCalled, false); // 未脏
        assert.strictEqual(layer1._sortCalled, true);  // 脏 → 排序

        // 排序后脏标记应清除
        // 重置模拟标记
        layer0._sortCalled = false;
        layer1._sortCalled = false;
        sm.tick();
        assert.strictEqual(layer0._sortCalled, false);
        assert.strictEqual(layer1._sortCalled, false);

        sm.destroy();
    });

    it('静态层多次 markDirty 后只排一次', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        layerStack.setLayerType(1, LayerType.STATIC);

        sm.markDirty(1);
        sm.markDirty(1);
        sm.markDirty(1);

        sm.tick();
        assert.strictEqual(layerStack.getLayer(1)._sortCalled, true);

        sm.destroy();
    });

    it('静态层排序后 sortableChildren 恢复为 false', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        layerStack.setLayerType(1, LayerType.STATIC);

        sm.markDirty(1);
        sm.tick();

        const layer1 = layerStack.getLayer(1);
        assert.strictEqual(layer1.sortableChildren, false);

        sm.destroy();
    });

    it('未脏的静态层 tick 不触发排序 (不重置 sortableChildren)', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        layerStack.setLayerType(1, LayerType.STATIC);

        // 不 markDirty，直接 tick
        sm.tick();
        assert.strictEqual(layerStack.getLayer(1)._sortCalled, false);

        sm.destroy();
    });
});

describe('SortManager - T10: tick 动态层', () => {
    it('动态层 markDirty 被忽略（它们自动排序）', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        layerStack.setLayerType(4, LayerType.DYNAMIC);

        const layer4 = layerStack.getLayer(4);
        assert.strictEqual(layer4.sortableChildren, true);

        // 标记动态层为脏
        sm.markDirty(4);
        // tick 不应处理动态层
        sm.tick();
        assert.strictEqual(layer4._sortCalled, false);

        sm.destroy();
    });

    it('动态层 sortableChildren 保持 true', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);

        for (let i = 4; i < 8; i++) {
            layerStack.setLayerType(i, LayerType.DYNAMIC);
            assert.strictEqual(layerStack.getLayer(i).sortableChildren, true);
        }

        sm.tick();

        for (let i = 4; i < 8; i++) {
            assert.strictEqual(layerStack.getLayer(i).sortableChildren, true);
        }

        sm.destroy();
    });

    it('sortChildren 按 zIndex 正确排序', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        layerStack.setLayerType(4, LayerType.DYNAMIC);

        const layer4 = layerStack.getLayer(4);
        layer4.sortableChildren = true;
        layer4.children = [
            { name: 'late', zIndex: 300 },
            { name: 'early', zIndex: 100 },
            { name: 'middle', zIndex: 200 }
        ];

        layer4.sortChildren();

        assert.strictEqual(layer4.children[0].name, 'early');
        assert.strictEqual(layer4.children[1].name, 'middle');
        assert.strictEqual(layer4.children[2].name, 'late');

        sm.destroy();
    });
});

describe('SortManager - T10: setLayerType 集成', () => {
    it('静态层 sortableChildren = false', () => {
        const layerStack = new MockLayerStack();
        layerStack.setLayerType(1, LayerType.STATIC);
        assert.strictEqual(layerStack.getLayer(1).sortableChildren, false);
    });

    it('动态层 sortableChildren = true', () => {
        const layerStack = new MockLayerStack();
        layerStack.setLayerType(4, LayerType.DYNAMIC);
        assert.strictEqual(layerStack.getLayer(4).sortableChildren, true);
    });

    it('动态层与静态层相互转换', () => {
        const layerStack = new MockLayerStack();

        layerStack.setLayerType(1, LayerType.DYNAMIC);
        assert.strictEqual(layerStack.getLayer(1).sortableChildren, true);

        layerStack.setLayerType(1, LayerType.STATIC);
        assert.strictEqual(layerStack.getLayer(1).sortableChildren, false);
    });
});

describe('SortManager - T10: destroy 后安全', () => {
    it('destroy 后 markDirty 不报错', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        sm.destroy();
        sm.markDirty(1);
    });

    it('destroy 后 tick 不报错', () => {
        const layerStack = new MockLayerStack();
        const sm = new SortManager(layerStack);
        sm.destroy();
        sm.tick();
    });
});
