/** Offline layout audit only: no live run, manifest or player state is read. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { generateHollowGateFloor } from '../shinobij.client/src/lib/hollow-gate-generate.js';

const rows=[];
for(const floor of [1,2,3,4,5]) for(let seed=1;seed<=100;seed++) {
    let state=seed+floor*1000;
    const rng=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
    const run=generateHollowGateFloor(floor,floor===5,undefined,rng);
    const start=run.playerY*run.width+run.playerX,goal=run.tiles.findIndex(t=>t.kind===(floor===5?'boss':'descend'));
    const neighbors=(i:number)=>[[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy])=>[i%run.width+dx!,Math.floor(i/run.width)+dy!])
        .filter(([x,y])=>x!>=0&&x!<run.width&&y!>=0&&y!<run.height).map(([x,y])=>y!*run.width+x!)
        .filter(i=>run.tiles[i]!.terrain!=='wall'&&run.tiles[i]!.kind!=='wall'&&run.tiles[i]!.kind!=='locked');
    const hazard=(i:number)=>['battle','elite','trap','pet_battle'].includes(run.tiles[i]!.kind);
    // Dijkstra minimises the number of hazard tiles, then steps. A separate
    // shortest path avoids mistaking a hazard detour for a short route.
    const path=(preferHazards:boolean)=>{
        const costs=new Map([[start,0]]),prev=new Map<number,number>(),todo=[start];
        while(todo.length) {
            todo.sort((a,b)=>costs.get(a)!-costs.get(b)!||a-b);
            const current=todo.shift()!;if(current===goal) break;
            for(const next of neighbors(current)) {
                const cost=costs.get(current)!+1+(preferHazards&&hazard(next)?run.tiles.length:0);
                if(cost>=(costs.get(next)??Infinity))continue;
                costs.set(next,cost);prev.set(next,current);if(!todo.includes(next))todo.push(next);
            }
        }
        assert.ok(costs.has(goal),'stair/boss reachable without optional locked cache');
        const route=[];for(let tile=goal;tile!==start;tile=prev.get(tile)!)route.push(tile);
        return {steps:route.length,hazards:route.filter(hazard).length,traps:route.filter(i=>run.tiles[i]!.kind==='trap').length};
    };
    rows.push({floor,seed,totalHazards:run.tiles.filter((_,i)=>hazard(i)).length,totalTraps:run.tiles.filter(t=>t.kind==='trap').length,
        shortest:path(false),fewestHazards:path(true)});
}
const range=(values:number[])=>({min:Math.min(...values),max:Math.max(...values),mean:Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100});
const summary=[1,2,3,4,5].map(floor=>{const items=rows.filter(r=>r.floor===floor);return {floor,count:items.length,
    totalHazards:range(items.map(r=>r.totalHazards)),shortestSteps:range(items.map(r=>r.shortest.steps)),
    shortestHazards:range(items.map(r=>r.shortest.hazards)),fewestHazards:range(items.map(r=>r.fewestHazards.hazards)),
    fewestRouteTraps:range(items.map(r=>r.fewestHazards.traps))};});
const result={summary,limits:['500 deterministic standard 25x17 layouts; locked optional cache excluded.',
    'Counts tile hazards only, excluding moving NPCs, threat ambushes, current HP, torch, card events and final boss combat.',
    'A least-hazard route can cost more steps/threat; this is not a safe-run or difficulty guarantee. No live route spoilers or layout changes.'],rows};
writeFileSync(process.argv[2]??'.tmp/shrine-route-density.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
