// Local real-engine evidence only. No player endpoints, production reads or balance writes.
import { writeFileSync } from 'node:fs';
import { gearedSquad, runFloorSmart, KNOBS } from '../../../scripts/spire-balance-sim.js';
import { buildTowerEncounter } from '../../../api/towers/_encounter.js';
import { getSpireFloor, spireBossForFloor, SPIRE_CATALOG_VERSION } from '../../../api/towers/_spire-catalog.js';
import { resolveAscensionModifiers, weeklySpireBlessing } from '../../../api/towers/_modifiers.js';
import { makeRng } from '../../../api/towers/_sim.js';
const baseline = { bloodlineMult: KNOBS.bloodlineMult, itemDamagePct: KNOBS.itemDamagePct, powers: KNOBS.jutsu.map(jutsu => Number(jutsu.effectPower)) };
const rows: Array<Record<string, unknown>> = [];
try {
    for (const fixture of ['geared-four', 'stronger-four']) {
        KNOBS.bloodlineMult = fixture === 'stronger-four' ? 1.56 : baseline.bloodlineMult;
        KNOBS.itemDamagePct = fixture === 'stronger-four' ? 42 : baseline.itemDamagePct;
        KNOBS.jutsu.forEach((jutsu, index) => { jutsu.effectPower = Math.round(baseline.powers[index]! * (fixture === 'stronger-four' ? 1.4 : 1)); });
        for (const tier of [12, 15, 16, 17, 18, 20]) {
            const floor = getSpireFloor(tier)!;
            let wins = 0, cleanPar = 0, qualified = 0;
            for (let n = 0; n < 24; n++) {
                const seed = 1000 + n * 7 + tier;
                const session = buildTowerEncounter({ floor, squad: gearedSquad(4), partySize: 4, runId: `mastery-${tier}-${n}`, seed, now: 1000,
                    ascension: resolveAscensionModifiers(tier, spireBossForFloor(tier)!, floor.roundBudget, weeklySpireBlessing(0).modifier) });
                for (const actor of session.actors) if (actor.side === 'squad') actor.shield = KNOBS.itemShield;
                runFloorSmart(session, floor, makeRng(seed));
                if (session.winner !== 'squad') continue;
                wins++;
                const tactics = session.towerTactics!;
                if (session.round > floor.roundBudget || tactics.squadKnockouts.length || session.actors.some(actor => actor.side === 'squad' && actor.hp <= 0)) continue;
                cleanPar++;
                if (tactics.disruptedPylons.length && (tier === 15 ? tactics.chargeBaits : tactics.avoidedStrikes) > 0) qualified++;
            }
            rows.push({ fixture, tier, seeds: 24, wins, cleanPar, qualified, par: floor.roundBudget });
            console.log(JSON.stringify(rows.at(-1)));
        }
    }
} finally {
    KNOBS.bloodlineMult = baseline.bloodlineMult; KNOBS.itemDamagePct = baseline.itemDamagePct;
    KNOBS.jutsu.forEach((jutsu, index) => { jutsu.effectPower = baseline.powers[index]!; });
}
writeFileSync(new URL('./mastery-probe-results.json', import.meta.url), JSON.stringify({
    generatedAt: new Date().toISOString(), spireCatalog: SPIRE_CATALOG_VERSION, attempts: 288, blessingWeek: 0,
    limitations: ['Deterministic four-member policy fixtures, not observed players.', 'One blessing, no learning-time or completion-time measurement.', 'Stronger fixture is sensitivity evidence; no gear tuning promoted.'], rows,
}, null, 2) + '\n');
