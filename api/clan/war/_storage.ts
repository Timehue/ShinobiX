// Clan war storage layer. KV-backed, one record per pair of warring
// clans keyed by sorted-pair ID so the same two clans always resolve
// to the same key regardless of who attacked first. Mirrors the
// village-war pattern in api/world-state.ts but scoped to clans.
//
// The challenge queue lives inside the war record. Capped at a few
// dozen pending + a couple hundred history entries so the blob
// stays well under KV size limits. Each challenge is one of five
// modes (1v1 PvP, 2v2 PvP, pet 1v1, pet 2v2, tile cards) and pays
// HP damage on completion based on the tier.

import { kv } from '../../_storage.js';

export type ChallengeMode = 'pvp1v1' | 'pvp2v2' | 'pet1v1' | 'pet2v2' | 'tilecards';

// 'queuing'  — only used for 2v2 modes while the sending clan is still
//              gathering a second challenger. Hidden from the defender.
// 'pending'  — challenge is queue-complete on the sender side and
//              visible to the defender. For 2v2, defenders may have
//              partially queued (acceptedPlayer set, acceptedPlayer2
//              still empty) — status stays 'pending' until 2/2.
// 'accepted' — both sides fully queued; battle is ready.
export type ChallengeStatus = 'queuing' | 'pending' | 'accepted' | 'completed' | 'expired' | 'cancelled';

export type ChallengeResult = 'from-wins' | 'to-wins' | 'draw';

export type ClanChallenge = {
    id: string;
    mode: ChallengeMode;
    fromClan: string;
    // Challenger player name(s). Hidden from the defender's queue UI
    // until they accept — the defender sees only the clan + mode.
    fromPlayer: string;
    fromPlayer2?: string;       // populated for pvp2v2 / pet2v2
    createdAt: number;
    status: ChallengeStatus;
    expiresAt: number;
    acceptedAt?: number;
    acceptedPlayer?: string;
    acceptedPlayer2?: string;
    completedAt?: number;
    result?: ChallengeResult;
    battleId?: string;          // PvP modes get a pvp:<id> session
    petBattleSeed?: number;     // pet modes use a deterministic seed
    // Two-phase reporting (anti-cheat). First reporter stores a
    // tentative; the OTHER side must confirm or dispute. If the other
    // side does not respond within REPORT_AUTO_CONFIRM_MS, lazy
    // finalization auto-confirms the tentative on next read.
    tentativeResult?: ChallengeResult;
    tentativeBy?: string;
    tentativeAt?: number;
};

export type ClanWar = {
    id: string;                 // sorted-pair slug
    clans: [string, string];    // canonical sorted alphabetically
    villages: Record<string, string>; // clan → village at war-declare time
    hp: Record<string, number>; // clan → current HP
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    winnerClan?: string;
    declaredBy: string;         // player name who declared
    pendingChallenges: ClanChallenge[];
    completedChallenges: ClanChallenge[];
    // Server-stamped at war-create so every grant path uses the same
    // canonical ID (mirrors village-war pattern).
    warCrateId?: string;
    mvpByClan?: Record<string, string>;
};

// ── Constants ───────────────────────────────────────────────────────
export const CLAN_WAR_HP_MAX = 1000;
// Damage per challenge type on win. Tier: combat > pet battle > cards.
// 2v2 modes pay double the 1v1 of the same tier — the wins represent
// two real fights happening sequentially under the hood.
export const CHALLENGE_DAMAGE: Record<ChallengeMode, number> = {
    pvp1v1: 30,
    pvp2v2: 60,
    pet1v1: 20,
    pet2v2: 40,
    tilecards: 10,
};
export const CHALLENGE_EXPIRY_MS = 60 * 60 * 1000;          // 1h to accept
export const CLAN_WAR_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
export const CLAN_WAR_REMATCH_COOLDOWN_SEC = 7 * 24 * 60 * 60;
export const MAX_PENDING_CHALLENGES = 30;
export const MAX_COMPLETED_HISTORY = 200;
// Anti-abuse: each player can have at most 2 in-flight challenges at
// any given time, counted across BOTH the fromPlayer/fromPlayer2 slots
// AND queuing vs pending status. Stops a single player from carpet-
// bombing the defender with 10+ challenges and clogging the queue.
export const MAX_PENDING_PER_PLAYER = 2;
// Damage applied to the defending clan when a *pending* challenge
// expires unaccepted. 'queuing' expiries do not apply this penalty —
// the defender never saw the challenge so they can't be punished for
// ignoring it.
export const EXPIRY_PENALTY_HP = 5;
// Two-phase report: first side stamps a tentative result; the OTHER
// side has 15 min to confirm or dispute before the tentative
// auto-confirms on next read. Stops a loser from front-running the
// winner with a fake result.
export const REPORT_AUTO_CONFIRM_MS = 15 * 60 * 1000;

export const CLAN_WAR_KEY_PREFIX = 'clan-war:';

function normalizeClanKey(clan: string): string {
    return clan.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function clanWarPairId(clanA: string, clanB: string): string {
    return [clanA, clanB]
        .sort((a, b) => a.localeCompare(b))
        .map(normalizeClanKey)
        .join('-vs-');
}

export function clanWarKey(clanA: string, clanB: string): string {
    return `${CLAN_WAR_KEY_PREFIX}${clanWarPairId(clanA, clanB)}`;
}

export function clanWarCooldownKey(clanA: string, clanB: string): string {
    return `clan-war:cooldown:${clanWarPairId(clanA, clanB)}`;
}

export async function loadAllClanWars(): Promise<ClanWar[]> {
    try {
        const keys = await kv.keys(`${CLAN_WAR_KEY_PREFIX}*`);
        // Strip cooldown keys — those live under `clan-war:cooldown:` and
        // would otherwise show up in this scan.
        const warKeys = keys.filter(k => !k.startsWith('clan-war:cooldown:'));
        if (warKeys.length === 0) return [];
        const values = await kv.mget<ClanWar[]>(...warKeys);
        return values.filter(Boolean) as ClanWar[];
    } catch {
        return [];
    }
}

export async function clanInActiveWar(clanName: string): Promise<boolean> {
    const all = await loadAllClanWars();
    return all.some(w => !w.endedAt && w.clans.includes(clanName));
}

// Pull the actor's clan and role from their save. Used to validate
// that only clan founder / leader / officer can declare or accept;
// any member can send challenges and report results.
export async function loadClanContext(playerName: string): Promise<{
    clan: string;
    role: 'founder' | 'leader' | 'officer' | 'member' | '';
    village: string;
    name: string;
}> {
    try {
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        if (!char) return { clan: '', role: '', village: '', name: playerName };
        const clan = String(char.clan ?? '');
        const village = String(char.village ?? '');
        const isFounder = char.clanFounder === true;
        if (!clan) return { clan: '', role: '', village, name: String(char.name ?? playerName) };
        // Pull the clan record to inspect roleOverrides for this player.
        const clanSlug = `clan-${clan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const clanData = await kv.get<{ founderName?: string; roleOverrides?: Record<string, string> }>(`save:${clanSlug}`);
        const founderName = String(clanData?.founderName ?? '').toLowerCase();
        const overrides = (clanData?.roleOverrides ?? {}) as Record<string, string>;
        const ovEntry = Object.entries(overrides).find(([k]) => k.toLowerCase() === playerName.toLowerCase());
        const overrideRole = ovEntry?.[1] ?? '';
        let role: 'founder' | 'leader' | 'officer' | 'member' = 'member';
        if (isFounder || founderName === playerName.toLowerCase()) role = 'founder';
        else if (overrideRole === 'Leader') role = 'leader';
        else if (overrideRole === 'Officer') role = 'officer';
        return { clan, role, village, name: String(char.name ?? playerName) };
    } catch {
        return { clan: '', role: '', village: '', name: playerName };
    }
}

export function canActAsClanLeadership(role: string): boolean {
    return role === 'founder' || role === 'leader' || role === 'officer';
}

// ─── MVP computation ─────────────────────────────────────────────────
// Per-clan: most wins, tiebreak by most damage contributed. Returns a
// `{clan → playerName}` map. Used both at HP-driven war-end and at
// 14-day auto-finalize so the leaderboard stays consistent.
export function computeMvpByClan(war: ClanWar): Record<string, string> {
    const mvp: Record<string, string> = {};
    for (const clan of war.clans) {
        const tallies = new Map<string, { wins: number; damage: number }>();
        for (const past of war.completedChallenges) {
            if (past.status !== 'completed' || !past.result || past.result === 'draw') continue;
            const won = (past.result === 'from-wins' && past.fromClan === clan)
                || (past.result === 'to-wins' && past.fromClan !== clan);
            if (!won) continue;
            const winners = past.fromClan === clan
                ? [past.fromPlayer, past.fromPlayer2].filter(Boolean) as string[]
                : [past.acceptedPlayer, past.acceptedPlayer2].filter(Boolean) as string[];
            const dealt = CHALLENGE_DAMAGE[past.mode] ?? 0;
            for (const p of winners) {
                const cur = tallies.get(p) ?? { wins: 0, damage: 0 };
                cur.wins += 1;
                cur.damage += dealt;
                tallies.set(p, cur);
            }
        }
        const top = [...tallies.entries()].sort(([, a], [, b]) => b.wins - a.wins || b.damage - a.damage)[0];
        if (top) mvp[clan] = top[0];
    }
    return mvp;
}

// ─── Finalize war end ────────────────────────────────────────────────
// Sets endedAt + winnerClan (if a side is below 0 HP), computes MVP,
// and sweeps any pending/queuing/accepted challenges to history as
// 'cancelled'. Called from both report.ts (HP-driven end) and from
// applyLazyClanWarExpiry (14-day timeout). The caller is responsible
// for kv.set'ing the result and stamping the rematch cooldown key.
export function finalizeClanWarEnd(
    war: ClanWar,
    opts: { endedAt: number; winnerClan?: string; reason: 'hp-zero' | 'timeout' }
): ClanWar {
    const { endedAt, winnerClan, reason } = opts;
    // Sweep any in-flight challenges → cancelled, move to history.
    const sweep = war.pendingChallenges.map(ch => ({
        ...ch,
        status: 'cancelled' as const,
        completedAt: endedAt,
    }));
    const history = [...sweep, ...war.completedChallenges].slice(0, MAX_COMPLETED_HISTORY);
    const finalWar: ClanWar = {
        ...war,
        endedAt,
        winnerClan: winnerClan ?? war.winnerClan,
        pendingChallenges: [],
        completedChallenges: history,
        updatedAt: endedAt,
    };
    // MVP from the full completed-challenge history.
    finalWar.mvpByClan = computeMvpByClan(finalWar);
    void reason; // reserved for future telemetry / reward variants
    return finalWar;
}

// Lazy-expire stale wars + stale challenges on any read or write.
// Idempotent: an already-expired record passes through unchanged.
//
// Returns:
//   • war:                    projected war state
//   • changed:                set when anything moved (caller may persist)
//   • needsCooldownStamp:     set when we just auto-finalized via 14d
//                             timeout — caller must kv.set the
//                             clanWarCooldownKey to keep parity with
//                             HP-driven war-end in report.ts
export function applyLazyClanWarExpiry(
    war: ClanWar,
    now: number = Date.now()
): { war: ClanWar; changed: boolean; needsCooldownStamp: boolean } {
    let changed = false;
    let needsCooldownStamp = false;
    let next = war;

    // Stale-war auto-finalize (14d max). Routes through the shared
    // finalize helper so MVP + challenge sweep + bookkeeping match the
    // HP-driven path exactly.
    if (!next.endedAt && (now - next.startedAt) > CLAN_WAR_MAX_DURATION_MS) {
        next = finalizeClanWarEnd(next, {
            endedAt: next.startedAt + CLAN_WAR_MAX_DURATION_MS,
            reason: 'timeout',
        });
        changed = true;
        needsCooldownStamp = true;
    }

    // Stale-challenge expiry: pending+queuing challenges past their
    // TTL flip to 'expired' and move into completedChallenges.
    //   • 'queuing' expiries:  no damage — the defender never saw it.
    //   • 'pending' expiries:  defender clan eats EXPIRY_PENALTY_HP per
    //     ghosted challenge. Ghosting an opponent now costs HP, so
    //     defenders are incentivized to accept or decline — not stall.
    //   • 'accepted' challenges do not expire — they wait for a report.
    if (next.pendingChallenges.length > 0) {
        const stillPending: ClanChallenge[] = [];
        const newlyExpired: ClanChallenge[] = [];
        const updatedHp = { ...next.hp };
        let appliedExpiryDamage = false;
        for (const ch of next.pendingChallenges) {
            const inQueue = ch.status === 'pending' || ch.status === 'queuing';
            if (inQueue && ch.expiresAt < now) {
                newlyExpired.push({ ...ch, status: 'expired' as const, completedAt: now });
                if (ch.status === 'pending') {
                    const defender = next.clans.find(c => c !== ch.fromClan);
                    if (defender) {
                        updatedHp[defender] = Math.max(0, (updatedHp[defender] ?? 0) - EXPIRY_PENALTY_HP);
                        appliedExpiryDamage = true;
                    }
                }
            } else {
                stillPending.push(ch);
            }
        }
        if (newlyExpired.length > 0) {
            const history = [...newlyExpired, ...next.completedChallenges].slice(0, MAX_COMPLETED_HISTORY);
            next = {
                ...next,
                pendingChallenges: stillPending,
                completedChallenges: history,
                hp: appliedExpiryDamage ? updatedHp : next.hp,
                updatedAt: now,
            };
            changed = true;

            // If expiry damage drove a clan to 0 HP, finalize the war.
            // Caller stamps the cooldown via needsCooldownStamp parity
            // with the 14-day timeout path.
            if (appliedExpiryDamage && !next.endedAt) {
                const dead = next.clans.find(c => (updatedHp[c] ?? 0) <= 0);
                if (dead) {
                    const winner = next.clans.find(c => c !== dead)!;
                    next = finalizeClanWarEnd(next, { endedAt: now, winnerClan: winner, reason: 'hp-zero' });
                    needsCooldownStamp = true;
                }
            }
        }
    }

    // Auto-confirm stale tentative reports (15 min). If the opposing
    // side has not confirmed/disputed by the deadline, the first
    // reporter's tentative becomes final. We can't apply HP damage
    // from a pure helper, so we mutate the challenge to a
    // 'pseudo-completed' shape that the report endpoint's lazy-pass
    // would handle on the next write. To keep this side-effect-free,
    // we instead promote tentatives by directly applying the result
    // here — but applying damage means we must include the same HP
    // bookkeeping as report.ts. To avoid forking that logic, we just
    // mark stale tentatives so the next caller can finalize them
    // via a follow-up POST. Practically: stale tentatives sit until
    // the next read-write cycle by a participant, then they
    // auto-confirm. Good enough for the audit fix.
    //
    // Implementation: leave the tentative fields alone — the report
    // endpoint will treat any tentativeAt < now - REPORT_AUTO_CONFIRM_MS
    // as eligible for auto-confirm. See applyAutoConfirmIfStale below.

    return { war: next, changed, needsCooldownStamp };
}

// True if a challenge has a tentative result that's older than the
// auto-confirm window and is therefore safe to promote to final on
// the next report path.
export function isTentativeAutoConfirmable(ch: ClanChallenge, now: number = Date.now()): boolean {
    return ch.status === 'accepted'
        && !!ch.tentativeResult
        && !!ch.tentativeAt
        && (now - ch.tentativeAt) >= REPORT_AUTO_CONFIRM_MS;
}

// ─── Anonymity redaction ─────────────────────────────────────────────
// Returns a war record with challenger names redacted for any caller
// who is NOT a member of the sending clan. Defenders only see clan +
// mode for pending/queuing challenges — the names appear once status
// flips to 'accepted' (battle is committed and anonymity ends).
export function redactClanWarForViewer(war: ClanWar, viewerClan: string): ClanWar {
    const redactedPending = war.pendingChallenges.map(ch => {
        if (ch.status !== 'pending' && ch.status !== 'queuing') return ch;
        // Caller is on the sending side → see everything.
        if (viewerClan && ch.fromClan === viewerClan) return ch;
        // Otherwise drop fromPlayer/fromPlayer2 from the wire response.
        return { ...ch, fromPlayer: '', fromPlayer2: undefined };
    });
    return { ...war, pendingChallenges: redactedPending };
}
