// @ts-check

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { VoxelWorld } from '../VoxelWorld.mjs';
import { SimpleWorldGenerator } from '../SimpleWorldGenerator.mjs';
import { CHUNK_SIZE } from '../ChunkCoordUtils.mjs';

describe('SimpleWorldGenerator', () => {
    describe('generateFlat', () => {
        it('应在默认范围内生成平坦世界', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 4, 1);

            // 默认半径 3 → 7×7 Chunk = 112×112 世界范围
            // 在中心区域检查 (0, 0, 0)
            assert.strictEqual(world.getVoxel(0, 0, 0), 1, '原点地面应为 blockId=1');
            assert.strictEqual(world.getVoxel(0, 0, 3), 1, 'wz=3 应为地面');
            assert.strictEqual(world.getVoxel(0, 0, 4), 0, 'wz=4 应为空气（超出高度）');
        });

        it('应生成指定厚度的地面', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 8, 2, { cx: 0, cy: 0, radius: 1 });

            // 验证厚度
            for (let wz = 0; wz < 8; wz++) {
                assert.strictEqual(world.getVoxel(5, 5, wz), 2, `wz=${wz} 应为 blockId=2`);
            }
            assert.strictEqual(world.getVoxel(5, 5, 8), 0, 'wz=8 应为空气');
        });

        it('应接受自定义 blockId', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 1, 42, { cx: 0, cy: 0, radius: 0 });

            assert.strictEqual(world.getVoxel(0, 0, 0), 42, '应使用自定义 blockId=42');
        });

        it('应只填充指定范围内的 Chunk', () => {
            const world = new VoxelWorld();
            // 只生成一个 Chunk (cx=0, cy=0)
            SimpleWorldGenerator.generateFlat(world, 3, 1, { cx: 0, cy: 0, radius: 0 });

            // Chunk(0,0) 内的坐标应有地面
            assert.strictEqual(world.getVoxel(0, 0, 0), 1, 'Chunk(0,0) 内应有地面');
            assert.strictEqual(world.getVoxel(15, 15, 0), 1, 'Chunk(0,0) 角落应有地面');

            // Chunk(1,0) 内的坐标应为空气
            assert.strictEqual(world.getVoxel(16, 0, 0), 0, 'Chunk(1,0) 应为空气');
            assert.strictEqual(world.getVoxel(-1, 0, 0), 0, 'Chunk(-1,0) 应为空气');
        });

        it('应钳制高度到 [1, CHUNK_SIZE]', () => {
            const world = new VoxelWorld();
            // 传入超过 CHUNK_SIZE 的高度
            SimpleWorldGenerator.generateFlat(world, 999, 1, { cx: 0, cy: 0, radius: 0 });

            assert.strictEqual(world.getVoxel(0, 0, CHUNK_SIZE - 1), 1, '最高层应为地面');
            assert.strictEqual(world.getVoxel(0, 0, CHUNK_SIZE), 0, '超出 Chunk 高度应为空气');
        });

        it('高度最小为 1', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 0, 1, { cx: 0, cy: 0, radius: 0 });

            assert.strictEqual(world.getVoxel(0, 0, 0), 1, '高度=0 时默认至少 1 层');
        });

        it('应处理负数世界坐标', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 2, 1, { cx: -1, cy: -1, radius: 0 });

            // Chunk(-1,-1) 范围内应有地面
            assert.strictEqual(world.getVoxel(-1, -1, 0), 1, '负数坐标应有地面');
            assert.strictEqual(world.getVoxel(-16, -16, 0), 1, 'Chunk(-1,-1) 原点应有地面');
        });

        it('应拒绝非法 world 参数', () => {
            assert.throws(() => {
                SimpleWorldGenerator.generateFlat(null, 4, 1);
            }, TypeError);
        });

        it('应统计加载的 Chunk 数量正确', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateFlat(world, 1, 1, { cx: 0, cy: 0, radius: 2 });

            // radius=2 → 5×5 = 25 Chunk
            assert.strictEqual(world.loadedChunkCount, 25, '应创建 25 个 Chunk');
        });
    });

    describe('generateTestTower', () => {
        it('应在指定 Chunk 中心生成 3×3 塔', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, 0, 0, 8);

            const centerX = Math.floor(CHUNK_SIZE / 2); // 8
            const centerY = Math.floor(CHUNK_SIZE / 2); // 8

            // 塔身 3×3 范围内应有方块
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    assert.strictEqual(
                        world.getVoxel(centerX + dx, centerY + dy, 0),
                        1,
                        `塔基 (${centerX + dx}, ${centerY + dy}, 0) 应为 blockId=1`
                    );
                }
            }
        });

        it('塔周围的方块应为空气', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, 0, 0, 8);

            const centerX = Math.floor(CHUNK_SIZE / 2);
            const centerY = Math.floor(CHUNK_SIZE / 2);

            // 塔外一圈应为空气
            assert.strictEqual(world.getVoxel(centerX + 2, centerY, 0), 0, '塔右侧应为空气');
            assert.strictEqual(world.getVoxel(centerX, centerY + 2, 0), 0, '塔上方应为空气');
            assert.strictEqual(world.getVoxel(centerX - 2, centerY, 0), 0, '塔左侧应为空气');
        });

        it('塔高度应为指定值', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, 0, 0, 5);

            const centerX = Math.floor(CHUNK_SIZE / 2);
            const centerY = Math.floor(CHUNK_SIZE / 2);

            for (let wz = 0; wz < 5; wz++) {
                assert.strictEqual(world.getVoxel(centerX, centerY, wz), 1, `wz=${wz} 应为塔身`);
            }
            assert.strictEqual(world.getVoxel(centerX, centerY, 5), 0, 'wz=5 应为空气');
        });

        it('应支持自定义 blockId', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, 0, 0, 3, 7);

            const centerX = Math.floor(CHUNK_SIZE / 2);
            assert.strictEqual(world.getVoxel(centerX, centerX, 0), 7, '应使用自定义 blockId=7');
        });

        it('应钳制高度', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, 0, 0, 999);

            const centerX = Math.floor(CHUNK_SIZE / 2);
            assert.strictEqual(world.getVoxel(centerX, centerX, CHUNK_SIZE - 1), 1, '最高层应有方块');
            assert.strictEqual(world.getVoxel(centerX, centerX, CHUNK_SIZE), 0, '超出 Chunk 应为空气');
        });

        it('应支持负数 Chunk 坐标', () => {
            const world = new VoxelWorld();
            SimpleWorldGenerator.generateTestTower(world, -3, -2, 3);

            const centerX = -3 * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);
            const centerY = -2 * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);

            assert.strictEqual(world.getVoxel(centerX, centerY, 0), 1, '负数 Chunk 塔基应有方块');
        });

        it('应拒绝非法 world 参数', () => {
            assert.throws(() => {
                SimpleWorldGenerator.generateTestTower(null, 0, 0, 5);
            }, TypeError);
        });
    });

    describe('generatePerlin（存根）', () => {
        it('应调用但不修改世界', () => {
            const world = new VoxelWorld();
            // 设置一个标记方块
            world.setVoxel(0, 0, 0, 1);

            SimpleWorldGenerator.generatePerlin(world, 42, { heightScale: 10 });

            // 世界不应被修改
            assert.strictEqual(world.loadedChunkCount, 1, 'Chunk 数量不应变化');
            assert.strictEqual(world.getVoxel(0, 0, 0), 1, '方块数据不应变化');
        });

        it('应接受不同参数而不报错', () => {
            const world = new VoxelWorld();

            // 各种参数组合都不应抛出异常
            SimpleWorldGenerator.generatePerlin(world, 0);
            SimpleWorldGenerator.generatePerlin(world, 12345);
            SimpleWorldGenerator.generatePerlin(world, 999, {});
            SimpleWorldGenerator.generatePerlin(world, 42, { heightScale: 16, frequency: 0.1 });
        });
    });
});
