import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TACTICS_ROSTER, tacticsPreset } from '../shared/pet-tactics-roster.js';
import { createTacticsBattle, petSheets, resolveTacticsRound } from '../api/_pet-tactics/engine.js';
import type { TacticsOrder, TacticsPetSheet, TacticsSeat } from '../shared/pet-tactics-contract.js';

/** Audit policies see only the public sheets. No RNG, hidden orders or internal conditions. */
export function choose(own: TacticsPetSheet[], enemy: TacticsPetSheet[], policy: string, round: number): TacticsOrder[] {
    const foes = enemy.filter(p => p.slot !== null && !p.ko);
    const field = own.filter(p => p.slot !== null && !p.ko).sort((a, b) => b.stats.speed - a.stats.speed);
    const plannedHp = new Map(foes.map(p => [p.slot!, p.hp]));
    const usedReserves = new Set<string>(); let signatureUsed = false;
    return field.map(pet => {
        if (policy === 'guard-spam') return { actorId: pet.id, kind: pet.stamina >= pet.guardCost ? 'guard' : 'rest' };
        const fallback: TacticsOrder = { actorId: pet.id, kind: 'rest' };
        const usable = [...pet.moves, ...(!signatureUsed ? [pet.signature] : [])].filter(m => m.available);
        if (policy === 'sustain-loop') {
            const heal = usable.find(m => m.kind === 'heal');
            const ally = field.filter(p => p.hp < p.maxHp * .8).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
            if (heal && ally) { signatureUsed ||= heal.id === pet.signature.id; return heal.id === pet.signature.id ? { kind: 'signature', actorId: pet.id, targetSlot: pet.slot! } : { kind: 'move', actorId: pet.id, moveId: heal.id, targetSlot: ally.slot! }; }
            return fallback;
        }
        if (policy === 'adaptive' && pet.stamina < 22) {
            const reserve = own.filter(p => p.slot === null && !p.ko && p.stamina >= 50 && !usedReserves.has(p.id)).sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
            if (reserve) { usedReserves.add(reserve.id); return { kind: 'switch', actorId: pet.id, reserveId: reserve.id }; }
        }
        const choices = usable.filter(m => m.power > 0).flatMap(move => foes.map(target => {
            const range = move.ranges.find(r => r.slot === target.slot)!;
            const expected = (range.min + range.max) / 2;
            const hp = policy === 'adaptive' ? plannedHp.get(target.slot!)! : target.hp;
            const dealt = Math.min(expected, Math.max(0, hp));
            const score = policy === 'adaptive'
                ? dealt + (expected >= hp && hp > 0 ? 80 : 0) - move.cost * .7 + (move.priority > 1 ? 8 : 0)
                : policy === 'ultimate-spam' && move.id === pet.signature.id ? 10000 : expected;
            return { move, target, expected, score: policy === 'adaptive' && hp <= 0 ? -10000 : score };
        })).sort((a, b) => b.score - a.score);
        const best = choices[0];
        if (policy === 'adaptive') {
            const ally = field.filter(p => p.hp < p.maxHp * .65).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
            const heal = usable.find(m => m.kind === 'heal');
            if (ally && heal && Math.min(ally.maxHp - ally.hp, ally.maxHp * .18) > (best?.score ?? 0) * 1.1) {
                signatureUsed ||= heal.id === pet.signature.id;
                return heal.id === pet.signature.id ? { kind: 'signature', actorId: pet.id, targetSlot: pet.slot! } : { kind: 'move', actorId: pet.id, moveId: heal.id, targetSlot: ally.slot! };
            }
            if (pet.stamina < 30 && (best?.move.id === 'basic' || !best) && round < 18) return fallback;
        }
        if (!best) return fallback;
        plannedHp.set(best.target.slot!, Math.max(0, plannedHp.get(best.target.slot!)! - best.expected));
        signatureUsed ||= best.move.id === pet.signature.id;
        return best.move.id === pet.signature.id ? { kind: 'signature', actorId: pet.id, targetSlot: best.target.slot! }
            : best.move.id === 'basic' ? { kind: 'basic', actorId: pet.id, targetSlot: best.target.slot! }
                : { kind: 'move', actorId: pet.id, moveId: best.move.id, targetSlot: best.target.slot! };
    });
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
const team = (offset: number, preset: number) => [0, 1, 2, 3].map(i => tacticsPreset(TACTICS_ROSTER[(offset + i * 3) % 12].id, preset));
const summary: Record<string, unknown> = { ruleset: 'pet-tactics-v1', evidence: 'Deterministic automated simulation; not human playtesting or full-roster certification.' };
const damagePct: number[] = []; let signatures = 0, fullHealthKos = 0, earliest = Infinity;
for (const species of TACTICS_ROSTER) for (const opponent of TACTICS_ROSTER) for (let seed = 0; seed < 5; seed++) {
    const squad = (id: string) => [tacticsPreset(id), ...TACTICS_ROSTER.filter(p => p.id !== id).slice(0, 3).map(p => tacticsPreset(p.id))];
    const battle = createTacticsBattle('audit', squad(species.id), squad(opponent.id), seed);
    battle.round = 3; battle.teams.a[0].meter = 100; battle.teams.a[0].fieldRounds = 3;
    const script = resolveTacticsRound(battle, [{ kind: 'signature', actorId: 'a-0', targetSlot: 0 }, { kind: 'rest', actorId: 'a-1' }], [{ kind: 'rest', actorId: 'b-0' }, { kind: 'rest', actorId: 'b-1' }]);
    const action = script.events.filter(e => e.t === 'action').find(e => e.super)!;
    if (species.signature.power) { signatures++; damagePct.push(action.targets[0].damage / battle.teams.b[0].maxHp); fullHealthKos += Number(battle.teams.b[0].ko); }
}
damagePct.sort((a, b) => a - b);
summary.signatureProbe = { hits: signatures, fullHealthKos, medianMaxHpPct: damagePct[Math.floor(damagePct.length / 2)], maxHpPct: damagePct.at(-1) };
const matchups: unknown[] = [];
for (const opponent of ['highest-damage', 'ultimate-spam', 'guard-spam', 'sustain-loop']) {
    const scores: number[] = [], durations: number[] = [], usage = new Set<string>(); let caps = 0;
    for (let sample = 0; sample < 120; sample++) {
        let pairScore = 0;
        for (const swap of [false, true]) {
            const a = team(sample % 12, sample % 2), b = team((sample * 7 + 5) % 12, (sample >> 1) % 2);
            const battle = createTacticsBattle('audit', swap ? b : a, swap ? a : b, 90731 + sample);
            const adaptiveSeat: TacticsSeat = swap ? 'b' : 'a';
            while (!battle.result) {
                const aSheets = petSheets(battle, 'a'), bSheets = petSheets(battle, 'b');
                const aOrders = choose(aSheets, bSheets, adaptiveSeat === 'a' ? 'adaptive' : opponent, battle.round + 1);
                const bOrders = choose(bSheets, aSheets, adaptiveSeat === 'b' ? 'adaptive' : opponent, battle.round + 1);
                for (const order of adaptiveSeat === 'a' ? aOrders : bOrders) usage.add(order.kind);
                const { events } = resolveTacticsRound(battle, aOrders, bOrders);
                if (events.some(e => e.t === 'action' && e.super)) earliest = Math.min(earliest, battle.round);
            }
            durations.push(battle.round); caps += Number(battle.reason === 'round limit');
            pairScore += battle.result === 'draw' ? .5 : battle.result === adaptiveSeat ? 1 : 0;
        }
        scores.push(pairScore / 2);
    }
    const score = scores.reduce((a, b) => a + b, 0) / scores.length;
    const n = scores.length, z = 1.96, divisor = 1 + z * z / n;
    const center = (score + z * z / (2 * n)) / divisor;
    const radius = z * Math.sqrt(score * (1 - score) / n + z * z / (4 * n * n)) / divisor;
    durations.sort((a, b) => a - b);
    matchups.push({ opponent, matches: durations.length, pairedSeedSamples: scores.length, adaptiveScore: score,
        descriptiveWilson95Interval: [Math.max(0, center - radius), Math.min(1, center + radius)],
        medianRounds: durations[Math.floor(durations.length / 2)], p90Rounds: durations[Math.floor(durations.length * .9)], roundCapMatches: caps, adaptiveActionKinds: [...usage].sort() });
}
summary.policyComparisons = matchups; summary.earliestSignatureRound = earliest;
summary.limitations = 'Policies are deliberately bounded public-state heuristics. Paired intervals are approximate; repeated squad patterns are correlated. Human decision quality, species win rates, competitive meta and production latency require separate validation.';
const output = process.argv[2] ?? 'docs/audits/pet-tactics-prototype/balance-report.json';
await writeFile(resolve(output), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (fullHealthKos || earliest < 4) process.exitCode = 1;
}
