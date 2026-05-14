// @ts-check

/**
 * @fileoverview
 * SceneGraph 单元测试（T11 — RenderNode 数据结构与场景图管理）。
 *
 * 测试覆盖：
 * - RenderNode 构造与 ID 生成
 * - add / get / has 查询
 * - remove 清理链
 * - getAllInLayer 层内查询
 * - move / setVisible / setSortKey 属性更新
 * - count / countInLayer 统计
 * - clear / destroy 生命周期
 *
 * @module __tests__/SceneGraph
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ==================== 模拟依赖 ====================

/** 模拟 PIXI.Container */
class MockPixiContainer {
    constructor(name = '') {
        this.name = name;
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
        this.visible = true;
        this.parent = null;
        this._destroyed = false;
        this._children = [];
    }

    destroy(options) {
        this._destroyed = true;
        if (this.parent && this.parent.removeChild) {
            this.parent.removeChild(this);
        }
    }
}

/** 模拟 LayerStack */
class MockLayerStack {
    constructor() {
        /** @type {Array<{ name: string, children: MockPixiContainer[] }>} */
        this.layers = [];
        for (let i = 0; i < 8; i++) {
            this.layers.push({ name: `Layer_${i}`, children: [] });
        }
        /** @type {Array<{action: string, layerIndex: number, child: any}>} */
        this.events = [];
    }

    /** @param {number} index */
    _validateLayerIndex(index) {
        if (!Number.isInteger(index) || index < 0 || index > 7) {
            throw new RangeError(`无效图层索引: ${index}`);
        }
    }

    /**
     * @param {number} layerIndex
     * @param {MockPixiContainer} child
     */
    addToLayer(layerIndex, child) {
        this._validateLayerIndex(layerIndex);
        this.layers[layerIndex].children.push(child);
        child.parent = this.layers[layerIndex];
        this.events.push({ action: 'add', layerIndex, child });
    }

    /**
     * @param {number} layerIndex
     * @param {MockPixiContainer} child
     */
    removeFromLayer(layerIndex, child) {
        this._validateLayerIndex(layerIndex);
        const idx = this.layers[layerIndex].children.indexOf(child);
        if (idx !== -1) {
            this.layers[layerIndex].children.splice(idx, 1);
            child.parent = null;
            this.events.push({ action: 'remove', layerIndex, child });
        }
    }

    /** @param {number} index */
    getLayer(index) {
        return this.layers[index];
    }
}

/** 模拟 SortManager */
class MockSortManager {
    constructor() {
        /** @type {number[]} */
        this.dirtyLayers = [];
    }
    markDirty(layerIndex) {
        this.dirtyLayers.push(layerIndex);
    }
}

// ==================== 导入待测模块 ====================

import { SceneGraph } from '../SceneGraph.mjs';
import { EventBus } from '../../core/EventBus.mjs';

// ==================== 测试套件 ====================

describe('SceneGraph - T11: add 添加节点', () => {
    /** @type {SceneGraph} */
    let sg;
    /** @type {MockLayerStack} */
    let ls;

    before(() => {
        ls = new MockLayerStack();
        sg = new SceneGraph(/** @type {any} */ (ls));
    });

    after(() => {
        sg.destroy();
    });

    it('add 返回正整数 ID', () => {
        const id = sg.add(1, new MockPixiContainer('test'));
        assert.ok(typeof id === 'number' && id > 0);
    });

    it('多次 add 返回递增的 ID', () => {
        const id1 = sg.add(1, new MockPixiContainer('a'));
        const id2 = sg.add(1, new MockPixiContainer('b'));
        assert.ok(id2 > id1);
    });

    it('add 后容器被添加到正确的层', () => {
        const container = new MockPixiContainer('ground');
        sg.add(1, container);
        assert.strictEqual(ls.layers[1].children.includes(container), true);
    });

    it('add 后同步 visible 和 zIndex', () => {
        const container = new MockPixiContainer('visible-test');
        sg.add(2, container, { sortKey: 500, visible: false });

        assert.strictEqual(container.visible, false);
        assert.strictEqual(container.zIndex, 500);
    });

    it('add 触发 render:node-added 事件', () => {
        const events = [];
        const handler = (/** @type {any} */ data) => events.push(data);
        EventBus.getInstance().on('render:node-added', handler);

        const container = new MockPixiContainer('event-test');
        const id = sg.add(4, container, { sortKey: 300 });

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].id, id);
        assert.strictEqual(events[0].layerIndex, 4);
        assert.strictEqual(events[0].sortKey, 300);
        assert.strictEqual(events[0].container, container);

        EventBus.getInstance().off('render:node-added', handler);
    });
});

describe('SceneGraph - T11: get / has 查询', () => {
    /** @type {SceneGraph} */
    let sg;

    before(() => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
    });

    after(() => {
        sg.destroy();
    });

    it('get 返回正确的节点数据', () => {
        const container = new MockPixiContainer('query');
        const id = sg.add(1, container, { sortKey: 100 });

        const node = sg.get(id);
        assert.ok(node !== undefined);
        assert.strictEqual(node.id, id);
        assert.strictEqual(node.container, container);
        assert.strictEqual(node.sortKey, 100);
        assert.strictEqual(node.visible, true);
    });

    it('get 不存在的 ID 返回 undefined', () => {
        assert.strictEqual(sg.get(99999), undefined);
    });

    it('has 返回正确布尔值', () => {
        const id = sg.add(1, new MockPixiContainer('exists'));
        assert.strictEqual(sg.has(id), true);
        assert.strictEqual(sg.has(99999), false);
    });
});

describe('SceneGraph - T11: remove 移除节点', () => {
    /** @type {SceneGraph} */
    let sg;
    /** @type {MockLayerStack} */
    let ls;

    before(() => {
        ls = new MockLayerStack();
        sg = new SceneGraph(/** @type {any} */ (ls));
    });

    after(() => {
        sg.destroy();
    });

    it('remove 移除后容器被销毁', () => {
        const container = new MockPixiContainer('destroy-me');
        const id = sg.add(3, container);

        sg.remove(id);

        assert.strictEqual(container._destroyed, true);
        // 已从层中移除
        assert.strictEqual(ls.layers[3].children.includes(container), false);
    });

    it('remove 后 get 返回 undefined', () => {
        const id = sg.add(1, new MockPixiContainer('gone'));
        sg.remove(id);
        assert.strictEqual(sg.get(id), undefined);
    });

    it('remove 不存在的 ID 返回 false', () => {
        assert.strictEqual(sg.remove(99999), false);
    });

    it('remove 调用 onRemove 回调', () => {
        let callbackCalled = false;
        const container = new MockPixiContainer('callback');
        const id = sg.add(1, container, {
            onRemove: () => { callbackCalled = true; }
        });

        sg.remove(id);
        assert.strictEqual(callbackCalled, true);
    });

    it('remove 触发 render:node-removed 事件', () => {
        const events = [];
        const handler = (/** @type {any} */ data) => events.push(data);
        EventBus.getInstance().on('render:node-removed', handler);

        const container = new MockPixiContainer('event-remove');
        const id = sg.add(4, container);
        sg.remove(id);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].id, id);
        assert.strictEqual(events[0].layerIndex, 4);

        EventBus.getInstance().off('render:node-removed', handler);
    });

    it('remove 标记 SortManager 脏层', () => {
        const sortManager = new MockSortManager();
        const sg2 = new SceneGraph(/** @type {any} */ (new MockLayerStack()), /** @type {any} */ (sortManager));

        const id = sg2.add(1, new MockPixiContainer('dirty'));
        sg2.remove(id);

        assert.ok(sortManager.dirtyLayers.includes(1));

        sg2.destroy();
    });

    it('remove 触发 render:node-will-remove 事件', () => {
        const events = [];
        const handler = (/** @type {any} */ data) => events.push(data);
        EventBus.getInstance().on('render:node-will-remove', handler);

        const container = new MockPixiContainer('will-remove');
        const id = sg.add(1, container);
        sg.remove(id);

        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].id, id);
        assert.strictEqual(events[0].layerIndex, 1);
        assert.strictEqual(events[0].container, container);

        EventBus.getInstance().off('render:node-will-remove', handler);
    });
});

describe('SceneGraph - T11: getAllInLayer 层内查询', () => {
    /** @type {SceneGraph} */
    let sg;

    before(() => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
    });

    after(() => {
        sg.destroy();
    });

    it('返回指定层的所有节点', () => {
        sg.add(1, new MockPixiContainer('a'));
        sg.add(1, new MockPixiContainer('b'));
        sg.add(4, new MockPixiContainer('c')); // 不同层

        const layer1Nodes = sg.getAllInLayer(1);
        assert.strictEqual(layer1Nodes.length, 2);

        const layer4Nodes = sg.getAllInLayer(4);
        assert.strictEqual(layer4Nodes.length, 1);
    });

    it('空层返回空数组', () => {
        const nodes = sg.getAllInLayer(7);
        assert.deepStrictEqual(nodes, []);
    });

    it('移除后 getAllInLayer 数量同步减少', () => {
        const id = sg.add(3, new MockPixiContainer('remove-count'));
        assert.strictEqual(sg.getAllInLayer(3).length, 1);

        sg.remove(id);
        assert.strictEqual(sg.getAllInLayer(3).length, 0);
    });
});

describe('SceneGraph - T11: move / setVisible / setSortKey', () => {
    /** @type {SceneGraph} */
    let sg;

    before(() => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
    });

    after(() => {
        sg.destroy();
    });

    it('move 更新容器的 x/y', () => {
        const container = new MockPixiContainer('move');
        const id = sg.add(1, container);

        sg.move(id, 150, 250);
        assert.strictEqual(container.x, 150);
        assert.strictEqual(container.y, 250);
    });

    it('move 不存在的 ID 返回 false', () => {
        assert.strictEqual(sg.move(99999, 0, 0), false);
    });

    it('setVisible 同步到容器和节点', () => {
        const container = new MockPixiContainer('vis');
        const id = sg.add(1, container);

        sg.setVisible(id, false);
        assert.strictEqual(container.visible, false);
        assert.strictEqual(sg.get(id).visible, false);

        sg.setVisible(id, true);
        assert.strictEqual(container.visible, true);
    });

    it('setSortKey 同步 zIndex 并标记 SortManager 脏', () => {
        const sortManager = new MockSortManager();
        const sg2 = new SceneGraph(/** @type {any} */ (new MockLayerStack()), /** @type {any} */ (sortManager));

        const container = new MockPixiContainer('sort');
        const id = sg2.add(2, container, { sortKey: 100 });

        sg2.setSortKey(id, 500);
        assert.strictEqual(container.zIndex, 500);
        assert.strictEqual(sg2.get(id).sortKey, 500);
        assert.ok(sortManager.dirtyLayers.includes(2));

        sg2.destroy();
    });
});

describe('SceneGraph - T11: count / countInLayer 统计', () => {
    /** @type {SceneGraph} */
    let sg;

    before(() => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
    });

    after(() => {
        sg.destroy();
    });

    it('初始 count 为 0', () => {
        assert.strictEqual(sg.count, 0);
    });

    it('add 后 count 递增', () => {
        sg.add(1, new MockPixiContainer('a'));
        assert.strictEqual(sg.count, 1);

        sg.add(4, new MockPixiContainer('b'));
        assert.strictEqual(sg.count, 2);
    });

    it('remove 后 count 递减', () => {
        const id = sg.add(5, new MockPixiContainer('c'));
        assert.strictEqual(sg.count, 3);

        sg.remove(id);
        assert.strictEqual(sg.count, 2);
    });

    it('countInLayer 返回正确的层内数量', () => {
        assert.strictEqual(sg.countInLayer(1), 1);
        assert.strictEqual(sg.countInLayer(4), 1);
        assert.strictEqual(sg.countInLayer(5), 0);
    });
});

describe('SceneGraph - T11: clear 清空', () => {
    /** @type {SceneGraph} */
    let sg;

    before(() => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
    });

    after(() => {
        sg.destroy();
    });

    it('clear 后 count 为 0', () => {
        sg.add(1, new MockPixiContainer('a'));
        sg.add(2, new MockPixiContainer('b'));
        sg.add(3, new MockPixiContainer('c'));

        sg.clear();
        assert.strictEqual(sg.count, 0);
    });

    it('clear 后所有容器被销毁', () => {
        // 重新添加
        const c1 = new MockPixiContainer('x');
        const c2 = new MockPixiContainer('y');
        sg.add(1, c1);
        sg.add(4, c2);

        sg.clear();
        assert.strictEqual(c1._destroyed, true);
        assert.strictEqual(c2._destroyed, true);
    });

    it('clear 后仍可继续添加', () => {
        const id = sg.add(1, new MockPixiContainer('after-clear'));
        assert.ok(id > 0);
        assert.strictEqual(sg.count, 1);
    });
});

describe('SceneGraph - T11: destroy 销毁', () => {
    /** @type {SceneGraph} */
    let sg;

    it('destroy 后 count 为 0', () => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
        sg.add(1, new MockPixiContainer('a'));
        sg.destroy();
        assert.strictEqual(sg.count, 0);
    });

    it('destroy 后 add 返回 -1', () => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
        sg.destroy();
        assert.strictEqual(sg.add(1, new MockPixiContainer('post-destroy')), -1);
    });

    it('destroy 后 remove 返回 false', () => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
        sg.destroy();
        assert.strictEqual(sg.remove(1), false);
    });

    it('多次 destroy 不报错', () => {
        sg = new SceneGraph(/** @type {any} */ (new MockLayerStack()));
        sg.destroy();
        sg.destroy();
    });
});
