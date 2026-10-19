import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rawPetPool } from '../shinobij.client/src/data/pet-pool.js';
import { balanceBuiltInPetTemplate } from '../shinobij.client/src/lib/pet-balance.js';
import { normalizePetGrowth, sanitizeGrowthAllocation } from '../api/pet/_growth.js';
import { createLiveCinematicDuel, createLivePartyCinematicDuel, stepCinematicDuel, finishCinematicDuel } from '../shinobij.client/src/lib/pet-duel-cinematic.js';
import { DUEL_TPS } from '../shinobij.client/src/lib/pet-duel-sim.js';
import type { Pet, PetGrowthAllocation } from '../shinobij.client/src/types/pet.js';

const args = process.argv.slice(2);
const option = (key: string, fallback: string) => args.find(value => value.startsWith('--' + key + '='))?.split('=').slice(1).join('=') ?? fallback;
const profile = option('profile', 'trace');
if (!['trace', 'matrix'].includes(profile)) throw new Error('Choose --profile=trace or --profile=matrix.');
const candidatePowers = option('candidate-powers', 'off') === 'on';
const approachDiagnostic = option('approach', 'off') === 'on';
const traceDetails = option('trace-details', 'off') === 'on';
const contactDiagnostic = option('contact-seam', 'off') === 'on';
const noHealingDiagnostic = option('no-heal', 'off') === 'on';
const output = resolve(option('out', 'release-audit/pet-spatial-calibration-' + profile + '.json'));
const templates = rawPetPool.map(balanceBuiltInPetTemplate);
const roles = ['defender', 'tracker', 'assassin', 'sage'] as const;
const rarities = ['standard', 'rare', 'legendary', 'mythic'] as const;
const representatives = rarities.flatMap(rarity => roles.flatMap(role => {
    const pet = templates.find(template => template.rarity === rarity && template.role === role);
    return pet ? [pet] : [];
}));
type Build = 'balanced' | 'vitality' | 'power' | 'guard' | 'agility';
function allocation(level: number, build: Build): PetGrowthAllocation {
    const out = { vitality: 0, power: 0, guard: 0, agility: 0 };
    let remaining = level - 1; const cap = Math.ceil(remaining / 2);
    if (build !== 'balanced') { out[build] = Math.min(cap, remaining); remaining -= out[build]; }
    const keys = Object.keys(out) as (keyof typeof out)[];
    while (remaining > 0) for (const key of keys) {
        if (remaining > 0 && out[key] < cap) { out[key]++; remaining--; }
    }
    return sanitizeGrowthAllocation(out, level);
}
function owned(template: Pet, level: number, build: Build, version: 'legacy-v1' | 'progression-v3', slot: number, gear = false): Pet {
    const raw = { ...template, id: template.id + '-fixture-' + slot, templateId: template.id, level, trait: undefined,
        growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
        growthAllocation: allocation(level, build), battleLoadoutVersion: version === 'legacy-v1' ? version : undefined,
        ...(gear ? { loadout: { pvp: build === 'guard' ? 'pvp-ironhide-barding' : 'pvp-arena-champion-regalia' } } : {}) };
    return normalizePetGrowth(raw as unknown as Record<string, unknown>) as unknown as Pet;
}
type Scenario = { id: string; a: Pet; b: Pet; level: number; build?: Build; enemyBuild?: Build; size?: 1 | 2; neutral?: boolean; gear?: boolean; seed?: number; graze?: boolean };
const scenarios: Scenario[] = [];
if (profile === 'trace') {
    for (const id of ['standard-0', 'standard-3', 'mythic-0', 'legendary-0']) {
        const template = templates.find(pet => pet.id === id)!;
        for (const seed of [1, 7, 42]) for (const graze of [false, true]) scenarios.push({ id: id + '-trace-' + seed + (graze ? '-contact-seam' : ''), a: template, b: template, level: 75, neutral: true, seed, graze });
    }
} else {
    const boundaries = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100];
    for (const template of representatives.filter(pet => pet.rarity === 'standard')) for (const level of boundaries) {
        scenarios.push({ id: template.id + '-boundary-' + level, a: template, b: template, level, neutral: true });
    }
    for (const template of representatives.filter(pet => pet.rarity !== 'standard')) for (const level of [20, 75, 100]) {
        scenarios.push({ id: template.id + '-rarity-' + level, a: template, b: template, level, neutral: true });
    }
    for (const template of representatives.filter(pet => pet.rarity === 'standard')) for (const build of ['vitality', 'power', 'guard', 'agility'] as Build[]) {
        scenarios.push({ id: template.id + '-build-' + build, a: template, b: template, level: 75, neutral: true, build });
    }
    for (let index = 0; index < representatives.length; index++) {
        const a = representatives[index]; const b = representatives[(index + 1) % representatives.length];
        scenarios.push({ id: a.id + '-counter-' + b.id, a, b, level: 75 });
        scenarios.push({ id: a.id + '-team-' + b.id, a, b, level: 75, size: 2, neutral: true });
        if (index % 2 === 0) scenarios.push({ id: a.id + '-gear', a, b: a, level: 100, neutral: true, build: 'guard', gear: true });
    }
}
const sourceFiles = ['shinobij.client/src/lib/pet-duel-cinematic.ts', 'shared/pet-battle-loadout.ts', 'shared/pet-ability-progression.ts', 'shared/pet-spatial-power.ts', 'shared/pet-ability-mastery.ts', 'api/pet/_growth.ts'];
const sourceFingerprint = () => createHash('sha256').update(sourceFiles.map(path => path + '\n' + readFileSync(path, 'utf8')).join('\n')).digest('hex');
const fingerprint = sourceFingerprint();
const rows: Record<string, unknown>[] = [];
const selectedScenarios = scenarios.filter(scenario => scenario.id.includes(option('only', '')));
if (!selectedScenarios.length) throw new Error('The selected scenario filter matches no fixtures.');
for (const scenario of selectedScenarios) for (const version of ['legacy-v1', 'progression-v3'] as const) for (const swap of [false, true]) {
    const a = owned(scenario.a, scenario.level, scenario.build ?? 'balanced', version, 0, scenario.gear);
    const b = owned(scenario.b, scenario.level, scenario.enemyBuild ?? 'balanced', version, 1, scenario.gear);
    if (scenario.neutral) { a.element = 'None'; b.element = 'None'; }
    const [left, right] = swap ? [b, a] : [a, b];
    const seed = scenario.seed ?? 7;
    if (contactDiagnostic) scenario.graze = true;
    const sim = scenario.size === 2 ? createLivePartyCinematicDuel(left, { ...right, id: right.id + '-reserve' }, right, { ...left, id: left.id + '-reserve' }, seed, 1, 1, false, scenario.gear ?? false, true, true, false)
        : createLiveCinematicDuel(left, right, seed, 1, 1, false, scenario.gear ?? false, true, null, true, false);
    if (noHealingDiagnostic) for (const fighter of sim.fighters) for (const ability of fighter.abilities) if (ability.kind === 'heal') ability.cdLeft = DUEL_TPS * 1000;
    if (candidatePowers && version === 'progression-v3') for (const f of sim.fighters) for (let index = 0; index < f.abilities.length; index++) {
        const source = f.pet.jutsus[index] as typeof f.pet.jutsus[number] & { tier?: string; upgrade?: string };
        const ab = f.abilities[index]; if (!source || ab.cls === 'support' || ab.isMove) continue;
        const tier = source.tier;
        const basePower = tier === 'basic' ? 135 : tier === 'advanced' ? 180 : tier === 'signature' ? 260 : 75;
        const mastery = source.upgrade === 'offense-mastery' ? 1.08 : source.upgrade === 'signature-mastery' ? 1.1 : 1;
        const budget = ['stun', 'freeze', 'confuse', 'movelock'].includes(ab.kind) ? .55 : ['burn', 'dot', 'wound', 'slow', 'mark', 'debuff'].includes(ab.kind) ? .65 : 1;
        ab.power = Math.round(basePower * Math.max(.85, Math.min(1.15, (Number(source.power) || 100) / mastery / 100)) * mastery * budget);
    }
    if (approachDiagnostic && version === 'progression-v3') for (const f of sim.fighters) {
        if (f.abilities.some(ability => ability.cls === 'melee')) f.basicRanged = false;
    }
    // Diagnostic-only seam: enable the existing contact tolerance without the
    // live profile's ability/style changes or clash. Never an acceptance run.
    if (scenario.graze) { for (const f of sim.fighters) f.brawl = true; sim.clashEnabled = false; }
    const stateTicks: Record<string, number> = {}, reasons: Record<string, number> = {};
    const whiffs: unknown[] = []; let eventCursor = 0; let firstHit = -1; let longestGap = 0; let lastHit = 0; let staticTicks = 0; let sumGap = 0; let samples = 0; let observedDotTicks = 0;
    const priorPos = new Map<string, [number, number]>();
    while (!sim.done) {
        const prior = new Map(sim.fighters.map(f => [f.id, { state: f.state, gap: f.targetId ? (() => { const target = sim.fighters.find(t => t.id === f.targetId); return target ? Math.hypot(f.x - target.x, f.y - target.y) : null; })() : null,
            lunge: f.lungeAbIdx, remaining: f.stateLeft, stamina: f.stamina, plan: f.aiPlan, reason: f.aiReason,
            hp: f.hp, burnLeft: f.statuses.burnLeft, burnDamage: f.statuses.burnDmg }]));
        stepCinematicDuel(sim);
        for (const f of sim.fighters) {
            const before = prior.get(f.id)!;
            if (before.hp > f.hp && before.burnDamage > 0 && before.burnLeft > 0 && before.burnLeft % Math.round(DUEL_TPS * .4) === 0) observedDotTicks++;
        }
        for (const event of sim.events.slice(eventCursor)) {
            if (event.type === 'hit' && (event.dmg ?? 0) > 0) { if (firstHit < 0) firstHit = event.t; longestGap = Math.max(longestGap, event.t - lastHit); lastHit = event.t; }
            if (event.type === 'whiff' && whiffs.length < 100) whiffs.push({ tick: event.t, actor: event.actorId, move: event.move, ...prior.get(event.actorId) });
        }
        eventCursor = sim.events.length;
        if (sim.t % DUEL_TPS === 0) for (const f of sim.fighters.filter(f => f.hp > 0)) {
            stateTicks[f.state] = (stateTicks[f.state] ?? 0) + 1; reasons[f.aiReason] = (reasons[f.aiReason] ?? 0) + 1;
            const old = priorPos.get(f.id); if (old && Math.hypot(f.x - old[0], f.y - old[1]) < .1) staticTicks++;
            priorPos.set(f.id, [f.x, f.y]);
            const foes = sim.fighters.filter(foe => foe.team !== f.team && foe.hp > 0);
            if (foes.length) { sumGap += Math.min(...foes.map(foe => Math.hypot(f.x - foe.x, f.y - foe.y))); samples++; }
        }
    }
    const result = finishCinematicDuel(sim);
    longestGap = Math.max(longestGap, sim.t - lastHit);
    const events = result.events; const hits = events.filter(e => e.type === 'hit');
    const control = result.snapshots.reduce((total, snap) => total + snap.actors.filter(actor => actor.statuses.includes('stun') || actor.statuses.includes('root')).length, 0) / DUEL_TPS;
    rows.push({ scenario: scenario.id, version, swap, species: [left.templateId, right.templateId], rarity: [left.rarity, right.rarity], role: [left.role, right.role], level: scenario.level,
        size: scenario.size ?? 1, seed, allocation: [left.growthAllocation, right.growthAllocation], gear: scenario.gear ?? false, diagnosticContactSeam: scenario.graze ?? false, candidatePowers, approachDiagnostic, noHealingDiagnostic,
        seconds: result.ticks / DUEL_TPS, capped: result.ticks >= DUEL_TPS * 75, terminalElimination: ['player', 'enemy'].some(team => !sim.fighters.some(fighter => fighter.team === team && fighter.hp > 0)), lastKoSeconds: Math.max(-1, ...events.filter(event => event.type === 'ko').map(event => event.t / DUEL_TPS)), result: result.result,
        hitCount: hits.length, hitMoves: Object.fromEntries([...new Set(hits.map(event => event.move ?? 'ordinary'))].map(move => [move, hits.filter(event => (event.move ?? 'ordinary') === move).length])), directDamage: hits.reduce((n, e) => n + Math.max(0, e.dmg ?? 0), 0),
        admittedAbilities: sim.fighters.map(f => ({ id: f.id, version: f.pet.battleLoadoutVersion, abilities: f.abilities.map(ab => ({ name: ab.name, kind: ab.kind, power: ab.power, signature: ab.signature })) })),
        healCount: events.filter(e => e.type === 'heal').length, healing: events.filter(e => e.type === 'heal').reduce((n, e) => n + Math.max(0, e.dmg ?? 0), 0),
        shields: events.filter(e => e.type === 'shield').length, controlSeconds: control, observedHpLossDotTicksLowerBound: observedDotTicks, signatureCount: events.filter(e => e.type === 'ultimate').length,
        firstSignatureSeconds: (events.find(e => e.type === 'ultimate')?.t ?? -DUEL_TPS) / DUEL_TPS, whiffCount: events.filter(e => e.type === 'whiff').length,
        firstHitSeconds: firstHit / DUEL_TPS, longestNoHitSeconds: longestGap / DUEL_TPS, averageNearestGap: samples ? sumGap / samples : null,
        staticSampleFraction: samples ? staticTicks / samples : 0, finalHealth: sim.fighters.map(f => ({ id: f.id, hp: Math.max(0, f.hp), maxHp: f.maxHp, stamina: f.stamina })),
        stateSamples: stateTicks, topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 8), ...(profile === 'trace' || traceDetails ? { whiffs } : {}) });
    if (rows.length % 20 === 0) { process.stdout.write(JSON.stringify({ progress: rows.length, total: selectedScenarios.length * 4 }) + '\n'); mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify({ fingerprint, profile, provisional: true, rows }, null, 2)); }
}
const median = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
const summary = ['legacy-v1', 'progression-v3'].map(version => {
    const selected = rows.filter(row => row.version === version && !row.diagnosticContactSeam);
    return { version, runs: selected.length, caps: selected.filter(row => row.capped).length, medianSeconds: median(selected.map(row => row.seconds as number)), medianHits: median(selected.map(row => row.hitCount as number)),
        medianNoHitSeconds: median(selected.map(row => row.longestNoHitSeconds as number)), outcomes: Object.fromEntries(['win', 'loss', 'draw'].map(result => [result, selected.filter(row => row.result === result).length])) };
});
mkdirSync(resolve(output, '..'), { recursive: true });
const finalFingerprint = sourceFingerprint();
writeFileSync(output, JSON.stringify({ fingerprint, finalFingerprint, stale: fingerprint !== finalFingerprint, profile, assumptions: 'Canonical species templates, authoritative growth, equal earned budgets, identical seeds, swapped sides, deterministic accuracy, no consumables. Contact and approach seams are diagnostic only. Matrix seed7 is representative coverage, not a win-rate estimate. Observed DoT counts require scheduled ticks with visible HP loss, so simultaneous healing can make them a lower bound.', representatives: representatives.map(p => ({ id: p.id, role: p.role, rarity: p.rarity })), summary, rows }, null, 2));
process.stdout.write(JSON.stringify({ output, summary }) + '\n');
