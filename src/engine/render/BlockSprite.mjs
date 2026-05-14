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
import {
    transformTopFace,
    shearToParallelogram,
    assembleBlock,
    loadAndTransformBlock,
    SHEAR_OFFSET,
    ROTATED_SIZE,
    SIDE_WIDTH,
    SIDE_HEIGHT,
    TOP_HEIGHT
} from '../loader/IsoTextureTransformer.mjs';
import { imageDataToPixiTexture } from '../utils/ImageDataUtils.mjs';

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const log = Logger.for('BlockSprite');

// ==================== 2.5D 斜角方块常量 ====================

/**
 * 每个面贴图的显示像素宽度。
 * 与源纹理尺寸一致（16×16），后续形变操作将在此尺寸上叠加。
 * @type {number}
 */
export const TILE_W = 16;

/**
 * 每个面贴图的显示像素高度。
 * @type {number}
 */
export const TILE_H = 16;

/**
 * 等轴投影水平步进（菱形半宽）。
 *
 * 基于变换后的顶面菱形尺寸（ROTATED_SIZE=24），
 * 相邻网格点的水平间距 = 菱形宽度的一半 = 12px。
 *
 * 之前错误地使用了源纹理半宽（TILE_W / 2 = 8），
 * 导致菱形水平重叠 4px（菱形半宽 12px 但步进仅 8px），
 * 呈现"向中心挤压"的效果。
 *
 * @see ROTATED_SIZE - 变换后顶面菱形宽度（24px）
 * @see IsoGridOverlay - 菱形网格覆盖层（使用同一步进值）
 */
export const TILE_HALF_W = ROTATED_SIZE / 2;  // 12

/**
 * 等轴投影垂直步进（菱形半高）。
 *
 * 基于变换后的顶面菱形高度（TOP_HEIGHT=12），
 * 相邻网格点的垂直间距 = 菱形高度的一半 = 6px。
 *
 * @see TOP_HEIGHT - 变换后顶面菱形高度（12px）
 */
export const TILE_HALF_H = TOP_HEIGHT / 2;     // 6

/**
 * 源纹理像素宽度（美术资产标准尺寸）。
 * 所有物块的三面源贴图统一为 16×16 像素。
 * @type {number}
 */
export const SRC_TILE_W = 16;

/**
 * 源纹理像素高度（美术资产标准尺寸）。
 * @type {number}
 */
export const SRC_TILE_H = 16;

/**
 * 子 Sprite X 轴缩放系数。
 * 当前为 1:1 等比显示（16×16 源纹理 → 16×16 显示），
 * 后续形变操作时将调整此系数。
 * @type {number}
 */
export const TEXTURE_SCALE_X = TILE_W / SRC_TILE_W;

/**
 * 子 Sprite Y 轴缩放系数。
 * @type {number}
 */
export const TEXTURE_SCALE_Y = TILE_H / SRC_TILE_H;

/**
 * Y-Sort 基数常量。
 * 必须大于任意 (gx + gy) 的最大可能值，
 * 确保 gz 只作为次级排序键。
 * @type {number}
 */
export const Z_BASE = 100;

/**
 * 顶面偏移量（视觉高度）。
 * 等于 TILE_H，表示从方块底座中心到顶面菱形中心的垂直距离。
 *
 * 顶面对齐模式下，子精灵局部位置基于此偏移计算：
 * - 顶面：局部原点 (0, 0)
 * - 侧面：局部原点向下偏移
 *
 * @type {number}
 */
export const BLOCK_TOP_OFFSET = TILE_H;

// ==================== 方块类型 → 贴图路径映射 ====================

/**
 * 方块类型注册表。
 * 每种方块类型映射到三个面的贴图路径（相对于 index.html）。
 *
 * @type {Object<string, { top: string, left: string, right: string }>}
 */
export const BLOCK_TEXTURE_MAP = {
    grass: {
        top:   'assets/blocks/grass/grass_005_top.png',
        left:  'assets/blocks/grass/grass_001_left.png',
        right: 'assets/blocks/grass/grass_003_right.png'
    },
    dirt: {
        top:   'assets/blocks/dirt/dirt_005_top.png',
        left:  'assets/blocks/dirt/dirt_001_left.png',
        right: 'assets/blocks/dirt/dirt_003_right.png'
    },
    stone: {
        top:   'assets/blocks/stone/stone_005_top.png',
        left:  'assets/blocks/stone/stone_001_left.png',
        right: 'assets/blocks/stone/stone_003_right.png'
    },
    sand: {
        top:   'assets/blocks/sand/sand_005_top.png',
        left:  'assets/blocks/sand/sand_001_left.png',
        right: 'assets/blocks/sand/sand_003_right.png'
    },
    snow: {
        top:   'assets/blocks/snow/snow_005_top.png',
        left:  'assets/blocks/snow/snow_001_left.png',
        right: 'assets/blocks/snow/snow_003_right.png'
    },
    brick: {
        top:   'assets/blocks/brick/brick_005_top.png',
        left:  'assets/blocks/brick/brick_001_left.png',
        right: 'assets/blocks/brick/brick_003_right.png'
    },
    plank: {
        top:   'assets/blocks/plank/plank_005_top.png',
        left:  'assets/blocks/plank/plank_001_left.png',
        right: 'assets/blocks/plank/plank_003_right.png'
    },
    jade: {
        top:   'assets/blocks/jade/jade_005_top.png',
        left:  'assets/blocks/jade/jade_001_left.png',
        right: 'assets/blocks/jade/jade_003_right.png'
    },
    water: {
        top:   'assets/blocks/water/water_005_top.png',
        left:  'assets/blocks/water/water_001_left.png',
        right: 'assets/blocks/water/water_003_right.png'
    },
    roof: {
        top:   'assets/blocks/roof/roof_005_top.png',
        left:  'assets/blocks/roof/roof_001_left.png',
        right: 'assets/blocks/roof/roof_003_right.png'
    },
    cloud: {
        top:   'assets/blocks/cloud/cloud_005_top.png',
        left:  'assets/blocks/cloud/cloud_001_left.png',
        right: 'assets/blocks/cloud/cloud_003_right.png'
    },
    farm: {
        top:   'assets/blocks/farm/farm_005_top.png',
        left:  'assets/blocks/farm/farm_001_left.png',
        right: 'assets/blocks/farm/farm_003_right.png'
    },
    glow: {
        top:   'assets/blocks/glow/glow_001_top.png',  // 占位，glow 无素材，使用占位
        left:  'assets/blocks/glow/glow_001_left.png',
        right: 'assets/blocks/glow/glow_001_right.png'
    },
    magma: {
        top:   'assets/blocks/magma/magma_005_top.png',
        left:  'assets/blocks/magma/magma_001_left.png',
        right: 'assets/blocks/magma/magma_003_right.png'
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
 * @property {boolean} [useIsoTransform=false] - 是否使用等轴纹理变换管道
 *     启用后，加载的 16×16 源纹理将通过旋转/剪切/压缩自动变换为等轴透视纹理。
 *     使用此模式时，三面 Sprite 的布局会被调整为等轴装配布局。
 */

// ==================== 全局方块 ID 计数器 ====================

/** @private @type {number} 单调递增的方块 ID 计数器，用于每个 BlockSprite 的唯一标识 */
let _blockIdCounter = 0;

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
    /** @private @type {import('pixi.js').Sprite} */
    _topSprite;

    /** @private @type {import('pixi.js').Sprite} */
    _leftSprite;

    /** @private @type {import('pixi.js').Sprite} */
    _rightSprite;

    /**
     * 等轴装配后的整块精灵（可选）。
     * 当使用 `setAssembledTexture()` 时启用，替代三面独立 Sprite。
     * @private @type {import('pixi.js').Sprite|null}
     */
    _assembledSprite = null;

    /**
     * 是否启用等轴纹理变换模式。
     * 启用后，setBlockType 会自动对源 16×16 纹理执行等轴变换。
     * @private @type {boolean}
     */
    _useIsoTransform = false;

    /** @private @type {string} */
    _blockType = '';

    /** @private @type {number} */
    _gx = 0;

    /** @private @type {number} */
    _gy = 0;

    /** @private @type {number} */
    _gz = 0;

    /**
     * 全局唯一方块 ID（构造时由 _blockIdCounter 自动分配）。
     * @private @type {number}
     */
    _blockId = 0;

    /**
     * 是否被选中（用于调试 UI 高亮）。
     * @private @type {boolean}
     */
    _selected = false;

    /**
     * @param {BlockSpriteOptions} [options={}] - 方块配置
     */
    constructor(options = {}) {
        super();

        this.name = 'BlockSprite';

        // 分配全局唯一方块 ID
        this._blockId = ++_blockIdCounter;

        // 检查是否启用等轴变换模式
        this._useIsoTransform = options.useIsoTransform === true;

        // 1. 创建三个面的 Sprite
        this._topSprite = new PIXI.Sprite();
        this._topSprite.name = 'TopFace';
        this._leftSprite = new PIXI.Sprite();
        this._leftSprite.name = 'LeftFace';
        this._rightSprite = new PIXI.Sprite();
        this._rightSprite.name = 'RightFace';

        // 2. 设置三面 Sprite 在容器内的局部位置
        //    容器原点 (0,0) = 方块顶面菱形中心（顶面对齐模式）
        //
        //    布局原理（当前为占位布局，形变后续叠加）：
        //    - 顶面：锚点置底居中，位置在容器原点 (0,0)
        //    - 左面：锚点置顶右，位置在容器原点 (0,0)（下方拓展）
        //    - 右面：锚点置顶左，位置在容器原点 (0,0)（下方拓展）
        //    三者目前以 1:1 原尺寸显示（16×16），
        //    后续形变操作将在此布局基础上叠加等轴变形。
        this._topSprite.anchor.set(0.5, 1.0);
        this._topSprite.position.set(0, 0);

        this._leftSprite.anchor.set(1.0, 0);
        this._leftSprite.position.set(0, 0);

        this._rightSprite.anchor.set(0, 0);
        this._rightSprite.position.set(0, 0);

        // 3. 设置三面 Sprite 的缩放（当前为 1:1 等比显示）
        //    源纹理（16×16）→ 显示尺寸（16×16），缩放比 TEXTURE_SCALE_X=1, TEXTURE_SCALE_Y=1
        //    后续形变操作时修改缩放系数以叠加等轴变形效果
        this._topSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);
        this._leftSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);
        this._rightSprite.scale.set(TEXTURE_SCALE_X, TEXTURE_SCALE_Y);

        // 4. 将三个面添加到容器
        this.addChild(this._topSprite);
        this.addChild(this._leftSprite);
        this.addChild(this._rightSprite);

        // 5. 设置方块类型（加载对应贴图）
        const type = options.blockType || 'grass';
        if (this._useIsoTransform && !options.topTexture && !options.leftTexture && !options.rightTexture) {
            // 等轴模式：先用占位纹理，后续通过异步工厂加载变换
            this._blockType = type;
            this._applyTexture(MISSING_TEXTURE, MISSING_TEXTURE, MISSING_TEXTURE);
        } else {
            this.setBlockType(type, {
                top: options.topTexture,
                left: options.leftTexture,
                right: options.rightTexture
            });
        }
    }

    // ==================== 公共 API ====================

    /**
     * 设置网格坐标并更新屏幕位置（顶面对齐模式）。
     *
     * 容器原点 (0,0) = 方块顶面菱形中心，与网格点 P(gx, gy) 对齐。
     *
     * 45° 斜角坐标变换公式：
     * ```
     * screenX = (gx - gy) * TILE_HALF_W    // TILE_HALF_W = 12（菱形半宽）
     * screenY = (gx + gy) * TILE_HALF_H - gz * TILE_H
     *                                        // TILE_HALF_H = 6（菱形半高）, TILE_H = 16
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
     * 获取全局唯一方块 ID（构造时自动分配）。
     * @returns {number}
     */
    get blockId() { return this._blockId; }

    /**
     * 获取选中状态。
     * @returns {boolean}
     */
    get selected() { return this._selected; }

    /**
     * 设置选中状态。
     * @param {boolean} v
     */
    set selected(v) { this._selected = !!v; }

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
     * 设置等轴变换后的三面纹理（直接传入已变换的 ImageData）。
     *
     * 此方法用变换后的纹理替换三面 Sprite 的当前纹理，
     * 并自动调整 Sprite 的布局为等轴装配位。
     *
     * @param {ImageData} topData    - 变换后的顶面纹理 (23×12)
     * @param {ImageData} leftData   - 变换后的左面纹理 (12×17)
     * @param {ImageData} rightData  - 变换后的右面纹理 (12×17)
     * @returns {this} 链式调用
     *
     * @example
     * ```js
     * import { transformTopFace, shearToParallelogram } from '../loader/IsoTextureTransformer.mjs';
     *
     * const top   = transformTopFace(topRaw);
     * const left  = shearToParallelogram(leftRaw, 'left');
     * const right = shearToParallelogram(rightRaw, 'right');
     * block.setIsoFaces(top, left, right);
     * ```
     */
    setIsoFaces(topData, leftData, rightData) {
        this._topSprite.texture   = imageDataToPixiTexture(topData);
        this._leftSprite.texture  = imageDataToPixiTexture(leftData);
        this._rightSprite.texture = imageDataToPixiTexture(rightData);

        this._layoutIsoFaces();
        return this;
    }

    /**
     * 设置等轴装配后的整块纹理（单精灵模式）。
     *
     * 使用 `assembleBlock()` 预装配的完整等轴方块纹理作为单个 Sprite 显示。
     * 此模式下三面独立 Sprite 会被隐藏，仅显示装配后的整块。
     *
     * @param {ImageData} assembledData - 通过 assembleBlock() 生成的完整方块纹理
     * @returns {this} 链式调用
     *
     * @example
     * ```js
     * import { assembleBlock } from '../loader/IsoTextureTransformer.mjs';
     * const assembled = assembleBlock(top, left, right);
     * block.setAssembledTexture(assembled);
     * ```
     */
    setAssembledTexture(assembledData) {
        // 首次调用时创建装配精灵
        if (!this._assembledSprite) {
            this._assembledSprite = new PIXI.Sprite();
            this._assembledSprite.name = 'AssembledBlock';
            this.addChildAt(this._assembledSprite, 0);
        }

        this._assembledSprite.texture = imageDataToPixiTexture(assembledData);
        // 顶面对齐：锚点置顶居中，容器原点 = 顶面菱形中心
        this._assembledSprite.anchor.set(0.5, 0);
        this._assembledSprite.position.set(0, 0);

        // 隐藏三面独立 Sprite（它们作为备选保留）
        this._topSprite.visible = false;
        this._leftSprite.visible = false;
        this._rightSprite.visible = false;

        // 设为 1:1 显示
        this._assembledSprite.scale.set(1, 1);

        return this;
    }

    /**
     * 将三个面切换回独立模式（隐藏装配精灵，显示三面）。
     *
     * @returns {this} 链式调用
     */
    showSeparateFaces() {
        if (this._assembledSprite) {
            this._assembledSprite.visible = false;
        }
        this._topSprite.visible = true;
        this._leftSprite.visible = true;
        this._rightSprite.visible = true;
        return this;
    }

    /**
     * 调整三面 Sprite 为等轴装配布局（顶面对齐模式）。
     *
     * 变换后的纹理尺寸：
     * - 顶面: 24×12（旋转压缩后的菱形，实际非透明内容 ~23×12）
     * - 左面: 12×21（剪切后的平行四边形）
     * - 右面: 12×21（剪切后的平行四边形）
     *
     * 容器原点 (0,0) = 顶面菱形中心（与网格点对齐）。
     * 侧面从原点向下延伸。
     *
     * 装配位置：
     * ```
     *      ╱ top ╲              ← top (24×12), anchor(0.5, 0.5), pos(0, 0)
     *     ╱________╲
     *    ╱  left   ╲  ╲        ← left anchor(1.0, 0), right anchor(0, 0)
     *   ╱          ╱ right ╲     起始于 y = TOP_H/2 - sideShiftY
     *  ╱__________╱________╲
     * ```
     *
     * 注意：sideShiftY 必须与 IsoTextureTransformer.assembleBlock 中的
     * sideShiftY 保持完全一致（同为 Math.ceil(SHEAR_OFFSET)），
     * 否则三面模式与装配模式之间会出现 1px 垂直错位。
     *
     * @private
     */
    _layoutIsoFaces() {
        const SIDE_W = SIDE_WIDTH;  // 12 (来自 IsoTextureTransformer)
        const SIDE_H = SIDE_HEIGHT; // 21
        const TOP_W = ROTATED_SIZE; // 24
        const TOP_H = TOP_HEIGHT;   // 12

        // 垂直偏移量：平行四边形的最早可见像素行 = ceil(SHEAR_OFFSET) ≈ 6
        // 使用 ceil 确保侧面顶端与顶面菱形底边在像素级对齐，
        // 与 assembleBlock 保持一致，消除三面/装配模式间的错位。
        const sideShiftY = Math.ceil(SHEAR_OFFSET); // ceil(5.657) = 6

        // ── 顶面微扩覆盖（消除接缝间隙）──
        // 即使纹理边缘填充后，渲染时因纹理采样/抗锯齿仍可能产生间隙。
        // 将顶面 Sprite 整体放大 1.0px 每边（累加两轮 0.5px 一圈的指令），
        // 使其略微覆盖侧面边缘，利用像素重叠彻底消除视觉间隙。
        // 缩放值：纹理 24×12 → 显示 26×14（左右+1px，上下+1px）
        const TOP_SCALE_X = (TOP_W + 2) / TOP_W; // 26/24 ≈ 1.0833
        const TOP_SCALE_Y = (TOP_H + 2) / TOP_H; // 14/12 ≈ 1.1667

        // 顶面：菱形中心对齐容器原点 (0,0)
        // 菱形半高 = TOP_H/2 = 6，钻石顶点在 y = -6，底点在 y = 6
        this._topSprite.anchor.set(0.5, 0.5);
        this._topSprite.position.set(0, 0);
        this._topSprite.scale.set(TOP_SCALE_X, TOP_SCALE_Y);

        // 左面：锚点置顶右，右边缘对齐容器中心
        // 垂直偏移 = TOP_H/2 - sideShiftY，使剪切后的可见对角线边缘
        // 与顶面菱形左斜面精确对齐，消除间隙。
        // 右边缘是垂直的（固定边），左边缘向左侧延伸
        this._leftSprite.anchor.set(1.0, 0);
        this._leftSprite.position.set(0, TOP_H / 2 - sideShiftY);
        this._leftSprite.scale.set(1, 1);

        // 右面：锚点置顶左，左边缘对齐容器中心
        // 同上垂直偏移
        // 左边缘是垂直的（固定边），右边缘向右侧延伸
        this._rightSprite.anchor.set(0, 0);
        this._rightSprite.position.set(0, TOP_H / 2 - sideShiftY);
        this._rightSprite.scale.set(1, 1);

        // 确保三个面可见，装配精灵隐藏
        this._topSprite.visible = true;
        this._leftSprite.visible = true;
        this._rightSprite.visible = true;
        if (this._assembledSprite) {
            this._assembledSprite.visible = false;
        }
    }

    /**
     * 销毁此 BlockSprite，释放所有子对象和纹理引用。
     *
     * 覆盖 PIXI.Container.destroy() 以确保所有 Sprite 被正确清理。
     * 调用后此实例不可再使用。
     *
     * @param {object|boolean} [options] - 传递到 PIXI.Container.destroy() 的参数
     */
    destroy(options) {
        this._assembledSprite = null;
        // 销毁时释放引用
        this._topSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);
        this._leftSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);
        this._rightSprite = /** @type {import('pixi.js').Sprite} */ (/** @type {unknown} */ null);

        super.destroy(options);
    }

    // ==================== 异步工厂方法 ====================

    /**
     * 异步创建 BlockSprite 实例（推荐方式）。
     *
     * 与 `new BlockSprite()` 不同，此工厂方法使用 `PIXI.Texture.fromURL()`
     * 等待纹理加载完成再返回，确保精灵创建后立即可见。
     *
     * 修复场景：在 Electron `file://` 环境下，`Texture.from()` 同步返回
     * 1×1 空白占位纹理（w=1, h=1, valid=undefined），导致方块不可见。
     * `Texture.fromURL()` 异步等待图片实际加载完成，返回正确尺寸的纹理。
     *
     * @param {BlockSpriteOptions} [options={}] - 方块配置
     * @returns {Promise<BlockSprite>} 已加载纹理的 BlockSprite 实例
     *
     * @example
     * ```javascript
     * const block = await BlockSprite.create({ blockType: 'grass' });
     * block.setGridPosition(0, 0, 0);
     * renderSystem.layerStack.addToLayer(1, block);
     * ```
     */
    static async create(options = {}) {
        // 等轴变换模式
        if (options.useIsoTransform) {
            return BlockSprite.createWithIsoTransform(options);
        }

        // 1. 先创建实例（构造器会用同步 Texture.from() 设置占位纹理）
        const block = new BlockSprite(options);

        // 2. 用异步方式覆盖加载真实纹理
        const type = block._blockType || options.blockType || 'grass';
        const entry = BLOCK_TEXTURE_MAP[type];

        const topPath   = options.topTexture  || (entry ? entry.top   : MISSING_TEXTURE);
        const leftPath  = options.leftTexture || (entry ? entry.left  : MISSING_TEXTURE);
        const rightPath = options.rightTexture|| (entry ? entry.right : MISSING_TEXTURE);

        await block._loadTexturesAsync(topPath, leftPath, rightPath);

        return block;
    }

    /**
     * 异步创建等轴变换后的 BlockSprite 实例（推荐方式）。
     *
     * 此工厂方法：
     * 1. 加载三面 16×16 源纹理（通过 HTMLImageElement）
     * 2. 执行等轴变换管道（顶面旋转+压缩，侧面剪切）
     * 3. 装配三面为等轴布局
     * 4. 可选地生成整块装配纹理
     *
     * 与普通 `create()` 的区别：
     * - 输出的是经过等轴透视变换的纹理（顶面为菱形，侧面为平行四边形）
     * - 而非 1:1 原始正方形纹理
     *
     * @param {BlockSpriteOptions & { useAssembled?: boolean }} [options={}]
     *     若为 true，则使用 `assembleBlock()` 生成的整块纹理作为单个 Sprite；
     *     若为 false（默认），则保持三面独立 Sprite 但布局为等轴装配位。
     * @returns {Promise<BlockSprite>} 等轴变换后的 BlockSprite 实例
     *
     * @example
     * ```javascript
     * // 三面独立模式（默认）
     * const block = await BlockSprite.createWithIsoTransform({
     *     blockType: 'grass'
     * });
     *
     * // 单精灵装配模式
     * const block2 = await BlockSprite.createWithIsoTransform({
     *     blockType: 'stone',
     *     useAssembled: true
     * });
     *
     * block.setGridPosition(0, 0, 0);
     * renderSystem.layerStack.addToLayer(1, block);
     * ```
     */
    static async createWithIsoTransform(options = {}) {
        const { useAssembled = false, ...rest } = options;

        // 1. 先创建基本实例（构造器用占位纹理）
        const block = new BlockSprite({ ...rest, useIsoTransform: true });
        const type = block._blockType || rest.blockType || 'grass';
        const entry = BLOCK_TEXTURE_MAP[type];

        // 2. 确定三面贴图路径
        const topPath   = rest.topTexture  || (entry ? entry.top   : MISSING_TEXTURE);
        const leftPath  = rest.leftTexture || (entry ? entry.left  : MISSING_TEXTURE);
        const rightPath = rest.rightTexture|| (entry ? entry.right : MISSING_TEXTURE);

        // 3. 加载并执行等轴变换
        const { imageDataFromUrl } = await import('../utils/ImageDataUtils.mjs');
        try {
            const [topRaw, leftRaw, rightRaw] = await Promise.all([
                imageDataFromUrl(topPath),
                imageDataFromUrl(leftPath),
                imageDataFromUrl(rightPath)
            ]);

            // 4. 执行等轴变换管道
            const topTransformed   = transformTopFace(topRaw, { interpolation: 'nearest' });
            const leftTransformed  = shearToParallelogram(leftRaw, 'left');
            const rightTransformed = shearToParallelogram(rightRaw, 'right');

            if (useAssembled) {
                // 5a. 装配模式：生成整块纹理并使用单精灵
                const assembled = assembleBlock(topTransformed, leftTransformed, rightTransformed);
                block.setAssembledTexture(assembled);
            } else {
                // 5b. 三面模式：分别设置变换后的纹理
                block.setIsoFaces(topTransformed, leftTransformed, rightTransformed);
            }

            log.info(`等轴变换完成: ${type} (${useAssembled ? '装配模式' : '三面模式'})`);
        } catch (/** @type {unknown} */ err) {
            log.warn(`等轴变换失败，降级为原始纹理: ${/** @type {Error} */ (err).message}`);
            // 降级：加载原始纹理不变换
            await block._loadTexturesAsync(topPath, leftPath, rightPath);
        }

        return block;
    }

    // ==================== 内部方法 ====================

    /**
     * 将贴图路径应用到三个面 Sprite（同步方式）。
     *
     * 通过 PIXI.Texture.from() 加载贴图。
     * 警告：在 Electron file:// 环境下可能返回 1×1 空白纹理。
     * 推荐使用静态工厂 BlockSprite.create()。
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

    /**
     * 异步加载三面贴图（推荐方式）。
     *
     * 使用原生 HTMLImageElement 加载图片，再用加载完成的图片创建 PIXI.Texture。
     * 此方法：
     * 1. 不依赖 PIXI.Texture.fromURL()（兼容所有 v8.x CDN 版本）
     * 2. 正确支持 Electron file:// 协议（HTMLImageElement 对 file:// 支持最完善）
     * 3. 使用 5 秒超时，超时后自动降级到同步加载
     *
     * 加载失败时自动回退到 MISSING_TEXTURE 占位纹理，不会抛异常。
     *
     * @private
     * @param {string} topPath  - 顶面贴图路径
     * @param {string} leftPath - 左面贴图路径
     * @param {string} rightPath - 右面贴图路径
     * @returns {Promise<void>}
     */
    async _loadTexturesAsync(topPath, leftPath, rightPath) {
        /** 图片加载超时时间（毫秒） */
        const TIMEOUT_MS = 5000;

        /**
         * 通过 HTML Image 元素异步加载单张图片。
         * @param {string} src - 图片路径
         * @returns {Promise<HTMLImageElement>}
         */
        const loadImage = (src) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                let settled = false;

                const done = (/** @type {Error|null|undefined} */ err) => {
                    if (settled) return;
                    settled = true;
                    if (err) reject(err);
                    else resolve(img);
                };

                img.onload  = () => done(null);
                img.onerror = () => done(new Error(`图片加载失败: ${src}`));
                img.onabort = () => done(new Error(`图片加载被中断: ${src}`));

                // 5 秒超时
                setTimeout(() => {
                    done(new Error(`图片加载超时 (${TIMEOUT_MS}ms): ${src}`));
                }, TIMEOUT_MS);

                img.src = src;
            });
        };

        try {
            // 并行加载三张图片
            const [topImg, leftImg, rightImg] = await Promise.all([
                loadImage(topPath),
                loadImage(leftPath),
                loadImage(rightPath)
            ]);

            // 使用已加载完成的 HTMLImageElement 创建纹理
            // Texture.from(HTMLImageElement) 是同步操作，不会返回空白纹理
            this._topSprite.texture   = PIXI.Texture.from(topImg);
            this._leftSprite.texture  = PIXI.Texture.from(leftImg);
            this._rightSprite.texture = PIXI.Texture.from(rightImg);

            log.info(`三面纹理异步加载成功 (${topPath})`);
            return;
        } catch (/** @type {unknown} */ err) {
            log.warn(`异步图片加载失败，降级为同步纹理加载: ${/** @type {Error} */ (err).message}`);
        }

        // 降级：同步加载（在 file:// 下可能返回 1×1 占位纹理）
        this._applyTexture(topPath, leftPath, rightPath);
    }
}
