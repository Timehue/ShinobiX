import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clanCampaignStandings} from './clan-campaign-standings.js';
import type {ClanCampaignPrestige} from './clan-campaign-history.js';
const now=Date.UTC(2026,9,13);
function clan(name:string,wins:number,draws=0):{name:string;campaignPrestige:ClanCampaignPrestige}{return {name,campaignPrestige:{wins:wins+5,losses:1,draws,participations:wins+draws+6,seasons:{'2026-Q4':{wins,losses:1,draws,points:999}},earnedBanners:[]}};}
test('season standings use server-earned wins/draws with shared ranks and no roster-power tiebreaker',()=>{
    const rows=clanCampaignStandings([clan('Jade',1),clan('Azure',2),clan('Ember',2),clan('Mist',1,2),{name:'New'}],'season',now);
    assert.deepEqual(rows.map(row=>[row.name,row.points,row.rank]),[['Azure',6,1],['Ember',6,1],['Mist',5,3],['Jade',3,4],['New',0,5]]);
});
test('a new quarter starts at zero while lifetime campaign recognition is preserved',()=>{
    const clans=[clan('Azure',2)];assert.equal(clanCampaignStandings(clans,'season',Date.UTC(2027,0,1))[0].points,0);
    assert.equal(clanCampaignStandings(clans,'lifetime',Date.UTC(2027,0,1))[0].wins,7);
});
