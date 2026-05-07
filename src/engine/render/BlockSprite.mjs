// @ts-check

/**
 * @fileoverview
 * 2.5D 斜角方块精灵 - 渲染系统的"乐高积木"。
 *
 * 每个 BlockSprite 是一个 PIXI.Container，内部包含三个子 Sprite：
 * - _topSprite   — 方块顶面（45° 俯视菱形面）
 * - _leftSprite  — 方块左面（左侧墙面）
 * - _rightSprite — 方块右面（右侧墙面）
 *
 * 核心职责：
 * 1. 接收网格坐标 (gx, gy, gz) 并变换为屏幕坐标
 * 2. 根据方块类型加载对应的三面贴图
 * 3. 自动更新 zIndex 供 Y-Sort 使用
 *
 * 坐标变换数学：
 * ```
 * screenX = (gx - gy) * TILE_HALF_W
 * screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H
 * zIndex  = (gx + gy) * Z_BASE + gz
 * ```
 *
 * 三面 Sprite 在容器内的布局：
 * ```
 *          _topSprite          ← anchor(0.5, 1.0), pos(0, -TILE_H)
 *     ╱                    ╲
 *    ╱                      ╲
 *   ╱     (顶面菱形区域)      ╲
 *  ╱                          ╲
 * ╱────────────────────────────╲
 * ╲                            ╱
 *  ╲     _leftSprite          ╱   ← anchor(1.0, 0), pos(0, -TILE_H)
 *   ╲    (左墙面区域)        ╱
 *    ╲                      ╱
 *     ╲────────────────────╱
 *     ╱                    ╲
 *    ╱   _rightSprite       ╲      ← anchor(0, 0), pos(0, -TILE_H)
 *   ╱    (右墙面区域)        ╲
 *  ╱                          ╲
 * ╱────────────────────────────╲
 * ```
 * 容器原点 (0,0) = 方块在 gz 高度层上的"脚底中心"。
 *
 * @module render/BlockSprite
 */

import { Logger } from '../utils/Logger.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockSprite');

// ==================== 2.5D 斜角方块常量 ====================

/**
 * 每个面贴图的像素宽度。
 * 默认 64px —— 标准 2:1 等轴像素贴图宽度。
 * @type {number}
 */
export const TILE_W = 64;

/**
 * 每个面贴图的像素高度。
 * 默认 32px —— 标准 2:1 等轴像素贴图高度。
 * @type {number}
 */
export const TILE_H = 32;

/** 贴图半宽 */
export const TILE_HALF_W = TILE_W / 2;

/** 贴图半高 */
export const TILE_HALF_H = TILE_H / 2;

/**
 * Y-Sort 基数常量。
 * 必须大于任意 (gx + gy) 的最大可能值，
 * 确保 gz 只作为次级排序键。
 * @type {number}
 */
export const Z_BASE = 100;

// ==================== 方块类型 → 贴图路径映射 ====================

/**
 * 方块类型注册表。
 * 每种方块类型映射到三个面的贴图路径（相对于 index.html）。
 *
 * @type {Object<string, { top: string, left: string, right: string }>}
 */
export const BLOCK_TEXTURE_MAP = {
    grass: {
        top:   'assets/blocks/grass/block_grass_top.png',
        left:  'assets/blocks/grass/block_grass_left.png',
        right: 'assets/blocks/grass/block_grass_right.png'
    },
    dirt: {
        top:   'assets/blocks/dirt/block_dirt_top.png',
        left:  'assets/blocks/dirt/block_dirt_left.png',
        right: 'assets/blocks/dirt/block_dirt_right.png'
    },
    stone: {
        top:   'assets/blocks/stone/block_stone_top.png',
        left:  'assets/blocks/stone/block_stone_left.png',
        right: 'assets/blocks/stone/block_stone_right.png'
    },
    sand: {
        top:   'assets/blocks/sand/block_sand_top.png',
        left:  'assets/blocks/sand/block_sand_left.png',
        right: 'assets/blocks/sand/block_sand_right.png'
    },
    snow: {
        top:   'assets/blocks/snow/block_snow_top.png',
        left:  'assets/blocks/snow/block_snow_left.png',
        right: 'assets/blocks/snow/block_snow_right.png'
    },
    brick: {
        top:   'assets/blocks/brick/block_brick_top.png',
        left:  'assets/blocks/brick/block_brick_left.png',
        right: 'assets/blocks/brick/block_brick_right.png'
    },
    plank: {
        top:   'assets/blocks/plank/block_plank_top.png',
        left:  'assets/blocks/plank/block_plank_left.png',
        right: 'assets/blocks/plank/block_plank_right.png'
    },
    jade: {
        top:   'assets/blocks/jade/block_jade_top.png',
        left:  'assets/blocks/jade/block_jade_left.png',
        right: 'assets/blocks/jade/block_jade_right.png'
    },
    water: {
        top:   'assets/blocks/water/block_water_top.png',
        left:  'assets/blocks/water/block_water_left.png',
        right: 'assets/blocks/water/block_water_right.png'
    },
    roof: {
        top:   'assets/blocks/roof/block_roof_top.png',
        left:  'assets/blocks/roof/block_roof_left.png',
        right: 'assets/blocks/roof/block_roof_right.png'
    },
    cloud: {
        top:   'assets/blocks/cloud/block_cloud_top.png',
        left:  'assets/blocks/cloud/block_cloud_left.png',
        right: 'assets/blocks/cloud/block_cloud_right.png'
    },
    farm: {
        top:   'assets/blocks/farm/block_farm_top.png',
        left:  'assets/blocks/farm/block_farm_left.png',
        right: 'assets/blocks/farm/block_farm_right.png'
    }
};

/** 缺失贴图的占位路径（找不到类型时使用） */
const MISSING_TEXTURE = 'assets/placeholder/placeholder_block_grass_top.png';

// ==================== 类型定义 ====================

/**
 * 2.5D 斜角方块精灵配置
 * @typedef {Object} BlockSpriteOptions
 * @property {string} [blockType='grass'] - 方块类型标识
 * @property {string} [topTexture] - 自定义顶面贴图路径（覆盖 blockType）
 * @property {string} [leftTexture] - 自定义左面贴图路径（覆盖 blockType）
 * @property {string} [rightTexture] - 自定义右面贴图路径（覆盖 blockType）
 */

// ==================== BlockSprite 类 ====================

/**
 * 2.5D 斜角方块精灵
 *
 * 扩展 PIXI.Container，组合三个面（顶/左/右）的 Sprite，
 * 实现网格坐标到屏幕坐标的 45° 斜角变换。
 *
 * @extends PIXI.Container
 *
 * @example
 * ```javascript
 * import { BlockSprite } from './BlockSprite.mjs';
 * import { renderSystem } from './RenderSystem.mjs';
 *
 * // 创建草地方块并放置到 (5, 3, 0)
 * const block = new BlockSprite({ blockType: 'grass' });
 * block.setGridPosition(5, 3, 0);
 *
 * // 添加到 Ground 层
 * renderSystem.layerStack.addToLayer(1, block);
 * ```
 */
export class BlockSprite extends PIXI.Container {
    /** @private @type {PIXI.Sprite} */
    _topSprite;

    /** @private @type {PIXI.Sprite} */
    _leftSprite;

    /** @private @type {PIXI.Sprite} */
    _rightSprite;

    /** @private @type {string} */
    _blockType;

    /** @private @type {number} */
    _gx = 0;

    /** @private @type {number} */
    _gy = 0;

    /** @private @type {number} */
    _gz = 0;

    /**
     * @param {BlockSpriteOptions} [options={}] - 方块配置
     */
    constructor(options = {}) {
        super();

        this.name = 'BlockSprite';

        // 1. 创建三个面的 Sprite
        this._topSprite = new PIXI.Sprite();
        this._topSprite.name = 'TopFace';
        this._leftSprite = new PIXI.Sprite();
        this._leftSprite.name = 'LeftFace';
        this._rightSprite = new PIXI.Sprite();
        this._rightSprite.name = 'RightFace';

        // 2. 设置三面 Sprite 在容器内的局部位置
        //    容器原点 (0,0) = 方块在 gz 高度层上的"脚底中心"
        //
        //    布局原理：
        //    - 顶面：锚点置底居中，位置在容器正上方 TILE_H 处
        //    - 左面：锚点置顶右，位置在容器正上方 TILE_H 处（向右上对齐顶面）
        //    - 右面：锚点置顶左，位置在容器正上方 TILE_H 处（向左上对齐顶面）
        //    三者各自的矩形区域形成等轴立方体的三个可见面，
        //    非透明部分（菱形/平行四边形）在视觉上拼合为完整方块。
        this._topSprite.anchor.set(0.5, 1.0);
        this._topSprite.position.set(0, -TILE_H);

        this._leftSprite.anchor.set(1.0, 0);
        this._leftSprite.position.set(0, -TILE_H);

        this._rightSprite.anchor.set(0, 0);
        this._rightSprite.position.set(0, -TILE_H);

        // 3. 将三个面添加到容器
        this.addChild(this._topSprite);
        this.addChild(this._leftSprite);
        this.addChild(this._rightSprite);

        // 4. 设置方块类型（加载对应贴图）
        const type = options.blockType || 'grass';
        this.setBlockType(type, {
            top: options.topTexture,
            left: options.leftTexture,
            right: options.rightTexture
        });
    }

    // ==================== 公共 API ====================

    /**
     * 设置网格坐标并更新屏幕位置。
     *
     * 45° 斜角坐标变换公式：
     * ```
     * screenX = (gx - gy) * TILE_HALF_W    // TILE_HALF_W = 32
     * screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H
     *                                        // TILE_HALF_H = 16, TILE_H = 32
     * ```
     *
     * 同时自动更新 zIndex：
     * ```
     * zIndex = (gx + gy) * Z_BASE + gz     // Z_BASE = 100
     * ```
     *
     * `zIndex` 决定 Y-Sort 排序顺序：
     * - (gx + gy) 越大 → 屏幕 Y 越大 → zIndex 越大 → 绘制在上面
     * - gz 越大（方块越高）→ zIndex 越大 → 覆盖同位置的低方块
     *
     * @param {number} gx - 网格 X 坐标（列）
     * @param {number} gy - 网格 Y 坐标（行）
     * @param {number} [gz=0] - 网格 Z 坐标（高度层，0 = 地面层）
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * // 在地面层 (5, 3) 放置一个方块
     * block.setGridPosition(5, 3, 0);
     *
     * // 在高度层 2 的 (1, 1) 放置一个方块
     * block.setGridPosition(1, 1, 2);
     * ```
     */
    setGridPosition(gx, gy, gz = 0) {
        this._gx = gx;
        this._gy = gy;
        this._gz = gz;

        // 坐标变换
        this.x = (gx - gy) * TILE_HALF_W;
        this.y = (gx + gy) * TILE_HALF_H - gz * TILE_H;

        // Y-Sort 排序键
        this.zIndex = (gx + gy) * Z_BASE + gz;

        return this;
    }

    /**
     * 获取当前网格 X 坐标。
     * @returns {number}
     */
    get gridX() { return this._gx; }

    /**
     * 获取当前网格 Y 坐标。
     * @returns {number}
     */
    get gridY() { return this._gy; }

    /**
     * 获取当前网格 Z 坐标（高度层）。
     * @returns {number}
     */
    get gridZ() { return this._gz; }

    /**
     * 获取当前方块类型。
     * @returns {string}
     */
    get blockType() { return this._blockType; }

    /**
     * 设置方块类型，切换对应贴图。
     *
     * 加载规则：
     * 1. 从 BLOCK_TEXTURE_MAP 中查找 type 对应的三面贴图路径
     * 2. 如果 type 未注册，使用缺失占位纹理并记录警告
     * 3. 如果传入了自定义贴图路径（customTextures），优先使用
     *
     * @param {string} type - 方块类型标识（如 'grass', 'stone', 'dirt'）
     * @param {{ top?: string, left?: string, right?: string }} [customTextures] - 自定义贴图路径（覆盖注册表）
     * @returns {this} 链式调用
     *
     * @example
     * ```javascript
     * // 使用注册类型
     * block.setBlockType('stone');
     *
     * // 使用自定义贴图
     * block.setBlockType('custom', {
     *     top: 'assets/my_custom_top.png',
     *     left: 'assets/my_custom_left.png',
     *     right: 'assets/my_custom_right.png'
     * });
     * ```
     */
    setBlockType(type, customTextures = {}) {
        // 查找注册表
        const entry = BLOCK_TEXTURE_MAP[type];

        if (!entry && !customTextures.top && !customTextures.left && !customTextures.right) {
            log.warn(`未知方块类型 "${type}"，使用缺失占位纹理`);
            this._blockType = 'missing';
            this._applyTexture(MISSING_TEXTURE, MISSING_TEXTURE, MISSING_TEXTURE);
            return this;
        }

        this._blockType = type;

        // 优先使用自定义贴图，否则从注册表获取
        const topTex    = customTextures.top    || (entry ? entry.top    : MISSING_TEXTURE);
        const leftTex   = customTextures.left   || (entry ? entry.left   : MISSING_TEXTURE);
        const rightTex  = customTextures.right  || (entry ? entry.right  : MISSING_TEXTURE);

        this._applyTexture(topTex, leftTex, rightTex);

        return this;
    }

    /**
     * 销毁此 BlockSprite，释放所有子对象和纹理引用。
     *
     * 覆盖 PIXI.Container.destroy() 以确保三面 Sprite 被正确清理。
     * 调用后此实例不可再使用。
     *
     * @param {object|boolean} [options] - 传递到 PIXI.Container.destroy() 的参数
     */
    destroy(options) {
        // 置空引用以帮助 GC
        this._topSprite = null;
        this._leftSprite = null;
        this._rightSprite = null;

        super.destroy(options);
    }

    // ==================== 内部方法 ====================

    /**
     * 将贴图路径应用到三个面 Sprite。
     *
     * 通过 PIXI.Texture.from() 加载贴图。
     * 如果路径无效（加载失败），PixiJS 会自动显示默认占位纹理。
     *
     * @private
     * @param {string} topPath  - 顶面贴图路径
     * @param {string} leftPath - 左面贴图路径
     * @param {string} rightPath - 右面贴图路径
     */
    _applyTexture(topPath, leftPath, rightPath) {
        this._topSprite.texture   = PIXI.Texture.from(topPath);
        this._leftSprite.texture  = PIXI.Texture.from(leftPath);
        this._rightSprite.texture = PIXI.Texture.from(rightPath);
    }
}
