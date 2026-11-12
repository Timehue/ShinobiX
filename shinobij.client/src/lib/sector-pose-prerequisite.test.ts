import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPosePrerequisite} from './sector-pose-prerequisite';

test('the required braking page stays retained while the current gait can need it',async()=>{
    let loads=0,releases=0;
    const hold=createPosePrerequisite();
    const load=async()=>{loads++;return {release(){releases++;}};};
    const fail=()=>assert.fail('unexpected page failure');
    assert.equal(hold.ready('brake-run',load,fail),false);
    await Promise.resolve();
    assert.equal(hold.ready('brake-run',load,fail),true);
    assert.equal(loads,1); assert.equal(releases,0);
    hold.clear(); assert.equal(releases,1);
    hold.dispose(); assert.equal(releases,1);
});

test('a late page from an old gait cannot replace the current prerequisite',async()=>{
    let oldRelease=0,newRelease=0;
    let resolveOld!:(value:{release:()=>void})=>void;
    const hold=createPosePrerequisite();
    const fail=()=>assert.fail('unexpected page failure');
    hold.ready('old',()=>new Promise(resolve=>{resolveOld=resolve;}),fail);
    hold.ready('new',async()=>({release(){newRelease++;}}),fail);
    await Promise.resolve();
    resolveOld({release(){oldRelease++;}});
    await Promise.resolve();
    assert.equal(hold.ready('new',async()=>assert.fail('page reloaded'),fail),true);
    assert.equal(oldRelease,1); assert.equal(newRelease,0);
    hold.dispose(); assert.equal(newRelease,1);
});

test('failed and disposed loads release or retry without retaining stale pages',async()=>{
    const hold=createPosePrerequisite();let failures=0,releases=0;
    hold.ready('brake',async()=>{throw Error('download failed');},()=>failures++);
    await Promise.resolve(); assert.equal(failures,1);
    hold.ready('brake',async()=>({release(){releases++;}}),()=>failures++);
    hold.dispose(); await Promise.resolve();
    assert.equal(releases,1); assert.equal(failures,1);
    assert.equal(hold.ready('other',async()=>assert.fail('disposed loader ran'),()=>failures++),false);
});

test('a failed prefetch waits for the pose to be needed before retrying',async()=>{
    const hold=createPosePrerequisite();
    let loads=0;
    const load=async()=>{
        if(++loads===1) throw Error('cold page');
        return {release(){}};
    };
    assert.equal(hold.ready('brake',load),false);
    await Promise.resolve();
    assert.equal(hold.ready('brake',load),false);
    assert.equal(loads,1);
    const fail=()=>assert.fail('required page did not recover');
    assert.equal(hold.ready('brake',load,fail),false);
    await Promise.resolve();
    assert.equal(hold.ready('brake',load,fail),true);
    assert.equal(loads,2);
    hold.dispose();
});
