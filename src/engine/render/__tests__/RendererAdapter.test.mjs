// @ts-check

/**
 * @fileoverview
 * RendererAdapter 抽象接口单元测试
 *
 * 测试覆盖：
 * - 抽象类不可直接实例化
 * - 所有抽象方法抛出 "not implemented" 错误
 * - 子类正确实现后功能正常
 *
 * @module render/__tests__/RendererAdapter.test
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { RendererAdapter } from '../RendererAdapter.mjs';

describe('RendererAdapter - 抽象基类', () => {

    it('直接实例化应抛出错误', () => {
        assert.throws(() => {
            new RendererAdapter();
        }, /抽象基类|不能直接实例化/);
    });

    it('未实现方法的子类调用应抛出 NotImplemented 错误', () => {
        class IncompleteAdapter extends RendererAdapter {}

        const adapter = new IncompleteAdapter();

        assert.rejects(async () => {
            await adapter.init(null);
        }, /未实现 init/);

        assert.throws(() => {
            adapter.render(null);
        }, /未实现 render/);

        assert.throws(() => {
            adapter.resize(100, 100);
        }, /未实现 resize/);

        assert.rejects(async () => {
            await adapter.destroy();
        }, /未实现 destroy/);

        assert.throws(() => {
            adapter.getRenderer();
        }, /未实现 getRenderer/);

        assert.throws(() => {
            adapter.getCanvas();
        }, /未实现 getCanvas/);
    });

    it('正确实现的子类应能正常实例化并调用方法', () => {
        class MockAdapter extends RendererAdapter {
            async init(container, options = {}) {
                this._options = { ...options };
                this._initialized = true;
            }
            render(stage) { /* no-op */ }
            resize(w, h) { /* no-op */ }
            async destroy() { this._initialized = false; }
            getRenderer() { return null; }
            getCanvas() { return null; }
        }

        const adapter = new MockAdapter();
        assert.strictEqual(adapter.isInitialized, false);

        adapter.init(null, { width: 960 });
        assert.strictEqual(adapter.isInitialized, true);
        assert.strictEqual(adapter._options.width, 960);
    });
});
