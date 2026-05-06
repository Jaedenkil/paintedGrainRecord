// @ts-check

/**
 * @fileoverview
 * EventBus 单元测试
 *
 * 测试覆盖范围：
 * - 单例模式
 * - 基本 on/emit/off
 * - once 一次性监听
 * - 通配符监听（module:*）
 * - 全局通配符（*）
 * - context 绑定与 removeContext 批量清理
 * - 异常隔离（单个回调崩溃不影响其他）
 * - 销毁后状态
 *
 * 运行方式：
 *   node --test src/engine/__tests__/EventBus.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/EventBus.js';

// === 基础测试 ====================================================

describe('EventBus - 基础功能', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('应该返回单例实例', () => {
        const instance1 = EventBus.getInstance();
        const instance2 = EventBus.getInstance();
        assert.strictEqual(instance1, instance2, '多次 getInstance 应返回同一实例');
    });

    it('应该能注册监听器并接收事件', () => {
        const events = [];
        bus.on('test:basic', (data) => events.push(data));
        bus.emit('test:basic', { msg: 'hello' });
        assert.deepStrictEqual(events, [{ msg: 'hello' }]);
    });

    it('on() 应该返回取消订阅函数', () => {
        const events = [];
        const unsub = bus.on('test:unsub', (data) => events.push(data));
        bus.emit('test:unsub', { n: 1 });
        unsub(); // 取消订阅
        bus.emit('test:unsub', { n: 2 });
        assert.deepStrictEqual(events, [{ n: 1 }], '取消后不应再收到事件');
    });

    it('once() 应该只触发一次', () => {
        const events = [];
        bus.once('test:once', (data) => events.push(data));
        bus.emit('test:once', { seq: 1 });
        bus.emit('test:once', { seq: 2 });
        bus.emit('test:once', { seq: 3 });
        assert.strictEqual(events.length, 1, 'once 应只触发一次');
        assert.deepStrictEqual(events[0], { seq: 1 });
    });

    it('off() 应该移除指定监听器', () => {
        const events = [];
        const fn = (data) => events.push(data);
        bus.on('test:off', fn);
        bus.emit('test:off', { x: 1 });
        bus.off('test:off', fn);
        bus.emit('test:off', { x: 2 });
        assert.deepStrictEqual(events, [{ x: 1 }]);
    });

    it('无监听器时 emit 不应抛出异常', () => {
        bus.emit('test:nonexistent', {});
        assert.ok(true, '发射不存在的监听事件不应抛出异常');
    });

    it('空事件名应打印警告但不抛出异常', () => {
        bus.emit('', {});
        assert.ok(true, '空事件名应安全忽略');
    });
});

// === 通配符测试 =================================================

describe('EventBus - 通配符监听', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('模块通配符 module:* 应匹配该模块所有事件', () => {
        const wildcardEvents = [];
        bus.on('player:*', (e) => wildcardEvents.push(e));

        bus.emit('player:damaged', { amount: 10 });
        bus.emit('player:moved', { x: 5, y: 3 });
        bus.emit('enemy:spawned', { id: 1 }); // 不应匹配

        assert.strictEqual(wildcardEvents.length, 2, 'player:* 应收到 2 个事件');
        assert.strictEqual(wildcardEvents[0].originalEvent, 'player:damaged');
        assert.strictEqual(wildcardEvents[1].originalEvent, 'player:moved');
    });

    it('全局通配符 * 应匹配所有事件', () => {
        const allEvents = [];
        bus.on('*', (e) => allEvents.push(e.originalEvent));

        bus.emit('a:1', {});
        bus.emit('b:2', {});
        bus.emit('c:3', {});

        assert.strictEqual(allEvents.length, 3);
        assert.deepStrictEqual(allEvents, ['a:1', 'b:2', 'c:3']);
    });

    it('精确监听和通配符监听应同时触发', () => {
        const exact = [];
        const wildcard = [];
        const global = [];

        bus.on('test:fire', (d) => exact.push(d));
        bus.on('test:*', (e) => wildcard.push(e));
        bus.on('*', (e) => global.push(e));

        bus.emit('test:fire', { val: 42 });

        assert.strictEqual(exact.length, 1, '精确监听应触发');
        assert.strictEqual(wildcard.length, 1, '通配监听应触发');
        assert.strictEqual(global.length, 1, '全局监听应触发');
    });
});

// === Context 清理测试 ============================================

describe('EventBus - Context 生命周期管理', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('removeContext 应移除该上下文关联的所有监听器', () => {
        const context = { name: 'scene_1' };
        const events = [];

        bus.on('test:ctx1', (d) => events.push(d), context);
        bus.on('test:ctx2', (d) => events.push(d), context);
        // 无上下文的监听器不受影响
        bus.on('test:ctx1', (d) => events.push(d));

        bus.emit('test:ctx1', { from: 'ctx1' });
        bus.emit('test:ctx2', { from: 'ctx2' });

        // 清理 context
        bus.removeContext(context);
        bus.emit('test:ctx1', { from: 'after_remove' });
        bus.emit('test:ctx2', { from: 'after_remove' });

        // 应该收到：ctx1(2次: 有context + 无context) + ctx2(1次: 有context)
        // 清理后：ctx1(1次: 无context) + ctx2(0次)
        assert.strictEqual(events.length, 4, '清理 context 后应减少 2 次回调');
    });

    it('多次 removeContext 相同 context 不应报错', () => {
        const context = { fragile: true };
        bus.on('test:fragile', () => {}, context);

        bus.removeContext(context);
        // 第二次调用应安全
        bus.removeContext(context);
        assert.ok(true, '重复 removeContext 不应抛出异常');
    });

    it('未绑定 context 的监听器不受 removeContext 影响', () => {
        const events = [];
        bus.on('test:nocontext', (d) => events.push(d));

        bus.removeContext({ some: 'random' });
        bus.emit('test:nocontext', { survived: true });

        assert.strictEqual(events.length, 1, '无 context 的监听器应不受影响');
    });
});

// === hasListener 和 listenerCount 测试 ===========================

describe('EventBus - 查询方法', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('hasListener 应正确反映监听器存在状态', () => {
        assert.strictEqual(bus.hasListener('test:check'), false);

        const fn = () => {};
        bus.on('test:check', fn);
        assert.strictEqual(bus.hasListener('test:check'), true);

        bus.off('test:check', fn);
        assert.strictEqual(bus.hasListener('test:check'), false);
    });

    it('listenerCount 应返回正确的监听器数量', () => {
        bus.on('test:count', () => {});
        bus.on('test:count', () => {});
        bus.on('test:count', () => {});

        assert.strictEqual(bus.listenerCount('test:count'), 3);

        bus.clear();
        assert.strictEqual(bus.listenerCount('test:count'), 0);
    });
});

// === 异常隔离测试 ===============================================

describe('EventBus - 异常隔离', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('某个监听器抛出异常不应影响其他监听器', () => {
        const events = [];

        bus.on('test:err', () => {
            throw new Error('模拟崩溃');
        });
        bus.on('test:err', (d) => events.push(d));

        // 不应抛出异常
        bus.emit('test:err', { survived: true });

        assert.strictEqual(events.length, 1, '异常监听器后的正常监听器应继续执行');
        assert.deepStrictEqual(events[0], { survived: true });
    });
});

// === 销毁测试 ===================================================

describe('EventBus - 销毁', () => {
    it('销毁后应清空所有状态', () => {
        // 重建单例用于销毁测试
        // 注意：这会重置全局单例
        const bus = EventBus.getInstance();

        bus.on('test:dead', () => {});
        bus.on('test:dead2', () => {});
        bus.on('*', () => {});

        bus.destroy();

        // 销毁后应重新创建
        const newBus = EventBus.getInstance();
        assert.strictEqual(newBus.listenerCount('test:dead'), 0, '销毁后应无残留监听器');
        assert.strictEqual(newBus.listenerCount('*'), 0);
    });
});

// === callback 类型校验 ==========================================

describe('EventBus - 参数校验', () => {
    let bus;

    before(() => {
        bus = EventBus.getInstance();
    });

    after(() => {
        bus.clear();
    });

    it('传入非函数 callback 应抛出 TypeError', () => {
        assert.throws(() => {
            bus.on('test:bad', 'not a function');
        }, TypeError);
    });
});
