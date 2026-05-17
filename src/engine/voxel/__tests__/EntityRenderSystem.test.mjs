// @ts-check

/**
 * @fileoverview
 * EntityRenderSystem 单元测试 —— 验证 ECS → 屏幕 Sprite 渲染管线的正确性。
 *
 * 测试覆盖：
 * - 构造函数签名校验
 * - update() 为新实体创建 Sprite（PIXI.Sprite，按 type 分配纹理）
 * - 实体类型纹理映射（player/enemy/npc/默认）
 * - 每帧更新 Sprite 位置（相对等轴坐标 + wz 高度偏移）
 * - 每帧更新动态 sortKey（getSortKey 公式）
 * - wz 高度影响 Y 偏移和排序键
 * - 实体被销毁后 Sprite 自动移除
 * - destroy() 清理全部 Sprite
 * - 重复调用 destroy() 安全
 *
 * @module __tests__/EntityRenderSystem
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── PIXI 全局 mock（测试环境无浏览器 PIXI 全局） ──

/**
 * 模拟 PIXI.Sprite 的最小实现
 */
class MockPixiSprite {
    /**
     * @param {any} texture
     */
    constructor(texture) {
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
        this.visible = true;
        this.parent = null;
        this.anchor = { x: 0, y: 0, set: (ax, ay) => { this.anchor.x = ax; this.anchor.y = ay; } };
        /** @type {any} */
        this.texture = texture;
        this._destroyed = false;
    }

    destroy() { this._destroyed = true; }
}

globalThis.PIXI = {
    Sprite: MockPixiSprite,
    /** @param {string} path */
    Texture: {
        from: (path) => ({ frame: path })
    },
    Container: class MockPixiContainer {
        constructor() {
            this.x = 0;
            this.y = 0;
            this.zIndex = 0;
            this.visible = true;
            this.parent = null;
            this._destroyed = false;
        }
        destroy() { this._destroyed = true; }
    }
};

import { World } from '../../ecs/World.mjs';
import { EntityRenderSystem, ENTITY_TEXTURE_MAP } from '../EntityRenderSystem.mjs';
import { getSortKey, Z_BASE } from '../../render/SortManager.mjs';
import { TILE_H, TILE_HALF_W, TILE_HALF_H } from '../../render/block/BlockConstants.mjs';

// ==================== Mocks ====================

/** 模拟 PIXI.Container */
class MockPixiContainer {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
        this.visible = true;
        this.parent = null;
        this._destroyed = false;
    }

    destroy() { this._destroyed = true; }
}

/** 模拟 LayerStack */
class MockLayerStack {
    constructor() {
        /** @type {Array<{ children: MockPixiContainer[] }>} */
        this.layers = [];
        for (let i = 0; i < 8; i++) {
            this.layers.push({ children: [] });
        }
    }

    /** @param {number} _index */
    _validateLayerIndex(_index) { /* no-op */ }

    /**
     * @param {number} layerIndex
     * @param {MockPixiContainer} child
     */
    addToLayer(layerIndex, child) {
        this.layers[layerIndex].children.push(child);
        child.parent = this.layers[layerIndex];
    }

    /**
     * @param {number} layerIndex
     * @param {MockPixiContainer} child
     */
    removeFromLayer(layerIndex, child) {
        const arr = this.layers[layerIndex].children;
        const idx = arr.indexOf(child);
        if (idx !== -1) arr.splice(idx, 1);
        child.parent = null;
    }
}

/** 模拟 SortManager */
class MockSortManager {
    markDirty() { /* no-op */ }
}

/**
 * 轻量 SceneGraph mock。
 * 支持 add/remove/move/setSortKey，追踪每个节点的容器和排序键。
 */
class MockSceneGraph {
    constructor() {
        /** @type {Map<number, { id: number, container: MockPixiContainer, layerIndex: number, visible: boolean, sortKey: number }>} */
        this._nodes = new Map();
        this._nextId = 1;
        this._destroyed = false;
    }

    /**
     * @param {number} layerIndex
     * @param {MockPixiContainer} container
     * @param {{ sortKey?: number, visible?: boolean }} [options]
     * @returns {number}
     */
    add(layerIndex, container, options = {}) {
        if (this._destroyed) return -1;
        const id = this._nextId++;
        const visible = options.visible !== false;
        const sortKey = options.sortKey || 0;
        container.visible = visible;
        container.zIndex = sortKey;
        this._nodes.set(id, { id, container, layerIndex, visible, sortKey });
        return id;
    }

    /**
     * @param {number} id
     * @returns {boolean}
     */
    remove(id) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.container.destroy();
        this._nodes.delete(id);
        return true;
    }

    /**
     * @param {number} id
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    move(id, x, y) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.container.x = x;
        node.container.y = y;
        return true;
    }

    /**
     * 更新渲染对象的排序键。
     * @param {number} id
     * @param {number} sortKey
     * @returns {boolean}
     */
    setSortKey(id, sortKey) {
        if (this._destroyed) return false;
        const node = this._nodes.get(id);
        if (!node) return false;
        node.sortKey = sortKey;
        node.container.zIndex = sortKey;
        return true;
    }

    /** @returns {number} */
    get count() { return this._nodes.size; }

    clear() {
        for (const id of Array.from(this._nodes.keys()).sort((a, b) => b - a)) {
            this.remove(id);
        }
    }

    destroy() {
        this.clear();
        this._nodes.clear();
        this._destroyed = true;
    }
}

/** 模拟 Camera2D（支持 zoom 属性） */
class MockCamera {
    constructor() {
        this._x = 0;
        this._y = 0;
        this._zoom = 1;
        this._viewWidth = 960;
        this._viewHeight = 540;
    }

    get x() { return this._x; }
    get y() { return this._y; }
    get zoom() { return this._zoom; }
    get viewWidth() { return this._viewWidth; }
    get viewHeight() { return this._viewHeight; }

    setPosition(x, y) { this._x = x; this._y = y; }
    setZoom(z) { this._zoom = z; }
    setViewport(w, h) { this._viewWidth = w; this._viewHeight = h; }
}

// ==================== 测试辅助 ====================

/**
 * 创建一个满足 EntityRenderSystem 所需的 mock 依赖集合。
 * @returns {{ sceneGraph: MockSceneGraph, camera: MockCamera }}
 */
function createMocks() {
    return {
        sceneGraph: new MockSceneGraph(),
        camera: new MockCamera()
    };
}

/**
 * 创建 World 并添加指定数量的测试实体（每个实体仅含 Position 组件，无 type 字段）。
 * @param {number} count
 * @returns {World}
 */
function createWorldWithEntities(count) {
    const world = new World();
    for (let i = 0; i < count; i++) {
        const id = world.createEntity();
        world.addComponent(id, 'Position', { gx: i * 2, gy: i * 3, wz: 1 });
    }
    return world;
}

/**
 * 创建 World 并为每个实体指定类型。
 * @param {Array<{ gx: number, gy: number, wz: number, type?: string }>} positions
 * @returns {World}
 */
function createWorldWithTypedEntities(positions) {
    const world = new World();
    for (const pos of positions) {
        const id = world.createEntity();
        world.addComponent(id, 'Position', { ...pos });
    }
    return world;
}

/**
 * 创建 EntityRenderSystem 实例并预填充纹理缓存（使用 mock 纹理）。
 *
 * 在测试环境中，_createPlaceholderTexture() 虽能回退到 PIXI.Texture.from(path)
 * 并返回 {frame: path}，但每次调用都会触发 console.warn。预填充缓存后，
 * _getTexture() 直接命中缓存，测试输出更干净。
 *
 * @param {MockSceneGraph} sceneGraph
 * @param {MockCamera} camera
 * @returns {EntityRenderSystem}
 */
function createSystem(sceneGraph, camera) {
    const sys = new EntityRenderSystem(sceneGraph, camera);
    const allPaths = [
        'assets/blocks/grass/grass_005_top.png',
        ENTITY_TEXTURE_MAP.player,
        ENTITY_TEXTURE_MAP.enemy,
        ENTITY_TEXTURE_MAP.npc
    ];
    for (const path of allPaths) {
        if (!sys._textureCache.has(path)) {
            sys._textureCache.set(path, PIXI.Texture.from(path));
        }
    }
    return sys;
}

// ==================== 正式测试 ====================

describe('EntityRenderSystem', () => {
    describe('构造', () => {
        it('构造函数接受 sceneGraph 和 camera', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            assert.equal(sys.name, 'EntityRender');
            assert.deepEqual(sys.signature, ['Position']);
        });

        it('初始无 Sprite', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            assert.equal(sceneGraph.count, 0);
        });
    });

    describe('update() — Sprite 创建与纹理', () => {
        it('为拥有 Position 的实体创建 PIXI.Sprite', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(2);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 2);

            // 验证所有创建的容器是 Sprite（有 texture 和 anchor 属性）
            for (const [, node] of sceneGraph._nodes) {
                const sprite = /** @type {MockPixiSprite} */ (node.container);
                assert.ok(sprite.texture !== undefined, 'Sprite 应有 texture');
                assert.ok(sprite.anchor !== undefined, 'Sprite 应有 anchor');
                assert.equal(sprite.anchor.x, 0.5, 'anchor.x 应为 0.5');
                assert.equal(sprite.anchor.y, 0.5, 'anchor.y 应为 0.5');
            }
        });

        it('无 type 字段的实体使用默认草地纹理', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1);
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            const sprite = /** @type {MockPixiSprite} */ (node.container);
            // 无 type → 回退到 'assets/blocks/grass/grass_005_top.png'
            assert.equal(sprite.texture.frame, 'assets/blocks/grass/grass_005_top.png');
        });

        it('无 Position 组件的实体不创建 Sprite', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            const id = world.createEntity();
            world.addComponent(id, 'Velocity', { vx: 1, vy: 2 });

            world.update(0.016);
            assert.equal(sceneGraph.count, 0);
        });
    });

    describe('update() — 实体类型纹理映射', () => {
        it('type="player" 的实体使用玩家纹理', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithTypedEntities([
                { gx: 0, gy: 0, wz: 0, type: 'player' }
            ]);
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            const sprite = /** @type {MockPixiSprite} */ (node.container);
            assert.equal(sprite.texture.frame, ENTITY_TEXTURE_MAP.player);
        });

        it('type="enemy" 的实体使用敌人纹理', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithTypedEntities([
                { gx: 1, gy: 1, wz: 0, type: 'enemy' }
            ]);
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            const sprite = /** @type {MockPixiSprite} */ (node.container);
            assert.equal(sprite.texture.frame, ENTITY_TEXTURE_MAP.enemy);
        });

        it('type="npc" 的实体使用 NPC 纹理', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithTypedEntities([
                { gx: 2, gy: 2, wz: 0, type: 'npc' }
            ]);
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            const sprite = /** @type {MockPixiSprite} */ (node.container);
            assert.equal(sprite.texture.frame, ENTITY_TEXTURE_MAP.npc);
        });

        it('多种实体类型在同一世界共存的纹理分配', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithTypedEntities([
                { gx: 0, gy: 0, wz: 0, type: 'player' },
                { gx: 2, gy: 0, wz: 0, type: 'enemy'  },
                { gx: 4, gy: 0, wz: 0, type: 'npc'    },
                { gx: 6, gy: 0, wz: 0 } // 无 type → 默认
            ]);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 4);

            const nodes = Array.from(sceneGraph._nodes.values());

            // 收集每个 Sprite 的纹理路径
            const textures = nodes.map(n => {
                const sprite = /** @type {MockPixiSprite} */ (n.container);
                return sprite.texture.frame;
            });

            assert.ok(textures.includes(ENTITY_TEXTURE_MAP.player), '应有 player 纹理');
            assert.ok(textures.includes(ENTITY_TEXTURE_MAP.enemy),  '应有 enemy 纹理');
            assert.ok(textures.includes(ENTITY_TEXTURE_MAP.npc),    '应有 npc 纹理');
            assert.ok(textures.includes('assets/blocks/grass/grass_005_top.png'), '应有默认纹理');
        });

        it('未知 type 回退到默认草地纹理', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithTypedEntities([
                { gx: 0, gy: 0, wz: 0, type: 'unknown_type' }
            ]);
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            const sprite = /** @type {MockPixiSprite} */ (node.container);
            assert.equal(sprite.texture.frame, 'assets/blocks/grass/grass_005_top.png');
        });
    });

    describe('update() — 位置同步与 wz 高度偏移', () => {
        it('Sprite 位置为相对于 CameraContainer 的等轴坐标 + wz 偏移', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1); // gx=0, gy=0, wz=1
            world.addSystem(sys);

            world.update(0.016);

            const node = sceneGraph._nodes.values().next().value;
            assert.notEqual(node, undefined);

            // 网格原点 (0,0) → 相对等轴坐标：(0-0)*12=0, (0+0)*6=0
            // wz=1 → Y 向上偏移 TILE_H = 16
            // 注意：这是相对于 CameraContainer 的坐标，相机变换由父容器统一应用
            assert.equal(node.container.x, 0);
            assert.equal(node.container.y, 0 - TILE_H);
        });

        it('位置变化后 Sprite 相对坐标同步更新', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            const id = world.createEntity();
            // wz=0 → 无高度偏移
            world.addComponent(id, 'Position', { gx: 0, gy: 0, wz: 0 });

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            assert.equal(node.container.x, 0);
            assert.equal(node.container.y, 0);

            // 修改位置后再次 update
            const pos = world.getComponent(id, 'Position');
            pos.gx = 5;
            pos.gy = 3;

            world.update(0.016);
            // gx=5, gy=3 → sx=(5-3)*TILE_HALF_W=24, sy=(5+3)*TILE_HALF_H=48
            assert.equal(node.container.x, (5 - 3) * TILE_HALF_W);
            assert.equal(node.container.y, (5 + 3) * TILE_HALF_H);
        });

        it('Sprite 使用相对坐标，不受相机位置影响', () => {
            const { sceneGraph, camera } = createMocks();
            camera.setPosition(100, 50);
            camera.setZoom(1);

            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1); // gx=0, gy=0, wz=1
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;

            // 相对坐标不受相机位置影响：gx=0, gy=0 → sx=0, sy=0-TILE_H=-16
            // 相机偏移由 CameraContainer 父容器的 transform 统一应用
            assert.equal(node.container.x, 0);
            assert.equal(node.container.y, 0 - TILE_H);
        });

        it('Sprite 使用相对坐标，不受相机缩放影响', () => {
            const { sceneGraph, camera } = createMocks();
            camera.setZoom(2);

            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1); // gx=0, gy=0, wz=1
            world.addSystem(sys);

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;

            // 相对坐标不受缩放影响：gx=0, gy=0 → sx=0, sy=0-TILE_H=-16
            // 缩放由 CameraContainer 父容器的 scale 统一应用
            assert.equal(node.container.x, 0);
            assert.equal(node.container.y, 0 - TILE_H);
        });

        it('不同 wz 的实体 Y 偏移量不同', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            // 创建三个实体，同一网格位置但不同 wz
            const id0 = world.createEntity();
            world.addComponent(id0, 'Position', { gx: 3, gy: 2, wz: 0 });

            const id1 = world.createEntity();
            world.addComponent(id1, 'Position', { gx: 3, gy: 2, wz: 1 });

            const id2 = world.createEntity();
            world.addComponent(id2, 'Position', { gx: 3, gy: 2, wz: 2 });

            world.update(0.016);

            // 同一 (gx, gy) 但 wz 不同 → Y 坐标应逐层偏移 TILE_H
            const nodes = Array.from(sceneGraph._nodes.values());
            const yValues = nodes.map(n => n.container.y).sort((a, b) => a - b);

            // wz=2 最靠上（Y 最小），wz=0 最靠下（Y 最大）
            // 基准 Y = (3+2)*TILE_HALF_H = 5*6 = 30
            // wz=0: 30, wz=1: 30-16=14, wz=2: 30-32=-2
            const baseY = (3 + 2) * TILE_HALF_H;
            assert.equal(yValues[0], baseY - 2 * TILE_H); // wz=2
            assert.equal(yValues[1], baseY - 1 * TILE_H); // wz=1
            assert.equal(yValues[2], baseY - 0 * TILE_H); // wz=0
        });
    });

    describe('update() — 动态 sortKey (Z-order)', () => {
        it('Sprite 的 zIndex 基于 getSortKey(gx, gy, wz) 公式', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            const id = world.createEntity();
            world.addComponent(id, 'Position', { gx: 3, gy: 5, wz: 2 });

            world.update(0.016);

            const node = sceneGraph._nodes.values().next().value;
            const expectedSortKey = getSortKey(3, 5, 2);
            assert.equal(node.sortKey, expectedSortKey, `sortKey 应为 ${expectedSortKey}`);
            assert.equal(node.container.zIndex, expectedSortKey, `zIndex 应为 ${expectedSortKey}`);
        });

        it('位置变化后 sortKey 动态更新', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            const id = world.createEntity();
            world.addComponent(id, 'Position', { gx: 1, gy: 1, wz: 0 });

            world.update(0.016);
            const node = sceneGraph._nodes.values().next().value;
            assert.equal(node.sortKey, getSortKey(1, 1, 0));

            // 移动后再次 update
            const pos = world.getComponent(id, 'Position');
            pos.gx = 10;
            pos.gy = 7;
            pos.wz = 3;

            world.update(0.016);
            assert.equal(node.sortKey, getSortKey(10, 7, 3));
        });

        it('不同 wz 高度的实体 sortKey 正确区分前后', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            // 同一 (gx, gy) = (5, 5)，wz 递增
            for (let wz = 0; wz < 4; wz++) {
                const id = world.createEntity();
                world.addComponent(id, 'Position', { gx: 5, gy: 5, wz });
            }

            world.update(0.016);

            // 所有 wz 不同，sortKey 应该各不相同
            const nodes = Array.from(sceneGraph._nodes.values());
            const sortKeys = nodes.map(n => n.sortKey);

            for (let wz = 0; wz < 4; wz++) {
                const expected = getSortKey(5, 5, wz);
                assert.ok(sortKeys.includes(expected), `sortKey ${expected} (wz=${wz}) 应存在`);
            }
        });
    });

    describe('update() — 实体销毁后 Sprite 移除', () => {
        it('实体被销毁后对应 Sprite 从 SceneGraph 移除', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(2);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 2);

            const [firstId] = Array.from(world.query('Position'));
            world.destroyEntity(firstId);

            world.update(0.016);
            assert.equal(sceneGraph.count, 1);
        });

        it('全部实体销毁后 Sprite 数量归零', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(3);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 3);

            for (const id of Array.from(world.query('Position'))) {
                world.destroyEntity(id);
            }

            world.update(0.016);
            assert.equal(sceneGraph.count, 0);
        });
    });

    describe('destroy()', () => {
        it('destroy() 后所有 Sprite 被移除', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(3);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 3);

            sys.destroy();
            assert.equal(sceneGraph.count, 0);
        });

        it('destroy() 后 update() 安全无操作', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1);
            world.addSystem(sys);

            world.update(0.016);
            assert.equal(sceneGraph.count, 1);

            sys.destroy();
            world.update(0.016);
            assert.equal(sceneGraph.count, 0);
        });

        it('重复调用 destroy() 安全', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = createSystem(sceneGraph, camera);
            const world = createWorldWithEntities(1);
            world.addSystem(sys);

            world.update(0.016);
            sys.destroy();
            sys.destroy();
            assert.equal(sceneGraph.count, 0);
        });
    });

    describe('System 注册顺序', () => {
        it('EntityRenderSystem 在 DemoMovementSystem 之后更新 → 位置是最新的', () => {
            const { sceneGraph, camera } = createMocks();
            const sys = new EntityRenderSystem(sceneGraph, camera);
            const world = new World();
            world.addSystem(sys);

            const id = world.createEntity();
            world.addComponent(id, 'Position', { gx: 0, gy: 0, wz: 0 });
            world.addComponent(id, 'Velocity', { vx: 3, vy: 5 });

            world.update(0.016);

            assert.equal(sceneGraph.count, 1);

            const node = sceneGraph._nodes.values().next().value;
            // 位置为相对坐标：(0-0)*TILE_HALF_W = 0
            assert.equal(node.container.x, 0);
        });
    });
});
