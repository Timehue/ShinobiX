import test from 'node:test';
import assert from 'node:assert/strict';
import { sectorPlayerRoster, projectSectorPlayers, sectorPlayerKey } from './sector-player-roster';
import type { PlayerRecord } from '../types/character';

const player = (name: string, extra: Partial<PlayerRecord> = {}): PlayerRecord => ({ name, level: 40,
    village: 'Ashen Leaf Village', currentSector: 22, character: {} as PlayerRecord['character'], specialty: 'Ninjutsu', ...extra });
const roster = (live: PlayerRecord[], registered: PlayerRecord[] = [], sector = 22) => sectorPlayerRoster({
    live, registered, sector, currentSector: 22, viewer: ' Viewer ', recentlyStruckDown: name => name === 'Gone',
});
const options = {sector:22, village:'Stormveil Village', images:{},contest:null};

test('canonical accounts deduplicate, exclude self and preserve stable name ordering',()=>{
    const rows=roster([player('viewer'),player('Zed'),player('Ada'),player(' ADA ')]);
    assert.deepEqual(rows.map(p=>sectorPlayerKey(p.name)),['ada','zed']);
    assert.deepEqual(roster([player('Zed',{inBattle:true}),player('Ada')]).map(p=>p.name),['Ada','Zed']);
});
test('display names and server account slugs share one roster identity',()=>{
    const rows=roster([player('Shadow Fox')],[player('shadowfox',{sleeping:true})]);
    assert.equal(rows.length,1);
    assert.equal(sectorPlayerKey(rows[0].name),'shadowfox');
    assert.equal(rows[0].__sleeping,undefined);
});
test('scouting never leaks the current sector roster; interiors and other sectors are excluded',()=>{
    assert.deepEqual(roster([player('Ada')],[],23),[]);
    assert.deepEqual(roster([player('Ada',{currentSector:23}),player('Zed',{stronghold:{sector:22,tile:8}})]),[]);
});
test('live identity overrides sleepers; explicit sleepers remain uncapped and KO tombstones apply',()=>{
    const sleepers=Array.from({length:100},(_,i)=>player(`Sleeper${i}`,{sleeping:true}));
    const rows=roster([player('SLEEPER0')],[...sleepers,player('Gone',{sleeping:true}),player('Unknown')]);
    assert.equal(rows.length,100);
    assert.equal(rows.find(p=>sectorPlayerKey(p.name)==='sleeper0')?.__sleeping,undefined);
    assert.equal(rows.filter(p=>p.__sleeping).length,99);
});
test('status and disabled reasons come from the existing travel and battle evaluations',()=>{
    const rows=projectSectorPlayers(roster([player('Ready'),player('Busy',{inBattle:true}),player('Moving',{travelingUntil:Date.now()+60_000})],[player('Rest',{sleeping:true})]),options);
    assert.deepEqual(rows.map(p=>[p.name,p.status,p.actionDisabled]),[['Busy','Fighting',true],['Moving','Traveling',true],['Ready','Ready',false],['Rest','Sleeping',false]]);
    assert.match(rows[0].disabledReason!,/fighting/);
});
test('contest labels and admission belong to the controller; bystanders keep normal attacks',()=>{
    const contest={id:'test-war',sector:22,winCondition:'card' as const,attackerVillage:'Stormveil Village',defenderVillage:'Ashen Leaf Village',endsAt:Date.now()+60_000};
    const rows=projectSectorPlayers(roster([player('Enemy'),player('Bystander',{village:'Frostfang Village'})]),{...options,contest,contestBlockedReason:'Contest unavailable'});
    assert.equal(rows[0].attackLabel.kind,'combat'); assert.equal(rows[0].actionDisabled,false);
    assert.equal(rows[1].attackLabel.kind,'contest'); assert.equal(rows[1].disabledReason,'Contest unavailable');
    assert.equal(projectSectorPlayers(roster([player('Enemy')]),{...options,blockedReason:'Checking service'})[0].disabledReason,'Checking service');
});
