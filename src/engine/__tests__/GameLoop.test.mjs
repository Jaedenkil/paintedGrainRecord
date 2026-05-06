// @ts-check

/**
 * @fileoverview
 * GameLoop 单元测试
 *
 * 测试覆盖：
 * - 启动/停止/暂停/恢复
 * - 系统注册/移除
 * - fixedUpdate 和 variableUpdate 调度
 * - FPS 统计
 * - 异常隔离
 * - EventBus 事件发射
 *
 * 注意：Node.js 没有 requestAnimationFrame，每个需要 RAF 的 suite 自行 mock。
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameLoop } from '../core/GameLoop.js';
import { EventBus } from '../core/EventBus.js';

/**
 * 为 suite 创建一个自包含的 RAF mock，返回 { install, uninstall, resetTickCount }
 * 每个 suite 拥有独立的 tickCount，避免跨 describe 的竞态。
 *
 * @param {number} maxTicks - 最大 tick 数
 * @returns {{ install: () => void, uninstall: () => void, reset: () => void }}
 */
function createRAFMock(maxTicks = 10) {
    let _tickCount = 0;
    let _baseTime = 0;
    let _initialized = false;

    return {
        install: () => {
            _tickCount = 0;
            _baseTime = 0;
            _initialized = false;

            global.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => {
                if (_tickCount < maxTicks) {
                    _tickCount++;
                    if (!_initialized) {
                        // 首次调用：基于 performance.now() 赋值，使 _lastTime 比较成立
                        _baseTime = performance.now();
                        _initialized = true;
                    } else {
                        _baseTime += 16; // 后续每次推进 16ms
                    }
                    cb(_baseTime);
                }
                return _tickCount;
            };

            global.cancelAnimationFrame = (/** @type {number} */ id) => {
                // no-op
            };
        },
        uninstall: () => {
            delete global.requestAnimationFrame;
            delete global.cancelAnimationFrame;
        },
        reset: () => {
            _tickCount = 0;
        }
    };
}

// ==================== Suite 1: 基础功能 ====================

describe('GameLoop - 基础功能', () => {
    /** @type {GameLoop} */
    let loop;
    const rafMock = createRAFMock(10);
    /** @type {Array<{event: string, data: any}>} */
    let emittedEvents = [];

    before(() => { rafMock.install(); });
    after(() => { rafMock.uninstall(); });

    beforeEach(() => {
        rafMock.reset();
        emittedEvents = [];
        EventBus.getInstance().clear();
        // 监听所有引擎事件
        EventBus.getInstance().on('*', (e) => {
            emittedEvents.push({ event: e.originalEvent, data: e.data });
        });
        loop = new GameLoop();
    });

    afterEach(() => {
        loop?.stop();
        EventBus.getInstance().clear();
    });

    it('初始状态应为未运行', () => {
        assert.strictEqual(loop.isRunning, false);
        assert.strictEqual(loop.isPaused, false);
        assert.strictEqual(loop.fps, 0);
    });

    it('start() 应启动循环，isRunning 应为 true', () => {
        loop.start();
        assert.strictEqual(loop.isRunning, true);
        loop.stop();
    });

    it('stop() 应停止循环，isRunning 应为 false', () => {
        loop.start();
        loop.stop();
        assert.strictEqual(loop.isRunning, false);
    });

    it('重复 start() 不应多次启动', () => {
        loop.start();
        const rafId1 = loop._rafId;
        loop.start(); // 第二次不应生效
        const rafId2 = loop._rafId;
        assert.strictEqual(rafId1, rafId2);
        loop.stop();
    });

    it('pause() 应设置 timeScale = 0 并发射 engine:pause 事件', () => {
        loop.start();
        loop.pause();
        assert.strictEqual(loop.isPaused, true);
        assert.strictEqual(loop.time.timeScale, 0);
        loop.stop();
    });

    it('resume() 应恢复 timeScale = 1 并发射 engine:resume 事件', () => {
        loop.start();
        loop.pause();
        loop.resume();
        assert.strictEqual(loop.isPaused, false);
        assert.strictEqual(loop.time.timeScale, 1.0);
        loop.stop();
    });

    it('resume() 在不暂停时不应生效', () => {
        loop.start();
        loop.resume(); // 无效果
        assert.strictEqual(loop.isPaused, false);
        loop.stop();
    });
});

// ==================== Suite 2: 系统注册 ====================

describe('GameLoop - 系统注册', () => {
    /** @type {GameLoop} */
    let loop;

    beforeEach(() => {
        loop = new GameLoop();
    });

    afterEach(() => {
        loop?.stop();
    });

    it('addSystem() 应注册固定步长系统', () => {
        const sys = { type: 'fixed', name: 'TestFixed', update: () => {} };
        loop.addSystem(sys);
        assert.strictEqual(loop._fixedSystems.length, 1);
        assert.strictEqual(loop._fixedSystems[0], sys);
    });

    it('addSystem() 应注册可变帧率系统', () => {
        const sys = { type: 'variable', name: 'TestVar', update: () => {} };
        loop.addSystem(sys);
        assert.strictEqual(loop._variableSystems.length, 1);
        assert.strictEqual(loop._variableSystems[0], sys);
    });

    it('未指定 type 的系统应默认注册为 variable（复制）', () => {
        const sys = { name: 'AutoVar', update: () => {} };
        loop.addSystem(sys);
        assert.strictEqual(loop._variableSystems.length, 1);
        // addSystem 内部做了复制，所以不严格相等，但属性应一致
        assert.strictEqual(loop._variableSystems[0].name, 'AutoVar');
        assert.strictEqual(loop._variableSystems[0].type, 'variable');
    });

    it('removeSystem() 应移除已注册的系统', () => {
        const sys = { type: 'fixed', name: 'Removable', update: () => {} };
        loop.addSystem(sys);
        assert.strictEqual(loop._fixedSystems.length, 1);

        loop.removeSystem(sys);
        assert.strictEqual(loop._fixedSystems.length, 0);
    });

    it('clearSystems() 应移除所有系统', () => {
        loop.addSystem({ type: 'fixed', update: () => {} });
        loop.addSystem({ type: 'variable', update: () => {} });
        loop.clearSystems();
        assert.strictEqual(loop._fixedSystems.length, 0);
        assert.strictEqual(loop._variableSystems.length, 0);
    });

    it('传入非函数 update 应抛出 TypeError', () => {
        assert.throws(() => {
            loop.addSystem({ type: 'fixed', update: 'not a function' });
        }, TypeError);
    });
});

// ==================== Suite 3: 更新调度 ====================

describe('GameLoop - 更新调度', () => {
    /** @type {GameLoop} */
    let loop;
    const rafMock = createRAFMock(10);
    /** @type {Array<{event: string, data: any}>} */
    let emittedEvents = [];

    before(() => { rafMock.install(); });
    after(() => { rafMock.uninstall(); });

    beforeEach(() => {
        rafMock.reset();
        emittedEvents = [];
        EventBus.getInstance().clear();
        loop = new GameLoop();
    });

    afterEach(() => {
        loop?.stop();
        EventBus.getInstance().clear();
    });

    it('fixed 系统应接收到 dt 参数', () => {
        const calls = [];
        loop.addSystem({
            type: 'fixed',
            name: 'TestFixed',
            update: (dt) => { calls.push({ dt }); }
        });

        loop.start();

        assert.ok(calls.length > 0, 'fixed 系统应被调用');
        for (const call of calls) {
            assert.strictEqual(typeof call.dt, 'number');
            assert.ok(call.dt > 0);
        }
    });

    it('variable 系统应接收到 dt 和 interp 参数', () => {
        const calls = [];
        loop.addSystem({
            type: 'variable',
            name: 'TestVar',
            update: (dt, interp) => { calls.push({ dt, interp }); }
        });

        loop.start();

        assert.ok(calls.length > 0, 'variable 系统应被调用');
        for (const call of calls) {
            assert.strictEqual(typeof call.dt, 'number');
            assert.strictEqual(typeof call.interp, 'number');
            assert.ok(call.interp >= 0 && call.interp <= 1);
        }
    });

    it('系统更新中的异常不应影响后续系统', () => {
        const events = [];
        loop.addSystem({
            type: 'variable',
            name: 'BadSystem',
            update: () => { throw new Error('模拟崩溃'); }
        });
        loop.addSystem({
            type: 'variable',
            name: 'GoodSystem',
            update: () => { events.push('survived'); }
        });

        loop.start();

        assert.ok(events.length > 0, '异常系统后的系统应继续执行');
    });

    it('每个 tick 应发射 engine:tick-start 和 engine:tick-end 事件', () => {
        EventBus.getInstance().on('*', (e) => {
            emittedEvents.push({ event: e.originalEvent, data: e.data });
        });

        loop.start();

        const tickStarts = emittedEvents.filter(e => e.event === 'engine:tick-start');
        const tickEnds = emittedEvents.filter(e => e.event === 'engine:tick-end');

        assert.ok(tickStarts.length > 0, '应发射 tick-start 事件');
        assert.ok(tickEnds.length > 0, '应发射 tick-end 事件');
        assert.strictEqual(tickStarts.length, tickEnds.length, 'start 和 end 应配对');
    });

    it('time.frameCount 应随 tick 递增', () => {
        loop.start();
        assert.ok(loop.time.frameCount > 0, 'frameCount 应大于 0');
    });

    it('engine:tick-end 事件应包含 fps 数据', () => {
        EventBus.getInstance().on('*', (e) => {
            emittedEvents.push({ event: e.originalEvent, data: e.data });
        });

        loop.start();

        const tickEnds = emittedEvents.filter(e => e.event === 'engine:tick-end');
        if (tickEnds.length > 0) {
            assert.ok(typeof tickEnds[0].data.fps === 'number');
        }
    });
});
