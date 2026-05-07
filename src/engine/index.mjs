// @ts-check

/**
 * @fileoverview
 * 引擎统一导出入口。
 * 引擎使用者只需 `import { Engine, EventBus, GameLoop, Time } from './engine/index.mjs'`。
 *
 * @module engine
 */

export { EventBus } from './core/EventBus.mjs';
export { Time, GameTimer } from './core/Time.mjs';
export { GameLoop } from './core/GameLoop.mjs';
export { Engine, EngineState } from './core/Engine.mjs';
