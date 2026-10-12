import test from 'node:test';
import assert from 'node:assert/strict';
import { createPetSceneRecallController } from './pet-scene-recall';

test('scene departure waits for every mounted pet and ignores duplicate exit presses', async () => {
    const scene = createPetSceneRecallController();
    let releaseA!: () => void, releaseB!: () => void, departures = 0;
    scene.register(() => new Promise(resolve => { releaseA = resolve; }));
    scene.register(() => new Promise(resolve => { releaseB = resolve; }));
    const departure = scene.run(() => { departures++; });
    assert.equal(scene.run(() => { departures++; }), departure);
    assert.equal(scene.snapshot(), true);
    releaseA(); await Promise.resolve();
    assert.equal(departures, 0);
    releaseB(); await departure;
    assert.equal(departures, 1);
    assert.equal(scene.snapshot(), false);
});

test('empty and retired renderer scenes return without waiting for unloaded assets', async () => {
    const scene = createPetSceneRecallController();
    const unregister = scene.register(() => { throw new Error('retired pet must never run'); });
    unregister();
    let departed = false;
    await scene.run(() => { departed = true; });
    assert.equal(departed, true);
});

test('a delayed incoming model joins an in-progress scene departure', async () => {
    const scene = createPetSceneRecallController();
    let releaseFirst!: () => void, releaseIncoming!: () => void;
    let departed = false;
    scene.register(() => new Promise(resolve => { releaseFirst = resolve; }));
    const departure = scene.run(() => { departed = true; });
    scene.register(() => new Promise(resolve => { releaseIncoming = resolve; }));
    releaseFirst();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(departed, false);
    assert.equal(scene.snapshot(), true);
    releaseIncoming();
    await departure;
    assert.equal(departed, true);
});

test('failed departure releases presentation pause and permits a later retry', async () => {
    const scene = createPetSceneRecallController();
    const changes: boolean[] = [];
    scene.subscribe(() => changes.push(scene.snapshot()));
    await assert.rejects(scene.run(async () => { throw new Error('connection'); }), /connection/);
    assert.equal(scene.snapshot(), false);
    await scene.run(() => {});
    assert.deepEqual(changes, [true, false, true, false]);
});

test('nested routed callbacks use the completed gate without deadlocking', async () => {
    const scene = createPetSceneRecallController();
    const order: string[] = [];
    scene.register(async () => { order.push('card'); });
    await scene.run(async () => {
        order.push('child');
        await scene.run(() => { order.push('parent'); });
    });
    assert.deepEqual(order, ['card', 'child', 'parent']);
    assert.equal(scene.snapshot(), false);
});

test('a participant exception releases the scene instead of locking departure', async () => {
    const scene = createPetSceneRecallController();
    scene.register(() => { throw new Error('renderer retired'); });
    await assert.rejects(scene.run(() => {}), /renderer retired/);
    assert.equal(scene.snapshot(), false);
});
