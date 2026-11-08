/**
 * Multi-stage boss transformations — the engine-agnostic half.
 *
 * A boss carries a sealed TRANSFORMATION PLAN: an ordered list of forms, each
 * entered once when the boss's health first falls to the form's threshold. The
 * plan is copied into the battle session when the fight is built, so a deploy
 * never changes a fight that is already running, and the state that records
 * which forms have been entered lives in the same persisted session. A refresh
 * re-reads that state; it never re-runs a transformation.
 *
 * This module owns the rules every engine must agree on:
 *   - which thresholds a change in health crosses, and in what order;
 *   - what happens when one hit crosses several thresholds;
 *   - what happens when a hit would kill the boss before a form is entered;
 *   - the damage multipliers a form applies, including a stance weakness;
 *   - the bookkeeping for a charged attack the player can interrupt.
 *
 * Each engine (Battle Towers, solo PvE) applies the effects with its own
 * primitives: healing, jutsu kits, AI focus and the charged attack's damage.
 *
 * MULTIPLE THRESHOLDS IN ONE HIT. Every crossed form is marked entered, in
 * descending threshold order, so none of them can fire later. The boss lands
 * in the DEEPEST crossed form: that form's stats, mechanic and one-time heal
 * apply. Moveset changes apply cumulatively for every crossed form, so the kit
 * a boss ends with never depends on how hard it was hit. The heals of skipped
 * forms are forfeited: a huge hit is rewarded rather than doubly punished.
 * One cut-scene plays, for the landing form, and names the forms it skipped.
 *
 * A HIT THAT WOULD KILL. With `lethalGuard` on (the default) a blow that would
 * defeat the boss while a form is still pending leaves it at 1 HP and the
 * transformation happens instead, so no player can skip the story beat by
 * bursting through it. Once every form has been entered the guard is spent and
 * the next lethal blow wins the fight through the engine's normal victory path.
 */

export const BOSS_FORM_AURAS = ['storm', 'flame', 'steam', 'moon', 'obsidian', 'eclipse', 'tempest'] as const;
export type BossFormAura = (typeof BOSS_FORM_AURAS)[number];

export const BOSS_PHASE_MECHANIC_KINDS = ['charged-strike', 'guard-stance', 'limit-burn', 'summon'] as const;
export type BossPhaseMechanicKind = (typeof BOSS_PHASE_MECHANIC_KINDS)[number];

/** Engine-enforced ceilings. Authored data is clamped to these, never trusted. */
export const BOSS_FORM_LIMITS = {
    damageMult: { min: 0.5, max: 1.6 },
    damageTakenMult: { min: 0.4, max: 1.6 },
    healPct: { min: 0, max: 50 },
    chargeDamagePct: { min: 1, max: 30 },
    chargeBreakPct: { min: 1, max: 25 },
    chargeEveryRounds: { min: 2, max: 8 },
    staggerDamageTakenMult: { min: 1, max: 1.5 },
    burnPct: { min: 1, max: 6 },
    upkeepPct: { min: 0, max: 6 },
    /** combined limit-burn + upkeep ceiling per boss turn */
    totalBurnPct: { min: 0, max: 8 },
    summonCount: { min: 1, max: 3 },
} as const;

export type BossPhaseMechanic =
    /** The boss gathers power on one turn and releases it on its next turn for
     *  `damagePct`% of each target's max HP. Dealing `breakPct`% of the boss's
     *  max HP in between, or stunning it, breaks the charge and staggers it:
     *  it takes `staggerDamageTakenMult`× damage until its next turn ends. */
    | {
        kind: 'charged-strike'; name: string; damagePct: number; breakPct: number;
        everyRounds: number; staggerDamageTakenMult?: number; tell: string;
    }
    /** A defensive stance: the boss takes `damageTakenMult`× damage, except from
     *  attacks that match `weakness` (an element or a jutsu type), which take
     *  `weaknessMult`× instead. */
    | { kind: 'guard-stance'; name: string; weakness: string; weaknessMult: number; tell: string }
    /** A released limiter: the form burns `burnPct`% of the boss's max HP at the
     *  end of each of its turns. It cannot burn itself below 1 HP. */
    | { kind: 'limit-burn'; name: string; burnPct: number; tell: string }
    /** Reinforcements on entry. Board engines only (Battle Towers). */
    | { kind: 'summon'; name: string; aiId: string; count: number; tell: string };

export type BossPhaseMoveset = {
    /** jutsu ids the form learns */
    add?: readonly string[];
    /** jutsu ids the form drops */
    remove?: readonly string[];
    /** ids the AI should prefer while the form is active, best first */
    favor?: readonly string[];
};

export type BossPhaseDef = {
    /** stable id, unique within the plan; recorded once entered */
    id: string;
    /** enter when health falls to this percentage of max HP or lower (1–99) */
    atHpPct: number;
    /** player-facing name of the form, e.g. "Thunder God Shroud" */
    formName: string;
    /** alternate artwork; when absent the client paints the aura over the base art */
    portrait?: string;
    aura: BossFormAura;
    /** short visual-novel cut-scene: who speaks and what they say (1–3 lines) */
    cutscene: { speaker: string; lines: readonly string[] };
    /** one sentence telling the player what changed */
    summary: string;
    /** outgoing damage multiplier while the form is active */
    damageMult?: number;
    /** incoming damage multiplier while the form is active (stances override it) */
    damageTakenMult?: number;
    /** one-time heal on entry, percent of max HP (optional per boss) */
    healPct?: number;
    /** what holding the form costs: percent of max HP lost at the end of each of
     *  the boss's turns (never below 1 HP). Lets a form heal or hit harder while
     *  the fight stays winnable. Independent of the mechanic. */
    upkeepPct?: number;
    moveset?: BossPhaseMoveset;
    mechanic?: BossPhaseMechanic;
};

export type BossTransformationPlan = {
    id: string;
    /** defaults to true: a lethal blow with a form pending leaves the boss at 1 HP */
    lethalGuard?: boolean;
    /** sorted by descending threshold */
    phases: readonly BossPhaseDef[];
};

export type BossChargeState = {
    phaseId: string;
    name: string;
    armedRound: number;
    /** boss health when the charge began; health lost below it counts toward the break */
    hpAtArm: number;
    /** health the boss must lose to break the charge */
    breakAt: number;
};

/** Health the boss has lost since its charge began (heals push it back). */
export function bossChargeDamage(charge: BossChargeState, hp: number): number {
    return Math.max(0, Math.floor(charge.hpAtArm - hp));
}

export type BossTransitionRecord = {
    seq: number;
    round: number;
    /** the form the boss landed in */
    phaseId: string;
    /** forms crossed in the same hit and skipped */
    skipped: string[];
    healed: number;
    savedFromLethal: boolean;
};

export type BossTransformationState = {
    /** the plan sealed when the fight was built */
    plan: BossTransformationPlan;
    /** 0 = base form; n = the plan's nth form (1-based) */
    phase: number;
    /** ids of every form entered, in order; a form in here never fires again */
    triggered: string[];
    /** bumps once per transformation; the client keys its cut-scene on it */
    seq: number;
    last?: BossTransitionRecord;
    charge?: BossChargeState;
    /** last round a charge was armed, for its cadence */
    lastChargeRound?: number;
    /** the boss takes extra damage through this round after a broken charge */
    staggeredUntilRound?: number;
    /** set by an engine that held a lethal blow at 1 HP before entering the form */
    heldFromLethal?: boolean;
};

/**
 * For engines that must stop a knockout before they can safely apply a form:
 * if `hp` is lethal and the guard applies, record it and return the HP to set (1).
 */
export function holdBossAtLethal(state: BossTransformationState | undefined, hp: number, maxHp: number): number | undefined {
    if (!state || hp > 0 || !pendingBossCrossing(state, hp, maxHp)?.savedFromLethal) return undefined;
    state.heldFromLethal = true;
    return 1;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Validate a plan's shape. Returns human-readable problems (empty = valid). */
export function validateBossTransformationPlan(plan: BossTransformationPlan, opts: { allowSummon?: boolean } = {}): string[] {
    const errs: string[] = [];
    if (!plan.id) errs.push('plan id is required');
    if (!plan.phases.length) errs.push(`${plan.id}: at least one form is required`);
    const ids = new Set<string>();
    let previous = 100;
    for (const phase of plan.phases) {
        const where = `${plan.id}/${phase.id}`;
        if (!phase.id) errs.push(`${plan.id}: form id is required`);
        if (ids.has(phase.id)) errs.push(`${where}: duplicate form id`);
        ids.add(phase.id);
        if (!(phase.atHpPct >= 1 && phase.atHpPct <= 99)) errs.push(`${where}: atHpPct must be 1-99`);
        if (phase.atHpPct >= previous) errs.push(`${where}: thresholds must strictly descend`);
        previous = phase.atHpPct;
        if (!phase.formName.trim()) errs.push(`${where}: formName is required`);
        if (!(BOSS_FORM_AURAS as readonly string[]).includes(phase.aura)) errs.push(`${where}: unknown aura`);
        if (!phase.cutscene.speaker.trim() || phase.cutscene.lines.length < 1 || phase.cutscene.lines.length > 3) {
            errs.push(`${where}: a cut-scene needs a speaker and 1-3 lines`);
        }
        if (!phase.summary.trim()) errs.push(`${where}: summary is required`);
        const limits = BOSS_FORM_LIMITS;
        if (phase.damageMult !== undefined && (phase.damageMult < limits.damageMult.min || phase.damageMult > limits.damageMult.max)) errs.push(`${where}: damageMult out of range`);
        if (phase.damageTakenMult !== undefined && (phase.damageTakenMult < limits.damageTakenMult.min || phase.damageTakenMult > limits.damageTakenMult.max)) errs.push(`${where}: damageTakenMult out of range`);
        if (phase.healPct !== undefined && (phase.healPct < limits.healPct.min || phase.healPct > limits.healPct.max)) errs.push(`${where}: healPct out of range`);
        if (phase.upkeepPct !== undefined && (phase.upkeepPct < limits.upkeepPct.min || phase.upkeepPct > limits.upkeepPct.max)) errs.push(`${where}: upkeepPct out of range`);
        if (phase.portrait !== undefined && !/^\/[\w\-/.]+\.(webp|png)$/.test(phase.portrait)) errs.push(`${where}: portrait must be a /public path`);
        const m = phase.mechanic;
        if (m) {
            if (!(BOSS_PHASE_MECHANIC_KINDS as readonly string[]).includes(m.kind)) errs.push(`${where}: unknown mechanic`);
            if (!m.name.trim() || !m.tell.trim()) errs.push(`${where}: a mechanic needs a name and a tell`);
            if (m.kind === 'summon' && !opts.allowSummon) errs.push(`${where}: summons need a board engine`);
            if (m.kind === 'charged-strike') {
                if (m.damagePct < limits.chargeDamagePct.min || m.damagePct > limits.chargeDamagePct.max) errs.push(`${where}: charge damagePct out of range`);
                if (m.breakPct < limits.chargeBreakPct.min || m.breakPct > limits.chargeBreakPct.max) errs.push(`${where}: charge breakPct out of range`);
                if (m.everyRounds < limits.chargeEveryRounds.min || m.everyRounds > limits.chargeEveryRounds.max) errs.push(`${where}: charge everyRounds out of range`);
            }
            if (m.kind === 'guard-stance' && (!m.weakness || m.weaknessMult < 1)) errs.push(`${where}: a stance needs a weakness that hurts it`);
            if (m.kind === 'limit-burn' && (m.burnPct < limits.burnPct.min || m.burnPct > limits.burnPct.max)) errs.push(`${where}: burnPct out of range`);
            if (m.kind === 'summon' && (m.count < limits.summonCount.min || m.count > limits.summonCount.max || !m.aiId)) errs.push(`${where}: summon count out of range`);
        }
    }
    return errs;
}

export function createBossTransformationState(plan: BossTransformationPlan): BossTransformationState {
    return { plan: structuredClone(plan) as BossTransformationPlan, phase: 0, triggered: [], seq: 0 };
}

/** The form the boss is currently in, or undefined for its base form. */
export function activeBossForm(state: BossTransformationState | undefined): BossPhaseDef | undefined {
    if (!state || state.phase <= 0) return undefined;
    return state.plan.phases[state.phase - 1];
}

function hpPercent(hp: number, maxHp: number): number {
    if (!(maxHp > 0)) return 100;
    return (Math.max(0, hp) / maxHp) * 100;
}

export type BossCrossing = {
    /** forms crossed by this change, in descending threshold order */
    crossed: BossPhaseDef[];
    /** the deepest crossed form: the one the boss lands in */
    landing: BossPhaseDef;
    /** forms crossed and skipped (every crossed form but the landing one) */
    skipped: BossPhaseDef[];
    /** true when the boss was at or below 0 HP and the lethal guard caught it */
    savedFromLethal: boolean;
};

/**
 * Which pending forms does the boss's CURRENT health cross? Pure: no state is
 * changed. Health already at or below 0 only counts when the lethal guard is
 * on, in which case every pending form is crossed.
 */
export function pendingBossCrossing(state: BossTransformationState | undefined, hp: number, maxHp: number): BossCrossing | null {
    if (!state) return null;
    const pending = state.plan.phases.filter(phase => !state.triggered.includes(phase.id));
    if (!pending.length) return null;
    const lethal = hp <= 0;
    if (lethal && state.plan.lethalGuard === false) return null;
    const pct = hpPercent(hp, maxHp);
    const crossed = lethal ? pending : pending.filter(phase => pct <= phase.atHpPct);
    if (!crossed.length) return null;
    const landing = crossed[crossed.length - 1]!;
    return { crossed, landing, skipped: crossed.slice(0, -1), savedFromLethal: lethal };
}

export type BossTransitionEffects = {
    record: BossTransitionRecord;
    landing: BossPhaseDef;
    skipped: BossPhaseDef[];
    /** hp the engine should set on the boss */
    hp: number;
    /** jutsu ids added and removed across every crossed form, in order */
    learned: string[];
    forgotten: string[];
    /** log lines for the battle log, most important first */
    log: string[];
};

/**
 * Enter the forms the boss's health has crossed. Mutates `state` (marks every
 * crossed form entered, exactly once) and returns what the engine must apply.
 * Returns null when nothing is crossed, which includes every call after the
 * forms have fired: calling this again for the same health is a no-op.
 */
export function enterBossForms(
    state: BossTransformationState | undefined,
    boss: { name: string; hp: number; maxHp: number },
    round: number,
): BossTransitionEffects | null {
    const crossing = pendingBossCrossing(state, boss.hp, boss.maxHp);
    if (!state || !crossing) return null;
    const { crossed, landing, skipped } = crossing;
    const savedFromLethal = crossing.savedFromLethal || state.heldFromLethal === true;
    delete state.heldFromLethal;
    for (const phase of crossed) state.triggered.push(phase.id);
    state.phase = state.plan.phases.findIndex(phase => phase.id === landing.id) + 1;
    state.seq += 1;
    // A new form drops any charge or stagger left over from the previous one.
    delete state.charge;
    delete state.staggeredUntilRound;
    delete state.lastChargeRound;
    // A charging form waits one round before its first charge, so the player
    // can read the new form before having to answer it.
    if (landing.mechanic?.kind === 'charged-strike') {
        const every = clamp(Math.floor(finite(landing.mechanic.everyRounds, 3)), BOSS_FORM_LIMITS.chargeEveryRounds.min, BOSS_FORM_LIMITS.chargeEveryRounds.max);
        state.lastChargeRound = round - every + 1;
    }

    let hp = savedFromLethal ? 1 : Math.max(1, Math.floor(boss.hp));
    const healPct = clamp(finite(landing.healPct, 0), BOSS_FORM_LIMITS.healPct.min, BOSS_FORM_LIMITS.healPct.max);
    const heal = healPct > 0 ? Math.min(boss.maxHp - hp, Math.floor((boss.maxHp * healPct) / 100)) : 0;
    hp += Math.max(0, heal);

    // Net moveset change across every crossed form, applied in order, so a later
    // form can drop what a skipped earlier form taught.
    const learned: string[] = [];
    const forgotten: string[] = [];
    for (const phase of crossed) {
        for (const id of phase.moveset?.remove ?? []) {
            const at = learned.indexOf(id);
            if (at >= 0) learned.splice(at, 1);
            else if (!forgotten.includes(id)) forgotten.push(id);
        }
        for (const id of phase.moveset?.add ?? []) {
            const at = forgotten.indexOf(id);
            if (at >= 0) forgotten.splice(at, 1);
            if (!learned.includes(id)) learned.push(id);
        }
    }

    const log: string[] = [];
    if (savedFromLethal) log.push(`${boss.name} refuses to fall and clings to 1 HP!`);
    log.push(`${boss.name} transforms: ${landing.formName}! ${landing.summary}`);
    if (skipped.length) log.push(`The blow tore straight through ${skipped.map(phase => phase.formName).join(' and ')}.`);
    if (heal > 0) log.push(`${boss.name} recovers ${heal} HP (${hp}/${boss.maxHp}).`);
    if (landing.mechanic) log.push(`${landing.mechanic.name}: ${landing.mechanic.tell}`);

    const record: BossTransitionRecord = {
        seq: state.seq, round, phaseId: landing.id,
        skipped: skipped.map(phase => phase.id), healed: Math.max(0, heal), savedFromLethal,
    };
    state.last = record;
    return { record, landing, skipped, hp, learned, forgotten, log };
}

/** Apply a form's moveset delta to an ordered list of jutsu ids. */
export function applyMovesetDelta(ids: readonly string[], learned: readonly string[], forgotten: readonly string[]): string[] {
    const next = ids.filter(id => !forgotten.includes(id));
    for (const id of learned) if (!next.includes(id)) next.push(id);
    return next;
}

/** Outgoing damage multiplier for the boss's own attacks. */
export function bossFormDamageMult(state: BossTransformationState | undefined): number {
    const form = activeBossForm(state);
    if (!form) return 1;
    return clamp(finite(form.damageMult, 1), BOSS_FORM_LIMITS.damageMult.min, BOSS_FORM_LIMITS.damageMult.max);
}

/** Does an attack match a stance weakness? Matches an element or a jutsu type, case-insensitively. */
export function attackMatchesWeakness(weakness: string, attack?: { element?: unknown; type?: unknown }): boolean {
    if (!attack) return false;
    const want = weakness.trim().toLowerCase();
    return [attack.element, attack.type].some(value => typeof value === 'string' && value.trim().toLowerCase() === want);
}

/** Incoming damage multiplier for attacks that hit the boss. */
export function bossFormDamageTakenMult(
    state: BossTransformationState | undefined,
    round: number,
    attack?: { element?: unknown; type?: unknown },
): number {
    const form = activeBossForm(state);
    if (!form || !state) return 1;
    let mult = clamp(finite(form.damageTakenMult, 1), BOSS_FORM_LIMITS.damageTakenMult.min, BOSS_FORM_LIMITS.damageTakenMult.max);
    const m = form.mechanic;
    if (m?.kind === 'guard-stance' && attackMatchesWeakness(m.weakness, attack)) {
        mult = clamp(finite(m.weaknessMult, 1), 1, BOSS_FORM_LIMITS.damageTakenMult.max);
    }
    if (m?.kind === 'charged-strike' && state.staggeredUntilRound !== undefined && round <= state.staggeredUntilRound) {
        mult *= clamp(finite(m.staggerDamageTakenMult, 1.25), BOSS_FORM_LIMITS.staggerDamageTakenMult.min, BOSS_FORM_LIMITS.staggerDamageTakenMult.max);
    }
    return mult;
}

/** AI preference list for the active form (best first). */
export function bossFormFavoredJutsu(state: BossTransformationState | undefined): readonly string[] {
    return activeBossForm(state)?.moveset?.favor ?? [];
}

// ─── Charged strike bookkeeping ─────────────────────────────────────────────

/**
 * Break the active charge when the boss has lost enough health since it began,
 * or when it is stunned. Returns the broken charge, or undefined.
 */
export function checkBossChargeBreak(
    state: BossTransformationState | undefined,
    boss: { hp: number },
    round: number,
    stunned = false,
): BossChargeState | undefined {
    const charge = state?.charge;
    if (!charge) return undefined;
    if (!stunned && bossChargeDamage(charge, boss.hp) < charge.breakAt) return undefined;
    return breakBossCharge(state, round);
}

/** Break the active charge (enough damage, or a stun). Staggers the boss until its next turn ends. */
export function breakBossCharge(state: BossTransformationState | undefined, round: number): BossChargeState | undefined {
    const charge = state?.charge;
    if (!state || !charge) return undefined;
    delete state.charge;
    state.staggeredUntilRound = round + 1;
    return charge;
}

export type BossChargeTurn =
    | { kind: 'detonate'; charge: BossChargeState; damagePct: number }
    | { kind: 'armed'; charge: BossChargeState }
    | null;

/**
 * Called once at the start of the boss's turn. A charge armed on an earlier
 * turn detonates now. Otherwise, if the form charges and its cadence allows,
 * a new charge is armed (the boss still takes its normal turn) and the player
 * gets one full turn to break it.
 */
export function bossChargeTurn(state: BossTransformationState | undefined, boss: { maxHp: number; hp: number }, round: number): BossChargeTurn {
    const form = activeBossForm(state);
    const m = form?.mechanic;
    if (!state || !form || m?.kind !== 'charged-strike' || boss.hp <= 0) return null;
    if (state.charge) {
        if (state.charge.armedRound >= round) return null;
        const charge = state.charge;
        delete state.charge;
        return { kind: 'detonate', charge, damagePct: clamp(finite(m.damagePct, 10), BOSS_FORM_LIMITS.chargeDamagePct.min, BOSS_FORM_LIMITS.chargeDamagePct.max) };
    }
    const every = clamp(Math.floor(finite(m.everyRounds, 3)), BOSS_FORM_LIMITS.chargeEveryRounds.min, BOSS_FORM_LIMITS.chargeEveryRounds.max);
    if (state.lastChargeRound !== undefined && round - state.lastChargeRound < every) return null;
    const breakPct = clamp(finite(m.breakPct, 8), BOSS_FORM_LIMITS.chargeBreakPct.min, BOSS_FORM_LIMITS.chargeBreakPct.max);
    const charge: BossChargeState = {
        phaseId: form.id, name: m.name, armedRound: round, hpAtArm: Math.floor(boss.hp),
        breakAt: Math.max(1, Math.floor((boss.maxHp * breakPct) / 100)),
    };
    state.charge = charge;
    state.lastChargeRound = round;
    return { kind: 'armed', charge };
}

/**
 * Per-turn self-damage of the active form: a 'limit-burn' mechanic plus the
 * form's upkeep (never below 1 HP). Returns the HP lost.
 */
export function bossLimitBurn(state: BossTransformationState | undefined, boss: { hp: number; maxHp: number }): number {
    const form = activeBossForm(state);
    if (!form || boss.hp <= 1) return 0;
    const m = form.mechanic;
    const burn = m?.kind === 'limit-burn' ? clamp(finite(m.burnPct, 2), BOSS_FORM_LIMITS.burnPct.min, BOSS_FORM_LIMITS.burnPct.max) : 0;
    const upkeep = clamp(finite(form.upkeepPct, 0), BOSS_FORM_LIMITS.upkeepPct.min, BOSS_FORM_LIMITS.upkeepPct.max);
    const pct = clamp(burn + upkeep, BOSS_FORM_LIMITS.totalBurnPct.min, BOSS_FORM_LIMITS.totalBurnPct.max);
    if (pct <= 0) return 0;
    return Math.min(boss.hp - 1, Math.max(1, Math.floor((boss.maxHp * pct) / 100)));
}

/** Name for the per-turn self-damage line in a battle log. */
export function bossBurnLabel(state: BossTransformationState | undefined): string {
    const form = activeBossForm(state);
    return form?.mechanic?.kind === 'limit-burn' ? form.mechanic.name : `Holding ${form?.formName ?? 'the form'}`;
}

/** A compact view for clients: what to draw, without the authored plan's later forms. */
export type BossFormView = {
    seq: number;
    phase: number;
    phaseCount: number;
    formName?: string;
    portrait?: string;
    aura?: BossFormAura;
    summary?: string;
    mechanic?: { kind: BossPhaseMechanicKind; name: string; tell: string };
    cutscene?: { speaker: string; lines: readonly string[] };
    skipped?: string[];
    savedFromLethal?: boolean;
    healed?: number;
    charging?: { name: string; damageTaken: number; breakAt: number };
    staggered?: boolean;
    /** threshold of the next pending form, so the HP bar can mark it */
    nextAtHpPct?: number;
};

export function bossFormView(state: BossTransformationState | undefined, round: number, bossHp?: number): BossFormView | undefined {
    if (!state) return undefined;
    const form = activeBossForm(state);
    const next = state.plan.phases.find(phase => !state.triggered.includes(phase.id));
    const skippedNames = state.last?.skipped
        .map(id => state.plan.phases.find(phase => phase.id === id)?.formName)
        .filter((name): name is string => !!name);
    return {
        seq: state.seq,
        phase: state.phase,
        phaseCount: state.plan.phases.length,
        ...(form ? {
            formName: form.formName,
            ...(form.portrait ? { portrait: form.portrait } : {}),
            aura: form.aura,
            summary: form.summary,
            cutscene: form.cutscene,
            ...(form.mechanic ? { mechanic: { kind: form.mechanic.kind, name: form.mechanic.name, tell: form.mechanic.tell } } : {}),
        } : {}),
        ...(skippedNames?.length ? { skipped: skippedNames } : {}),
        ...(state.last?.savedFromLethal ? { savedFromLethal: true } : {}),
        ...(state.last?.healed ? { healed: state.last.healed } : {}),
        ...(state.charge ? { charging: {
            name: state.charge.name,
            damageTaken: bossHp === undefined ? 0 : bossChargeDamage(state.charge, bossHp),
            breakAt: state.charge.breakAt,
        } } : {}),
        ...(state.staggeredUntilRound !== undefined && round <= state.staggeredUntilRound ? { staggered: true } : {}),
        ...(next ? { nextAtHpPct: next.atHpPct } : {}),
    };
}
