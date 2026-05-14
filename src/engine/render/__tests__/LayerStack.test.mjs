// @ts-check

/**
 * @fileoverview
 * LayerStack 单元测试
 *
 * 测试覆盖：
 * - LayerStack 创建时生成 8 个图层容器
 * - 图层容器按正确顺序挂载（0~6 在 rootContainer，7 在 uiContainer）
 * - addToLayer / removeFromLayer / getLayer
 * - 图层索引越界校验
 * - clear() 清空所有层并发射事件
 * - destroy() 释放资源
 *
 * @module render/__tests__/LayerStack.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';

// ============================================================
// PIXI Container Mock
// ============================================================

class PIXIContainerMock {
    constructor() {
        this.children = [];
        this.name = '';
        this.parent = null;
        /** @type {boolean} 模拟 PixiJS Container.sortableChildren */
        this.sortableChildren = false;
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
    destroy(opts) {
        if (opts && opts.children) {
            for (const child of this.children) {
                if (typeof child.destroy === 'function') {
                    child.destroy(true);
                }
            }
            this.children = [];
        }
        if (this.parent) {
            this.parent.removeChild(this);
        }
    }
}

function installPIXIMock() {
    global.PIXI = {
        Container: PIXIContainerMock
    };
}

function uninstallPIXIMock() {
    delete global.PIXI;
}

// ============================================================
// 测试
// ============================================================

describe('LayerStack - 图层结构', () => {
    /** @type {import('../LayerStack.mjs').LayerStack} */
    let layerStack;
    /** @type {PIXIContainerMock} */
    let rootContainer;
    /** @type {PIXIContainerMock} */
    let uiContainer;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(() => {
        EventBus.getInstance().clear();
        rootContainer = new PIXIContainerMock();
        uiContainer = new PIXIContainerMock();
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('创建时应生成 8 个图层容器', async () => {
        const { LayerStack, LAYER_COUNT, LAYER_MIN, LAYER_MAX } =
            await import('../LayerStack.mjs');

        layerStack = new LayerStack(rootContainer, uiContainer);

        assert.strictEqual(LAYER_COUNT, 8);
        assert.strictEqual(LAYER_MIN, 0);
        assert.strictEqual(LAYER_MAX, 7);
        assert.strictEqual(layerStack.layerCount, 8);
    });

    it('Layer 0~6 应挂载在 rootContainer 下', async () => {
        const { LayerStack } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);

        // rootContainer 应有 7 个子容器（Layer 0~6）
        assert.strictEqual(rootContainer.children.length, 7);

        for (let i = 0; i < 7; i++) {
            const layer = layerStack.getLayer(i);
            assert.strictEqual(layer.parent, rootContainer);
            assert.ok(layer.name.includes(`Layer_${i}_`));
        }
    });

    it('Layer 7 (UI) 应挂载在 uiContainer 下', async () => {
        const { LayerStack } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);

        const uiLayer = layerStack.getLayer(7);
        assert.strictEqual(uiLayer.parent, uiContainer);
        assert.ok(uiLayer.name.includes('Layer_7_UI'));
    });

    it('所有图层容器的 sortableChildren 应设置为 true（启用 Y-Sort）', async () => {
        const { LayerStack, LAYER_COUNT } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);

        for (let i = 0; i < LAYER_COUNT; i++) {
            const layer = layerStack.getLayer(i);
            assert.strictEqual(
                layer.sortableChildren,
                true,
                `Layer ${i} 的 sortableChildren 应为 true`
            );
        }
    });
});

describe('LayerStack - 增删操作', () => {
    /** @type {import('../LayerStack.mjs').LayerStack} */
    let layerStack;
    /** @type {PIXIContainerMock} */
    let rootContainer;
    /** @type {PIXIContainerMock} */
    let uiContainer;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        rootContainer = new PIXIContainerMock();
        uiContainer = new PIXIContainerMock();
        const { LayerStack } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('addToLayer() 应向指定层添加对象', () => {
        const sprite = new PIXIContainerMock();
        sprite.name = 'test_sprite';

        layerStack.addToLayer(4, sprite);

        const layer = layerStack.getLayer(4);
        assert.strictEqual(layer.children.length, 1);
        assert.strictEqual(layer.children[0], sprite);
        assert.strictEqual(sprite.parent, layer);
    });

    it('addToLayer() 应发射 render:layer-changed 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:layer-changed', (data) => {
            events.push(data);
        });

        const sprite = new PIXIContainerMock();
        layerStack.addToLayer(1, sprite);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].layerIndex, 1);
        assert.strictEqual(events[0].action, 'add');
    });

    it('removeFromLayer() 应从指定层移除对象', () => {
        const sprite = new PIXIContainerMock();
        layerStack.addToLayer(4, sprite);
        assert.strictEqual(layerStack.getLayer(4).children.length, 1);

        layerStack.removeFromLayer(4, sprite);
        assert.strictEqual(layerStack.getLayer(4).children.length, 0);
        assert.strictEqual(sprite.parent, null);
    });

    it('removeFromLayer() 应发射 render:layer-changed 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:layer-changed', (data) => {
            events.push(data);
        });

        const sprite = new PIXIContainerMock();
        layerStack.addToLayer(2, sprite);
        events.length = 0; // 清空 add 事件

        layerStack.removeFromLayer(2, sprite);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].layerIndex, 2);
        assert.strictEqual(events[0].action, 'remove');
    });

    it('getLayer() 应返回对应的图层容器', () => {
        const layer0 = layerStack.getLayer(0);
        const layer7 = layerStack.getLayer(7);

        assert.ok(layer0 instanceof PIXIContainerMock);
        assert.ok(layer7 instanceof PIXIContainerMock);
        assert.notStrictEqual(layer0, layer7);
    });

    it('索引越界时 addToLayer 应抛出 RangeError', () => {
        assert.throws(() => {
            layerStack.addToLayer(-1, new PIXIContainerMock());
        }, RangeError);

        assert.throws(() => {
            layerStack.addToLayer(8, new PIXIContainerMock());
        }, RangeError);

        assert.throws(() => {
            layerStack.addToLayer(3.5, new PIXIContainerMock());
        }, RangeError);
    });

    it('索引越界时 removeFromLayer 应抛出 RangeError', () => {
        assert.throws(() => {
            layerStack.removeFromLayer(-1, new PIXIContainerMock());
        }, RangeError);

        assert.throws(() => {
            layerStack.removeFromLayer(8, new PIXIContainerMock());
        }, RangeError);
    });

    it('索引越界时 getLayer 应抛出 RangeError', () => {
        assert.throws(() => {
            layerStack.getLayer(-1);
        }, RangeError);

        assert.throws(() => {
            layerStack.getLayer(99);
        }, RangeError);
    });
});

describe('LayerStack - 清空与销毁', () => {
    /** @type {import('../LayerStack.mjs').LayerStack} */
    let layerStack;
    /** @type {PIXIContainerMock} */
    let rootContainer;
    /** @type {PIXIContainerMock} */
    let uiContainer;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        rootContainer = new PIXIContainerMock();
        uiContainer = new PIXIContainerMock();
        const { LayerStack } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('clear() 应清空所有图层的子对象', () => {
        // 向多个层添加对象
        for (let i = 0; i < 8; i++) {
            layerStack.addToLayer(i, new PIXIContainerMock());
        }

        // 验证每层都有对象
        for (let i = 0; i < 8; i++) {
            assert.strictEqual(layerStack.getLayer(i).children.length, 1);
        }

        layerStack.clear();

        // 验证所有层被清空
        for (let i = 0; i < 8; i++) {
            assert.strictEqual(layerStack.getLayer(i).children.length, 0);
        }
    });

    it('clear() 应发射 render:layer-changed 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:layer-changed', (data) => {
            events.push(data);
        });

        layerStack.clear();

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].action, 'clear');
    });

    it('destroy() 应销毁所有图层容器', () => {
        layerStack.destroy();

        // rootContainer 的子容器应从其下移除
        assert.strictEqual(rootContainer.children.length, 0);
        assert.strictEqual(uiContainer.children.length, 0);
    });
});

describe('LayerStack - 容器引用', () => {
    /** @type {import('../LayerStack.mjs').LayerStack} */
    let layerStack;
    /** @type {PIXIContainerMock} */
    let rootContainer;
    /** @type {PIXIContainerMock} */
    let uiContainer;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        rootContainer = new PIXIContainerMock();
        uiContainer = new PIXIContainerMock();
        const { LayerStack } = await import('../LayerStack.mjs');
        layerStack = new LayerStack(rootContainer, uiContainer);
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('getRootContainer() 应返回 rootContainer', () => {
        assert.strictEqual(layerStack.getRootContainer(), rootContainer);
    });

    it('getUIContainer() 应返回 uiContainer', () => {
        assert.strictEqual(layerStack.getUIContainer(), uiContainer);
    });
});
