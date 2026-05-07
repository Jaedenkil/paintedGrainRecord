// @ts-check

/**
 * @fileoverview
 * BlockSprite 2.5D 斜角方块精灵单元测试（T7）
 *
 * 测试覆盖：
 * - 创建 BlockSprite 实例（默认草地方块）
 * - setGridPosition 坐标变换正确性
 * - setGridPosition zIndex 同步正确性
 * - setBlockType 贴图切换
 * - 未知方块类型降级行为
 * - 自定义贴图覆盖
 * - destroy 资源释放
 * - BLOCK_TEXTURE_MAP 完整性验证
 *
 * @module render/__tests__/BlockSprite.test
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// PIXI 全局 Mock（与 RenderSystem.test.mjs 保持一致）
// ============================================================

class PIXIContainerMock {
    constructor() {
        this.children = [];
        this.name = '';
        this.parent = null;
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
        this._destroyed = false;
    }
    addChild(child) {
        this.children.push(child);
        child.parent = this;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parent = null;
            return true;
        }
        return false;
    }
    destroy(options) {
        this._destroyed = true;
        this.children = [];
        this._topSprite = null;
        this._leftSprite = null;
        this._rightSprite = null;
    }
}

class PIXISpriteMock extends PIXIContainerMock {
    constructor() {
        super();
        this.anchor = { x: 0, y: 0, set: (ax, ay) => { this.anchor.x = ax; this.anchor.y = ay; } };
        this._texture = null;
        this.position = { x: 0, y: 0, set: (px, py) => { this.position.x = px; this.position.y = py; } };
        this._textureApplied = false;
    }

    set texture(val) {
        this._texture = val;
        this._textureApplied = true;
    }
    get texture() { return this._texture; }
}

/** @type {Object<string, { path: string, _isMock: boolean }>} */
const textureRegistry = {};

function installPIXIMock() {
    global.PIXI = {
        Container: PIXIContainerMock,
        Sprite: class extends PIXISpriteMock {
            constructor() { super(); }
        },
        Texture: {
            from(path) {
                if (!textureRegistry[path]) {
                    textureRegistry[path] = { path, _isMock: true };
                }
                return textureRegistry[path];
            }
        }
    };
}

function uninstallPIXIMock() {
    delete global.PIXI;
}

// ============================================================
// 测试
// ============================================================

describe('BlockSprite - T7: 创建与基础属性', () => {
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;
    /** @type {typeof import('../BlockSprite.mjs').BLOCK_TEXTURE_MAP} */
    let BLOCK_TEXTURE_MAP;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BlockSprite = mod.BlockSprite;
        BLOCK_TEXTURE_MAP = mod.BLOCK_TEXTURE_MAP;
    });

    it('默认创建草地方块，三个子 Sprite 应存在', () => {
        const block = new BlockSprite();
        assert.ok(block instanceof PIXI.Container);

        // 应包含三个子节点
        assert.strictEqual(block.children.length, 3);

        // 子节点名称正确
        assert.strictEqual(block.children[0].name, 'TopFace');
        assert.strictEqual(block.children[1].name, 'LeftFace');
        assert.strictEqual(block.children[2].name, 'RightFace');

        // 默认类型为 grass
        assert.strictEqual(block.blockType, 'grass');
    });

    it('可指定方块类型创建', () => {
        const block = new BlockSprite({ blockType: 'stone' });
        assert.strictEqual(block.blockType, 'stone');
    });

    it('blockType 访问器返回当前类型', () => {
        const block = new BlockSprite({ blockType: 'dirt' });
        assert.strictEqual(block.blockType, 'dirt');
    });
});

describe('BlockSprite - T7: setGridPosition 坐标变换', () => {
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;
    /** @type {number} */
    let TILE_HALF_W;
    /** @type {number} */
    let TILE_H;
    /** @type {number} */
    let TILE_HALF_H;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BlockSprite = mod.BlockSprite;
        TILE_HALF_W = mod.TILE_HALF_W;
        TILE_H = mod.TILE_H;
        TILE_HALF_H = mod.TILE_HALF_H;
    });

    it('setGridPosition(0, 0, 0) → 屏幕坐标 (0, 0)', () => {
        const block = new BlockSprite();
        block.setGridPosition(0, 0, 0);

        assert.strictEqual(block.x, 0);
        assert.strictEqual(block.y, 0);
    });

    it('setGridPosition(1, 0, 0) → 屏幕坐标 (32, 16)', () => {
        const block = new BlockSprite();
        block.setGridPosition(1, 0, 0);

        // screenX = (1 - 0) * 32 = 32
        // screenY = (1 + 0) * 16 - 0 * 32 = 16
        assert.strictEqual(block.x, TILE_HALF_W);
        assert.strictEqual(block.y, TILE_HALF_H);
    });

    it('setGridPosition(0, 1, 0) → 屏幕坐标 (-32, 16)', () => {
        const block = new BlockSprite();
        block.setGridPosition(0, 1, 0);

        // screenX = (0 - 1) * 32 = -32
        // screenY = (0 + 1) * 16 - 0 * 32 = 16
        assert.strictEqual(block.x, -TILE_HALF_W);
        assert.strictEqual(block.y, TILE_HALF_H);
    });

    it('setGridPosition(3, 5, 0) → 屏幕坐标正确', () => {
        const block = new BlockSprite();
        block.setGridPosition(3, 5, 0);

        // screenX = (3 - 5) * 32 = -64
        // screenY = (3 + 5) * 16 - 0 * 32 = 128
        assert.strictEqual(block.x, -64);
        assert.strictEqual(block.y, 128);
    });

    it('gz 高度层应使方块在屏幕 Y 轴上移', () => {
        const block = new BlockSprite();

        // gz=0 时
        block.setGridPosition(2, 2, 0);
        const y0 = block.y;

        // gz=1 时，应上移 TILE_H 像素
        block.setGridPosition(2, 2, 1);
        assert.strictEqual(block.y, y0 - TILE_H);
    });

    it('gridX/gridY/gridZ 访问器返回当前网格坐标', () => {
        const block = new BlockSprite();
        block.setGridPosition(4, 7, 2);

        assert.strictEqual(block.gridX, 4);
        assert.strictEqual(block.gridY, 7);
        assert.strictEqual(block.gridZ, 2);
    });
});

describe('BlockSprite - T7: zIndex Y-Sort 同步', () => {
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;
    /** @type {number} */
    let Z_BASE;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BlockSprite = mod.BlockSprite;
        Z_BASE = mod.Z_BASE;
    });

    it('setGridPosition(0, 0, 0) → zIndex = 0', () => {
        const block = new BlockSprite();
        block.setGridPosition(0, 0, 0);
        assert.strictEqual(block.zIndex, 0);
    });

    it('zIndex = (gx + gy) * Z_BASE + gz', () => {
        const block = new BlockSprite();
        block.setGridPosition(3, 5, 2);

        // zIndex = (3 + 5) * 100 + 2 = 802
        assert.strictEqual(block.zIndex, 802);
    });

    it('更大 (gx+gy) 的方块有更大的 zIndex', () => {
        const blockA = new BlockSprite();
        const blockB = new BlockSprite();
        blockA.setGridPosition(1, 1, 0); // zIndex = 200
        blockB.setGridPosition(5, 5, 0); // zIndex = 1000

        assert.ok(blockB.zIndex > blockA.zIndex);
    });

    it('相同 (gx+gy) 时，更高 gz 的方块有更大的 zIndex', () => {
        const blockA = new BlockSprite();
        const blockB = new BlockSprite();
        blockA.setGridPosition(2, 2, 0); // zIndex = 400
        blockB.setGridPosition(2, 2, 1); // zIndex = 401

        assert.ok(blockB.zIndex > blockA.zIndex);
    });
});

describe('BlockSprite - T7: setBlockType 贴图切换', () => {
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;
    /** @type {typeof import('../BlockSprite.mjs').BLOCK_TEXTURE_MAP} */
    let BLOCK_TEXTURE_MAP;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BlockSprite = mod.BlockSprite;
        BLOCK_TEXTURE_MAP = mod.BLOCK_TEXTURE_MAP;
    });

    it('设置已知类型应正确加载三面贴图', () => {
        const block = new BlockSprite({ blockType: 'grass' });

        // 验证纹理已通过 PIXI.Texture.from() 加载
        assert.strictEqual(block._topSprite._textureApplied, true);
    });

    it('切换类型后 blockType 访问器更新', () => {
        const block = new BlockSprite({ blockType: 'grass' });
        block.setBlockType('stone');
        assert.strictEqual(block.blockType, 'stone');
    });

    it('未知方块类型降级为 missing 且不抛异常', () => {
        const block = new BlockSprite();
        assert.doesNotThrow(() => {
            block.setBlockType('nonexistent_type_xyz');
        });
        assert.strictEqual(block.blockType, 'missing');
    });

    it('自定义贴图路径应覆盖注册表', () => {
        const block = new BlockSprite();
        block.setBlockType('grass', {
            top: 'custom/top.png',
            left: 'custom/left.png',
            right: 'custom/right.png'
        });

        // 验证使用了自定义路径的纹理
        const topTex = block._topSprite.texture;
        assert.strictEqual(topTex.path, 'custom/top.png');
    });
});

describe('BlockSprite - T7: destroy 资源释放', () => {
    /** @type {typeof import('../BlockSprite.mjs').BlockSprite} */
    let BlockSprite;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BlockSprite = mod.BlockSprite;
    });

    it('destroy() 后子 Sprite 引用置空', () => {
        const block = new BlockSprite();
        block.destroy();

        assert.strictEqual(block._topSprite, null);
        assert.strictEqual(block._leftSprite, null);
        assert.strictEqual(block._rightSprite, null);
    });

    it('多次 destroy() 不应报错', () => {
        const block = new BlockSprite();
        assert.doesNotThrow(() => {
            block.destroy();
            block.destroy();
        });
    });
});

describe('BlockSprite - T7: BLOCK_TEXTURE_MAP 完整性', () => {
    /** @type {typeof import('../BlockSprite.mjs').BLOCK_TEXTURE_MAP} */
    let BLOCK_TEXTURE_MAP;

    before(async () => {
        const mod = await import('../BlockSprite.mjs');
        BLOCK_TEXTURE_MAP = mod.BLOCK_TEXTURE_MAP;
    });

    it('所有注册类型应包含 top/left/right 三个路径', () => {
        for (const [type, paths] of Object.entries(BLOCK_TEXTURE_MAP)) {
            assert.ok(paths.top, `类型 ${type} 缺少 top 路径`);
            assert.ok(paths.left, `类型 ${type} 缺少 left 路径`);
            assert.ok(paths.right, `类型 ${type} 缺少 right 路径`);

            // 路径应包含对应面名
            assert.ok(paths.top.endsWith('_top.png'), `${type}.top 路径后缀错误`);
            assert.ok(paths.left.endsWith('_left.png'), `${type}.left 路径后缀错误`);
            assert.ok(paths.right.endsWith('_right.png'), `${type}.right 路径后缀错误`);
        }
    });

    it('注册类型数量应为 12 种', () => {
        const count = Object.keys(BLOCK_TEXTURE_MAP).length;
        assert.strictEqual(count, 12);
    });
});
