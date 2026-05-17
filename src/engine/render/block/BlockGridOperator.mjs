// @ts-check

/**
 * @fileoverview
 * BlockGridManager 的操作执行器 —— 封装批量构建、纹理预加载、
 * 方块创建/移除、网格数据处理等"重操作"逻辑。
 *
 * 设计原则：
 * - 构造时接收 BlockGridManager 引用，直接操作其内部状态
 * - 不暴露公共 API，所有方法由 BlockGridManager 委托调用
 * - 配合 BlockGridEventBinder 形成"操作器 + 绑定器 + 数据"三分结构
 *
 * @module render/block/BlockGridOperator
 */

import { BlockSprite } from '../../render/BlockSprite.mjs';
import { getSortKey } from '../../render/SortManager.mjs';
import { batchLoadAndTransform } from '../../loader/IsoTextureTransformer.mjs';
import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockGridOperator');

/**
 * BlockGridManager 的操作执行器。
 *
 * 内部协作约定（基于信任）：
 * - 直接读写 `manager._blockMap`、`manager._cachedTextures`
 * - 读取 `manager._layerStack`、`manager._sceneGraph`、`manager` 配置字段
 * - 调用 `manager.interactionManager._onBlockCreated()`
 * - 调用 `manager.debugManager._onBlockCreated()`
 */
export class BlockGridOperator {
    /** @private @type {import('./BlockGridManager.mjs').BlockGridManager} */
    _mgr;

    /** @param {import('./BlockGridManager.mjs').BlockGridManager} manager */
    constructor(manager) { this._mgr = manager; }

    // ==================== 批量构建 ====================

    /**
     * 从网格数据批量构建 2.5D 方块场景。
     * @param {Array<Array<string|null>>|Array<Array<Array<string|null>>>>} gridData
     * @param {Object} [options={}]
     * @returns {Promise<import('./BlockGridManager.mjs').BlockGridManager>}
     */
    async buildFromGrid(gridData, options = {}) {
        const mgr = this._mgr;
        mgr._useIsoTransform = options.useIsoTransform !== false;
        mgr._useAssembled = options.useAssembled === true;
        mgr._interpolation = options.interpolation || 'nearest';
        const progress = options.onProgress || (() => {});

        const { grid, heightLayers } = this._normalizeGrid(gridData);
        const layerCount = heightLayers.length;
        const gridH = grid.length;
        const gridW = grid[0] ? grid[0].length : 0;
        if (gridH === 0 || gridW === 0) { log.warn('网格为空，跳过构建'); return mgr; }

        // 扫描方块类型
        mgr._blockTypes.clear();
        for (const gz of heightLayers) {
            const layer = layerCount === 1 ? grid : gridData[gz];
            for (let gy = 0; gy < layer.length; gy++) {
                const row = layer[gy];
                for (let gx = 0; gx < row.length; gx++) {
                    const cell = row[gx];
                    if (cell !== null && cell !== undefined && cell !== '') mgr._blockTypes.add(cell);
                }
            }
        }
        const typeList = Array.from(mgr._blockTypes);

        // 预加载纹理
        if (mgr._useIsoTransform && typeList.length > 0) {
            progress(0.1, `加载纹理 (${typeList.length} 种)...`);
            await this.preloadTextures(typeList, { textureOverrides: options.textureOverrides });
        } else {
            mgr._cachedTextures = null;
        }

        progress(0.4, '构建方块...');
        let blockIndex = 0;
        const totalBlocks = this._countNonEmpty(grid, heightLayers, layerCount);
        for (let zi = 0; zi < heightLayers.length; zi++) {
            const gz = heightLayers[zi];
            const layer = layerCount === 1 ? grid : gridData[gz];
            for (let gy = 0; gy < layer.length; gy++) {
                const row = layer[gy];
                for (let gx = 0; gx < row.length; gx++) {
                    const cell = row[gx];
                    if (cell === null || cell === undefined || cell === '') continue;
                    await this._createAndPlaceBlock(gx, gy, gz, cell);
                    blockIndex++;
                    if (totalBlocks > 0 && blockIndex % 10 === 0) {
                        progress(0.4 + (blockIndex / totalBlocks) * 0.5, `放置方块 ${blockIndex}/${totalBlocks}...`);
                    }
                }
            }
        }
        progress(0.9, '场景构建完成');
        log.info(`场景构建完成: ${mgr._blockMap.size} 个方块, ${typeList.length} 种类型`);
        return mgr;
    }

    /**
     * 预加载方块类型的等轴变换纹理到缓存。
     * @param {string[]} blockTypes
     * @param {Object} [options={}]
     * @returns {Promise<import('./BlockGridManager.mjs').BlockGridManager>}
     */
    async preloadTextures(blockTypes, options = {}) {
        const mgr = this._mgr;
        if (!mgr._useIsoTransform || blockTypes.length === 0) { mgr._cachedTextures = null; return mgr; }
        const { BLOCK_TEXTURE_MAP: btm } = await import('../../render/BlockSprite.mjs');
        const textureMap = {};
        for (const type of blockTypes) {
            if (options.textureOverrides && options.textureOverrides[type]) {
                textureMap[type] = options.textureOverrides[type];
            } else if (btm[type]) {
                textureMap[type] = btm[type];
            } else {
                log.warn(`方块类型 "${type}" 未注册贴图，使用占位纹理`);
                textureMap[type] = btm[Object.keys(btm)[0]] || btm.grass;
            }
        }
        mgr._cachedTextures = await batchLoadAndTransform(textureMap, {
            interpolation: mgr._interpolation, fixEdges: false, includeAssembled: mgr._useAssembled
        });
        log.info(`纹理预加载完成: ${Object.keys(mgr._cachedTextures).length} 种`);
        return mgr;
    }

    // ==================== 方块创建与移除 ====================

    /**
     * 创建并放置单个方块。
     * @param {number} gx @param {number} gy @param {number} gz @param {string} blockType
     * @returns {Promise<import('../../render/BlockSprite.mjs').BlockSprite|null>}
     */
    async _createAndPlaceBlock(gx, gy, gz, blockType) {
        const mgr = this._mgr;
        try {
            const key = `${gx},${gy},${gz}`;
            if (mgr._blockMap.has(key)) { log.warn(`位置 (${gx},${gy},${gz}) 已有方块，跳过`); return null; }
            let block;
            if (mgr._useIsoTransform && mgr._cachedTextures && mgr._cachedTextures[blockType]) {
                block = new BlockSprite({ blockType, useIsoTransform: true });
                const cached = mgr._cachedTextures[blockType];
                if (mgr._useAssembled && cached.assembled) {
                    block.setAssembledTexture(cached.assembled);
                } else {
                    block.setIsoFaces(cached.top, cached.left, cached.right);
                }
            } else {
                block = await BlockSprite.createWithIsoTransform({
                    blockType, useAssembled: mgr._useAssembled, useIsoTransform: mgr._useIsoTransform
                });
            }
            block.setGridPosition(gx, gy, gz);
            const layerIndex = mgr._determineLayer(gz);
            if (mgr._sceneGraph) {
                const nodeId = mgr._sceneGraph.add(layerIndex, block, { sortKey: getSortKey(gx, gy, gz) });
                /** @type {number|undefined} */ (block._sceneNodeId) = nodeId;
            } else {
                mgr._layerStack.addToLayer(layerIndex, block);
            }
            mgr._blockMap.set(key, block);
            if (mgr.interactionManager) mgr.interactionManager._onBlockCreated(block, gx, gy, gz);
            if (mgr.debugManager) mgr.debugManager._onBlockCreated(block);
            log.debug(`放置方块: ${blockType} @ (${gx},${gy},${gz}) → Layer ${layerIndex}`);
            return block;
        } catch (err) {
            log.error(`创建方块失败: ${blockType} @ (${gx},${gy},${gz}):`, err);
            return null;
        }
    }

    /**
     * 从图层中移除并销毁方块。
     * @param {number} gx @param {number} gy @param {number} gz
     * @param {import('../../render/BlockSprite.mjs').BlockSprite} block
     */
    _removeFromLayer(gx, gy, gz, block) {
        const mgr = this._mgr;
        const key = `${gx},${gy},${gz}`;
        if (mgr._sceneGraph) {
            const nodeId = /** @type {number|undefined} */ (block._sceneNodeId);
            if (nodeId) mgr._sceneGraph.remove(nodeId);
        } else {
            try {
                mgr._layerStack.removeFromLayer(mgr._determineLayer(gz), block);
                block.destroy({ children: true });
            } catch (err) { log.warn(`移除方块 ${key} 时出错:`, err); }
        }
        mgr._blockMap.delete(key);
    }

    // ==================== 网格数据处理 ====================

    /**
     * 标准化网格数据格式（2D / 3D 自动检测）。
     * @private @param {Array|Array<Array>} gridData
     * @returns {{ grid: Array<Array<string|null>>, heightLayers: number[] }}
     */
    _normalizeGrid(gridData) {
        const is3D = Array.isArray(gridData) && gridData.length > 0 &&
            Array.isArray(gridData[0]) && gridData[0].length > 0 && Array.isArray(gridData[0][0]);
        if (is3D) {
            const heightLayers = [];
            for (let gz = 0; gz < gridData.length; gz++) {
                if (gridData[gz] && gridData[gz].length > 0) heightLayers.push(gz);
            }
            return { grid: gridData[0], heightLayers };
        }
        return { grid: gridData, heightLayers: [0] };
    }

    /**
     * 统计网格中非空格的数量。
     * @private @param {Array<Array<string|null>>} grid
     * @param {number[]} heightLayers @param {number} layerCount @returns {number}
     */
    _countNonEmpty(grid, heightLayers, layerCount) {
        let count = 0;
        for (const gz of heightLayers) {
            const layer = layerCount === 1 ? grid : grid[gz];
            if (!layer) continue;
            for (const row of layer) {
                for (const cell of row) {
                    if (cell !== null && cell !== undefined && cell !== '') count++;
                }
            }
        }
        return count;
    }
}
