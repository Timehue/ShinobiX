/**
 * Battle Towers adapter for multi-stage boss transformations
 * (shared/boss-transformations.ts owns the rules), plus the authored forms of
 * the story tower's milestone bosses: every fifth floor (5, 10, 15) transforms.
 *
 * Transformations are separate from the floor's existing HP gates. A gate
 * still fires its authored mechanic (aegis, enrage, summon, pillars); a form
 * changes how the boss fights for the rest of the battle. Both are checked from
 * tickBossPhases, which runs after every hit and at round end, and both are
 * recorded in the persisted session, so each fires once even across refreshes.
 *
 * Tower plans keep `lethalGuard: false`: a blow that defeats the boss wins the
 * floor through the normal knockout path, which also clears its turn slot.
 * Floor bosses have tens of thousands of HP, so no form is skipped in practice.
 *
 * BALANCE. scripts/tower-story-balance.test.ts holds every story floor to a
 * minimum win rate and pacing for prepared four-player squads. Floor 15's Elite
 * route already sat at that minimum, so a form that adds pressure must also pay
 * for it (more damage taken, or an upkeep burn). Re-run that test after edits.
 *
 * Plans are sealed into the session when the encounter is built
 * (api/towers/_encounter.ts), so a deploy never changes a run in progress.
 * Add a boss by authoring a plan here and naming it in `TowerBoss.transformation`.
 */
import {
    applyMovesetDelta,
    bossBurnLabel,
    bossChargeTurn,
    bossFormDamageMult,
    bossFormDamageTakenMult,
    bossFormFavoredJutsu,
    bossLimitBurn,
    checkBossChargeBreak,
    createBossTransformationState,
    enterBossForms,
    validateBossTransformationPlan,
    type BossTransformationPlan,
} from '../../shared/boss-transformations.js';
import { activeCombatStatuses } from '../combat-core/statuses.js';
import type { EnemyJutsu, EnemyTemplate } from './_enemy-templates.js';
import type { TowerActor, TowerSession } from './_tower-session.js';

/** Techniques the tower forms learn. Same shape as the boss templates' own kits. */
export const TOWER_BOSS_FORM_JUTSU: Readonly<Record<string, EnemyJutsu>> = {
    'warden-obsidian-rampart': {
        id: 'warden-obsidian-rampart', name: 'Obsidian Rampart Lance', type: 'Ninjutsu', element: 'Earth',
        ap: 60, range: 4, effectPower: 54, method: 'AOE_BURST', cooldown: 3,
        tags: [{ name: 'Wound', percent: 15 }], aiPriority: 75,
    },
    'sovereign-black-sun': {
        id: 'sovereign-black-sun', name: 'Black Sun Cataclysm', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 54, method: 'AOE_BURST', cooldown: 3,
        tags: [{ name: 'Wound', percent: 25 }], aiPriority: 75,
    },
    'regent-hermit-cascade': {
        id: 'regent-hermit-cascade', name: 'Hermit Storm Cascade', type: 'Ninjutsu', element: 'Lightning',
        ap: 60, range: 5, effectPower: 56, method: 'AOE_BURST', cooldown: 3,
        tags: [{ name: 'Lag', percent: 15 }], aiPriority: 76,
    },
};

export const TOWER_BOSS_TRANSFORMATIONS: Readonly<Record<string, BossTransformationPlan>> = {
    'warden-obsidian-colossus': {
        id: 'warden-obsidian-colossus',
        lethalGuard: false,
        phases: [{
            id: 'obsidian-colossus',
            atHpPct: 50,
            formName: 'Obsidian Colossus',
            portrait: '/portraits/towers/forms/warden-obsidian-colossus.webp',
            aura: 'obsidian',
            cutscene: {
                speaker: 'Spire Warden',
                lines: [
                    'The mountain made this armor. You will not break it.',
                    'Turn back now, while you can still walk down these stairs.',
                ],
            },
            summary: 'Volcanic glass seals the Warden. It takes 25% less damage and hits 15% harder, but Water techniques crack the shell.',
            damageMult: 1.15,
            damageTakenMult: 0.75,
            moveset: { remove: ['warden-chain'], add: ['warden-obsidian-rampart'], favor: ['warden-obsidian-rampart'] },
            mechanic: {
                kind: 'guard-stance',
                name: 'Obsidian Shell',
                weakness: 'Water',
                weaknessMult: 1.3,
                tell: 'The shell turns most attacks aside. Water techniques quench it and hit 30% harder.',
            },
        }],
    },
    'sovereign-eclipse-brand': {
        id: 'sovereign-eclipse-brand',
        lethalGuard: false,
        phases: [{
            id: 'eclipse-brand',
            atHpPct: 50,
            formName: 'Eclipse Brand Unbound',
            portrait: '/portraits/towers/forms/sovereign-eclipse-brand.webp',
            aura: 'eclipse',
            cutscene: {
                speaker: 'Spire Sovereign',
                lines: [
                    'You want to see what this seal was holding back? Look closely.',
                    'I will burn with it, and I will take this summit down with me.',
                ],
            },
            summary: 'The brand spreads across the Sovereign. It hits 10% harder and abandons its Reflect guard, and the brand burns 1% of its health every round.',
            damageMult: 1.1,
            moveset: { remove: ['sovereign-crown'], add: ['sovereign-black-sun'], favor: ['sovereign-black-sun'] },
            mechanic: {
                kind: 'limit-burn',
                name: 'Unbound Brand',
                burnPct: 1,
                tell: 'The Sovereign loses 1% of its health at every round end. Survive its burst and the brand finishes the work.',
            },
        }],
    },
    'regent-storm-hermit': {
        id: 'regent-storm-hermit',
        lethalGuard: false,
        phases: [{
            id: 'storm-hermit',
            atHpPct: 50,
            formName: 'Storm Hermit Attunement',
            portrait: '/portraits/towers/forms/regent-storm-hermit.webp',
            aura: 'tempest',
            cutscene: {
                speaker: 'Stormglass Regent',
                lines: [
                    'Be quiet. Listen to the storm over the spire.',
                    'It has agreed to lend me everything. You will hear it only once.',
                ],
            },
            summary: 'The Regent draws the storm into its body. It hits 10% harder and charges a Crown of Ten Thousand Bolts, but the storm leaves it exposed: it takes 20% more damage and loses 4% of its health every round.',
            damageMult: 1.1,
            damageTakenMult: 1.2,
            upkeepPct: 4,
            moveset: { remove: ['regent-royal-refraction'], add: ['regent-hermit-cascade'], favor: ['regent-hermit-cascade'] },
            mechanic: {
                kind: 'charged-strike',
                name: 'Crown of Ten Thousand Bolts',
                damagePct: 10,
                breakPct: 5,
                everyRounds: 4,
                staggerDamageTakenMult: 1.25,
                tell: 'It charges for a full round, then strikes every shinobi for 10% of their health. Deal 5% of its health or stun it first to break the charge and stagger it.',
            },
        }],
    },
};

export function towerBossTransformation(id: string | undefined): BossTransformationPlan | undefined {
    return id && Object.prototype.hasOwnProperty.call(TOWER_BOSS_TRANSFORMATIONS, id) ? TOWER_BOSS_TRANSFORMATIONS[id] : undefined;
}

/** Problems with every authored tower plan (empty = valid). Used by the floor validator and tests. */
export function towerBossTransformationProblems(): string[] {
    const problems: string[] = [];
    for (const plan of Object.values(TOWER_BOSS_TRANSFORMATIONS)) {
        problems.push(...validateBossTransformationPlan(plan, { allowSummon: true }));
        for (const phase of plan.phases) {
            for (const id of phase.moveset?.add ?? []) {
                if (!TOWER_BOSS_FORM_JUTSU[id]) problems.push(`${plan.id}/${phase.id}: unknown form jutsu ${id}`);
            }
        }
    }
    return problems;
}

/** Seal a plan (and what its forms learn or summon) into a new tower session. */
export function sealTowerBossForms(
    session: TowerSession,
    planId: string | undefined,
    resolveTemplate: (aiId: string) => EnemyTemplate,
): void {
    const plan = towerBossTransformation(planId);
    if (!plan || !session.phaseState.bossId) return;
    const problems = validateBossTransformationPlan(plan, { allowSummon: true });
    if (problems.length) throw new Error(`Invalid tower boss transformation: ${problems[0]}`);
    const jutsu: Record<string, EnemyJutsu> = {};
    const summons: Record<string, { template: EnemyTemplate; count: number }> = {};
    for (const phase of plan.phases) {
        for (const id of phase.moveset?.add ?? []) {
            const entry = TOWER_BOSS_FORM_JUTSU[id];
            if (!entry) throw new Error(`Tower boss transformation ${plan.id} cannot resolve ${id}`);
            jutsu[id] = structuredClone(entry);
        }
        if (phase.mechanic?.kind === 'summon') {
            summons[phase.id] = { template: structuredClone(resolveTemplate(phase.mechanic.aiId)), count: phase.mechanic.count };
        }
    }
    session.bossForms = createBossTransformationState(plan);
    session.bossFormKit = { jutsu, summons };
}

function formBoss(session: TowerSession): TowerActor | undefined {
    const id = session.phaseState.bossId;
    return id ? session.actors.find(actor => actor.id === id) : undefined;
}

/** Outgoing multiplier when the transformed boss attacks. */
export function towerBossFormAttackMult(session: TowerSession, attacker: TowerActor): number {
    if (!session.bossForms || attacker.id !== session.phaseState.bossId) return 1;
    return bossFormDamageMult(session.bossForms);
}

/** Incoming multiplier when the transformed boss is hit (stance, weakness, stagger). */
export function towerBossFormTakenMult(session: TowerSession, target: TowerActor, jutsu?: { type?: unknown; element?: unknown }): number {
    if (!session.bossForms || target.id !== session.phaseState.bossId) return 1;
    return bossFormDamageTakenMult(session.bossForms, session.round, jutsu);
}

export type TowerFormHooks = {
    /** spawn `count` actors from `template` near the boss */
    summon: (template: EnemyTemplate, count: number) => void;
};

/**
 * Break an answered charge and enter crossed forms. Called from tickBossPhases.
 * Returns true when the boss transformed (the engine publishes a plate).
 */
export function advanceTowerBossForms(session: TowerSession, hooks: TowerFormHooks): boolean {
    const state = session.bossForms;
    const boss = formBoss(session);
    if (!state || !boss || boss.hp <= 0 || session.status !== 'active') return false;
    const stunned = activeCombatStatuses(boss.statuses, session.round).some(status => status.name === 'Stun' || status.name === 'Stunned');
    const broken = checkBossChargeBreak(state, boss, session.round, stunned);
    if (broken) session.log.push(`${boss.name}'s ${broken.name} is broken! It staggers and takes extra damage until the end of next round.`);
    const effects = enterBossForms(state, boss, session.round);
    if (!effects) return false;
    boss.hp = effects.hp;
    const kit = Array.isArray(boss.character.jutsu) ? boss.character.jutsu as EnemyJutsu[] : [];
    const learned = session.bossFormKit?.jutsu ?? {};
    const ids = applyMovesetDelta(kit.map(jutsu => jutsu.id), effects.learned, effects.forgotten);
    const byId = new Map(kit.map(jutsu => [jutsu.id, jutsu]));
    const favored = bossFormFavoredJutsu(state);
    boss.character.jutsu = ids
        .map(id => byId.get(id) ?? learned[id])
        .filter((jutsu): jutsu is EnemyJutsu => !!jutsu)
        // Change attack priorities: the form's favoured signatures come first.
        .map(jutsu => favored.includes(jutsu.id) ? { ...jutsu, aiPriority: 100 - favored.indexOf(jutsu.id) } : jutsu);
    // Learned techniques use the boss's own sealed mastery; dropped ones leave the table.
    if (Array.isArray(boss.character.jutsuMastery)) {
        const mastery = boss.character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        const level = mastery[0]?.level;
        boss.character.jutsuMastery = ids.map(id => mastery.find(entry => entry.jutsuId === id)
            ?? (level === undefined ? undefined : { jutsuId: id, level }))
            .filter((entry): entry is { jutsuId: string; level: number } => !!entry);
    }
    for (const id of [...effects.learned, ...effects.forgotten]) delete boss.cooldowns[id];
    session.log.push(...effects.log);
    const mechanic = effects.landing.mechanic;
    const summon = mechanic?.kind === 'summon' ? session.bossFormKit?.summons?.[effects.landing.id] : undefined;
    if (summon) hooks.summon(summon.template, summon.count);
    return true;
}

/**
 * Round start: release last round's charge on every living squad member
 * (shields absorb it first), or begin a new charge.
 */
export function towerBossFormRoundStart(session: TowerSession): { detonated: number[]; armed: boolean } {
    const state = session.bossForms;
    const boss = formBoss(session);
    const none = { detonated: [], armed: false };
    if (!state || !boss || boss.hp <= 0 || session.status !== 'active') return none;
    const turn = bossChargeTurn(state, boss, session.round);
    if (!turn) return none;
    if (turn.kind === 'armed') {
        session.log.push(`${boss.name} begins charging ${turn.charge.name}! Deal ${turn.charge.breakAt} damage or stun it this round to break the charge.`);
        return { detonated: [], armed: true };
    }
    session.log.push(`${boss.name} releases ${turn.charge.name}!`);
    const tiles: number[] = [];
    for (const actor of session.actors) {
        if (actor.side !== 'squad' || actor.hp <= 0) continue;
        const damage = Math.max(1, Math.floor((actor.maxHp * turn.damagePct) / 100));
        const absorbed = Math.min(Math.max(0, actor.shield), damage);
        actor.shield -= absorbed;
        actor.hp = Math.max(0, actor.hp - (damage - absorbed));
        tiles.push(actor.pos);
        session.log.push(`${actor.name} takes ${damage - absorbed} damage${absorbed ? ` (${absorbed} absorbed by shield)` : ''} (${actor.hp}/${actor.maxHp} HP remaining).`);
    }
    return { detonated: tiles, armed: false };
}

/** Round end: a released limiter burns the boss's own health (never below 1 HP). */
export function towerBossFormRoundEnd(session: TowerSession): void {
    const state = session.bossForms;
    const boss = formBoss(session);
    if (!state || !boss || boss.hp <= 0) return;
    const burn = bossLimitBurn(state, boss);
    if (burn <= 0) return;
    boss.hp -= burn;
    session.log.push(`${bossBurnLabel(state)} costs ${boss.name} ${burn} HP (${boss.hp}/${boss.maxHp}).`);
}
