import assert from 'node:assert/strict';
import {test} from 'node:test';
import {advanceSectorStride, fitSectorStride, sectorClipGait, sectorStartEntry, type MotionClip} from './sector-model-motion';

const bank: Record<string, MotionClip> = {
    idle:{count:1,period:1,speed:0},
    run:{count:4,period:1,speed:12},
    'stop-left':{source:'run',target:'idle',entry:0,count:3,period:.2,times:[0,.1,.2],travel:[0,.8,1],correction:[0,.5]},
    'stop-right':{source:'run',target:'idle',entry:2,count:3,period:.2,times:[0,.1,.2],travel:[0,.8,1],correction:[0,-.5]},
};

test('a release in flight enters the next matching foot plant, including across the loop boundary', () => {
    for (const [time,page,sign] of [[.48,'stop-right',-1],[.98,'stop-left',1]] as const) {
        const pose = advanceSectorStride(bank,{page:'run',time},null,.12);
        assert.equal(pose.page,page);
        assert.ok(Math.abs(pose.travel-1.04)<1e-9);
        assert.ok(Math.abs(pose.cy-sign*.25)<1e-9);
        const idle = advanceSectorStride(bank,pose,null,.2);
        assert.equal(idle.page,'idle');
        assert.ok(Math.abs(idle.travel-.2)<1e-9);
    }
});

test('interrupting a start uses its authored contact and preserves travel across a slow phone frame', () => {
    const starting = {...bank,
        'start-run':{target:'run',exitFrame:2,count:3,period:.24,times:[0,.1,.24],travel:[0,.25,1.5]},
        'stop-start':{source:'start-run',entry:1,target:'idle',count:2,period:.1,times:[0,.1],travel:[0,.2]},
    };
    const first = advanceSectorStride(starting,{page:'idle',time:0},'run',.04);
    const stopped = advanceSectorStride(starting,first,null,.2);
    assert.equal(stopped.page,'idle');
    assert.ok(Math.abs(first.travel+stopped.travel-.45)<1e-9);
});

test('network allowance limits the painted time and preserves the fitted endpoint when motion resumes', () => {
    const state={page:'stop-left',time:0};
    const waiting=fitSectorStride(bank,state,null,.2,0,0,1);
    assert.equal(waiting.time,0);
    const first=fitSectorStride(bank,waiting,null,.2,.51,0,1);
    assert.equal(first.distance,.51);
    assert(first.time>0 && first.time<.1);
    const rest=fitSectorStride(bank,first,null,.2,2,0,1);
    assert.equal(rest.page,'idle');
    assert.ok(Math.abs(first.distance+rest.distance-1.5)<.00001);
    const east=fitSectorStride(bank,state,null,.2,2,1,0);
    assert.equal(east.distance,1);
    assert.equal(east.offsetY,.5);
});

test('release can use the currently painted contact instead of missing it between simulation updates', () => {
    for (const time of [.500001,.51,.749999]) {
        const pose=advanceSectorStride(bank,{page:'run',time},null,.05);
        assert.equal(pose.page,'stop-right');
        assert.ok(Math.abs(pose.time-.05)<1e-9);
        assert.ok(Math.abs(pose.travel-.4)<1e-9);
    }
    const past=advanceSectorStride(bank,{page:'run',time:.750001},null,.05);
    assert.equal(past.page,'run','a contact from a no-longer-visible frame cannot be used');
});

test('a commanded start skips the wind-up and travels from its first update', () => {
    // Shaped like the shipped walk start: a slow ease-in, then the loop's 31 px/s.
    const times = Array.from({length:13}, (_,i) => i*.1);
    const travel = [0,.02,.2,.7,1.9,3.8,6.4,9.3,12.4,15.5,18.6,21.7,24.8];
    const starting: Record<string, MotionClip> = {
        idle:{count:1,period:1,speed:0},
        walk:{count:8,period:1,speed:31},
        'start-walk':{target:'walk',exitFrame:4,count:13,period:1.2,times,travel},
        'stop-early':{source:'start-walk',entry:2,target:'idle',count:2,period:.1,times:[0,.1],travel:[0,.3]},
        'stop-late':{source:'start-walk',entry:6,target:'idle',count:2,period:.1,times:[0,.1],travel:[0,.5]},
    };
    const entry = sectorStartEntry(starting['start-walk'], starting.walk.speed);
    assert.equal(entry, .4, 'the first frame that moves at half the walking speed');

    const frame = 1/60;
    const authored = fitSectorStride(starting,{page:'idle',time:0},'walk',frame,100,1,0);
    const joined = fitSectorStride(starting,{page:'start-walk',time:entry},'walk',frame,100,1,0);
    assert.ok(authored.distance < .01, 'the full wind-up barely moves in its first frame');
    assert.ok(joined.distance > .25, 'the joined start covers ground in its first frame');
    assert.equal(joined.page, 'start-walk');

    // The rest of the clip still plays and hands off to the loop at its authored frame.
    const handed = advanceSectorStride(starting,{page:'start-walk',time:entry},'walk',1.2-entry+.05);
    assert.equal(handed.page, 'walk');
    assert.ok(Math.abs(handed.travel-(24.8-1.9+31*.05))<1e-9);

    // A release right after joining uses the next authored contact, never one already skipped.
    const released = advanceSectorStride(starting,joined,null,1);
    assert.equal(released.page, 'idle');
    assert.ok(Math.abs(joined.travel+released.travel-(6.4-1.9+.5))<1e-9, 'brakes on the late contact');
});

test('a start without a ramp, or without a gait speed, is entered at its first frame', () => {
    assert.equal(sectorStartEntry(undefined, 31), 0);
    assert.equal(sectorStartEntry({count:4,period:1,speed:31}, 31), 0);
    assert.equal(sectorStartEntry({count:3,period:.2,times:[0,.1,.2],travel:[0,.01,.02]}, 31), 0);
    assert.equal(sectorStartEntry({count:3,period:.2,times:[0,.1,.2],travel:[0,4,8]}, undefined), 0);
    assert.equal(sectorStartEntry({count:3,period:.2,times:[0,.1,.2],travel:[0,4,8]}, 31), 0, 'already at speed');
});

test('irregular start frames use the visible release contact and keep its authored endpoint', () => {
    const starting={...bank,
        'start-run':{target:'run',exitFrame:2,count:4,period:.3,times:[0,.1,.2,.3],travel:[0,2,8,12]},
        'stop-start':{source:'start-run',entry:1,target:'idle',count:3,period:.1,
            times:[0,.05,.1],travel:[0,.6,1],correction:[.2,0]},
    };
    const pose=fitSectorStride(starting,{page:'start-run',time:.100001},null,.05,100,1,0);
    assert.equal(pose.page,'stop-start');
    assert.ok(Math.abs(pose.distance-.7)<1e-9);
    const rest=fitSectorStride(starting,pose,null,.1,100,1,0);
    assert.equal(rest.page,'idle');
    assert.ok(Math.abs(pose.distance+rest.distance-1.2)<1e-9);
    const held=fitSectorStride(starting,{page:'start-run',time:.100001},null,.05,0,1,0);
    assert.equal(held.distance,0);
    assert.equal(held.page,'start-run');
    assert.equal(held.time,.100001);
});

test('a clip reports the gait it belongs to, so a run changing down keeps the run pace', () => {
    const bank: Record<string, MotionClip> = {idle:{period:1,count:1}, walk:{period:1,count:8}, run:{period:.6,count:8},
        'start-walk':{period:.7,count:6,target:'walk'}, 'change-run-walk':{period:.5,count:4,source:'run',target:'walk'},
        'stop-run':{period:.4,count:4,entryGait:'run',target:'idle'}};
    assert.equal(sectorClipGait(bank,'walk'),'walk');
    assert.equal(sectorClipGait(bank,'start-walk'),'walk');
    assert.equal(sectorClipGait(bank,'change-run-walk'),'run');
    assert.equal(sectorClipGait(bank,'stop-run'),'run');
    assert.equal(sectorClipGait(bank,'idle'),undefined);
});
