// @ts-check

/**
 * @fileoverview
 * Chunk 单元测试。
 *
 * 覆盖内容：
 * - 构造与初始化
 * - getVoxel / setVoxel 基本读写
 * - 边界保护（越界坐标）
 * - fill 批量填充
 * - getTopHeight 顶层高度查询
 * - 脏标记生命周期
 * - toFlatArray 返回副本
 * - getVoxelCount 统计
 * - 预填充数据构造函数
 *
 * @module voxel/__tests__/Chunk.test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

describe('Chunk', () => {
    let Chunk, CHUNK_SIZE, CHUNK_VOLUME;

    before(async () => {
        const mod = await import('../Chunk.mjs');
        Chunk = mod.Chunk;
        CHUNK_SIZE = Chunk.CHUNK_SIZE;
        CHUNK_VOLUME = Chunk.TOTAL_VOXELS;
    });

    // ==================== 构造与初始化 ====================

    it('构造后应创建一个 16×16×16 的空 Chunk', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.getVoxel(0, 0, 0), 0);
        assert.strictEqual(chunk.getVoxel(15, 15, 15), 0);
    });

    it('构造后应标记为脏', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.isDirty(), true);
    });

    it('构造后 should 返回正确的 Chunk 坐标', () => {
        const chunk = new Chunk(3, -5);
        const coord = chunk.getChunkCoord();
        assert.strictEqual(coord.cx, 3);
        assert.strictEqual(coord.cy, -5);
    });

    it('应支持负数 Chunk 坐标', () => {
        const chunk = new Chunk(-1, -2);
        const coord = chunk.getChunkCoord();
        assert.strictEqual(coord.cx, -1);
        assert.strictEqual(coord.cy, -2);
    });

    // ==================== getVoxel / setVoxel ====================

    it('setVoxel 后 getVoxel 应返回相同的值', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(7, 7, 5, 42);
        assert.strictEqual(chunk.getVoxel(7, 7, 5), 42);
    });

    it('setVoxel 设置 0 应清除方块', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(3, 3, 3, 1);
        assert.strictEqual(chunk.getVoxel(3, 3, 3), 1);
        chunk.setVoxel(3, 3, 3, 0);
        assert.strictEqual(chunk.getVoxel(3, 3, 3), 0);
    });

    it('setVoxel 设置相同值不应触发脏标记', () => {
        const chunk = new Chunk(0, 0);
        chunk.clearDirty();
        chunk.setVoxel(0, 0, 0, 0); // 已经是 0
        assert.strictEqual(chunk.isDirty(), false);
    });

    it('setVoxel 不同值应触发脏标记', () => {
        const chunk = new Chunk(0, 0);
        chunk.clearDirty();
        assert.strictEqual(chunk.isDirty(), false);

        chunk.setVoxel(0, 0, 0, 5);
        assert.strictEqual(chunk.isDirty(), true);
    });

    it('多个不同位置应独立存储', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(0, 0, 0, 10);
        chunk.setVoxel(1, 0, 0, 20);
        chunk.setVoxel(0, 1, 0, 30);

        assert.strictEqual(chunk.getVoxel(0, 0, 0), 10);
        assert.strictEqual(chunk.getVoxel(1, 0, 0), 20);
        assert.strictEqual(chunk.getVoxel(0, 1, 0), 30);
        assert.strictEqual(chunk.getVoxel(0, 0, 1), 0); // 未设置的位置为 0
    });

    it('getVoxel 越界坐标应返回 0', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.getVoxel(-1, 0, 0), 0);
        assert.strictEqual(chunk.getVoxel(0, -1, 0), 0);
        assert.strictEqual(chunk.getVoxel(0, 0, -1), 0);
        assert.strictEqual(chunk.getVoxel(16, 0, 0), 0);
        assert.strictEqual(chunk.getVoxel(0, 16, 0), 0);
        assert.strictEqual(chunk.getVoxel(0, 0, 16), 0);
        assert.strictEqual(chunk.getVoxel(999, 999, 999), 0);
    });

    it('setVoxel 越界坐标应返回 false 且不存储', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.setVoxel(-1, 0, 0, 1), false);
        assert.strictEqual(chunk.setVoxel(0, -1, 0, 1), false);
        assert.strictEqual(chunk.setVoxel(0, 0, -1, 1), false);
        assert.strictEqual(chunk.setVoxel(16, 0, 0, 1), false);
        assert.strictEqual(chunk.setVoxel(0, 16, 0, 1), false);
        assert.strictEqual(chunk.setVoxel(0, 0, 16, 1), false);

        // 验证没有数据被写入
        assert.strictEqual(chunk.getVoxelCount(), 0);
    });

    // ==================== fill ====================

    it('fill 应填充所有体素', () => {
        const chunk = new Chunk(0, 0);
        chunk.fill(7);
        assert.strictEqual(chunk.getVoxel(0, 0, 0), 7);
        assert.strictEqual(chunk.getVoxel(15, 15, 15), 7);
        assert.strictEqual(chunk.getVoxelCount(), CHUNK_VOLUME);
    });

    it('fill(0) 应清空所有体素', () => {
        const chunk = new Chunk(0, 0);
        chunk.fill(5);
        assert.strictEqual(chunk.getVoxelCount(), CHUNK_VOLUME);
        chunk.fill(0);
        assert.strictEqual(chunk.getVoxelCount(), 0);
    });

    it('fill 后应标记为脏', () => {
        const chunk = new Chunk(0, 0);
        chunk.clearDirty();
        chunk.fill(1);
        assert.strictEqual(chunk.isDirty(), true);
    });

    // ==================== getTopHeight ====================

    it('getTopHeight 空列应返回 -1', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.getTopHeight(5, 5), -1);
    });

    it('getTopHeight 应返回最顶层非空体素的高度', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(3, 3, 2, 1);
        chunk.setVoxel(3, 3, 5, 1);
        // lz=5 和 lz=2 被填充，最顶部是 lz=5
        assert.strictEqual(chunk.getTopHeight(3, 3), 5);
    });

    it('getTopHeight 越界坐标应返回 -1', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.getTopHeight(-1, 0), -1);
        assert.strictEqual(chunk.getTopHeight(0, -1), -1);
        assert.strictEqual(chunk.getTopHeight(16, 0), -1);
    });

    it('getTopHeight 仅该列被填满时返回正确值', () => {
        const chunk = new Chunk(0, 0);
        // 在 (5,5) 处从 lz=0 到 lz=3 填充
        chunk.setVoxel(5, 5, 0, 1);
        chunk.setVoxel(5, 5, 1, 1);
        chunk.setVoxel(5, 5, 2, 1);
        chunk.setVoxel(5, 5, 3, 1);
        // 邻列（6,5）保持空
        assert.strictEqual(chunk.getTopHeight(5, 5), 3);
        assert.strictEqual(chunk.getTopHeight(6, 5), -1);
    });

    // ==================== 脏标记 ====================

    it('clearDirty 后 isDirty 应返回 false', () => {
        const chunk = new Chunk(0, 0);
        assert.strictEqual(chunk.isDirty(), true); // 初始为脏
        chunk.clearDirty();
        assert.strictEqual(chunk.isDirty(), false);
    });

    it('markDirty 应强制标记为脏', () => {
        const chunk = new Chunk(0, 0);
        chunk.clearDirty();
        assert.strictEqual(chunk.isDirty(), false);
        chunk.markDirty();
        assert.strictEqual(chunk.isDirty(), true);
    });

    // ==================== toFlatArray ====================

    it('toFlatArray 应返回正确长度的副本', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(0, 0, 0, 99);
        const flat = chunk.toFlatArray();

        assert.strictEqual(flat.length, CHUNK_VOLUME);
        assert.strictEqual(flat[0], 99);
        assert.strictEqual(flat[1], 0); // 其他位置为空
    });

    it('toFlatArray 修改不应影响原始数据', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(0, 0, 0, 42);
        const flat = chunk.toFlatArray();
        flat[0] = 999;

        assert.strictEqual(chunk.getVoxel(0, 0, 0), 42);
    });

    // ==================== getVoxelCount ====================

    it('空 Chunk 的 getVoxelCount 应为 0', () => {
        const chunk = new Chunk(0, 0);
        // 新 chunk 初始全空
        const count = chunk.getVoxelCount();
        assert.strictEqual(count, 0);
    });

    it('getVoxelCount 应正确计数', () => {
        const chunk = new Chunk(0, 0);
        chunk.setVoxel(0, 0, 0, 1);
        chunk.setVoxel(1, 1, 1, 2);
        chunk.setVoxel(2, 2, 2, 3);
        assert.strictEqual(chunk.getVoxelCount(), 3);
    });

    // ==================== 预填充数据 ====================

    it('构造时传入有效数据应正常使用', () => {
        const data = new Uint16Array(CHUNK_VOLUME);
        data[0] = 42;
        data[4095] = 99;

        const chunk = new Chunk(1, 2, data);
        assert.strictEqual(chunk.getVoxel(0, 0, 0), 42);
        assert.strictEqual(chunk.getVoxel(15, 15, 15), 99);
        assert.strictEqual(chunk.getVoxel(0, 0, 1), 0);
    });

    it('构造时传入无效长度的数据应抛出错误', () => {
        const badData = new Uint16Array(100);
        assert.throws(() => {
            new Chunk(0, 0, badData);
        }, /长度应为 4096/);
    });
});
