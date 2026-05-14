// @ts-check

/**
 * @fileoverview
 * SkeletonPose 单元测试
 *
 * 测试覆盖：
 * - 构造函数与变换存取
 * - clone 深拷贝独立性
 * - lerp 线性插值
 * - lerp 旋转最短路径
 * - blend 叠加混合
 *
 * @module core/__tests__/SkeletonPose
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SkeletonPose } from '../SkeletonPose.mjs';

/**
 * 创建一个人形测试姿态。
 * @returns {SkeletonPose}
 */
function createHumanoidPose() {
    return new SkeletonPose(new Map([
        ['root',  { x: 0, y: 0,   rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['spine', { x: 0, y: -18, rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['head',  { x: 0, y: -14, rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['arm_l', { x: 7, y: -10, rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['arm_r', { x: -7,y: -10, rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['leg_l', { x: 5, y: 0,   rotation: 0,   scaleX: 1, scaleY: 1 }],
        ['leg_r', { x: -5,y: 0,   rotation: 0,   scaleX: 1, scaleY: 1 }]
    ]));
}

// ==================== 基础功能 ====================

describe('SkeletonPose - 基础功能', () => {
    it('构造后包含所有骨骼', () => {
        const pose = createHumanoidPose();
        assert.strictEqual(pose.boneCount, 7);
    });

    it('getBoneTransform 获取指定骨骼变换', () => {
        const pose = createHumanoidPose();
        const t = pose.getBoneTransform('arm_l');
        assert.ok(t);
        assert.strictEqual(t.x, 7);
        assert.strictEqual(t.y, -10);
    });

    it('不存在的骨骼返回 undefined', () => {
        const pose = createHumanoidPose();
        assert.strictEqual(pose.getBoneTransform('nonexistent'), undefined);
    });

    it('setBoneTransform 设置变换', () => {
        const pose = createHumanoidPose();
        pose.setBoneTransform('arm_l', { x: 10, y: 20, rotation: 45, scaleX: 1, scaleY: 1 });
        const t = pose.getBoneTransform('arm_l');
        assert.strictEqual(t.x, 10);
        assert.strictEqual(t.y, 20);
        assert.strictEqual(t.rotation, 45);
    });

    it('boneNames 遍历所有骨骼名称', () => {
        const pose = createHumanoidPose();
        const names = Array.from(pose.boneNames());
        assert.strictEqual(names.length, 7);
        assert.ok(names.includes('root'));
        assert.ok(names.includes('head'));
    });

    it('hasBone 检查骨骼存在', () => {
        const pose = createHumanoidPose();
        assert.strictEqual(pose.hasBone('root'), true);
        assert.strictEqual(pose.hasBone('nonexistent'), false);
    });
});

// ==================== clone ====================

describe('SkeletonPose - clone', () => {
    it('clone 返回独立的深拷贝', () => {
        const pose1 = createHumanoidPose();
        const pose2 = pose1.clone();

        pose2.setBoneTransform('root', { x: 999, y: 999, rotation: 0, scaleX: 1, scaleY: 1 });

        // 修改副本不影响原对象
        const t1 = pose1.getBoneTransform('root');
        const t2 = pose2.getBoneTransform('root');
        assert.strictEqual(t1.x, 0);
        assert.strictEqual(t2.x, 999);
    });

    it('clone 保持骨骼数量', () => {
        const pose1 = createHumanoidPose();
        const pose2 = pose1.clone();
        assert.strictEqual(pose2.boneCount, pose1.boneCount);
    });
});

// ==================== lerp ====================

describe('SkeletonPose - lerp', () => {
    it('lerp(a, b, 0) = a', () => {
        const a = createHumanoidPose();
        const b = createHumanoidPose();
        b.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.lerp(a, b, 0);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 7);
    });

    it('lerp(a, b, 1) = b', () => {
        const a = createHumanoidPose();
        const b = createHumanoidPose();
        b.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.lerp(a, b, 1);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 10);
    });

    it('lerp(a, b, 0.5) 取中间值', () => {
        const a = createHumanoidPose();
        const b = createHumanoidPose();
        b.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.lerp(a, b, 0.5);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 8.5); // (7+10)/2
    });

    it('旋转最短路径：从 315° 到 45° 经过 0°', () => {
        const a = new SkeletonPose(new Map([
            ['arm', { x: 0, y: 0, rotation: 315, scaleX: 1, scaleY: 1 }]
        ]));
        const b = new SkeletonPose(new Map([
            ['arm', { x: 0, y: 0, rotation: 45, scaleX: 1, scaleY: 1 }]
        ]));

        // 315→45 的"绕远路"差是 -270 度（或 +90 度）
        // 最短路径：315→360(0)→45，即 +90 度
        // t=0.5: 315 + 45 = 360 → 0°
        const r = SkeletonPose.lerp(a, b, 0.5);
        const rot = r.getBoneTransform('arm').rotation;
        assert.strictEqual(rot, 0);
    });

    it('旋转最短路径：从 0° 到 270° 经过 -45°', () => {
        const a = new SkeletonPose(new Map([
            ['arm', { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]
        ]));
        const b = new SkeletonPose(new Map([
            ['arm', { x: 0, y: 0, rotation: 270, scaleX: 1, scaleY: 1 }]
        ]));

        // 0→270 的"绕远路"差是 +270 度
        // 最短路径：0→-90(270)，即 -90 度（或 270 度逆向）
        // 270-0=270 > 180, so 270-360=-90
        // t=0.5: 0 + (-90)*0.5 = -45 → 315
        const r = SkeletonPose.lerp(a, b, 0.5);
        const rot = r.getBoneTransform('arm').rotation;
        assert.strictEqual(rot, 315);
    });

    it('lerp 不修改原始姿态', () => {
        const a = createHumanoidPose();
        const b = createHumanoidPose();
        const originalX = a.getBoneTransform('arm_l').x;

        SkeletonPose.lerp(a, b, 0.5);

        assert.strictEqual(a.getBoneTransform('arm_l').x, originalX);
    });
});

// ==================== blend ====================

describe('SkeletonPose - blend', () => {
    it('weight=0 时 blend 等于 base', () => {
        const base = createHumanoidPose();
        const overlay = createHumanoidPose();
        overlay.setBoneTransform('arm_l', { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.blend(base, overlay, 0);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 7); // 原始值
    });

    it('weight=1 时完全叠加', () => {
        const base = createHumanoidPose();
        const overlay = createHumanoidPose();
        overlay.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.blend(base, overlay, 1);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 17); // 7 + 10
    });

    it('weight=0.5 时半叠加', () => {
        const base = createHumanoidPose();
        const overlay = createHumanoidPose();
        overlay.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        const r = SkeletonPose.blend(base, overlay, 0.5);
        assert.strictEqual(r.getBoneTransform('arm_l').x, 12); // 7 + 10*0.5
    });

    it('叠加层中不存在的骨骼使用 base 的值', () => {
        const base = createHumanoidPose();
        const overlay = new SkeletonPose(new Map([
            ['arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }]
        ]));

        const r = SkeletonPose.blend(base, overlay, 0.5);
        // arm_l 被叠加
        assert.strictEqual(r.getBoneTransform('arm_l').x, 12);
        // 其他骨骼不受影响
        assert.strictEqual(r.getBoneTransform('root').x, 0);
    });

    it('叠加层中独有的骨骼被添加', () => {
        const base = createHumanoidPose();
        const overlay = new SkeletonPose(new Map([
            ['extra_bone', { x: 5, y: 5, rotation: 0, scaleX: 1, scaleY: 1 }]
        ]));

        const r = SkeletonPose.blend(base, overlay, 0.5);
        assert.strictEqual(r.hasBone('extra_bone'), true);
        assert.strictEqual(r.getBoneTransform('extra_bone').x, 2.5); // 5*0.5
    });

    it('blend 不修改 base', () => {
        const base = createHumanoidPose();
        const overlay = createHumanoidPose();
        overlay.setBoneTransform('arm_l', { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

        SkeletonPose.blend(base, overlay, 0.5);
        assert.strictEqual(base.getBoneTransform('arm_l').x, 7);
    });
});
