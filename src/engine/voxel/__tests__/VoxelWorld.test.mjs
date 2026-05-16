// @ts-check

/**
 * @fileoverview
 * VoxelWorld 单元测试。
 *
 * 覆盖内容：
 * - 构造与初始化
 * - Chunk 管理（getOrCreate / get / has / remove）
 * - 世界坐标体素读写
 * - 跨 Chunk 边界读写
 * - 视口遍历
 * - forEachVoxelInChunk
 * - 序列化/反序列化
 * - 统计和清理
 *
 * @module voxel/__tests__/VoxelWorld.test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('VoxelWorld', () => {
    let VoxelWorld, Chunk;

    before(async () => {
        const worldMod = await import('../VoxelWorld.mjs');
        VoxelWorld = worldMod.VoxelWorld;
        const chunkMod = await import('../Chunk.mjs');
        Chunk = chunkMod.Chunk;
    });

    // ==================== 构造 ====================

    it('构造后应无加载的 Chunk', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.loadedChunkCount, 0);
        assert.strictEqual(world.totalVoxelCount, 0);
    });

    it('构造应接受 seed 参数', () => {
        const world = new VoxelWorld(12345);
        assert.strictEqual(world.seed, 12345);
    });

    // ==================== Chunk 管理 ====================

    it('getOrCreateChunk 应创建新 Chunk', () => {
        const world = new VoxelWorld();
        const chunk = world.getOrCreateChunk(0, 0);
        assert.ok(chunk instanceof Chunk);
        assert.strictEqual(world.loadedChunkCount, 1);
    });

    it('getOrCreateChunk 对相同坐标应返回同一 Chunk', () => {
        const world = new VoxelWorld();
        const c1 = world.getOrCreateChunk(2, 3);
        const c2 = world.getOrCreateChunk(2, 3);
        assert.strictEqual(c1, c2);
        assert.strictEqual(world.loadedChunkCount, 1);
    });

    it('getChunk 对不存在的坐标应返回 null', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.getChunk(0, 0), null);
    });

    it('getChunk 对存在的坐标应返回 Chunk', () => {
        const world = new VoxelWorld();
        world.getOrCreateChunk(1, -1);
        const chunk = world.getChunk(1, -1);
        assert.ok(chunk instanceof Chunk);
    });

    it('hasChunk 应正确判断存在性', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.hasChunk(0, 0), false);
        world.getOrCreateChunk(0, 0);
        assert.strictEqual(world.hasChunk(0, 0), true);
        assert.strictEqual(world.hasChunk(1, 0), false);
    });

    it('removeChunk 应移除并返回 Chunk', () => {
        const world = new VoxelWorld();
        const chunk = world.getOrCreateChunk(5, 5);
        const removed = world.removeChunk(5, 5);
        assert.strictEqual(removed, chunk);
        assert.strictEqual(world.hasChunk(5, 5), false);
        assert.strictEqual(world.loadedChunkCount, 0);
    });

    it('removeChunk 不存在的坐标应返回 null', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.removeChunk(999, 999), null);
    });

    it('应支持负数 Chunk 坐标的创建与查询', () => {
        const world = new VoxelWorld();
        world.getOrCreateChunk(-1, -2);
        assert.ok(world.hasChunk(-1, -2));
        const chunk = world.getChunk(-1, -2);
        assert.ok(chunk instanceof Chunk);
        const coord = chunk.getChunkCoord();
        assert.strictEqual(coord.cx, -1);
        assert.strictEqual(coord.cy, -2);
    });

    // ==================== 体素读写（世界坐标） ====================

    it('getVoxel 对未创建的位置应返回 0', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.getVoxel(0, 0, 0), 0);
    });

    it('setVoxel 后 getVoxel 应返回相同的值', () => {
        const world = new VoxelWorld();
        world.setVoxel(5, 5, 0, 1);
        assert.strictEqual(world.getVoxel(5, 5, 0), 1);
    });

    it('setVoxel 应自动创建不存在的 Chunk', () => {
        const world = new VoxelWorld();
        world.setVoxel(18, 32, 3, 7);
        // (18, 32) → cx=1, cy=2
        assert.strictEqual(world.loadedChunkCount, 1);
        assert.strictEqual(world.getVoxel(18, 32, 3), 7);
    });

    it('getVoxel wz 越界应返回 0', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);
        assert.strictEqual(world.getVoxel(0, 0, -1), 0);
        assert.strictEqual(world.getVoxel(0, 0, 16), 0);
        assert.strictEqual(world.getVoxel(0, 0, 999), 0);
    });

    it('setVoxel wz 越界应返回 false', () => {
        const world = new VoxelWorld();
        assert.strictEqual(world.setVoxel(0, 0, -1, 1), false);
        assert.strictEqual(world.setVoxel(0, 0, 16, 1), false);
        assert.strictEqual(world.loadedChunkCount, 0);
    });

    // ==================== 跨 Chunk 边界 ====================

    it('应正确跨越 Chunk 边界读写', () => {
        const world = new VoxelWorld();
        // 位置 (15, 15, 0) 在 Chunk(0, 0) 内，lx=15, ly=15
        world.setVoxel(15, 15, 0, 1);
        // 位置 (16, 16, 0) 在 Chunk(1, 1) 内，lx=0, ly=0
        world.setVoxel(16, 16, 0, 2);

        assert.strictEqual(world.getVoxel(15, 15, 0), 1);
        assert.strictEqual(world.getVoxel(16, 16, 0), 2);
        assert.strictEqual(world.loadedChunkCount, 2);
    });

    it('应正确处理负数世界坐标', () => {
        const world = new VoxelWorld();
        // wx=-1, wy=-1 → cx=-1, cy=-1, lx=15, ly=15
        world.setVoxel(-1, -1, 5, 42);
        assert.strictEqual(world.getVoxel(-1, -1, 5), 42);

        // 周围位置应不受影响
        assert.strictEqual(world.getVoxel(0, 0, 5), 0);
        assert.strictEqual(world.getVoxel(-1, 0, 5), 0);
        assert.strictEqual(world.getVoxel(0, -1, 5), 0);
    });

    // ==================== 视口遍历 ====================

    it('forEachChunkInView 空世界不应调用回调', () => {
        const world = new VoxelWorld();
        let callCount = 0;
        world.forEachChunkInView(0, 0, 3, () => { callCount++; });
        assert.strictEqual(callCount, 0);
    });

    it('forEachChunkInView radius=0 只遍历中心 Chunk', () => {
        const world = new VoxelWorld();
        world.getOrCreateChunk(0, 0);
        world.getOrCreateChunk(1, 0);

        const visited = [];
        world.forEachChunkInView(0, 0, 0, (chunk) => {
            visited.push(chunk.getChunkCoord());
        });
        assert.strictEqual(visited.length, 1);
        assert.strictEqual(visited[0].cx, 0);
        assert.strictEqual(visited[0].cy, 0);
    });

    it('forEachChunkInView radius=1 应遍历 9 个 Chunk（含不存在的）', () => {
        // 但只有已创建的会被遍历到
        const world = new VoxelWorld();
        world.getOrCreateChunk(0, 0);
        world.getOrCreateChunk(1, 0);
        world.getOrCreateChunk(0, 1);
        world.getOrCreateChunk(1, 1);

        const visited = [];
        world.forEachChunkInView(0, 0, 1, (chunk) => {
            visited.push(chunk.getChunkCoord());
        });

        // 半径 1 覆盖 3×3=9 个 Chunk，但只创建了 4 个
        assert.strictEqual(visited.length, 4);
    });

    // ==================== forEachVoxelInChunk ====================

    it('forEachVoxelInChunk 空 Chunk 应返回 0', () => {
        const world = new VoxelWorld();
        world.getOrCreateChunk(0, 0);
        const count = world.forEachVoxelInChunk(0, 0, () => {});
        assert.strictEqual(count, 0);
    });

    it('forEachVoxelInChunk 应遍历所有非空体素', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);
        world.setVoxel(1, 2, 3, 2);
        world.setVoxel(15, 15, 15, 3);

        const results = [];
        const count = world.forEachVoxelInChunk(0, 0, (wx, wy, wz, id) => {
            results.push({ wx, wy, wz, id });
        });

        assert.strictEqual(count, 3);
        assert.strictEqual(results.length, 3);
    });

    it('forEachVoxelInChunk 不存在的 Chunk 应返回 0', () => {
        const world = new VoxelWorld();
        const count = world.forEachVoxelInChunk(999, 999, () => {});
        assert.strictEqual(count, 0);
    });

    // ==================== 序列化/反序列化 ====================

    it('serialize 空世界应返回有效 ArrayBuffer', () => {
        const world = new VoxelWorld();
        const buffer = world.serialize();
        assert.ok(buffer instanceof ArrayBuffer);
        assert.ok(buffer.byteLength > 0);
    });

    it('serialize 后 deserialize 应恢复世界', () => {
        const world = new VoxelWorld(42);
        // 创建 3 个不同的 Chunk：Chunk(0,0), Chunk(1,0), Chunk(-1,-1)
        world.setVoxel(3, 4, 0, 10);   // Chunk(0,0)
        world.setVoxel(18, 4, 2, 20);  // Chunk(1,0) — wx=18 → cx=1
        world.setVoxel(-5, -5, 5, 30); // Chunk(-1,-1)

        const buffer = world.serialize();
        const newWorld = new VoxelWorld();
        const success = newWorld.deserialize(buffer);

        assert.strictEqual(success, true);
        assert.strictEqual(newWorld.seed, 42);
        assert.strictEqual(newWorld.getVoxel(3, 4, 0), 10);
        assert.strictEqual(newWorld.getVoxel(18, 4, 2), 20);
        assert.strictEqual(newWorld.getVoxel(-5, -5, 5), 30);
        assert.strictEqual(newWorld.loadedChunkCount, 3);
    });

    it('deserialize 后的 Chunk 不应标记为脏', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);

        const buffer = world.serialize();
        const newWorld = new VoxelWorld();
        newWorld.deserialize(buffer);

        // 验证所有 Chunk 的脏标记为 false
        for (let cx = -2; cx <= 2; cx++) {
            for (let cy = -2; cy <= 2; cy++) {
                const chunk = newWorld.getChunk(cx, cy);
                if (chunk) {
                    assert.strictEqual(chunk.isDirty(), false,
                        `Chunk(${cx},${cy}) 的脏标记应重置`);
                }
            }
        }
    });

    it('deserialize 无效数据应返回 false', () => {
        const world = new VoxelWorld();
        const badBuffer = new ArrayBuffer(4);
        const result = world.deserialize(badBuffer);
        assert.strictEqual(result, false);
    });

    // ==================== 统计与清理 ====================

    it('loadedChunkCount 应正确计数', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);
        world.setVoxel(16, 0, 0, 1); // Chunk(1, 0)
        world.setVoxel(0, 16, 0, 1); // Chunk(0, 1)
        assert.strictEqual(world.loadedChunkCount, 3);
    });

    it('totalVoxelCount 应正确统计', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);
        world.setVoxel(0, 0, 1, 2);
        world.setVoxel(16, 0, 0, 3); // 另一个 Chunk
        assert.strictEqual(world.totalVoxelCount, 3);
    });

    it('clear 应移除所有 Chunk', () => {
        const world = new VoxelWorld();
        world.setVoxel(0, 0, 0, 1);
        world.setVoxel(16, 0, 0, 1);
        assert.strictEqual(world.loadedChunkCount, 2);

        world.clear();
        assert.strictEqual(world.loadedChunkCount, 0);
        assert.strictEqual(world.totalVoxelCount, 0);
    });
});
