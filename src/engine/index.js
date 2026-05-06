// @ts-check

/**
 * @fileoverview
 * 引擎统一导出入口。
 * 引擎使用者只需 `import { Engine, EventBus, GameLoop, Time } from './engine/index.js'`。
 *
 * @module engine
 */

export { EventBus } from './core/EventBus.js';
export { Time, GameTimer } from './core/Time.js';
export { GameLoop } from './core/GameLoop.js';
export { Engine, EngineState } from './core/Engine.js';
