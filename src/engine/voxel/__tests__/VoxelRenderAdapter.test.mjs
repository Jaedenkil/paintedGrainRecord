// @ts-check

/**
 * @fileoverview
 * VoxelRenderAdapter 单元测试。
 *
 * 覆盖内容：
 * - 构造与配置
 * - bind / destroy 生命周期
 * - syncViewport 全量构建（首次）
 * - syncViewport 增量 diff（后续调用）
 * - syncViewport 列移除
 * - syncViewport 列变更（blockType 变化）
 * - updateDirtyChunks 脏标记追迹
 * - worldToGrid 坐标转换
 * - getColumnInfo 快照查询
 * - getStats 统计
 * - 空世界 / 无 Chunk 的边缘情形
 *
 * @module voxel/__tests__/VoxelRenderAdapter.test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ==================== Mock BlockGridManager ====================

/**
 * BlockGridManager 的测试替身。
 *
 * 记录所有 addBlock / removeBlock 调用，不依赖 PixiJS 或 LayerStack。
 */
class MockGridManager {
    constructor() {
        /** @type {Array<{ op: string, wx: number, wy: number, wz: number, blockType?: string }>} */
        this.calls = [];

        /** @type {Map<string, string>} 当前模拟的 "wx,wy,wz → blockType" 状态 */
        this.blocks = new Map();
    }

    /**
     * 模拟 addBlock。
     * @param {number} wx
     * @param {number} wy
     * @param {number} wz
     * @param {string} blockType
     * @returns {Promise<null>}
     */
    async addBlock(wx, wy, wz, blockType) {
        const key = `${wx},${wy},${wz}`;
        this.calls.push({ op: 'add', wx, wy, wz, blockType });
        this.blocks.set(key, blockType);
        return null;
    }

    /**
     * 模拟 removeBlock。
     * @param {number} wx
     * @param {number} wy
     * @param {number} wz
     */
    removeBlock(wx, wy, wz) {
        const key = `${wx},${wy},${wz}`;
        this.calls.push({ op: 'remove', wx, wy, wz });
        this.blocks.delete(key);
    }

    /**
     * 模拟 preloadTextures（P2.2 新增）。
     * 记录调用但不执行实际纹理加载。
     * @param {string[]} blockTypes - 方块类型数组
     * @param {Object} [options] - 预加载选项（测试中忽略）
     * @returns {Promise<this>}
     */
    async preloadTextures(blockTypes, options = {}) {
        this.calls.push({ op: 'preload', blockTypes: [...blockTypes] });
        return this;
    }

    /** 清空调用记录和状态 */
    reset() {
        this.calls = [];
        this.blocks.clear();
    }
}

// ==================== 工具函数 ====================

/**
 * 在 VoxelWorld 的指定位置放置一个方块。
 * @param {import('../VoxelWorld.mjs').VoxelWorld} world
 * @param {number} wx
 * @param {number} wy
 * @param {number} wz
 * @param {number} voxelId
 */
function placeVoxel(world, wx, wy, wz, voxelId) {
    world.setVoxel(wx, wy, wz, voxelId);
}

// ==================== 测试套件 ====================

describe('VoxelRenderAdapter', () => {
    let VoxelWorld, VoxelRenderAdapter, Chunk;

    before(async () => {
        const worldMod = await import('../VoxelWorld.mjs');
        VoxelWorld = worldMod.VoxelWorld;
        const adapterMod = await import('../VoxelRenderAdapter.mjs');
        VoxelRenderAdapter = adapterMod.VoxelRenderAdapter;
        const chunkMod = await import('../Chunk.mjs');
        Chunk = chunkMod.Chunk;
    });

    // ==================== 构造 ====================

    describe('构造', () => {
        it('默认构造不应抛出', () => {
            const adapter = new VoxelRenderAdapter();
            assert.ok(adapter);
        });

        it('应接受自定义 voxelIdMap', () => {
            const customMap = { 1: 'stone', 2: 'brick' };
            const adapter = new VoxelRenderAdapter({ voxelIdMap: customMap });
            assert.ok(adapter);
        });

        it('应接受自定义 maxHeight', () => {
            const adapter = new VoxelRenderAdapter({ maxHeight: 8 });
            assert.ok(adapter);
        });

        it('构造后快照应为空', () => {
            const adapter = new VoxelRenderAdapter();
            assert.strictEqual(adapter.getStats().columns, 0);
            assert.strictEqual(adapter.getStats().blocks, 0);
        });
    });

    // ==================== bind / destroy ====================

    describe('bind / destroy', () => {
        it('bind 应返回 this（链式调用）', () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            const result = adapter.bind(world, grid);
            assert.strictEqual(result, adapter);
        });

        it('bind 后 getStats 仍为 0（快照未初始化）', () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);
            assert.strictEqual(adapter.getStats().columns, 0);
        });

        it('destroy 不抛出', () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);
            adapter.destroy();
            // destroy 后再次调用不应抛出
            adapter.destroy();
        });

        it('destroy 后 getStats 返回 0', () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);
            adapter.destroy();
            assert.strictEqual(adapter.getStats().columns, 0);
        });
    });

    // ==================== syncViewport — 首次全量构建 ====================

    describe('syncViewport — 首次全量构建', () => {
        it('空世界不应报错', async () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            assert.strictEqual(grid.calls.length, 0);
            assert.strictEqual(adapter.getStats().columns, 0);
        });

        it('中心 Chunk 有方块时应正确构建', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1); // grass
            placeVoxel(world, 1, 1, 0, 3); // stone
            placeVoxel(world, 1, 1, 1, 2); // dirt (stone 上方)

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            // 应该放置了 3 个方块
            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.strictEqual(addCalls.length, 3);

            // 验证快照
            const col00 = adapter.getColumnInfo(0, 0);
            assert.ok(col00);
            assert.strictEqual(col00.length, 1);
            assert.strictEqual(col00[0].blockType, 'grass');

            const col11 = adapter.getColumnInfo(1, 1);
            assert.ok(col11);
            assert.strictEqual(col11.length, 2);
            assert.strictEqual(col11[0].blockType, 'stone');
            assert.strictEqual(col11[1].blockType, 'dirt');

            assert.strictEqual(adapter.getStats().columns, 2);
            assert.strictEqual(adapter.getStats().blocks, 3);
        });

        it('多 Chunk 范围应正确构建', async () => {
            const world = new VoxelWorld();
            // Chunk (0,0) 中的方块
            placeVoxel(world, 0, 0, 0, 1);
            // Chunk (1,0) 中的方块
            placeVoxel(world, 20, 5, 0, 3);
            // Chunk (0,1) 中的方块
            placeVoxel(world, 3, 20, 0, 2);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 1); // 3×3 Chunk 范围

            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.strictEqual(addCalls.length, 3);
            assert.strictEqual(adapter.getStats().columns, 3);
        });

        it('超出 maxHeight 的体素应被忽略', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);  // grass
            placeVoxel(world, 0, 0, 5, 2);  // dirt (wz=5)

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter({ maxHeight: 3 });
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            // 只有 wz=0 的 grass 被渲染，wz=5 被 maxHeight=3 截断
            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.strictEqual(addCalls.length, 1);
            assert.strictEqual(addCalls[0].blockType, 'grass');
        });

        it('自定义 voxelIdMap 应覆盖默认映射', async () => {
            const customMap = { 1: 'custom_stone' };
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter({ voxelIdMap: customMap });
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.strictEqual(addCalls.length, 1);
            assert.strictEqual(addCalls[0].blockType, 'custom_stone');
        });
    });

    // ==================== syncViewport — 增量 diff ====================

    describe('syncViewport — 增量 diff', () => {
        it('相同数据重复调用不应产生额外 add/remove 操作', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);
            placeVoxel(world, 1, 0, 0, 2);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            // 首次调用
            await adapter.syncViewport(0, 0, 0);
            const firstAddRemoveCount = grid.calls.filter(c => c.op !== 'preload').length;

            // 再次调用（数据未变）
            await adapter.syncViewport(0, 0, 0);

            // 不应有新的 add/remove 操作（preload 每次都会调用，不计入）
            const secondAddRemoveCount = grid.calls.filter(c => c.op !== 'preload').length;
            assert.strictEqual(secondAddRemoveCount, firstAddRemoveCount);
        });

        it('新增列应正确添加', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            // 添加新方块
            placeVoxel(world, 5, 5, 0, 3);

            // 第二次 syncViewport
            grid.reset();
            await adapter.syncViewport(0, 0, 1); // 扩大视口范围

            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.ok(addCalls.length > 0);
            // 应该包含 (5,5,0) → stone
            const stoneCall = addCalls.find(c => c.wx === 5 && c.wy === 5);
            assert.ok(stoneCall);
            assert.strictEqual(stoneCall.blockType, 'stone');
        });

        it('移除的列应被清理', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);
            placeVoxel(world, 1, 1, 0, 3);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);
            assert.strictEqual(adapter.getStats().columns, 2);

            // 缩小视口（只保留 (0,0) Chunk 的部分）
            // 把 (1,1) 处的 stone 移除
            world.setVoxel(1, 1, 0, 0); // 空气

            grid.reset();
            await adapter.syncViewport(0, 0, 0);

            // (1,1,0) stone 应被移除
            const removeCalls = grid.calls.filter(c => c.op === 'remove');
            assert.ok(removeCalls.length > 0);
            const removedStone = removeCalls.find(c => c.wx === 1 && c.wy === 1 && c.wz === 0);
            assert.ok(removedStone);

            assert.strictEqual(adapter.getStats().columns, 1);
        });

        it('列中 blockType 变化应触发重建', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1); // grass

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            // 将 (0,0,0) 改为 stone
            world.setVoxel(0, 0, 0, 3);

            grid.reset();
            await adapter.syncViewport(0, 0, 0);

            // 应该先 remove 再 add
            const removeCalls = grid.calls.filter(c => c.op === 'remove');
            const addCalls = grid.calls.filter(c => c.op === 'add');

            assert.strictEqual(removeCalls.length, 1);
            assert.strictEqual(removeCalls[0].wx, 0);
            assert.strictEqual(removeCalls[0].wy, 0);

            assert.strictEqual(addCalls.length, 1);
            assert.strictEqual(addCalls[0].blockType, 'stone');
        });
    });

    // ==================== updateDirtyChunks ====================

    describe('updateDirtyChunks', () => {
        it('无脏 Chunk 不应产生操作', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            grid.reset();
            await adapter.updateDirtyChunks();

            assert.strictEqual(grid.calls.length, 0);
        });

        it('修改后应检测并更新脏列', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);
            placeVoxel(world, 1, 1, 0, 3);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);
            assert.strictEqual(adapter.getStats().columns, 2);

            // 修改一个方块（这会设置 Chunk 的脏标记）
            world.setVoxel(1, 1, 0, 2); // stone → dirt

            grid.reset();
            await adapter.updateDirtyChunks();

            // (1,1,0) 应该被重建
            const removeCalls = grid.calls.filter(c => c.op === 'remove');
            const addCalls = grid.calls.filter(c => c.op === 'add');

            assert.strictEqual(removeCalls.length, 1);
            assert.strictEqual(addCalls.length, 1);
            assert.strictEqual(addCalls[0].blockType, 'dirt');
        });

        it('新增方块应被 updateDirtyChunks 检测', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);
            assert.strictEqual(adapter.getStats().columns, 1);

            // 在已存在的 Chunk 中新增一个方块
            placeVoxel(world, 0, 1, 0, 3);

            grid.reset();
            await adapter.updateDirtyChunks();

            const addCalls = grid.calls.filter(c => c.op === 'add');
            const newStone = addCalls.find(c => c.wx === 0 && c.wy === 1);
            assert.ok(newStone);
            assert.strictEqual(newStone.blockType, 'stone');
        });

        it('未初始化的 adapter 应静默忽略 updateDirtyChunks', async () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            // 未调用 syncViewport 直接调用 updateDirtyChunks
            await adapter.updateDirtyChunks();

            assert.strictEqual(grid.calls.length, 0);
        });
    });

    // ==================== worldToGrid ====================

    describe('worldToGrid', () => {
        it('应返回 1:1 映射', () => {
            const adapter = new VoxelRenderAdapter();
            const result = adapter.worldToGrid(5, 3);
            assert.strictEqual(result.gx, 5);
            assert.strictEqual(result.gy, 3);
        });

        it('应处理负坐标', () => {
            const adapter = new VoxelRenderAdapter();
            const result = adapter.worldToGrid(-5, -3);
            assert.strictEqual(result.gx, -5);
            assert.strictEqual(result.gy, -3);
        });
    });

    // ==================== getColumnInfo ====================

    describe('getColumnInfo', () => {
        it('空世界应返回 null', () => {
            const world = new VoxelWorld();
            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);
            assert.strictEqual(adapter.getColumnInfo(0, 0), null);
        });

        it('存在方块的列应返回正确信息', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 3, 3, 0, 1);
            placeVoxel(world, 3, 3, 1, 2);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 1);

            const info = adapter.getColumnInfo(3, 3);
            assert.ok(info);
            assert.strictEqual(info.length, 2);
            assert.strictEqual(info[0].blockType, 'grass');
            assert.strictEqual(info[1].blockType, 'dirt');
        });
    });

    // ==================== getStats ====================

    describe('getStats', () => {
        it('空世界统计应为 0', () => {
            const adapter = new VoxelRenderAdapter();
            const stats = adapter.getStats();
            assert.strictEqual(stats.columns, 0);
            assert.strictEqual(stats.blocks, 0);
        });

        it('统计应与渲染快照一致', async () => {
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);
            placeVoxel(world, 0, 0, 1, 2);
            placeVoxel(world, 5, 5, 0, 3);

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 1);

            const stats = adapter.getStats();
            assert.strictEqual(stats.columns, 2);
            assert.strictEqual(stats.blocks, 3);
        });
    });

    // ==================== 边缘情形 ====================

    describe('边缘情形', () => {
        it('未 bind 时 syncViewport 应静默返回', async () => {
            const adapter = new VoxelRenderAdapter();
            await adapter.syncViewport(0, 0, 0);
            // 不应抛出
        });

        it('未 bind 时 updateDirtyChunks 应静默返回', async () => {
            const adapter = new VoxelRenderAdapter();
            await adapter.updateDirtyChunks();
            // 不应抛出
        });

        it('voxelId=0 应始终被忽略', async () => {
            const world = new VoxelWorld();
            // 手动创建 Chunk 并填充数据
            const chunk = world.getOrCreateChunk(0, 0);
            // voxelId=0 是默认值，已经是空气
            // 放置一个 voxelId=0 不应该产生渲染
            world.setVoxel(0, 0, 0, 0); // 全空气

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter();
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            assert.strictEqual(grid.calls.length, 0);
            assert.strictEqual(adapter.getStats().columns, 0);
        });

        it('未在 voxelIdMap 中的 ID 应被忽略', async () => {
            const customMap = { 1: 'grass' };
            const world = new VoxelWorld();
            placeVoxel(world, 0, 0, 0, 1);  // grass
            placeVoxel(world, 1, 0, 0, 99); // 不在映射表中

            const grid = new MockGridManager();
            const adapter = new VoxelRenderAdapter({ voxelIdMap: customMap });
            adapter.bind(world, grid);

            await adapter.syncViewport(0, 0, 0);

            // 只有 grass 被渲染，ID=99 被忽略
            const addCalls = grid.calls.filter(c => c.op === 'add');
            assert.strictEqual(addCalls.length, 1);
            assert.strictEqual(addCalls[0].blockType, 'grass');
        });
    });
});
