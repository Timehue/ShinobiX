#!/usr/bin/env node
/*
 * Standard-PvE enemy turn planner: original runner vs planner, same fights.
 *
 *   node --import tsx scripts/pve-ai-planner-sim.ts            # markdown table
 *   node --import tsx scripts/pve-ai-planner-sim.ts --json     # plus per-fight JSON on stdout
 *
 * Real catalog AI profiles, re-levelled to four bracket levels, fight the
 * mission simulator's earned-budget player (scripts/mission-encounter-sim.ts)
 * through the production Solo-PvE builder and engine. The ONLY difference
 * between the two variants is the sealed turn policy: numbers, kits, stats,
 * guards and the player's script are identical. Nothing here tunes balance;
 * it reports what the enemy does with its turn. Writes nothing.
 */
import { performance } from 'node:perf_hooks';
import { AI_PROFILE_CATALOG } from '../api/_ai-profile-catalog.js';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { applySoloPveAction } from '../api/solo-pve/_engine.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import type { SoloPveJutsu, SoloPveSession } from '../api/solo-pve/_session.js';
import { missionPlayerSave, policyActions, type Policy } from './mission-encounter-sim.js';

export const SIM_LEVELS = [15, 40, 70, 95] as const;
const PROFILES_PER_LEVEL = 8;
const DISCIPLINES = ['Ninjutsu', 'Taijutsu'] as const;
const PLAYER_POLICIES: Policy[] = ['damage', 'answer'];
const NOW = 1_780_000_000_000;

type Variant = 'original' | 'planner';
type TurnSample = { ap: number; actions: number; ms: number };
export type FightResult = {
    profile: string; level: number; discipline: string; policy: Policy; variant: Variant;
    outcome: string | null; rounds: number; playerHp: number; turns: TurnSample[];
};

const BASE_AP: Record<string, number> = { move: 30, basicAttack: 40, basicHeal: 60, clear: 60, cleanse: 60, wait: 0 };

function profilesForSim(): SoloPveAiProfile[] {
    const all = Object.values(AI_PROFILE_CATALOG).sort((a, b) => a.id.localeCompare(b.id));
    const step = Math.max(1, Math.floor(all.length / PROFILES_PER_LEVEL));
    return all.filter((_, index) => index % step === 0).slice(0, PROFILES_PER_LEVEL) as unknown as SoloPveAiProfile[];
}

function build(profile: SoloPveAiProfile, level: number, discipline: typeof DISCIPLINES[number], variant: Variant): SoloPveSession {
    return buildSoloPveAiEncounter({
        sessionId: `planner-sim-${profile.id}-${level}-${discipline}`,
        playerName: 'plannersim',
        save: missionPlayerSave(level, discipline, 'PlannerSim'),
        profile,
        now: NOW,
        admin: null,
        scaling: { level },
        difficultyMode: 'AI_FIGHT',
        ...(variant === 'planner' ? { aiTurnPolicy: STANDARD_PVE_AI_POLICY } : {}),
        env: { ...process.env, DISABLE_PVE_AI_PLANNER: '' },
    });
}

function enemyApOf(session: SoloPveSession, action: string, actionId: string | undefined): number {
    if (action === 'jutsu') {
        const kit = (session.enemy.character.jutsu ?? []) as SoloPveJutsu[];
        return Number(kit.find((entry) => entry.id === actionId)?.ap ?? 40);
    }
    return BASE_AP[action] ?? 0;
}

export function fight(profile: SoloPveAiProfile, level: number, discipline: typeof DISCIPLINES[number], policy: Policy, variant: Variant): FightResult {
    let session = build(profile, level, discipline, variant);
    const turns: TurnSample[] = [];
    let lastSeq = session.eventSeq;
    for (let guard = 0; guard < 400 && session.status === 'active'; guard++) {
        let applied: ReturnType<typeof applySoloPveAction> | null = null;
        let ms = 0;
        for (const action of policyActions(session, policy)) {
            const started = performance.now();
            const result = applySoloPveAction(session, action);
            if (!result.applied) continue;
            ms = performance.now() - started;
            applied = result;
            break;
        }
        if (!applied) throw new Error('the player script had no legal action');
        const next = applied.session;
        // The enemy took a turn when the round advanced (or the fight ended on it).
        if (next.round > session.round || (next.status === 'done' && next.events.some((e) => e.seq > lastSeq && e.actor === 'enemy'))) {
            const enemy = next.events.filter((e) => e.seq > lastSeq && e.actor === 'enemy' && e.kind === 'action');
            turns.push({ ap: enemy.reduce((sum, e) => sum + enemyApOf(next, e.action, e.actionId), 0), actions: enemy.length, ms });
        }
        lastSeq = next.eventSeq;
        session = next;
    }
    return {
        profile: profile.id, level, discipline, policy, variant,
        outcome: session.outcome, rounds: session.round, playerHp: session.player.hp, turns,
    };
}

function percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

export function runPlannerSim(): FightResult[] {
    const results: FightResult[] = [];
    const profiles = profilesForSim();
    for (const level of SIM_LEVELS) {
        for (const profile of profiles) {
            for (const discipline of DISCIPLINES) {
                for (const policy of PLAYER_POLICIES) {
                    for (const variant of ['original', 'planner'] as const) {
                        results.push(fight(profile, level, discipline, policy, variant));
                    }
                }
            }
        }
    }
    return results;
}

export function summarize(results: FightResult[]) {
    const rows: Array<Record<string, number | string>> = [];
    for (const level of SIM_LEVELS) {
        for (const variant of ['original', 'planner'] as const) {
            const set = results.filter((r) => r.level === level && r.variant === variant);
            const turns = set.flatMap((r) => r.turns);
            rows.push({
                level,
                variant,
                fights: set.length,
                playerWins: set.filter((r) => r.outcome === 'win').length,
                meanRounds: +(set.reduce((s, r) => s + r.rounds, 0) / Math.max(1, set.length)).toFixed(2),
                enemyApPerTurn: +(turns.reduce((s, t) => s + t.ap, 0) / Math.max(1, turns.length)).toFixed(1),
                enemyActionsPerTurn: +(turns.reduce((s, t) => s + t.actions, 0) / Math.max(1, turns.length)).toFixed(2),
                idleEnemyTurns: turns.filter((t) => t.actions === 0).length,
                maxActionsInATurn: turns.reduce((m, t) => Math.max(m, t.actions), 0),
                maxApInATurn: turns.reduce((m, t) => Math.max(m, t.ap), 0),
                turnMsP50: +percentile(turns.map((t) => t.ms), 0.5).toFixed(2),
                turnMsP95: +percentile(turns.map((t) => t.ms), 0.95).toFixed(2),
            });
        }
    }
    return rows;
}

function main() {
    const started = performance.now();
    const results = runPlannerSim();
    const rows = summarize(results);
    const columns = Object.keys(rows[0]);
    console.log(`| ${columns.join(' | ')} |`);
    console.log(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) console.log(`| ${columns.map((c) => row[c]).join(' | ')} |`);
    console.log(`\n${results.length} fights in ${((performance.now() - started) / 1000).toFixed(1)} s (node ${process.version}, ${process.platform}).`);
    if (process.argv.includes('--json')) console.log(JSON.stringify(results));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-ai-planner-sim.ts')) main();
