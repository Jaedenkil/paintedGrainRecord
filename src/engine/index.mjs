// @ts-check

/**
 * @fileoverview
 * 引擎统一导出入口。
 * 引擎使用者只需 `import { Engine, EventBus, GameLoop, Time, Skeleton } from './engine/index.mjs'`。
 *
 * @module engine
 */

export { EventBus } from './core/EventBus.mjs';
export { Time, GameTimer } from './core/Time.mjs';
export { GameLoop } from './core/GameLoop.mjs';
export { Engine, EngineState } from './core/Engine.mjs';

// 骨骼动画核心数据结构（T9B）
export { Bone, quantizeAngle } from './core/Bone.mjs';
export { SkeletonPose } from './core/SkeletonPose.mjs';
export { AnimationClip } from './core/AnimationClip.mjs';
export { Skeleton, SKELETON_PRESETS } from './core/Skeleton.mjs';
