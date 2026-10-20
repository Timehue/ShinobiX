import { test } from "node:test";
import assert from "node:assert/strict";
import { createSectorNavigator } from "./sector-path-waypoint";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import {lifeActorsAt} from '../../../shared/sector-life';
import {TEA_TABLE_CLEARANCE} from '../../../shared/sector-tea-courier';
import {chronicleStopActors} from '../../../shared/sector-chronicle-stop';

test("a retargeted chaser finishes the step it is taking instead of turning back", () => {
    const navigate = createSectorNavigator();
    // Sector 14, row 8: open ground from column 6 to 10.
    const ahead = navigate(14, { col: 7, row: 8 }, { col: 10, row: 8 });
    assert.deepEqual(ahead, { col: 8, row: 8 });
    // Partway into that step the target swings behind it.
    assert.deepEqual(navigate(14, { col: 7.4, row: 8 }, { col: 6, row: 8 }), { col: 8, row: 8 });
    // Once the step lands, the new route turns it around.
    assert.deepEqual(navigate(14, { col: 8, row: 8 }, { col: 6, row: 8 }), { col: 7, row: 8 });
});

test('a freshly mounted traveler partway along a clear leg does not step backward toward the previous cell',()=>{
    const navigate=createSectorNavigator();
    assert.deepEqual(navigate(14,{col:7+1/3,row:8},{col:7.4,row:8}),{col:7.4,row:8});
    assert.deepEqual(navigate(14,{col:7.4,row:8},{col:7.45,row:8}),{col:7.45,row:8});
    assert.deepEqual(navigate(14,{col:7.6,row:8},{col:6,row:8}),{col:8,row:8},'a later distant retarget still finishes the entered cell');
});

test('initial fractional legs still respect protected scenery and cannot take a diagonal shortcut',()=>{
    const protectedLeg=createSectorNavigator(false,()=>[8*12+8]);
    assert.notDeepEqual(protectedLeg(14,{col:7.7,row:8},{col:7.9,row:8}),{col:7.9,row:8});
    const diagonal=createSectorNavigator();
    const next=diagonal(14,{col:7.2,row:8.2},{col:7.4,row:8.4});
    assert(Number.isInteger(next.col)&&Number.isInteger(next.row));
    assert(isWalkableTile(14,next.row*12+next.col));
});

test("a chaser following a moving target only ever walks open ground and never reverses mid-step", () => {
    const navigate = createSectorNavigator();
    let position = { col: 6, row: 9 }, previous = { dc: 0, dr: 0 };
    // The target paces across the open southern field of sector 14.
    for (let frame = 0; frame < 600; frame++) {
        const target = { col: 6 + Math.round(4 * Math.abs(Math.sin(frame / 40))), row: 8 + (frame % 120 < 60 ? 0 : 2) };
        const next = navigate(14, position, target);
        assert(isWalkableTile(14, Math.round(next.row) * 12 + Math.round(next.col)), `routed onto blocked ${JSON.stringify(next)}`);
        const dc = next.col - position.col, dr = next.row - position.row, length = Math.hypot(dc, dr);
        if (length < 1e-9) continue;
        const step = Math.min(length, 5 / 60), move = { dc: dc / length * step, dr: dr / length * step };
        const midStep = !Number.isInteger(Math.round(position.col * 1e6) / 1e6) || !Number.isInteger(Math.round(position.row * 1e6) / 1e6);
        if (midStep) assert(move.dc * previous.dc + move.dr * previous.dr >= 0, `reversed at frame ${frame}`);
        position = { col: position.col + move.dc, row: position.row + move.dr };
        if (Math.abs(position.col - next.col) < 1e-6 && Math.abs(position.row - next.row) < 1e-6) position = next;
        previous = move;
    }
});

test('catch-up navigation keeps courier and Chronicle players off the painted tabletop and seller',()=>{
    const courier=lifeActorsAt(15,7*300_000+150_000,'clear').find(a=>a.id==='tetsu')!;
    const pair=chronicleStopActors({window:0},{turns:[],finished:false},0);
    const cases:[number,typeof courier][]=[[15,courier],...pair.map(actor=>[42,actor] as [number,typeof courier])];
    for(const [sector,actor] of cases) {
      for(const entering of [true,false]) {
        const navigate=createSectorNavigator(true,()=>actor.clearance!);
        const seat=actor.id==='tetsu'?actor.restTile:actor.tile,origin=entering?actor.motion!.frames[0][1]:seat;
        let position={col:origin%12,row:Math.floor(origin/12)};
        const destination=entering?seat:actor.hideTile??actor.restTile,target={col:destination%12,row:Math.floor(destination/12)};
        const blocked=actor.clearance!;
        assert(blocked.length>0);
        for(let step=0;step<144;step++) {
            const next=navigate(sector,position,target),tile=next.row*12+next.col;
            assert(isWalkableTile(sector,tile));assert(!blocked.includes(tile),`${actor.name} crossed protected painted ground`);
            assert(Math.abs(next.col-position.col)+Math.abs(next.row-position.row)<=1);
            position=next;if(position.col===target.col&&position.row===target.row)break;
        }
        assert.deepEqual(position,target);
        if(actor.id==='tetsu')assert.deepEqual(blocked,TEA_TABLE_CLEARANCE);
      }
    }
});
