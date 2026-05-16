// @ts-check

/**
 * @fileoverview
 * 简化版世界生成器 —— 为渲染管线提供可直接使用的测试数据。
 *
 * ## 职责
 *
 * - `generateFlat`：平坦世界填充（用于渲染管线基础正确性测试）
 * - `generateTestTower`：柱状测试塔（用于多 Chunk 渲染验证）
 * - `generatePerlin`：占位存根（提示尚未实现）
 *
 * ## 与 VoxelWorld 的关系
 *
 * 生成器是纯静态工具，不持有 VoxelWorld 引用，每次调用接受一个 VoxelWorld
 * 实例并直接修改它。这符合"数据管理独立于生成"的设计原则。
 *
 * ## 设计原则
 *
 * - 纯数据层：不依赖任何渲染、IO 或物理模块
 * - 零副作用：只修改传入的 VoxelWorld，不产生外部影响
 * - 可叠加：多次调用不同生成器可以叠加在同一世界实例上
 *
 * @module voxel/SimpleWorldGenerator
 */

import { CHUNK_SIZE, worldToChunk, worldToLocal } from './ChunkCoordUtils.mjs';

/**
 * @typedef {import('./VoxelWorld.mjs').VoxelWorld} VoxelWorld
 */

/**
 * 生成器边界范围
 * @typedef {Object} GeneratorBounds
 * @property {number} [cx=0]    - 中心 Chunk X
 * @property {number} [cy=0]    - 中心 Chunk Y
 * @property {number} [radius=3] - 生成半径（Chunk 单位）
 */

export class SimpleWorldGenerator {
    /**
     * 生成平坦世界。
     *
     * 在指定范围内的所有水平坐标 (wx, wy) 上，从 wz=0 到 wz=height-1
     * 填充指定的 blockId。超出 wz 范围的部分保持空气。
     *
     * @param {VoxelWorld} world - 要填充的世界实例
     * @param {number} height - 地面厚度（1 ~ 16，超出会被钳制到 [1, 16]）
     * @param {number} blockId - 方块 ID（1 ~ 65535）
     * @param {GeneratorBounds} [bounds] - 可选范围，默认 cx=0, cy=0, radius=3
     *
     * @example
     * ```js
     * import { VoxelWorld } from './VoxelWorld.mjs';
     * import { SimpleWorldGenerator } from './SimpleWorldGenerator.mjs';
     *
     * const world = new VoxelWorld();
     * SimpleWorldGenerator.generateFlat(world, 4, 1);
     * // 以 (0,0) 为中心、半径 3（7×7 Chunk）的平坦地面，厚度 4 层
     * world.getVoxel(0, 0, 0); // → 1
     * world.getVoxel(0, 0, 4); // → 0（空气）
     * ```
     */
    static generateFlat(world, height, blockId, bounds = {}) {
        if (!world || typeof world.setVoxel !== 'function') {
            throw new TypeError('SimpleWorldGenerator.generateFlat: world 必须是 VoxelWorld 实例');
        }

        // 钳制高度到有效范围 [1, CHUNK_SIZE]
        const clampedHeight = Math.max(1, Math.min(height, CHUNK_SIZE));

        // 处理方块 ID
        const id = blockId || 1;

        // 解析范围
        const centerCX = bounds.cx || 0;
        const centerCY = bounds.cy || 0;
        const radius = bounds.radius !== undefined ? Math.max(0, bounds.radius) : 3;

        const minCX = centerCX - radius;
        const maxCX = centerCX + radius;
        const minCY = centerCY - radius;
        const maxCY = centerCY + radius;

        // 计算世界坐标范围
        const minWX = minCX * CHUNK_SIZE;
        const maxWX = (maxCX + 1) * CHUNK_SIZE - 1;
        const minWY = minCY * CHUNK_SIZE;
        const maxWY = (maxCY + 1) * CHUNK_SIZE - 1;

        // 填充每一层
        for (let wz = 0; wz < clampedHeight; wz++) {
            for (let wx = minWX; wx <= maxWX; wx++) {
                for (let wy = minWY; wy <= maxWY; wy++) {
                    world.setVoxel(wx, wy, wz, id);
                }
            }
        }
    }

    /**
     * 生成测试塔。
     *
     * 在指定 Chunk 的中心位置生成一个 3×3 的柱状塔，从 wz=0 到 wz=height-1。
     * 塔身全部使用指定的 blockId。
     *
     * 多 Chunk 场景下测试塔可以用于验证：
     * - Chunk 边界处体素渲染是否正确拼接
     * - 多 Chunk 的排序和 z-index 是否正确
     * - 塔的遮挡关系是否正确
     *
     * @param {VoxelWorld} world - 世界实例
     * @param {number} cx - 目标 Chunk X
     * @param {number} cy - 目标 Chunk Y
     * @param {number} height - 塔高度（1 ~ 16）
     * @param {number} [blockId=1] - 方块 ID
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * SimpleWorldGenerator.generateTestTower(world, 0, 0, 8);
     * // 在 Chunk(0,0) 中心产生一座 3×3 基底、高 8 层的塔
     * ```
     */
    static generateTestTower(world, cx, cy, height, blockId = 1) {
        if (!world || typeof world.setVoxel !== 'function') {
            throw new TypeError('SimpleWorldGenerator.generateTestTower: world 必须是 VoxelWorld 实例');
        }

        const clampedHeight = Math.max(1, Math.min(height, CHUNK_SIZE));

        // 计算 Chunk 中心的世界坐标（取 Chunk 中间 3×3 区域）
        const centerX = cx * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);
        const centerY = cy * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);

        // 3×3 塔基底范围
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const wx = centerX + dx;
                const wy = centerY + dy;

                for (let wz = 0; wz < clampedHeight; wz++) {
                    world.setVoxel(wx, wy, wz, blockId);
                }
            }
        }
    }

    /**
     * 占位：Perlin 噪声地形生成器（暂存根）。
     *
     * 当前版本不实现实际噪声算法，调用时只在控制台输出一条提醒信息。
     * 未来将使用 Perlin/Simplex 噪声生成自然地形。
     *
     * 调用此方法是安全的——它不会修改世界数据。
     *
     * @param {VoxelWorld} world - 世界实例（暂未使用）
     * @param {number} seed - 随机种子
     * @param {Object} [config] - 配置项（暂未使用）
     * @param {number} [config.heightScale=8] - 地形高度缩放
     * @param {number} [config.frequency=0.05] - 噪声频率
     *
     * @example
     * ```js
     * const world = new VoxelWorld();
     * SimpleWorldGenerator.generatePerlin(world, 42, { heightScale: 10 });
     * // 控制台输出: [SimpleWorldGenerator] generatePerlin 尚未实现，使用 generateFlat 替代
     * ```
     */
    static generatePerlin(world, seed, config = {}) {
        // eslint-disable-next-line no-console
        console.warn(
            '[SimpleWorldGenerator] generatePerlin 尚未实现，' +
            '请使用 generateFlat 或 generateTestTower 生成测试数据。' +
            `(seed=${seed}, heightScale=${config.heightScale ?? 8})`
        );
    }
}
