import test from 'node:test';
import assert from 'node:assert/strict';
import {lifeWorkMarker} from './life-work-marker';
test('a shared mat leaves separate Talk and work hit areas, tethered to the unchanged task ground point',()=>{
    const m=lifeWorkMarker(112,{col:5,row:5},[{col:2,row:9},{col:4,row:9},{col:4,row:11},{col:6,row:11}]);assert(m.tether);assert.equal(m.tether.x1,4.5/12*100);assert.equal(m.tether.y1,9.5/12*100);assert(Math.hypot(m.tether.x2-m.tether.x1,m.tether.y2-m.tether.y1)>=.9/12*100);
});
test('ordinary and offscreen work keep their original placement and direction without an unnecessary tether',()=>{
    const m=lifeWorkMarker(112,{col:5,row:5});assert.equal(m.style.left,'37.5%');assert.equal(m.style.top,`${9.5/12*100}%`);assert(!m.tether);
    const far=lifeWorkMarker(143,{col:0,row:0},[{col:11,row:11}]);assert(far.offscreen);assert(!far.tether);assert.equal(far.angle,Math.PI/4);
});

test('a task one row above a courier also leaves the upward-grounded portrait clickable on phones',()=>{
    const m=lifeWorkMarker(53,{col:5,row:4},[{col:5,row:5}]);assert(m.tether);assert.notEqual(m.tether.x2,m.tether.x1);
});

test('a player beside the crowded tea table cannot push the work button back over a person',()=>{
    const actors=[{col:3,row:8},{col:2,row:9},{col:4,row:9},{col:4,row:11},{col:6,row:11}],player={col:5,row:10};
    const m=lifeWorkMarker(112,player,actors),point={col:parseFloat(m.style.left)*12/100-.5,row:parseFloat(m.style.top)*12/100-.5};
    assert(m.tether);assert([...actors,player].every(a=>Math.abs(a.col-point.col)>=.98||point.row<=a.row-1.75||point.row>=a.row+.65));
});
