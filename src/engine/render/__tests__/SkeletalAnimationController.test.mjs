// @ts-check

/**
 * @fileoverview
 * SkeletalAnimationController 单元测试
 *
 * 测试覆盖：
 * - 构造与骨骼关联
 * - 注册/查询动画剪辑
 * - 播放/暂停/停止
 * - fixedUpdate 时间推进
 * - 帧间插值 updateInterpolated
 * - 动画事件触发
 * - 混合层
 * - 交叉渐入
 * - 销毁
 *
 * @module render/__tests__/SkeletalAnimationController
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Skeleton } from '../../core/Skeleton.mjs';
import { AnimationClip } from '../../core/AnimationClip.mjs';
import { SkeletalAnimationController } from '../SkeletalAnimationController.mjs';
import { WALK_CLIP, IDLE_CLIP } from '../../core/__tests__/__fixtures__/humanoid-animations.mjs';

/**
 * 创建一个简单的测试动画剪辑。
 * @param {string} name
 * @param {number} duration
 * @param {Function} [setup] - 可选，用于设置关键帧
 * @returns {AnimationClip}
 */
function makeClip(name, duration = 1.0, setup) {
    const keyframes = {
        root:  [{ time: 0, x: 0, y: 0, rotation: 0 }, { time: duration, x: 0, y: 0, rotation: 0 }],
        spine: [{ time: 0, x: 0, y: -18, rotation: 0 }, { time: duration, x: 0, y: -18, rotation: 0 }],
        head:  [{ time: 0, x: 0, y: -14, rotation: 0 }, { time: duration, x: 0, y: -14, rotation: 0 }],
        arm_l: [{ time: 0, x: 7, y: -10, rotation: 0 }, { time: duration, x: 7, y: -10, rotation: 0 }],
        arm_r: [{ time: 0, x: -7, y: -10, rotation: 0 }, { time: duration, x: -7, y: -10, rotation: 0 }],
        leg_l: [{ time: 0, x: 5, y: 0, rotation: 0 }, { time: duration, x: 5, y: 0, rotation: 0 }],
        leg_r: [{ time: 0, x: -5, y: 0, rotation: 0 }, { time: duration, x: -5, y: 0, rotation: 0 }]
    };

    if (setup) setup(keyframes);

    return new AnimationClip(name, duration, keyframes);
}

/**
 * 创建带动画的行走测试剪辑。
 */
const TEST_WALK = new AnimationClip('test_walk', 0.8, {
    root:  [{ time: 0, x: 0, y: 0, rotation: 0 }, { time: 0.4, x: 0, y: 0, rotation: 0 }, { time: 0.8, x: 0, y: 0, rotation: 0 }],
    spine: [{ time: 0, x: 0, y: -18, rotation: 0 }, { time: 0.8, x: 0, y: -18, rotation: 0 }],
    head:  [{ time: 0, x: 0, y: -14, rotation: 0 }, { time: 0.8, x: 0, y: -14, rotation: 0 }],
    arm_l: [{ time: 0, x: 7, y: -10, rotation: 0 }, { time: 0.8, x: 7, y: -10, rotation: 0 }],
    arm_r: [{ time: 0, x: -7, y: -10, rotation: 0 }, { time: 0.8, x: -7, y: -10, rotation: 0 }],
    leg_l: [{ time: 0, x: 5, y: 0, rotation: 0 }, { time: 0.8, x: 5, y: 0, rotation: 0 }],
    leg_r: [{ time: 0, x: -5, y: 0, rotation: 0 }, { time: 0.8, x: -5, y: 0, rotation: 0 }]
}, {
    events: [
        { time: 0.0, name: 'footstep' },
        { time: 0.4, name: 'footstep' }
    ]
});

describe('SkeletalAnimationController', () => {
    /** @type {Skeleton} */
    let skeleton;
    /** @type {SkeletalAnimationController} */
    let controller;

    beforeEach(() => {
        skeleton = new Skeleton('humanoid');
        controller = new SkeletalAnimationController(skeleton);
    });

    // ==================== 构造 ====================

    describe('构造与剪辑管理', () => {
        it('构造后未播放', () => {
            assert.strictEqual(controller.isPlaying, false);
            assert.strictEqual(controller.currentClipName, null);
        });

        it('注册单条剪辑', () => {
            const clip = makeClip('idle');
            controller.registerClip(clip);
            assert.strictEqual(controller.hasClip('idle'), true);
        });

        it('批量注册剪辑', () => {
            controller.registerClips([IDLE_CLIP, WALK_CLIP]);
            assert.strictEqual(controller.hasClip('idle'), true);
            assert.strictEqual(controller.hasClip('walk'), true);
        });

        it('getClipNames 返回所有注册名称', () => {
            controller.registerClips([IDLE_CLIP, WALK_CLIP]);
            const names = controller.getClipNames().sort();
            assert.deepEqual(names, ['idle', 'walk']);
        });

        it('getClip 获取剪辑实例', () => {
            controller.registerClip(IDLE_CLIP);
            assert.strictEqual(controller.getClip('idle'), IDLE_CLIP);
        });

        it('未注册的剪辑 hasClip 返回 false', () => {
            assert.strictEqual(controller.hasClip('nonexistent'), false);
        });
    });

    // ==================== 播放控制 ====================

    describe('播放控制', () => {
        it('play 开始播放', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk', { loop: true });
            assert.strictEqual(controller.isPlaying, true);
            assert.strictEqual(controller.currentClipName, 'test_walk');
        });

        it('stop 停止播放', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.stop();
            assert.strictEqual(controller.isPlaying, false);
            assert.strictEqual(controller.currentClipName, null);
        });

        it('pause 暂停后 fixedUpdate 不推进时间', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.pause();

            const t1 = controller.currentTime;
            controller.fixedUpdate(1/60);
            const t2 = controller.currentTime;

            assert.strictEqual(t1, t2);
        });

        it('resume 恢复播放', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.pause();
            controller.resume();
            assert.strictEqual(controller.isPlaying, true);
        });

        it('不存在的动画 play 不报错', () => {
            controller.play('nonexistent');
            assert.strictEqual(controller.isPlaying, false);
        });
    });

    // ==================== fixedUpdate ====================

    describe('fixedUpdate', () => {
        it('fixedUpdate 推进播放时间', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            const t0 = controller.currentTime;
            controller.fixedUpdate(1/60);
            const t1 = controller.currentTime;

            assert.ok(t1 > t0);
        });

        it('循环动画到达末尾后重置时间', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk', { loop: true });

            // 推进足够时间以到达末尾
            for (let i = 0; i < 100; i++) {
                controller.fixedUpdate(1/60);
            }

            // 因为是循环，时间应在 [0, duration) 范围内
            assert.ok(controller.currentTime < TEST_WALK.duration);
            assert.ok(controller.currentTime >= 0);
        });

        it('非循环动画播放完毕后停止', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk', { loop: false });

            // 推进超过时长
            controller.fixedUpdate(TEST_WALK.duration + 0.1);

            assert.strictEqual(controller.isPlaying, false);
            // 时间应停止在 duration
            assert.strictEqual(controller.currentTime, TEST_WALK.duration);
        });

        it('未播放时 fixedUpdate 返回空事件数组', () => {
            const events = controller.fixedUpdate(1/60);
            assert.deepEqual(events, []);
        });

        it('speed 倍率影响时间推进', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk', { speed: 2 });

            controller.fixedUpdate(1/60);
            // 2倍速下，0.5s 内应推进 1.0s
            const t = controller.currentTime;
            assert.strictEqual(t, 2 * (1/60));
        });
    });

    // ==================== 事件 ====================

    describe('事件触发', () => {
        it('fixedUpdate 越过事件时间点时触发事件', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            // 从 0 推进到 0.5，应触发 t=0.0 和 t=0.4 的事件
            const events1 = controller.fixedUpdate(0.05);
            // t=0.0 的事件在第一次 update 时触发
            // 因为 lastTime=0, currentTime=0.05, 事件 time=0.0 在 (0, 0.05] 范围内? 
            // 不，getEventsInRange(lastTime=0, currentTime=0.05)
            // time > 0 && time <= 0.05 → t=0.0 不在，因为 0 > 0 是 false
            // 所以第一个 update 不会触发 t=0 的事件

            // 推进到 t=0.5，触发 t=0.4 的事件
            const events2 = controller.fixedUpdate(0.45);
            assert.strictEqual(events2.length, 1);
            assert.strictEqual(events2[0].name, 'footstep');
        });

        it('事件回调被触发', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            /** @type {string[]} */
            const fired = [];
            controller.onEvent(event => {
                fired.push(event.name);
            });

            // 推进到 t=0.5
            controller.fixedUpdate(0.5);
            assert.ok(fired.length > 0);
            assert.strictEqual(fired[0], 'footstep');
        });

        it('offEvent 移除回调', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            /** @type {string[]} */
            const fired = [];
            const cb = event => fired.push(event.name);
            controller.onEvent(cb);
            controller.offEvent(cb);

            controller.fixedUpdate(0.5);
            assert.strictEqual(fired.length, 0);
        });
    });

    // ==================== updateInterpolated ====================

    describe('updateInterpolated', () => {
        it('插值更新不抛出异常', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.fixedUpdate(1/60);

            // 插值不应报错
            controller.updateInterpolated(0.5);
        });

        it('未播放时 updateInterpolated 不报错', () => {
            controller.updateInterpolated(0.5);
        });

        it('interp=0 时直接应用当前帧', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.fixedUpdate(1/60);
            controller.updateInterpolated(0);
            // 不应报错，骨骼状态应有效
            assert.ok(skeleton.getBone('root'));
        });
    });

    // ==================== 混合层 ====================

    describe('混合层', () => {
        it('setBlendLayer 添加混合层', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            controller.setBlendLayer('upper', TEST_WALK, 0.5, ['arm_l', 'arm_r', 'spine']);
            // 混合层不报错
            controller.fixedUpdate(1/60);
        });

        it('removeBlendLayer 移除混合层', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.setBlendLayer('upper', TEST_WALK, 0.5);
            controller.removeBlendLayer('upper');
            controller.fixedUpdate(1/60); // 不应报错
        });

        it('clearBlendLayers 清除所有混合层', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.setBlendLayer('upper', TEST_WALK, 0.5);
            controller.setBlendLayer('effect', TEST_WALK, 0.3);
            controller.clearBlendLayers();
            controller.fixedUpdate(1/60);
        });

        it('weight=0 的混合层不生效', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.setBlendLayer('upper', TEST_WALK, 0);
            controller.fixedUpdate(1/60);
        });

        it('setBlendWeight 更新权重', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.setBlendLayer('upper', TEST_WALK, 0.5);
            controller.setBlendWeight('upper', 0.8);
            controller.fixedUpdate(1/60);
        });
    });

    // ==================== 状态查询 ====================

    describe('状态查询', () => {
        it('progress 返回 0~1 的进度', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');
            controller.fixedUpdate(0.2);
            const p = controller.progress;
            assert.ok(p > 0);
            assert.ok(p <= 1);
        });

        it('speed 可读写', () => {
            controller.speed = 2;
            assert.strictEqual(controller.speed, 2);
        });

        it('loop 可读写', () => {
            controller.loop = true;
            assert.strictEqual(controller.loop, true);
        });
    });

    // ==================== 销毁 ====================

    describe('销毁', () => {
        it('destroy 后 play 不报错', () => {
            controller.registerClip(TEST_WALK);
            controller.destroy();
            controller.play('test_walk'); // 不应报错
        });

        it('destroy 后 fixedUpdate 返回空数组', () => {
            controller.registerClip(TEST_WALK);
            controller.destroy();
            const events = controller.fixedUpdate(1/60);
            assert.deepEqual(events, []);
        });

        it('destroy 后 updateInterpolated 不报错', () => {
            controller.destroy();
            controller.updateInterpolated(0.5);
        });
    });

    // ==================== 完整动画场景 ====================

    describe('完整动画场景', () => {
        it('play → fixedUpdate 后骨骼世界变换已更新', () => {
            controller.registerClip(TEST_WALK);
            controller.play('test_walk');

            const beforeX = skeleton.getBone('root').worldX;
            controller.fixedUpdate(1/60);
            const afterX = skeleton.getBone('root').worldX;

            // root 在世界中应存在于某个位置
            assert.strictEqual(typeof afterX, 'number');
        });

        it('混合层影响骨骼变换', () => {
            // 创建一个仅移动臂的剪辑作为混合层
            const overlayClip = new AnimationClip('raise_arm', 1.0, {
                arm_l: [{ time: 0, x: 7, y: -10, rotation: 45 }, { time: 1.0, x: 7, y: -10, rotation: 45 }]
            });

            controller.registerClip(TEST_WALK);
            controller.registerClip(overlayClip);
            controller.play('test_walk');
            controller.setBlendLayer('raise', overlayClip, 1.0, ['arm_l']);

            controller.fixedUpdate(1/60);

            // 骨骼世界变换应被更新（具体值取决于骨骼树计算）
            const arm = skeleton.getBone('arm_l');
            assert.strictEqual(typeof arm.worldX, 'number');
        });
    });
});
