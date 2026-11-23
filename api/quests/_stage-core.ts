/*
 * Stage math shared by the Quest Book epics (api/sector/_questbook.ts) and the
 * quest lines (api/quests/_catalog.ts). Pure: no KV, auth, locks or catalogue.
 *
 * These were written for the Quest Book and moved here unchanged so a second
 * catalogue can use them. _questbook.ts re-exports each one under its old name
 * and signature; nothing about an epic's behaviour moved with them.
 */

/** The parts of a branch option the reward math reads. */
export interface StageChoiceOptionLike {
    key: string;
    /** +X% to the final ryo reward */
    bonusRyoPct?: number;
    /** extra fate shards on completion */
    bonusFateShards?: number;
    /** overrides the default award title */
    title?: string;
    /** a persistent world-standing flag stamped at claim */
    standing?: string;
}

/** The parts of a stage the shared math reads. */
export interface StageLike<Option extends StageChoiceOptionLike = StageChoiceOptionLike> {
    key: string;
    choice?: { options: readonly Option[] };
    timer?: { durationMs: number; failResetToStage?: number };
}

/** A counter objective is met when (current - baseline) reaches count. */
export function stageComplete(baseline: number, current: number, count: number): boolean {
    return (Number(current) || 0) - (Number(baseline) || 0) >= (Number(count) || 0);
}

/** A branch stage: the player must pick an option to advance. */
export function stageIsChoice(stage: StageLike | null | undefined): boolean {
    return !!stage?.choice && Array.isArray(stage.choice.options) && stage.choice.options.length > 0;
}

export function choiceOption<Option extends StageChoiceOptionLike>(
    stage: StageLike<Option> | null | undefined,
    optionKey: string,
): Option | null {
    if (!stageIsChoice(stage)) return null;
    return stage!.choice!.options.find(o => o.key === optionKey) ?? null;
}

/** Milliseconds a timed stage allows, or 0 if the stage is untimed. */
export function stageTimerMs(stage: StageLike | null | undefined): number {
    return Math.max(0, Math.floor(Number(stage?.timer?.durationMs) || 0));
}

/** Where a failed timer resets to (defaults to the timed stage itself). */
export function timerResetStage(stages: readonly StageLike[], stageIdx: number): number {
    const stage = stages[stageIdx];
    const to = stage?.timer?.failResetToStage;
    if (typeof to === 'number' && to >= 0 && to < stages.length) return Math.floor(to);
    return stageIdx;
}

export interface StageChoiceEffects {
    ryoMult: number;
    bonusFateShards: number;
    titleOverride: string | null;
    standings: string[];
}

/** Fold the sealed branch choices into the final-reward modifiers. */
export function aggregateStageChoiceEffects(
    stages: readonly StageLike[],
    choices: Record<string, string> | null | undefined,
): StageChoiceEffects {
    let ryoMult = 1;
    let bonusFateShards = 0;
    let titleOverride: string | null = null;
    const standings: string[] = [];
    const made = choices ?? {};
    for (const stage of stages) {
        if (!stageIsChoice(stage)) continue;
        const opt = choiceOption(stage, String(made[stage.key] ?? ''));
        if (!opt) continue;
        if (opt.bonusRyoPct) ryoMult *= 1 + opt.bonusRyoPct / 100;
        if (opt.bonusFateShards) bonusFateShards += opt.bonusFateShards;
        if (opt.title) titleOverride = opt.title;
        if (opt.standing) standings.push(opt.standing);
    }
    return { ryoMult, bonusFateShards, titleOverride, standings };
}
