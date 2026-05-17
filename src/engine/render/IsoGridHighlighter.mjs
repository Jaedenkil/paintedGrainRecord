// @ts-check

/**
 * @fileoverview
 * IsoGridOverlay 的高亮渲染器 —— 封装所有高亮逻辑。
 *
 * 包含：
 * - 旧版单格高亮（highlightCell / clearHighlight / _redrawHighlight）
 * - 新版三色伪3D轮廓高亮（highlightBlockEdges）
 * - 高度列切片渐变显示（highlightColumn）
 *
 * 使用独立的 PIXI.Graphics 层（_highlightGraphics），叠加在主网格之上。
 *
 * @module render/IsoGridHighlighter
 */

import { BLOCK_TOP_OFFSET } from './block/BlockConstants.mjs';
import { getDiamondVertices, getBlockOutlineVertices, lerpColor } from './IsoGridGeometry.mjs';
import { GOLD_MAIN, GOLD_DARK, GOLD_ACCENT, EDGE_COPPER } from './IsoGridTheme.mjs';

/**
 * IsoGridOverlay 的高亮渲染器。
 */
export class IsoGridHighlighter {
    /** @private @type {import('pixi.js').Graphics} */
    _g;

    /** @private @type {{gx: number, gy: number}|null} */
    _highlightedCell = null;

    /**
     * @param {import('pixi.js').Graphics} highlightGraphics - 高亮层 PIXI.Graphics 实例
     */
    constructor(highlightGraphics) {
        this._g = highlightGraphics;
    }

    /** @returns {{gx: number, gy: number}|null} */
    get highlightedCell() { return this._highlightedCell; }

    // ==================== 旧版单格高亮 ====================

    /**
     * 高亮指定格子的菱形完整边框（旧版）。
     *
     * 使用独立的 _highlightGraphics 层绘制，不影响主网格。
     * 重复调用同一格子幂等（已高亮则跳过）。
     *
     * @param {number} gx
     * @param {number} gy
     * @param {number} [color] - 高亮颜色（默认耀金）
     * @returns {this}
     */
    highlightCell(gx, gy, color) {
        if (this._highlightedCell && this._highlightedCell.gx === gx && this._highlightedCell.gy === gy) {
            return this;
        }
        this._highlightedCell = { gx, gy };
        this._redrawHighlight(color || GOLD_MAIN);
        return this;
    }

    /**
     * 清除当前高亮。
     * @returns {this}
     */
    clearHighlight() {
        if (!this._highlightedCell) return this;
        this._highlightedCell = null;
        if (this._g) this._g.clear();
        return this;
    }

    // ==================== 新版三色伪3D轮廓 ====================

    /**
     * 高亮指定方块的完整可见轮廓，以三种颜色区分棱边类型。
     *
     * 颜色        | 棱边类型                  | 几何边
     * ------------+---------------------------+-------------------
     * 耀金 🟡     | Type 0: 顶面上边缘（参考线） | T→R, L→T
     * 耀金 🟡     | Type 1: 顶面下边缘线       | R→B_diamond, B_diamond→L
     * 点金光 ✨   | Type 2: 垂直面交界棱边      | R→RB, L→LB
     * 铜金 🟠     | Type 3: 垂直面下边缘斜线    | RB→B, B→LB
     *
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @returns {this}
     */
    highlightBlockEdges(gx, gy, gz) {
        this._highlightedCell = { gx, gy };
        const g = this._g;
        if (!g) return this;
        g.clear();

        const v = getDiamondVertices(gx, gy);
        const o = getBlockOutlineVertices(gx, gy);
        const yOff = -gz * BLOCK_TOP_OFFSET;
        const Y = (y) => y + yOff;

        // ── 辉光底衬层 ──
        g.setStrokeStyle({ width: 3, color: GOLD_MAIN, alpha: 0.10 });
        g.moveTo(o.topX, Y(o.topY)); g.lineTo(o.rightX, Y(o.rightY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.topX, Y(o.topY)); g.stroke();

        g.setStrokeStyle({ width: 4, color: GOLD_MAIN, alpha: 0.12 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(v.bottomX, Y(v.bottomY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.leftX, Y(o.leftY)); g.stroke();

        g.setStrokeStyle({ width: 4, color: GOLD_ACCENT, alpha: 0.15 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(o.rbX, Y(o.rbY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.lbX, Y(o.lbY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.botX, Y(o.botY)); g.stroke();

        g.setStrokeStyle({ width: 4, color: EDGE_COPPER, alpha: 0.12 });
        g.moveTo(o.rbX, Y(o.rbY)); g.lineTo(o.botX, Y(o.botY));
        g.moveTo(o.botX, Y(o.botY)); g.lineTo(o.lbX, Y(o.lbY)); g.stroke();

        // ── 清晰描边层 ──
        g.setStrokeStyle({ width: 1.5, color: GOLD_MAIN, alpha: 0.6 });
        g.moveTo(o.topX, Y(o.topY)); g.lineTo(o.rightX, Y(o.rightY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.topX, Y(o.topY)); g.stroke();

        g.setStrokeStyle({ width: 2, color: GOLD_MAIN, alpha: 1 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(v.bottomX, Y(v.bottomY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.leftX, Y(o.leftY)); g.stroke();

        g.setStrokeStyle({ width: 2.5, color: GOLD_ACCENT, alpha: 1 });
        g.moveTo(o.rightX, Y(o.rightY)); g.lineTo(o.rbX, Y(o.rbY));
        g.moveTo(o.leftX, Y(o.leftY)); g.lineTo(o.lbX, Y(o.lbY));
        g.moveTo(v.bottomX, Y(v.bottomY)); g.lineTo(o.botX, Y(o.botY)); g.stroke();

        g.setStrokeStyle({ width: 2, color: EDGE_COPPER, alpha: 1 });
        g.moveTo(o.rbX, Y(o.rbY)); g.lineTo(o.botX, Y(o.botY));
        g.moveTo(o.botX, Y(o.botY)); g.lineTo(o.lbX, Y(o.lbY)); g.stroke();

        // ── 顶点圆点 ──
        g.setFillStyle({ color: GOLD_MAIN, alpha: 1 });
        g.circle(o.rightX, Y(o.rightY), 1.5); g.fill();
        g.circle(v.bottomX, Y(v.bottomY), 1.5); g.fill();
        g.circle(o.leftX, Y(o.leftY), 1.5); g.fill();

        g.setFillStyle({ color: GOLD_ACCENT, alpha: 1 });
        g.circle(o.rbX, Y(o.rbY), 1.5); g.fill();
        g.circle(o.lbX, Y(o.lbY), 1.5); g.fill();

        g.setFillStyle({ color: EDGE_COPPER, alpha: 1 });
        g.circle(o.botX, Y(o.botY), 1.5); g.fill();

        g.setFillStyle({ color: GOLD_MAIN, alpha: 0.6 });
        g.circle(o.topX, Y(o.topY), 1.2); g.fill();

        return this;
    }

    // ==================== 高度列切片 ====================

    /**
     * 高亮指定位置各高度层的方块轮廓（高度列切片）。
     *
     * 颜色从底到顶渐变（GOLD_DARK → GOLD_MAIN → GOLD_ACCENT），
     * 透明度从底到顶递增，帮助玩家直观理解体素世界的垂直结构。
     *
     * @param {number} gx
     * @param {number} gy
     * @param {Array<{gz: number, blockType: string}>} columnInfo - 按 gz 升序排列的列信息
     * @returns {this}
     */
    highlightColumn(gx, gy, columnInfo) {
        if (!columnInfo || columnInfo.length === 0) return this;
        const g = this._g;
        if (!g) return this;

        const v = getDiamondVertices(gx, gy);
        const maxGz = columnInfo[columnInfo.length - 1].gz;
        const minGz = columnInfo[0].gz;
        const gzRange = Math.max(maxGz - minGz, 1);

        for (const entry of columnInfo) {
            const { gz } = entry;
            const yOff = -gz * BLOCK_TOP_OFFSET;
            const t = (gz - minGz) / gzRange;
            const alpha = 0.1 + t * 0.25;
            let color;
            if (t < 0.5) {
                color = lerpColor(GOLD_DARK, GOLD_MAIN, t * 2);
            } else {
                color = lerpColor(GOLD_MAIN, GOLD_ACCENT, (t - 0.5) * 2);
            }

            g.setStrokeStyle({ width: 1.2, color, alpha });
            g.moveTo(v.topX, v.topY + yOff);
            g.lineTo(v.rightX, v.rightY + yOff);
            g.lineTo(v.bottomX, v.bottomY + yOff);
            g.lineTo(v.leftX, v.leftY + yOff);
            g.closePath(); g.stroke();

            g.setFillStyle({ color, alpha: alpha * 0.3 });
            g.moveTo(v.topX, v.topY + yOff);
            g.lineTo(v.rightX, v.rightY + yOff);
            g.lineTo(v.bottomX, v.bottomY + yOff);
            g.lineTo(v.leftX, v.leftY + yOff);
            g.closePath(); g.fill();
        }
        return this;
    }

    // ==================== 内部 ====================

    /**
     * 重绘高亮菱形（耀金线框 + 亮金顶点）。
     * @private
     * @param {number} color
     */
    _redrawHighlight(color) {
        const g = this._g;
        if (!g || !this._highlightedCell) return;
        g.clear();

        const { gx, gy } = this._highlightedCell;
        const v = getDiamondVertices(gx, gy);

        g.setStrokeStyle({ width: 2, color, alpha: 0.8 });
        g.moveTo(v.topX, v.topY);
        g.lineTo(v.rightX, v.rightY);
        g.lineTo(v.bottomX, v.bottomY);
        g.lineTo(v.leftX, v.leftY);
        g.closePath(); g.stroke();

        g.setFillStyle({ color: GOLD_ACCENT, alpha: 1 });
        g.circle(v.topX, v.topY, 1.2); g.fill();
        g.circle(v.rightX, v.rightY, 1.2); g.fill();
        g.circle(v.bottomX, v.bottomY, 1.2); g.fill();
        g.circle(v.leftX, v.leftY, 1.2); g.fill();
    }

    /** 释放 Graphics 引用。 */
    destroy() {
        this._g = null;
        this._highlightedCell = null;
    }
}
