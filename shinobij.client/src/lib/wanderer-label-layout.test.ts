import test from 'node:test';
import assert from 'node:assert/strict';
import {placeWandererLabel} from './wanderer-label-layout';
const bounds={x:0,y:0,width:368,height:368};
const overlaps=(a:typeof bounds,b:typeof bounds)=>a.x<b.x+b.width+4&&a.x+a.width+4>b.x&&a.y<b.y+b.height+4&&a.y+a.height+4>b.y;
test('the actual phone Sada/Pell collision resolves with a small nudge and keeps valid placement stable',()=>{
    const sada={x:117,y:257,width:69,height:13},pell={x:183,y:257,width:64,height:13},neri={x:60,y:239,width:67,height:13};
    const shift=placeWandererLabel(sada,bounds,[pell,neri],{x:0,y:0}),placed={...sada,x:sada.x+shift.x,y:sada.y+shift.y};
    assert(!overlaps(placed,pell));assert(!overlaps(placed,neri));assert(Math.abs(shift.x)<=16&&Math.abs(shift.y)<=17);
    assert.deepEqual(placeWandererLabel(sada,bounds,[pell,neri],shift),shift);
    assert.deepEqual(placeWandererLabel(sada,bounds,[],shift),{x:0,y:0},'names return to their own preferred lane once the passing crowd clears');
});
test('names fit the viewport at either edge without hiding their original text or moving the owner',()=>{
    for(const x of [-35,330]){const rect={x,y:8,width:90,height:13},shift=placeWandererLabel(rect,bounds,[],{x:0,y:0});
        assert(rect.x+shift.x>=0);assert(rect.x+shift.x+rect.width<=368);assert.equal(rect.x,x);}
});
test('a bounded crowded group avoids both other names and portrait bodies',()=>{
    const bodies=Array.from({length:6},(_,i)=>({x:74+i*35,y:280,width:24,height:24})),occupied=[...bodies];
    for(let i=0;i<6;i++){const rect={x:55+i*35,y:250,width:82,height:13},shift=placeWandererLabel(rect,bounds,occupied,{x:0,y:0}),placed={...rect,x:rect.x+shift.x,y:rect.y+shift.y};
        assert(occupied.every(other=>!overlaps(placed,other)));occupied.push(placed);}
});

test('the small dock layout leaves the fixed building title and the player portrait readable',()=>{
    const scene={x:0,y:0,width:256,height:256},title={x:66,y:62,width:57,height:13},player={x:118,y:105,width:20,height:24};
    const occupied=[title,player];
    for(const rect of [{x:95,y:65,width:65,height:13},{x:115,y:110,width:72,height:13}]){
        const shift=placeWandererLabel(rect,scene,occupied,{x:0,y:0}),placed={...rect,x:rect.x+shift.x,y:rect.y+shift.y};
        assert(occupied.every(box=>!overlaps(placed,box)));occupied.push(placed);
    }
});

test('a passing collision cannot strand a training name far above its owner when a small lateral nudge fits',()=>{
    const scene={x:0,y:0,width:625,height:625},aya={x:174,y:223,width:70,height:13},riku={x:235,y:230,width:58,height:13};
    const shift=placeWandererLabel(aya,scene,[riku],{x:0,y:-34}),placed={...aya,x:aya.x+shift.x,y:aya.y+shift.y};
    assert(!overlaps(placed,riku));assert(Math.abs(shift.x)+Math.abs(shift.y)<20);
    assert.deepEqual(placeWandererLabel(aya,scene,[riku],shift),shift,'a similarly good current placement remains stable');
});

test('winter names leave the painted supply scene and nearby player/portraits clear on a phone',()=>{
    const supplies={x:140,y:88,width:56,height:47},occupied=[supplies,{x:172,y:62,width:24,height:24},{x:141,y:123,width:24,height:24},{x:173,y:123,width:24,height:24},{x:171,y:155,width:24,height:24}];
    for(const rect of [{x:114,y:102,width:77,height:13},{x:146,y:102,width:77,height:13}]){
        const shift=placeWandererLabel(rect,bounds,occupied,{x:0,y:0}),placed={...rect,x:rect.x+shift.x,y:rect.y+shift.y};
        assert(occupied.every(other=>!overlaps(placed,other)));assert(placed.x>=0&&placed.x+placed.width<=bounds.width);occupied.push(placed);
    }
});

test('a detached winter name uses the measured diagonal gap beside its own portrait',()=>{
    const scene={x:11,y:68,width:368,height:368},name={x:154.625,y:188.052,width:80.734,height:14.547},owner={x:183.961,y:191.568,width:22.078,height:22.078};
    const occupied=[{x:151.635,y:157.364,width:53.188,height:43.844},{x:187.961,y:134.234,width:14.078,height:14.078},{x:157.294,y:195.568,width:14.078,height:14.078},{x:187.961,y:195.568,width:14.078,height:14.078},{x:181.667,y:222.667,width:26.666,height:26.666},{x:233,y:175,width:72,height:14.547},{x:67.464,y:188.052,width:80.172,height:14.547}];
    const shift=placeWandererLabel(name,scene,occupied,{x:0,y:74.1875},owner),placed={...name,x:name.x+shift.x,y:name.y+shift.y};
    assert(occupied.every(other=>!overlaps(placed,other)));
    const dx=Math.max(owner.x-placed.x-placed.width,placed.x-owner.x-owner.width,0),dy=Math.max(owner.y-placed.y-placed.height,placed.y-owner.y-owner.height,0);
    assert(Math.hypot(dx,dy)<=28,'the name stays near Ryo rather than drifting above or below another character');
    assert.deepEqual(placeWandererLabel(name,scene,occupied,shift,owner),shift,'the resolved close placement remains stable');
});

test('the actual festival phone crowd keeps Ko near his own portrait below the scribe bubble',()=>{
    const scene={x:11,y:68,width:368,height:368},name={x:117.9739685,y:169.5052185,width:92.71875,height:14.546875},owner={x:153.294281,y:192.133972,width:22.078125,height:22.078125};
    const occupied=[
        {x:218.627609,y:218.309784,width:14.078125,height:14.078125},
        {x:249.294266,y:226.800629,width:14.07811,height:14.078125},
        {x:126.627602,y:196.133972,width:14.078133,height:14.078125},
        {x:157.294281,y:196.133972,width:14.078125,height:14.078125},
        {x:157.294281,y:134.800659,width:14.078125,height:14.078125},
        {x:181.666667,y:222.666667,width:26.666667,height:26.666667},
        {x:177.372406,y:164.363556,width:168,height:47.71875},
        {x:192.932297,y:250.801056,width:65.45314,height:14.546875},
        {x:267.372406,y:218.71875,width:54.5,height:14.546875},
        {x:79.299477,y:169.505219,width:92.718758,height:14.546875},
    ];
    const prior={x:-88.0651283,y:18.546875},shift=placeWandererLabel(name,scene,occupied,prior,owner),placed={...name,x:name.x+shift.x,y:name.y+shift.y};
    assert(occupied.every(other=>!overlaps(placed,other)),'the close name must leave the player, other figures, names and real speech clear');
    assert(Math.hypot(Math.max(owner.x-placed.x-placed.width,placed.x-owner.x-owner.width,0),Math.max(owner.y-placed.y-placed.height,placed.y-owner.y-owner.height,0))<=28);
    assert.deepEqual(placeWandererLabel(name,scene,occupied,shift,owner),shift,'the resolved name stays stable');
});
