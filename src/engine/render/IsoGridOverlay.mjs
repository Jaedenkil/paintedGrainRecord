// @ts-check

/**
 * @fileoverview
 * 等轴菱形参考网格（IsoGridOverlay）— 暗金风格菱形网格覆盖层。
 * 架构：Core（状态+绘制） + Highlighter（高亮委托） + Geometry（纯几何） + Theme（色彩常量）。
 * 投影公式：screenX = (gx - gy) * TILE_HALF_W, screenY = (gx + gy) * TILE_HALF_H
 * @module render/IsoGridOverlay
 */

import { computeGrid } from './IsoGridGeometry.mjs';
import { IsoGridHighlighter } from './IsoGridHighlighter.mjs';
import { DEFAULT_GRID_OPTIONS, GOLD_ACCENT, GLOW_ALPHA, GLOW_WIDTH } from './IsoGridTheme.mjs';

/**
 * 等轴菱形参考网格 — PIXI.Graphics 实现的暗金风格覆盖层。
 * 包含辉光层、主线条层、顶点层、中心点层四层绘制。
 */
export class IsoGridOverlay {
    /** @private @type {number} */ _gridW;
    /** @private @type {number} */ _gridH;
    /** @private @type {import('pixi.js').Graphics} */ _graphics;
    /** @private @type {boolean} */ _visible;
    /** @private @type {number} */ _alpha;
    /** @private @type {number} */ _color;
    /** @private @type {number} */ _lineWidth;
    /** @private @type {boolean} */ _showCenterDot;
    /** @private @type {number} */ _centerDotRadius;
    /** @private @type {number} */ _centerDotColor;
    /** @private @type {boolean} */ _showVertexDots;
    /** @private @type {number} */ _vertexDotRadius;
    /** @private @type {number} */ _vertexDotColor;
    /** @private @type {boolean} */ _showGlow;
    /** @private @type {boolean} */ _showAxisLabels;
    /** @private @type {IsoGridHighlighter} */ _highlighter;

    /**
     * @param {number} gridWidth - 网格宽度
     * @param {number} gridHeight - 网格高度
     * @param {Object} [options] - 配置参数（详见 DEFAULT_GRID_OPTIONS）
     */
    constructor(gridWidth, gridHeight, options = {}) {
        this._gridW = gridWidth;
        this._gridH = gridHeight;
        this._visible = options.visible !== false;
        this._alpha = options.alpha ?? DEFAULT_GRID_OPTIONS.alpha;
        this._color = options.color ?? DEFAULT_GRID_OPTIONS.color;
        this._lineWidth = options.lineWidth ?? DEFAULT_GRID_OPTIONS.lineWidth;
        this._showCenterDot = options.showCenterDot === true;
        this._centerDotRadius = options.centerDotRadius ?? DEFAULT_GRID_OPTIONS.centerDotRadius;
        this._centerDotColor = options.centerDotColor ?? DEFAULT_GRID_OPTIONS.centerDotColor;
        this._showVertexDots = options.showVertexDots !== false;
        this._vertexDotRadius = options.vertexDotRadius ?? DEFAULT_GRID_OPTIONS.vertexDotRadius;
        this._vertexDotColor = options.vertexDotColor ?? DEFAULT_GRID_OPTIONS.vertexDotColor;
        this._showGlow = options.showGlow !== false;
        this._showAxisLabels = options.showAxisLabels ?? false;

        this._graphics = new PIXI.Graphics();
        this._graphics.name = 'IsoGridOverlay';
        const hlGraphics = new PIXI.Graphics();
        hlGraphics.name = 'IsoGridOverlay-Highlight';
        this._graphics.addChild(hlGraphics);
        this._highlighter = new IsoGridHighlighter(hlGraphics);
        this._redraw();
    }

    // ==================== 访问器 ====================

    /** PIXI.Graphics 容器 */
    get container() { return this._graphics; }

    /** @returns {boolean} */ get visible() { return this._visible; }
    set visible(v) { if (this._visible !== v) { this._visible = v; this._redraw(); } }

    /** @returns {number} */ get alpha() { return this._alpha; }
    set alpha(a) { if (this._alpha !== a) { this._alpha = a; this._redraw(); } }

    /** @returns {number} */ get color() { return this._color; }
    set color(c) { if (this._color !== c) { this._color = c; this._redraw(); } }

    /** @returns {number} */ get lineWidth() { return this._lineWidth; }
    set lineWidth(w) { if (this._lineWidth !== w) { this._lineWidth = w; this._redraw(); } }

    /** @returns {boolean} */ get showCenterDot() { return this._showCenterDot; }
    set showCenterDot(v) { if (this._showCenterDot !== v) { this._showCenterDot = v; this._redraw(); } }

    /** @returns {boolean} */ get showVertexDots() { return this._showVertexDots; }
    set showVertexDots(v) { if (this._showVertexDots !== v) { this._showVertexDots = v; this._redraw(); } }

    /** @returns {boolean} */ get showGlow() { return this._showGlow; }
    set showGlow(v) { if (this._showGlow !== v) { this._showGlow = v; this._redraw(); } }

    /** @returns {{gx: number, gy: number}|null} */ get highlightedCell() { return this._highlighter.highlightedCell; }

    // ==================== 便捷方法 ====================

    /** @param {boolean} v @returns {this} */ setVisible(v) { this.visible = v; return this; }
    /** @param {number} v @returns {this} */ setAlpha(v) { this.alpha = v; return this; }
    /** @param {number} v @returns {this} */ setColor(v) { this.color = v; return this; }
    /** @param {number} v @returns {this} */ setLineWidth(v) { this.lineWidth = v; return this; }
    /** @param {boolean} v @returns {this} */ setShowCenterDot(v) { this.showCenterDot = v; return this; }
    /** @param {boolean} v @returns {this} */ setShowVertexDots(v) { this.showVertexDots = v; return this; }
    /** @param {boolean} v @returns {this} */ setShowGlow(v) { this.showGlow = v; return this; }

    /** @param {number} gw @param {number} gh @returns {this} */
    resize(gw, gh) { this._gridW = gw; this._gridH = gh; this._redraw(); return this; }

    // ==================== 高亮（委托）====================

    /** @param {number} gx @param {number} gy @returns {this} */
    highlightCell(gx, gy) { this._highlighter.highlightCell(gx, gy, this._color); return this; }

    /** @returns {this} */ clearHighlight() { this._highlighter.clearHighlight(); return this; }

    /** @param {number} gx @param {number} gy @param {number} gz @returns {this} */
    highlightBlockEdges(gx, gy, gz) { this._highlighter.highlightBlockEdges(gx, gy, gz); return this; }

    /** @param {number} gx @param {number} gy @param {Array<{gz: number, blockType: string}>} ci @returns {this} */
    highlightColumn(gx, gy, ci) { this._highlighter.highlightColumn(gx, gy, ci); return this; }

    /** 释放资源。 */
    destroy() {
        this._highlighter.destroy();
        this._highlighter = /** @type {any} */ (null);
        if (this._graphics && !this._graphics._destroyed) {
            this._graphics.destroy({ children: true });
        }
        this._graphics = /** @type {any} */ (null);
    }

    // ==================== 内部 ====================

    /** @private 重绘菱形网格（辉光、主线、顶点、中心点四层）。 */
    _redraw() {
        const g = this._graphics;
        g.clear();
        if (!this._visible) return;

        const { diamonds, vertices } = computeGrid(this._gridW, this._gridH);
        const c = this._color;

        if (this._showGlow) {
            g.setStrokeStyle({ width: GLOW_WIDTH, color: c, alpha: GLOW_ALPHA });
            for (const d of diamonds) { this._diamondPath(g, d); g.stroke(); }
        }
        g.setStrokeStyle({ width: this._lineWidth, color: c, alpha: 1 });
        for (const d of diamonds) { this._diamondPath(g, d); g.stroke(); }

        if (this._showVertexDots && vertices.size > 0) {
            g.setFillStyle({ color: this._vertexDotColor, alpha: 1 });
            for (const key of vertices) {
                const [vx, vy] = key.split(',').map(Number);
                g.circle(vx, vy, this._vertexDotRadius);
                g.fill();
            }
        }
        if (this._showCenterDot) {
            g.setFillStyle({ color: this._centerDotColor, alpha: 1 });
            for (const d of diamonds) { g.circle(d.cx, d.cy, this._centerDotRadius); g.fill(); }
        }
        g.alpha = this._alpha;
    }

    /** @private 绘制菱形路径。@param {import('pixi.js').Graphics} g @param {Object} d */
    _diamondPath(g, d) {
        g.moveTo(d.topX, d.topY);
        g.lineTo(d.rightX, d.rightY);
        g.lineTo(d.bottomX, d.bottomY);
        g.lineTo(d.leftX, d.leftY);
        g.closePath();
    }
}
