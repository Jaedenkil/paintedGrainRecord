// @ts-check

/**
 * @fileoverview
 * 方块调试管理器 —— 点击方块时输出完整调试信息（P0.2）。
 *
 * 职责：
 * 1. enableBlockDebug — 为所有已有/新建方块绑定 pointerdown 监听，
 *    点击时通过 console.group + console.table 输出完整调试快照。
 * 2. disableBlockDebug — 移除所有方块的 pointerdown 监听。
 *
 * 依赖的全局引用：
 * - PIXI.Polygon — 用于构建菱形 hitArea（由 _ensureBlockInteractive 使用）
 * - BLOCK_TEXTURE_MAP — 用于查找纹理路径（由 _logBlockDebugInfo 使用）
 *
 * @module render/block/BlockDebugManager
 */

import { Logger } from '../../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockDebugManager');

/**
 * 方块调试管理器
 *
 * 与 BlockGridManager 协作：
 * - 构造函数接收 BlockGridManager 引用
 * - _onBlockCreated(block) 由 BlockGridManager._createAndPlaceBlock 回调，
 *   为新建方块自动绑定调试监听（如果已启用）
 *
 * @example
 * ```javascript
 * const dm = new BlockDebugManager(gridManager);
 * dm.enableBlockDebug();
 * // 点击方块 → 控制台输出调试快照
 * dm.disableBlockDebug();
 * ```
 */
export class BlockDebugManager {
    /**
     * 被管理的 BlockGridManager 实例。
     * @private @type {import('./BlockGridManager.mjs').BlockGridManager}
     */
    _grid;

    /**
     * 调试日志是否已启用。
     * @private @type {boolean}
     */
    _blockDebugEnabled = false;

    /**
     * @param {import('./BlockGridManager.mjs').BlockGridManager} gridManager - 核心网格管理器
     */
    constructor(gridManager) {
        this._grid = gridManager;
    }

    // ==================== 调试日志 API ====================

    /**
     * 启用方块点击调试日志。
     *
     * 为所有现有方块绑定 pointerdown 事件监听，
     * 点击方块时在控制台输出完整调试信息。
     * 新建方块通过 _onBlockCreated 自动绑定。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * dm.enableBlockDebug();
     * // 点击任意方块，控制台输出调试快照
     * ```
     */
    enableBlockDebug() {
        if (this._blockDebugEnabled) {
            log.warn('方块调试日志已启用，跳过重复绑定');
            return this;
        }
        this._blockDebugEnabled = true;

        // 为所有已有方块绑定 pointerdown 调试监听
        for (const [, block] of this._grid._blockMap) {
            this._ensureBlockInteractive(block);

            block.on('pointerdown', (event) => {
                this._logBlockDebugInfo(block, event);
            });
        }

        log.info(`方块调试日志已启用 (${this._grid._blockMap.size} 个方块已绑定)`);
        return this;
    }

    /**
     * 禁用方块点击调试日志，移除所有 pointerdown 监听。
     *
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * dm.disableBlockDebug();
     * ```
     */
    disableBlockDebug() {
        if (!this._blockDebugEnabled) return this;

        for (const [, block] of this._grid._blockMap) {
            block.removeAllListeners('pointerdown');
        }

        this._blockDebugEnabled = false;

        log.info('方块调试日志已禁用');
        return this;
    }

    /**
     * 由 BlockGridManager._createAndPlaceBlock 回调。
     * 当调试已启用时，为新创建的方块绑定 pointerdown 调试监听。
     *
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 新建的方块
     */
    _onBlockCreated(block) {
        if (!this._blockDebugEnabled) return;

        this._ensureBlockInteractive(block);
        block.on('pointerdown', (event) => {
            this._logBlockDebugInfo(block, event);
        });
    }

    // ==================== 内部方法 ====================

    /**
     * 确保方块具备交互能力（eventMode + hitArea）。
     *
     * @private
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 目标方块
     */
    _ensureBlockInteractive(block) {
        if (!block.eventMode || block.eventMode === 'none') {
            block.eventMode = 'static';
        }
        if (!block.hitArea) {
            block.hitArea = new PIXI.Polygon(
                0, -6,   // 顶
                12, 0,   // 右
                0, 6,    // 底
                -12, 0   // 左
            );
        }
    }

    /**
     * 编译并输出方块的完整调试信息到控制台。
     *
     * @private
     * @param {import('../BlockSprite.mjs').BlockSprite} block - 被点击的方块
     * @param {import('pixi.js').FederatedPointerEvent} event - 原始指针事件
     */
    _logBlockDebugInfo(block, event) {
        // 动态导入 BLOCK_TEXTURE_MAP（避免顶层依赖）
        // 使用全局 PIXI 引用（由运行环境注入）
        const PIXI = /** @type {any} */ (globalThis).PIXI;

        const type = block.blockType;

        // 通过 gridManager 获取纹理路径信息
        // 优先从 _cachedTextures 获取，否则使用默认值
        let topPath = 'N/A';
        let leftPath = 'N/A';
        let rightPath = 'N/A';

        // 从 block 的面精灵获取纹理 UV 信息
        /**
         * 从 Sprite 的纹理提取 UV 帧信息。
         * @param {import('pixi.js').Sprite} sprite - 面精灵
         * @returns {string} 格式化后的 UV/帧描述
         */
        const getUVInfo = (sprite) => {
            const tex = sprite && sprite.texture;
            if (!tex || !tex.frame) return 'N/A';
            const f = tex.frame;
            const bw = (tex.baseTexture && tex.baseTexture.width) || 1;
            const bh = (tex.baseTexture && tex.baseTexture.height) || 1;
            const u = (f.x / bw).toFixed(3);
            const v = (f.y / bh).toFixed(3);
            const u2 = ((f.x + f.width) / bw).toFixed(3);
            const v2 = ((f.y + f.height) / bh).toFixed(3);
            return `UV[(${u},${v})-(${u2},${v2})] Frame(${f.x},${f.y},${f.width}×${f.height})`;
        };

        // 转换 tint（数字 → 十六进制色号）
        const tintStr = typeof block.tint === 'number'
            ? `#${block.tint.toString(16).padStart(6, '0')}`
            : String(block.tint);

        // 编译调试对象
        const info = {
            '纹理类型': type,
            '顶面贴图': topPath,
            '左面贴图': leftPath,
            '右面贴图': rightPath,
            '顶面 UV/帧': getUVInfo(block._topSprite),
            '左面 UV/帧': getUVInfo(block._leftSprite),
            '右面 UV/帧': getUVInfo(block._rightSprite),
            '图集引用': 'N/A（当前架构无纹理图集系统）',

            '世界 X': block.position.x,
            '世界 Y': block.position.y,
            '局部 X': block.position.x,
            '局部 Y': block.position.y,
            'zIndex': block.zIndex,

            '网格列 (gx)': block.gridX,
            '网格行 (gy)': block.gridY,
            '高度层 (gz)': block.gridZ,

            '物块 ID': block.blockId,

            '所属区块 ID': 'N/A（当前架构无区块系统）',

            '旋转 (rad)': block.rotation,
            '缩放 X': block.scale.x,
            '缩放 Y': block.scale.y,
            '颜色叠加': tintStr,
            '透明度': block.alpha,

            '可见': block.visible,
            '选中': block.selected,
        };

        console.group(
            `%c🔲 Block #${block.blockId} [${type}] @ (${block.gridX},${block.gridY},${block.gridZ})`,
            'color: #d4a847; font-weight: bold;'
        );
        console.table(info);
        console.groupEnd();
    }

    /**
     * 调试日志是否已启用。
     * @returns {boolean}
     */
    get isEnabled() {
        return this._blockDebugEnabled;
    }

    /**
     * 销毁调试管理器，解绑所有事件。
     */
    destroy() {
        this.disableBlockDebug();
        this._grid = null;
    }
}
