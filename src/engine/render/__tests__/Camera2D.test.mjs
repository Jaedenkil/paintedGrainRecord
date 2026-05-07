// @ts-check

/**
 * @fileoverview
 * Camera2D 单元测试
 *
 * 测试覆盖：
 * - 初始位置/缩放/旋转
 * - setTarget 指数平滑跟随
 * - setZoom / setZoomImmediate
 * - setRotation
 * - 边界钳位（clamp）
 * - 视口设置
 * - 发射 render:camera-moved 事件
 * - isMoving 状态查询
 *
 * @module render/__tests__/Camera2D.test
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../core/EventBus.mjs';

// ============================================================
// PIXI Container Mock
// ============================================================

class PIXIContainerMock {
    constructor() {
        this.position = { x: 0, y: 0, set: (px, py) => { this.position.x = px; this.position.y = py; } };
        this.scale = { x: 1, y: 1, set: (sx, sy) => { this.scale.x = sx; this.scale.y = sy; } };
        this.rotation = 0;
    }
}

function installPIXIMock() {
    global.PIXI = {
        Container: PIXIContainerMock
    };
}

function uninstallPIXIMock() {
    delete global.PIXI;
}

// ============================================================
// 测试
// ============================================================

describe('Camera2D - 初始状态', () => {
    /** @type {PIXIContainerMock} */
    let container;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(() => {
        EventBus.getInstance().clear();
        container = new PIXIContainerMock();
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('创建时位置应为 (0, 0)，缩放 1.0，旋转 0', async () => {
        const { Camera2D } = await import('../Camera2D.mjs');
        const camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540
        });

        assert.strictEqual(camera.x, 0);
        assert.strictEqual(camera.y, 0);
        assert.strictEqual(camera.zoom, 1.0);
        assert.strictEqual(camera.rotation, 0);
        assert.strictEqual(camera.viewWidth, 960);
        assert.strictEqual(camera.viewHeight, 540);
    });

    it('创建时应对容器应用初始变换', async () => {
        const { Camera2D } = await import('../Camera2D.mjs');
        const camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540
        });

        // 视口中心 (480, 270) - 相机位置 (0,0) * 缩放 1.0
        assert.strictEqual(container.position.x, 480);
        assert.strictEqual(container.position.y, 270);
        assert.strictEqual(container.scale.x, 1.0);
        assert.strictEqual(container.scale.y, 1.0);
    });
});

describe('Camera2D - 平滑跟随', () => {
    /** @type {PIXIContainerMock} */
    let container;
    /** @type {import('../Camera2D.mjs').Camera2D} */
    let camera;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = new PIXIContainerMock();
        const { Camera2D } = await import('../Camera2D.mjs');
        camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540,
            smoothing: 0.1
        });
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('setTarget() 后 update() 应使相机向目标平滑移动', () => {
        camera.setTarget({ x: 100, y: 200 });

        // 第一帧：应向目标方向移动一段距离
        camera.update(0.016);
        const xAfter1 = camera.x;
        const yAfter1 = camera.y;

        assert.ok(xAfter1 > 0, 'x 应向目标移动');
        assert.ok(yAfter1 > 0, 'y 应向目标移动');
        assert.ok(xAfter1 < 100, '尚未到达目标');
    });

    it('多次 update 后相机应逐渐接近目标', () => {
        camera.setTarget({ x: 100, y: 200 });

        // 模拟 60 帧（约 1 秒）
        for (let i = 0; i < 60; i++) {
            camera.update(0.016);
        }

        // 应非常接近目标
        assert.ok(Math.abs(camera.x - 100) < 1, `x 应接近 100，实际: ${camera.x}`);
        assert.ok(Math.abs(camera.y - 200) < 1, `y 应接近 200，实际: ${camera.y}`);
    });

    it('setTarget(null) 应取消跟随', () => {
        // 先跟随到目标
        camera.setTarget({ x: 100, y: 200 });
        for (let i = 0; i < 60; i++) {
            camera.update(0.016);
        }
        assert.ok(Math.abs(camera.x - 100) < 1, '应先到达目标');

        // 取消跟随
        camera.setTarget(null);

        // 记下当前位置
        const xBefore = camera.x;
        const yBefore = camera.y;

        // 再更新几帧，位置应保持不变（因为 target == current）
        for (let i = 0; i < 10; i++) {
            camera.update(0.016);
        }

        assert.strictEqual(camera.x, xBefore, '取消跟随后 x 不应变化');
        assert.strictEqual(camera.y, yBefore, '取消跟随后 y 不应变化');
    });

    it('moveToImmediate() 应瞬间移动相机', () => {
        camera.moveToImmediate(300, 400);

        assert.strictEqual(camera.x, 300);
        assert.strictEqual(camera.y, 400);
    });
});

describe('Camera2D - 缩放与旋转', () => {
    /** @type {PIXIContainerMock} */
    let container;
    /** @type {import('../Camera2D.mjs').Camera2D} */
    let camera;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = new PIXIContainerMock();
        const { Camera2D } = await import('../Camera2D.mjs');
        camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540,
            smoothing: 0.1
        });
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('setZoom() 应设置目标缩放值并平滑过渡', () => {
        camera.setZoom(2.0);
        assert.strictEqual(camera.targetZoom, 2.0);
        // 当前缩放尚未变化（未调用 update）
        assert.strictEqual(camera.zoom, 1.0);
    });

    it('多次 update 后缩放应平滑过渡到目标值', () => {
        camera.setZoom(2.0);
        for (let i = 0; i < 60; i++) {
            camera.update(0.016);
        }
        assert.ok(Math.abs(camera.zoom - 2.0) < 0.01);
    });

    it('setZoomImmediate() 应瞬间设置缩放值', () => {
        camera.setZoomImmediate(2.5);
        assert.strictEqual(camera.zoom, 2.5);
        assert.strictEqual(camera.targetZoom, 2.5);
    });

    it('缩放值应受 min/max 限制', () => {
        camera.setZoom(10.0);
        assert.strictEqual(camera.targetZoom, 3.0); // maxZoom = 3.0

        camera.setZoom(0.1);
        assert.strictEqual(camera.targetZoom, 0.5); // minZoom = 0.5
    });

    it('setRotation() 应设置旋转角度', () => {
        camera.setRotation(Math.PI / 4);
        assert.strictEqual(camera.rotation, Math.PI / 4);
    });
});

describe('Camera2D - 边界钳位', () => {
    /** @type {PIXIContainerMock} */
    let container;
    /** @type {import('../Camera2D.mjs').Camera2D} */
    let camera;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = new PIXIContainerMock();
        const { Camera2D } = await import('../Camera2D.mjs');
        camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540,
            boundaryMin: { x: 0, y: 0 },
            boundaryMax: { x: 2000, y: 1500 }
        });
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('相机不应超出左边界', () => {
        camera.moveToImmediate(-100, 500);
        assert.ok(camera.x >= 0, `x 不应小于 0，实际: ${camera.x}`);
    });

    it('相机不应超出上边界', () => {
        camera.moveToImmediate(500, -100);
        assert.ok(camera.y >= 0, `y 不应小于 0，实际: ${camera.y}`);
    });

    it('相机不应超出右边界', () => {
        camera.moveToImmediate(3000, 500);
        // 右边界限制：2000 - (960/2)/zoom
        assert.ok(camera.x <= 2000, `x 不应超过 2000，实际: ${camera.x}`);
    });

    it('相机不应超出下边界', () => {
        camera.moveToImmediate(500, 2000);
        assert.ok(camera.y <= 1500, `y 不应超过 1500，实际: ${camera.y}`);
    });

    it('地图小于视口时应居中显示', async () => {
        const { Camera2D } = await import('../Camera2D.mjs');
        const smallCamera = new Camera2D(container, {
            viewWidth: 2000,
            viewHeight: 2000,
            boundaryMin: { x: 0, y: 0 },
            boundaryMax: { x: 100, y: 100 }
        });

        // 视口 (2000) > 地图 (100)，应居中
        const centerX = (0 + 100) / 2;
        const centerY = (0 + 100) / 2;
        assert.strictEqual(smallCamera.x, centerX);
        assert.strictEqual(smallCamera.y, centerY);
    });
});

describe('Camera2D - 事件与状态', () => {
    /** @type {PIXIContainerMock} */
    let container;
    /** @type {import('../Camera2D.mjs').Camera2D} */
    let camera;

    before(() => { installPIXIMock(); });
    after(() => { uninstallPIXIMock(); });

    beforeEach(async () => {
        EventBus.getInstance().clear();
        container = new PIXIContainerMock();
        const { Camera2D } = await import('../Camera2D.mjs');
        camera = new Camera2D(container, {
            viewWidth: 960,
            viewHeight: 540
        });
    });

    afterEach(() => {
        EventBus.getInstance().clear();
    });

    it('update() 应发射 render:camera-moved 事件', () => {
        /** @type {Array<any>} */
        const events = [];
        EventBus.getInstance().on('render:camera-moved', (data) => {
            events.push(data);
        });

        camera.update(0.016);

        assert.strictEqual(events.length, 1);
        assert.ok(typeof events[0].x === 'number');
        assert.ok(typeof events[0].zoom === 'number');
    });

    it('isMoving 在位置未到达目标时应返回 true', () => {
        assert.strictEqual(camera.isMoving, false); // 初始状态

        camera.setTarget({ x: 500, y: 500 });
        assert.strictEqual(camera.isMoving, true);
    });

    it('isMoving 在到达目标后应返回 false', () => {
        camera.setTarget({ x: 500, y: 500 });
        // 模拟足够多的帧到达目标
        for (let i = 0; i < 120; i++) {
            camera.update(0.016);
        }
        assert.strictEqual(camera.isMoving, false);
    });

    it('setViewport() 应更新视口尺寸并重新计算变换', () => {
        camera.setViewport(800, 600);
        assert.strictEqual(camera.viewWidth, 800);
        assert.strictEqual(camera.viewHeight, 600);
    });

    it('setBounds() 应更新边界限制', () => {
        camera.setBounds({ x: -100, y: -100 }, { x: 1000, y: 1000 });
        camera.moveToImmediate(-50, -50);
        assert.ok(camera.x >= -100);
        assert.ok(camera.y >= -100);
    });
});
