import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors, mergePreservingImages } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { withKvLock } from './_lock.js';
import { gainXp, type XpCharacter } from './_xp-engine.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { bumpLegacyStats } from './_legacy-track.js';
import { bumpEraContribution } from './_era.js';
import { announce } from './_announce.js';

// One weekly boss state per ISO week. Players damage a shared "rampage
// meter" (no HP cap — the boss cannot be killed by damage). 72h after
// spawn the boss despawns and rewards are auto-distributed:
//   • Top 25 contributors    → 1 Dungeon Key each
//   • Top 10 contributors    → 1 Weekly Boss Core each (stacks with key)
//   • All contributors       → ryo + xp share proportional to damage
//                              (×2 for the MVP — top damage dealer)
// New ISO week → boss is auto-reset (picks a random non-boss AI, or uses
// the admin-set weeklyBossOverride if present).

const WEEKLY_BOSS_STATE_KEY = 'game:weekly-boss-state';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';
const WEEKLY_BOSS_COOLDOWN_KEY_PREFIX = 'rl:weekly-boss:';
const WEEKLY_BOSS_COOLDOWN_SECONDS = 3;
// Per-request damage hard ceiling for the legacy single-tap `damage` kind.
// Kept for back-compat with old clients that haven't picked up the arena
// flow yet. Server still uses per-actor stats for a tighter cap; this is
// the absolute lid.
const WEEKLY_BOSS_DMG_ABSOLUTE_CAP = 20000;
// Per-fight damage ceiling for the new `logFight` kind. A full arena
// duel against an unkillable boss can rack up significantly more damage
// than a single tap, so this cap is much higher than the per-tap one
// but still bounded to stop a tampered client from claiming nonsense.
// Legit late-game attackers top out around 5–7k per attack × ~30 attacks
// before being KO'd = ~150–200k. 500k is a generous ceiling.
const WEEKLY_BOSS_LOG_FIGHT_CAP = 500000;
// Generous max number of attacks per arena fight, used to derive a stat-aware
// per-fight cap (fair-per-hit × this). A real fight runs ~30 attacks, so 80 is
// ~2.7× headroom — a legitimate fight is never clipped, but a weak/no-stat
// account is bounded well below the flat 500k (which a tampered client could
// otherwise claim to steal MVP share). A maxed attacker still hits the flat cap.
const WEEKLY_BOSS_LOG_FIGHT_MAX_HITS = 80;
// Fight window after an admin spawns the boss. Widened 24h → 72h (gameplay-loop
// audit M-3): the boss is spawned manually (the owner controls cadence — see
// loadOrInitBoss), so a single 24h window was easy for most of the roster to
// miss entirely. 72h spans a weekend so far more players get a turn before
// rewards auto-distribute. This does NOT auto-spawn — manual cadence is
// preserved. TUNABLE. (Mirrored in WeeklyBossArena.tsx copy + fallback.)
const WEEKLY_BOSS_LIFETIME_MS = 72 * 60 * 60 * 1000;
// Maximum arena attempts a player can make per boss spawn. After this
// they're locked out until the boss despawns and a new one spawns.
const WEEKLY_BOSS_MAX_ATTEMPTS = 3;
// Reward tier cutoffs by damage rank (1-indexed in the natural reading).
const TOP_CORE_COUNT = 10;  // ranks 1..10 each receive 1 Weekly Boss Core
const TOP_KEY_COUNT = 25;   // ranks 1..25 each receive 1 Dungeon Key
const WEEKLY_BOSS_CORE_ID = 'weekly-boss-core';
const DUNGEON_KEY_ID = 'dungeon-key';

type WeeklyBossRewardEntry = {
    name: string;
    damage: number;
    rank: number;
    ryo: number;
    xp: number;
    gotCore: boolean;
    gotKey: boolean;
    isMvp: boolean;
};

type WeeklyBossState = {
    weekKey: string;
    aiId: string;
    bossName?: string;
    hpMax: number;
    // Retained for back-compat with old clients that still render an HP bar.
    // The server keeps this equal to hpMax so the bar always reads "full"
    // until the new countdown UI lands.
    hpRemaining: number;
    scaleFactor: number;
    damageByPlayer: Record<string, number>;
    // How many arena attempts each player has used against this spawn.
    // Capped at WEEKLY_BOSS_MAX_ATTEMPTS. Resets every new boss spawn.
    attemptsByPlayer?: Record<string, number>;
    startedAt: number;
    expiresAt: number;
    rewardsDistributed?: boolean;
    distributedAt?: number;
    distributionSummary?: WeeklyBossRewardEntry[];
    // Per-player credit receipts (audit #25). Names whose save credit has
    // durably succeeded. `rewardsDistributed` is only flipped true once every
    // entry in distributionSummary appears here, so a crash mid-credit leaves
    // the boss in a "summary computed, some credited" state that the next
    // GET/POST resumes — instead of marking distributed up-front and silently
    // skipping survivors forever.
    creditedPlayers?: string[];
};

// ISO week key, e.g. "2026-W21"
function isoWeekKey(d: Date = new Date()): string {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Display HP used by the leaderboard formula (ryo/xp scale off it). Kept
// for tuning even though the boss is now unkillable. Range: 50k → 150k.
function defaultBossHp(weekKey: string): number {
    const wk = parseInt(weekKey.split('-W')[1] ?? '1', 10);
    return 50000 + Math.min(53, wk) * 1900;
}

// Builtin weekly-boss roster — mirrors the client's builtin AIs
// (shinobij.client/src/lib/combat-ai.ts weeklyBossAis) and the schedule pool
// (lib/weekly-boss.ts weeklyBossPool). The server only needs each boss's id +
// name to seal into state; the client resolves the full profile + portrait by
// id (playableAis includes builtinAis). Kept in sync by hand — a small, rarely
// changing list. This is what makes "Spawn Now" work with no admin AI setup.
const BUILTIN_WEEKLY_BOSSES: Array<{ id: string; name: string }> = [
    { id: 'ashen-dragon', name: 'Ashen Dragon' },
    { id: 'moonshadow-oni', name: 'Moonshadow Oni' },
    { id: 'frostfang-warlord', name: 'Frostfang Warlord' },
    { id: 'stormveil-beast', name: 'Stormveil Beast' },
    { id: 'deathsgate-revenant', name: 'Deathsgate Revenant' },
];

// FNV-1a over the ISO week key — the SAME hash the client schedule uses
// (lib/weekly-boss.ts seededHash) so the boss the schedule teases for a given
// week is the one that actually spawns when there's no admin override.
function seededWeeklyBossIndex(weekKey: string, len: number): number {
    let hash = 2166136261;
    for (let i = 0; i < weekKey.length; i += 1) {
        hash ^= weekKey.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % Math.max(1, len);
}

async function pickDefaultBossAi(weekKey: string): Promise<{ aiId: string; bossName?: string } | null> {
    // Prefer admin-authored boss AIs in shared:ai-profiles when present.
    try {
        const list = await kv.get<Array<{ id: string; name?: string; isBossAi?: boolean }>>('shared:ai-profiles');
        if (Array.isArray(list) && list.length > 0) {
            // Prefer boss AIs; otherwise any AI.
            const bosses = list.filter(a => a.isBossAi);
            const pool = bosses.length > 0 ? bosses : list;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            return { aiId: pick.id, bossName: pick.name };
        }
    } catch {
        // ignore
    }
    // Fall back to the builtin roster, seeded by ISO week so the pick is stable
    // within a week and matches the client's advertised schedule.
    const pick = BUILTIN_WEEKLY_BOSSES[seededWeeklyBossIndex(weekKey, BUILTIN_WEEKLY_BOSSES.length)];
    return { aiId: pick.id, bossName: pick.name };
}

async function buildFreshBossState(weekKey: string): Promise<WeeklyBossState | null> {
    // Honor admin override first.
    const overrideId = await kv.get<string>(WEEKLY_BOSS_OVERRIDE_KEY);
    let aiId = overrideId ?? '';
    let bossName: string | undefined;
    if (!aiId) {
        const pick = await pickDefaultBossAi(weekKey);
        if (!pick) return null;
        aiId = pick.aiId;
        bossName = pick.bossName;
    }
    const hpMax = defaultBossHp(weekKey);
    const startedAt = Date.now();
    return {
        weekKey,
        aiId,
        bossName,
        hpMax,
        hpRemaining: hpMax,
        scaleFactor: 1 + Math.min(53, parseInt(weekKey.split('-W')[1] ?? '1', 10)) * 0.04,
        damageByPlayer: {},
        attemptsByPlayer: {},
        startedAt,
        expiresAt: startedAt + WEEKLY_BOSS_LIFETIME_MS,
    };
}

async function loadOrInitBoss(): Promise<WeeklyBossState | null> {
    // ⚠ Admin-only spawn model: the boss is NEVER auto-created here.
    // Previously this function would auto-build a fresh boss whenever
    // no state existed for the current ISO week, but the project owner
    // wants full control over cadence — they decide "what's been a week"
    // and trigger spawns via POST { kind: "reset" } from the admin panel.
    // GET requests therefore return whatever state is in KV (or null if
    // no boss has ever been spawned).
    const existing = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
    if (!existing) return null;
    // Old saves predate expiresAt — backfill so the despawn logic has
    // something to compare against. Treats any pre-expiresAt boss as if
    // it started at its recorded startedAt.
    if (!existing.expiresAt) {
        existing.expiresAt = (existing.startedAt ?? Date.now()) + WEEKLY_BOSS_LIFETIME_MS;
    }
    return existing;
}

// Distribute rewards once 24h has elapsed. Idempotent + crash-resumable
// (audit #25):
//   1. Under the boss-lock, COMPUTE the distributionSummary (once) and persist
//      it WITHOUT setting rewardsDistributed. The reward amounts are frozen at
//      this point so a re-run never recomputes a different payout.
//   2. Outside the boss-lock, credit each contributor's save. Each successful
//      credit appends the player's name to creditedPlayers and persists it,
//      so a credit is recorded the moment it lands. Already-credited players
//      are skipped on re-entry — re-runs only retry the ones that didn't land.
//   3. Once every summary entry is credited, flip rewardsDistributed = true.
// If the process dies mid-credit, the next GET/POST re-enters and finishes the
// remaining credits instead of marking distributed up-front and stranding them.
async function distributeRewardsIfExpired(boss: WeeklyBossState): Promise<WeeklyBossState> {
    if (boss.rewardsDistributed) return boss;
    if (Date.now() < boss.expiresAt) return boss;

    let summary: WeeklyBossRewardEntry[] | null = null;
    let finalBoss: WeeklyBossState = boss;

    // Phase 1 — compute + freeze the summary under the boss-lock (idempotent).
    await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
        const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss;
        if (fresh.rewardsDistributed) {
            finalBoss = fresh;
            return;
        }
        if (Date.now() < fresh.expiresAt) {
            // Lost the expiry race — someone else extended somehow. Bail.
            finalBoss = fresh;
            return;
        }

        // Already computed on a prior (crashed) run — resume with the FROZEN
        // summary so payouts don't change between attempts.
        if (Array.isArray(fresh.distributionSummary) && fresh.distributionSummary.length >= 0 && fresh.distributedAt) {
            summary = fresh.distributionSummary;
            finalBoss = fresh;
            return;
        }

        const entries = Object.entries(fresh.damageByPlayer)
            .sort(([, a], [, b]) => (b as number) - (a as number));
        const totalDmg = entries.reduce((sum, [, dmg]) => sum + (dmg as number), 0) || 1;
        const baseRyo = Math.floor(fresh.hpMax * 0.5);
        const baseXp = Math.floor(fresh.hpMax * 0.25);

        const computed: WeeklyBossRewardEntry[] = entries.map(([name, dmg], i) => {
            const share = (dmg as number) / totalDmg;
            const isMvp = i === 0;
            return {
                name,
                damage: dmg as number,
                rank: i + 1,
                ryo: Math.max(100, Math.floor(baseRyo * share * (isMvp ? 2 : 1) + 200)),
                xp: Math.max(50, Math.floor(baseXp * share * (isMvp ? 2 : 1) + 100)),
                gotCore: i < TOP_CORE_COUNT,
                gotKey: i < TOP_KEY_COUNT,
                isMvp,
            };
        });

        const updated: WeeklyBossState = {
            ...fresh,
            // NOT distributed yet — only after all credits succeed (phase 3).
            distributedAt: Date.now(),
            distributionSummary: computed,
            creditedPlayers: Array.isArray(fresh.creditedPlayers) ? fresh.creditedPlayers : [],
        };
        await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
        summary = computed;
        finalBoss = updated;
    });

    if (!summary) return finalBoss;

    // Phase 2 — credit each contributor outside the boss-lock. Per-save locks
    // are independent of the boss-lock and only serialize that player's own
    // concurrent saves. Bots / dead players (no save row) are marked credited
    // (nothing to pay) so they don't block phase-3 completion forever.
    const alreadyCredited = new Set<string>(finalBoss.creditedPlayers ?? []);
    const newlyCredited: string[] = [];
    const weekKey = finalBoss.weekKey;
    // Era contribution: one felled boss per spawn, exactly once (NX per week).
    try {
        const counted = await kv.set(`era:boss-counted:${weekKey}`, true, { nx: true, ex: 35 * 24 * 60 * 60 });
        if (counted) await bumpEraContribution('bossKills');
    } catch { /* best-effort */ }
    for (const entry of summary as WeeklyBossRewardEntry[]) {
        if (alreadyCredited.has(entry.name)) continue;
        try {
            const did = await withKvLock(saveKeyCreditScope(entry.name), async () => {
                const saveKey = `save:${entry.name}`;
                const fresh = await kv.get<Record<string, unknown>>(saveKey);
                const freshChar = fresh?.character as Record<string, unknown> | undefined;
                if (!fresh || !freshChar) return true; // no save → nothing to credit; count as done

                // EXACTLY-ONCE GATE (audit #25). Two concurrent distribute
                // passes (e.g. two GETs after expiry) both iterate the frozen
                // summary; without this an entry could be paid twice. Reserve a
                // per-(week,player) receipt with NX — only the first pass wins
                // the reservation and applies the credit. The receipt key
                // embeds weekKey so it's scoped to this boss spawn and self-
                // expires. On credit-write failure we roll the reservation back
                // so a later run can retry. TTL outlives any realistic retry
                // window (boss lifetime is 24h; 35d is generous + self-cleaning).
                const receiptKey = `weekly-boss-credit:${weekKey}:${entry.name}`;
                const reserved = await kv.set(receiptKey, '1', { nx: true, ex: 35 * 24 * 60 * 60 });
                if (!reserved) return true; // already credited by another pass

                try {
                    const currentInventory = Array.isArray(freshChar.inventory)
                        ? [...(freshChar.inventory as string[])]
                        : [];
                    if (entry.gotCore) currentInventory.push(WEEKLY_BOSS_CORE_ID);
                    if (entry.gotKey) currentInventory.push(DUNGEON_KEY_ID);
                    // Credit XP through the server gainXp() port (same engine the
                    // mission/tower credits use): a raw `char.xp += entry.xp` is
                    // per-level progress that the client clamps to level*100 on
                    // load, so the headline XP would be silently lost. gainXp
                    // applies the ×3 multiplier itself (pass entry.xp directly
                    // like the other callers), levels the character up, and
                    // returns the leveled level/xp/maxHp/maxChakra/maxStamina/
                    // rankTitle fields which we spread back in.
                    const leveled = gainXp(freshChar as unknown as XpCharacter, entry.xp) as unknown as Record<string, unknown>;
                    const updated = {
                        ...fresh,
                        character: {
                            ...freshChar,
                            level: leveled.level,
                            xp: leveled.xp,
                            maxHp: leveled.maxHp,
                            maxChakra: leveled.maxChakra,
                            maxStamina: leveled.maxStamina,
                            rankTitle: leveled.rankTitle,
                            ryo: Math.max(0, Number(freshChar.ryo ?? 0)) + entry.ryo,
                            inventory: currentInventory,
                        },
                    };
                    bumpSaveVersion(updated);
                    await kv.set(saveKey, mergePreservingImages(updated, fresh));
                    return true;
                } catch (creditErr) {
                    // Roll back the reservation so the next run re-credits.
                    await kv.del(receiptKey).catch(() => undefined);
                    throw creditErr;
                }
            });
            if (did) {
                newlyCredited.push(entry.name);
                // Legacy tracking (ENABLE_LEGACY): the weekly boss is the live
                // source for boss/event legacy proof — contribution damage,
                // top-10 placements, event participation, and (for the MVP) a
                // server-history first-clear. Rides the exactly-once receipt
                // above; best-effort by design.
                await bumpLegacyStats(entry.name, {
                    bossContribution: Math.max(0, Math.floor(entry.damage ?? 0)),
                    eventCompletions: 1,
                    ...(entry.rank <= 10 ? { weeklyBossTop10: 1, eliteKills: 5 } : {}),
                    ...(entry.isMvp ? { firstClears: 1 } : {}),
                });
            }
        } catch (err) {
            // Leave this player OUT of creditedPlayers so a later run retries.
            console.warn(`[weekly-boss] credit ${entry.name} failed (will retry):`, err);
        }
    }

    // Phase 3 — persist receipts and, if everyone is now credited, flip the
    // distributed flag. Done under the boss-lock to avoid clobbering a
    // concurrent crediting pass.
    if (newlyCredited.length > 0 || !finalBoss.rewardsDistributed) {
        await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
            const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? finalBoss;
            const credited = new Set<string>([...(fresh.creditedPlayers ?? []), ...newlyCredited]);
            const summaryNames = (fresh.distributionSummary ?? summary ?? []).map(e => e.name);
            const allDone = summaryNames.every(n => credited.has(n));
            const updated: WeeklyBossState = {
                ...fresh,
                creditedPlayers: [...credited],
                rewardsDistributed: allDone ? true : fresh.rewardsDistributed,
            };
            await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
            finalBoss = updated;
        });
    }

    return finalBoss;
}

// The per-player save credit serializes on the same logical lock target as
// the save endpoint's own lock so a weekly-boss credit and a concurrent
// player autosave don't interleave a lost update. (save endpoint locks on
// `save:<name>`; we mirror that target string here.)
function saveKeyCreditScope(name: string): string {
    return `save:${name}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        let boss = await loadOrInitBoss();
        // Run the expiry check on read so the leaderboard reflects the
        // post-distribution state even if no one has attacked since the
        // 24h mark passed. Distribution is a no-op if already done.
        if (boss) boss = await distributeRewardsIfExpired(boss);
        res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        return res.status(200).json({ boss });
    }

    if (req.method === 'POST') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind, weekKey, amount } = body as { kind?: string; weekKey?: string; amount?: number };

            let boss = await loadOrInitBoss();
            if (!boss) return res.status(409).json({ error: 'No boss is currently spawned. An admin needs to hit "Spawn Now" in the admin panel.' });
            if (weekKey && weekKey !== boss.weekKey) return res.status(409).json({ error: 'Stale week — boss has reset.' });

            // Auto-despawn + distribute. Any POST after the 24h mark
            // triggers reward distribution before refusing further input.
            if (Date.now() >= boss.expiresAt) {
                boss = await distributeRewardsIfExpired(boss);
                return res.status(409).json({ error: 'Boss despawned. Rewards have been distributed.', boss });
            }

            const actorName = identity.admin ? 'admin' : identity.name;

            if (kind === 'damage') {
                // Per-player cooldown — prevents loop spamming damage POSTs.
                if (!identity.admin) {
                    const cdKey = `${WEEKLY_BOSS_COOLDOWN_KEY_PREFIX}${actorName}`;
                    const placed = await kv.set(cdKey, '1', { nx: true, ex: WEEKLY_BOSS_COOLDOWN_SECONDS });
                    if (!placed) {
                        return res.status(429).json({ error: `Cooldown — wait ${WEEKLY_BOSS_COOLDOWN_SECONDS}s between attacks.` });
                    }
                }

                // Look up actor stats to compute a server-trusted damage cap
                // for this single request. Matches the legitimate client roll
                // (best offensive stat × (1 + level/100) × max 1.4 multiplier).
                //
                // `best` is clamped before the formula so a stat-padded save
                // can't drive the fairMax up to the absolute cap. Even maxed
                // legitimate stats top out around 1500–2000 per offense slot;
                // 2500 is a generous ceiling that lets late-game vanguards
                // dump the cap but stops a tampered save from blowing past
                // it to maximize the per-actor MVP bonus.
                const MAX_OFFENSE_STAT_FOR_CAP = 2500;
                let perActorCap = WEEKLY_BOSS_DMG_ABSOLUTE_CAP;
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const stats = (actorChar?.stats ?? {}) as Record<string, number>;
                        const level = Math.max(1, Math.min(100, Math.floor(Number(actorChar?.level ?? 1))));
                        const rawBest = Math.max(
                            Number(stats.bukijutsuOffense ?? 0),
                            Number(stats.taijutsuOffense ?? 0),
                            Number(stats.ninjutsuOffense ?? 0),
                            Number(stats.genjutsuOffense ?? 0),
                        );
                        const best = Math.min(MAX_OFFENSE_STAT_FOR_CAP, rawBest);
                        const fairMax = Math.max(50, Math.floor(best * (1 + level / 100) * 1.4));
                        perActorCap = Math.min(WEEKLY_BOSS_DMG_ABSOLUTE_CAP, fairMax);
                    } catch {
                        // If we can't load stats, fall back to the absolute cap.
                    }
                }

                const requested = Math.floor(Number(amount ?? 0));
                if (!Number.isFinite(requested) || requested <= 0) return res.status(400).json({ error: 'Invalid damage amount.' });
                const dmg = Math.max(1, Math.min(perActorCap, requested));

                // Serialize concurrent damage writes via a KV lock so two
                // attackers can't both read the same damageByPlayer and both
                // write back, silently dropping one player's damage.
                const result = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                    const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss!;
                    if (fresh.weekKey !== boss!.weekKey) return { error: 'stale-week' as const };
                    if (fresh.rewardsDistributed) return { error: 'expired' as const };
                    if (Date.now() >= fresh.expiresAt) return { error: 'expired' as const };
                    const updated: WeeklyBossState = {
                        ...fresh,
                        damageByPlayer: {
                            ...fresh.damageByPlayer,
                            [actorName]: (fresh.damageByPlayer[actorName] ?? 0) + dmg,
                        },
                    };
                    await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
                    return { boss: updated, dealt: dmg };
                });

                if ('error' in result) {
                    if (result.error === 'stale-week') return res.status(409).json({ error: 'Stale week — boss has reset.' });
                    return res.status(409).json({ error: 'Boss despawned. Rewards have been distributed.' });
                }
                return res.status(200).json(result);
            }

            if (kind === 'logFight') {
                // End-of-arena-fight damage report. Client launches the
                // standard arena vs the boss AI (HP set to a sentinel so
                // the boss is effectively unkillable), tracks how much
                // damage the player dealt, then POSTs the total here when
                // the player is KO'd or flees. Counted as one attempt.
                if (!identity.admin) {
                    const used = boss.attemptsByPlayer?.[actorName] ?? 0;
                    if (used >= WEEKLY_BOSS_MAX_ATTEMPTS) {
                        return res.status(429).json({ error: `Locked out — you've used your ${WEEKLY_BOSS_MAX_ATTEMPTS} attempts for this boss spawn.` });
                    }
                }
                // Stat-derived per-fight cap (mirrors the per-tap `damage` cap,
                // scaled by a generous max-hits-per-fight so a legitimate full
                // arena fight is never clipped). Bounds a tampered/weak-account
                // report well below the flat cap; a maxed attacker is unaffected.
                let perFightCap = WEEKLY_BOSS_LOG_FIGHT_CAP;
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const stats = (actorChar?.stats ?? {}) as Record<string, number>;
                        const level = Math.max(1, Math.min(100, Math.floor(Number(actorChar?.level ?? 1))));
                        const rawBest = Math.max(
                            Number(stats.bukijutsuOffense ?? 0),
                            Number(stats.taijutsuOffense ?? 0),
                            Number(stats.ninjutsuOffense ?? 0),
                            Number(stats.genjutsuOffense ?? 0),
                        );
                        const best = Math.min(2500, rawBest); // matches the per-tap cap's MAX_OFFENSE_STAT_FOR_CAP
                        const fairPerHit = Math.max(50, Math.floor(best * (1 + level / 100) * 1.4));
                        perFightCap = Math.min(WEEKLY_BOSS_LOG_FIGHT_CAP, fairPerHit * WEEKLY_BOSS_LOG_FIGHT_MAX_HITS);
                    } catch {
                        // Can't load stats — fall back to the flat cap.
                    }
                }
                const requested = Math.floor(Number(amount ?? 0));
                if (!Number.isFinite(requested) || requested < 0) {
                    return res.status(400).json({ error: 'Invalid damage amount.' });
                }
                const logged = Math.min(perFightCap, Math.max(0, requested));

                const result = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                    const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss!;
                    if (fresh.weekKey !== boss!.weekKey) return { error: 'stale-week' as const };
                    if (fresh.rewardsDistributed) return { error: 'expired' as const };
                    if (Date.now() >= fresh.expiresAt) return { error: 'expired' as const };
                    const used = fresh.attemptsByPlayer?.[actorName] ?? 0;
                    if (!identity.admin && used >= WEEKLY_BOSS_MAX_ATTEMPTS) {
                        return { error: 'locked' as const };
                    }
                    const updated: WeeklyBossState = {
                        ...fresh,
                        damageByPlayer: {
                            ...fresh.damageByPlayer,
                            [actorName]: (fresh.damageByPlayer[actorName] ?? 0) + logged,
                        },
                        attemptsByPlayer: {
                            ...(fresh.attemptsByPlayer ?? {}),
                            [actorName]: used + 1,
                        },
                    };
                    await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
                    return { boss: updated, dealt: logged, attemptsUsed: used + 1 };
                });

                if ('error' in result) {
                    if (result.error === 'stale-week') return res.status(409).json({ error: 'Stale week — boss has reset.' });
                    if (result.error === 'locked') return res.status(429).json({ error: `Locked out — you've used your ${WEEKLY_BOSS_MAX_ATTEMPTS} attempts for this boss spawn.` });
                    return res.status(409).json({ error: 'Boss despawned. Rewards have been distributed.' });
                }
                return res.status(200).json(result);
            }

            if (kind === 'claim') {
                // Legacy endpoint. Rewards are now auto-distributed at the
                // 24h despawn (see distributeRewardsIfExpired). Return the
                // player's summary entry if it exists so old clients can
                // still display it; otherwise tell them rewards aren't ready.
                if (!boss.rewardsDistributed) {
                    return res.status(409).json({ error: 'Boss is still alive — rewards distribute automatically when it despawns.' });
                }
                const entry = (boss.distributionSummary ?? []).find(e => e.name === actorName);
                if (!entry) return res.status(403).json({ error: 'You did not damage this boss.' });
                return res.status(200).json({ boss, reward: entry, note: 'Rewards were already credited to your save.' });
            }

            if (kind === 'reset') {
                if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
                const fresh = await buildFreshBossState(isoWeekKey());
                if (!fresh) return res.status(409).json({ error: 'No AI available for reset.' });
                await kv.set(WEEKLY_BOSS_STATE_KEY, fresh);
                // Herald the spawn server-wide: the world news feed AND a World
                // Herald line in every village chat (importance 'high' always
                // lands + broadcasts). Best-effort — announce() never throws into
                // the spawn. Every weekly-boss spawn heralds the hunt.
                await announce({
                    type: 'weekly_boss',
                    importance: 'high',
                    title: `⚔️ Weekly Boss: ${fresh.bossName ?? 'A great enemy'} has appeared!`,
                    message: `${fresh.bossName ?? 'A fearsome boss'} rampages for 72 hours. Seek it out and deal all the damage you can — the top damagers claim a Weekly Boss Core, Dungeon Keys, ryo and XP. Enter the hunt via Central Hub → Weekly Boss.`,
                    meta: { aiId: fresh.aiId, weekKey: fresh.weekKey, expiresAt: fresh.expiresAt },
                });
                return res.status(200).json({ boss: fresh });
            }

            return res.status(400).json({ error: 'Unknown kind.' });
        } catch (err) {
            console.error('[weekly-boss]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
