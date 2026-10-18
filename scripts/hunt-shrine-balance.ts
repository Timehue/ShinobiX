import { writeFileSync } from 'node:fs';
import { huntFixture, shrineFixture, simulateBalance } from './test-fixtures/hunt-shrine.js';

// Offline, no storage credentials or player records. Identical saves and enemy
// seals are compared; only each new host-specific chooser is toggled.
const rows=[];
const formationsOnly=process.argv.includes('--formations-only');
for(const level of [5,17,50,100]) for(const sustain of [false,true]) {
    if(formationsOnly) {
        for(const kind of ['pack','waves'] as const) for(const mission of ['hunt-forest-hawk','hunt-ash-lizard']) {
            const formation={version:1 as const,kind,count:3 as const};
            rows.push({level,sustain,encounter:`${mission}-${kind}-3`,
                before:simulateBalance(huntFixture(level,mission,sustain,true,formation),sustain),
                after:simulateBalance(huntFixture(level,mission,sustain,false,formation),sustain)});
        }
        continue;
    }
    for(const mission of ['hunt-wild-boar','hunt-frost-wolf','hunt-ash-lizard','hunt-forest-hawk']) {
        const before=simulateBalance(huntFixture(level,mission,sustain,true),sustain);
        const after=simulateBalance(huntFixture(level,mission,sustain),sustain);
        rows.push({level,sustain,encounter:mission,before,after});
    }
    for(const kind of ['battle','elite','boss'] as const) {
        const floor=kind==='boss'?5:1;
        const before=simulateBalance(shrineFixture(level,kind,sustain,true,undefined,floor),sustain);
        const after=simulateBalance(shrineFixture(level,kind,sustain,false,undefined,floor),sustain);
        rows.push({level,sustain,encounter:`shrine-${kind}-f${floor}`,before,after});
    }
    for(const role of ['bandit','night-ninja','patrol'] as const) {
        const before=simulateBalance(shrineFixture(level,'battle',sustain,true,role),sustain);
        const after=simulateBalance(shrineFixture(level,'battle',sustain,false,role),sustain);
        rows.push({level,sustain,encounter:`shrine-${role}`,before,after});
    }
}
const report={fixture:'Illustrative catalog builds with level-appropriate armor; no bloodline, pet, relic or production save. Level17 has INT640/GEN570. This is not a Buster/Rill replay.',
    policy:'Fixed legal cast rotation; sustain maintains Absorb/Lifesteal/Reflect, offense favors damaging casts. Same seed and numbers before/after; no stochastic win-rate claim.',rows};
const output=process.argv[2] ?? 'hunt-shrine-balance.json';
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(`Wrote ${rows.length} deterministic paired comparisons to ${output}`);
console.table(rows.filter(r=>r.level===17 || r.level===100).map(r=>({level:r.level,build:r.sustain?'sustain':'offense',encounter:r.encounter,
    before:`${r.before.outcome} r${r.before.rounds} HP${r.before.endHp} heals${r.before.enemyHeals}`,
    after:`${r.after.outcome} r${r.after.rounds} HP${r.after.endHp} heals${r.after.enemyHeals}`})));
