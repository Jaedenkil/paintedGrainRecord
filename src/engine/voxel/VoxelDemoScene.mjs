// @ts-check

/**
 * @fileoverview
 * 体素世界演示场景构建器 —— 将 VoxelWorld 数据渲染到 BlockGridManager 场景中。
 *
 * ## 职责
 *
 * 1. 创建 VoxelWorld 实例
 * 2. 使用 SimpleWorldGenerator 生成地形数据（平坦 + 测试塔）
 * 3. 将体素世界坐标 (wx, wy, wz) 转换为 BlockGridManager 可消费的 string[][] 网格
 * 4. 调用 BlockRenderer.buildFromGrid / addBlock 渲染
 *
 * ## 设计说明
 *
 * 此模块是一个"临时桥接"，在 VoxelRenderAdapter（P2.1）完成之前
 * 用最小侵入的方式可视化体素数据。P2.1 完成后应废弃此文件或
 * 重构为渲染管线集成测试。
 *
 * ## 体素 ID → 方块类型映射
 *
 * | voxelId | blockType | 说明 |
 * |---------|-----------|------|
 * | 0       | null      | 空气 |
 * | 1       | grass     | 草地方块 |
 * | 2       | dirt      | 泥土地 |
 * | 3       | stone     | 岩石 |
 * | 4       | brick     | 砖块 |
 * | 5       | plank     | 木板 |
 * | 6       | sand      | 沙地 |
 * | 7       | snow      | 雪地 |
 * | 8       | jade      | 玉台 |
 * | 9       | water     | 水域 |
 * | 10      | roof      | 屋顶 |
 * | 11      | cloud     | 云块 |
 *
 * @module voxel/VoxelDemoScene
 */

import { VoxelWorld } from './VoxelWorld.mjs';
import { SimpleWorldGenerator } from './SimpleWorldGenerator.mjs';

// ==================== 体素 ID ↔ 方块类型映射 ====================

/**
 * 体素 ID 到渲染方块类型的映射表。
 * 不在表中的 ID 会被映射为 'grass'（容错降级）。
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
 * 将体素 ID 转换为渲染方块类型字符串。
 * @param {number} voxelId
 * @returns {string|null}
 */
function voxelIdToBlockType(voxelId) {
    if (voxelId === 0) return null;
    return VOXEL_ID_TO_BLOCK_TYPE[voxelId] || 'grass';
}

// ==================== 场景生成器 ====================

/**
 * 默认场景配置
 * @typedef {Object} DemoSceneConfig
 * @property {number} [seed=42] - 世界种子
 * @property {number} [terrainHeight=1] - 地面厚度
 * @property {number} [terrainBlockId=1] - 地面方块 ID（1=grass）
 * @property {number} [radius=1] - 生成半径（Chunk 单位，默认 1=3×3 Chunk）
 * @property {number} [viewMinX] - 视口最小 X（默认自动计算）
 * @property {number} [viewMinY] - 视口最小 Y（默认自动计算）
 * @property {number} [viewMaxX] - 视口最大 X（默认自动计算）
 * @property {number} [viewMaxY] - 视口最大 Y（默认自动计算）
 */

/**
 * 构建体素世界演示场景。
 *
 * 流程：
 * 1. 创建 VoxelWorld
 * 2. 生成平坦地形（顶层为草地，下层为泥土）
 * 3. 放置测试塔（不同材料）
 * 4. 从 VoxelWorld 提取所有高度层的体素数据
 * 5. 调用 BlockRenderer 的 buildFromGrid 和 addBlock 渲染
 *
 * @param {import('../render/BlockRenderer.mjs').BlockRenderer} renderer - BlockRenderer 实例
 * @param {DemoSceneConfig} [config={}] - 场景配置
 * @returns {Promise<{ world: VoxelWorld, gridWidth: number, gridHeight: number }>}
 *
 * @example
 * ```js
 * const renderer = new BlockRenderer(layerStack);
 * const result = await VoxelDemoScene.build(renderer, { seed: 123 });
 * console.log(`场景已构建: ${result.gridWidth}×${result.gridHeight}`);
 * ```
 */
export async function buildVoxelDemoScene(renderer, config = {}) {
    // === 1. 创建世界 ===
    const seed = config.seed ?? 42;
    const world = new VoxelWorld(seed);

    // === 2. 生成地形 ===
    const terrainHeight = config.terrainHeight ?? 1;
    const terrainBlockId = config.terrainBlockId ?? 1; // grass
    const radius = config.radius ?? 1;

    // 平坦地形
    SimpleWorldGenerator.generateFlat(world, terrainHeight, terrainBlockId, {
        cx: 0, cy: 0, radius
    });

    // 地形下层使用 dirt（仅当 terrainHeight > 1 时）
    if (terrainHeight > 1) {
        const minCX = -radius;
        const maxCX = radius;
        const minCY = -radius;
        const maxCY = radius;
        const minWX = minCX * 16;
        const maxWX = (maxCX + 1) * 16 - 1;
        const minWY = minCY * 16;
        const maxWY = (maxCY + 1) * 16 - 1;

        for (let wz = 0; wz < terrainHeight - 1; wz++) {
            for (let wx = minWX; wx <= maxWX; wx++) {
                for (let wy = minWY; wy <= maxWY; wy++) {
                    world.setVoxel(wx, wy, wz, 2); // dirt
                }
            }
        }
    }

    // === 3. 放置装饰塔 ===
    // 石塔 — Chunk(0,0) 中心，高 6
    SimpleWorldGenerator.generateTestTower(world, 0, 0, 6, 3);
    // 砖塔 — Chunk(1,1) 中心，高 4
    SimpleWorldGenerator.generateTestTower(world, 1, 1, 4, 4);
    // 玉塔 — Chunk(-1,-1) 中心，高 8
    SimpleWorldGenerator.generateTestTower(world, -1, -1, 8, 8);
    // 小石柱 — Chunk(1,-1) 中心，高 2
    SimpleWorldGenerator.generateTestTower(world, 1, -1, 2, 3);
    // 沙堆 — Chunk(-1,1) 中心，高 3
    SimpleWorldGenerator.generateTestTower(world, -1, 1, 3, 6);

    // === 4. 计算视口范围 ===
    const chunkMinCX = -radius;
    const chunkMaxCX = radius;
    const chunkMinCY = -radius;
    const chunkMaxCY = radius;

    const viewMinX = config.viewMinX ?? (chunkMinCX * 16);
    const viewMinY = config.viewMinY ?? (chunkMinCY * 16);
    const viewMaxX = config.viewMaxX ?? ((chunkMaxCX + 1) * 16 - 1);
    const viewMaxY = config.viewMaxY ?? ((chunkMaxCY + 1) * 16 - 1);

    const gridWidth = viewMaxX - viewMinX + 1;
    const gridHeight = viewMaxY - viewMinY + 1;

    // === 5. 构建多层网格数据 ===
    // 扫描 wz=0 到 wz=15，收集所有非空气方块
    // 使用 Map<`gx,gy`, Set<wz>> 记录每列有哪些高度层有方块

    /** @type {Map<string, number[]>} 每列 (gx,gy) 的方块高度层列表 */
    const columnHeights = new Map();

    for (let wx = viewMinX; wx <= viewMaxX; wx++) {
        for (let wy = viewMinY; wy <= viewMaxY; wy++) {
            /** @type {number[]} */
            const heights = [];
            for (let wz = 0; wz < 16; wz++) {
                const voxelId = world.getVoxel(wx, wy, wz);
                if (voxelId !== 0) {
                    heights.push(wz);
                }
            }
            if (heights.length > 0) {
                columnHeights.set(`${wx},${wy}`, heights);
            }
        }
    }

    // 找出所有涉及的高度层
    const allHeights = new Set();
    for (const heights of columnHeights.values()) {
        for (const h of heights) {
            allHeights.add(h);
        }
    }
    const sortedHeights = Array.from(allHeights).sort((a, b) => a - b);

    // 如果只有一层（最常见情况），使用单层 grid
    if (sortedHeights.length === 0) {
        // 空世界，跳过
        return { world, gridWidth, gridHeight };
    }

    // 构建单层 base grid（wz=0 层）
    const flatGrid = [];
    for (let wy = viewMinY; wy <= viewMaxY; wy++) {
        const row = [];
        for (let wx = viewMinX; wx <= viewMaxX; wx++) {
            const voxelId = world.getVoxel(wx, wy, 0);
            row.push(voxelIdToBlockType(voxelId));
        }
        flatGrid.push(row);
    }

    // 使用 buildFromGrid 构建基底
    await renderer.buildFromGrid(flatGrid, {
        useIsoTransform: true,
        useAssembled: false,
        interpolation: 'nearest'
    });

    // 对 wz>0 的层，使用 addBlock 逐块添加
    for (const [key, heights] of columnHeights) {
        const [wxStr, wyStr] = key.split(',');
        const wx = parseInt(wxStr, 10);
        const wy = parseInt(wyStr, 10);

        for (const wz of heights) {
            if (wz === 0) continue; // 已由 base grid 处理

            const gx = wx - viewMinX;
            const gy = wy - viewMinY;
            const voxelId = world.getVoxel(wx, wy, wz);
            const blockType = voxelIdToBlockType(voxelId);

            if (blockType) {
                await renderer.addBlock(gx, gy, wz, blockType);
            }
        }
    }

    return { world, gridWidth, gridHeight };
}
