// @ts-check

/**
 * @fileoverview
 * InputCommand —— 方块操作命令工厂（命令模式）。
 *
 * 每个命令是一个包含 type、timestamp、execute() 和预留 undo() 的不可变对象。
 * 通过 Object.freeze 保证命令对象的不可变性，为未来实现撤销/重做提供基础。
 *
 * ## 命令格式
 * ```
 * {
 *   type: 'placeBlock' | 'removeBlock' | 'selectBlock',
 *   timestamp: number,
 *   execute: () => any,
 *   undo?: () => void       // 预留
 * }
 * ```
 *
 * ## 设计原则
 * 1. 所有方法为静态工厂，返回命令对象
 * 2. 命令对象不可变（freeze），防止运行时篡改
 * 3. 操作体素数据层（voxelId），不涉及渲染层 blockType
 * 4. 不依赖任何 PixiJS 或渲染模块，可在 node --test 中纯逻辑测试
 *
 * @module input/InputCommand
 */

import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('InputCommand');

/**
 * 输入命令工厂 —— 构造不可变的方块操作命令。
 *
 * @example
 * ```javascript
 * import { InputCommand } from './InputCommand.mjs';
 *
 * // 构造放置命令并执行
 * const cmd = InputCommand.PlaceBlock(world, 5, 3, 0, 1); // 1 = grass
 * cmd.execute();
 *
 * // 移除方块
 * InputCommand.RemoveBlock(world, 5, 3, 0).execute();
 * ```
 */
export class InputCommand {

    /**
     * 构造"放置方块"命令。
     *
     * @param {import('../voxel/VoxelWorld.mjs').VoxelWorld} world - 体素世界实例
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @param {number} voxelId - 体素 ID（1=grass, 2=dirt, 3=stone, ... 0=空气）
     * @returns {{ type: string, timestamp: number, execute: () => void }} 冻结的命令对象
     *
     * @example
     * ```javascript
     * // 在 (10, 5, 0) 放置石头
     * InputCommand.PlaceBlock(world, 10, 5, 0, 3).execute();
     * ```
     */
    static PlaceBlock(world, gx, gy, gz, voxelId) {
        if (!world || typeof world.setVoxel !== 'function') {
            log.error('PlaceBlock: 无效的 world 实例');
            return createNoopCommand('placeBlock');
        }
        if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) {
            log.error('PlaceBlock: 无效的网格坐标');
            return createNoopCommand('placeBlock');
        }

        return Object.freeze({
            type: 'placeBlock',
            timestamp: Date.now(),
            execute() {
                world.setVoxel(gx, gy, gz, voxelId);
                log.info(`放置方块: voxelId=${voxelId} @ (${gx}, ${gy}, ${gz})`);
            }
        });
    }

    /**
     * 构造"移除方块"命令（将体素设为 0 / 空气）。
     *
     * @param {import('../voxel/VoxelWorld.mjs').VoxelWorld} world - 体素世界实例
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @returns {{ type: string, timestamp: number, execute: () => void }} 冻结的命令对象
     *
     * @example
     * ```javascript
     * InputCommand.RemoveBlock(world, 10, 5, 0).execute();
     * ```
     */
    static RemoveBlock(world, gx, gy, gz) {
        if (!world || typeof world.setVoxel !== 'function') {
            log.error('RemoveBlock: 无效的 world 实例');
            return createNoopCommand('removeBlock');
        }

        return Object.freeze({
            type: 'removeBlock',
            timestamp: Date.now(),
            execute() {
                world.setVoxel(gx, gy, gz, 0);
                log.info(`移除方块 @ (${gx}, ${gy}, ${gz})`);
            }
        });
    }

    /**
     * 构造"选择方块"命令（查询性，不修改世界数据）。
     *
     * 用于：
     * - 高亮选中的方块
     * - 显示方块信息（类型、坐标）
     * - 作为后续操作（放置/移除）的输入
     *
     * @param {import('../voxel/VoxelWorld.mjs').VoxelWorld} world - 体素世界实例
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标
     * @returns {{ type: string, timestamp: number, execute: () => { blockType: string|null, voxelId: number, exists: boolean } }} 冻结的命令对象
     *
     * @example
     * ```javascript
     * const result = InputCommand.SelectBlock(world, 10, 5, 0).execute();
     * // → { blockType: 'stone', voxelId: 3, exists: true }
     * ```
     */
    static SelectBlock(world, gx, gy, gz) {
        return Object.freeze({
            type: 'selectBlock',
            timestamp: Date.now(),
            execute() {
                const voxelId = world.getVoxel(gx, gy, gz);
                const exists = voxelId !== 0;
                const blockType = voxelIdToBlockType(voxelId);
                log.info(`选择方块 @ (${gx}, ${gy}, ${gz}): ${exists ? blockType : '空气'}`);
                return { blockType, voxelId, exists };
            }
        });
    }
}

// ==================== 内部工具 ====================

/**
 * 创建空操作命令（参数校验失败时的安全降级）。
 * @param {string} type
 * @returns {{ type: string, timestamp: number, execute: () => void }}
 */
function createNoopCommand(type) {
    return Object.freeze({
        type,
        timestamp: Date.now(),
        execute() { /* no-op */ }
    });
}

/**
 * 体素 ID → 方块类型映射表。
 * 此映射是 VoxelDemoScene 中 VOXEL_ID_TO_BLOCK_TYPE 的副本。
 * 后续应在 P4 纹理管线阶段统一到全局映射模块中。
 * @type {Object<number, string>}
 */
const VOXEL_ID_TO_BLOCK_TYPE = {
    1: 'grass',
    2: 'dirt',
    3: 'stone',
    4: 'brick',
    5: 'plank',
    6: 'sand',
    7: 'snow',
    8: 'jade',
    9: 'water',
    10: 'roof',
    11: 'cloud'
};

/**
 * 将体素 ID 映射为方块类型字符串。
 * @param {number} voxelId
 * @returns {string|null} 0=空气返回 null，未知 ID 默认 'grass'
 */
function voxelIdToBlockType(voxelId) {
    if (voxelId === 0) return null;
    return VOXEL_ID_TO_BLOCK_TYPE[voxelId] || 'grass';
}
