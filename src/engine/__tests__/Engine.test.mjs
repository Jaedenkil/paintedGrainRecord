// @ts-check

/**
 * @fileoverview
 * Engine 单元测试
 *
 * 测试覆盖：
 * - 初始状态
 * - init / start / stop / pause / resume 生命周期
 * - 插件注册
 * - 公共 API 暴露（eventBus / loop / time）
 * - destroy 资源释放
 * - 状态机保护
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EngineState } from '../core/Engine.js';
import { EventBus } from '../core/EventBus.js';
import { GameLoop } from '../core/GameLoop.js';

// RAF mock（Engine 启动需要）
let _tickCount = 0;
const MAX_TICKS = 5;

function installRAFMock() {
    let _mockTime = 0;
    global.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => {
        if (_tickCount < MAX_TICKS) {
            _tickCount++;
            _mockTime += 16;
            cb(_mockTime);
        }
        return _tickCount;
    };
    global.cancelAnimationFrame = (/** @type {number} */ id) => {
        // no-op
    };
}

function uninstallRAFMock() {
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
}

describe('Engine - 初始状态', () => {
    /** @type {Engine} */
    let engine;

    before(() => { installRAFMock(); });
    after(() => { uninstallRAFMock(); });

    beforeEach(() => {
        EventBus.getInstance().clear();
        engine = new Engine();
    });

    afterEach(() => {
        engine?.destroy();
    });

    it('初始状态应为 CREATED', () => {
        assert.strictEqual(engine.state, 'created');
        assert.strictEqual(engine.isRunning, false);
        assert.strictEqual(engine.isPaused, false);
        assert.strictEqual(engine.isDestroyed, false);
    });

    it('应暴露 eventBus / loop / time', () => {
        assert.ok(engine.eventBus instanceof EventBus);
        assert.ok(engine.loop instanceof GameLoop);
        assert.ok(engine.time !== undefined);
        assert.strictEqual(typeof engine.time.deltaTime, 'number');
    });

    it('info 应包含引擎名称和版本', () => {
        assert.strictEqual(engine.info.name, 'PaintedGrainEngine');
        assert.strictEqual(typeof engine.info.version, 'string');
    });
});

describe('Engine - 生命周期', () => {
    /** @type {Engine} */
    let engine;
    /** @type {Array<string>} */
    let lifecycleEvents;

    before(() => { installRAFMock(); });
    after(() => { uninstallRAFMock(); });

    beforeEach(() => {
        _tickCount = 0;
        lifecycleEvents = [];
        EventBus.getInstance().clear();
        engine = new Engine();

        // 监听生命周期事件
        EventBus.getInstance().on('engine:init', () => lifecycleEvents.push('init'));
        EventBus.getInstance().on('engine:start', () => lifecycleEvents.push('start'));
        EventBus.getInstance().on('engine:stop', () => lifecycleEvents.push('stop'));
    });

    afterEach(() => {
        engine?.destroy();
        EventBus.getInstance().clear();
    });

    it('init() 应将状态转为 INITIALIZED 并发射 engine:init', () => {
        engine.init();
        assert.strictEqual(engine.state, 'initialized');
        assert.deepStrictEqual(lifecycleEvents, ['init']);
    });

    it('start() 应将状态转为 RUNNING 并发射 engine:start', () => {
        engine.start();
        assert.strictEqual(engine.state, 'running');
        assert.ok(lifecycleEvents.includes('init'), 'start 前应自动 init');
        assert.ok(lifecycleEvents.includes('start'));
    });

    it('stop() 应将状态转为 STOPPED 并发射 engine:stop', () => {
        engine.start();
        engine.stop();
        assert.strictEqual(engine.state, 'stopped');
        assert.ok(lifecycleEvents.includes('stop'));
    });

    it('pause() 应暂停循环并将状态转为 PAUSED', () => {
        engine.start();
        engine.pause();
        assert.strictEqual(engine.state, 'paused');
        assert.strictEqual(engine.isPaused, true);
    });

    it('resume() 应恢复循环并将状态转为 RUNNING', () => {
        engine.start();
        engine.pause();
        engine.resume();
        assert.strictEqual(engine.state, 'running');
        assert.strictEqual(engine.isPaused, false);
    });

    it('在未运行时 pause() 不应生效', () => {
        engine.pause(); // 未 start
        assert.strictEqual(engine.state, 'created');
    });

    it('在未暂停时 resume() 不应生效', () => {
        engine.start();
        engine.resume(); // 未 pause
        assert.strictEqual(engine.state, 'running');
    });

    it('destroy() 后状态应为 DESTROYED，不能再 start', () => {
        engine.destroy();
        assert.strictEqual(engine.state, 'destroyed');
        assert.throws(() => engine.start(), /引擎已销毁/);
    });

    it('多次 destroy() 不应报错', () => {
        engine.destroy();
        engine.destroy(); // 第二次
        assert.strictEqual(engine.state, 'destroyed');
    });
});

describe('Engine - 插件系统', () => {
    /** @type {Engine} */
    let engine;

    before(() => { installRAFMock(); });
    after(() => { uninstallRAFMock(); });

    beforeEach(() => {
        EventBus.getInstance().clear();
        engine = new Engine();
    });

    afterEach(() => {
        engine?.destroy();
        EventBus.getInstance().clear();
    });

    it('use() 应调用插件的 install 方法', () => {
        let installed = false;
        const plugin = {
            name: 'TestPlugin',
            install: (/** @type {Engine} */ eng) => {
                installed = true;
                assert.strictEqual(eng, engine);
            }
        };

        engine.use(plugin);
        assert.strictEqual(installed, true);
    });

    it('不带 install 的插件应抛出 TypeError', () => {
        assert.throws(() => {
            engine.use(/** @type {any} */ ({ name: 'Bad' }));
        }, TypeError);
    });

    it('重复注册同一插件应被忽略', () => {
        let count = 0;
        const plugin = {
            name: 'DupPlugin',
            install: () => { count++; }
        };

        engine.use(plugin);
        engine.use(plugin); // 第二次应被忽略
        assert.strictEqual(count, 1);
    });

    it('插件中应能访问 eventBus 和 loop', () => {
        const plugin = {
            name: 'AccessPlugin',
            install: (/** @type {Engine} */ eng) => {
                assert.ok(eng.eventBus instanceof EventBus);
                assert.ok(eng.loop instanceof GameLoop);
            }
        };

        engine.use(plugin);
    });
});

describe('Engine - 事件总线集成', () => {
    /** @type {Engine} */
    let engine;

    before(() => { installRAFMock(); });
    after(() => { uninstallRAFMock(); });

    beforeEach(() => {
        _tickCount = 0;
        EventBus.getInstance().clear();
        engine = new Engine();
    });

    afterEach(() => {
        engine?.destroy();
        EventBus.getInstance().clear();
    });

    it('engine:tick-end 事件应包含 fps 数据', () => {
        /** @type {Array<any>} */
        const tickData = [];
        engine.eventBus.on('engine:tick-end', (data) => {
            tickData.push(data);
        });

        engine.start();
        // 等几个 tick
        assert.ok(tickData.length > 0, 'tick-end 应被触发');
        for (const data of tickData) {
            assert.ok(typeof data.fps === 'number');
            assert.ok(typeof data.interp === 'number');
        }
    });

    it('engine:start 后 loop 应开始运行', () => {
        engine.start();
        assert.strictEqual(engine.loop.isRunning, true);
    });

    it('engine:stop 后 loop 应停止', () => {
        engine.start();
        engine.stop();
        assert.strictEqual(engine.loop.isRunning, false);
    });
});
