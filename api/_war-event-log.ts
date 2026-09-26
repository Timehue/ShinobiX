/*
 * One searchable log line per sector-war event, for the operators of a staffed
 * war event (docs/CONTROLLED_WAR_EVENT_RUNBOOK.md).
 *
 * Every line is `[war-event] {"kind":...}`: one JSON object on one line, so a
 * log search for `[war-event]` plus a contest id or a battle id reconstructs a
 * war. When the operator sets WAR_EVENT_ID for the event window, every line
 * also carries it as `event`, so a single search finds the whole event.
 *
 * Only the fields below are written, and none of them names a player: a
 * contest id is `<sector>:<attacker village>-vs-<defender village>`, a battle id
 * is an opaque server id, and `actor` is a role ('admin' or 'kage'), never a
 * name. Strings are bounded and stripped of line breaks and control characters.
 * Logging never throws into the caller.
 */

import { safeLogValue } from './_safe-log.js';

export type WarEventKind =
    | 'contest-declared'
    | 'contest-abandoned'
    | 'battle-registered'
    | 'battle-scored'
    | 'battle-replayed'
    | 'battle-skipped'
    | 'pvp-resolution'
    | 'settled'
    | 'settlement-deferred'
    | 'contest-row-unreadable';

const FIELDS = [
    'contestId', 'instance', 'battleId', 'sector', 'attackerVillage', 'defenderVillage',
    'winCondition', 'outcome', 'reason', 'attackerWon', 'points', 'attackerPoints',
    'defenderPoints', 'garrison', 'cost', 'endsAt', 'actor', 'key', 'error',
] as const;

export type WarEventField = typeof FIELDS[number];
export type WarEventFields = Partial<Record<WarEventField, string | number | boolean | null | undefined>>;

const EVENT_ID = /^[A-Za-z0-9._-]{1,48}$/;

/** The operator's label for the current event window, or null when unset or
 *  not a plain short token (it is echoed into every line, so nothing else). */
export function warEventId(env: NodeJS.ProcessEnv = process.env): string | null {
    const id = String(env.WAR_EVENT_ID ?? '').trim();
    return EVENT_ID.test(id) ? id : null;
}

export function formatWarEvent(kind: WarEventKind, fields: WarEventFields, env: NodeJS.ProcessEnv = process.env): string {
    const line: Record<string, string | number | boolean | null> = { kind };
    const event = warEventId(env);
    if (event) line.event = event;
    for (const name of FIELDS) {
        const value = fields[name];
        if (value === undefined) continue;
        if (typeof value === 'number') line[name] = Number.isFinite(value) ? value : null;
        else if (typeof value === 'boolean' || value === null) line[name] = value;
        else line[name] = safeLogValue(value, 160);
    }
    return `[war-event] ${JSON.stringify(line)}`;
}

export function logWarEvent(kind: WarEventKind, fields: WarEventFields, level: 'info' | 'warn' | 'error' = 'info'): void {
    try {
        console[level](formatWarEvent(kind, fields));
    } catch {
        // A log line must never fail the war path that emits it.
    }
}

/** An error's message, for the `error` field. */
export function warEventError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
