import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors, mergePreservingImages } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { withKvLock } from './_lock.js';

// One weekly boss state per ISO week. Players damage a shared "rampage
// meter" (no HP cap — the boss cannot be killed by damage). 24h after
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
// 24h fight window. After this the boss "despawns" and rewards are
// auto-distributed on the next POST that lands.
const WEEKLY_BOSS_LIFETIME_MS = 24 * 60 * 60 * 1000;
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

async function pickDefaultBossAi(): Promise<{ aiId: string; bossName?: string } | null> {
    // The full creator AI registry is in shared:ai-profiles (a JSON list of AIs).
    // If no list is present (or empty), fall back to a hardcoded sentinel id.
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
    return null;
}

async function buildFreshBossState(weekKey: string): Promise<WeeklyBossState | null> {
    // Honor admin override first.
    const overrideId = await kv.get<string>(WEEKLY_BOSS_OVERRIDE_KEY);
    let aiId = overrideId ?? '';
    let bossName: string | undefined;
    if (!aiId) {
        const pick = await pickDefaultBossAi();
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
    const currentWeek = isoWeekKey();
    const existing = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
    if (existing && existing.weekKey === currentWeek) {
        // Old saves predate expiresAt — backfill so the despawn logic has
        // something to compare against. Treats any pre-expiresAt boss as if
        // it started at its recorded startedAt.
        if (!existing.expiresAt) {
            existing.expiresAt = (existing.startedAt ?? Date.now()) + WEEKLY_BOSS_LIFETIME_MS;
        }
        return existing;
    }
    // Either no boss yet, or last boss was a different week → reset.
    const fresh = await buildFreshBossState(currentWeek);
    if (fresh) await kv.set(WEEKLY_BOSS_STATE_KEY, fresh);
    return fresh;
}

// Distribute rewards once 24h has elapsed. Idempotent: rewardsDistributed
// is flipped inside the boss-lock so two concurrent expiry-triggers can't
// both credit. Per-save crediting happens outside the boss-lock so each
// save:<name> write only blocks that player's own concurrent saves.
async function distributeRewardsIfExpired(boss: WeeklyBossState): Promise<WeeklyBossState> {
    if (boss.rewardsDistributed) return boss;
    if (Date.now() < boss.expiresAt) return boss;

    let summary: WeeklyBossRewardEntry[] | null = null;
    let finalBoss: WeeklyBossState = boss;

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
            rewardsDistributed: true,
            distributedAt: Date.now(),
            distributionSummary: computed,
        };
        await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
        summary = computed;
        finalBoss = updated;
    });

    // Credit each contributor outside the boss-lock — per-save locks are
    // independent of the boss-lock and only serialize concurrent writes
    // for the same player. Bots / dead players (no save row) are skipped.
    if (summary) {
        for (const entry of summary as WeeklyBossRewardEntry[]) {
            const saveKey = `save:${entry.name}`;
            try {
                await withKvLock(saveKey, async () => {
                    const fresh = await kv.get<Record<string, unknown>>(saveKey);
                    const freshChar = fresh?.character as Record<string, unknown> | undefined;
                    if (!fresh || !freshChar) return;
                    const currentInventory = Array.isArray(freshChar.inventory)
                        ? [...(freshChar.inventory as string[])]
                        : [];
                    if (entry.gotCore) currentInventory.push(WEEKLY_BOSS_CORE_ID);
                    if (entry.gotKey) currentInventory.push(DUNGEON_KEY_ID);
                    const updated = {
                        ...fresh,
                        character: {
                            ...freshChar,
                            ryo: Math.max(0, Number(freshChar.ryo ?? 0)) + entry.ryo,
                            xp: Math.max(0, Number(freshChar.xp ?? 0)) + entry.xp,
                            inventory: currentInventory,
                        },
                    };
                    await kv.set(saveKey, mergePreservingImages(updated, fresh));
                });
            } catch (err) {
                console.warn(`[weekly-boss] credit ${entry.name} failed:`, err);
            }
        }
    }

    return finalBoss;
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
            if (!boss) return res.status(409).json({ error: 'No boss available — admin must set weeklyBossOverride.' });
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
                const requested = Math.floor(Number(amount ?? 0));
                if (!Number.isFinite(requested) || requested < 0) {
                    return res.status(400).json({ error: 'Invalid damage amount.' });
                }
                const logged = Math.min(WEEKLY_BOSS_LOG_FIGHT_CAP, Math.max(0, requested));

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
