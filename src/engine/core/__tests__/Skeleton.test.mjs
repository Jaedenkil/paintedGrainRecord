// @ts-check

/**
 * @fileoverview
 * Skeleton 单元测试
 *
 * 测试覆盖：
 * - 三种预设骨架的骨骼数量与名称
 * - getBone 查询
 * - getPose / applyPose 往返
 * - resetPose 重置
 * - setWorldPosition / getWorldPosition
 *
 * @module core/__tests__/Skeleton
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Skeleton, SKELETON_PRESETS } from '../Skeleton.mjs';
import { SkeletonPose } from '../SkeletonPose.mjs';

// ==================== 预设完整性 ====================

describe('Skeleton - 预设定义', () => {
    it('包含三种骨架类型', () => {
        assert.ok(SKELETON_PRESETS.humanoid);
        assert.ok(SKELETON_PRESETS.quadruped);
        assert.ok(SKELETON_PRESETS.alien);
    });

    it('humanoid 预设包含 7 根骨骼', () => {
        const preset = SKELETON_PRESETS.humanoid;
        assert.strictEqual(preset.bones.length, 7);
        assert.strictEqual(preset.type, 'humanoid');
    });

    it('quadruped 预设包含 8 根骨骼', () => {
        const preset = SKELETON_PRESETS.quadruped;
        assert.strictEqual(preset.bones.length, 8);
    });

    it('alien 预设包含 11 根骨骼', () => {
        const preset = SKELETON_PRESETS.alien;
        assert.strictEqual(preset.bones.length, 11);
    });
});

// ==================== 骨架构建 ====================

describe('Skeleton - 骨架构建', () => {
    it('创建 humanoid 骨架，包含 7 根骨骼', () => {
        const sk = new Skeleton('humanoid');
        assert.strictEqual(sk.boneCount, 7);
    });

    it('humanoid 所有骨骼名称正确', () => {
        const sk = new Skeleton('humanoid');
        const names = sk.getBoneNames().sort();
        assert.deepEqual(names, [
            'arm_l', 'arm_r',
            'head',
            'leg_l', 'leg_r',
            'root', 'spine'
        ].sort());
    });

    it('quadruped 所有骨骼名称正确', () => {
        const sk = new Skeleton('quadruped');
        const names = sk.getBoneNames();
        assert.strictEqual(names.length, 8);
        assert.ok(names.includes('root'));
        assert.ok(names.includes('spine'));
        assert.ok(names.includes('neck'));
        assert.ok(names.includes('head'));
        assert.ok(names.includes('leg_bl'));
        assert.ok(names.includes('leg_br'));
        assert.ok(names.includes('leg_fl'));
        assert.ok(names.includes('leg_fr'));
    });

    it('alien 所有骨骼名称正确', () => {
        const sk = new Skeleton('alien');
        assert.strictEqual(sk.boneCount, 11);
    });
});

// ==================== getBone ====================

describe('Skeleton - getBone', () => {
    it('通过名称获取骨骼实例', () => {
        const sk = new Skeleton('humanoid');
        const bone = sk.getBone('arm_l');
        assert.ok(bone);
        assert.strictEqual(bone.name, 'arm_l');
    });

    it('不存在的骨骼抛出 Error', () => {
        const sk = new Skeleton('humanoid');
        assert.throws(() => sk.getBone('nonexistent'), Error);
    });

    it('查询的骨骼具有正确的父子关系', () => {
        const sk = new Skeleton('humanoid');
        const arm = sk.getBone('arm_l');
        const spine = sk.getBone('spine');
        assert.strictEqual(arm.parent, spine);
    });
});

// ==================== getPose / applyPose ====================

describe('Skeleton - getPose / applyPose', () => {
    it('getPose 返回包含所有骨骼变换的 SkeletonPose', () => {
        const sk = new Skeleton('humanoid');
        const pose = sk.getPose();
        assert.ok(pose instanceof SkeletonPose);
        assert.strictEqual(pose.boneCount, 7);
    });

    it('applyPose 将变换写入骨骼并更新世界变换', () => {
        const sk = new Skeleton('humanoid');
        const pose = sk.getPose();

        // 修改左臂旋转
        pose.setBoneTransform('arm_l', { x: 7, y: -10, rotation: -90, scaleX: 1, scaleY: 1 });
        sk.applyPose(pose);

        const arm = sk.getBone('arm_l');
        assert.strictEqual(arm.localRotation, 270); // -90 → 270
    });

    it('applyPose 后世界变换已更新', () => {
        const sk = new Skeleton('humanoid');
        const pose = sk.getPose();

        // 移动根骨骼
        pose.setBoneTransform('root', { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 });
        sk.applyPose(pose);

        // 子骨骼也应反映世界位置变化
        const spine = sk.getBone('spine');
        assert.strictEqual(spine.worldX, 100);
        assert.strictEqual(spine.worldY, 182); // 200 - 18
    });

    it('getPose → applyPose 往返不变', () => {
        const sk = new Skeleton('humanoid');
        const pose1 = sk.getPose();
        sk.applyPose(pose1);
        const pose2 = sk.getPose();

        // 比较每根骨骼变换
        for (const name of sk.getBoneNames()) {
            const t1 = pose1.getBoneTransform(name);
            const t2 = pose2.getBoneTransform(name);
            assert.strictEqual(t1.x, t2.x, `${name}.x`);
            assert.strictEqual(t1.y, t2.y, `${name}.y`);
            assert.strictEqual(t1.rotation, t2.rotation, `${name}.rotation`);
            assert.strictEqual(t1.scaleX, t2.scaleX, `${name}.scaleX`);
            assert.strictEqual(t1.scaleY, t2.scaleY, `${name}.scaleY`);
        }
    });
});

// ==================== resetPose ====================

describe('Skeleton - resetPose', () => {
    it('重置后骨骼回到预设初始姿态', () => {
        const sk = new Skeleton('humanoid');
        const arm = sk.getBone('arm_l');

        // 修改后再重置
        arm.setTransform({ rotation: 180 });
        sk.updateWorldTransform();
        assert.strictEqual(arm.localRotation, 180);

        sk.resetPose();

        // 回到预设值
        const preset = SKELETON_PRESETS.humanoid.bones.find(b => b.name === 'arm_l');
        assert.strictEqual(arm.localRotation, preset.rotation ?? 0);
    });
});

// ==================== 世界位置 ====================

describe('Skeleton - 世界位置', () => {
    it('setWorldPosition 移动根骨骼', () => {
        const sk = new Skeleton('humanoid');
        sk.setWorldPosition(320, 240);

        const pos = sk.getWorldPosition();
        assert.strictEqual(pos.x, 320);
        assert.strictEqual(pos.y, 240);
    });

    it('子骨骼世界位置随根骨骼移动', () => {
        const sk = new Skeleton('humanoid');
        sk.setWorldPosition(100, 100);

        const spine = sk.getBone('spine');
        assert.strictEqual(spine.worldX, 100);
        assert.strictEqual(spine.worldY, 82); // 100 - 18
    });

    it('默认世界位置为 (0, 0)', () => {
        const sk = new Skeleton('humanoid');
        const pos = sk.getWorldPosition();
        assert.strictEqual(pos.x, 0);
        assert.strictEqual(pos.y, 0);
    });
});
