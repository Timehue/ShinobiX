/** Current Dungeon command boss against balanced-growth catalog fixtures. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { buildDungeonCommandBeast } from '../api/pet/_dungeon-command-beast.js';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.js';
import { chooseShowdownAiCommands } from '../api/_pet-showdown/ai.js';
import type { Pet } from '../api/_pet-sim/pet-types.js';

const rows: Array<{ species: string; rarity: string; level: number; seed: number; outcome: string; rounds: number }> = [];
let openingHits = 0, openingFullHealthKos = 0;
for (const tpl of (Object.values(PET_CATALOG) as unknown as Pet[]).filter(pet => Array.isArray(pet.jutsus))) {
    for (const level of [45, 55, 65]) for (const seed of [771, 1771]) {
        const earned = level - 1, each = Math.floor(earned / 4);
        const player: Pet = { ...tpl, id: 'audit-player', templateId: tpl.id, level, trait: undefined, loadout: undefined,
            growthBaseStats: { hp: tpl.hp, attack: tpl.attack, defense: tpl.defense, speed: tpl.speed },
            growthAllocation: { vitality: each + (earned % 4 > 0 ? 1 : 0), power: each + (earned % 4 > 1 ? 1 : 0), guard: each + (earned % 4 > 2 ? 1 : 0), agility: each } };
        const make = () => createShowdownSession({ sessionId: 'dungeon-audit', playerName: 'Audit', format: '1v1', tier: 'champion', seed,
            playerPets: [player], enemyPets: [buildDungeonCommandBeast()], rewardEligible: false });
        for (const side of ['player', 'enemy'] as const) {
            const original = make(), opposite = side === 'player' ? 'enemy' : 'player';
            for (const [moveIndex, move] of original[side][0].moves.entries()) {
                if (move.signature || move.hold > 0 || move.cost > original[side][0].stamina) continue;
                const battle = make();
                const command = { kind: 'move' as const, petId: battle[side][0].id, moveIndex, targetId: battle[opposite][0].id };
                const idle = { kind: 'rest' as const, petId: battle[opposite][0].id };
                const events = resolveShowdownRound(battle, side === 'player' ? [command] : [idle], side === 'enemy' ? [command] : [idle]);
                for (const event of events) if (event.t === 'action' && event.actorId === command.petId) for (const target of event.targets) if (target.damage > 0) {
                    openingHits++; if (target.ko) openingFullHealthKos++;
                }
            }
        }
        const battle = make();
        while (!battle.finished && battle.round < 100) resolveShowdownRound(battle, chooseShowdownAiCommands(battle, 'player'), chooseShowdownAiCommands(battle, 'enemy'));
        assert.ok(battle.finished, `${tpl.name}: command battle must terminate`);
        rows.push({ species: tpl.name, rarity: tpl.rarity, level, seed, outcome: battle.outcome!, rounds: battle.round });
    }
}
assert.equal(openingFullHealthKos, 0);
assert.ok(openingHits > 0, 'opening damage coverage must be nonempty');
const summary = [45, 55, 65].flatMap(level => ['standard', 'rare', 'legendary', 'mythic'].map(rarity => {
    const group = rows.filter(row => row.level === level && row.rarity === rarity);
    return { level, rarity, matches: group.length, playerWins: group.filter(row => row.outcome === 'win').length,
        draws: group.filter(row => row.outcome === 'draw').length, meanRounds: group.reduce((sum, row) => sum + row.rounds, 0) / group.length };
}));
const report = { evidence: 'Unpaid production command resolver, fixed boss, balanced growth, no player gear or trait, champion public-sheet policy for both seats. Progression comparison, not ranked parity or optimized human play.', matches: rows.length, openingHits, openingFullHealthKos, summary, rows };
writeFileSync('docs/audits/pet-battle-unification/dungeon-command-balance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
