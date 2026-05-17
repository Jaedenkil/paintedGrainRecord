// @ts-check

/**
 * @fileoverview 游戏主循环——固定时间步长+可变帧率双环模式。通过 EventBus 发射 tick 事件。
 * @module core/GameLoop
 */

import { EventBus } from './EventBus.mjs';
import { Time } from './Time.mjs';
import { getErrorMessage } from '../utils/error.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('GameLoop');

/**
 * @typedef {Object} GameSystem
 * @property {'fixed'|'variable'} type
 * @property {(dt: number, interp?: number) => void} update
 * @property {string} [name]
 */

export class GameLoop {
    /** 固定更新步长（秒），默认 60Hz */ static FIXED_DT = 1 / 60;
    /** 最大帧间隔 */ static MAX_DT = 0.1;
    /** FPS 统计窗口 */ static FPS_SAMPLE_WINDOW = 0.5;

    constructor() {
        /** @private @type {GameSystem[]} */ this._fixedSystems = [];
        /** @private @type {GameSystem[]} */ this._variableSystems = [];
        /** @private */ this._isRunning = false;
        /** @private */ this._isPaused = false;
        /** @private */ this._lastTime = 0;
        /** @private */ this._accumulator = 0;
        /** @private */ this._rafId = null;
        /** @private */ this._frameCount = 0;
        /** @private */ this._fpsTimer = 0;
        /** @private */ this._fps = 0;
        /** @type {Time} */ this.time = new Time();
        log.info('GameLoop 实例已创建');
    }

    /**
     * 注册系统。
     * @param {GameSystem} system 需含 type('fixed'|'variable') 和 update()
     * @throws {TypeError}
     */
    addSystem(system) {
        if (typeof system.update !== 'function') throw new TypeError('[GameLoop] system.update 必须是函数');
        if (system.type === 'fixed') { this._fixedSystems.push(system); }
        else if (system.type === 'variable') { this._variableSystems.push(system); }
        else { this._variableSystems.push({ ...system, type: 'variable' }); }
    }

    /** @param {GameSystem} system */
    removeSystem(system) {
        const byRef = (/** @type {GameSystem} */ s) => s === system;
        if (system.type === 'fixed') { this._fixedSystems = this._fixedSystems.filter(s => !byRef(s)); }
        else { this._variableSystems = this._variableSystems.filter(s => !byRef(s)); }
    }

    /** 移除所有系统。*/ clearSystems() { this._fixedSystems = []; this._variableSystems = []; }

    /** 启动游戏循环。*/
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

    /** 停止游戏循环。*/
    stop() {
        this._isRunning = false;
        this._isPaused = false;
        if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this.clearSystems();
        log.info('游戏循环已停止');
    }

    /** 暂停（timeScale=0，仍收 RAF）。*/
    pause() {
        if (!this._isRunning || this._isPaused) return;
        this._isPaused = true;
        this.time.timeScale = 0;
        EventBus.getInstance().emit('engine:pause', {});
        log.info('游戏循环已暂停');
    }

    /** 恢复游戏循环。*/
    resume() {
        if (!this._isRunning || !this._isPaused) return;
        this._isPaused = false;
        this.time.timeScale = 1.0;
        this._lastTime = performance.now();
        this._accumulator = 0;
        EventBus.getInstance().emit('engine:resume', {});
        log.info('游戏循环已恢复');
    }

    /** @returns {boolean} */ get isRunning() { return this._isRunning; }
    /** @returns {boolean} */ get isPaused() { return this._isPaused; }
    /** @returns {number} */ get fps() { return this._fps; }

    /**
     * @private
     * @param {number} now performance.now() 时间戳
     */
    _tick(now) {
        if (!this._isRunning) return;
        let rawDt = (now - this._lastTime) / 1000;
        this._lastTime = now;
        if (rawDt > GameLoop.MAX_DT) rawDt = GameLoop.MAX_DT;
        if (rawDt <= 0) rawDt = 1 / 1000;
        this.time.update(rawDt);
        this._frameCount++;
        this._fpsTimer += rawDt;
        if (this._fpsTimer >= GameLoop.FPS_SAMPLE_WINDOW) {
            this._fps = Math.round(this._frameCount / this._fpsTimer);
            this._frameCount = 0; this._fpsTimer = 0;
        }
        EventBus.getInstance().emit('engine:tick-start', {
            dt: this.time.deltaTime, unscaledDt: this.time.unscaledDeltaTime, frameCount: this.time.frameCount
        });
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
        if (this._accumulator >= GameLoop.FIXED_DT) {
            this._accumulator = GameLoop.FIXED_DT * (1 - 1e-6);
        }
        if (this._accumulator > GameLoop.FIXED_DT * 5) {
            this._accumulator = GameLoop.FIXED_DT * 5;
        }
        const interp = this._accumulator / GameLoop.FIXED_DT;
        EventBus.getInstance().emit('engine:before-variable-update', { interp });
        this._runVariableUpdate(this.time.deltaTime, interp);
        EventBus.getInstance().emit('engine:after-variable-update', { interp });
        EventBus.getInstance().emit('engine:tick-end', { fps: this._fps, interp, fixedSteps });
        this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    /** @private @param {number} dt */
    _runFixedUpdate(dt) {
        for (let i = 0; i < this._fixedSystems.length; i++) {
            const sys = this._fixedSystems[i];
            try { sys.update(dt); } catch (err) { log.error(`FixedSystem "${sys.name || i}" 更新出错:`, getErrorMessage(err)); }
        }
    }

    /** @private @param {number} dt @param {number} interp */
    _runVariableUpdate(dt, interp) {
        for (let i = 0; i < this._variableSystems.length; i++) {
            const sys = this._variableSystems[i];
            try { sys.update(dt, interp); } catch (err) { log.error(`VariableSystem "${sys.name || i}" 更新出错:`, getErrorMessage(err)); }
        }
    }
}
