import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_BUILDINGS, buildingsInSector, sectorBuilding } from './sector-buildings.js';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { SHRINE_DEFS } from './shrines.js';
import { isWalkableTile, pathInMask, sectorWalkMask } from './sector-walk-mask.js';
import { BUILDING_REPAIR_INGREDIENTS, buildingCourierRoute, buildingWorkView, buildingWorkshopRecipes } from './sector-building-content.js';
import { SUPPLY_CRAFT_RECIPES } from './crafting-recipes.js';
import { RESOURCE_ITEMS } from './resource-items.js';
import { readBuildingProgress, readSharedBuilding } from './sector-building-state.js';
import { lifeActorsAt } from './sector-life.js';

test('all existing strongholds, village gates, shrines, painted ruin groups and quest-only places have named counters',()=>{
    assert.equal(new Set(SECTOR_BUILDINGS.map(b=>b.id)).size,SECTOR_BUILDINGS.length);
    for(const floor of Object.values(SECTOR_FLOOR_LAYOUTS)){
        if(floor.sites.stronghold)assert.ok(sectorBuilding(`stronghold-${floor.sector}`));
        if(floor.village)assert.ok(sectorBuilding(`village-${floor.sector}`));
    }
    for(const shrine of SHRINE_DEFS)assert.ok(sectorBuilding(`shrine-${shrine.id}`));
    for(const sector of [38,50,52,60,62])assert.ok(buildingsInSector(sector).length);
    for(const id of ['flower-pickers-shelter','south-watch-post','lower-road-kitchen','shuttered-boathouse','old-toll-booth'])assert.ok(sectorBuilding(id)?.storyPointId);
    assert.deepEqual([...new Set(SECTOR_BUILDINGS.flatMap(b=>b.services))].sort(),['reception','tea','survey','repair','courier','watch','workshop','intelligence','register','festival'].sort());
});
test('every building approach, evidence point and watch point is walkable and connected',()=>{
    for(const b of SECTOR_BUILDINGS){
        assert.ok(b.name&&b.keeper&&b.description&&b.services.length,b.id);
        assert.ok(isWalkableTile(b.sector,b.approach),`${b.id} approach`);
        assert.ok(b.footprint.length,`${b.id} tap footprint`);
        for(const tile of b.footprint)assert.ok(Number.isInteger(tile)&&tile>=0&&tile<144,b.id);
        for(const tile of b.restorationSite?.footprint??[])assert.equal(isWalkableTile(b.sector,tile),false,`${b.id} restoration cannot cover a road`);
        if(b.kind==='stronghold')assert.ok((b.restorationSite?.footprint.length??0)<=b.footprint.length/4,`${b.id} frontage repairs must preserve the regional roof silhouette`);
        for(const p of [...b.evidence??[],...b.watchPoints??[],...b.contactPoints??[],...b.restoredWatchPoint?[b.restoredWatchPoint]:[]]){
            assert.ok(isWalkableTile(p.sector,p.tile),`${b.id} ${p.label}`);
            assert.ok(pathInMask(sectorWalkMask(b.sector),b.approach,p.tile),b.id);
        }
    }
});
test('each relay seals two distinct onward counters on connected roads and work views preserve their approaches',()=>{
    for(const b of SECTOR_BUILDINGS.filter(b=>b.services.includes('courier'))){
        const route=buildingCourierRoute(b);assert.equal(route.length,2,b.id);
        assert.equal(new Set(route.map(id=>sectorBuilding(id)!.sector)).size,2,b.id);
        for(let step=0;step<route.length;step++){
            const view=buildingWorkView({id:'test',buildingId:b.id,kind:'courier',startedAt:0,stepAt:0,step,day:'2026-10-22',route});
            assert.equal(view?.target.tile,sectorBuilding(route[step])!.approach);assert.equal(view?.final,step===1);
        }
    }
});
test('repair ingredients cover all four existing material families and every workshop recipe exists',()=>{
    assert.equal(BUILDING_REPAIR_INGREDIENTS.length,4);
    for(const row of BUILDING_REPAIR_INGREDIENTS)assert.ok(row.ids.length&&row.count>0);
    assert.ok(BUILDING_REPAIR_INGREDIENTS[0].ids.every(id=>RESOURCE_ITEMS.some(item=>item.id===id&&item.activity==='mining')));
    assert.ok(BUILDING_REPAIR_INGREDIENTS[1].ids.every(id=>id.startsWith('hunt-')));
    assert.ok(BUILDING_REPAIR_INGREDIENTS[2].ids.every(id=>RESOURCE_ITEMS.some(item=>item.id===id&&item.activity==='fishing')));
    assert.ok(BUILDING_REPAIR_INGREDIENTS[3].ids.every(id=>id.startsWith('gather-')));
    for(const b of SECTOR_BUILDINGS.filter(b=>b.services.includes('workshop')))for(const id of buildingWorkshopRecipes(b))assert.ok(SUPPLY_CRAFT_RECIPES[id],`${b.id}:${id}`);
});
test('old saves initialize safely, uncapped daily repair activity persists, stage is derived and retired shard weeks are ignored',()=>{
    const now=Date.parse('2026-10-22T12:00:00Z');
    assert.equal(readBuildingProgress(undefined,now).repairs,0);
    assert.equal(readBuildingProgress({day:'2026-10-21',repairsToday:6},now).repairsToday,0);
    assert.equal(readBuildingProgress({day:'2026-10-22',repairs:42,repairsToday:42},now).repairsToday,42);
    assert.equal(readSharedBuilding({repairs:12,stage:99}).stage,2);
    const legacy=readBuildingProgress({repairs:40,shardClaims:1,shardWeek:'2026-10-19'},now);
    assert.equal(legacy.repairs,40);assert.equal(legacy.shardClaims,1);assert.equal('shardWeek' in legacy,false);
});

test('long-running work counters retain safe integers without relaxing bounded gameplay fields',()=>{
    const now=Date.parse('2026-10-22T12:00:00Z'),large=20_000_040;
    const saved=readBuildingProgress({day:'2026-10-22',repairs:large,repairsToday:large,rewardsToday:large,shardClaims:large/20,
        standing:{gorgewatch:{visits:large,repairCount:large,trust:999,survey:{step:999,evidence:[]}}},
        deliveriesToday:999},now);
    assert.equal(saved.repairs,large);assert.equal(saved.repairsToday,large);assert.equal(saved.shardClaims,1_000_002);
    assert.equal(saved.rewardsToday,large);
    assert.equal(readBuildingProgress(saved,now+86_400_000).rewardsToday,0);
    assert.equal(saved.standing.gorgewatch.visits,large);assert.equal(saved.standing.gorgewatch.repairCount,large);
    assert.equal(saved.standing.gorgewatch.trust,100);assert.equal(saved.standing.gorgewatch.survey?.step,3);
    assert.equal(saved.deliveriesToday,3);
    const communal=readSharedBuilding({repairs:large,revision:large,contributors:[{name:'Builder',repairs:large}]});
    assert.equal(communal.repairs,large);assert.equal(communal.revision,large);assert.equal(communal.contributors[0].repairs,large);
    assert.equal(communal.stage,3);
    assert.equal(readBuildingProgress({repairs:Infinity},now).repairs,0);
    assert.equal(readBuildingProgress({repairs:-10},now).repairs,0);
    assert.equal(readSharedBuilding({repairs:Number.MAX_VALUE}).repairs,Number.MAX_SAFE_INTEGER);
});

test('existing painted tea counters use the same keeper identity as their living resident',()=>{
    for(const id of ['heartwood-tea-counter','midlands-tea-house','festival-tea-counter']){
        const building=sectorBuilding(id)!,resident=lifeActorsAt(building.sector,0,'clear').find(actor=>actor.id===`resident:${building.sector}`);
        assert.equal(building.keeper,resident?.name,id);
    }
});

test('harbor and deepwood relays follow Tetsu’s existing circuit and keep his Heartwood mat free',()=>{
    assert.deepEqual(buildingCourierRoute(sectorBuilding('stronghold-2')!),['grey-landing-relay','stronghold-16']);
    assert.deepEqual(buildingCourierRoute(sectorBuilding('stronghold-16')!),['stronghold-14','heartwood-tea-counter']);
    assert.deepEqual(buildingCourierRoute(sectorBuilding('stronghold-14')!),['heartwood-tea-counter','village-9']);
    assert.deepEqual(buildingCourierRoute(sectorBuilding('heartwood-tea-counter')!),['village-9','stronghold-14']);
    const table=sectorBuilding('heartwood-tea-counter')!;
    assert.equal(table.approach,116);assert.notEqual(table.approach,105,'Tetsu keeps his established resting mat');
    assert.ok(table.services.includes('tea')&&table.services.includes('courier'));
    assert.ok(!sectorBuilding('shrine-heartwood')!.services.includes('tea'),'tea is served at its actual table');
});
