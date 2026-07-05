/*
 * Clan-boss assault side-record + result extraction.
 *
 * An assault reuses the whole Battle-Towers session lifecycle (start-encounter →
 * /api/towers/action loop → 'done'). This side record tags a tower runId as a
 * clan-boss assault so settle knows which clan/week/party to bank it into, and
 * gates settle to exactly once. The RESULT (damage/rounds/wipe/clean) is read
 * from the finished, server-authoritative session — never from the client.
 */
import { kv } from '../_storage.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { getActor, actorsOnSide, livingOnSide } from '../towers/_tower-session.js';

export type ClanBossAssaultRecord = {
    runId: string;
    weekId: string;
    clanName: string;
    host: string;        // slug
    party: string[];     // slugs (host + clanmate allies)
    bossId: string;
    createdAt: number;
    settled?: boolean;
};

// A run must be settled within this window; matches the tower session TTL ballpark.
const ASSAULT_TTL_SEC = 6 * 60 * 60;

export function assaultKey(runId: string): string { return `clan-boss:assault:${runId}`; }

export async function loadAssault(runId: string): Promise<ClanBossAssaultRecord | null> {
    return kv.get<ClanBossAssaultRecord>(assaultKey(runId));
}
export async function saveAssault(rec: ClanBossAssaultRecord): Promise<void> {
    await kv.set(assaultKey(rec.runId), rec, { ex: ASSAULT_TTL_SEC });
}

export type AssaultResult = { won: boolean; damage: number; rounds: number; wiped: boolean; clean: boolean };

/** Server-trusted result of a FINISHED clan-boss tower session. */
export function extractAssaultResult(session: TowerSession): AssaultResult {
    const bossId = session.phaseState?.bossId;
    const boss = bossId ? getActor(session, bossId) : undefined;
    // Damage the party removed from the boss (= its maxHp minus what's left; full on a kill).
    const damage = boss ? Math.max(0, Math.round(boss.maxHp - boss.hp)) : 0;
    const won = session.winner === 'squad';
    const squad = actorsOnSide(session, 'squad');
    const squadAlive = livingOnSide(session, 'squad').length;
    // A true wipe = the whole party fell. A timeout (squad alive, boss not dead) is
    // NOT a wipe — it just banks partial damage with no wipe penalty and no clean bonus.
    const wiped = squad.length > 0 && squadAlive === 0;
    const clean = won && squad.every(a => a.hp > 0);
    return { won, damage, rounds: Math.max(1, session.round), wiped, clean };
}
