// Audit actual generated opposition, including starters/evolutions and single-pet
// practice. Unlike the species balance matrix, this crosses rarity boundaries.
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { buildColosseumAiTeam, buildShowdownAiTeam, chooseShowdownAiCommands } from '../api/_pet-showdown/ai.ts';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.ts';
import { SHOWDOWN_FORMAT_SIZE, SHOWDOWN_TURN_CAP } from '../shared/pet-showdown-contract.ts';

const args = process.argv.slice(2);
const seeds = args.includes('--seeds') ? Number(args[args.indexOf('--seeds') + 1]) : 24;
if (!Number.isInteger(seeds) || seeds < 1) throw new Error('Use --seeds with a positive integer.');
const legacy = args.includes('--legacy');
const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : '1v1';
const fieldSize = SHOWDOWN_FORMAT_SIZE[format];
const bench = args.includes('--bench') ? Number(args[args.indexOf('--bench') + 1]) : 0;
if (!fieldSize || !Number.isInteger(bench) || bench < 0 || bench > 2) throw new Error('Use --format 1v1|2v2|3v3 and --bench 0..2.');
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const tiers = ['scrapper', 'warrior', 'champion', 'sparring'];
const rows = new Map();
const examples = [];
const templates = Object.values(PET_CATALOG).filter(t => Array.isArray(t.jutsus));
const fraction = (a, b) => Number((a / Math.max(1, b)).toFixed(4));
for (const level of [1, 25, 50, 100]) for (const tpl of templates) for (const tier of tiers) for (let seed = 1; seed <= seeds; seed++) {
    const policy = tier === 'sparring' ? (legacy ? tiers[(seed - 1) % 3] : 'warrior') : tier;
    const earned = level - 1, each = Math.floor(earned / 4);
    const pet = {
        ...tpl, id: 'audit-player', templateId: tpl.id, level,
        growthBaseStats: { hp: tpl.hp, attack: tpl.attack, defense: tpl.defense, speed: tpl.speed },
        growthAllocation: { vitality: each + (earned % 4 > 0 ? 1 : 0), power: each + (earned % 4 > 1 ? 1 : 0), guard: each + (earned % 4 > 2 ? 1 : 0), agility: each },
    };
    const companions = templates.filter(t => t.rarity === tpl.rarity && t.wildSpawnable !== false && t.id !== tpl.id);
    const playerPets = [pet, ...Array.from({ length: fieldSize + bench - 1 }, (_, index) => {
        const ally = companions[(seed + index * 7) % companions.length];
        return { ...pet, ...ally, id: `audit-ally-${index}`, templateId: ally.id, level,
            growthBaseStats: { hp: ally.hp, attack: ally.attack, defense: ally.defense, speed: ally.speed },
            growthAllocation: pet.growthAllocation };
    })];
    const opposition = legacy
        ? buildShowdownAiTeam(playerPets, playerPets.length, policy, seed + 104729, { mirrorLevels: tier === 'sparring' })
        : buildColosseumAiTeam(playerPets, playerPets.length, policy, seed + 104729, tier === 'sparring');
    const makeSession = () => createShowdownSession({ sessionId: 'audit', playerName: 'audit', format, tier: policy, seed: seed + 7919, playerPets, enemyPets: opposition.pets, enemyTeamName: opposition.teamName, rewardEligible: false });
    const initial = makeSession();
    const key = `${level}/${tpl.rarity}/${tier}`;
    const row = rows.get(key) ?? { level, rarity: tpl.rarity, tier, matches: 0, wins: 0, rounds: 0, openingHits: 0, openingOneShots: 0, basicOneShots: 0, enemyOpeningHits: 0, enemyOpeningOneShots: 0, hitFractions: [] };
    for (const side of ['player', 'enemy']) {
        const other = side === 'player' ? 'enemy' : 'player';
        for (const [moveIndex, move] of initial[side][0].moves.entries()) {
            if (move.hold > 0 || move.cls === 'status') continue;
            const session = makeSession();
            const commands = [{ kind: 'move', petId: session[side][0].id, targetId: session[other][0].id, moveIndex }];
            // Rest supplies an unguarded full-HP target and no incoming damage.
            const rests = session[other].filter(p => !p.benched).map(p => ({ kind: 'rest', petId: p.id }));
            const maxHp = session[other][0].maxHp;
            const events = resolveShowdownRound(session, side === 'player' ? commands : rests, side === 'enemy' ? commands : rests);
            const target = events.find(e => e.t === 'action' && e.actorId === initial[side][0].id)?.targets[0];
            if (!target || target.damage <= 0) continue;
            if (side === 'player') {
                row.openingHits++;
                row.hitFractions.push(target.damage / maxHp);
                if (target.ko) {
                    row.openingOneShots++;
                    if (moveIndex === 0) row.basicOneShots++;
                    if (examples.length < 16) examples.push({ level, tier, player: tpl.name, enemy: initial.enemy[0].name, move: move.name, damage: target.damage, enemyHp: maxHp, playerAtk: initial.player[0].attack, enemyDef: initial.enemy[0].defense });
                }
            } else {
                row.enemyOpeningHits++;
                if (target.ko) row.enemyOpeningOneShots++;
            }
        }
    }
    const bout = makeSession();
    while (!bout.finished && bout.round <= SHOWDOWN_TURN_CAP) resolveShowdownRound(bout, chooseShowdownAiCommands(bout, 'player'), chooseShowdownAiCommands(bout, 'enemy'));
    if (!bout.finished) throw new Error('Unresolved audit bout');
    row.matches++;
    row.wins += bout.outcome === 'win' ? 1 : 0;
    row.rounds += bout.round;
    rows.set(key, row);
}
const summary = [...rows.values()].map(({ hitFractions, ...r }) => {
    hitFractions.sort((a, b) => a - b);
    return { ...r, winRate: fraction(r.wins, r.matches), meanRounds: fraction(r.rounds, r.matches), openingOneShotRate: fraction(r.openingOneShots, r.openingHits), enemyOpeningOneShotRate: fraction(r.enemyOpeningOneShots, r.enemyOpeningHits), medianHitHpFraction: Number((hitFractions[Math.floor(hitFractions.length / 2)] ?? 0).toFixed(4)) };
});
const report = { legacy, format, bench, seeds, templates: templates.length, matches: summary.reduce((s, r) => s + r.matches, 0), assumptions: 'Balanced growth, no player trait/gear; all legal lead opening damaging moves tested independently against full HP, then AI-vs-AI bouts using selected tier policy on both sides. Companions rotate by seed within the lead rarity. Legacy Sparring cycles tiers uniformly. Damage excludes later DoT; one-shots use the authoritative KO verdict. Both versions use the corrected side-aware healing policy.', rows: summary, examples };
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
