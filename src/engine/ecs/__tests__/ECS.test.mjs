// @ts-check

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { World, EntityManager, ComponentManager, System } from '../index.mjs';

// ════════════════════════════════════════
// EntityManager
// ════════════════════════════════════════

describe('EntityManager', () => {
    describe('构造', () => {
        it('初始 alive 为 0', () => {
            const em = new EntityManager();
            assert.equal(em.alive, 0);
        });
        it('activeEntities 初始为空', () => {
            const em = new EntityManager();
            assert.equal(em.activeEntities.size, 0);
        });
    });

    describe('create', () => {
        it('创建实体返回递增 ID', () => {
            const em = new EntityManager();
            assert.equal(em.create(), 1);
            assert.equal(em.create(), 2);
            assert.equal(em.create(), 3);
        });
        it('创建后 alive 递增', () => {
            const em = new EntityManager();
            em.create();
            em.create();
            assert.equal(em.alive, 2);
        });
        it('创建后的 ID 出现在 activeEntities 中', () => {
            const em = new EntityManager();
            const id = em.create();
            assert.ok(em.activeEntities.has(id));
        });
    });

    describe('destroy', () => {
        it('销毁后 alive 递减', () => {
            const em = new EntityManager();
            const id = em.create();
            em.destroy(id);
            assert.equal(em.alive, 0);
        });
        it('销毁后 ID 不在 activeEntities 中', () => {
            const em = new EntityManager();
            const id = em.create();
            em.destroy(id);
            assert.ok(!em.activeEntities.has(id));
        });
        it('ID 被回收复用', () => {
            const em = new EntityManager();
            const id1 = em.create();
            const id2 = em.create();
            em.destroy(id1);
            assert.equal(em.create(), id1); // 复用
        });
        it('重复销毁不报错', () => {
            const em = new EntityManager();
            const id = em.create();
            em.destroy(id);
            em.destroy(id); // 不应抛异常
            assert.equal(em.alive, 0);
        });
        it('销毁不存在的 ID 不报错', () => {
            const em = new EntityManager();
            em.destroy(999); // 不应抛异常
        });
    });

    describe('reset', () => {
        it('reset 后 alive 归零', () => {
            const em = new EntityManager();
            em.create();
            em.create();
            em.reset();
            assert.equal(em.alive, 0);
        });
        it('reset 后 ID 从 1 重新开始', () => {
            const em = new EntityManager();
            em.create();
            em.create();
            em.reset();
            assert.equal(em.create(), 1);
        });
    });
});

// ════════════════════════════════════════
// ComponentManager
// ════════════════════════════════════════

describe('ComponentManager', () => {
    /** @type {ComponentManager} */
    let cm;

    before(() => { cm = new ComponentManager(); });
    after(() => { cm.reset(); });

    describe('add / get', () => {
        it('添加组件后可通过 get 获取', () => {
            cm.add(1, 'Position', { x: 10, y: 20 });
            const pos = cm.get(1, 'Position');
            assert.deepEqual(pos, { x: 10, y: 20 });
        });
        it('更新组件数据（同一实体 + 同一类型）', () => {
            cm.add(1, 'Position', { x: 100, y: 200 });
            const pos = cm.get(1, 'Position');
            assert.equal(pos.x, 100);
        });
        it('不同实体可拥有相同组件类型', () => {
            cm.add(2, 'Position', { x: 1, y: 2 });
            assert.equal(cm.get(2, 'Position').x, 1);
            assert.equal(cm.get(1, 'Position').x, 100);
        });
        it('获取不存在的组件返回 null', () => {
            assert.equal(cm.get(999, 'Nonexistent'), null);
        });
        it('获取不存在的组件类型返回 null', () => {
            assert.equal(cm.get(1, 'Nope'), null);
        });
    });

    describe('has', () => {
        it('拥有组件返回 true', () => {
            assert.ok(cm.has(1, 'Position'));
        });
        it('不拥有组件返回 false', () => {
            assert.ok(!cm.has(2, 'Velocity'));
        });
        it('不存在的组件类型返回 false', () => {
            assert.ok(!cm.has(1, 'Fake'));
        });
    });

    describe('remove', () => {
        it('移除后 has 返回 false', () => {
            cm.add(10, 'Temp', { val: 42 });
            cm.remove(10, 'Temp');
            assert.ok(!cm.has(10, 'Temp'));
        });
        it('移除不存在的组件不报错', () => {
            cm.remove(999, 'Ghost'); // 不应抛异常
        });
    });

    describe('removeEntity', () => {
        it('移除实体的所有组件', () => {
            cm.add(20, 'A', { v: 1 });
            cm.add(20, 'B', { v: 2 });
            cm.add(21, 'A', { v: 3 });
            cm.removeEntity(20);
            assert.ok(!cm.has(20, 'A'));
            assert.ok(!cm.has(20, 'B'));
            assert.ok(cm.has(21, 'A')); // 其他实体不受影响
        });
        it('移除不存在的实体不报错', () => {
            cm.removeEntity(999);
        });
    });

    describe('query', () => {
        it('空签名返回空数组', () => {
            assert.deepEqual(cm.query(), []);
        });
        it('查询单组件返回所有拥有者', () => {
            const result = cm.query('Position');
            assert.ok(result.includes(1));
            assert.ok(result.includes(2));
        });
        it('查询多组件返回交集', () => {
            cm.add(1, 'Velocity', { vx: 5, vy: 0 });
            cm.add(30, 'Position', { x: 0, y: 0 });
            cm.add(30, 'Velocity', { vx: 1, vy: 2 });
            const result = cm.query('Position', 'Velocity');
            assert.ok(result.includes(1));
            assert.ok(result.includes(30));
            assert.ok(!result.includes(2)); // 只有 Position，没有 Velocity
        });
        it('查询不存在的组件类型返回空数组', () => {
            assert.deepEqual(cm.query('NonExistent'), []);
        });
    });

    describe('getAll', () => {
        it('返回指定类型的所有实例', () => {
            const all = cm.getAll('Position');
            assert.ok(all.size >= 3);
        });
        it('不存在的类型返回空 Map', () => {
            const all = cm.getAll('FakeType');
            assert.equal(all.size, 0);
        });
    });

    describe('stats', () => {
        it('返回正确的统计信息', () => {
            const s = cm.stats;
            assert.ok(s.typeCount > 0);
            assert.ok(s.totalInstances > 0);
        });
    });

    describe('reset', () => {
        it('reset 后存储清空', () => {
            const cm2 = new ComponentManager();
            cm2.add(1, 'X', {});
            cm2.reset();
            assert.equal(cm2.stats.typeCount, 0);
            assert.equal(cm2.stats.totalInstances, 0);
        });
    });
});

// ════════════════════════════════════════
// System
// ════════════════════════════════════════

describe('System', () => {
    describe('构造', () => {
        it('设置 name 和 signature', () => {
            const sys = new System('Move', ['Position', 'Velocity']);
            assert.equal(sys.name, 'Move');
            assert.deepEqual(sys.signature, ['Position', 'Velocity']);
        });
        it('signature 被冻结', () => {
            const sys = new System('M', ['A']);
            assert.ok(Object.isFrozen(sys.signature));
        });
        it('world 初始为 null', () => {
            const sys = new System('Test', []);
            assert.equal(sys.world, null);
        });
        it('空的 signature 不报错', () => {
            const sys = new System('Empty', []);
            assert.deepEqual(sys.signature, []);
        });
    });

    describe('update', () => {
        it('默认 update 不抛异常', () => {
            const sys = new System('Noop', ['X']);
            sys.update([], 0.016);
        });
    });
});

// ════════════════════════════════════════
// World（集成测试）
// ════════════════════════════════════════

describe('World', () => {
    /** @type {World} */
    let world;

    before(() => { world = new World(); });
    after(() => { world.destroy(); });

    describe('实体管理', () => {
        it('createEntity 返回递增 ID', () => {
            const w = new World();
            assert.equal(w.createEntity(), 1);
            assert.equal(w.createEntity(), 2);
            w.destroy();
        });
        it('entityCount 反映活跃实体数', () => {
            const e1 = world.createEntity();
            const e2 = world.createEntity();
            assert.equal(world.entityCount, 2);
            world.destroyEntity(e1);
            assert.equal(world.entityCount, 1);
            world.destroyEntity(e2);
            assert.equal(world.entityCount, 0);
        });
        it('destroyEntity 清除所有组件', () => {
            const e = world.createEntity();
            world.addComponent(e, 'HP', { current: 100 });
            world.destroyEntity(e);
            assert.equal(world.getComponent(e, 'HP'), null);
        });
    });

    describe('组件管理', () => {
        it('addComponent / getComponent 读写', () => {
            const e = world.createEntity();
            world.addComponent(e, 'HP', { current: 100, max: 100 });
            const hp = world.getComponent(e, 'HP');
            assert.equal(hp.current, 100);
            world.destroyEntity(e);
        });
        it('hasComponent 检测', () => {
            const e = world.createEntity();
            world.addComponent(e, 'Tag', {});
            assert.ok(world.hasComponent(e, 'Tag'));
            assert.ok(!world.hasComponent(e, 'Missing'));
            world.destroyEntity(e);
        });
        it('removeComponent 移除', () => {
            const e = world.createEntity();
            world.addComponent(e, 'Temp', { v: 1 });
            world.removeComponent(e, 'Temp');
            assert.ok(!world.hasComponent(e, 'Temp'));
            world.destroyEntity(e);
        });
        it('query 返回交集', () => {
            const e1 = world.createEntity();
            const e2 = world.createEntity();
            const e3 = world.createEntity();
            world.addComponent(e1, 'Pos', { x: 0, y: 0 });
            world.addComponent(e1, 'Vel', { vx: 1, vy: 0 });
            world.addComponent(e2, 'Pos', { x: 1, y: 1 });
            world.addComponent(e3, 'Vel', { vx: 2, vy: 2 });
            const result = world.query('Pos', 'Vel');
            assert.ok(result.includes(e1));
            assert.ok(!result.includes(e2)); // 无 Vel
            assert.ok(!result.includes(e3)); // 无 Pos
            world.destroyEntity(e1);
            world.destroyEntity(e2);
            world.destroyEntity(e3);
        });
    });

    describe('系统管理', () => {
        it('addSystem 后系统出现在 systems 列表中', () => {
            const sys = new System('Test', []);
            world.addSystem(sys);
            assert.equal(world.systems.length, 1);
            assert.equal(world.systems[0].name, 'Test');
            world.removeSystem(sys);
        });
        it('addSystem 自动设置 system.world', () => {
            const sys = new System('Auto', []);
            world.addSystem(sys);
            assert.equal(sys.world, world);
            world.removeSystem(sys);
            assert.equal(sys.world, null);
        });
        it('重复 addSystem 不重复添加', () => {
            const sys = new System('Dup', []);
            world.addSystem(sys);
            world.addSystem(sys);
            assert.equal(world.systems.length, 1);
            world.removeSystem(sys);
        });
        it('removeSystem 移除指定系统', () => {
            const s1 = new System('S1', []);
            const s2 = new System('S2', []);
            world.addSystem(s1);
            world.addSystem(s2);
            world.removeSystem(s1);
            assert.equal(world.systems.length, 1);
            assert.equal(world.systems[0].name, 'S2');
            world.removeSystem(s2);
        });
    });

    describe('系统更新', () => {
        it('update 调用系统的 update 方法（匹配实体）', () => {
            const calls = [];
            class TestSys extends System {
                constructor() { super('TestSys', ['Marker']); }
                update(entities, dt) {
                    calls.push({ entities: [...entities], dt });
                }
            }
            const sys = new TestSys();
            world.addSystem(sys);

            const e1 = world.createEntity();
            world.addComponent(e1, 'Marker', {});
            const e2 = world.createEntity();
            world.addComponent(e2, 'Marker', {});

            world.update(0.016);

            assert.equal(calls.length, 1);
            assert.equal(calls[0].entities.length, 2);
            assert.ok(calls[0].entities.includes(e1));
            assert.ok(calls[0].entities.includes(e2));
            assert.equal(calls[0].dt, 0.016);

            world.destroyEntity(e1);
            world.destroyEntity(e2);
            world.removeSystem(sys);
        });

        it('不匹配签名的实体不被处理', () => {
            const processed = [];
            class SelectiveSys extends System {
                constructor() { super('Selective', ['A', 'B']); }
                update(entities, dt) { processed.push(...entities); }
            }
            const sys = new SelectiveSys();
            world.addSystem(sys);

            const eA = world.createEntity();
            world.addComponent(eA, 'A', {});
            const eAB = world.createEntity();
            world.addComponent(eAB, 'A', {});
            world.addComponent(eAB, 'B', {});

            world.update(0.016);

            assert.ok(!processed.includes(eA)); // 只有 A
            assert.ok(processed.includes(eAB)); // 有 A 和 B

            world.destroyEntity(eA);
            world.destroyEntity(eAB);
            world.removeSystem(sys);
        });

        it('无系统时 update 不报错', () => {
            const w = new World();
            w.update(0.016);
            w.destroy();
        });

        it('多个系统按注册顺序执行', () => {
            const order = [];
            class SysA extends System {
                constructor() { super('A', []); }
                update(entities, dt) { order.push('A'); }
            }
            class SysB extends System {
                constructor() { super('B', []); }
                update(entities, dt) { order.push('B'); }
            }
            const sA = new SysA();
            const sB = new SysB();
            world.addSystem(sA);
            world.addSystem(sB);

            world.update(0.016);
            assert.deepEqual(order, ['A', 'B']);

            world.removeSystem(sA);
            world.removeSystem(sB);
        });
    });

    describe('destroy', () => {
        it('destroy 后 update 不操作', () => {
            const w = new World();
            const e = w.createEntity();
            w.addComponent(e, 'X', {});
            let called = false;
            class SpySys extends System {
                constructor() { super('Spy', ['X']); }
                update(entities, dt) { called = true; }
            }
            w.addSystem(new SpySys());
            w.destroy();
            w.update(0.016); // 不应抛异常
            assert.ok(!called); // 不应被调用
        });
    });

    describe('componentStats', () => {
        it('返回组件统计', () => {
            const e = world.createEntity();
            world.addComponent(e, 'StatTest', {});
            const stats = world.componentStats;
            assert.ok(stats.typeCount > 0);
            assert.ok(stats.totalInstances > 0);
            world.destroyEntity(e);
        });
    });
});
