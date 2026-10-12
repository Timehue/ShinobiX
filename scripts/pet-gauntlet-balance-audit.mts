/** Controlled full-run probes of the current Pet Gauntlet. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { startGauntletRun, buyOffer, offerCost, setField, fieldedPets, enemySquadForRound, applyGauntletBuffs, beginFight, applyRoundResult, buyItem, buyRelic, relicDef, rerollShop, releasePet, boardModsFromRelics } from '../shinobij.client/src/lib/pet-gauntlet.js';
import { runPetGridBattle, BOARD_COLS } from '../shinobij.client/src/lib/pet-board-sim.js';
import { derivePetRole } from '../shinobij.client/src/lib/pet-roles.js';
import { resolveSynergies, applySynergiesToSquad } from '../shinobij.client/src/lib/pet-synergies.js';
import type { Pet } from '../shinobij.client/src/types/pet.js';

const value = (pet: Pet) => pet.hp + pet.attack * 8 + pet.defense * 3 + pet.speed * 2;
const runs = [];
for (let seed = 1; seed <= 32; seed++) for (const policy of ['draft-and-position', 'first-offer-front-row'] as const) {
    let run = startGauntletRun(seed * 7919), fights = 0;
    while (run.status === 'drafting' && fights < 30) {
        if (policy === 'draft-and-position') {
            if (run.roster.length === 5) {
                const weakest = [...run.roster].sort((a, b) => value(a) - value(b))[0];
                if (run.shop.some(offer => offerCost(run, offer) <= run.valor && value(offer.pet) > value(weakest) * 1.25)) run = releasePet(run, weakest.id);
            }
            for (let pick = 0; pick < 5; pick++) {
                const offers = run.shop.map((offer, index) => ({ index, score: value(offer.pet) / Math.max(1, offer.cost), affordable: offerCost(run, offer) <= run.valor }));
                const next = offers.filter(offer => offer.affordable).sort((a, b) => b.score - a.score)[0];
                if (!next) break;
                const bought = buyOffer(run, next.index); if (bought === run) break; run = bought;
            }
            if (run.roster.length < 5 && run.valor > 1) run = rerollShop(run);
            if (run.roster.length === 5) {
                const relic = run.relicShop.map(relicDef).filter(def => def.cost <= run.valor)
                    .sort((a, b) => ((b.valorPerRound ?? 0) * Math.max(0, 7 - run.round) + (b.stat?.atk ?? 0) * 20 + (b.stat?.hp ?? 0) * 15 + (b.mods?.chainPct ?? 0) * 20 + (b.mods?.lifestealPct ?? 0) * 20)
                        - ((a.valorPerRound ?? 0) * Math.max(0, 7 - run.round) + (a.stat?.atk ?? 0) * 20 + (a.stat?.hp ?? 0) * 15 + (a.mods?.chainPct ?? 0) * 20 + (a.mods?.lifestealPct ?? 0) * 20))[0];
                if (relic) run = buyRelic(run, relic.id);
                run = buyItem(run, 'whetstone');
            }
        } else {
            const bought = buyOffer(run, 0); if (bought !== run) run = bought;
        }
        run = setField(run, run.roster.map(pet => pet.id));
        const pets = fieldedPets(run);
        assert.ok(pets.length > 0);
        const upgraded = applyGauntletBuffs(pets, run.buffs);
        const squad = applySynergiesToSquad(upgraded, resolveSynergies(upgraded));
        const units = squad.map((pet, col) => ({ pet, row: policy === 'draft-and-position' && ['sage', 'tracker'].includes(derivePetRole(pet).role) ? 2 : 0, col }));
        // The production enemyUnits rule: defenders front, assassins/trackers
        // back, others middle, with every row centered across BOARD_COLS.
        const rows = [[], [], []] as Array<typeof squad>;
        for (const pet of enemySquadForRound(run)) { const role = derivePetRole(pet).role; rows[role === 'defender' ? 0 : role === 'assassin' || role === 'tracker' ? 2 : 1].push(pet); }
        const enemies = rows.flatMap((pets, row) => pets.map((pet, col) => ({ pet, row, col: Math.min(BOARD_COLS - 1, Math.max(0, Math.round((BOARD_COLS - pets.length) / 2)) + col) })));
        // This seed is the exact PetGauntlet startRound / server replay rule.
        const battle = runPetGridBattle(units, enemies, (run.seed * 7919 + run.round * 104729) >>> 0, { accuracy: false, playerMods: boardModsFromRelics(run.relics) });
        assert.ok(['win', 'loss', 'draw'].includes(battle.result));
        fights++;
        run = applyRoundResult(beginFight(run), battle.result === 'win');
        assert.ok(run.valor >= 0 && run.hearts >= 0 && run.round <= run.maxRounds);
    }
    assert.ok(run.status === 'won' || run.status === 'lost');
    runs.push({ seed, policy, cleared: run.roundsCleared, terminal: run.status, fights });
}
const summary = {
    evidence: 'Deterministic local production-resolver probes; bounded public-sheet policies, not optimized human playtesting. Gauntlet includes real enemy role placement, centering, merges, stat buffs, relics and synergies.',
    gauntlet: ['draft-and-position', 'first-offer-front-row'].map(policy => { const rows = runs.filter(row => row.policy === policy); return { policy, runs: rows.length, fullClears: rows.filter(row => row.terminal === 'won').length, meanRoundsCleared: rows.reduce((sum, row) => sum + row.cleared, 0) / rows.length, fights: rows.reduce((sum, row) => sum + row.fights, 0) }; }),
    runs,
};
writeFileSync('docs/audits/pet-battle-unification/gauntlet-balance-report.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, runs: undefined }, null, 2));
