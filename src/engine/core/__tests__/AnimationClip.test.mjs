// @ts-check

/**
 * @fileoverview
 * AnimationClip 单元测试
 *
 * 测试覆盖：
 * - 构造与关键帧排序
 * - sample 时间点采样
 * - 边界情况（超过时长、负时间）
 * - 旋转最短路径插值
 * - getEventsInRange 事件区间查询
 * - 遍历骨骼名称
 *
 * @module core/__tests__/AnimationClip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip } from '../AnimationClip.mjs';
import { WALK_CLIP, IDLE_CLIP } from './__fixtures__/humanoid-animations.mjs';

// ==================== 构造 ====================

describe('AnimationClip - 构造', () => {
    it('构造后具有正确的名称和时长', () => {
        const clip = new AnimationClip('test', 1.5, {
            bone_a: [{ time: 0, x: 0, y: 0, rotation: 0 }]
        });
        assert.strictEqual(clip.name, 'test');
        assert.strictEqual(clip.duration, 1.5);
    });

    it('关键帧按时间排序（即使输入无序）', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0.8, x: 20 },
                { time: 0.2, x: 5 },
                { time: 0.5, x: 10 }
            ]
        });
        assert.strictEqual(clip.keyframeCount('bone'), 3);
        // 采样验证排序正确
        const pose = clip.sample(0.1);
        assert.strictEqual(pose.getBoneTransform('bone').x, 5); // 取第一个帧
    });

    it('缺少骨骼的 keyframeCount 返回 0', () => {
        const clip = new AnimationClip('test', 1.0, {});
        assert.strictEqual(clip.keyframeCount('nonexistent'), 0);
    });

    it('boneNames 返回所有骨骼名', () => {
        const clip = new AnimationClip('test', 1.0, {
            a: [{ time: 0, x: 0 }],
            b: [{ time: 0, x: 0 }]
        });
        const names = clip.boneNames.sort();
        assert.deepEqual(names, ['a', 'b']);
    });
});

// ==================== 样本动画 ====================

describe('AnimationClip - 样本动画 (walk)', () => {
    it('待机动画名为 idle，时长 1.0s', () => {
        assert.strictEqual(IDLE_CLIP.name, 'idle');
        assert.strictEqual(IDLE_CLIP.duration, 1.0);
    });

    it('行走动画名为 walk，时长 0.8s', () => {
        assert.strictEqual(WALK_CLIP.name, 'walk');
        assert.strictEqual(WALK_CLIP.duration, 0.8);
    });

    it('walk 包含 7 根骨骼', () => {
        assert.strictEqual(WALK_CLIP.boneNames.length, 7);
    });

    it('walk 包含 2 个事件（footstep）', () => {
        assert.strictEqual(WALK_CLIP.events.length, 2);
        assert.strictEqual(WALK_CLIP.events[0].name, 'footstep');
        assert.strictEqual(WALK_CLIP.events[1].name, 'footstep');
    });
});

// ==================== sample ====================

describe('AnimationClip - sample', () => {
    it('采样 t=0 返回第一个关键帧', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0, x: 10 },
                { time: 1, x: 20 }
            ]
        });
        const pose = clip.sample(0);
        assert.strictEqual(pose.getBoneTransform('bone').x, 10);
    });

    it('采样 t=duration 返回最后一个关键帧', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0, x: 10 },
                { time: 1, x: 20 }
            ]
        });
        const pose = clip.sample(1.0);
        assert.strictEqual(pose.getBoneTransform('bone').x, 20);
    });

    it('采样 t=0.5 返回中间插值', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0, x: 10 },
                { time: 1, x: 20 }
            ]
        });
        const pose = clip.sample(0.5);
        assert.strictEqual(pose.getBoneTransform('bone').x, 15);
    });

    it('超出时长被钳位到 duration', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [{ time: 0, x: 10 }, { time: 1, x: 20 }]
        });
        // 超过 duration 应返回最后一帧
        const pose = clip.sample(5.0);
        assert.strictEqual(pose.getBoneTransform('bone').x, 20);
    });

    it('负时间被钳位到 0', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [{ time: 0, x: 10 }, { time: 1, x: 20 }]
        });
        const pose = clip.sample(-1.0);
        assert.strictEqual(pose.getBoneTransform('bone').x, 10);
    });

    it('单关键帧始终返回该帧值', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [{ time: 0, x: 42, y: 7, rotation: 0, scaleX: 1, scaleY: 1 }]
        });
        const pose1 = clip.sample(0);
        const pose2 = clip.sample(0.5);
        const pose3 = clip.sample(1.0);

        assert.strictEqual(pose1.getBoneTransform('bone').x, 42);
        assert.strictEqual(pose2.getBoneTransform('bone').x, 42);
        assert.strictEqual(pose3.getBoneTransform('bone').x, 42);
    });

    it('walk 动画采样 t=0 时左腿前摆 45°', () => {
        const pose = WALK_CLIP.sample(0);
        const legL = pose.getBoneTransform('leg_l');
        assert.strictEqual(legL.rotation, 45);
    });

    it('walk 动画采样 t=0 时右腿后摆 -45°(315°)', () => {
        const pose = WALK_CLIP.sample(0);
        const legR = pose.getBoneTransform('leg_r');
        assert.strictEqual(legR.rotation, 315); // -45 → 315
    });

    it('walk 动画采样 t=0.4 时左右腿交换', () => {
        const pose = WALK_CLIP.sample(0.4);
        const legL = pose.getBoneTransform('leg_l');
        const legR = pose.getBoneTransform('leg_r');
        assert.strictEqual(legL.rotation, 315); // leg_l 后摆 -45°
        assert.strictEqual(legR.rotation, 45);  // leg_r 前摆 45°
    });
});

// ==================== 旋转最短路径 ====================

describe('AnimationClip - 旋转最短路径插值', () => {
    it('从 315°(-45) 到 45° 经过 0°', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0, rotation: 315 },
                { time: 1, rotation: 45 }
            ]
        });

        // 在 t=0.5 时，最短路径从 315→45 经过 0
        const pose = clip.sample(0.5);
        const rot = pose.getBoneTransform('bone').rotation;
        assert.strictEqual(rot, 0);
    });

    it('从 0° 到 270° 经过 315°', () => {
        const clip = new AnimationClip('test', 1.0, {
            bone: [
                { time: 0, rotation: 0 },
                { time: 1, rotation: 270 }
            ]
        });

        const pose = clip.sample(0.5);
        const rot = pose.getBoneTransform('bone').rotation;
        assert.strictEqual(rot, 315);
    });

    it('walk leg_l 从 45° 到 -45°(315°) 经过 0°', () => {
        // leg_l 在 t=0:45°, t=0.2:0°, t=0.4:315°(-45°)
        // 所以 t=0.1 应该是 45 和 0 的中间
        const pose = WALK_CLIP.sample(0.1);
        const rot = pose.getBoneTransform('leg_l').rotation;
        // 45 + (0-45)*0.5 = 22.5 → quantize → 0
        assert.ok(rot === 0 || rot === 45); // 22.5 量化到最近的 45° 倍数
    });
});

// ==================== 事件 ====================

describe('AnimationClip - getEventsInRange', () => {
    it('walk 在 t=0~0.1 区间不触发 t=0 事件（严格大于 lastTime）', () => {
        const events = WALK_CLIP.getEventsInRange(0, 0.1);
        assert.strictEqual(events.length, 0);
    });

    it('walk 在 t=0.1~0.3 区间无事件', () => {
        const events = WALK_CLIP.getEventsInRange(0.1, 0.3);
        assert.strictEqual(events.length, 0);
    });

    it('walk 在 t=0.3~0.5 区间触发第二个 footstep', () => {
        const events = WALK_CLIP.getEventsInRange(0.3, 0.5);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].name, 'footstep');
        assert.strictEqual(events[0].time, 0.4);
    });

    it('包含端点：time=0.4 在 (0.3, 0.4] 范围内', () => {
        const events = WALK_CLIP.getEventsInRange(0.3, 0.4);
        assert.strictEqual(events.length, 1);
    });

    it('排除起始点：time=0.4 不在 (0.4, 0.5] 范围内', () => {
        const events = WALK_CLIP.getEventsInRange(0.4, 0.5);
        assert.strictEqual(events.length, 0);
    });

    it('idle 无事件', () => {
        const events = IDLE_CLIP.getEventsInRange(0, 1.0);
        assert.strictEqual(events.length, 0);
    });
});
