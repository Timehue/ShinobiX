// Real generated opponents and live round resolution. Optional --ready-round
// is an explicitly labelled tuning probe, not a production rule override.
import { writeFileSync } from 'node:fs';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { buildColosseumAiTeam, chooseShowdownAiCommands } from '../api/_pet-showdown/ai.ts';
import { createShowdownSession, resolveShowdownRound } from '../api/_pet-showdown/engine.ts';
import { SHOWDOWN_FORMAT_SIZE, SHOWDOWN_METER_MAX } from '../shared/pet-showdown-contract.ts';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seeds = Number(option('seeds', 8)), readyRound = Number(option('ready-round', 0));
const bench = Number(option('bench', 0));
const formats = option('formats', '1v1,2v2,3v3').split(',');
const out = option('out', '');
if (!Number.isInteger(seeds) || seeds < 1 || ![0, 1, 2].includes(bench) || ![0, 2, 3, 4].includes(readyRound) || formats.some(f => !SHOWDOWN_FORMAT_SIZE[f])) throw new Error('Invalid audit arguments');
const templates = Object.values(PET_CATALOG);
const rows = new Map(), firstReadyRounds = [], firstCastRounds = [], missedExamples = [];
const fraction = (a, b) => Number((a / Math.max(1, b)).toFixed(4));
const makePet = (tpl, id, level) => {
    const points = level - 1, each = Math.floor(points / 4);
    return { ...tpl, id, templateId: tpl.id, level,
        growthBaseStats: { hp: tpl.hp, attack: tpl.attack, defense: tpl.defense, speed: tpl.speed },
        growthAllocation: { vitality: each + (points % 4 > 0 ? 1 : 0), power: each + (points % 4 > 1 ? 1 : 0), guard: each + (points % 4 > 2 ? 1 : 0), agility: each } };
};
for (const format of formats) for (const level of [1, 25, 50, 100]) for (const template of templates) for (const tier of ['sparring', 'scrapper', 'warrior', 'champion']) for (let seed = 1; seed <= seeds; seed++) {
    const companions = templates.filter(t => t.rarity === template.rarity && t.wildSpawnable !== false && t.id !== template.id);
    const playerPets = [makePet(template, 'player-0', level), ...Array.from({ length: SHOWDOWN_FORMAT_SIZE[format] + bench - 1 }, (_, i) => makePet(companions[(seed + i * 7) % companions.length], `player-${i + 1}`, level))];
    const policy = tier === 'sparring' ? 'warrior' : tier;
    const opposition = buildColosseumAiTeam(playerPets, playerPets.length, policy, seed + 104729, tier === 'sparring');
    const battle = createShowdownSession({ sessionId: 'ultimate-audit', playerName: 'Audit', format, tier: policy, seed: seed + 7919,
        playerPets, enemyPets: opposition.pets, enemyTeamName: opposition.teamName, rewardEligible: false });
    const key = `${format}/${level}/${tier}`;
    const row = rows.get(key) ?? { format, level, tier, matches: 0, wins: 0, rounds: 0, playerReady: 0, playerCast: 0, eitherCast: 0, bothCast: 0, casts: 0, repeatedCasters: 0, earlyEnd: 0, selectedButLost: 0 };
    let ready = 0, firstCast = 0, playerCasts = 0, enemyCasts = 0;
    const used = new Map();
    while (!battle.finished) {
        if (readyRound && battle.round + 1 >= readyRound) for (const pet of [...battle.player, ...battle.enemy]) if (!pet.ko && !pet.benched && !used.has(pet.id)) {
            pet.meter = SHOWDOWN_METER_MAX;
            pet.readiness = Math.max(pet.readiness, pet.signatureMove.hold);
        }
        const available = battle.player.filter(p => !p.ko && !p.benched && !p.winded && !p.statuses.some(s => s.kind === 'stun') && p.meter >= SHOWDOWN_METER_MAX && p.readiness >= p.signatureMove.hold);
        if (!ready && available.length) ready = battle.round + 1;
        // The player deliberately uses an available ultimate. Enemy decisions
        // retain the actual selected AI policy, including its hold discipline.
        const commands = chooseShowdownAiCommands(battle, 'player').map(command => {
            if (!available.some(p => p.id === command.petId)) return command;
            const foe = battle.enemy.find(p => !p.ko && !p.benched);
            return { kind: 'super', petId: command.petId, targetId: 'targetId' in command ? command.targetId : foe.id };
        });
        const events = resolveShowdownRound(battle, commands, chooseShowdownAiCommands(battle, 'enemy'));
        for (const event of events) if (event.t === 'action' && event.super) {
            used.set(event.actorId, (used.get(event.actorId) ?? 0) + 1);
            if (event.actorSide === 'player') { playerCasts++; if (!firstCast) firstCast = battle.round; } else enemyCasts++;
        }
        row.selectedButLost += commands.filter(c => c.kind === 'super' && !events.some(e => e.t === 'action' && e.super && e.actorId === c.petId)).length;
        if (battle.round > 25) throw new Error('Fight did not finish');
    }
    row.matches++; row.wins += Number(battle.outcome === 'win'); row.rounds += battle.round;
    row.playerReady += Number(ready > 0); row.playerCast += Number(playerCasts > 0); row.eitherCast += Number(playerCasts + enemyCasts > 0); row.bothCast += Number(playerCasts > 0 && enemyCasts > 0);
    row.casts += playerCasts + enemyCasts; row.repeatedCasters += [...used.values()].filter(n => n > 1).length; row.earlyEnd += Number(battle.round < 3);
    if (ready) firstReadyRounds.push(ready); if (firstCast) firstCastRounds.push(firstCast);
    if (!ready && missedExamples.length < 12) missedExamples.push({ pet: template.name, level, format, tier, rounds: battle.round, outcome: battle.outcome });
    rows.set(key, row);
}
const raw = [...rows.values()];
const summarize = entries => {
    const totals = Object.fromEntries(['matches', 'wins', 'rounds', 'playerReady', 'playerCast', 'eitherCast', 'bothCast', 'casts', 'repeatedCasters', 'earlyEnd', 'selectedButLost'].map(k => [k, entries.reduce((s, r) => s + r[k], 0)]));
    return { ...totals, meanRounds: fraction(totals.rounds, totals.matches), playerReadyRate: fraction(totals.playerReady, totals.matches), playerCastRate: fraction(totals.playerCast, totals.matches), eitherCastRate: fraction(totals.eitherCast, totals.matches), bothCastRate: fraction(totals.bothCast, totals.matches), winRate: fraction(totals.wins, totals.matches), meanCasts: fraction(totals.casts, totals.matches) };
};
const report = { seeds, bench, readyRoundProbe: readyRound || null, assumptions: 'All 160 templates; levels 1/25/50/100; balanced growth; generated matched Sparring and all three chosen AI tiers; no player gear/traits; generated AI gear/traits follow the selected tier. Reserve count is recorded separately. Player uses AI policy until an ultimate is legal, then deliberately requests it. Availability is measured before commands, excluding stun/winded; actual casts can still be denied by KO/freeze/confusion. Both sides obey the same engine rules.', totals: summarize(raw), formats: formats.map(format => ({ format, ...summarize(raw.filter(r => r.format === format)) })), rows: raw.map(r => ({ format: r.format, level: r.level, tier: r.tier, ...summarize([r]) })), firstReadyRounds: Object.fromEntries([...new Set(firstReadyRounds)].sort((a,b)=>a-b).map(n => [n, firstReadyRounds.filter(r=>r===n).length])), firstCastRounds: Object.fromEntries([...new Set(firstCastRounds)].sort((a,b)=>a-b).map(n => [n, firstCastRounds.filter(r=>r===n).length])), missedExamples };
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, rows: undefined, missedExamples: undefined }, null, 2));
