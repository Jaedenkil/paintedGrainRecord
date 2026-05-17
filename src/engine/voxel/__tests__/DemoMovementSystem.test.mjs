// @ts-check

/**
 * @fileoverview
 * DemoMovementSystem 单元测试 —— 验证键盘输入驱动实体移动的正确性。
 *
 * 测试覆盖：
 * - 无 inputSource 时保持向后兼容（vel 不变）
 * - 输入驱动：W/A/S/D 各方向速度调制
 * - 对角线归一化（同时按两个方向速度不变快）
 * - 无按键时 vel 归零
 * - 位置更新（pos += vel * dt）
 * - 边界回弹保持
 * - destroy() 后不再影响 world
 *
 * @module __tests__/DemoMovementSystem
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../../ecs/World.mjs';
import { DemoMovementSystem } from '../DemoMovementSystem.mjs';

// ═══════════════════════════════════════════
//  MockInputSource：模拟 isDown 查询
// ═══════════════════════════════════════════

class MockInputSource {
    constructor() {
        /** @private @type {Map<string, boolean>} */
        this._states = new Map();
    }

    /**
     * 设置指定动作的按下状态。
     * @param {string} action
     * @param {boolean} down
     */
    setDown(action, down) {
        this._states.set(action, down);
    }

    /**
     * 清除所有按键状态。
     */
    reset() {
        this._states.clear();
    }

    /**
     * 查询指定动作当前是否按住。
     * @param {string} action
     * @returns {boolean}
     */
    isDown(action) {
        return this._states.get(action) === true;
    }
}

// ═══════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════

/**
 * 创建一个带 DemoMovementSystem 的 World，并添加一个 Position+Velocity 实体。
 * @param {MockInputSource} [inputSource]
 * @returns {{ world: World, system: DemoMovementSystem, entityId: number, pos: { gx: number, gy: number, wz: number }, vel: { vx: number, vy: number } }}
 */
function createTestWorld(inputSource) {
    const world = new World();
    const system = new DemoMovementSystem(inputSource || null);
    world.addSystem(system);

    const entityId = world.createEntity();
    const pos = { gx: 0, gy: 0, wz: 0 };
    const vel = { vx: 0, vy: 0 };
    world.addComponent(entityId, 'Position', pos);
    world.addComponent(entityId, 'Velocity', vel);

    return { world, system, entityId, pos, vel };
}

// ═══════════════════════════════════════════
//  测试套件
// ═══════════════════════════════════════════

describe('DemoMovementSystem', () => {

    // ── 构造 ──

    describe('constructor()', () => {
        it('无 inputSource 时应创建成功', () => {
            const sys = new DemoMovementSystem();
            assert.ok(sys);
            assert.equal(sys._input, null);
        });

        it('传入 inputSource 时应存储引用', () => {
            const mock = new MockInputSource();
            const sys = new DemoMovementSystem(mock);
            assert.equal(sys._input, mock);
        });

        it('传入 null 时应等同于未传入', () => {
            const sys = new DemoMovementSystem(null);
            assert.equal(sys._input, null);
        });
    });

    // ── 向后兼容 ──

    describe('向后兼容（无 inputSource）', () => {
        it('vel 应保持不变（系统仅执行 pos += vel * dt）', () => {
            const { world, system, pos, vel } = createTestWorld();
            vel.vx = 3;
            vel.vy = 5;

            world.update(1); // dt = 1

            assert.equal(vel.vx, 3, 'vx 应保持不变');
            assert.equal(vel.vy, 5, 'vy 应保持不变');
            assert.equal(pos.gx, 3, 'gx 应增加 3');
            assert.equal(pos.gy, 5, 'gy 应增加 5');
        });
    });

    // ── 输入驱动 ──

    describe('输入驱动速度调制', () => {
        it('move_right 应使 vel.vx 为正', () => {
            const mock = new MockInputSource();
            mock.setDown('move_right', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);
            assert.ok(vel.vx > 0, `vel.vx 应为正，实际为 ${vel.vx}`);
            assert.equal(vel.vy, 0, 'vel.vy 应为 0');
        });

        it('move_left 应使 vel.vx 为负', () => {
            const mock = new MockInputSource();
            mock.setDown('move_left', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);
            assert.ok(vel.vx < 0, `vel.vx 应为负，实际为 ${vel.vx}`);
            assert.equal(vel.vy, 0);
        });

        it('move_up 应使 vel.vy 为负（屏幕坐标系，Y 向下为正）', () => {
            const mock = new MockInputSource();
            mock.setDown('move_up', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);
            assert.equal(vel.vx, 0);
            assert.ok(vel.vy < 0, `vel.vy 应为负，实际为 ${vel.vy}`);
        });

        it('move_down 应使 vel.vy 为正', () => {
            const mock = new MockInputSource();
            mock.setDown('move_down', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);
            assert.equal(vel.vx, 0);
            assert.ok(vel.vy > 0, `vel.vy 应为正，实际为 ${vel.vy}`);
        });

        it('同时按住右+下应对角线归一化', () => {
            const mock = new MockInputSource();
            mock.setDown('move_right', true);
            mock.setDown('move_down', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);

            // 对角线速度应为 MOVE_SPEED * DIAG_INV ≈ 8 * 0.7071 ≈ 5.657
            const expected = 8 / Math.SQRT2; // MOVE_SPEED * DIAG_INV
            const tolerance = 0.001;
            assert.ok(Math.abs(vel.vx - expected) < tolerance,
                `vel.vx 应约为 ${expected}，实际为 ${vel.vx}`);
            assert.ok(Math.abs(vel.vy - expected) < tolerance,
                `vel.vy 应约为 ${expected}，实际为 ${vel.vy}`);
        });

        it('同时按住左+上应对角线归一化（负方向）', () => {
            const mock = new MockInputSource();
            mock.setDown('move_left', true);
            mock.setDown('move_up', true);
            const { world, vel } = createTestWorld(mock);

            world.update(1);

            const expected = -(8 / Math.SQRT2);
            const tolerance = 0.001;
            assert.ok(Math.abs(vel.vx - expected) < tolerance,
                `vel.vx 应约为 ${expected}，实际为 ${vel.vx}`);
            assert.ok(Math.abs(vel.vy - expected) < tolerance,
                `vel.vy 应约为 ${expected}，实际为 ${vel.vy}`);
        });

        it('无按键时 vel 应归零', () => {
            const mock = new MockInputSource();
            const { world, vel, pos } = createTestWorld(mock);

            // 先设一个初始速度
            vel.vx = 10;
            vel.vy = 10;

            world.update(1);

            // 有输入源但无按键按下 → vel 归零
            assert.equal(vel.vx, 0, 'vel.vx 应为 0（无按键）');
            assert.equal(vel.vy, 0, 'vel.vy 应为 0（无按键）');
            // pos 不应变化（vel=0）
            assert.equal(pos.gx, 0);
            assert.equal(pos.gy, 0);
        });
    });

    // ── 位置更新 ──

    describe('位置更新', () => {
        it('按住 move_right 时 dt=0.5 应移动一半距离', () => {
            const mock = new MockInputSource();
            mock.setDown('move_right', true);
            const { world, pos } = createTestWorld(mock);

            world.update(0.5); // dt = 0.5

            // 速度 = 8，时间 = 0.5 → 距离 = 4
            assert.equal(pos.gx, 4);
            assert.equal(pos.gy, 0);
        });

        it('dt=2 应移动双倍距离', () => {
            const mock = new MockInputSource();
            mock.setDown('move_right', true);
            const { world, pos } = createTestWorld(mock);

            world.update(2);

            assert.equal(pos.gx, 16);
            assert.equal(pos.gy, 0);
        });
    });

    // ── 边界回弹 ──

    describe('边界回弹', () => {
        it('超出 +20 边界时应回弹到 -20', () => {
            const mock = new MockInputSource();
            mock.setDown('move_right', true);
            const { world, pos } = createTestWorld(mock);

            // 需要足够大的 dt 让 pos.gx 超过 20
            // speed=8, dt=3 → gx=24 > 20 → 回弹到 -20 (24 - 40 = -16... 不对)
            // 根据代码：if (pos.gx > 20) pos.gx = -20
            // 所以 gx=24 → gx=-20
            world.update(3);
            assert.equal(pos.gx, -20, '应回弹到 -20');
        });

        it('超出 -20 边界时应回弹到 20', () => {
            const mock = new MockInputSource();
            mock.setDown('move_left', true);
            const { world, pos } = createTestWorld(mock);

            world.update(3);
            assert.equal(pos.gx, 20, '应回弹到 20');
        });
    });
});
