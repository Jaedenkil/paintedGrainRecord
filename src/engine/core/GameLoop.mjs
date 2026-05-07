// @ts-check

/**
 * @fileoverview
 * 游戏主循环 - 引擎的"心脏"。
 *
 * 采用"固定时间步长 + 可变渲染帧率"双循环模式：
 * - fixedUpdate：固定频率（默认 60Hz）更新物理/逻辑
 * - variableUpdate：每帧执行，使用插值因子供渲染使用
 *
 * 事件发射（通过 EventBus）：
 * - `engine:tick-start` - 每帧开始
 * - `engine:before-fixed-update` - 固定更新前
 * - `engine:after-fixed-update` - 固定更新后
 * - `engine:before-variable-update` - 可变更新前
 * - `engine:after-variable-update` - 可变更新后
 * - `engine:tick-end` - 每帧结束
 * - `engine:pause` - 暂停
 * - `engine:resume` - 恢复
 *
 * @module core/GameLoop
 */

import { EventBus } from './EventBus.mjs';
import { Time } from './Time.mjs';
import { getErrorMessage } from '../utils/error.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('GameLoop');

/**
 * 系统定义
 * @typedef {Object} GameSystem
 * @property {'fixed'|'variable'} type - 更新类型
 * @property {(dt: number, interp?: number) => void} update - 更新回调
 * @property {string} [name] - 系统名称（调试用）
 */

/**
 * 游戏主循环
 *
 * @example
 * ```javascript
 * import { GameLoop } from './GameLoop.js';
 *
 * const loop = new GameLoop();
 *
 * // 注册系统
 * loop.addSystem({
 *     type: 'fixed',
 *     name: 'Physics',
 *     update: (dt) => { /* 物理更新 *\/ }
 * });
 *
 * loop.addSystem({
 *     type: 'variable',
 *     name: 'Render',
 *     update: (dt, interp) => { /* 渲染更新 *\/ }
 * });
 *
 * // 启动循环
 * loop.start();
 *
 * // 暂停/恢复
 * loop.pause();
 * loop.resume();
 * ```
 */
export class GameLoop {
    /** 固定更新步长（秒），默认 60Hz */
    static FIXED_DT = 1 / 60;

    /** 最大帧间隔（秒），防止螺旋死亡 */
    static MAX_DT = 0.1;

    /** FPS 统计窗口（秒） */
    static FPS_SAMPLE_WINDOW = 0.5;

    constructor() {
        /** @private @type {GameSystem[]} fixed 系统列表 */
        this._fixedSystems = [];
        /** @private @type {GameSystem[]} variable 系统列表 */
        this._variableSystems = [];

        /** @private */
        this._isRunning = false;
        /** @private */
        this._isPaused = false;
        /** @private */
        this._lastTime = 0;
        /** @private */
        this._accumulator = 0;
        /** @private */
        this._rafId = null;
        /** @private */
        this._frameCount = 0;
        /** @private */
        this._fpsTimer = 0;
        /** @private */
        this._fps = 0;

        /**
         * 时间管理器实例
         * @type {Time}
         */
        this.time = new Time();

        log.info('GameLoop 实例已创建');
    }

    // ==================== 系统注册 ====================

    /**
     * 注册一个需要每帧更新的系统
     * @param {GameSystem} system - 系统对象
     * @throws {TypeError} system.update 必须是函数
     *
     * @example
     * ```javascript
     * loop.addSystem({
     *     type: 'fixed',
     *     name: 'Physics',
     *     update: (dt) => world.step(dt)
     * });
     * ```
     */
    addSystem(system) {
        if (typeof system.update !== 'function') {
            throw new TypeError('[GameLoop] system.update 必须是函数');
        }

        if (system.type === 'fixed') {
            this._fixedSystems.push(system);
        } else if (system.type === 'variable') {
            this._variableSystems.push(system);
        } else {
            // 默认注册为 variable
            this._variableSystems.push({ ...system, type: 'variable' });
        }
    }

    /**
     * 移除已注册的系统
     * @param {GameSystem} system - 要移除的系统对象
     */
    removeSystem(system) {
        const byRef = (/** @type {GameSystem} */ s) => s === system;

        if (system.type === 'fixed') {
            this._fixedSystems = this._fixedSystems.filter(s => !byRef(s));
        } else {
            this._variableSystems = this._variableSystems.filter(s => !byRef(s));
        }
    }

    /**
     * 移除所有已注册的系统
     */
    clearSystems() {
        this._fixedSystems = [];
        this._variableSystems = [];
    }

    // ==================== 循环控制 ====================

    /**
     * 启动游戏循环
     */
    start() {
        if (this._isRunning) return;
        this._isRunning = true;
        this._isPaused = false;
        this._lastTime = performance.now();
        this._accumulator = 0;
        this._frameCount = 0;
        this._fpsTimer = 0;
        this._fps = 0;
        this.time.reset();

        log.info('游戏循环已启动');
        this._tick(this._lastTime);
    }

    /**
     * 停止游戏循环。停止后不可恢复，需重新 start()。
     */
    stop() {
        this._isRunning = false;
        this._isPaused = false;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this.clearSystems();
        log.info('游戏循环已停止');
    }

    /**
     * 暂停游戏循环。timeScale 置为 0，但仍会接收 RAF 回调。
     */
    pause() {
        if (!this._isRunning || this._isPaused) return;
        this._isPaused = true;
        this.time.timeScale = 0;
        EventBus.getInstance().emit('engine:pause', {});
        log.info('游戏循环已暂停');
    }

    /**
     * 恢复游戏循环。
     */
    resume() {
        if (!this._isRunning || !this._isPaused) return;
        this._isPaused = false;
        this.time.timeScale = 1.0;
        this._lastTime = performance.now();
        this._accumulator = 0;
        EventBus.getInstance().emit('engine:resume', {});
        log.info('游戏循环已恢复');
    }

    /**
     * 循环是否正在运行
     * @returns {boolean}
     */
    get isRunning() { return this._isRunning; }

    /**
     * 循环是否已暂停
     * @returns {boolean}
     */
    get isPaused() { return this._isPaused; }

    /**
     * 当前 FPS（每秒更新一次）
     * @returns {number}
     */
    get fps() { return this._fps; }

    // ==================== 内部循环 ====================

    /**
     * @private
     * @param {number} now - performance.now() 时间戳
     */
    _tick(now) {
        if (!this._isRunning) return;

        // 1. 计算 deltaTime
        let rawDt = (now - this._lastTime) / 1000;
        this._lastTime = now;

        // 防止螺旋死亡
        if (rawDt > GameLoop.MAX_DT) rawDt = GameLoop.MAX_DT;
        if (rawDt <= 0) rawDt = 1 / 1000; // 最小保护

        // 2. 更新时间管理器
        this.time.update(rawDt);

        // 3. FPS 统计
        this._frameCount++;
        this._fpsTimer += rawDt;
        if (this._fpsTimer >= GameLoop.FPS_SAMPLE_WINDOW) {
            this._fps = Math.round(this._frameCount / this._fpsTimer);
            this._frameCount = 0;
            this._fpsTimer = 0;
        }

        // 4. 发射帧开始事件
        EventBus.getInstance().emit('engine:tick-start', {
            dt: this.time.deltaTime,
            unscaledDt: this.time.unscaledDeltaTime,
            frameCount: this.time.frameCount
        });

        // 5. 固定时间步长更新（即使暂停也累积，但暂停时 dt=0 所以不推进）
        const scaledDt = this.time.deltaTime;
        this._accumulator += scaledDt;

        if (this._accumulator >= GameLoop.FIXED_DT) {
            EventBus.getInstance().emit('engine:before-fixed-update', {});
        }

        let fixedSteps = 0;
        while (this._accumulator >= GameLoop.FIXED_DT && fixedSteps < 5) {
            this._runFixedUpdate(GameLoop.FIXED_DT);
            this._accumulator -= GameLoop.FIXED_DT;
            fixedSteps++;
        }

        if (fixedSteps > 0) {
            EventBus.getInstance().emit('engine:after-fixed-update', { steps: fixedSteps });
        }

        // 防止累加器无限增长（当帧率极低时）
        // 注意：如果 while 因 maxSteps 限制退出，累加器可能仍 >= FIXED_DT，
        // 此时 interp >= 1，渲染插值会越界。强制钳位到 FIXED_DT - epsilon。
        if (this._accumulator >= GameLoop.FIXED_DT) {
            this._accumulator = GameLoop.FIXED_DT * (1 - 1e-6);
        }
        if (this._accumulator > GameLoop.FIXED_DT * 5) {
            this._accumulator = GameLoop.FIXED_DT * 5;
        }

        // 6. 计算插值因子（用于渲染插值），保证 interp ∈ [0, 1)
        const interp = this._accumulator / GameLoop.FIXED_DT;

        // 7. 可变帧率更新
        EventBus.getInstance().emit('engine:before-variable-update', { interp });
        this._runVariableUpdate(this.time.deltaTime, interp);
        EventBus.getInstance().emit('engine:after-variable-update', { interp });

        // 8. 发射帧结束事件
        EventBus.getInstance().emit('engine:tick-end', {
            fps: this._fps,
            interp,
            fixedSteps
        });

        // 9. 请求下一帧
        this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    /**
     * @private
     * @param {number} dt
     */
    _runFixedUpdate(dt) {
        for (let i = 0; i < this._fixedSystems.length; i++) {
            const sys = this._fixedSystems[i];
            try {
                sys.update(dt);
            } catch (err) {
                log.error(`FixedSystem "${sys.name || i}" 更新出错:`, getErrorMessage(err));
            }
        }
    }

    /**
     * @private
     * @param {number} dt
     * @param {number} interp
     */
    _runVariableUpdate(dt, interp) {
        for (let i = 0; i < this._variableSystems.length; i++) {
            const sys = this._variableSystems[i];
            try {
                sys.update(dt, interp);
            } catch (err) {
                log.error(`VariableSystem "${sys.name || i}" 更新出错:`, getErrorMessage(err));
            }
        }
    }
}
