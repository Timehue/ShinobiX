import { writeFileSync } from 'node:fs';
import { earnedForLevel } from '../api/_xp-engine.js';
import { encounter } from './test-fixtures/hunt-accessibility.js';
import { simulateBalance } from './test-fixtures/hunt-shrine.js';

const rows=[];
const expanded=process.argv.includes('--expanded');
for(const level of [15,16,17,18,20,30,31,50]) for(const build of ['balanced-nin','focused-nin','focused-gen','matched-gen-six'] as const)
for(const seed of [1,7,42]) for(const choice of ['damage-first','debuff-first','counterplay'] as const)
for(const gear of expanded?['robe','reinforced']:['robe']) for(const developing of expanded&&gear==='reinforced'&&[15,17,20,30].includes(level)?[false,true]:[false]) {
    if(build==='matched-gen-six'&&level>20) continue;
    const options=choice==='damage-first'?{}:{openingDebuff:true,reverseDamage:true,...(choice==='counterplay'?{useCounters:true}:{})};
    for(const mission of ['hunt-frost-wolf',...(level===17 || level===30?['hunt-wild-boar','hunt-ash-lizard']:[])]) {
        const before=encounter(level,build,mission,seed,true,gear,developing),after=encounter(level,build,mission,seed,false,gear,developing);
        rows.push({level,build,seed,choice,mission,gear,developing,allocatedPoints:earnedForLevel(level),
            before:simulateBalance(before,false,options),after:simulateBalance(after,false,options)});
    }
}
const report={fixture:'Exact earnedForLevel stat budgets; balanced or INT/offense-focused allocations, catalog no-sustain attacks. Robe: Cloth below40/Bulwark40+. Reinforced: five standard level5 shop pieces costing1245ryo, no event variants. Capped mastery, plus mastery10 developing probes. Full resources, no bloodline/pet/relic/items. Even opening, single ordinary target. Focused Gen has only two non-Siphon damaging catalog techniques and is a sparse-kit stress case.',
    choices:'Damage-first catalog order; debuff-first with reverse damage order; or visible counterplay adds legal Cleanse for damage/seals, Clear for shield/defense, universal Basic Heal below45%. No healing skills/Siphon/items/strategic kiting. Three deterministic battle seeds often agree; not a stochastic win-rate estimate.',rows};
writeFileSync(process.argv[2]??'hunt-accessibility.json',JSON.stringify({...report,rows:undefined}).slice(0,-1)+',"rows":[\n'+rows.map(r=>JSON.stringify(r)).join(',\n')+'\n]}\n');
console.log(`Wrote ${rows.length} progression-budgeted paired comparisons`);
for(const level of [15,16,17,18,20,30,31,50]) {
    const group=rows.filter(r=>r.level===level&&r.mission==='hunt-frost-wolf'&&(!expanded||r.gear==='reinforced'&&!r.developing));
    console.log(JSON.stringify({level,beforeWins:group.filter(r=>r.before.outcome==='win').length,
        afterWins:group.filter(r=>r.after.outcome==='win').length,total:group.length,
        afterHp:group.map(r=>r.after.endHp)}));
}
