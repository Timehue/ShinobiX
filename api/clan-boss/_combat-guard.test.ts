import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clanBossEncounterFixture as fixture } from '../../scripts/_clan-boss-acceptance-fixture.js';
import { syncClanBossGuard } from './_combat-guard.js';
import { clanBossGuardMultiplier } from '../../shared/clan-boss-guard.js';
import type { TowerSession } from '../towers/_tower-session.js';
import * as actual from '../towers/_engine.js';
const engine = actual;
import { resolveTowerSignature } from '../towers/_combat-tactics.js';

function isolated(size=3,guarded=true) {
    const f=fixture(0,size);const s=f.session;
    const boss=s.actors.find(a=>a.id===s.phaseState.bossId)!;
    for(const a of s.actors) {a.statuses=[];a.shield=0;if(a.side==='enemy'&&a!==boss)a.hp=0;}
    s.map.features=[];s.map.blockedTiles=[];s.map.hazardTiles=[];s.map.boardObjects=[];
    s.phaseState.pendingPhases=[];boss.character.mechanic='';
    const tiles=actual.towerNeighbors(boss.pos,s.map.width,s.map.height);
    const players=s.actors.filter(a=>a.side==='squad');
    players.forEach((a,i)=>a.pos=tiles[i]!);
    s.turnQueue=[...players.map(a=>a.id),boss.id];s.activeIndex=0;s.activeAp=100;s.actionsThisTurn=0;
    if(!guarded)s.clanBossGuard=undefined;
    syncClanBossGuard(s);
    return {...f,boss,players};
}
function turn(s:TowerSession,id:string) {s.activeIndex=s.turnQueue.indexOf(id);s.activeAp=100;s.actionsThisTurn=0;}
test('guard is applied exactly once and still permits positive chip damage',()=>{
    const plain=isolated(1,false),ward=isolated(1,true);
    const hit=(f:ReturnType<typeof isolated>)=>{const before=f.boss.hp;
        assert.equal(engine.applyAction(f.session,f.floor,{actorId:f.players[0]!.id,type:'attack',targetId:f.boss.id},()=>.5).applied,true);
        return before-f.boss.hp;};
    const raw=hit(plain),guarded=hit(ward);
    assert.ok(raw>0);assert.ok(guarded>0);assert.ok(Math.abs(guarded/raw-.25)<.01,JSON.stringify({raw,guarded}));
    console.log(JSON.stringify({check:'direct-single-application',raw,guarded}));
});
test('one fighter repeating useful attacks cannot impersonate two fighters',()=>{
    const f=isolated(1);
    for(let i=0;i<3;i++){turn(f.session,f.players[0]!.id);assert.ok(engine.applyAction(f.session,f.floor,
        {actorId:f.players[0]!.id,type:'attack',targetId:f.boss.id},()=>.5).applied);}
    assert.deepEqual(f.session.clanBossGuard!.contributors,['hero0']);
    assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.25);
});
test('two distinct useful fighters open a bounded window for the next attacker',()=>{
    const f=isolated(3);const damage:number[]=[];
    for(const a of f.players){turn(f.session,a.id);const before=f.boss.hp;
        assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'attack',targetId:f.boss.id},()=>.5).applied);
        damage.push(before-f.boss.hp);}
    assert.equal(f.session.clanBossGuard!.openThroughRound,2);
    assert.equal(f.session.clanBossGuard!.openings['team pressure'],1);
    assert.ok(damage[2]!>damage[0]!*2,JSON.stringify(damage));
    f.session.round=3;engine.startRound(f.session);
    assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.25);
    console.log(JSON.stringify({check:'team-opening',damage,openingReformed:true}));
});
test('a successful legal dispel opens the ward; blocked clears do not',()=>{
    for(const prevented of [false,true]){
        const f=isolated(1);if(prevented)f.boss.statuses.push({name:'Clear Prevent',rounds:2,kind:'positive'});
        assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[0]!.id,type:'clear',targetId:f.boss.id},()=>.5).applied);
        assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),prevented?.25:.75);
        assert.equal(f.session.clanBossGuard!.openings.Clear??0,prevented?0:1);
    }
});
test('wait and overhealing do not charge the teamwork opening',()=>{
    const f=isolated(2);
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[0]!.id,type:'wait'},()=>.5).applied);
    turn(f.session,f.players[1]!.id);
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[1]!.id,type:'heal'},()=>.5).applied);
    assert.deepEqual(f.session.clanBossGuard!.contributors,[]);
});
test('real recovery is useful without a damage threshold',()=>{
    const f=isolated(2);f.players[0]!.hp-=2000;
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[0]!.id,type:'heal'},()=>.5).applied);
    assert.deepEqual(f.session.clanBossGuard!.contributors,['hero0']);
    turn(f.session,f.players[1]!.id);
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[1]!.id,type:'attack',targetId:f.boss.id},()=>.5).applied);
    assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.75);
});
test('guard damage fails closed outside explicit Clan Boss mode',()=>{
    const plain=isolated(1,false),wrong=isolated(1,true);wrong.session.towerId='shrine';
    for(const f of [plain,wrong])assert.ok(engine.applyAction(f.session,f.floor,
        {actorId:f.players[0]!.id,type:'attack',targetId:f.boss.id},()=>.5).applied);
    assert.equal(plain.boss.hp,wrong.boss.hp);

});
test('flat Wound ticks retain their canonical bypass',()=>{
    const plain=isolated(1,false),ward=isolated(1,true),loss:number[]=[];
    for(const f of [plain,ward]){
        f.boss.statuses=[];
        f.boss.statuses.push({name:'Wound',amount:100,rounds:2,kind:'negative'});
        f.session.activeIndex=f.session.turnQueue.length-1;
        const before=f.boss.hp;engine.endTurn(f.session,f.floor);loss.push(before-f.boss.hp);
    }
    assert.ok(loss[0]!>0);assert.equal(loss[0],loss[1]);
    console.log(JSON.stringify({canonicalBypass:'Flat Wound is outside cast-only ward',plain:loss[0],guarded:loss[1]}));
});
test('owned ninjutsu, genjutsu, taijutsu and equipped weapon casts all respect the ward',()=>{
    for(const [label,id] of [['Ninjutsu','starter-nin-earth-2'],['Genjutsu','starter-gen-earth-2'],
        ['Taijutsu','starter-tai-wind-2'],['Bukijutsu','weapon']]){
        const values:number[]=[],heals:number[]=[];
        for(const enabled of [false,true]){
            const f=isolated(1,enabled),a=f.players[0]!;a.hp=5000;
            const hp=f.boss.hp,own=a.hp;
            const action=id==='weapon'?{actorId:a.id,type:'weapon' as const,targetId:f.boss.id}
                :{actorId:a.id,type:'jutsu' as const,jutsuId:id,targetId:f.boss.id};
            assert.ok(engine.applyAction(f.session,f.floor,action,()=>.5).applied,label);
            values.push(hp-f.boss.hp);heals.push(a.hp-own);
        }
        assert.ok(values[0]!>0,label);assert.ok(values[1]!>0,label);
        assert.ok(Math.abs(values[1]!/values[0]!-.25)<.02,JSON.stringify({label,values}));
        console.log(JSON.stringify({check:'discipline-and-recovery',label,unwardedDamage:values[0],guardedDamage:values[1],unwardedRecovery:heals[0],guardedRecovery:heals[1]}));
    }
});
test('a legal pylon disruption opens the ward and spends its ordinary AP',()=>{
    const f=isolated(1),a=f.players[0]!;
    f.session.map.features=[{kind:'pylon',tiles:[a.pos],element:'Earth',weakenElement:'Wind',percent:10}];
    const before=f.session.activeAp;
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'disrupt',tile:a.pos},()=>.5).applied);
    assert.ok(f.session.activeAp<before);
    assert.equal(f.session.clanBossGuard!.openings['pylon disruption'],1);
    assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.75);
});
test('escaping a sealed signature with legal moves opens the next-round window',()=>{
    const f=isolated(1),s=f.session,a=f.players[0]!;
    s.round=2;engine.startRound(s);
    assert.ok(s.bossStrike?.tiles.length);
    const warning=new Set(s.bossStrike.tiles);
    turn(s,a.id);
    const vacant=(tile:number)=>!s.map.blockedTiles.includes(tile)&&!s.actors.some(x=>x.hp>0&&x.id!==a.id&&x.pos===tile);
    const queue=[{tile:a.pos,path:[] as number[]}],seen=new Set([a.pos]);let path:number[]|undefined;
    for(let i=0;i<queue.length;i++){
        const at=queue[i]!;if(!warning.has(at.tile)){path=at.path;break;}
        if(at.path.length>=3)continue;
        for(const tile of actual.towerNeighbors(at.tile,s.map.width,s.map.height).filter(vacant)){
            if(seen.has(tile))continue;seen.add(tile);queue.push({tile,path:[...at.path,tile]});}
    }
    assert.ok(path?.length);
    for(const tile of path)assert.ok(engine.applyAction(s,f.floor,{actorId:a.id,type:'move',tile},()=>.5).applied);
    const hp=a.hp;s.activeIndex=s.turnQueue.length-1;engine.endTurn(s,f.floor);
    assert.ok((s.towerTactics?.avoidedStrikes??0)>0);
    assert.equal(a.hp,hp);assert.equal(clanBossGuardMultiplier(s.clanBossGuard,s.round,s.phaseState.bossId!),.75);
    assert.equal(s.clanBossGuard!.openings['avoided signature'],1);
});
test('flat Wound amounts 22, 26 and 30 remain unchanged for both scheduled ticks',()=>{
    for(const amount of [22,26,30]){
        const totals:number[]=[];
        for(const enabled of [false,true]){
            const f=isolated(1,enabled);f.session.towerTactics=undefined;
            f.boss.statuses.push({name:'Wound',amount,rounds:2,kind:'negative'});
            const before=f.boss.hp;
            for(let i=0;i<2;i++){f.session.activeIndex=f.session.turnQueue.length-1;engine.endTurn(f.session,f.floor);}
            totals.push(before-f.boss.hp);
        }
        assert.deepEqual(totals,[amount*2,amount*2]);
        console.log(JSON.stringify({check:'flat-wound-packet',amount,plain:totals[0],ward:totals[1]}));
    }
});
test('status Reflect against the attacking boss is unchanged and does not charge teamwork',()=>{
    const rows:any[]=[];
    for(const enabled of [false,true]){
        const f=isolated(1,enabled),a=f.players[0]!;
        a.character.itemReflectPct=0;a.character.itemAbsorbPct=0;f.boss.character.itemLifeStealPct=0;
        a.statuses.push({name:'Reflect',percent:35,rounds:2,kind:'positive'});
        turn(f.session,f.boss.id);const bossHp=f.boss.hp,playerHp=a.hp;
        assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.boss.id,type:'attack',targetId:a.id},()=>.5).applied);
        rows.push({bossLoss:bossHp-f.boss.hp,playerLoss:playerHp-a.hp});
        if(enabled)assert.deepEqual(f.session.clanBossGuard!.contributors,[]);
    }
    assert.ok(rows[0].bossLoss>0);assert.deepEqual(rows[0],rows[1]);
    console.log(JSON.stringify({check:'reflect-return-to-boss',plain:rows[0],ward:rows[1]}));
});
test('item Reflect and combined status/item Reflect are unchanged by the boss cast ward',()=>{
    for(const statusPct of [0,35]){
        const losses:number[]=[];
        for(const enabled of [false,true]){
            const f=isolated(1,enabled),a=f.players[0]!;
            a.character.itemReflectPct=20;a.character.itemAbsorbPct=0;f.boss.character.itemLifeStealPct=0;
            if(statusPct)a.statuses.push({name:'Reflect',percent:statusPct,rounds:2,kind:'positive'});
            turn(f.session,f.boss.id);const before=f.boss.hp;
            assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.boss.id,type:'attack',targetId:a.id},()=>.5).applied);
            losses.push(before-f.boss.hp);
        }
        assert.ok(losses[0]!>0);assert.equal(losses[0],losses[1]);
        console.log(JSON.stringify({check:'item-reflect-packet',statusPct,itemPct:20,plain:losses[0],ward:losses[1]}));
    }
});
test('reflection from the defending boss derives from the guarded hit without a second ward application',()=>{
    const rows:any[]=[];
    for(const enabled of [false,true]){
        const f=isolated(1,enabled),a=f.players[0]!;
        a.character.itemLifeStealPct=0;f.boss.character.itemReflectPct=0;f.boss.character.itemAbsorbPct=0;
        f.boss.statuses.push({name:'Reflect',percent:35,rounds:2,kind:'positive'});
        const own=a.hp,bossHp=f.boss.hp;
        assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'attack',targetId:f.boss.id},()=>.5).applied);
        rows.push({bossLoss:bossHp-f.boss.hp,returned:own-a.hp});
    }
    for(const row of rows)assert.equal(row.returned,Math.floor(row.bossLoss*.35));
    console.log(JSON.stringify({check:'boss-reflect-derivation',plain:rows[0],ward:rows[1]}));
});
test('the ward mitigates before shields rather than refunding HP after damage',()=>{
    const values:any[]=[];
    for(const enabled of [false,true]){
        const f=isolated(1,enabled),a=f.players[0]!;f.boss.shield=40;
        const hp=f.boss.hp;assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'attack',targetId:f.boss.id},()=>.5).applied);
        values.push({hpLoss:hp-f.boss.hp,shield:f.boss.shield});
    }
    assert.equal(values[0].shield,0);assert.equal(values[1].shield,0);
    assert.equal(values[0].hpLoss,164);assert.equal(values[1].hpLoss,10);
    console.log(JSON.stringify({check:'pre-shield-placement',plain:values[0],ward:values[1]}));
});
test('a counter during an existing opening cannot extend its expiry',()=>{
    const f=isolated(2);
    for(const a of f.players){turn(f.session,a.id);assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'attack',targetId:f.boss.id},()=>.5).applied);}
    assert.equal(f.session.clanBossGuard!.openThroughRound,2);
    f.session.round=2;engine.startRound(f.session);turn(f.session,f.players[0]!.id);
    assert.ok(engine.applyAction(f.session,f.floor,{actorId:f.players[0]!.id,type:'clear',targetId:f.boss.id},()=>.5).applied);
    assert.equal(f.session.clanBossGuard!.openThroughRound,2);
    f.session.round=3;engine.startRound(f.session);assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.25);
});
test('illegal counter attempts neither spend AP nor open the ward',()=>{
    for(const reason of ['ap','range']){
        const f=isolated(1),a=f.players[0]!;
        if(reason==='ap')f.session.activeAp=0;else a.pos=0;
        const before=f.session.activeAp;
        const result=engine.applyAction(f.session,f.floor,{actorId:a.id,type:'clear',targetId:f.boss.id},()=>.5);
        assert.equal(result.applied,false,reason);assert.equal(f.session.activeAp,before);
        assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.25);assert.deepEqual(f.session.clanBossGuard!.contributors,[]);
    }
});
test('two units sharing one owner cannot create the distinct-fighter opening',()=>{
    const f=isolated(2);f.players[1]!.ownerSlug=f.players[0]!.ownerSlug;
    for(const a of f.players){turn(f.session,a.id);assert.ok(engine.applyAction(f.session,f.floor,{actorId:a.id,type:'attack',targetId:f.boss.id},()=>.5).applied);}
    assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.25);assert.deepEqual(f.session.clanBossGuard!.contributors,['hero0']);
});
test('sealed authored Push opens the ward only when displacement succeeds',()=>{
    // Same controlled descriptor used by api/towers/_combat-tactics.test.ts:137.
    // This is an engine counter fixture, not a built-in acquisition/loadout proof.
    for(const prevented of [false,true]){
        const f=isolated(1),s=f.session,a=f.players[0]!;s.map.width=16;s.map.height=10;a.pos=36;f.boss.pos=38;
        a.character.jutsu=[{id:'push',name:'Push',type:'Taijutsu',ap:40,range:3,effectPower:10,tags:[{name:'Push'}]}];
        a.character.jutsuMastery=[{jutsuId:'push',level:50,xp:0}];
        if(prevented)f.boss.statuses.push({name:'Debuff Prevent',rounds:2,kind:'positive'});
        s.round=2;engine.startRound(s);turn(s,a.id);const position=f.boss.pos,ap=s.activeAp;
        assert.ok(engine.applyAction(s,f.floor,{actorId:a.id,type:'jutsu',jutsuId:'push',targetId:f.boss.id},()=>.5).applied);
        assert.ok(s.activeAp<ap);
        if(prevented){assert.equal(f.boss.pos,position);assert.equal(clanBossGuardMultiplier(s.clanBossGuard,s.round,s.phaseState.bossId!),.25);}
        else {assert.notEqual(f.boss.pos,position);assert.equal(s.clanBossGuard!.openings.displacement,1);assert.equal(clanBossGuardMultiplier(s.clanBossGuard,s.round,s.phaseState.bossId!),.75);assert.equal(s.bossStrike,undefined);}
    }
});
test('an authored pillar bait opens the ward, breaks the shield and cannot resolve twice',()=>{
    const arrange=()=>{const f=isolated(1);f.session.map.width=16;f.session.map.height=10;
        f.players[0]!.pos=34;f.boss.pos=38;f.session.round=2;return f;};
    const probe=arrange();engine.startRound(probe.session);assert.equal(probe.session.towerTactics!.telegraph!.kind,'charge');
    const pillar=probe.session.bossStrike!.tiles[0]!;
    const f=arrange();f.session.map.blockedTiles=[pillar];f.boss.shield=100;engine.startRound(f.session);
    assert.deepEqual(f.session.bossStrike!.tiles,[pillar]);
    f.session.activeIndex=f.session.turnQueue.length-1;engine.endTurn(f.session,f.floor);
    assert.equal(f.session.towerTactics!.chargeBaits,1);assert.equal(f.boss.shield,0);
    assert.equal(f.session.clanBossGuard!.openings['pillar bait'],1);assert.equal(clanBossGuardMultiplier(f.session.clanBossGuard,f.session.round,f.session.phaseState.bossId!),.75);
    assert.ok(f.boss.statuses.some(s=>s.name==='Stun'&&s.activeRound===3));
    assert.ok(!f.session.map.blockedTiles.includes(pillar));
    resolveTowerSignature(f.session);resolveTowerSignature(f.session);
    assert.equal(f.session.towerTactics!.chargeBaits,1);
    assert.equal(f.session.clanBossGuard!.openings['pillar bait'],1);
});
