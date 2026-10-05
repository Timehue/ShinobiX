import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorExplorePostChestRates, rollSectorExploreOutcome, applySectorExploreReward } from './_explore.js';
import { sealGatherFind, applyGatherClaim } from './_gather.js';
import { BIOME_GATHER_IDS, COMMON_GATHER_IDS, GATHER_RECIPE_INGREDIENTS, gatherYield } from '../../shared/gathering.js';
import { PLAYABLE_WILD_SECTOR_IDS, sectorBiomeOf } from '../../shared/sector-geo.js';
import { applyForge, countOwned, craftPointTotal, CRAFT_POINTS } from '../craft/_forge.js';
import { applyCookRecipe, COOK_RECIPES } from '../player/_cafeteria.js';
import { storesDonationRouting, DAILY_RATION_COOK_CAP } from '../_village-stores.js';
import { routeStoresDonation } from '../_treasury-stores-donate.js';
import { applyTreasuryDonation } from '../_treasury-donate.js';

for (const level of [1, 49, 50, 100]) for (const chest of [true, false]) test(`exact overall rates and boundaries: level ${level}, chests ${chest}`, () => {
    const r = sectorExplorePostChestRates(level, chest);
    const close = (a: number,b: number) => assert.ok(Math.abs(a-b) < 1e-12, `${a} != ${b}`);
    close(r.battle+r.quiet+r.gather,1);
    close(r.gather*r.d,0.20);
    close(r.battle*r.d,0.8*r.d-0.15);
    close(r.quiet*r.d,0.2*r.d-0.05);
    close((level>=50 ? 0.02 : 0)+(level>=50 ? 0.98 : 1)*0.05+r.survival*(chest?0.15:0)+r.d,1);
    for (const [roll,kind] of [[0,'battle'],[r.battle-1e-10,'battle'],[r.battle,'none'],[r.battle+r.quiet-1e-10,'none'],[r.battle+r.quiet,'gather'],[0.99999,'gather']] as const) {
        const seq=[0.9,roll]; assert.equal(rollSectorExploreOutcome(()=>seq.shift()!,chest,level).kind,kind);
    }
    for (const [roll,kind] of [[0.15-1e-10,chest?'chest':'battle'],[0.15,'battle']] as const) {
        const seq=[roll,0]; assert.equal(rollSectorExploreOutcome(()=>seq.shift()!,chest,level).kind,kind);
    }
});

test('all playable sectors seal the registered biome, including volcanic 33; invalid sectors cannot gather', () => {
    for(const sector of PLAYABLE_WILD_SECTOR_IDS) {
        const find=sealGatherFind('gather-biome-test',sector,()=>0.149999)!;
        assert.equal(find.biome,sectorBiomeOf(sector));
        assert.equal(find.rareTrace,true);
        assert.deepEqual(gatherYield(find,{common:'gather-iron-sand',takeTrace:true}),[
            {itemId:'gather-iron-sand',count:2},{itemId:BIOME_GATHER_IDS[sectorBiomeOf(sector)],count:1},
        ]);
        assert.equal(sealGatherFind('gather-biome-test',sector,()=>0.15)!.rareTrace,false);
    }
    assert.equal(sealGatherFind('gather-biome-test',33,()=>0)!.biome,'volcano');
    for(const sector of [0,54,99,-1,NaN]) assert.equal(sealGatherFind('gather-biome-test',sector,()=>0),null);
});
test('claim grants exact stacks, declines trace, rejects forgery and replays without more materials', () => {
    for(const rare of [false,true]) for(const common of COMMON_GATHER_IDS) for(const takeTrace of [false,true]) {
        const find=sealGatherFind('gather-claim-test',12,()=>rare?0:1)!;
        const original={ryo:12,inventory:Array(500).fill('old-item'),pendingGatherFinds:[find],redeemedSectorExplorations:[]};
        const before=structuredClone(original);
        const result=applyGatherClaim(original,find.id,find.sector,{common,takeTrace});
        assert.deepEqual(original,before,'pure, failure-atomic operation');
        if(takeTrace&&!rare){assert.equal(result.ok,false);continue;}
        assert.equal(result.ok,true);if(!result.ok)continue;
        assert.equal(result.character.ryo,12);
        assert.equal(countOwned(result.character,common),takeTrace?2:3);
        assert.equal(countOwned(result.character,BIOME_GATHER_IDS[find.biome]),takeTrace?1:0);
        assert.equal((result.character.inventory as unknown[]).length,500,'stacked finds do not grow a full bag');
        const replay=applyGatherClaim(result.character,find.id,find.sector,{common,takeTrace});
        assert.equal(replay.ok,true);if(replay.ok){assert.equal(replay.replayed,true);assert.deepEqual(replay.character,result.character);}
        assert.equal(applyGatherClaim(original,find.id,33,{common,takeTrace}).ok,false);
        assert.equal(applyGatherClaim(original,find.id,find.sector,{common:'forged' as never,takeTrace}).ok,false);
        assert.equal(applyGatherClaim({...result.character,redeemedGatherFinds:[]},find.id,find.sector,{common,takeTrace}).ok,false,'expired receipt cannot recreate pending authority');
    }
});
test('gather credits only a tile and obeys the normal daily limit', () => {
    const result=applySectorExploreReward({ryo:50,totalTilesExplored:2},33,'2026-09-27','tile');
    assert.equal(result.ok,true);if(result.ok){assert.equal(result.reward.ryo,0);assert.equal(result.character.ryo,50);assert.equal(result.character.totalTilesExplored,3);}
    assert.equal(applySectorExploreReward({serverExploreDate:'2026-09-27',serverExploresToday:100},33,'2026-09-27','tile').ok,false);
});
function stocked(id:string, quantity=1) {
    return {level:65,ryo:10000,inventory:[],itemStacks:[
        {itemId:'hunt-beast-meat',count:140*quantity},
        ...Object.entries(GATHER_RECIPE_INGREDIENTS[id]).map(([itemId,count])=>({itemId,count:count*quantity})),
    ]};
}
for(const id of ['elderbranch-katana','black-lotus-dagger','frostfang-oathblade','embercoil-scythe','tempest-fang-blade']) test(`legendary ${id}: exact costs, quantities and level 65`,()=>{
    for(const q of [1,2]){
        const original=stocked(id,q);const before=structuredClone(original);
        const result=applyForge(original,'weapon',id,q)!;assert.ok(result);
        assert.equal(result.ryo,10000-3500*q);assert.equal(craftPointTotal(result),0);assert.equal(countOwned(result,id),q);
        for(const material of Object.keys(GATHER_RECIPE_INGREDIENTS[id]))assert.equal(countOwned(result,material),0);
        assert.deepEqual(original,before);assert.equal(applyForge({...original,level:64},'weapon',id,q),null);
        for(const material of Object.keys(GATHER_RECIPE_INGREDIENTS[id])){
            const short={...original,itemStacks:original.itemStacks.map(s=>s.itemId===material?{...s,count:s.count-1}:s)};
            assert.equal(applyForge(short,'weapon',id,q),null);assert.deepEqual(original,before);
        }
    }
});
test('shuriken keeps 15 points for three, exact iron sand, no ryo charge and 50 carry cap',()=>{
    const original={level:65,ryo:0,itemStacks:[{itemId:'hunt-beast-meat',count:6},{itemId:'gather-iron-sand',count:4}]};
    const result=applyForge(original,'supply','thrown-shuriken',2)!;
    assert.equal(countOwned(result,'thrown-shuriken'),6);assert.equal(craftPointTotal(result),0);assert.equal(result.ryo,0);
    assert.equal(applyForge({...original,inventory:Array(48).fill('thrown-shuriken')},'supply','thrown-shuriken',1),null);
    for(const id of [...COMMON_GATHER_IDS,...Object.values(BIOME_GATHER_IDS)])assert.equal(CRAFT_POINTS[id],undefined);
});
test('rations require herbs atomically and retain the 40/day cooking cap',()=>{
    assert.equal(DAILY_RATION_COOK_CAP,40);
    for(const recipe of Object.values(COOK_RECIPES)){
        const base={ryo:recipe.ryo,inventory:[recipe.materials[0]],itemStacks:[{itemId:'gather-field-herb',count:recipe.herbs}]};
        const before=structuredClone(base);const result=applyCookRecipe(base,recipe);
        assert.equal(result.ok,true);if(result.ok){assert.equal(countOwned(result.character,'ration-pack'),recipe.rations);assert.equal(countOwned(result.character,'gather-field-herb'),0);}
        assert.equal(applyCookRecipe({...base,itemStacks:[]},recipe).ok,false);assert.deepEqual(base,before);
    }
});
test('containers cost exact inputs, are disabled safely, and donate actual provisions under one cap',()=>{
    const prior=process.env.DISABLE_VILLAGE_STORES;delete process.env.DISABLE_VILLAGE_STORES;
    try{
        for(const [id,provisions,ryo]of [['village-supply-bundle',10,30],['village-supply-crate',40,100]] as const){
            const base=stocked(id);const result=applyForge(base,'supply',id,1)!;assert.ok(result);
            assert.equal(result.ryo,10000-ryo);assert.equal(craftPointTotal(result),craftPointTotal(base));
            assert.deepEqual(storesDonationRouting(id,1,CRAFT_POINTS),{store:'provisions',amount:provisions});
            const donation={kind:'item' as const,itemId:id,count:1};
            const outcome=applyTreasuryDonation({},result,donation,{allowedCurrencies:[],currencyCaps:{},itemCountCap:1000});
            assert.ok(outcome.ok);if(!outcome.ok)continue;
            const routed=routeStoresDonation({},outcome,donation,CRAFT_POINTS,{materialPoints:true});
            assert.ok(routed.ok);if(routed.ok){assert.equal(routed.routed!.amount,provisions);assert.deepEqual(routed.nextTreasury.items,[]);assert.equal(routed.nextDonorChar.rationsDonatedToday,provisions);}
            assert.equal(routeStoresDonation({},outcome,donation,{}, {materialPoints:false}).ok,false,'no clan conversion');
            const capped={...outcome,nextDonorChar:{...outcome.nextDonorChar,storesDonatedDate:new Date().toISOString().slice(0,10),rationsDonatedToday:41-provisions}};
            assert.equal(routeStoresDonation({},capped,donation,CRAFT_POINTS,{materialPoints:true}).ok,false);
            process.env.DISABLE_VILLAGE_STORES='1';assert.equal(applyForge(base,'supply',id,1),null);delete process.env.DISABLE_VILLAGE_STORES;
        }
    }finally{if(prior===undefined)delete process.env.DISABLE_VILLAGE_STORES;else process.env.DISABLE_VILLAGE_STORES=prior;}
});
