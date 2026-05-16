// @ts-check

/**
 * @fileoverview
 * 等轴菱形参考网格（IsoGridOverlay）— 暗金风格的菱形网格覆盖层。
 *
 * 网格基于与 BlockSprite 相同的等轴投影：
 * ```
 * screenX = (gx - gy) * TILE_HALF_W
 * screenY = (gx + gy) * TILE_HALF_H
 * ```
 *
 * 视觉设计遵循"瘦金体·极简华贵"美学：
 * - 主色：耀金 #d4a847，用于主要网格线
 * - 辅色：暗金 #8b6f3c，用于次要节点
 * - 强调：点金光 #ffd966，用于中心点
 * - 流光效果：底层辉光线条，顶层清晰边框
 * - 像素级精确：所有顶点均为整数坐标，无子像素模糊
 *
 * @module render/IsoGridOverlay
 */

import { TILE_HALF_W, TILE_HALF_H } from './BlockSprite.mjs';
import { BLOCK_TOP_OFFSET } from './block/BlockConstants.mjs';
import { ROTATED_SIZE, TOP_HEIGHT, SIDE_HEIGHT, SRC_SIZE } from '../loader/IsoTextureTransformer.mjs';

// ==================== 色彩常量（瘦金体·极简华贵）====================

/** 耀金 — 主网格线色 */
const GOLD_MAIN = 0xd4a847;

/** 暗金 — 节点色、辅线色 */
const GOLD_DARK = 0x8b6f3c;

/** 点金光 — 高亮中心点 */
const GOLD_ACCENT = 0xffd966;

/** 铜金 — 垂直面下边缘斜线色（暖金偏铜，区别于耀金与暗金） */
const EDGE_COPPER = 0xc9953e;

/** 辉光层透明度 */
const GLOW_ALPHA = 0.12;

/** 辉光层线宽 */
const GLOW_WIDTH = 3;

// ==================== IsoGridOverlay 类 ====================

/**
 * 等轴菱形参考网格 — PIXI.Graphics 实现的暗金风格覆盖层。
 *
 * 包含两层绘制：
 * 1. 辉光层（thick + low alpha）— 模拟墨韵微光
 * 2. 主线条层（thin + crisp）— 清晰金线
 * 3. 节点层（可选）— 菱形顶点暗金点 + 中心点金光点
 *
 * @example
 * ```javascript
 * const grid = new IsoGridOverlay(5, 5);
 * app.stage.addChild(grid.container);
 *
 * // 或自定义参数
 * const custom = new IsoGridOverlay(8, 6, {
 *     color: 0xf0c97d,
 *     alpha: 0.5,
 *     showVertexDots: false
 * });
 * ```
 */
export class IsoGridOverlay {
    /** @private @type {number} */
    _gridW;

    /** @private @type {number} */
    _gridH;

    /** @private @type {import('pixi.js').Graphics} */
    _graphics;

    /** @private @type {boolean} */
    _visible;

    /** @private @type {number} */
    _alpha;

    /** @private @type {number} */
    _color;

    /** @private @type {number} */
    _lineWidth;

    /** @private @type {boolean} */
    _showCenterDot;

    /** @private @type {number} */
    _centerDotRadius;

    /** @private @type {number} */
    _centerDotColor;

    /** @private @type {boolean} */
    _showVertexDots;

    /** @private @type {number} */
    _vertexDotRadius;

    /** @private @type {number} */
    _vertexDotColor;

    /** @private @type {boolean} */
    _showAxisLabels;

    /** @private @type {boolean} */
    _showGlow;

    /** @private @type {import('pixi.js').Graphics|null} 高亮层独立 Graphics */
    _highlightGraphics;

    /** @private @type {{gx: number, gy: number}|null} 当前高亮的格子坐标 */
    _highlightedCell;

    /**
     * @param {number} gridWidth  - 网格宽度（gx 方向格子数）
     * @param {number} gridHeight - 网格高度（gy 方向格子数）
     * @param {Object} [options] - 配置参数
     * @param {boolean} [options.visible=true] - 是否可见
     * @param {number}  [options.alpha=0.35] - 透明度
     * @param {number}  [options.color=0xd4a847] - 线条颜色（耀金）
     * @param {number}  [options.lineWidth=1.5] - 线宽（1.5px 抗斜角锯齿折中）
     * @param {boolean} [options.showCenterDot=false] - 是否显示网格中心点
     * @param {number}  [options.centerDotRadius=1.5] - 中心点半径
     * @param {number}  [options.centerDotColor=0xffd966] - 中心点颜色（点金光）
     * @param {boolean} [options.showVertexDots=true] - 是否显示菱形顶点
     * @param {number}  [options.vertexDotRadius=0.75] - 顶点半径
     * @param {number}  [options.vertexDotColor=0x8b6f3c] - 顶点颜色（暗金）
     * @param {boolean} [options.showGlow=true] - 是否显示辉光层
     * @param {boolean} [options.showAxisLabels=false] - 是否显示坐标轴标签（预留）
     */
    constructor(gridWidth, gridHeight, options = {}) {
        this._gridW = gridWidth;
        this._gridH = gridHeight;

        this._visible = options.visible !== false;
        this._alpha = options.alpha ?? 0.35;
        this._color = options.color ?? GOLD_MAIN;
        this._lineWidth = options.lineWidth ?? 1.5;
        this._showCenterDot = options.showCenterDot === true;
        this._centerDotRadius = options.centerDotRadius ?? 1.5;
        this._centerDotColor = options.centerDotColor ?? GOLD_ACCENT;
        this._showVertexDots = options.showVertexDots !== false;
        this._vertexDotRadius = options.vertexDotRadius ?? 0.75;
        this._vertexDotColor = options.vertexDotColor ?? GOLD_DARK;
        this._showGlow = options.showGlow !== false;
        this._showAxisLabels = options.showAxisLabels ?? false;

        this._graphics = new PIXI.Graphics();
        this._graphics.name = 'IsoGridOverlay';

        // 高亮层独立 Graphics（作为 _graphics 的子对象叠加在网格之上）
        this._highlightGraphics = new PIXI.Graphics();
        this._highlightGraphics.name = 'IsoGridOverlay-Highlight';
        this._graphics.addChild(this._highlightGraphics);

        this._highlightedCell = null;

        this._redraw();
    }

    // ==================== 访问器 ====================

    /** 获取 PIXI.Graphics 容器，用于添加到场景图 */
    get container() {
        return this._graphics;
    }

    /** @returns {boolean} 当前可见性 */
    get visible() {
        return this._visible;
    }

    /** @param {boolean} v */
    set visible(v) {
        if (this._visible === v) return;
        this._visible = v;
        this._redraw();
    }

    /** @returns {number} 当前透明度 */
    get alpha() {
        return this._alpha;
    }

    /** @param {number} a */
    set alpha(a) {
        if (this._alpha === a) return;
        this._alpha = a;
        this._redraw();
    }

    /** @returns {number} 当前线条颜色 */
    get color() {
        return this._color;
    }

    /** @param {number} c - 十六进制颜色值，如 0xd4a847 */
    set color(c) {
        if (this._color === c) return;
        this._color = c;
        this._redraw();
    }

    /** @returns {number} 当前线宽 */
    get lineWidth() {
        return this._lineWidth;
    }

    /** @param {number} w */
    set lineWidth(w) {
        if (this._lineWidth === w) return;
        this._lineWidth = w;
        this._redraw();
    }

    /** @returns {boolean} 是否显示中心点 */
    get showCenterDot() {
        return this._showCenterDot;
    }

    /** @param {boolean} v */
    set showCenterDot(v) {
        if (this._showCenterDot === v) return;
        this._showCenterDot = v;
        this._redraw();
    }

    /** @returns {boolean} 是否显示菱形顶点 */
    get showVertexDots() {
        return this._showVertexDots;
    }

    /** @param {boolean} v */
    set showVertexDots(v) {
        if (this._showVertexDots === v) return;
        this._showVertexDots = v;
        this._redraw();
    }

    /** @returns {boolean} 是否显示辉光层 */
    get showGlow() {
        return this._showGlow;
    }

    /** @param {boolean} v */
    set showGlow(v) {
        if (this._showGlow === v) return;
        this._showGlow = v;
        this._redraw();
    }

    // ==================== 便捷方法 ====================

    /**
     * 设置可见性。
     * @param {boolean} visible
     * @returns {this}
     */
    setVisible(visible) {
        this.visible = visible;
        return this;
    }

    /**
     * 设置透明度。
     * @param {number} alpha - 0~1
     * @returns {this}
     */
    setAlpha(alpha) {
        this.alpha = alpha;
        return this;
    }

    /**
     * 设置线条颜色。
     * @param {number} color - 十六进制颜色值
     * @returns {this}
     */
    setColor(color) {
        this.color = color;
        return this;
    }

    /**
     * 设置线宽。
     * @param {number} width - 像素宽度
     * @returns {this}
     */
    setLineWidth(width) {
        this.lineWidth = width;
        return this;
    }

    /**
     * 切换中心点显示。
     * @param {boolean} show
     * @returns {this}
     */
    setShowCenterDot(show) {
        this.showCenterDot = show;
        return this;
    }

    /**
     * 切换顶点显示。
     * @param {boolean} show
     * @returns {this}
     */
    setShowVertexDots(show) {
        this.showVertexDots = show;
        return this;
    }

    /**
     * 切换辉光层。
     * @param {boolean} show
     * @returns {this}
     */
    setShowGlow(show) {
        this.showGlow = show;
        return this;
    }

    /**
     * 更新网格尺寸并重绘。
     * @param {number} gridWidth
     * @param {number} gridHeight
     * @returns {this}
     */
    resize(gridWidth, gridHeight) {
        this._gridW = gridWidth;
        this._gridH = gridHeight;
        this._redraw();
        return this;
    }

    // ==================== 单格高亮（旧版菱形完整边框） ====================

    /**
     * 高亮指定格子的菱形完整边框（旧版）。
     *
     * 使用独立的 _highlightGraphics 层绘制，不影响主网格。
     * 重复调用同一格子幂等（已高亮则跳过）。
     * 新的 hover 反馈请使用 {@link highlightBlockEdges} + {@link highlightColumn}。
     *
     * @param {number} gx - 格子 X 坐标
     * @param {number} gy - 格子 Y 坐标
     * @returns {this}
     *
     * @example
     * ```javascript
     * gridOverlay.highlightCell(2, 3);
     * ```
     */
    highlightCell(gx, gy) {
        if (this._highlightedCell &&
            this._highlightedCell.gx === gx &&
            this._highlightedCell.gy === gy) {
            return this; // 幂等：同一格子不重复绘制
        }
        this._highlightedCell = { gx, gy };
        this._redrawHighlight();
        return this;
    }

    /**
     * 清除当前高亮。
     * 移除高亮层绘制的所有内容（包括金角描边和列切片）。
     *
     * @returns {this}
     *
     * @example
     * ```javascript
     * gridOverlay.clearHighlight();
     * ```
     */
    clearHighlight() {
        if (!this._highlightedCell) return this;
        this._highlightedCell = null;
        if (this._highlightGraphics) {
            this._highlightGraphics.clear();
        }
        return this;
    }

    // ==================== 新 hover 视觉：三色边缘线（伪 3D 轮廓）+ 高度列切片 ====================

    /**
     * 高亮指定方块的完整可见轮廓，以三种颜色区分棱边类型。
     *
     * 所有棱边按结构角色分为 4 组（3 种关键类型 + 1 组参考线）：
     *
     *   颜色        | 棱边类型                  | 几何边
     *   ------------+---------------------------+-------------------
     *   耀金 🟡     | Type 0: 顶面上边缘（参考线） | T→R, L→T
     *   耀金 🟡     | Type 1: 顶面下边缘线       | R→B_diamond, B_diamond→L
     *   点金光 ✨   | Type 2: 垂直面交界棱边      | R→RB, L→LB
     *   铜金 🟠     | Type 3: 垂直面下边缘斜线    | RB→B, B→LB
     *
     * 绘制策略：每种类型独立绘制（辉光底衬 + 清晰描边），
     * 同类型的对称边合并在一个 stroke 调用中，减少绘制开销。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {number} gz - 网格 Z 坐标（高度层，用于垂直偏移）
     * @returns {this}
     *
     * @example
     * ```javascript
     * gridOverlay.highlightBlockEdges(3, 2, 1);
     * ```
     */
    highlightBlockEdges(gx, gy, gz) {
        this._highlightedCell = { gx, gy };

        const g = this._highlightGraphics;
        if (!g) return this;
        g.clear();

        const v = this._getDiamondVertices(gx, gy);
        const o = this._getBlockOutlineVertices(gx, gy);
        const yOff = -gz * BLOCK_TOP_OFFSET;
        const Y = (y) => y + yOff;

        // ════════════════════════════════════════════════════════════
        // 辉光底衬层（粗线 + 低透明度）
        // ════════════════════════════════════════════════════════════

        // ── 顶面轮廓（T→R→B_diamond→L→T）: GOLD_MAIN 耀金 ──
        g.setStrokeStyle({ width: 3, color: GOLD_MAIN, alpha: 0.10 });
        g.moveTo(o.topX, Y(o.topY)); g.lineTo(o.rightX, Y(o.rightY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.topX, Y(o.topY));
        g.stroke();

        // ── Type 1: 顶面下边缘线（顶面与垂直面交界）: GOLD_MAIN 耀金 ──
        g.setStrokeStyle({ width: 4, color: GOLD_MAIN, alpha: 0.12 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(v.bottomX, Y(v.bottomY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.leftX, Y(o.leftY));
        g.stroke();

        // ── Type 2: 垂直面交界棱边: GOLD_ACCENT 点金光 ──
        g.setStrokeStyle({ width: 4, color: GOLD_ACCENT, alpha: 0.15 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(o.rbX, Y(o.rbY));       // 右垂直面外棱
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.lbX, Y(o.lbY));         // 左垂直面外棱
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.botX, Y(o.botY));   // 两垂直面接触线（中心棱）
        g.stroke();

        // ── Type 3: 垂直面下边缘斜线: EDGE_COPPER 铜金 ──
        g.setStrokeStyle({ width: 4, color: EDGE_COPPER, alpha: 0.12 });
        g.moveTo(o.rbX, Y(o.rbY)); g.lineTo(o.botX, Y(o.botY));
        g.moveTo(o.botX, Y(o.botY)); g.lineTo(o.lbX, Y(o.lbY));
        g.stroke();

        // ════════════════════════════════════════════════════════════
        // 清晰描边层（细线 + 高透明度）
        // ════════════════════════════════════════════════════════════

        // ── 顶面轮廓（T→R→B_diamond→L→T）: GOLD_MAIN 耀金 ──
        g.setStrokeStyle({ width: 1.5, color: GOLD_MAIN, alpha: 0.6 });
        g.moveTo(o.topX, Y(o.topY)); g.lineTo(o.rightX, Y(o.rightY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.topX, Y(o.topY));
        g.stroke();

        // ── Type 1: 顶面下边缘线: GOLD_MAIN 耀金 ──
        g.setStrokeStyle({ width: 2, color: GOLD_MAIN, alpha: 1 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(v.bottomX, Y(v.bottomY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.leftX, Y(o.leftY));
        g.stroke();

        // ── Type 2: 垂直面交界棱边: GOLD_ACCENT 点金光 ──
        g.setStrokeStyle({ width: 2.5, color: GOLD_ACCENT, alpha: 1 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(o.rbX, Y(o.rbY));       // 右垂直面外棱
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.lbX, Y(o.lbY));         // 左垂直面外棱
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.botX, Y(o.botY));   // 两垂直面接触线（中心棱）
        g.stroke();

        // ── Type 3: 垂直面下边缘斜线: EDGE_COPPER 铜金 ──
        g.setStrokeStyle({ width: 2, color: EDGE_COPPER, alpha: 1 });
        g.moveTo(o.rbX, Y(o.rbY)); g.lineTo(o.botX, Y(o.botY));
        g.moveTo(o.botX, Y(o.botY)); g.lineTo(o.lbX, Y(o.lbY));
        g.stroke();

        // ════════════════════════════════════════════════════════════
        // 顶点圆点（按类型分色标记关键端点）
        // ════════════════════════════════════════════════════════════

        // Type 1 端点（R, B_diamond, L）— 耀金
        g.setFillStyle({ color: GOLD_MAIN, alpha: 1 });
        g.circle(o.rightX, Y(o.rightY), 1.5); g.fill();
        g.circle(v.bottomX, Y(v.bottomY), 1.5); g.fill();
        g.circle(o.leftX, Y(o.leftY), 1.5); g.fill();

        // Type 2 端点（RB, LB）— 点金光
        g.setFillStyle({ color: GOLD_ACCENT, alpha: 1 });
        g.circle(o.rbX, Y(o.rbY), 1.5); g.fill();
        g.circle(o.lbX, Y(o.lbY), 1.5); g.fill();

        // Type 3 端点（B 底部中点）— 铜金
        g.setFillStyle({ color: EDGE_COPPER, alpha: 1 });
        g.circle(o.botX, Y(o.botY), 1.5); g.fill();

        // 顶部顶点 T — 耀金（顶面轮廓统一）
        g.setFillStyle({ color: GOLD_MAIN, alpha: 0.6 });
        g.circle(o.topX, Y(o.topY), 1.2); g.fill();

        return this;
    }

    /**
     * 高亮指定位置各高度层的方块轮廓（高度列切片）。
     *
     * 对 columnInfo 中的每一层 gz 绘制半透明菱形轮廓，
     * 颜色从底到顶渐变（深褐→暗金→耀金），
     * 透明度从底到顶递增（底部朦胧，顶部清晰），
     * 帮助玩家直观理解体素世界的垂直结构。
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @param {Array<{gz: number, blockType: string}>} columnInfo -
     *     该列的方块信息数组（由 BlockGridManager.getColumnInfo() 返回），
     *     按 gz 升序排列
     * @returns {this}
     *
     * @example
     * ```javascript
     * const col = grid.getColumnInfo(3, 2);
     * gridOverlay.highlightColumn(3, 2, col);
     * ```
     */
    highlightColumn(gx, gy, columnInfo) {
        if (!columnInfo || columnInfo.length === 0) return this;

        const g = this._highlightGraphics;
        if (!g) return this;

        const v = this._getDiamondVertices(gx, gy);
        const maxGz = columnInfo[columnInfo.length - 1].gz;
        const minGz = columnInfo[0].gz;
        const gzRange = Math.max(maxGz - minGz, 1); // 防除零

        // 从底部往上绘制，确保上层覆盖下层（PIXI 无深度但绘制顺序决定覆盖）
        for (const entry of columnInfo) {
            const { gz } = entry;
            const yOff = -gz * BLOCK_TOP_OFFSET;

            // 计算渐变：t ∈ [0, 1]，底部→顶部
            const t = (gz - minGz) / gzRange;

            // 透明度：底部 0.1 → 顶部 0.35
            const alpha = 0.1 + t * 0.25;

            // 颜色插值：GOLD_DARK(0x8b6f3c) → GOLD_MAIN(0xd4a847) → GOLD_ACCENT(0xffd966)
            let color;
            if (t < 0.5) {
                // 底部段：GOLD_DARK → GOLD_MAIN
                const t2 = t * 2;
                color = this._lerpColor(GOLD_DARK, GOLD_MAIN, t2);
            } else {
                // 顶部段：GOLD_MAIN → GOLD_ACCENT
                const t2 = (t - 0.5) * 2;
                color = this._lerpColor(GOLD_MAIN, GOLD_ACCENT, t2);
            }

            // 绘制半透明菱形轮廓
            g.setStrokeStyle({ width: 1.2, color, alpha });
            g.moveTo(v.topX, v.topY + yOff);
            g.lineTo(v.rightX, v.rightY + yOff);
            g.lineTo(v.bottomX, v.bottomY + yOff);
            g.lineTo(v.leftX, v.leftY + yOff);
            g.closePath();
            g.stroke();

            // 半透明填充（极淡，仅增加空间感）
            g.setFillStyle({ color, alpha: alpha * 0.3 });
            g.moveTo(v.topX, v.topY + yOff);
            g.lineTo(v.rightX, v.rightY + yOff);
            g.lineTo(v.bottomX, v.bottomY + yOff);
            g.lineTo(v.leftX, v.leftY + yOff);
            g.closePath();
            g.fill();
        }

        return this;
    }

    // ==================== 颜色工具 ====================

    /**
     * 线性插值两个十六进制颜色。
     *
     * @private
     * @param {number} colorA - 起始颜色（十六进制，如 0x8b6f3c）
     * @param {number} colorB - 终止颜色（十六进制，如 0xffd966）
     * @param {number} t - 插值因子 [0, 1]
     * @returns {number} 插值后的十六进制颜色
     *
     * @example
     * ```javascript
     * const mid = overlay._lerpColor(0x8b6f3c, 0xffd966, 0.5);
     * // → 0xc5a351
     * ```
     */
    _lerpColor(colorA, colorB, t) {
        const rA = (colorA >> 16) & 0xff;
        const gA = (colorA >> 8) & 0xff;
        const bA = colorA & 0xff;

        const rB = (colorB >> 16) & 0xff;
        const gB = (colorB >> 8) & 0xff;
        const bB = colorB & 0xff;

        const r = Math.round(rA + (rB - rA) * t);
        const g = Math.round(gA + (gB - gA) * t);
        const b = Math.round(bA + (bB - bA) * t);

        return (r << 16) | (g << 8) | b;
    }

    /**
     * 释放 Graphics 资源。
     */
    destroy() {
        this._highlightGraphics = null;
        this._highlightedCell = null;
        if (this._graphics && !this._graphics._destroyed) {
            this._graphics.destroy({ children: true });
        }
        this._graphics = /** @type {any} */ (null);
    }

    // ==================== 内部方法 ====================

    /**
     * 计算单个菱形格子的四个顶点坐标（等轴投影屏幕坐标）。
     *
     * 复用与 _computeGrid 相同的投影公式，但仅计算单个格子：
     * ```
     * screenX = (gx - gy) * TILE_HALF_W    // 菱形中心 X
     * screenY = (gx + gy) * TILE_HALF_H    // 菱形中心 Y
     * ```
     *
     * @private
     * @param {number} gx - 格子 X 坐标
     * @param {number} gy - 格子 Y 坐标
     * @returns {{ topX: number, topY: number, rightX: number, rightY: number,
     *            bottomX: number, bottomY: number, leftX: number, leftY: number }}
     *
     * @example
     * ```javascript
     * const v = overlay._getDiamondVertices(2, 3);
     * // v.topX    = (2-3)*12    = -12
     * // v.topY    = (2+3)*6 - 6 =  24
     * ```
     */
    _getDiamondVertices(gx, gy) {
        const cx = (gx - gy) * TILE_HALF_W;
        const cy = (gx + gy) * TILE_HALF_H;
        const HW = ROTATED_SIZE / 2; // 12
        const HH = TOP_HEIGHT / 2;   //  6

        return {
            topX: cx,         topY: cy - HH,
            rightX: cx + HW,  rightY: cy,
            bottomX: cx,      bottomY: cy + HH,
            leftX: cx - HW,   leftY: cy
        };
    }

    /**
     * 获取方块完整六边形轮廓的六个顶点坐标。
     *
     * 在等轴投影中，一个方块的可见部分由三个面组成：
     * - 顶面（菱形）：顶点 T(top), R(right), B_diamond(bottom), L(left)
     * - 右侧面：从 R 沿右棱边向下至 RB，再沿底边至 B(center-bottom)
     * - 左侧面：从 L 沿左棱边向下至 LB，再沿底边至 B(center-bottom)
     *
     * 六边形顶点顺序（顺时针）：
     *   T (top) → R (right) → RB (right-bottom) → B (center-bottom) → LB (left-bottom) → L (left)
     *
     * 底部 Y 坐标的剪切校正：
     *
     * shearToParallelogram() 在源纹理范围外使用透明（continue 跳过），
     * 所以侧裟纹理的可见区域并非填满整个 12×21 矩形：
     *
     * ┌─ 左面（anchor=1,0, pos=0,0）──────────────────────────────┐
     * │ 左边缘 ox=0（x=-12）：iy=oy，可见 oy∈[0, SRC_SIZE-1]      │
     * │ → 底部边界在 oy = SRC_SIZE = 16                           │
     * │ 右边缘 ox=11（x=0）：iy=oy-SHEAR_OFFSET，可见至 oy=20     │
     * │ → 底部边界在 oy = SIDE_HEIGHT = 21（sprite 底边）         │
     * └──────────────────────────────────────────────────────────┘
     *
     * ┌─ 右面（anchor=0,0, pos=0,0）──────────────────────────────┐
     * │ 左边缘 ox=0（x=0）：iy=oy-SHEAR_OFFSET，可见至 oy=20     │
     * │ → 底部边界在 oy = SIDE_HEIGHT = 21                       │
     * │ 右边缘 ox=11（x=12）：iy=oy，可见 oy∈[0, SRC_SIZE-1]     │
     * │ → 底部边界在 oy = SRC_SIZE = 16                          │
     * └──────────────────────────────────────────────────────────┘
     *
     * 因此底部形成 V 形：
     *   LB(-12, 16) ──→ bot(0, 21) ←── RB(12, 16)
     *   左面底边从左到右斜向下  ✓
     *   右面底边从右到左斜向下  ✓
     *
     * @param {number} gx - 网格 X 坐标
     * @param {number} gy - 网格 Y 坐标
     * @returns {{ topX: number, topY: number, rightX: number, rightY: number,
     *            rbX: number, rbY: number, botX: number, botY: number,
     *            lbX: number, lbY: number, leftX: number, leftY: number }}
     *
     * @example
     * ```javascript
     * const o = overlay._getBlockOutlineVertices(2, 3);
     * // o.topX = (2-3)*12     = -12
     * // o.topY = (2+3)*6 - 6  =  24
     * // o.rbX  = (2-3)*12+12  =  0
     * // o.rbY  = (2+3)*6 + 16 =  46  (SRC_SIZE)
     * // o.botX = (2-3)*12     =  0
     * // o.botY = (2+3)*6 + 21 =  51  (SIDE_HEIGHT)
     * // o.lbX  = (2-3)*12-12  = -12
     * // o.lbY  = (2+3)*6 + 16 =  46  (SRC_SIZE)
     * ```
     */
    _getBlockOutlineVertices(gx, gy) {
        const cx = (gx - gy) * TILE_HALF_W;
        const cy = (gx + gy) * TILE_HALF_H;
        const HW = ROTATED_SIZE / 2; // 12
        const HH = TOP_HEIGHT / 2;   //  6

        return {
            // 顶面菱形顶点
            topX: cx,         topY: cy - HH,            // T
            rightX: cx + HW,  rightY: cy,               // R
            leftX: cx - HW,   leftY: cy,                // L
            // 右侧面底部顶点（源纹理边界 SRC_SIZE=16）
            rbX: cx + HW,     rbY: cy + SRC_SIZE,       // RB
            // 底部中点（sprite 底边 SIDE_HEIGHT=21）
            botX: cx,         botY: cy + SIDE_HEIGHT,   // B
            // 左侧面底部顶点（源纹理边界 SRC_SIZE=16）
            lbX: cx - HW,     lbY: cy + SRC_SIZE        // LB
        };
    }

    /**
     * 重绘高亮菱形（耀金线框 + 亮金顶点）。
     *
     * 绘制内容写入 _highlightGraphics 独立层，不影响主网格。
     * 高亮样式：
     * - 线宽 2px，alpha 0.8，使用当前 color（耀金）
     * - 四个顶点用 GOLD_ACCENT（点金光）圆点标记
     *
     * @private
     */
    _redrawHighlight() {
        const g = this._highlightGraphics;
        if (!g) return;
        g.clear();

        if (!this._highlightedCell) return;

        const { gx, gy } = this._highlightedCell;
        const v = this._getDiamondVertices(gx, gy);
        const color = this._color;

        // 高亮线框（略粗 + 高 alpha）
        g.setStrokeStyle({ width: 2, color, alpha: 0.8 });
        g.moveTo(v.topX, v.topY);
        g.lineTo(v.rightX, v.rightY);
        g.lineTo(v.bottomX, v.bottomY);
        g.lineTo(v.leftX, v.leftY);
        g.closePath();
        g.stroke();

        // 四个顶点的亮金圆点
        g.setFillStyle({ color: GOLD_ACCENT, alpha: 1 });
        g.circle(v.topX, v.topY, 1.2);
        g.fill();
        g.circle(v.rightX, v.rightY, 1.2);
        g.fill();
        g.circle(v.bottomX, v.bottomY, 1.2);
        g.fill();
        g.circle(v.leftX, v.leftY, 1.2);
        g.fill();
    }

    /**
     * 预计算所有菱形顶点的坐标集合（去重）。
     *
     * 相邻菱形共享边和顶点，通过 Set 去重确保每个顶点只绘制一次，
     * 避免 pixel doubling 造成的亮度不均。
     *
     * @private
     * @returns {{ diamonds: Array<{cx: number, cy: number, topX: number, topY: number, rightX: number, rightY: number, bottomX: number, bottomY: number, leftX: number, leftY: number}>, vertices: Set<string> }}
     */
    _computeGrid() {
        const DIA_HALF_W = ROTATED_SIZE / 2; // 12
        const DIA_HALF_H = TOP_HEIGHT / 2;   //  6
        const STEP_W = TILE_HALF_W;           // 12
        const STEP_H = TILE_HALF_H;           //  6

        /** @type {Array<{cx: number, cy: number, topX: number, topY: number, rightX: number, rightY: number, bottomX: number, bottomY: number, leftX: number, leftY: number}>} */
        const diamonds = [];
        const vertices = new Set();

        for (let gy = 0; gy < this._gridH; gy++) {
            for (let gx = 0; gx < this._gridW; gx++) {
                const cx = (gx - gy) * STEP_W;
                const cy = (gx + gy) * STEP_H;

                const topX    = cx;
                const topY    = cy - DIA_HALF_H;
                const rightX  = cx + DIA_HALF_W;
                const rightY  = cy;
                const bottomX = cx;
                const bottomY = cy + DIA_HALF_H;
                const leftX   = cx - DIA_HALF_W;
                const leftY   = cy;

                diamonds.push({ cx, cy, topX, topY, rightX, rightY, bottomX, bottomY, leftX, leftY });

                // 收集顶点（字符串化去重）
                vertices.add(`${topX},${topY}`);
                vertices.add(`${rightX},${rightY}`);
                vertices.add(`${bottomX},${bottomY}`);
                vertices.add(`${leftX},${leftY}`);
            }
        }

        return { diamonds, vertices };
    }

    /**
     * 重绘菱形网格（暗金风格双层绘制 + 节点点缀）。
     *
     * 渲染顺序：
     * 1. 辉光层（粗线低透明度）— 模拟金箔墨韵
     * 2. 主线条层（细线清晰）— 耀金网格线
     * 3. 菱形顶点（暗金小点）— 节点衔接
     * 4. 中心点（点金光）— 网格定位
     *
     * 透明度统一由 `_graphics.alpha` 控制，内部绘制均使用 alpha=1。
     *
     * @private
     */
    _redraw() {
        const g = this._graphics;
        g.clear();

        if (!this._visible) return;

        const { diamonds, vertices } = this._computeGrid();
        const color = this._color;

        // ========== 第 1 层：辉光层（金色流光底层） ==========
        if (this._showGlow) {
            g.setStrokeStyle({
                width: GLOW_WIDTH,
                color,
                alpha: GLOW_ALPHA
            });

            for (const d of diamonds) {
                g.moveTo(d.topX, d.topY);
                g.lineTo(d.rightX, d.rightY);
                g.lineTo(d.bottomX, d.bottomY);
                g.lineTo(d.leftX, d.leftY);
                g.closePath();
                g.stroke();
            }
        }

        // ========== 第 2 层：主线条层（清晰耀金网格线） ==========
        g.setStrokeStyle({
            width: this._lineWidth,
            color,
            alpha: 1
        });

        for (const d of diamonds) {
            g.moveTo(d.topX, d.topY);
            g.lineTo(d.rightX, d.rightY);
            g.lineTo(d.bottomX, d.bottomY);
            g.lineTo(d.leftX, d.leftY);
            g.closePath();
            g.stroke();
        }

        // ========== 第 3 层：菱形顶点（暗金小点） ==========
        if (this._showVertexDots && vertices.size > 0) {
            g.setFillStyle({ color: this._vertexDotColor, alpha: 1 });

            for (const key of vertices) {
                const [vx, vy] = key.split(',').map(Number);
                g.circle(vx, vy, this._vertexDotRadius);
                g.fill();
            }
        }

        // ========== 第 4 层：网格中心点（点金光） ==========
        if (this._showCenterDot) {
            g.setFillStyle({ color: this._centerDotColor, alpha: 1 });

            for (const d of diamonds) {
                g.circle(d.cx, d.cy, this._centerDotRadius);
                g.fill();
            }
        }

        // 透明度统一由 Graphics 容器 alpha 控制
        g.alpha = this._alpha;
    }

}
