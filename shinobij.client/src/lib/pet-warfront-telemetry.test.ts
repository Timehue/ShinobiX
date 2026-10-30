import test from 'node:test';
import assert from 'node:assert/strict';
import { clearWarfrontMetrics, warfrontMetric } from './pet-warfront-telemetry';

test('replay telemetry preserves values while avoiding redundant frame mutations', () => {
    let writes = 0;
    const dataset = new Proxy({} as DOMStringMap, {
        set(target, key, value: string) { writes++; target[String(key)] = value; return true; },
    });
    const canvas = { dataset } as HTMLCanvasElement;
    warfrontMetric(canvas, 'ActorsPresent', 8);
    warfrontMetric(canvas, 'ActorsPresent', '8');
    warfrontMetric(canvas, 'ActorsPresent', 8);
    assert.equal(writes, 1);
    assert.equal(dataset.riteActorsPresent, '8');
    warfrontMetric(canvas, 'ActorsPresent', 7);
    warfrontMetric(canvas, 'BoardVisible', true);
    warfrontMetric(canvas, 'CameraFocus', '');
    assert.equal(writes, 4);
    assert.equal(dataset.riteActorsPresent, '7');
    assert.equal(dataset.riteBoardVisible, 'true');
    assert.equal(dataset.riteCameraFocus, '');
});

test('probe cleanup removes its metrics while retaining other probes and QA controls', () => {
    const dataset = { riteGroundingActiveRings: '1', riteGroundingQaHide: '1', riteHeroActor: 'player-0', riteRuntimeRoute: 'rig' };
    const canvas = { dataset } as unknown as HTMLCanvasElement;
    clearWarfrontMetrics(canvas, /^riteGrounding(?!Qa)/);
    assert.deepEqual(dataset, { riteGroundingQaHide: '1', riteHeroActor: 'player-0', riteRuntimeRoute: 'rig' });
    clearWarfrontMetrics(canvas, /^rite(?:Attack|Spectacle|Hero|ContactHoldFrames$|ActorsPresent$)/);
    assert.deepEqual(dataset, { riteGroundingQaHide: '1', riteRuntimeRoute: 'rig' });
});
