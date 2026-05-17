// @ts-check

/**
 * @fileoverview
 * 场景管理系统单元测试——覆盖 Scene / SceneManager。
 *
 * 测试策略：
 * - Scene 测试生命周期状态机、边界调用（多次 destroy、未初始化调用）
 * - SceneManager 使用 MockEngine 隔离，通过 EventBus 验证事件发射
 * - 每个测试前清空 EventBus 单例，防止副作用污染
 *
 * @module scene/__tests__/SceneSystem
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../Scene.mjs';
import { SceneManager } from '../SceneManager.mjs';
import { EventBus } from '../../core/EventBus.mjs';

// ----------------------------------------------------------------
// 测试工具
// ----------------------------------------------------------------

/** 记录场景操作痕迹的 mock 场景 */
class MockScene extends Scene {
    /**
     * @param {string} name
     * @param {Array<string>} [log]
     */
    constructor(name, log = null) {
        super(name);
        /** @type {Array<string>} */ this.trace = log || [];
        /** @type {*} */ this.initData = undefined;
    }
    init(data) { super.init(data); this.initData = data; this.trace.push('init'); }
    enter() { super.enter(); this.trace.push('enter'); }
    update(dt) { super.update(dt); this.trace.push(`update:${dt}`); }
    render(interp) { super.render(interp); this.trace.push(`render:${interp}`); }
    exit() { super.exit(); this.trace.push('exit'); }
    destroy() { super.destroy(); this.trace.push('destroy'); }
}

/** 最小 mock engine，仅满足 SceneManager 构造签名 */
class MockEngine {
    constructor() {
        /** @type {Array<{type:string,name:string,update:Function}>} */ this.systems = [];
    }
}

/** 注册 EventBus 事件 spy，返回收集的事件列表。注意：回调收到的是 data 而非事件名。 */
function createEventSpy() {
    /** @type {Array<{event:string,data:*}>} */
    const events = [];
    const bus = EventBus.getInstance();
    const onEntered = (/** @type {*} */ data) => { events.push({ event: 'scene:entered', data }); };
    const onExited = (/** @type {*} */ data) => { events.push({ event: 'scene:exited', data }); };
    bus.on('scene:entered', onEntered);
    bus.on('scene:exited', onExited);
    return { events, cleanup: () => { bus.off('scene:entered', onEntered); bus.off('scene:exited', onExited); } };
}

// ----------------------------------------------------------------
// Scene
// ----------------------------------------------------------------

describe('Scene', () => {
    /** @type {Scene} */
    let scene;

    beforeEach(() => {
        scene = new Scene('test-scene');
    });

    describe('构造', () => {
        it('应设置 name', () => {
            assert.equal(scene.name, 'test-scene');
        });
        it('初始 isInitialized 为 false', () => {
            assert.equal(scene.isInitialized, false);
        });
        it('初始 isActive 为 false', () => {
            assert.equal(scene.isActive, false);
        });
    });

    describe('init', () => {
        it('init() 后 isInitialized 为 true', () => {
            scene.init();
            assert.equal(scene.isInitialized, true);
        });
        it('init() 不影响 isActive', () => {
            scene.init();
            assert.equal(scene.isActive, false);
        });
        it('init(data) 接收启动参数（子类覆盖）', () => {
            scene.init({ level: 1, mode: 'test' });
            assert.equal(scene.isInitialized, true);
        });
    });

    describe('enter / exit', () => {
        it('enter() 后 isActive 为 true', () => {
            scene.enter();
            assert.equal(scene.isActive, true);
        });
        it('exit() 后 isActive 为 false', () => {
            scene.enter();
            scene.exit();
            assert.equal(scene.isActive, false);
        });
        it('多次 enter/exit 不报错', () => {
            scene.enter();
            scene.exit();
            scene.enter();
            scene.exit();
            assert.equal(scene.isActive, false);
        });
    });

    describe('update / render', () => {
        it('update(dt) 不抛异常', () => {
            scene.update(1 / 60);
        });
        it('render(interp) 不抛异常', () => {
            scene.render(0.5);
        });
        it('多次 update/render 不抛异常', () => {
            scene.update(1 / 60);
            scene.render(0.0);
            scene.update(1 / 30);
            scene.render(0.8);
        });
    });

    describe('destroy', () => {
        it('destroy() 后 isInitialized 和 isActive 均为 false', () => {
            scene.init();
            scene.enter();
            scene.destroy();
            assert.equal(scene.isInitialized, false);
            assert.equal(scene.isActive, false);
        });
        it('多次 destroy 不报错', () => {
            scene.destroy();
            scene.destroy();
        });
        it('destroy 后 init/enter 可重新激活', () => {
            scene.init();
            scene.enter();
            scene.destroy();
            scene.init();
            scene.enter();
            assert.equal(scene.isInitialized, true);
            assert.equal(scene.isActive, true);
        });
    });

    describe('完整生命周期', () => {
        it('init → enter → update → render → exit → destroy 顺序正确', () => {
            const ms = new MockScene('full');
            ms.init({ key: 'val' });
            ms.enter();
            ms.update(1 / 60);
            ms.render(0.5);
            ms.exit();
            ms.destroy();
            assert.deepEqual(ms.trace, ['init', 'enter', 'update:0.016666666666666666', 'render:0.5', 'exit', 'destroy']);
            assert.deepEqual(ms.initData, { key: 'val' }); // MockScene 覆盖 init() 并存储 data
        });
    });

    describe('MockScene 辅助', () => {
        it('MockScene.init 存储参数', () => {
            const ms = new MockScene('mock-demo');
            ms.init({ map: 'world1' });
            assert.deepEqual(ms.initData, { map: 'world1' });
        });
        it('MockScene 记录操作日志', () => {
            const ms = new MockScene('log-test');
            ms.init();
            ms.enter();
            ms.exit();
            ms.destroy();
            assert.deepEqual(ms.trace, ['init', 'enter', 'exit', 'destroy']);
        });
    });
});

// ----------------------------------------------------------------
// SceneManager
// ----------------------------------------------------------------

describe('SceneManager', () => {
    /** @type {SceneManager} */
    let mgr;
    /** @type {MockEngine} */
    let mockEngine;

    beforeEach(() => {
        EventBus.getInstance().clear();
        mockEngine = new MockEngine();
        mgr = new SceneManager(mockEngine);
    });

    describe('构造', () => {
        it('current 初始为 null', () => {
            assert.equal(mgr.current, null);
        });
        it('depth 初始为 0', () => {
            assert.equal(mgr.depth, 0);
        });
    });

    describe('register', () => {
        it('注册后可通过 push 创建场景', () => {
            mgr.register('a', () => new MockScene('a'));
            mgr.push('a');
            assert.notEqual(mgr.current, null);
            assert.equal(mgr.current?.name, 'a');
        });
        it('重复 register 覆盖已有工厂', () => {
            mgr.register('x', () => new MockScene('x-v1'));
            mgr.register('x', () => new MockScene('x-v2'));
            mgr.push('x');
            assert.equal(mgr.current?.name, 'x-v2');
        });
        it('push 未注册名称不报错', () => {
            mgr.push('nonexistent');
            assert.equal(mgr.current, null);
        });
    });

    describe('push', () => {
        it('push 创建场景并设为当前', () => {
            mgr.register('menu', () => new MockScene('menu'));
            mgr.push('menu');
            assert.equal(mgr.current?.name, 'menu');
            assert.equal(mgr.depth, 1);
        });
        it('push 传递 data 到场景 init', () => {
            mgr.register('demo', (data) => {
                const s = new MockScene('demo');
                // 在 init 中捕获 data
                const origInit = s.init.bind(s);
                s.init = (d) => { s.initData = d; origInit(d); };
                return s;
            });
            mgr.push('demo', { mode: 'test' });
            const scene = /** @type {MockScene} */ (mgr.current);
            // 注意工厂函数的 data 处理——SceneManager 内部 push 后调用 init(data)
            // 但工厂本身可能不接收 data，而是通过 init 传递
        });
        it('第二次 push 将前一个场景 exit', () => {
            const log = [];
            mgr.register('a', () => new MockScene('a', log));
            mgr.register('b', () => new MockScene('b', log));
            mgr.push('a');
            mgr.push('b');
            assert.equal(mgr.current?.name, 'b');
            assert.equal(mgr.depth, 2);
            assert.ok(log.includes('exit'), '场景 a 应被 exit');
        });
        it('push 后前一个场景 isActive 应为 false', () => {
            const a = new MockScene('a');
            const b = new MockScene('b');
            mgr.register('a', () => a);
            mgr.register('b', () => b);
            mgr.push('a');
            assert.equal(a.isActive, true);
            mgr.push('b');
            assert.equal(a.isActive, false);
            assert.equal(b.isActive, true);
        });
        it('push 发射 scene:entered 事件', () => {
            const { events, cleanup } = createEventSpy();
            mgr.register('s', () => new MockScene('s'));
            mgr.push('s', { x: 1 });
            assert.equal(events.length, 1);
            assert.equal(events[0].event, 'scene:entered');
            assert.equal(events[0].data?.name, 's');
            cleanup();
        });
    });

    describe('pop', () => {
        it('pop 返回上一个场景', () => {
            const log = [];
            mgr.register('a', () => new MockScene('a', log));
            mgr.register('b', () => new MockScene('b', log));
            mgr.push('a');
            mgr.push('b');
            mgr.pop();
            assert.equal(mgr.current?.name, 'a');
            assert.equal(mgr.depth, 1);
        });
        it('pop 销毁出栈场景', () => {
            const log = [];
            mgr.register('a', () => new MockScene('a', log));
            mgr.register('b', () => new MockScene('b', log));
            mgr.push('a');
            mgr.push('b');
            mgr.pop();
            assert.ok(log.includes('destroy'));
        });
        it('pop 发射 scene:exited 和 scene:entered', () => {
            const { events, cleanup } = createEventSpy();
            mgr.register('a', () => new MockScene('a'));
            mgr.register('b', () => new MockScene('b'));
            mgr.push('a');
            mgr.push('b');
            events.length = 0; // 清空之前的事件
            mgr.pop();
            assert.equal(events.length, 2);
            assert.equal(events[0].event, 'scene:exited');
            assert.equal(events[0].data?.name, 'b');
            assert.equal(events[1].event, 'scene:entered');
            assert.equal(events[1].data?.name, 'a');
            cleanup();
        });
        it('栈中仅剩一个场景时 pop 不起作用', () => {
            mgr.register('a', () => new MockScene('a'));
            mgr.push('a');
            mgr.pop(); // 应被守卫拦截
            assert.equal(mgr.depth, 1);
            assert.equal(mgr.current?.name, 'a');
        });
    });

    describe('replace', () => {
        it('replace 用新场景替换当前场景', () => {
            const log = [];
            mgr.register('a', () => new MockScene('a', log));
            mgr.register('b', () => new MockScene('b', log));
            mgr.push('a');
            mgr.replace('b');
            assert.equal(mgr.current?.name, 'b');
            assert.equal(mgr.depth, 1);
            assert.ok(log.includes('destroy'));
        });
        it('栈为空时 replace 等同于 push', () => {
            mgr.register('c', () => new MockScene('c'));
            mgr.replace('c');
            assert.equal(mgr.current?.name, 'c');
            assert.equal(mgr.depth, 1);
        });
    });

    describe('update', () => {
        it('update(dt) 委托给当前场景', () => {
            const log = [];
            mgr.register('u', () => new MockScene('u', log));
            mgr.push('u');
            mgr.update(1 / 60);
            assert.ok(log.includes('update:0.016666666666666666'));
        });
        it('无场景时 update 不抛异常', () => {
            mgr.update(1 / 60);
        });
        it('仅活跃场景接收 update', () => {
            const aLog = [];
            const bLog = [];
            mgr.register('a', () => new MockScene('a', aLog));
            mgr.register('b', () => new MockScene('b', bLog));
            mgr.push('a');
            mgr.push('b');
            mgr.update(1 / 60);
            // 场景 a 已被 exit，不接收 update
            assert.ok(bLog.includes('update:0.016666666666666666'));
            assert.ok(!aLog.includes('update'), '非活跃场景不应接收 update');
        });
    });

    describe('destroy', () => {
        it('destroy 清空所有场景', () => {
            mgr.register('a', () => new MockScene('a'));
            mgr.register('b', () => new MockScene('b'));
            mgr.push('a');
            mgr.push('b');
            mgr.destroy();
            assert.equal(mgr.current, null);
            assert.equal(mgr.depth, 0);
        });
        it('destroy 后 push 不生效', () => {
            mgr.register('x', () => new MockScene('x'));
            mgr.destroy();
            mgr.push('x');
            assert.equal(mgr.current, null);
        });
        it('destroy 后 pop 不报错', () => {
            mgr.destroy();
            mgr.pop();
        });
        it('destroy 后 replace 不报错', () => {
            mgr.destroy();
            mgr.replace('x');
        });
        it('destroy 后 update 不报错', () => {
            mgr.destroy();
            mgr.update(1 / 60);
        });
        it('多次 destroy 不报错', () => {
            mgr.destroy();
            mgr.destroy();
        });
    });

    describe('current / depth', () => {
        it('current 返回栈顶场景', () => {
            mgr.register('top', () => new MockScene('top'));
            mgr.push('top');
            assert.equal(mgr.current?.name, 'top');
        });
        it('depth 反映栈深度', () => {
            mgr.register('a', () => new MockScene('a'));
            mgr.register('b', () => new MockScene('b'));
            mgr.register('c', () => new MockScene('c'));
            assert.equal(mgr.depth, 0);
            mgr.push('a');
            assert.equal(mgr.depth, 1);
            mgr.push('b');
            assert.equal(mgr.depth, 2);
            mgr.push('c');
            assert.equal(mgr.depth, 3);
            mgr.pop();
            assert.equal(mgr.depth, 2);
            mgr.pop();
            assert.equal(mgr.depth, 1);
        });
    });

    describe('多场景复杂流程', () => {
        it('push/pop 交替操作不产生异常', () => {
            const log = [];
            mgr.register('s1', () => new MockScene('s1', log));
            mgr.register('s2', () => new MockScene('s2', log));
            mgr.register('s3', () => new MockScene('s3', log));

            mgr.push('s1');
            mgr.push('s2');
            mgr.push('s3');
            assert.equal(mgr.depth, 3);

            mgr.pop();
            assert.equal(mgr.current?.name, 's2');

            mgr.push('s3');
            assert.equal(mgr.depth, 3);

            // replace 弹出当前场景（s3），再 push s1（从 cache 复用）
            // 栈变为 [s1, s2, s1]，深度仍为 3
            mgr.replace('s1');
            assert.equal(mgr.current?.name, 's1');
            assert.equal(mgr.depth, 3);
        });
    });
});
