// @ts-check

/**
 * @fileoverview
 * VoxelRenderAdapter —— 体素世界 → 2.5D 网格渲染的标准化适配器。
 *
 * 架构定位：VoxelWorld (3D) → VoxelRenderAdapter (状态化适配器) → BlockGridManager (2.5D)。
 *
 * 核心职责：
 * 1. 视口同步：syncViewport 只处理相机可见范围的 Chunk，增量同步到 BlockGridManager
 * 2. 增量 diff：维护渲染快照，对比后只执行增删改
 * 3. 脏标记追迹：updateDirtyChunks 只处理 isDirty() === true 的 Chunk
 * 4. 坐标统一：世界坐标 (wx,wy,wz) 直接映射为网格坐标 (gx,gy,gz)
 *
 * 设计原则：世界坐标 = 网格坐标；渲染快照驻留内存（Map 形式）；无待办队列。
 *
 * @module voxel/VoxelRenderAdapter
 */

import { worldToChunk, CHUNK_SIZE } from './ChunkCoordUtils.mjs';
import { DEFAULT_VOXEL_ID_MAP, mapVoxelId } from './VoxelRenderConstants.mjs';

/**
 * 体素世界渲染适配器 —— 连接 VoxelWorld（3D）与 BlockGridManager（2.5D）。
 * @example
 * ```javascript
 * const world = new VoxelWorld(42);
 * SimpleWorldGenerator.generateFlat(world, 1, 1);
 * const renderer = new BlockRenderer(layerStack);
 * const adapter = new VoxelRenderAdapter();
 * adapter.bind(world, renderer);
 * await adapter.syncViewport(0, 0, 2);
 * ```
 */
export class VoxelRenderAdapter {
    /**
     * @param {import('./VoxelRenderConstants.mjs').AdapterOptions} [options={}]
     */
    constructor(options = {}) {
        /** @private */ this._voxelIdMap = options.voxelIdMap || { ...DEFAULT_VOXEL_ID_MAP };
        /** @private */ this._maxHeight = options.maxHeight ?? CHUNK_SIZE;
        /** @private @type {import('./VoxelWorld.mjs').VoxelWorld|null} */ this._world = null;
        /** @private @type {import('../render/block/BlockGridManager.mjs').BlockGridManager|null} */ this._grid = null;
        /**
         * 渲染快照：Map<"wx,wy", Array<{wz, blockType}>>。
         * 记录了当前屏幕上每一列的所有渲染方块层，按 wz 升序排列。
         * @private @type {Map<string, Array<import('./VoxelRenderConstants.mjs').ColumnEntry>>}
         */
        this._snapshot = new Map();
        /** @private @type {boolean} */ this._initialized = false;
    }

    // ──────── 绑定与销毁 ────────

    /**
     * 绑定体素世界与网格管理器。
     * @param {import('./VoxelWorld.mjs').VoxelWorld} world
     * @param {import('../render/block/BlockGridManager.mjs').BlockGridManager} gridManager
     * @returns {this}
     */
    bind(world, gridManager) {
        this._world = world;
        this._grid = gridManager;
        this._snapshot.clear();
        this._initialized = false;
        return this;
    }

    /** 解绑并释放适配器资源（不销毁 VoxelWorld 或 BlockGridManager）。 */
    destroy() {
        this._world = null;
        this._grid = null;
        this._snapshot.clear();
        this._initialized = false;
    }

    // ──────── 视口同步 ────────

    /**
     * 同步视口范围内的所有可见方块到渲染网格。
     *
     * 流程：计算视口内 Chunk 范围 → 遍历已加载 Chunk 的每一列 → 对比快照执行增量 diff
     * → 清理不再在视口中的列。首次调用为全量构建，后续为增量 diff。
     *
     * @param {number} centerCx - 视口中心 Chunk X
     * @param {number} centerCy - 视口中心 Chunk Y
     * @param {number} radius - 视口半径（Chunk 单位）
     * @returns {Promise<this>}
     */
    async syncViewport(centerCx, centerCy, radius) {
        const world = this._world, grid = this._grid;
        if (!world || !grid) { console.warn('[VoxelRenderAdapter] 未绑定 world 或 gridManager'); return this; }

        const minCx = centerCx - radius, maxCx = centerCx + radius;
        const minCy = centerCy - radius, maxCy = centerCy + radius;
        const minWx = minCx * CHUNK_SIZE, maxWx = (maxCx + 1) * CHUNK_SIZE - 1;
        const minWy = minCy * CHUNK_SIZE, maxWy = (maxCy + 1) * CHUNK_SIZE - 1;

        const newSnapshot = new Map();
        const allBlockTypes = new Set();

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                if (!world.hasChunk(cx, cy)) continue;
                const chunk = /** @type {import('./Chunk.mjs').Chunk} */ (world.getChunk(cx, cy));
                for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                        const wx = cx * CHUNK_SIZE + lx, wy = cy * CHUNK_SIZE + ly;
                        const entries = [];
                        for (let wz = 0; wz < this._maxHeight; wz++) {
                            const voxelId = chunk.getVoxel(lx, ly, wz);
                            const blockType = mapVoxelId(voxelId, this._voxelIdMap);
                            if (blockType !== null) { entries.push({ wz, blockType }); allBlockTypes.add(blockType); }
                        }
                        if (entries.length > 0) newSnapshot.set(`${wx},${wy}`, entries);
                    }
                }
            }
        }

        if (allBlockTypes.size > 0) await grid.preloadTextures(Array.from(allBlockTypes));

        if (!this._initialized) {
            for (const [key, entries] of newSnapshot) {
                const [wxStr, wyStr] = key.split(',');
                await this._renderColumn(grid, parseInt(wxStr, 10), parseInt(wyStr, 10), entries);
            }
            this._snapshot = newSnapshot;
            this._initialized = true;
        } else {
            const oldSnapshot = this._snapshot;
            for (const key of oldSnapshot.keys()) {
                if (!newSnapshot.has(key)) {
                    const [wxStr, wyStr] = key.split(',');
                    this._removeColumn(grid, parseInt(wxStr, 10), parseInt(wyStr, 10));
                }
            }
            for (const [key, newEntries] of newSnapshot) {
                const oldEntries = oldSnapshot.get(key) || null;
                if (!oldEntries || !this._entriesEqual(oldEntries, newEntries)) {
                    const [wxStr, wyStr] = key.split(',');
                    const wx = parseInt(wxStr, 10), wy = parseInt(wyStr, 10);
                    if (oldEntries) this._removeColumn(grid, wx, wy);
                    await this._renderColumn(grid, wx, wy, newEntries);
                }
            }
            this._snapshot = newSnapshot;
        }
        return this;
    }

    // ──────── 脏追迹 ────────

    /**
     * 增量更新所有有脏标记的 Chunk。
     *
     * 遍历快照中所有列对应的 Chunk，对 isDirty()===true 的 Chunk
     * 逐列对比快照与实际体素数据并执行增删改。
     *
     * 新增 Chunk（之前不在视口中）不会被此方法处理，应通过 syncViewport 全量同步。
     *
     * @returns {Promise<this>}
     */
    async updateDirtyChunks() {
        const world = this._world, grid = this._grid;
        if (!world || !grid) return this;
        if (!this._initialized) { console.warn('[VoxelRenderAdapter] 未初始化快照，忽略 updateDirtyChunks'); return this; }

        const chunkCoords = new Set();
        for (const key of this._snapshot.keys()) {
            const [wxStr, wyStr] = key.split(',');
            const { cx, cy } = worldToChunk(parseInt(wxStr, 10), parseInt(wyStr, 10));
            chunkCoords.add(`${cx},${cy}`);
        }

        const dirtyChunks = [];
        for (const key of chunkCoords) {
            const [cxStr, cyStr] = key.split(',');
            const chunk = world.getChunk(parseInt(cxStr, 10), parseInt(cyStr, 10));
            if (chunk && chunk.isDirty()) dirtyChunks.push(chunk);
        }
        if (dirtyChunks.length === 0) return this;

        for (const chunk of dirtyChunks) {
            const { cx, cy } = chunk.getChunkCoord();
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                    const wx = cx * CHUNK_SIZE + lx, wy = cy * CHUNK_SIZE + ly;
                    const key = `${wx},${wy}`;
                    const actualEntries = [];
                    for (let wz = 0; wz < this._maxHeight; wz++) {
                        const voxelId = chunk.getVoxel(lx, ly, wz);
                        const blockType = mapVoxelId(voxelId, this._voxelIdMap);
                        if (blockType !== null) actualEntries.push({ wz, blockType });
                    }
                    const oldEntries = this._snapshot.get(key) || null;
                    if (actualEntries.length === 0 && oldEntries) {
                        this._removeColumn(grid, wx, wy);
                        this._snapshot.delete(key);
                    } else if (actualEntries.length > 0 && !oldEntries) {
                        await this._renderColumn(grid, wx, wy, actualEntries);
                        this._snapshot.set(key, actualEntries);
                    } else if (actualEntries.length > 0 && oldEntries && !this._entriesEqual(oldEntries, actualEntries)) {
                        this._removeColumn(grid, wx, wy);
                        await this._renderColumn(grid, wx, wy, actualEntries);
                        this._snapshot.set(key, actualEntries);
                    }
                }
            }
            chunk.clearDirty();
        }
        return this;
    }

    // ──────── 坐标转换与查询 ────────

    /**
     * 世界坐标 → 网格坐标（当前为一一对应）。
     * @param {number} wx
     * @param {number} wy
     * @returns {{ gx: number, gy: number }}
     */
    worldToGrid(wx, wy) { return { gx: wx, gy: wy }; }

    /**
     * 获取指定世界坐标处的渲染快照信息。
     * @param {number} wx
     * @param {number} wy
     * @returns {Array<import('./VoxelRenderConstants.mjs').ColumnEntry>|null}
     */
    getColumnInfo(wx, wy) { return this._snapshot.get(`${wx},${wy}`) || null; }

    /**
     * 获取当前渲染快照统计信息。
     * @returns {{ columns: number, blocks: number }}
     */
    getStats() {
        let blocks = 0;
        for (const entries of this._snapshot.values()) blocks += entries.length;
        return { columns: this._snapshot.size, blocks };
    }

    // ──────── 内部方法 ────────

    /** @private 渲染一列方块到网格管理器（从底向上逐层调用 addBlock） */
    async _renderColumn(grid, wx, wy, entries) {
        for (const { wz, blockType } of entries) await grid.addBlock(wx, wy, wz, blockType);
    }

    /** @private 从网格管理器移除一列的所有方块 */
    _removeColumn(grid, wx, wy) {
        const entries = this._snapshot.get(`${wx},${wy}`);
        if (!entries) return;
        for (let i = entries.length - 1; i >= 0; i--) grid.removeBlock(wx, wy, entries[i].wz);
    }

    /** @private 比较两列条目是否相等 */
    _entriesEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i].wz !== b[i].wz || a[i].blockType !== b[i].blockType) return false;
        }
        return true;
    }
}
