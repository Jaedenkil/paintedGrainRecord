// @ts-check

/**
 * @fileoverview
 * VoxelRenderAdapter 的类型定义与常量 —— 体素 ID 映射表及相关辅助。
 * @module voxel/VoxelRenderConstants
 */

/**
 * 渲染快照中某一列的条目。
 * @typedef {Object} ColumnEntry
 * @property {number} wz - 高度层
 * @property {string} blockType - 方块类型标识
 */

/**
 * 适配器配置。
 * @typedef {Object} AdapterOptions
 * @property {Object<number, string>} [voxelIdMap] - 体素 ID → blockType 映射表
 * @property {number} [maxHeight=16] - 世界最大高度层数
 */

/**
 * 默认体素 ID → blockType 映射（与 VoxelDemoScene 一致）。
 * @type {Object<number, string>}
 */
export const DEFAULT_VOXEL_ID_MAP = {
    1: 'grass', 2: 'dirt', 3: 'stone', 4: 'brick',
    5: 'plank', 6: 'sand', 7: 'snow', 8: 'jade',
    9: 'water', 10: 'roof', 11: 'cloud'
};

/**
 * 将体素 ID 转换为 blockType 字符串。
 * @param {number} voxelId
 * @param {Object<number, string>} voxelIdMap
 * @returns {string|null}
 */
export function mapVoxelId(voxelId, voxelIdMap) {
    if (voxelId === 0) return null;
    return voxelIdMap[voxelId] || null;
}
