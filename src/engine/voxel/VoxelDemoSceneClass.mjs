// @ts-check

/**
 * @fileoverview VoxelDemoScene 的 Scene 子类封装（最小侵入壳类）。
 *
 * 职责：
 * - 接收已构建完成的组件（BlockRenderer、IsoGridOverlay、RenderSystem）
 * - enter(): ECS World 初始化 + 相机定位 + 显示方块 + 绑定键盘输入
 * - update(dt): 驱动 ECS World 更新
 * - exit(): 隐藏方块/网格，销毁 ECS World，清理输入监听
 * - destroy(): 释放网格资源
 *
 * 构建逻辑（VoxelWorld 创建、地形生成、网格扫描、BlockRenderer.buildFromGrid）
 * 仍然保留在 boot.mjs 中，不迁移至此。
 *
 * @module voxel/VoxelDemoSceneClass
 */

import { Scene } from '../scene/Scene.mjs';
import { World } from '../ecs/World.mjs';
import { DemoMovementSystem } from './DemoMovementSystem.mjs';
import { EntityRenderSystem } from './EntityRenderSystem.mjs';
import { InputModule } from '../input/InputModule.mjs';
import { TILE_HALF_W, TILE_HALF_H } from '../render/block/BlockConstants.mjs';

export class VoxelDemoScene extends Scene {
    /**
     * @param {Object} deps
     * @param {import('../render/RenderSystem.mjs').RenderSystem} deps.renderSystem
     * @param {import('../render/BlockRenderer.mjs').BlockRenderer} deps.blockRenderer
     * @param {import('../render/IsoGridOverlay.mjs').IsoGridOverlay|null} [deps.gridOverlay]
     * @param {number} deps.gridWidth
     * @param {number} deps.gridHeight
     */
    constructor({ renderSystem, blockRenderer, gridOverlay, gridWidth, gridHeight }) {
        super('voxel-demo');

        /** @private @type {import('../render/RenderSystem.mjs').RenderSystem} */
        this._renderSystem = renderSystem;

        /** @private @type {import('../render/BlockRenderer.mjs').BlockRenderer} */
        this._blockRenderer = blockRenderer;

        /** @private @type {import('../render/IsoGridOverlay.mjs').IsoGridOverlay|null} */
        this._gridOverlay = gridOverlay ?? null;

        /** @private @type {number} */
        this._gridWidth = gridWidth;

        /** @private @type {number} */
        this._gridHeight = gridHeight;
        /** @private @type {World|null} */ this._world = null;
        /** @private @type {DemoMovementSystem|null} */ this._movementSystem = null;
        /** @private @type {EntityRenderSystem|null} */ this._entityRenderSystem = null;
        /** @private @type {InputModule|null} */ this._inputModule = null;
        /** @private @type {number|null} */ this._playerEntityId = null;
    }

    /**
     * 场景进入：初始化 ECS World + 键盘输入 + 定位相机 + 显示方块。
     * @override
     */
    enter() {
        super.enter();

        // ── 输入系统初始化 ──
        this._inputModule = new InputModule();
        this._inputModule.start();

        // 绑定 WASD + 方向键到移动动作
        this._inputModule.bind('move_up',    { type: 'key', code: 'KeyW' });
        this._inputModule.bind('move_up',    { type: 'key', code: 'ArrowUp' });
        this._inputModule.bind('move_down',  { type: 'key', code: 'KeyS' });
        this._inputModule.bind('move_down',  { type: 'key', code: 'ArrowDown' });
        this._inputModule.bind('move_left',  { type: 'key', code: 'KeyA' });
        this._inputModule.bind('move_left',  { type: 'key', code: 'ArrowLeft' });
        this._inputModule.bind('move_right', { type: 'key', code: 'KeyD' });
        this._inputModule.bind('move_right', { type: 'key', code: 'ArrowRight' });

        console.log('[ECS] 输入系统已初始化: WASD + 方向键绑定到移动动作');

        // ── ECS World 初始化 ──
        this._world = new World();
        this._movementSystem = new DemoMovementSystem(this._inputModule);
        this._world.addSystem(this._movementSystem);

        // 创建 EntityRenderSystem（ECS → 屏幕 Sprite 渲染桥梁）
        this._entityRenderSystem = new EntityRenderSystem(
            this._renderSystem.sceneGraph,
            this._renderSystem.camera
        );
        this._world.addSystem(this._entityRenderSystem);

        // ⚡ 异步预加载实体纹理（不阻塞进入流程）
        // 使用 HTMLImageElement 加载管线，避免 Electron file:// 下 PIXI.Texture.from(url) 返回空白纹理
        this._entityRenderSystem.preloadTextures().catch(err => {
            console.warn('[⚡VoxelDemoScene] 实体纹理预加载失败:', err.message);
        });

        // 创建 3 个测试实体（初始速度均为 0，由键盘输入驱动）
        // 坐标选择在网格中心附近（相机聚焦区域），确保实体在视口内可见
        const e1 = this._world.createEntity();
        this._world.addComponent(e1, 'Position', { gx: 7, gy: 7, wz: 0, type: 'player' });
        this._world.addComponent(e1, 'Velocity', { vx: 0, vy: 0 });

        const e2 = this._world.createEntity();
        this._world.addComponent(e2, 'Position', { gx: 12, gy: 5, wz: 0, type: 'enemy' });
        this._world.addComponent(e2, 'Velocity', { vx: 0, vy: 0 });

        const e3 = this._world.createEntity();
        this._world.addComponent(e3, 'Position', { gx: 3, gy: 10, wz: 0, type: 'npc' });
        this._world.addComponent(e3, 'Velocity', { vx: 0, vy: 0 });

        // ── 保存玩家实体 ID，供相机跟随使用 ──
        this._playerEntityId = e1;

        console.log('[ECS] 演示世界已初始化: 3 个实体 (player/enemy/npc), 3 个系统 (Input + DemoMovement + EntityRender)');

        // ── 相机定位 — 先对准玩家出生点，后续每帧跟随 ──
        const cx = (7 - 7) * TILE_HALF_W;  // player 初始 (7,7)
        const cy = (7 + 7) * TILE_HALF_H;
        this._renderSystem.camera.moveToImmediate(cx, cy);

        // ── 显示方块（网格保持原有可见性状态） ──
        this._blockRenderer.setBlocksVisible(true);
    }

    /**
     * 每帧固定步长更新——驱动输入系统 + ECS World + 相机跟随玩家。
     * @param {number} dt
     * @override
     */
    update(dt) {
        // ⚡ 帧计数器（暴露为公开属性供诊断台读取）
        this.__frameCount = (this.__frameCount || 0) + 1;

        // ⚡ 首次 10 帧专门输出日志，确认 update 管线在运行
        if (this.__frameCount <= 10) {
            console.log(`[⚡VoxelDemoScene] update #${this.__frameCount}: dt=${dt.toFixed(5)}, inputModule=${!!this._inputModule}, world=${!!this._world}`);
        }

        if (this._inputModule) {
            this._inputModule.update();
        }
        if (this._world) {
            this._world.update(dt);
        }
        if (this._inputModule) {
            this._inputModule.endFrame();
        }

        // ── 相机跟随玩家实体 ──
        // 每帧读取玩家 Position 组件，将相机中心对准玩家，确保 WASD 移动始终可见
        if (this._world && this._playerEntityId !== null) {
            const playerPos = this._world.getComponent(this._playerEntityId, 'Position');
            if (playerPos) {
                const cx = (playerPos.gx - playerPos.gy) * TILE_HALF_W;
                const cy = (playerPos.gx + playerPos.gy) * TILE_HALF_H;
                this._renderSystem.camera.moveToImmediate(cx, cy);
            }
        }
    }

    /**
     * 场景退出：销毁 ECS World + 输入系统 + 隐藏方块和网格覆盖层。
     * @override
     */
    exit() {
        // 销毁输入系统（移除 DOM 事件监听，防止泄漏）
        if (this._inputModule) {
            this._inputModule.destroy();
            this._inputModule = null;
        }

        // 销毁 ECS World（会自动移除 Sprite，但 EntityRenderSystem 可能在 destroy 前需要先清理）
        if (this._entityRenderSystem) {
            this._entityRenderSystem.destroy();
            this._entityRenderSystem = null;
        }
        if (this._world) {
            this._world.destroy();
            this._world = null;
            this._movementSystem = null;
            console.log('[ECS] 演示世界已销毁');
        }

        this._blockRenderer.setBlocksVisible(false);
        if (this._gridOverlay) {
            this._gridOverlay.visible = false;
        }
        super.exit();
    }

    /**
     * 场景销毁：释放 ECS World + 输入系统 + 网格覆盖层及相关资源。
     * @override
     */
    destroy() {
        // 确保输入系统被销毁
        if (this._inputModule) {
            this._inputModule.destroy();
            this._inputModule = null;
        }
        // 确保 EntityRenderSystem 清理 Sprite
        if (this._entityRenderSystem) {
            this._entityRenderSystem.destroy();
            this._entityRenderSystem = null;
        }
        // 确保 ECS World 被销毁
        if (this._world) {
            this._world.destroy();
            this._world = null;
            this._movementSystem = null;
        }

        if (this._gridOverlay) {
            try {
                this._gridOverlay.container.removeFromParent();
            } catch (_e) {
                // container 可能已被父节点移除，静默忽略
            }
            this._gridOverlay.destroy();
            this._gridOverlay = null;
        }
        this._blockRenderer = null;
        this._renderSystem = null;
        super.destroy();
    }
}
