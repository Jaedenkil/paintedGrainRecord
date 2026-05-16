// @ts-check

/**
 * @fileoverview
 * VoxelRenderAdapter —— 体素世界 → 2.5D 网格渲染的标准化适配器（方案 A）。
 *
 * ## 架构定位
 *
 * ```
 * VoxelWorld (3D 体素数据)
 *     │
 *     ▼
 * VoxelRenderAdapter (状态化适配器)
 *     │  - 视口裁剪 & 增量 diff
 *     │  - 体素 ID → blockType 映射
 *     │  - 脏 Chunk 追迹
 *     ▼
 * BlockGridManager / BlockRenderer (2.5D 等轴渲染)
 * ```
 *
 * ## 核心职责
 *
 * 1. **视口同步**：`syncViewport(cx, cy, radius)` 只处理相机可见范围内的 Chunk，
 *    将其体素数据增量同步到 BlockGridManager 的渲染网格。
 * 2. **增量 diff**：维护"渲染快照"（当前屏幕上每列 `wx,wy` 的最高层方块状态），
 *    与新的体素数据比对后只执行增/删/改操作，避免全量 `clear()` + 重建。
 * 3. **脏标记追迹**：`updateDirtyChunks()` 只处理 `Chunk.isDirty() === true` 的 Chunk，
 *    适合在世界编辑（放置/破坏方块）后做局部更新。
 * 4. **坐标统一**：世界坐标 (wx, wy, wz) 直接映射为渲染网格坐标 (gx, gy, gz)，
 *    消除 VoxelDemoScene 中 `gx = wx - viewMinX` 的偏移转换。
 *
 * ## 设计原则
 *
 * - **世界坐标 = 网格坐标**：BlockGridManager 的 `addBlock(wx, wy, wz, type)` 直接使用世界坐标，
 *   消除 VoxelDemoScene 中偏移量转换层。
 * - **渲染快照驻留内存**：快照以 `Map<"wx,wy", Array<{wz, blockType}>>` 形式维护，
 *   使得 diff 操作只需对比两棵 Map，无需扫描 Chunk。
 * - **不持有纹理缓存**：纹理加载和等轴变换仍由 BlockGridManager 的 buildFromGrid/addBlock 内部管理。
 * - **无待办队列**：所有操作同步执行（addBlock/removeBlock 为 async 但由调用方 await）。
 *
 * @module voxel/VoxelRenderAdapter
 */

import { worldToChunk, worldToLocal, chunkKey, CHUNK_SIZE } from './ChunkCoordUtils.mjs';

// ==================== 类型定义 ====================

/**
 * 渲染快照中某一列的条目。
 * @typedef {Object} ColumnEntry
 * @property {number} wz - 高度层
 * @property {string} blockType - 方块类型标识
 */

/**
 * 适配器配置。
 * @typedef {Object} AdapterOptions
 * @property {Object<number, string>} [voxelIdMap] - 体素 ID → blockType 映射表。
 *     例如 `{ 1: 'grass', 2: 'dirt', 3: 'stone' }`。
 *     不在表中的 ID 被映射为 null（不渲染）。ID=0 始终为空气（不渲染）。
 * @property {number} [maxHeight=16] - 世界最大高度层数（wz 取值范围 0 ~ maxHeight-1）。
 *     超过此高度的体素在渲染时被忽略。
 */

// ==================== 默认映射表 ====================

/**
 * 默认体素 ID → blockType 映射（与 VoxelDemoScene 一致）。
 * @type {Object<number, string>}
 */
const DEFAULT_VOXEL_ID_MAP = {
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
 * 将体素 ID 转换为 blockType 字符串。
 * @param {number} voxelId
 * @param {Object<number, string>} voxelIdMap
 * @returns {string|null}
 */
function mapVoxelId(voxelId, voxelIdMap) {
    if (voxelId === 0) return null;
    return voxelIdMap[voxelId] || null;
}

// ==================== 适配器 ====================

/**
 * 体素世界渲染适配器。
 *
 * 连接 VoxelWorld（3D 数据层）与 BlockGridManager（2.5D 渲染层），
 * 提供视口驱动的增量同步。
 *
 * @example
 * ```javascript
 * const world = new VoxelWorld(42);
 * SimpleWorldGenerator.generateFlat(world, 1, 1);
 *
 * const renderer = new BlockRenderer(layerStack);
 * const adapter = new VoxelRenderAdapter();
 *
 * adapter.bind(world, renderer);
 * await adapter.syncViewport(0, 0, 2); // 同步 5×5 Chunk 范围
 *
 * // 在世界编辑后增量更新：
 * world.setVoxel(5, 5, 0, 3); // 放置石头
 * await adapter.updateDirtyChunks();
 * ```
 */
export class VoxelRenderAdapter {
    /**
     * @param {AdapterOptions} [options={}]
     */
    constructor(options = {}) {
        const opts = /** @type {AdapterOptions} */ (options);

        /**
         * 体素 ID → blockType 映射表。
         * @private @type {Object<number, string>}
         */
        this._voxelIdMap = opts.voxelIdMap || { ...DEFAULT_VOXEL_ID_MAP };

        /**
         * 最大渲染高度。
         * @private @type {number}
         */
        this._maxHeight = opts.maxHeight ?? CHUNK_SIZE;

        /**
         * 绑定的体素世界实例。
         * @private @type {import('./VoxelWorld.mjs').VoxelWorld|null}
         */
        this._world = null;

        /**
         * 绑定的网格管理器实例（BlockRenderer 或 BlockGridManager）。
         * @private @type {import('../render/block/BlockGridManager.mjs').BlockGridManager|null}
         */
        this._grid = null;

        /**
         * 渲染快照：`Map<"wx,wy", Array<{wz, blockType}>>`。
         *
         * 记录了当前屏幕上每一列 (wx, wy) 的所有渲染方块层，
         * 按 wz 升序排列。每层只包含最高处的那个方块（即不存储被遮挡的方块）。
         *
         * **设计权衡**：快照 Map 常驻内存（典型视口 48×48 = 2304 条目，
         * 每个条目平均 1~3 层，总计 < 10KB），换来了 O(1) 的列级 diff。
         *
         * @private @type {Map<string, Array<ColumnEntry>>}
         */
        this._snapshot = new Map();

        /**
         * 标记：快照是否已初始化（首次 syncViewport 后为 true）。
         * @private @type {boolean}
         */
        this._initialized = false;
    }

    // ==================== 绑定与销毁 ====================

    /**
     * 绑定体素世界与网格管理器。
     *
     * 绑定后适配器即可通过 syncViewport() 和 updateDirtyChunks() 驱动渲染。
     *
     * @param {import('./VoxelWorld.mjs').VoxelWorld} world - 体素世界实例
     * @param {import('../render/block/BlockGridManager.mjs').BlockGridManager} gridManager -
     *     BlockRenderer 或 BlockGridManager 实例
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * adapter.bind(world, renderer);
     * ```
     */
    bind(world, gridManager) {
        this._world = world;
        this._grid = gridManager;
        this._snapshot.clear();
        this._initialized = false;
        return this;
    }

    /**
     * 解绑并释放适配器资源。
     *
     * 清理渲染快照。**不**销毁 VoxelWorld 或 BlockGridManager，
     * 这些实例由创建者管理。
     */
    destroy() {
        this._world = null;
        this._grid = null;
        this._snapshot.clear();
        this._initialized = false;
    }

    // ==================== 视口同步 ====================

    /**
     * 同步视口范围内的所有可见方块到渲染网格。
     *
     * ## 执行流程
     *
     * 1. 计算视口内的 Chunk 范围（以 `centerCx, centerCy` 为中心 ±radius）
     * 2. 遍历范围内所有已加载 Chunk 的每一列 (lx, ly)
     * 3. 对每列扫描 wz=0 ~ maxHeight-1，收集所有非空气体素
     * 4. 将结果与渲染快照对比，只对变化的位置执行 addBlock/removeBlock
     * 5. 清理不再在视口中的列（从渲染器和快照中同时移除）
     *
     * ## 首次调用 vs 后续调用
     *
     * - **首次**：快照为空，所有非空气列都触发 addBlock（全量构建）
     * - **后续**：Diff 模式，只处理新增/移除/变更的列
     *
     * @param {number} centerCx - 视口中心 Chunk X
     * @param {number} centerCy - 视口中心 Chunk Y
     * @param {number} radius - 视口半径（Chunk 单位，0 = 仅中心 Chunk）
     * @returns {Promise<this>} 链式调用
     *
     * @example
     * ```javascript
     * // 同步 (0,0) 周围 3×3 Chunk 范围
     * await adapter.syncViewport(0, 0, 1);
     *
     * // 首次调用：全量构建
     * // 后续调用（相机移动后）：增量 diff
     * await adapter.syncViewport(1, 0, 1);
     * ```
     */
    async syncViewport(centerCx, centerCy, radius) {
        const world = this._world;
        const grid = this._grid;
        if (!world || !grid) {
            console.warn('[VoxelRenderAdapter] 未绑定 world 或 gridManager');
            return this;
        }

        // 1. 计算视口范围（世界坐标）
        const minCx = centerCx - radius;
        const maxCx = centerCx + radius;
        const minCy = centerCy - radius;
        const maxCy = centerCy + radius;

        const minWx = minCx * CHUNK_SIZE;
        const maxWx = (maxCx + 1) * CHUNK_SIZE - 1;
        const minWy = minCy * CHUNK_SIZE;
        const maxWy = (maxCy + 1) * CHUNK_SIZE - 1;

        // 2. 构建新的视口快照，同时收集所有方块类型用于批量预加载
        /** @type {Map<string, Array<ColumnEntry>>} */
        const newSnapshot = new Map();
        /** @type {Set<string>} 视口中出现的所有不重复 blockType */
        const allBlockTypes = new Set();

        // 遍历视口内的所有 Chunk
        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                if (!world.hasChunk(cx, cy)) continue;

                const chunk = /** @type {import('./Chunk.mjs').Chunk} */ (world.getChunk(cx, cy));

                for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                        const wx = cx * CHUNK_SIZE + lx;
                        const wy = cy * CHUNK_SIZE + ly;

                        /** @type {Array<ColumnEntry>} */
                        const entries = [];

                        for (let wz = 0; wz < this._maxHeight; wz++) {
                            const voxelId = chunk.getVoxel(lx, ly, wz);
                            const blockType = mapVoxelId(voxelId, this._voxelIdMap);
                            if (blockType !== null) {
                                entries.push({ wz, blockType });
                                allBlockTypes.add(blockType);
                            }
                        }

                        if (entries.length > 0) {
                            newSnapshot.set(`${wx},${wy}`, entries);
                        }
                    }
                }
            }
        }

        // 2.5. 批量预加载纹理：使后续所有 addBlock 走快速路径
        if (allBlockTypes.size > 0) {
            await grid.preloadTextures(Array.from(allBlockTypes));
        }

        // 3. Diff 并增量更新渲染器
        if (!this._initialized) {
            // 首次：全量构建
            for (const [key, entries] of newSnapshot) {
                const [wxStr, wyStr] = key.split(',');
                const wx = parseInt(wxStr, 10);
                const wy = parseInt(wyStr, 10);
                await this._renderColumn(grid, wx, wy, entries);
            }
            this._snapshot = newSnapshot;
            this._initialized = true;
        } else {
            // 后续：增量 diff
            const oldSnapshot = this._snapshot;

            // 3a. 在旧快照但不在新快照中的列 → 移除
            for (const key of oldSnapshot.keys()) {
                if (!newSnapshot.has(key)) {
                    const [wxStr, wyStr] = key.split(',');
                    const wx = parseInt(wxStr, 10);
                    const wy = parseInt(wyStr, 10);
                    this._removeColumn(grid, wx, wy);
                }
            }

            // 3b. 在新快照中的列 → 增/改
            for (const [key, newEntries] of newSnapshot) {
                const oldEntries = oldSnapshot.get(key) || null;

                if (!oldEntries || !this._entriesEqual(oldEntries, newEntries)) {
                    const [wxStr, wyStr] = key.split(',');
                    const wx = parseInt(wxStr, 10);
                    const wy = parseInt(wyStr, 10);

                    // 移除旧方块（若有）
                    if (oldEntries) {
                        this._removeColumn(grid, wx, wy);
                    }
                    // 放置新方块
                    await this._renderColumn(grid, wx, wy, newEntries);
                }
            }

            this._snapshot = newSnapshot;
        }

        return this;
    }

    // ==================== 脏追迹 ====================

    /**
     * 增量更新所有有脏标记的 Chunk。
     *
     * 遍历 VoxelWorld 中所有已加载的 Chunk，对 `isDirty() === true` 的 Chunk：
     * 1. 对比该 Chunk 范围内当前渲染快照与实际体素数据
     * 2. 执行增删改
     * 3. 调用 `chunk.clearDirty()` 重置脏标记
     *
     * 适用于世界编辑（放置/破坏方块）后的局部更新，
     * 比全量 syncViewport 更高效。
     *
     * @returns {Promise<this>} 链式调用
     *
     * @example
     * ```javascript
     * world.setVoxel(10, 10, 0, 3); // 放置石头
     * await adapter.updateDirtyChunks(); // 只更新受影响的位置
     * ```
     */
    async updateDirtyChunks() {
        const world = this._world;
        const grid = this._grid;
        if (!world || !grid) return this;
        if (!this._initialized) {
            console.warn('[VoxelRenderAdapter] 未初始化快照，忽略 updateDirtyChunks');
            return this;
        }

        // 收集所有脏 Chunk
        /** @type {import('./Chunk.mjs').Chunk[]} */
        const dirtyChunks = [];
        // 通过 getChunk 遍历需要能获取所有已加载的 Chunk
        // VoxelWorld 没有 forEachChunk 方法，这里利用 forEachChunkInView 的一个技巧
        // 但既然不知道哪些 chunks 已加载，我们只能从快照反向推导
        // 注意：对于完全新增的 Chunk（之前不在视口中），快照中没有其列，
        // 所以它们不会被 updateDirtyChunks 处理。新增 Chunk 应通过 syncViewport 全量同步。
        // 这是设计取舍：updateDirtyChunks 只处理已有列的变化。

        // 从快照收集受影响的所有 Chunk 坐标
        const chunkCoords = new Set();
        for (const key of this._snapshot.keys()) {
            const [wxStr, wyStr] = key.split(',');
            const wx = parseInt(wxStr, 10);
            const wy = parseInt(wyStr, 10);
            const { cx, cy } = worldToChunk(wx, wy);
            chunkCoords.add(`${cx},${cy}`);
        }

        for (const key of chunkCoords) {
            const [cxStr, cyStr] = key.split(',');
            const cx = parseInt(cxStr, 10);
            const cy = parseInt(cyStr, 10);
            const chunk = world.getChunk(cx, cy);
            if (chunk && chunk.isDirty()) {
                dirtyChunks.push(chunk);
            }
        }

        if (dirtyChunks.length === 0) return this;

        // 对每个脏 Chunk，逐列对比快照与实际数据
        for (const chunk of dirtyChunks) {
            const { cx, cy } = chunk.getChunkCoord();

            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                    const wx = cx * CHUNK_SIZE + lx;
                    const wy = cy * CHUNK_SIZE + ly;
                    const key = `${wx},${wy}`;

                    /** @type {Array<ColumnEntry>} */
                    const actualEntries = [];

                    for (let wz = 0; wz < this._maxHeight; wz++) {
                        const voxelId = chunk.getVoxel(lx, ly, wz);
                        const blockType = mapVoxelId(voxelId, this._voxelIdMap);
                        if (blockType !== null) {
                            actualEntries.push({ wz, blockType });
                        }
                    }

                    const oldEntries = this._snapshot.get(key) || null;

                    if (actualEntries.length === 0 && oldEntries) {
                        // 列变空了 → 移除
                        this._removeColumn(grid, wx, wy);
                        this._snapshot.delete(key);
                    } else if (actualEntries.length > 0 && !oldEntries) {
                        // 新增列 → 渲染
                        await this._renderColumn(grid, wx, wy, actualEntries);
                        this._snapshot.set(key, actualEntries);
                    } else if (actualEntries.length > 0 && oldEntries &&
                               !this._entriesEqual(oldEntries, actualEntries)) {
                        // 列变更 → 重建
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

    // ==================== 坐标转换 ====================

    /**
     * 将世界坐标转换为网格坐标（当前始终为一一对应）。
     *
     * @param {number} wx - 世界 X
     * @param {number} wy - 世界 Y
     * @returns {{ gx: number, gy: number }}
     *
     * @example
     * ```javascript
     * const { gx, gy } = adapter.worldToGrid(5, 3);
     * // → { gx: 5, gy: 3 }
     * ```
     */
    worldToGrid(wx, wy) {
        return { gx: wx, gy: wy };
    }

    /**
     * 获取指定世界坐标处的渲染快照信息。
     *
     * @param {number} wx - 世界 X
     * @param {number} wy - 世界 Y
     * @returns {Array<ColumnEntry>|null} 该列的渲染条目（按 wz 升序），无方块时返回 null
     *
     * @example
     * ```javascript
     * const entries = adapter.getColumnInfo(5, 3);
     * if (entries) {
     *     // entries = [{ wz: 0, blockType: 'grass' }, { wz: 1, blockType: 'stone' }]
     * }
     * ```
     */
    getColumnInfo(wx, wy) {
        return this._snapshot.get(`${wx},${wy}`) || null;
    }

    /**
     * 获取当前渲染快照统计信息。
     *
     * @returns {{ columns: number, blocks: number }}
     */
    getStats() {
        let blocks = 0;
        for (const entries of this._snapshot.values()) {
            blocks += entries.length;
        }
        return {
            columns: this._snapshot.size,
            blocks
        };
    }

    // ==================== 内部方法 ====================

    /**
     * 渲染一列方块到网格管理器。
     *
     * 从底向上逐层调用 addBlock。顶层的方块会遮挡低层，
     * 但渲染器会正确处理 zIndex。
     *
     * @private
     * @param {import('../render/block/BlockGridManager.mjs').BlockGridManager} grid
     * @param {number} wx
     * @param {number} wy
     * @param {Array<ColumnEntry>} entries - 按 wz 升序排列
     */
    async _renderColumn(grid, wx, wy, entries) {
        // 从底向上逐层放置
        for (const { wz, blockType } of entries) {
            await grid.addBlock(wx, wy, wz, blockType);
        }
    }

    /**
     * 从网格管理器中移除一列的所有方块。
     *
     * @private
     * @param {import('../render/block/BlockGridManager.mjs').BlockGridManager} grid
     * @param {number} wx
     * @param {number} wy
     */
    _removeColumn(grid, wx, wy) {
        // 需要知道该列有多少层。从快照中查找。
        const entries = this._snapshot.get(`${wx},${wy}`);
        if (!entries) return;

        // 从顶向下移除（顺序不重要，但逻辑清晰）
        for (let i = entries.length - 1; i >= 0; i--) {
            const { wz } = entries[i];
            grid.removeBlock(wx, wy, wz);
        }
    }

    /**
     * 比较两列条目是否相等。
     *
     * @private
     * @param {Array<ColumnEntry>} a
     * @param {Array<ColumnEntry>} b
     * @returns {boolean}
     */
    _entriesEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i].wz !== b[i].wz || a[i].blockType !== b[i].blockType) {
                return false;
            }
        }
        return true;
    }
}
