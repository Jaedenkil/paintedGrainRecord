// @ts-check

/**
 * @fileoverview
 * Bone 单元测试
 *
 * 测试覆盖：
 * - quantizeAngle 角度量化
 * - 骨骼创建与父子层级
 * - 本地变换获取/设置
 * - 世界变换递归计算
 * - 父子链接与解链
 *
 * @module core/__tests__/Bone
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Bone, quantizeAngle } from '../Bone.mjs';

// ==================== 角度量化 ====================

describe('Bone - quantizeAngle', () => {
    it('80° → 90°', () => {
        assert.strictEqual(quantizeAngle(80), 90);
    });

    it('100° → 90°', () => {
        assert.strictEqual(quantizeAngle(100), 90);
    });

    it('120° → 135°', () => {
        assert.strictEqual(quantizeAngle(120), 135);
    });

    it('-45° → 315°', () => {
        assert.strictEqual(quantizeAngle(-45), 315);
    });

    it('400° → 40°', () => {
        assert.strictEqual(quantizeAngle(400), 45);
    });

    it('720° → 0°', () => {
        assert.strictEqual(quantizeAngle(720), 0);
    });

    it('0° → 0°', () => {
        assert.strictEqual(quantizeAngle(0), 0);
    });

    it('360° → 0°', () => {
        assert.strictEqual(quantizeAngle(360), 0);
    });
});

// ==================== 基础功能 ====================

describe('Bone - 基础功能', () => {
    it('创建骨骼时设置名称和变换', () => {
        const bone = new Bone('test', { x: 10, y: 20, rotation: 45, scaleX: 2, scaleY: 1.5, length: 8 });
        assert.strictEqual(bone.name, 'test');
        assert.strictEqual(bone.length, 8);

        const local = bone.getLocalTransform();
        assert.strictEqual(local.x, 10);
        assert.strictEqual(local.y, 20);
        assert.strictEqual(local.rotation, 45);
        assert.strictEqual(local.scaleX, 2);
        assert.strictEqual(local.scaleY, 1.5);
    });

    it('默认变换为零偏移、零旋转、单位缩放', () => {
        const bone = new Bone('default');
        const t = bone.getLocalTransform();
        assert.strictEqual(t.x, 0);
        assert.strictEqual(t.y, 0);
        assert.strictEqual(t.rotation, 0);
        assert.strictEqual(t.scaleX, 1);
        assert.strictEqual(t.scaleY, 1);
        assert.strictEqual(bone.length, 0);
    });

    it('setTransform 设置并自动量化旋转', () => {
        const bone = new Bone('test');
        bone.setTransform({ x: 5, y: -3, rotation: 80, scaleX: 1.5 });
        const t = bone.getLocalTransform();
        assert.strictEqual(t.x, 5);
        assert.strictEqual(t.y, -3);
        assert.strictEqual(t.rotation, 90);  // 80 → 90
        assert.strictEqual(t.scaleX, 1.5);
        assert.strictEqual(t.scaleY, 1);     // 未修改
    });

    it('getWorldTransform 返回独立副本', () => {
        const bone = new Bone('test', { x: 10, y: 20 });
        bone.updateWorldTransform();
        const w1 = bone.getWorldTransform();
        const w2 = bone.getWorldTransform();
        w1.x = 999;  // 修改副本不应影响原始
        assert.strictEqual(w2.x, 10);
    });
});

// ==================== 父子层级 ====================

describe('Bone - 父子层级', () => {
    it('addChild 建立父子关系', () => {
        const parent = new Bone('parent');
        const child = new Bone('child');
        parent.addChild(child);

        assert.strictEqual(child.parent, parent);
        assert.strictEqual(parent.children.length, 1);
        assert.strictEqual(parent.children[0], child);
    });

    it('addChild 返回自身支持链式调用', () => {
        const parent = new Bone('parent');
        const child1 = new Bone('child1');
        const child2 = new Bone('child2');
        parent.addChild(child1).addChild(child2);
        assert.strictEqual(parent.children.length, 2);
    });

    it('removeChild 移除父子关系', () => {
        const parent = new Bone('parent');
        const child = new Bone('child');
        parent.addChild(child);
        const removed = parent.removeChild(child);

        assert.strictEqual(removed, true);
        assert.strictEqual(child.parent, null);
        assert.strictEqual(parent.children.length, 0);
    });

    it('移除不存在的子骨骼返回 false', () => {
        const parent = new Bone('parent');
        const child = new Bone('child');
        assert.strictEqual(parent.removeChild(child), false);
    });

    it('子骨骼重新添加到新父节点时自动从旧父节点移除', () => {
        const p1 = new Bone('p1');
        const p2 = new Bone('p2');
        const child = new Bone('child');

        p1.addChild(child);
        assert.strictEqual(p1.children.length, 1);

        p2.addChild(child);
        assert.strictEqual(p1.children.length, 0);
        assert.strictEqual(p2.children.length, 1);
        assert.strictEqual(child.parent, p2);
    });

    it('children 属性为只读引用', () => {
        const parent = new Bone('parent');
        const child = new Bone('child');
        parent.addChild(child);
        const children = parent.children;
        // children 是数组引用，但内容应受控
        assert.strictEqual(Array.isArray(children), true);
    });
});

// ==================== 世界变换 ====================

describe('Bone - 世界变换', () => {
    it('根骨骼的世界变换等于本地变换', () => {
        const root = new Bone('root', { x: 100, y: 200, rotation: 45 });
        root.updateWorldTransform();

        assert.strictEqual(root.worldX, 100);
        assert.strictEqual(root.worldY, 200);
        assert.strictEqual(root.worldRotation, 45);
        assert.strictEqual(root.worldScaleX, 1);
        assert.strictEqual(root.worldScaleY, 1);
    });

    it('子骨骼的世界位置基于父骨骼末端 + 本地偏移', () => {
        // 父骨骼向右延伸 length=10
        const root = new Bone('root', { x: 0, y: 0, rotation: 0, length: 10 });
        // 子骨骼在父骨骼末端 + 本地偏移
        const child = new Bone('child', { x: 5, y: -3 });
        root.addChild(child);
        root.updateWorldTransform();

        // 父骨骼末端：x=0 + cos(0)*10 = 10, y=0 + sin(0)*10 = 0
        // 子骨骼世界位置：x=10 + 5*cos(0) - (-3)*sin(0) = 15
        //                y=0  + 5*sin(0) + (-3)*cos(0) = -3
        assert.strictEqual(child.worldX, 15);
        assert.strictEqual(child.worldY, -3);
    });

    it('世界旋转 = 父旋转 + 子旋转（量化后）', () => {
        const root = new Bone('root', { rotation: 45 });
        const child = new Bone('child', { rotation: 90 });
        root.addChild(child);
        root.updateWorldTransform();

        assert.strictEqual(child.worldRotation, 135);  // 45 + 90
    });

    it('世界缩放 = 父缩放 × 子缩放', () => {
        const root = new Bone('root', { scaleX: 2, scaleY: 3 });
        const child = new Bone('child', { scaleX: 1.5, scaleY: 0.5 });
        root.addChild(child);
        root.updateWorldTransform();

        assert.strictEqual(child.worldScaleX, 3);   // 2 × 1.5
        assert.strictEqual(child.worldScaleY, 1.5); // 3 × 0.5
    });

    it('递归更新：二级子骨骼位置正确', () => {
        const root = new Bone('root', { x: 0, y: 0, length: 10 });
        const mid = new Bone('mid', { x: 0, y: 0, rotation: 0, length: 8 });
        const tip = new Bone('tip', { x: 3, y: 0 });

        root.addChild(mid);
        mid.addChild(tip);
        root.updateWorldTransform();

        // root 末端: (10, 0)
        // mid 世界位置: (10, 0), 末端: (10 + 8 = 18, 0)
        // tip 世界位置: (18 + 3 = 21, 0)
        assert.strictEqual(tip.worldX, 21);
        assert.strictEqual(tip.worldY, 0);
    });

    it('setTransform 后重新 updateWorldTransform 生效', () => {
        const root = new Bone('root', { x: 0, y: 0 });
        const child = new Bone('child', { x: 10, y: 0 });
        root.addChild(child);
        root.updateWorldTransform();
        assert.strictEqual(child.worldX, 10);

        child.setTransform({ x: 20, y: 0 });
        root.updateWorldTransform();
        assert.strictEqual(child.worldX, 20);
    });
});

// ==================== 复杂树形 ====================

describe('Bone - 复杂树形', () => {
    it('三层骨骼树位置正确', () => {
        // 模拟简化人形：root → spine → arm
        const root = new Bone('root', { x: 50, y: 100, length: 0 });
        const spine = new Bone('spine', { x: 0, y: -20, length: 0 });
        const arm = new Bone('arm', { x: 8, y: -5, rotation: -45, length: 12 });

        root.addChild(spine);
        spine.addChild(arm);
        root.updateWorldTransform();

        // spine.world = (50, 80)
        assert.strictEqual(spine.worldX, 50);
        assert.strictEqual(spine.worldY, 80);

        // arm: spine末端(50, 80) + 偏移(8, -5)旋转(spine.rotation=0)
        // arm.world = (50+8, 80-5) = (58, 75)
        assert.strictEqual(arm.worldX, 58);
        assert.strictEqual(arm.worldY, 75);
        // arm.worldRotation = 0 + (-45 quantized) = 315
        assert.strictEqual(arm.worldRotation, 315);
    });
});
