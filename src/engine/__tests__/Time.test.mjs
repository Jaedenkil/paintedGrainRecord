// @ts-check

/**
 * @fileoverview
 * Time 单元测试
 *
 * 测试覆盖：
 * - 基础时间数据更新
 * - timeScale 缩放
 * - createTimer / delay / cancel
 * - 计时器循环
 * - pauseAllTimers / resumeAllTimers
 * - reset
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Time } from '../core/Time.js';

describe('Time - 基础功能', () => {
    let time;

    before(() => { time = new Time(); });
    after(() => { time.reset(); });

    it('初始值应为 0', () => {
        assert.strictEqual(time.deltaTime, 0);
        assert.strictEqual(time.unscaledDeltaTime, 0);
        assert.strictEqual(time.frameCount, 0);
        assert.strictEqual(time.realtimeSinceStartup, 0);
        assert.strictEqual(time.timeScale, 1.0);
    });

    it('update() 应更新所有时间数据', () => {
        time.update(0.016); // 模拟 16ms 帧间隔

        assert.strictEqual(time.unscaledDeltaTime, 0.016);
        assert.strictEqual(time.deltaTime, 0.016);
        assert.strictEqual(time.frameCount, 1);
        assert(Math.abs(time.realtimeSinceStartup - 0.016) < 0.0001);
    });

    it('多次 update 应累加 frameCount 和 realtime', () => {
        time.update(0.016);
        time.update(0.016);
        time.update(0.016);

        assert.strictEqual(time.frameCount, 4); // 1 + 3
        assert(Math.abs(time.realtimeSinceStartup - 0.064) < 0.0001);
    });

    it('reset() 应重置所有数据', () => {
        time.update(0.1);
        time.update(0.1);
        time.reset();

        assert.strictEqual(time.deltaTime, 0);
        assert.strictEqual(time.frameCount, 0);
        assert.strictEqual(time.realtimeSinceStartup, 0);
    });
});

describe('Time - timeScale', () => {
    let time;

    before(() => { time = new Time(); });
    after(() => { time.reset(); });

    it('timeScale = 0.5 应使 deltaTime 减半', () => {
        time.timeScale = 0.5;
        time.update(0.1);

        assert.strictEqual(time.unscaledDeltaTime, 0.1);
        assert.strictEqual(time.deltaTime, 0.05);
    });

    it('timeScale = 2.0 应使 deltaTime 加倍', () => {
        time.timeScale = 2.0;
        time.update(0.1);

        assert.strictEqual(time.deltaTime, 0.2);
        assert.strictEqual(time.unscaledDeltaTime, 0.1);
    });

    it('timeScale = 0 应暂停时间推进', () => {
        time.timeScale = 0;
        time.update(0.1);

        assert.strictEqual(time.deltaTime, 0);
        assert.strictEqual(time.unscaledDeltaTime, 0.1);
    });

    it('realtimeSinceStartup 应受 timeScale 影响', () => {
        time.reset();
        time.timeScale = 2.0;
        time.update(1.0);
        assert(Math.abs(time.realtimeSinceStartup - 2.0) < 0.0001);
        assert(Math.abs(time.unscaledTime - 1.0) < 0.0001);
    });
});

describe('Time - 计时器', () => {
    let time;

    beforeEach(() => {
        time = new Time();
    });
    after(() => { time?.reset(); });

    it('createTimer 应在指定时间后触发回调', () => {
        let fired = false;
        time.createTimer(0.1, () => { fired = true; });

        time.update(0.05); // 50ms
        assert.strictEqual(fired, false);

        time.update(0.05); // 100ms 累计
        assert.strictEqual(fired, true);
    });

    it('delay 应延迟执行', () => {
        const events = [];
        time.delay(0.2, () => events.push('delayed'));

        time.update(0.15);
        assert.strictEqual(events.length, 0);

        time.update(0.1); // 累计 0.25s
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0], 'delayed');
    });

    it('循环计时器应在每次到期后重新开始', () => {
        let count = 0;
        time.createTimer(0.1, () => count++, { loop: true });

        time.update(0.1);  // 第 1 次触发
        assert.strictEqual(count, 1);

        time.update(0.1);  // 第 2 次触发
        assert.strictEqual(count, 2);

        time.update(0.1);  // 第 3 次触发
        assert.strictEqual(count, 3);
    });

    it('timer.cancel() 应阻止回调触发', () => {
        let fired = false;
        const timer = time.createTimer(0.1, () => { fired = true; });

        timer.cancel();
        time.update(0.2);
        assert.strictEqual(fired, false);
    });

    it('timer.pause() / resume() 应控制计时器暂停', () => {
        let count = 0;
        const timer = time.createTimer(0.2, () => count++);

        time.update(0.1);
        timer.pause();
        time.update(0.2); // 这段时间不应推进
        assert.strictEqual(count, 0);

        timer.resume();
        time.update(0.1); // 累计 0.2s，触发
        assert.strictEqual(count, 1);
    });

    it('timer.progress 应返回 0~1 的进度', () => {
        const timer = time.createTimer(1.0, () => {});

        time.update(0.25);
        assert(Math.abs(timer.progress - 0.25) < 0.01);

        time.update(0.25);
        assert(Math.abs(timer.progress - 0.50) < 0.01);

        time.update(0.5);
        assert(timer.progress >= 1.0);
    });

    it('多个计时器应独立运行', () => {
        const events = [];
        time.createTimer(0.1, () => events.push('fast'));
        time.createTimer(0.3, () => events.push('slow'));

        time.update(0.15);
        assert.deepStrictEqual(events, ['fast']);

        time.update(0.2);
        assert.deepStrictEqual(events, ['fast', 'slow']);
    });

    it('pauseAllTimers / resumeAllTimers 应控制所有计时器', () => {
        let count1 = 0, count2 = 0;
        time.createTimer(0.1, () => count1++);
        time.createTimer(0.1, () => count2++);

        time.update(0.05);
        time.pauseAllTimers();
        time.update(0.2);
        assert.strictEqual(count1, 0);
        assert.strictEqual(count2, 0);

        time.resumeAllTimers();
        time.update(0.1);
        assert.strictEqual(count1, 1);
        assert.strictEqual(count2, 1);
    });

    it('timeScale = 0 时应暂停计时器推进', () => {
        let count = 0;
        time.createTimer(0.1, () => count++);

        time.timeScale = 0;
        time.update(0.5);
        assert.strictEqual(count, 0);

        time.timeScale = 1.0;
        time.update(0.1);
        assert.strictEqual(count, 1);
    });

    it('cleanTimers 应移除已完成计时器', () => {
        time.createTimer(0.01, () => {});
        time.createTimer(0.5, () => {});

        time.update(0.1);
        assert.strictEqual(time._timers.length, 2);

        time.cleanTimers();
        assert.strictEqual(time._timers.length, 1);
    });
});
