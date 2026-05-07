// @ts-check

/**
 * @fileoverview
 * 全局时间管理器 - 持有所有帧时间数据，提供计时器工具。
 *
 * 职责：
 * - 存储每帧的 deltaTime / unscaledDeltaTime / fixedDeltaTime
 * - timeScale 缩放控制（慢动作/加速）
 * - createTimer() / delay() 计时器工具
 * - 由 GameLoop 每帧调用 update() 更新状态
 *
 * 设计原则：
 * - 纯数据 + 工具类，不持有 RAF 循环
 * - 不依赖 EventBus 或其他模块
 * - 可独立构造，通常通过 `gameLoop.time` 访问
 *
 * @module core/Time
 */

/**
 * 游戏计时器
 */
class GameTimer {
    /**
     * @param {Object} config
     * @param {number} config.duration - 持续时间（秒）
     * @param {() => void} config.onComplete - 完成回调
     * @param {boolean} [config.loop=false] - 是否循环
     * @param {() => void} [config.onCancel] - 取消回调
     */
    constructor(config) {
        /** 剩余时间（秒） */
        this._remaining = config.duration;
        this._duration = config.duration;
        this._onComplete = config.onComplete;
        this._loop = config.loop || false;
        this._onCancel = config.onCancel || null;
        /** 计时器是否已暂停 */
        this._paused = false;
        /** 计时器是否已完成 */
        this._completed = false;
    }

    /**
     * 每帧更新时间（由 Time 内部调用）
     * @param {number} dt - 经过的时间（秒，已应用 timeScale）
     * @returns {boolean} 是否已完成
     */
    tick(dt) {
        if (this._paused || this._completed) return false;

        this._remaining -= dt;

        if (this._remaining <= 0) {
            this._completed = true;
            this._onComplete();

            if (this._loop) {
                this._remaining = this._duration;
                this._completed = false;
            }

            return true;
        }

        return false;
    }

    /** 暂停计时器 */
    pause() { this._paused = true; }

    /** 恢复计时器 */
    resume() { this._paused = false; }

    /**
     * 取消计时器
     * @param {boolean} [triggerCallback=false] - 是否触发 onCancel 回调
     */
    cancel(triggerCallback = false) {
        this._completed = true;
        if (triggerCallback && this._onCancel) {
            this._onCancel();
        }
    }

    /**
     * 重置计时器
     * @param {number} [duration] - 可选的新持续时间
     */
    reset(duration) {
        this._remaining = duration ?? this._duration;
        this._completed = false;
        this._paused = false;
    }

    /** @returns {boolean} 计时器是否活跃 */
    get isActive() { return !this._completed && !this._paused; }

    /** @returns {number} 剩余时间（秒） */
    get remaining() { return Math.max(0, this._remaining); }

    /** @returns {number} 进度 0~1 */
    get progress() { return 1 - (this._remaining / this._duration); }
}

/**
 * 时间管理器
 */
export class Time {
    constructor() {
        /** 本帧增量时间（秒，已应用 timeScale） */
        this.deltaTime = 0;
        /** 本帧增量时间（秒，未缩放，用于 UI 动画等） */
        this.unscaledDeltaTime = 0;
        /** 固定步长增量时间（秒，默认 1/60） */
        this.fixedDeltaTime = 1 / 60;
        /** 时间缩放系数（1.0=正常，0.5=慢动作，2.0=加速，0=暂停） */
        this.timeScale = 1.0;
        /** 自游戏开始以来的帧数 */
        this.frameCount = 0;
        /** 游戏运行总时间（秒，已缩放） */
        this.realtimeSinceStartup = 0;
        /** 游戏运行总时间（秒，未缩放） */
        this.unscaledTime = 0;

        /** @private @type {GameTimer[]} */
        this._timers = [];
        /** @private @type {GameTimer[]} */
        this._pendingTimers = [];
    }

    /**
     * 每帧更新（由 GameLoop 调用）
     * @param {number} dt - 本帧真实时间差（秒）
     */
    update(dt) {
        this.unscaledDeltaTime = dt;
        this.deltaTime = dt * this.timeScale;
        this.frameCount++;

        const scaledDt = this.deltaTime;
        this.realtimeSinceStartup += scaledDt;
        this.unscaledTime += dt;

        // 更新所有活跃计时器
        this._pendingTimers.push(...this._timers.filter(t => t.isActive));
        const activeTimers = this._pendingTimers;
        this._pendingTimers = [];

        for (let i = activeTimers.length - 1; i >= 0; i--) {
            const timer = activeTimers[i];
            timer.tick(scaledDt);
        }
    }

    /**
     * 创建计时器
     * @param {number} duration - 持续时间（秒）
     * @param {() => void} onComplete - 完成回调
     * @param {Object} [options]
     * @param {boolean} [options.loop=false] - 是否循环
     * @returns {GameTimer} 计时器实例
     *
     * @example
     * ```javascript
     * const timer = time.createTimer(2.0, () => {
     *     console.log('2 秒已到');
     * });
     * // 取消
     * timer.cancel();
     * ```
     */
    createTimer(duration, onComplete, { loop = false } = {}) {
        const timer = new GameTimer({
            duration,
            onComplete,
            loop
        });
        this._timers.push(timer);
        return timer;
    }

    /**
     * 延迟执行
     * @param {number} delay - 延迟秒数
     * @param {() => void} callback
     * @returns {GameTimer} 计时器实例
     *
     * @example
     * ```javascript
     * time.delay(1.5, () => {
     *     console.log('1.5 秒后执行');
     * });
     * ```
     */
    delay(delay, callback) {
        return this.createTimer(delay, callback, { loop: false });
    }

    /** 暂停所有计时器 */
    pauseAllTimers() {
        for (const timer of this._timers) {
            timer.pause();
        }
    }

    /** 恢复所有计时器 */
    resumeAllTimers() {
        for (const timer of this._timers) {
            timer.resume();
        }
    }

    /** 清除所有已完成/已取消的计时器 */
    cleanTimers() {
        this._timers = this._timers.filter(t => !t._completed);
    }

    /** 重置所有时间数据（场景重启时使用） */
    reset() {
        this.deltaTime = 0;
        this.unscaledDeltaTime = 0;
        this.frameCount = 0;
        this.realtimeSinceStartup = 0;
        this.unscaledTime = 0;
        this.timeScale = 1.0;
        this._timers = [];
        this._pendingTimers = [];
    }
}

export { GameTimer };
