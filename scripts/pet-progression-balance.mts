/**
 * Controlled progression evidence through the production Showdown engine.
 * Run: node --import tsx scripts/pet-progression-balance.mts
 * --quick limits natural fights to representative species; integrity remains full.
 * Targets are hypotheses reported alongside observations, never assertion bands.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PET_CATALOG } from '../api/pet/_catalog.js';
import { growthPointsEarned, growthAttributeCap, sanitizeGrowthAllocation, growthPointsSpent } from '../api/pet/_growth.js';
import { petPvpGear, petTraits } from '../api/_pet-sim/pet-config.js';
import type { Pet } from '../api/_pet-sim/pet-types.js';
import { createShowdownSession, resolveShowdownRound, sealShowdownPet, type ShowdownSession, type ShowdownPet } from '../api/_pet-showdown/engine.js';
import { buildColosseumAiTeam, chooseShowdownAiCommands } from '../api/_pet-showdown/ai.js';
import { SHOWDOWN_ELEMENT_BEATS, SHOWDOWN_TURN_CAP, SHOWDOWN_FORMAT_SIZE, type ShowdownCommand, type ShowdownFormat } from '../shared/pet-showdown-contract.js';
import { PET_ABILITY_MILESTONES, resolvePetAbilityProgression } from '../shared/pet-ability-progression.js';
import { tacticsPreset } from '../shared/pet-tactics-roster.js';

type Attribute = 'vitality' | 'power' | 'guard' | 'agility';
type Allocation = Record<Attribute, number>;
type Template = Record<string, unknown> & { id: string; rarity: string; element: string };
type Side = 'player' | 'enemy';
type RulesetVersion = 'progression-v3' | 'legacy-v2';
const attributes: Attribute[] = ['vitality', 'power', 'guard', 'agility'];
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const valueAfter = (flag: string, fallback: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const seedCount = Math.max(1, Math.min(8, Number(valueAfter('--seeds', '2')) || 2));
const seeds = Array.from({ length: seedCount }, (_, i) => 104729 + i * 25634);
const output = resolve(valueAfter('--output', 'docs/pet-progression-evidence/summary.json'));
const levels = [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100];
const naturalLevels = quick ? [1, 5, 10, 20, 50, 75, 100] : [1, 5, 10, 20, 30, 50, 75, 100];
const templates = Object.values(PET_CATALOG) as Template[];
const templateRoles = new Map(templates.map(template => [template.id, resolvePetAbilityProgression({ templateId: template.id, level: 1 }).role]));
const roleOf = (template: Template) => templateRoles.get(template.id)!;
const minimumReachableLevel = (template: Template) => /^starter-.+-l$/.test(template.id) ? 90 : /^starter-.+-r$/.test(template.id) ? 50 : 1;
const representatives = templates.filter((template, index) => templates.findIndex(other =>
    other.rarity === template.rarity && roleOf(other) === roleOf(template)) === index);
const naturalTemplates = quick ? representatives : templates;
const calibrationSpeciesIds = ['standard-28', 'rare-45', 'legendary-0', 'legendary-28'];
const sourcePaths = [
    'api/_pet-showdown/engine.ts', 'api/_pet-showdown/ai.ts', 'api/_pet-showdown/damage-pacing.ts',
    'shared/pet-ability-progression.ts', 'shared/pet-battle-stats.ts', 'api/pet/_growth.ts', 'scripts/pet-progression-balance.mts',
    'shared/pet-ability-mastery.ts', 'shared/pet-showdown-contract.ts', 'shared/pet-battle-loadout.ts',
    'shared/pet-tactics-roster.ts', 'shared/pet-tactics-build.ts', 'shared/pet-tactics-catalog.ts',
    'api/_pet-sim/pet-config.ts', 'api/_pet-stat-ceil.ts', 'api/pet/_catalog.ts',
];
const fingerprints = () => Object.fromEntries(sourcePaths.map(path =>
    [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const startFingerprints = fingerprints();
const started = Date.now();
const failures: string[] = [];
const warnings: string[] = [];
let fights = 0, replayChecks = 0, actionChecks = 0;
const balanced = (level: number): Allocation => {
    const earned = growthPointsEarned(level), each = Math.floor(earned / 4);
    const result = { vitality: each, power: each, guard: each, agility: each };
    for (let i = 0; i < earned % 4; i++) result[attributes[i]]++;
    return result;
};
const specialist = (level: number, attribute: Attribute): Allocation => {
    const earned = growthPointsEarned(level), cap = growthAttributeCap(level);
    const result = { vitality: 0, power: 0, guard: 0, agility: 0 };
    result[attribute] = Math.min(cap, earned);
    let remaining = earned - result[attribute];
    const others = attributes.filter(key => key !== attribute);
    while (remaining > 0) for (const key of others) if (remaining > 0 && result[key] < cap) { result[key]++; remaining--; }
    return result;
};
const reallocate = (level: number, attribute: Attribute, points: number): Allocation | null => {
    const result = balanced(level);
    if (result[attribute] + points > growthAttributeCap(level)) return null;
    let left = points;
    for (const key of attributes.filter(key => key !== attribute)) {
        const take = Math.min(left, result[key]); result[key] -= take; left -= take;
    }
    if (left) return null;
    result[attribute] += points;
    return result;
};
function owned(template: Template, level: number, allocation = balanced(level), extra: Record<string, unknown> = {}): Pet {
    return {
        ...template, templateId: template.id, level, trait: undefined, growthVersion: 2,
        growthBaseStats: { hp: template.hp, attack: template.attack, defense: template.defense, speed: template.speed },
        growthAllocation: allocation, ...extra,
    } as unknown as Pet;
}
function sessionFor(a: Pet[], b: Pet[], seed: number, format: ShowdownFormat = '1v1', rulesetVersion: RulesetVersion = 'progression-v3'): ShowdownSession {
    return createShowdownSession({
        sessionId: 'progression-evidence', playerName: 'Evidence', format, tier: 'warrior', seed,
        playerPets: a.map((pet, i) => ({ ...pet, id: 'a-' + i + '-' + pet.templateId })),
        enemyPets: b.map((pet, i) => ({ ...pet, id: 'b-' + i + '-' + pet.templateId })),
        enemyTeamName: 'Evidence', rulesetVersion, rewardEligible: false,
    });
}
type Metrics = {
    actions: number; useful: number; damage: number; healing: number; rest: number;
    guard: number; switches: number; overdrafts: number; skipped: number;
    firstActions: number; signatures: number; firstSignatureRound: number | null;
    reinforcements: number; attritionDamage: number; dotDamage: number;
    shieldActions: number; protectionActions: number; controlActions: number;
};
const metrics = (): Metrics => ({
    actions: 0, useful: 0, damage: 0, healing: 0, rest: 0, guard: 0, switches: 0,
    overdrafts: 0, skipped: 0, firstActions: 0, signatures: 0, firstSignatureRound: null,
    reinforcements: 0, attritionDamage: 0, dotDamage: 0, shieldActions: 0, protectionActions: 0, controlActions: 0,
});
type RoundMetrics = { actions: number; rest: number; guard: number; shield: number; damage: number; healing: number;
    attritionDamage: number; otherDotDamage: number; remainingHpFraction: number; livingPets: number; voluntarySwitches: number };
const roundMetrics = (): RoundMetrics => ({ actions: 0, rest: 0, guard: 0, shield: 0, damage: 0, healing: 0,
    attritionDamage: 0, otherDotDamage: 0, remainingHpFraction: 0, livingPets: 0, voluntarySwitches: 0 });
type Result = { win: boolean; rounds: number; judged: boolean; attrition: boolean; mine: Metrics; theirs: Metrics;
    normalMoveCount: number; startingFieldCount: number; signatureLearned: boolean;
    initialHp: number; trajectory: (RoundMetrics & { round: number })[] };
function fight(a: Pet[], b: Pet[], seed: number, format: ShowdownFormat, swapped: boolean, rulesetVersion: RulesetVersion = 'progression-v3'): Result {
    const session = sessionFor(swapped ? b : a, swapped ? a : b, seed, format, rulesetVersion);
    const startingTeam = swapped ? session.enemy : session.player;
    const normalMoveCount = startingTeam[0].moves.length;
    const startingFieldCount = startingTeam.filter(pet => !pet.benched).length;
    const signatureLearned = startingTeam[0].signatureMove.abilityId !== 'unavailable:signature'
        && (rulesetVersion === 'legacy-v2' || startingTeam[0].level >= (startingTeam[0].signatureMove.unlockLevel ?? 20));
    const collected = { player: metrics(), enemy: metrics() };
    const initialHp = [...session.player, ...session.enemy].reduce((sum, pet) => sum + pet.maxHp, 0);
    const trajectory: Result['trajectory'] = [];
    let judged = false, attrition = false;
    while (!session.finished && session.round <= SHOWDOWN_TURN_CAP) {
        const staminaBefore = new Map([...session.player, ...session.enemy].map(pet => [pet.id, pet.stamina]));
        const replay = fights % 1000 === 0 && session.round === 0 ? structuredClone(session) : null;
        const player = chooseShowdownAiCommands(session, 'player');
        const enemy = chooseShowdownAiCommands(session, 'enemy');
        const events = resolveShowdownRound(session, player, enemy);
        const trajectoryRound = { ...roundMetrics(), round: session.round };
        if (replay) {
            const repeated = resolveShowdownRound(replay, chooseShowdownAiCommands(replay, 'player'), chooseShowdownAiCommands(replay, 'enemy'));
            replayChecks++;
            if (JSON.stringify(events) !== JSON.stringify(repeated)) failures.push('Replay mismatch at fight ' + fights);
        }
        const first = events.find(event => event.t === 'action');
        if (first?.t === 'action') collected[first.actorSide].firstActions++;
        const guarded = new Set(events.flatMap(event => event.t === 'action'
            ? event.targets.filter(target => target.guarded && target.damage > 0).map(target => target.id) : []));
        for (const event of events) {
            if (event.t === 'end') judged ||= !!event.byJudge;
            if (event.t === 'skip') collected[event.actorSide].skipped++;
            if (event.t === 'switch') {
                if (event.reinforcement) collected[event.side].reinforcements++;
                else { collected[event.side].switches++; trajectoryRound.voluntarySwitches++; }
            }
            if (event.t === 'dot') {
                if (event.kind === 'attrition') {
                    collected[event.targetSide].attritionDamage += event.damage; attrition = true;
                    trajectoryRound.attritionDamage += event.damage;
                } else { collected[event.targetSide].dotDamage += event.damage; trajectoryRound.otherDotDamage += event.damage; }
            }
            if (event.t !== 'action') continue;
            const m = collected[event.actorSide]; m.actions++;
            const damage = event.targets.reduce((n, target) => n + target.damage, 0);
            const healing = event.targets.reduce((n, target) => n + target.heal, 0);
            m.damage += damage; m.healing += healing;
            trajectoryRound.actions++; trajectoryRound.damage += damage; trajectoryRound.healing += healing;
            trajectoryRound.rest += Number(event.moveKind === 'rest');
            trajectoryRound.guard += Number(event.moveKind === 'guard');
            trajectoryRound.shield += Number(event.targets.some(target => target.applied === 'shield'));
            const meaningfulEffect = event.targets.some(target => target.applied
                && !['failed', 'guard', 'rest', 'heal'].includes(target.applied));
            if (damage || healing || meaningfulEffect || event.moveKind === 'guard' && guarded.has(event.actorId)
                || event.moveKind === 'rest' && event.staminaAfter > (staminaBefore.get(event.actorId) ?? 0)) m.useful++;
            if (event.moveKind === 'rest') m.rest++;
            if (event.moveKind === 'guard') m.guard++;
            if (event.overexerted) m.overdrafts++;
            if (event.targets.some(target => target.applied === 'shield')) m.shieldActions++;
            if (event.targets.some(target => target.applied === 'protect')) m.protectionActions++;
            if (event.targets.some(target => ['stun', 'freeze', 'confuse'].includes(target.applied ?? ''))) m.controlActions++;
            if (event.super) { m.signatures++; m.firstSignatureRound ??= session.round; }
            if (event.targets.some(target => !Number.isFinite(target.damage) || !Number.isFinite(target.heal))) failures.push('Nonfinite event');
        }
        trajectoryRound.remainingHpFraction = [...session.player, ...session.enemy].reduce((sum, pet) => sum + pet.hp, 0) / initialHp;
        trajectoryRound.livingPets = [...session.player, ...session.enemy].filter(pet => !pet.ko).length;
        trajectory.push(trajectoryRound);
    }
    if (!session.finished || session.round > SHOWDOWN_TURN_CAP) failures.push('Unfinished or late-judged battle at fight ' + fights);
    fights++;
    if (fights % 2000 === 0) console.log('[progression evidence] fights ' + fights);
    return { win: session.outcome === (swapped ? 'loss' : 'win'), rounds: session.round, judged, attrition,
        mine: collected[swapped ? 'enemy' : 'player'], theirs: collected[swapped ? 'player' : 'enemy'],
        normalMoveCount, startingFieldCount, signatureLearned, initialHp, trajectory };
}
type Bucket = { count: number; wins: number; rounds: number[]; judged: number; attrition: number; mine: Metrics; firstSignatures: number[];
    kitSizes: number[]; startingFields: number[]; learnedSignatures: number;
    attritionHpFractions: number[]; phases: Record<'opening' | 'middle' | 'final', RoundMetrics & { observedRounds: number }> };
const buckets = new Map<string, Bucket>();
function record(group: string, result: Result): void {
    const bucket = buckets.get(group) ?? { count: 0, wins: 0, rounds: [], judged: 0, attrition: 0, mine: metrics(), firstSignatures: [],
        kitSizes: [], startingFields: [], learnedSignatures: 0, attritionHpFractions: [], phases: {
            opening: { ...roundMetrics(), observedRounds: 0 }, middle: { ...roundMetrics(), observedRounds: 0 }, final: { ...roundMetrics(), observedRounds: 0 } } };
    bucket.count++; bucket.wins += Number(result.win); bucket.rounds.push(result.rounds); bucket.judged += Number(result.judged);
    bucket.attrition += Number(result.attrition);
    bucket.kitSizes.push(result.normalMoveCount); bucket.startingFields.push(result.startingFieldCount);
    bucket.learnedSignatures += Number(result.signatureLearned);
    bucket.attritionHpFractions.push(result.trajectory.reduce((sum, round) => sum + round.attritionDamage, 0) / result.initialHp);
    for (const round of result.trajectory) {
        const phase = round.round <= 3 ? 'opening' : round.round > result.rounds - 3 ? 'final' : 'middle';
        const totals = bucket.phases[phase]; totals.observedRounds++;
        for (const key of Object.keys(roundMetrics()) as (keyof RoundMetrics)[]) totals[key] += round[key];
    }
    for (const key of Object.keys(bucket.mine) as (keyof Metrics)[]) {
        if (key !== 'firstSignatureRound') (bucket.mine[key] as number) += result.mine[key] as number;
    }
    if (result.mine.firstSignatureRound != null) bucket.firstSignatures.push(result.mine.firstSignatureRound);
    buckets.set(group, bucket);
}
const percentile = (values: number[], p: number): number | null => {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.floor((ordered.length - 1) * p)];
};
const distribution = (values: number[]) => ({
    n: values.length, min: values.length ? Math.min(...values) : null,
    p10: percentile(values, .1), median: percentile(values, .5), p90: percentile(values, .9),
    max: values.length ? Math.max(...values) : null,
    mean: values.length ? values.reduce((n, value) => n + value, 0) / values.length : null,
});
function summarizeBucket(bucket: Bucket) {
    return { n: bucket.count, winRate: bucket.wins / bucket.count, rounds: distribution(bucket.rounds),
        judgeRate: bucket.judged / bucket.count,
        attritionRate: bucket.attrition / bucket.count,
        usefulActionRate: bucket.mine.useful / Math.max(1, bucket.mine.actions),
        restRate: bucket.mine.rest / Math.max(1, bucket.mine.actions),
        guardRate: bucket.mine.guard / Math.max(1, bucket.mine.actions),
        firstActionsPerBattle: bucket.mine.firstActions / bucket.count,
        overdrafts: bucket.mine.overdrafts, switches: bucket.mine.switches, skipped: bucket.mine.skipped,
        voluntarySwitchesPerBattle: bucket.mine.switches / bucket.count,
        reinforcementsPerBattle: bucket.mine.reinforcements / bucket.count,
        attritionDamagePerBattle: bucket.mine.attritionDamage / bucket.count, dotDamagePerBattle: bucket.mine.dotDamage / bucket.count,
        shieldActionRate: bucket.mine.shieldActions / Math.max(1, bucket.mine.actions),
        protectionActionRate: bucket.mine.protectionActions / Math.max(1, bucket.mine.actions),
        controlActionRate: bucket.mine.controlActions / Math.max(1, bucket.mine.actions),
        damagePerBattle: bucket.mine.damage / bucket.count, healingPerBattle: bucket.mine.healing / bucket.count,
        signaturesPerBattle: bucket.mine.signatures / bucket.count, firstSignatureRound: distribution(bucket.firstSignatures),
        normalMoveCount: distribution(bucket.kitSizes), startingFieldCount: distribution(bucket.startingFields),
        signatureLearnedRate: bucket.learnedSignatures / bucket.count,
        attritionDamageFractionOfInitialRosterHp: distribution(bucket.attritionHpFractions),
        trajectory: Object.fromEntries(Object.entries(bucket.phases).map(([phase, totals]) => [phase, {
            observedRounds: totals.observedRounds, actionsPerRound: totals.actions / Math.max(1, totals.observedRounds),
            actionDamagePerRound: totals.damage / Math.max(1, totals.observedRounds), healingPerRound: totals.healing / Math.max(1, totals.observedRounds),
            attritionDamagePerRound: totals.attritionDamage / Math.max(1, totals.observedRounds),
            attritionShareOfReportedDamage: totals.attritionDamage / Math.max(1, totals.damage + totals.otherDotDamage + totals.attritionDamage),
            restRate: totals.rest / Math.max(1, totals.actions), guardRate: totals.guard / Math.max(1, totals.actions),
            shieldActionRate: totals.shield / Math.max(1, totals.actions),
            meanRemainingHpFraction: totals.remainingHpFraction / Math.max(1, totals.observedRounds),
            meanLivingPets: totals.livingPets / Math.max(1, totals.observedRounds),
            voluntarySwitchesPerRound: totals.voluntarySwitches / Math.max(1, totals.observedRounds),
        }])) };
}
function opponent(template: Template, relation: 'neutral' | 'advantage' | 'disadvantage'): Template {
    const element = relation === 'neutral' ? template.element : relation === 'advantage'
        ? SHOWDOWN_ELEMENT_BEATS[template.element]
        : Object.keys(SHOWDOWN_ELEMENT_BEATS).find(key => SHOWDOWN_ELEMENT_BEATS[key] === template.element);
    const pool = templates.filter(pet => pet.rarity === template.rarity && pet.element === element && pet.id !== template.id);
    return pool.find(pet => roleOf(pet) !== roleOf(template)) ?? pool[0] ?? template;
}
function teams(a: Template, b: Template, level: number, format: ShowdownFormat, bench: number, allocation = balanced(level), extra: Record<string, unknown> = {}): [Pet[], Pet[]] {
    const pool = templates.filter(pet => pet.rarity === a.rarity && pet.id !== a.id && pet.id !== b.id);
    const fill = Array.from({ length: SHOWDOWN_FORMAT_SIZE[format] - 1 + bench }, (_, index) => owned(pool[(index * 13) % pool.length] ?? a, level));
    return [[owned(a, level, allocation, extra), ...fill], [owned(b, level), ...fill]];
}

console.log('[progression evidence] integrity');
let sealedFixtures = 0, syntheticFormFixtures = 0;
for (const template of templates) for (const level of levels) {
    for (const allocation of [balanced(level), ...attributes.map(key => specialist(level, key))]) {
        const pet = owned(template, level, allocation);
        const seal = sealShowdownPet(pet, 'progression-v3');
        sealedFixtures++;
        syntheticFormFixtures += Number(level < minimumReachableLevel(template));
        const sanitized = sanitizeGrowthAllocation(allocation, level);
        if (growthPointsSpent(sanitized) !== growthPointsEarned(level)) failures.push('Lost legal allocation ' + template.id + ':' + level);
        if (!seal.moves.length) failures.push('Empty kit ' + template.id + ':' + level);
        for (const move of [...seal.moves, ...(level >= 20 ? [seal.signatureMove] : [])]) {
            if (!move.abilityId || (move.unlockLevel ?? 1) > level || move.cost > seal.maxStamina
                || !Number.isFinite(move.power)) failures.push('Illegal sealed ability ' + template.id + ':' + level + ':' + move.name);
        }
        if (seal.role !== roleOf(template)) failures.push('Wrong sealed role ' + template.id);
    }
}
const matchmaking = [100, 1, 1].map((level, i) => ({ ...owned(representatives[0], level), id: 'match-' + i }));
const ordinaryMatch = buildColosseumAiTeam(matchmaking, 3, 'warrior', 123, false);
const sparringMatch = buildColosseumAiTeam(matchmaking, 3, 'warrior', 123, true);
const matchmakingEvidence = {
    selectedLevels: matchmaking.map(pet => pet.level),
    ordinaryLevels: ordinaryMatch.pets.map(pet => pet.level), sparringLevels: sparringMatch.pets.map(pet => pet.level),
};
if (Number(ordinaryMatch.pets[0]?.level) < 100) failures.push('Low benches diluted ordinary opposition');
if (JSON.stringify(sparringMatch.pets.map(pet => pet.level)) !== JSON.stringify([100, 1, 1])) failures.push('Sparring slot mismatch');
let gearBoundChecks = 0, maximumGearDotPct = 0, maximumOffensiveHealingPct = 0;
for (const template of templates) for (const gear of petPvpGear) {
    for (const signature of [false, true]) {
        const raw = owned(template, 100, specialist(100, 'power'), { trait: 'Hollowborn', loadout: { pvp: gear.id } });
        const session = sessionFor([raw], [owned(template, 100, specialist(100, 'vitality'))], 123);
        const actor = session.player[0], target = session.enemy[0];
        if (signature && actor.signatureMove.kind !== 'lifesteal') continue;
        actor.readiness = 100; actor.meter = 100; actor.hp = 1;
        const beforeHp = actor.hp;
        const command: ShowdownCommand = signature
            ? { kind: 'super', petId: actor.id, targetId: target.id }
            : { kind: 'move', petId: actor.id, moveIndex: 0, targetId: target.id };
        resolveShowdownRound(session, [command], [{ kind: 'rest', petId: target.id }]);
        const healed = actor.hp - beforeHp;
        const dot = !signature ? Math.max(0, ...target.statuses.filter(status => status.kind === 'wound' || status.kind === 'burn').map(status => status.magnitude)) : 0;
        maximumGearDotPct = Math.max(maximumGearDotPct, dot / target.maxHp);
        maximumOffensiveHealingPct = Math.max(maximumOffensiveHealingPct, healed / actor.maxHp);
        if (dot > Math.round(target.maxHp * .05)) failures.push('Unbounded on-hit gear DoT ' + template.id + ':' + gear.id);
        if (healed > Math.round(actor.maxHp * .1)) failures.push('Unbounded offensive healing ' + template.id + ':' + gear.id);
        gearBoundChecks++;
    }
}

type Probe = { damage: number; remaining: number; maxHp: number; first: boolean; speed: number; pool: number; kind: string; power: number; cost: number };
function probe(template: Template, level: number, investment: Allocation, scenario: 'physical' | 'special' | 'advanced' | 'signature',
    investTarget: boolean, seed: number, swapped: boolean, prepared = false): Probe {
    const base = owned(template, level);
    const invested = owned(template, level, investment);
    const a = investTarget ? base : invested, b = investTarget ? invested : base;
    const session = sessionFor(swapped ? [b] : [a], swapped ? [a] : [b], seed);
    const source = (swapped ? session.enemy : session.player)[0];
    const target = (swapped ? session.player : session.enemy)[0];
    source.readiness = target.readiness = 100; source.meter = target.meter = 100;
    if (prepared) source.statuses.push({ kind: 'buff', rounds: 2, magnitude: 1.25, bornRound: 0 });
    const indexFor = (pet: ShowdownPet) => scenario === 'physical' ? 0
        : pet.moves.findIndex(move => move.abilityId?.includes(scenario === 'advanced' ? ':advanced' : ':basic'));
    const index = indexFor(source);
    const move = scenario === 'signature' ? source.signatureMove : source.moves[index];
    const attack: ShowdownCommand = scenario === 'signature'
        ? { kind: 'super', petId: source.id, targetId: target.id }
        : { kind: 'move', petId: source.id, moveIndex: index, targetId: target.id };
    const response: ShowdownCommand = { kind: 'move', petId: target.id, moveIndex: Math.max(0, indexFor(target)), targetId: source.id };
    const events = resolveShowdownRound(session, swapped ? [response] : [attack], swapped ? [attack] : [response]);
    const action = events.find(event => event.t === 'action' && event.actorId === source.id);
    const damage = action?.t === 'action' ? action.targets.filter(t => t.id === target.id).reduce((n, t) => n + t.damage, 0) : 0;
    const first = events.find(event => event.t === 'action');
    actionChecks++;
    return { damage, remaining: target.hp, maxHp: target.maxHp, first: first?.t === 'action' && first.actorId === source.id,
        speed: source.speed, pool: investTarget ? target.maxStamina : source.maxStamina,
        kind: move?.kind ?? 'unavailable', power: move?.power ?? 0, cost: move?.cost ?? 0 };
}
console.log('[progression evidence] action magnitudes');
const damageGroups = new Map<string, number[]>();
const damageOutliers: { id: string; level: number; scenario: string; kind: string; ratio: number }[] = [];
for (const template of templates) for (const level of [1, 10, 20, 30, 50, 75, 100]) {
    for (const scenario of ['physical', 'special', 'advanced', 'signature'] as const) {
        if (scenario === 'advanced' && level < 10 || scenario === 'signature' && level < 20) continue;
        for (const seed of seeds) for (const prepared of scenario === 'signature' ? [false, true] : [false]) {
            const result = probe(template, level, balanced(level), scenario, false, seed, false, prepared);
            const ratio = result.damage / result.maxHp;
            const label = scenario + (prepared ? '-prepared' : '');
            for (const group of [level + '/' + label, level + '/' + label + '/' + result.kind]) {
                const list = damageGroups.get(group) ?? []; list.push(ratio); damageGroups.set(group, list);
            }
            if (ratio > (scenario === 'signature' ? .65 : scenario === 'physical' ? .25 : .45)) damageOutliers.push({
                id: template.id, level, scenario: label, kind: result.kind, ratio,
            });
        }
    }
}
console.log('[progression evidence] natural tempo');
for (const template of naturalTemplates) for (const level of naturalLevels) {
    if (level < minimumReachableLevel(template)) continue;
    for (const bench of [0, 2]) for (const seed of seeds) for (const swapped of [false, true]) {
        const [a, b] = teams(template, opponent(template, 'neutral'), level, '1v1', bench);
        const result = fight(a, b, seed, '1v1', swapped);
        record('tempo/level-' + level + '/bench-' + bench, result);
        record('species/' + template.id + '/level-' + level + '/bench-' + bench, result);
        record('roles/' + roleOf(template) + '/level-' + level + '/bench-' + bench, result);
        record('rarities/' + template.rarity + '/level-' + level + '/bench-' + bench, result);
    }
}
for (const template of representatives) for (const level of naturalLevels) {
    for (const relation of ['neutral', 'advantage', 'disadvantage'] as const) for (const format of ['1v1', '2v2', '3v3'] as const) {
        if (relation === 'neutral' && format === '1v1') continue;
        for (const seed of seeds) for (const swapped of [false, true]) {
            const [a, b] = teams(template, opponent(template, relation), level, format, 2);
            record('matchup/' + relation + '/' + format + '/level-' + level, fight(a, b, seed, format, swapped));
        }
    }
}
console.log('[progression evidence] retired-residual held-out team outcomes');
for (const template of templates.filter(template => calibrationSpeciesIds.includes(template.id))) {
    for (const level of [1, 20, 50, 75, 100]) {
        for (const relation of ['neutral', 'advantage', 'disadvantage'] as const) for (const format of ['2v2', '3v3'] as const) {
            for (const seed of seeds) for (const swapped of [false, true]) {
                const [a, b] = teams(template, opponent(template, relation), level, format, 2);
                record('calibration/' + template.id + '/' + relation + '/' + format + '/level-' + level,
                    fight(a, b, seed, format, swapped));
            }
        }
    }
}
console.log('[progression evidence] equal-budget specialist outcomes');
for (const template of naturalTemplates) for (const level of quick ? [10, 50, 100] : [10, 20, 50, 75, 100]) {
    if (level < minimumReachableLevel(template)) continue;
    for (const attribute of attributes) for (const seed of seeds) for (const swapped of [false, true]) {
        const result = fight([owned(template, level, specialist(level, attribute))], [owned(template, level)], seed, '1v1', swapped);
        record('specialist/' + attribute + '/level-' + level, result);
        record('specialist-role/' + attribute + '/' + roleOf(template) + '/level-' + level, result);
    }
}
for (const template of representatives) for (const level of [75, 100]) {
    for (const attribute of attributes) for (const relation of ['neutral', 'advantage', 'disadvantage'] as const) {
        for (const seed of seeds) for (const swapped of [false, true]) {
            const result = fight([owned(template, level, specialist(level, attribute))],
                [owned(opponent(template, relation), level)], seed, '1v1', swapped);
            record('specialist-cross/' + attribute + '/' + relation + '/level-' + level, result);
            record('specialist-cross-role/' + attribute + '/' + roleOf(template) + '/' + relation + '/level-' + level, result);
        }
    }
    for (const attribute of attributes) for (const opposing of attributes) {
        if (attribute === opposing) continue;
        for (const seed of seeds) for (const swapped of [false, true]) {
            const result = fight([owned(template, level, specialist(level, attribute))],
                [owned(template, level, specialist(level, opposing))], seed, '1v1', swapped);
            record('specialist-pair/' + attribute + '-vs-' + opposing + '/level-' + level, result);
        }
    }
}
console.log('[progression evidence] saved-preset versus authored-kit outcomes');
for (const template of representatives) for (const level of [1, 5, 10, 20, 50, 75, 100]) {
    for (const preset of [0, 1]) for (const bench of [0, 2]) for (const seed of seeds) for (const swapped of [false, true]) {
        const [a, b] = teams(template, template, level, '1v1', bench);
        a[0] = owned(template, level, balanced(level), {
            rankedBuild: tacticsPreset(template.id, preset), battleLoadoutVersion: 'progression-v3',
        });
        const result = fight(a, b, seed, '1v1', swapped);
        record('saved-preset/preset-' + preset + '/level-' + level + '/bench-' + bench, result);
        record('saved-role/' + roleOf(template) + '/preset-' + preset + '/level-' + level + '/bench-' + bench, result);
        record('saved-rarity/' + template.rarity + '/preset-' + preset + '/level-' + level + '/bench-' + bench, result);
    }
}
console.log('[progression evidence] legal reallocation marginal scenarios');
type Marginal = { n: number; positive: number; negative: number; equal: number; differences: number[]; examples: unknown[]; survivalThresholdGains: number };
const marginals = new Map<string, Marginal>();
for (const template of naturalTemplates) for (const level of [10, 20, 75, 100]) {
    if (level < minimumReachableLevel(template)) continue;
    for (const attribute of attributes) for (const points of [1, 5, 10]) {
        const allocation = reallocate(level, attribute, points);
        if (!allocation) continue;
        if (JSON.stringify(sanitizeGrowthAllocation(allocation, level)) !== JSON.stringify(allocation)
            || growthPointsSpent(allocation) !== growthPointsEarned(level)) failures.push('Invalid marginal allocation ' + template.id + ':' + level);
        for (const scenario of attribute === 'agility' ? ['physical', 'advanced'] as const : ['physical', 'special'] as const) {
            for (const seed of seeds) for (const swapped of [false, true]) {
                const targetInvestment = attribute === 'vitality' || attribute === 'guard';
                const baseline = probe(template, level, balanced(level), scenario, targetInvestment, seed, swapped);
                const candidate = probe(template, level, allocation, scenario, targetInvestment, seed, swapped);
                const difference = attribute === 'power' ? candidate.damage - baseline.damage
                    : attribute === 'guard' ? baseline.damage - candidate.damage
                    : attribute === 'vitality' ? candidate.remaining - baseline.remaining
                    : Number(candidate.first) - Number(baseline.first);
                const key = attribute + '/points-' + points + '/level-' + level + '/' + scenario;
                const bucket = marginals.get(key) ?? { n: 0, positive: 0, negative: 0, equal: 0, differences: [], examples: [], survivalThresholdGains: 0 };
                bucket.n++; bucket.positive += Number(difference > 0); bucket.negative += Number(difference < 0); bucket.equal += Number(difference === 0);
                bucket.differences.push(difference);
                const beforeHits = Math.floor((baseline.maxHp - 1) / Math.max(1, baseline.damage));
                const afterHits = Math.floor((candidate.maxHp - 1) / Math.max(1, candidate.damage));
                bucket.survivalThresholdGains += Number(targetInvestment && afterHits > beforeHits);
                if (difference > 0 && bucket.examples.length < 3) bucket.examples.push({
                    speciesId: template.id, seed, swapped, baseline, candidate, difference, beforeHits, afterHits,
                });
                marginals.set(key, bucket);
            }
        }
    }
}
console.log('[progression evidence] retained-ruleset comparison');
for (const template of representatives) for (const level of [1, 20, 100]) {
    for (const bench of [0, 2]) for (const rulesetVersion of ['legacy-v2', 'progression-v3'] as const) {
        for (const seed of seeds) for (const swapped of [false, true]) {
            const [a, b] = teams(template, opponent(template, 'neutral'), level, '1v1', bench);
            record('before-after/' + rulesetVersion + '/level-' + level + '/bench-' + bench,
                fight(a, b, seed, '1v1', swapped, rulesetVersion));
        }
    }
}
console.log('[progression evidence] equipment, traits and extreme budgets');
for (const template of representatives) for (const level of [1, 75, 100]) {
    for (const gear of petPvpGear) for (const attribute of quick ? ['power'] as Attribute[] : attributes) {
        const extra = { loadout: { pvp: gear.id } };
        for (const swapped of [false, true]) {
            const result = fight([owned(template, level, specialist(level, attribute), extra)], [owned(opponent(template, 'neutral'), level)], seeds[0], '1v1', swapped);
            record('gear/' + gear.id + '/level-' + level, result);
        }
    }
    for (const trait of [...petTraits, 'Fateweaver', 'Hollowborn', 'Boonbringer']) {
        for (const swapped of [false, true]) {
            const result = fight([owned(template, level, balanced(level), { trait })], [owned(opponent(template, 'neutral'), level)], seeds[0], '1v1', swapped);
            record('trait/' + trait + '/level-' + level, result);
        }
    }
}
const marginalSummary = Object.fromEntries([...marginals].map(([key, bucket]) => [key, {
    n: bucket.n, improves: bucket.positive, regresses: bucket.negative, unchanged: bucket.equal,
    differences: distribution(bucket.differences), survivalThresholdGains: bucket.survivalThresholdGains, examples: bucket.examples,
}]));
for (const attribute of attributes) {
    const proven = [...marginals].filter(([key, bucket]) => key.startsWith(attribute + '/points-10/level-100/') && bucket.positive > 0);
    if (proven.length < 2) warnings.push(attribute + ' has fewer than two positive measured ten-point scenarios at level100');
}
const finalFingerprints = fingerprints();
if (JSON.stringify(startFingerprints) !== JSON.stringify(finalFingerprints)) warnings.push('Source changed during run: repeat after integration stabilizes');
const report = {
    generatedAt: new Date().toISOString(), evidenceTier: 'controlled-production-engine-simulation',
    mode: quick ? 'quick-representatives' : 'full-catalog', elapsedSeconds: (Date.now() - started) / 1000,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    sourceFingerprints: startFingerprints, finalSourceFingerprints: finalFingerprints,
    configuration: { species: templates.length, representatives: representatives.length, naturalSpecies: naturalTemplates.length,
        levels, naturalLevels, milestones: PET_ABILITY_MILESTONES, seeds, swappedSides: true, dailyRewards: false,
        practiceRewards: false, difficulty: 'warrior', formats: ['1v1', '2v2', '3v3'], benches: [0, 2],
        investmentPoints: [1, 5, 10], specialistBudgets: 'same earned points with legal attribute caps',
        reallocationDonorOrder: attributes,
        naturalPolicy: 'same server AI on both sides', duplicateSpeciesAllowedInSyntheticFixtures: true,
        trajectoryPhases: 'opening rounds1–3; final last3 after round3; middle all remaining rounds; both sides combined, reported event damage',
        naturalMatchupSelection: 'same rarity and element; first different role in catalog; diagnostic, not a complete role-power estimate',
        naturalFormLevelsReachableOnly: true,
        sealBoundaryIncludesSyntheticUnreachableForms: true,
        beforeAfter: 'same sealed raw fixtures, explicit retained legacy-v2 versus progression-v3',
        retiredResidualValidation: { speciesIds: calibrationSpeciesIds, levels: [1, 20, 50, 75, 100],
            formats: ['2v2', '3v3'], relations: ['neutral', 'advantage', 'disadvantage'], bench: 2 },
        savedPresets: { species: representatives.length, levels: [1, 5, 10, 20, 50, 75, 100], presets: [0, 1],
            opponent: 'same species, same points, authored default kit', benches: [0, 2] } },
    integrity: { sealedFixtures, syntheticFormFixtures, actionChecks, naturalFights: fights, replayChecks, matchmaking: matchmakingEvidence,
        gearBoundChecks, maximumGearDotPct, maximumOffensiveHealingPct,
        gearBoundRounding: { dot: 'round(target maximum HP × 0.05)', offensiveHealing: 'round(actor maximum HP × 0.10)' },
        failures },
    damage: Object.fromEntries([...damageGroups].map(([key, values]) => [key, distribution(values)])),
    largestDamageOutliers: damageOutliers.sort((a, b) => b.ratio - a.ratio).slice(0, 40),
    battles: Object.fromEntries([...buckets].map(([key, bucket]) => [key, summarizeBucket(bucket)])),
    marginals: marginalSummary, warnings,
    remainingAcceptance: [
        'Controlled outcomes do not replace human high-level or PvP acceptance.',
        'Spatial formats and adventure summons require their shared-path integration tests.',
        'Replay checks cover selected first rounds; settlement, reconnect, stale commands and duplicate rewards require endpoint tests.',
        'No production save, logged-in game, currency payout or external service was accessed.',
        'Mirrors and neutral-role opponents do not establish complete cross-build dominance; inspect role and counter matchup buckets.',
        'Effective survival threshold is a repeated-identical-hit diagnostic; natural AI can choose different actions.',
        'Signature damage probes use ready meter and visible buff setup only where explicitly requested; natural timing is separately measured.',
    ],
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log('[progression evidence] wrote ' + output + ' (' + fights + ' fights, ' + failures.length + ' invariant failures)');
if (failures.length) process.exitCode = 1;
