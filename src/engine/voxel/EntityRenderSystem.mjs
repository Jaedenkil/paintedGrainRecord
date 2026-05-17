// @ts-check

/**
 * @fileoverview EntityRenderSystem —— 将 ECS Position 组件可视化为等轴网格上的纹理 Sprite。
 *
 * 查询所有拥有 'Position' 组件的实体，为每个实体创建/维护一个 PIXI.Sprite，
 * 使用相对等轴坐标（与 BlockSprite.setGridPosition 一致）实时定位，
 * 并结合 wz 高度做 Y 偏移与 Z-order 动态排序。
 *
 * 纹理选择基于 Position 组件中的 `type` 字段（player/enemy/npc 等），
 * 通过 ENTITY_TEXTURE_MAP 查找对应纹理路径；无 type 字段时回退到默认草地纹理。
 *
 * ⚡ 纹理加载策略（修复 Electron file:// 下 PIXI.Texture.from(url) 返回 1×1 空白纹理）
 * ─────────────────────────────────────────────
 * - `PIXI.Texture.from(string)` 在 Electron file:// 协议下不可靠，可能返回空白纹理。
 * - 本系统使用异步预加载管线：HTMLImageElement → PIXI.Texture.from(HTMLImageElement)，
 *   与 BlockTextureAssembler.loadTexturesAsync 采用相同已验证路径。
 * - 预加载方法 preloadTextures() 应在首次 update() 前调用（如 Scene.enter() 中触发）。
 * - 若预加载未完成或未调用，_getTexture() 会创建可见的 Canvas 占位纹理（品红色 + 白色 X），
 *   确保实体在运行时始终可见，不会因纹理加载失败而消失。
 *
 * 当实体被销毁时自动移除对应 Sprite。
 *
 * 设计说明：
 * - 这是一个纯渲染 ECS System，不修改任何 Component 数据
 * - 实体对应的 Sprite 添加到 SceneGraph Layer 5（Effects，DYNAMIC 层）
 * - DYNAMIC 层每帧自动按 zIndex 排序，因此无需手动 markDirty
 * - Sprite 使用相对于 CameraContainer 的等轴坐标（不含相机偏移），
 *   相机变换由 Camera2D._applyTransform() 统一在父容器上应用
 * - wz 高度偏移公式：sy -= wz * TILE_H（与 BlockSprite 一致）
 * - 排序键公式：getSortKey(gx, gy, wz) = (gx + gy) * Z_BASE + wz
 * - 纹理映射表可在应用层通过 EntityRenderSystem.ENTITY_TEXTURE_MAP 扩展
 *
 * @module voxel/EntityRenderSystem
 */

import { System } from '../ecs/System.mjs';
import { TILE_H, TILE_HALF_W, TILE_HALF_H } from '../render/block/BlockConstants.mjs';
import { getSortKey } from '../render/SortManager.mjs';

/** 默认实体纹理路径（无 type 字段时的备选）。@type {string} */
const DEFAULT_ENTITY_TEXTURE = 'assets/blocks/grass/grass_005_top.png';

/**
 * 实体类型 → 纹理路径 映射表。
 * 当 Position.type 在此表中时，使用对应纹理；否则使用 DEFAULT_ENTITY_TEXTURE。
 * 应用层可替换此对象以扩展自定义纹理。
 * @type {Object<string, string>}
 */
export const ENTITY_TEXTURE_MAP = {
    player: 'assets/blocks/jade/jade_005_top.png',
    enemy:  'assets/blocks/magma/magma_005_top.png',
    npc:    'assets/blocks/plank/plank_005_top.png'
};

/** SceneGraph 图层：5（Effects 层，DYNAMIC 类型，每帧自动排序） */
const SPRITE_LAYER = 5;

/** 纹理图片加载超时（毫秒）。 */
const TEXTURE_LOAD_TIMEOUT = 5000;

/**
 * 通过 HTMLImageElement 异步加载单张图片。
 * 与 BlockTextureAssembler 使用相同加载机制，在 Electron file:// 下可靠。
 *
 * @param {string} src - 图片路径
 * @returns {Promise<HTMLImageElement>} 加载完成的图片元素
 * @private
 */
function loadImage(src) {
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

        // 5 秒超时降级
        setTimeout(() => done(new Error(`图片加载超时 (${TEXTURE_LOAD_TIMEOUT}ms): ${src}`)), TEXTURE_LOAD_TIMEOUT);

        img.src = src;
    });
}

export class EntityRenderSystem extends System {
    /**
     * @param {import('../render/SceneGraph.mjs').SceneGraph} sceneGraph
     * @param {import('../render/Camera2D.mjs').Camera2D} camera
     */
    constructor(sceneGraph, camera) {
        super('EntityRender', ['Position']);

        /** @private @type {import('../render/SceneGraph.mjs').SceneGraph} */
        this._sceneGraph = sceneGraph;

        /** @private @type {import('../render/Camera2D.mjs').Camera2D} */
        this._camera = camera;

        /**
         * entityId → { nodeId: number, texturePath: string }
         * @private @type {Map<number, { nodeId: number, texturePath: string }>}
         */
        this._entitySprites = new Map();

        /**
         * 纹理路径 → PIXI.Texture 缓存。
         * 由 preloadTextures() 异步填充，_getTexture() 同步读取。
         * @private @type {Map<string, import('pixi.js').Texture>}
         */
        this._textureCache = new Map();

        /** @private @type {boolean} */
        this._destroyed = false;
        /** @private @type {boolean} */
        this._diagnosed = false;
        /** @private @type {number} */
        this._frameCount = 0;
    }

    /**
     * 异步预加载所有实体纹理。
     *
     * 使用 HTMLImageElement 加载图片（与 BlockTextureAssembler 一致），
     * 避免了 `PIXI.Texture.from(string)` 在 Electron file:// 下返回 1×1 空白纹理的问题。
     *
     * 建议在场景 enter() 阶段触发（fire-and-forget），不阻塞场景进入流程。
     * 预加载完成的纹理将存入 _textureCache，供后续帧的 update() 同步取用。
     *
     * @returns {Promise<void>}
     *
     * @example
     * ```js
     * const sys = new EntityRenderSystem(sceneGraph, camera);
     * sys.preloadTextures(); // fire-and-forget
     * ```
     */
    async preloadTextures() {
        // 收集所有唯一纹理路径
        const paths = [DEFAULT_ENTITY_TEXTURE, ...Object.values(ENTITY_TEXTURE_MAP)];
        const uniquePaths = /** @type {string[]} */ ([...new Set(paths)]);

        const results = await Promise.allSettled(uniquePaths.map(async (path) => {
            if (this._textureCache.has(path)) return;
            const img = await loadImage(path);
            const texture = PIXI.Texture.from(img);
            this._textureCache.set(path, texture);
        }));

        // 统计加载结果
        let loaded = 0;
        let failed = 0;
        for (const r of results) {
            if (r.status === 'fulfilled') loaded++;
            else failed++;
        }
        if (failed > 0) {
            console.warn(`[⚡EntityRender] 纹理预加载: ${loaded} 成功, ${failed} 失败（将使用占位纹理）`);
        } else {
            console.log(`[⚡EntityRender] 纹理预加载完成: ${loaded} 个纹理已缓存`);
        }
    }

    /**
     * 根据纹理路径获取 PIXI.Texture。
     *
     * 优先从 _textureCache 返回已预加载的纹理；
     * 若缓存缺失（预加载未完成或纹理路径不在预加载列表中），
     * 创建可见的 Canvas 占位纹理（品红底 + 白色 X），确保实体始终可见。
     *
     * @param {string} path - 纹理路径
     * @returns {import('pixi.js').Texture} PIXI 纹理对象
     * @private
     */
    _getTexture(path) {
        // 缓存命中
        if (this._textureCache.has(path)) {
            return /** @type {import('pixi.js').Texture} */ (this._textureCache.get(path));
        }

        // 缓存缺失 → 创建可见的 Canvas 占位纹理
        return this._createPlaceholderTexture(path);
    }

    /**
     * 创建可见的 Canvas 占位纹理（品红底 + 白色 X 标记）。
     *
     * 此方法确保即使在纹理预加载失败或未触发时，实体 Sprite 依然可见，
     * 不会出现"实体存在但透明不可见"的诊断结果。
     *
     * 在非浏览器环境（单元测试）中降级为 PIXI.Texture.from(path)。
     *
     * @param {string} path - 纹理路径（仅用于日志和缓存键）
     * @returns {import('pixi.js').Texture} 占位纹理
     * @private
     */
    _createPlaceholderTexture(path) {
        // 非浏览器环境（单元测试），直接使用 PIXI.Texture.from(path)
        // 测试中 PIXI 已被 mock，返回 {frame: path}
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
            const fallback = PIXI.Texture.from(path);
            this._textureCache.set(path, fallback);
            return fallback;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

            // 品红底色（醒目，一眼能看出是占位纹理）
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 16, 16);

            // 白色 X 标记
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(16, 16);
            ctx.moveTo(16, 0); ctx.lineTo(0, 16);
            ctx.stroke();

            const texture = PIXI.Texture.from(canvas);
            this._textureCache.set(path, texture);
            console.warn(`[⚡EntityRender] 纹理未预加载: ${path}，使用 Canvas 占位纹理`);
            return texture;
        } catch (/** @type {unknown} */ _err) {
            // 极端降级：如果 Canvas 创建失败，回退到 PIXI.Texture.from(path)
            const fallback = PIXI.Texture.from(path);
            this._textureCache.set(path, fallback);
            return fallback;
        }
    }

    /**
     * 根据实体类型解析纹理路径。
     * 优先使用 type 字段在 ENTITY_TEXTURE_MAP 中查找，未找到或无 type 时回退默认。
     *
     * @param {{ gx: number, gy: number, wz: number, type?: string }} pos - Position 组件
     * @returns {string} 纹理路径
     * @private
     */
    static _resolveTexturePath(pos) {
        if (pos.type && ENTITY_TEXTURE_MAP[pos.type]) {
            return ENTITY_TEXTURE_MAP[pos.type];
        }
        return DEFAULT_ENTITY_TEXTURE;
    }

    /**
     * 每帧更新：为实体创建/更新 Sprite，移除已销毁实体的 Sprite。
     *
     * @override
     * @param {number[]} entities - 当前拥有 Position 组件的实体 ID 列表
     * @param {number} dt - 固定步长时间增量（秒，未使用）
     */
    update(entities, dt) {
        if (this._destroyed) return;

        // ⚡ 首次运行诊断：打印实体数量与 Sprite 状态
        if (!this._diagnosed) {
            console.log(`[⚡EntityRender] 首次 update: entities=${entities.length}, existingSprites=${this._entitySprites.size}, cachedTextures=${this._textureCache.size}`);
            this._diagnosed = true;
        }

        // ── 1. 构建活跃实体 Set（快速查找） ──
        /** @type {Set<number>} */
        const activeSet = new Set(entities);

        // ── 2. 移除已销毁实体的 Sprite ──
        for (const [entityId, spriteInfo] of this._entitySprites) {
            if (!activeSet.has(entityId)) {
                this._sceneGraph.remove(spriteInfo.nodeId);
                this._entitySprites.delete(entityId);
            }
        }

        // ── 3. 更新/创建所有活跃实体的 Sprite ──
        for (const id of entities) {
            const pos = /** @type {{ gx: number, gy: number, wz: number, type?: string }|null} */ (
                this.world.getComponent(id, 'Position')
            );
            if (!pos) continue;

            // 3a. 新实体 → 创建 PIXI.Sprite，使用 _getTexture 获取纹理（缓存/占位）
            if (!this._entitySprites.has(id)) {
                const texturePath = EntityRenderSystem._resolveTexturePath(pos);
                const texture = this._getTexture(texturePath);
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5, 0.5);

                const nodeId = this._sceneGraph.add(SPRITE_LAYER, sprite, {
                    sortKey: 0,
                    visible: true
                });

                this._entitySprites.set(id, { nodeId, texturePath });
            }

            // 3b. 更新位置：等轴相对坐标 + wz 高度偏移 + 动态 sortKey
            // 注意：使用相对等轴坐标而非 gridToScreen() 的绝对坐标，
            // 因为 Sprite 位于 CameraContainer 内，相机变换由 Camera2D 统一应用，
            // 与 BlockSprite.setGridPosition() 的坐标空间一致。
            const spriteInfo = /** @type {{ nodeId: number }} */ (this._entitySprites.get(id));
            const sx = (pos.gx - pos.gy) * TILE_HALF_W;
            const sy = (pos.gx + pos.gy) * TILE_HALF_H - pos.wz * TILE_H;

            this._sceneGraph.move(spriteInfo.nodeId, sx, sy);

            // ⚡ 诊断：打印前 3 帧的每个实体位置
            if (this._frameCount < 3) {
                console.log(`[⚡EntityRender] entity #${id} type=${pos.type||'default'} gx=${pos.gx.toFixed(1)} gy=${pos.gy.toFixed(1)} → sx=${sx.toFixed(1)} sy=${sy.toFixed(1)}`);
            }

            // 动态排序键：基于 (gx + gy) 主排序 + wz 次级排序
            this._sceneGraph.setSortKey(spriteInfo.nodeId, getSortKey(pos.gx, pos.gy, pos.wz));
        }

        this._frameCount++;
    }

    /** 销毁所有实体 Sprite 并清空内部映射。System 销毁后不可再用。*/
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;

        for (const [, spriteInfo] of this._entitySprites) {
            this._sceneGraph.remove(spriteInfo.nodeId);
        }
        this._entitySprites.clear();
        this._textureCache.clear();
        this._sceneGraph = /** @type {any} */ (null);
        this._camera = /** @type {any} */ (null);
    }
}
