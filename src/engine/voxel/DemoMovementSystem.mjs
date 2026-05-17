// @ts-check

/**
 * @fileoverview ECS 演示移动系统 —— 验证 ECS 全链路正常运转。
 *
 * 处理拥有 Position + Velocity 组件的实体：
 * 1. 每帧根据输入状态调制 Velocity（WASD/方向键 → 速度方向）
 * 2. 更新位置：gx += vx * dt, gy += vy * dt
 * 3. 边界回弹（±20 范围内）
 * 4. 每 60 帧输出一次所有实体位置快照到控制台
 *
 * @module voxel/DemoMovementSystem
 */

import { System } from '../ecs/System.mjs';
import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function }} */
const log = Logger.for('ECS');

/** 边界范围（±20 格） */
const BOUNDARY = 20;

/** 日志输出间隔（帧数） */
const LOG_INTERVAL = 60;

/** 键盘驱动的基础移动速度（格/秒） */
const MOVE_SPEED = 8;

/** 对角线归一化系数：1 / √2 ≈ 0.7071，防止斜向移动速度过快 */
const DIAG_INV = 1 / Math.SQRT2;

export class DemoMovementSystem extends System {
    /**
     * @param {{ isDown: (action: string) => boolean }} [inputSource] 可选的输入源，
     *     提供 isDown(action) 查询逻辑动作是否处于按住状态。
     *     在浏览器/Electron 环境中通常传入 InputModule，在测试环境中传入 MockInputSource。
     *     若未提供或为 null，系统保持原有行为——velocity 由外部设置，系统仅执行 pos += vel * dt。
     */
    constructor(inputSource) {
        super('DemoMovement', ['Position', 'Velocity']);
        /** @private @type {{ isDown: (action: string) => boolean }|null} */
        this._input = inputSource || null;
        /** @private @type {number} */ this._frameCount = 0;
    }

    /**
     * @override
     * @param {number[]} entities
     * @param {number} dt
     */
    update(entities, dt) {
        this._frameCount++;

        for (const id of entities) {
            const pos = /** @type {{ gx: number, gy: number, wz: number }} */ (
                this.world.getComponent(id, 'Position')
            );
            const vel = /** @type {{ vx: number, vy: number }} */ (
                this.world.getComponent(id, 'Velocity')
            );

            // ── 若有输入源，根据按键状态调制速度 ──
            if (this._input) {
                let dx = 0;
                let dy = 0;
                if (this._input.isDown('move_right')) dx += 1;
                if (this._input.isDown('move_left'))  dx -= 1;
                if (this._input.isDown('move_down'))  dy += 1;
                if (this._input.isDown('move_up'))    dy -= 1;

                // 对角线归一化，防止斜向移动速度（≈1.414×）快于轴向移动
                if (dx !== 0 && dy !== 0) {
                    vel.vx = dx * MOVE_SPEED * DIAG_INV;
                    vel.vy = dy * MOVE_SPEED * DIAG_INV;
                } else {
                    vel.vx = dx * MOVE_SPEED;
                    vel.vy = dy * MOVE_SPEED;
                }
}


            // ── 应用速度更新位置 ──
            pos.gx += vel.vx * dt;
            pos.gy += vel.vy * dt;

            // 边界回弹
            if (pos.gx > BOUNDARY) pos.gx = -BOUNDARY;
            if (pos.gx < -BOUNDARY) pos.gx = BOUNDARY;
            if (pos.gy > BOUNDARY) pos.gy = -BOUNDARY;
            if (pos.gy < -BOUNDARY) pos.gy = BOUNDARY;
        }

        // ── 每 LOG_INTERVAL 帧输出一次位置快照 ──
        if (this._frameCount % LOG_INTERVAL === 0) {
            const labels = ['❶', '❷', '❸'];
            entities.forEach((id, i) => {
                const pos = /** @type {{ gx: number, gy: number, wz: number }} */ (
                    this.world.getComponent(id, 'Position')
                );
                log.info(`Entity ${labels[i] || id} 位置: (${pos.gx.toFixed(1)}, ${pos.gy.toFixed(1)}, ${pos.wz})`);
            });
        }
    }
}
