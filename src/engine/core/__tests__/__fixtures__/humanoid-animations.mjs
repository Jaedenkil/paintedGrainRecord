// @ts-check

/**
 * @fileoverview
 * 人形骨骼样本动画数据——用于单元测试和开发调试。
 *
 * 包含两个基础动画：
 * - idle：待机姿态（1.0s 循环，呼吸起伏）
 * - walk：行走循环（0.8s 循环，双腿交替 + 手臂摆动）
 *
 * 所有角度被设计为 45° 的整数倍（经 quantizeAngle 映射后），
 * 以符合 8 方向像素保护规则。
 *
 * @module __tests__/__fixtures__/humanoid-animations
 */

import { AnimationClip } from '../../AnimationClip.mjs';

/**
 * 待机动画——轻微呼吸起伏。
 *
 * 动作：
 * - root Y 轴上下 1px 起伏（呼吸）
 * - spine 轻微左右摆动（3°，量化后为 0°）
 * - arms 微微内外摆动（5°，量化后为 0°）
 * - legs 静止
 *
 * @type {AnimationClip}
 */
export const IDLE_CLIP = new AnimationClip('idle', 1.0, {
    root: [
        { time: 0.0, x: 0, y: 0, rotation: 0 },
        { time: 0.5, x: 0, y: -1, rotation: 0 },
        { time: 1.0, x: 0, y: 0, rotation: 0 }
    ],
    spine: [
        { time: 0.0, x: 0, y: -18, rotation: 0 },
        { time: 1.0, x: 0, y: -18, rotation: 0 }
    ],
    head: [
        { time: 0.0, x: 0, y: -14, rotation: 0 },
        { time: 1.0, x: 0, y: -14, rotation: 0 }
    ],
    leg_l: [
        { time: 0.0, x: 5, y: 0, rotation: 0 },
        { time: 1.0, x: 5, y: 0, rotation: 0 }
    ],
    leg_r: [
        { time: 0.0, x: -5, y: 0, rotation: 0 },
        { time: 1.0, x: -5, y: 0, rotation: 0 }
    ],
    arm_l: [
        { time: 0.0, x: 7, y: -10, rotation: 0 },
        { time: 0.5, x: 7, y: -10, rotation: 0 },
        { time: 1.0, x: 7, y: -10, rotation: 0 }
    ],
    arm_r: [
        { time: 0.0, x: -7, y: -10, rotation: 0 },
        { time: 0.5, x: -7, y: -10, rotation: 0 },
        { time: 1.0, x: -7, y: -10, rotation: 0 }
    ]
});

/**
 * 行走动画——完整步行循环（0.8s）。
 *
 * 动作时序：
 * ```
 * t=0.0  腿_l 前摆 45°  / 腿_r 后摆 -45° / 臂_l 后摆 / 臂_r 前摆 → 脚步事件
 * t=0.2  双腿垂直 0°   / 双臂垂直 0°
 * t=0.4  腿_l 后摆 -45° / 腿_r 前摆 45°  / 臂_l 前摆 / 臂_r 后摆 → 脚步事件
 * t=0.6  双腿垂直 0°   / 双臂垂直 0°
 * t=0.8  回到 t=0.0
 * ```
 *
 * 注：-45° 存储为 315°，AnimationClip.sample() 的最短路径插值
 * 会自动处理 45°↔315° 通过 0° 的过渡。
 *
 * @type {AnimationClip}
 */
export const WALK_CLIP = new AnimationClip('walk', 0.8, {
    // 根骨骼：身体上下起伏
    root: [
        { time: 0.0, x: 0, y: 0, rotation: 0 },
        { time: 0.2, x: 0, y: -1, rotation: 0 },
        { time: 0.4, x: 0, y: 0, rotation: 0 },
        { time: 0.6, x: 0, y: -1, rotation: 0 },
        { time: 0.8, x: 0, y: 0, rotation: 0 }
    ],
    // 脊柱：轻微前倾随步态旋转
    spine: [
        { time: 0.0, x: 0, y: -18, rotation: 0 },
        { time: 0.2, x: 0, y: -18, rotation: 0 },
        { time: 0.4, x: 0, y: -18, rotation: 0 },
        { time: 0.6, x: 0, y: -18, rotation: 0 },
        { time: 0.8, x: 0, y: -18, rotation: 0 }
    ],
    // 头部：保持水平
    head: [
        { time: 0.0, x: 0, y: -14, rotation: 0 },
        { time: 0.4, x: 0, y: -14, rotation: 0 },
        { time: 0.8, x: 0, y: -14, rotation: 0 }
    ],
    // 左腿（前台肢体）：前摆/后摆交替
    leg_l: [
        { time: 0.0, x: 5, y: 0, rotation: 45 },
        { time: 0.2, x: 5, y: 0, rotation: 0 },
        { time: 0.4, x: 5, y: 0, rotation: -45 },
        { time: 0.6, x: 5, y: 0, rotation: 0 },
        { time: 0.8, x: 5, y: 0, rotation: 45 }
    ],
    // 右腿（后台肢体）：与左腿反相
    leg_r: [
        { time: 0.0, x: -5, y: 0, rotation: -45 },
        { time: 0.2, x: -5, y: 0, rotation: 0 },
        { time: 0.4, x: -5, y: 0, rotation: 45 },
        { time: 0.6, x: -5, y: 0, rotation: 0 },
        { time: 0.8, x: -5, y: 0, rotation: -45 }
    ],
    // 左臂：与左腿反相（摆臂）
    arm_l: [
        { time: 0.0, x: 7, y: -10, rotation: -45 },
        { time: 0.2, x: 7, y: -10, rotation: 0 },
        { time: 0.4, x: 7, y: -10, rotation: 45 },
        { time: 0.6, x: 7, y: -10, rotation: 0 },
        { time: 0.8, x: 7, y: -10, rotation: -45 }
    ],
    // 右臂：与右腿反相
    arm_r: [
        { time: 0.0, x: -7, y: -10, rotation: 45 },
        { time: 0.2, x: -7, y: -10, rotation: 0 },
        { time: 0.4, x: -7, y: -10, rotation: -45 },
        { time: 0.6, x: -7, y: -10, rotation: 0 },
        { time: 0.8, x: -7, y: -10, rotation: 45 }
    ]
}, {
    events: [
        { time: 0.0, name: 'footstep' },
        { time: 0.4, name: 'footstep' }
    ]
});

/**
 * 获取所有样本动画剪辑的列表。
 * @returns {import('../../AnimationClip.mjs').AnimationClip[]}
 */
export function getAllSampleClips() {
    return [IDLE_CLIP, WALK_CLIP];
}
