import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { withKvLock } from './_lock.js';

// One weekly boss state per ISO week. Players damage the shared HP pool;
// when it hits 0 the boss is dead and each contributor can claim rewards.
// New ISO week → boss is auto-reset (picks a random non-boss AI, or uses the
// admin-set weeklyBossOverride if present).

const WEEKLY_BOSS_STATE_KEY = 'game:weekly-boss-state';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';
const WEEKLY_BOSS_COOLDOWN_KEY_PREFIX = 'rl:weekly-boss:';
const WEEKLY_BOSS_COOLDOWN_SECONDS = 3;
// Per-request damage hard ceiling. Even at high level the legitimate client
// attack roll (best offensive stat × ~1.5 × random) tops out well under this.
// Server still uses per-actor stats for a tighter cap; this is the absolute lid.
const WEEKLY_BOSS_DMG_ABSOLUTE_CAP = 20000;

type WeeklyBossState = {
    weekKey: string;
    aiId: string;
    bossName?: string;
    hpMax: number;
    hpRemaining: number;
    scaleFactor: number;
    damageByPlayer: Record<string, number>;
    startedAt: number;
    lastKillRewardedAt?: number;
    killRewardedTo?: string[];
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

// Default boss HP scales with the week (slowly grows over the year) so later
// weeks have meatier bosses. Range: 50k → 150k.
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
    return {
        weekKey,
        aiId,
        bossName,
        hpMax,
        hpRemaining: hpMax,
        scaleFactor: 1 + Math.min(53, parseInt(weekKey.split('-W')[1] ?? '1', 10)) * 0.04,
        damageByPlayer: {},
        startedAt: Date.now(),
    };
}

async function loadOrInitBoss(): Promise<WeeklyBossState | null> {
    const currentWeek = isoWeekKey();
    const existing = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY);
    if (existing && existing.weekKey === currentWeek) return existing;
    // Either no boss yet, or last boss was a different week → reset.
    const fresh = await buildFreshBossState(currentWeek);
    if (fresh) await kv.set(WEEKLY_BOSS_STATE_KEY, fresh);
    return fresh;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        const boss = await loadOrInitBoss();
        res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        return res.status(200).json({ boss });
    }

    if (req.method === 'POST') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind, weekKey, amount } = body as { kind?: string; weekKey?: string; amount?: number };

            const boss = await loadOrInitBoss();
            if (!boss) return res.status(409).json({ error: 'No boss available — admin must set weeklyBossOverride.' });
            if (weekKey && weekKey !== boss.weekKey) return res.status(409).json({ error: 'Stale week — boss has reset.' });

            const actorName = identity.admin ? 'admin' : identity.name;

            if (kind === 'damage') {
                if (boss.hpRemaining <= 0) return res.status(409).json({ error: 'Boss already defeated.' });

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
                // (best offensive stat × (1 + level/100) × max 1.3 multiplier).
                let perActorCap = WEEKLY_BOSS_DMG_ABSOLUTE_CAP;
                if (!identity.admin) {
                    try {
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${actorName}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const stats = (actorChar?.stats ?? {}) as Record<string, number>;
                        const level = Math.max(1, Math.min(100, Math.floor(Number(actorChar?.level ?? 1))));
                        const best = Math.max(
                            Number(stats.bukijutsuOffense ?? 0),
                            Number(stats.taijutsuOffense ?? 0),
                            Number(stats.ninjutsuOffense ?? 0),
                            Number(stats.genjutsuOffense ?? 0),
                        );
                        const fairMax = Math.max(50, Math.floor(best * (1 + level / 100) * 1.4));
                        perActorCap = Math.min(WEEKLY_BOSS_DMG_ABSOLUTE_CAP, fairMax);
                    } catch {
                        // If we can't load stats, fall back to the absolute cap.
                    }
                }

                const requested = Math.floor(Number(amount ?? 0));
                if (!Number.isFinite(requested) || requested <= 0) return res.status(400).json({ error: 'Invalid damage amount.' });
                const dmg = Math.max(1, Math.min(boss.hpRemaining, Math.min(perActorCap, requested)));

                // Serialize concurrent damage writes via a KV lock so two
                // attackers can't both read the same hpRemaining and both
                // write back, silently dropping one player's damage. Inside
                // the lock we still do a fresh read so we always work on the
                // newest state.
                const result = await withKvLock(WEEKLY_BOSS_STATE_KEY, async () => {
                    const fresh = await kv.get<WeeklyBossState>(WEEKLY_BOSS_STATE_KEY) ?? boss;
                    if (fresh.weekKey !== boss.weekKey) return { error: 'stale-week' as const };
                    if (fresh.hpRemaining <= 0) return { error: 'defeated' as const };
                    const appliedDmg = Math.min(dmg, fresh.hpRemaining);
                    const updated: WeeklyBossState = {
                        ...fresh,
                        hpRemaining: fresh.hpRemaining - appliedDmg,
                        damageByPlayer: {
                            ...fresh.damageByPlayer,
                            [actorName]: (fresh.damageByPlayer[actorName] ?? 0) + appliedDmg,
                        },
                    };
                    await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
                    return { boss: updated, dealt: appliedDmg };
                });

                if ('error' in result) {
                    if (result.error === 'stale-week') return res.status(409).json({ error: 'Stale week — boss has reset.' });
                    return res.status(409).json({ error: 'Boss already defeated.' });
                }
                return res.status(200).json(result);
            }

            if (kind === 'claim') {
                if (boss.hpRemaining > 0) return res.status(409).json({ error: 'Boss is still alive.' });
                const claimed = boss.killRewardedTo ?? [];
                if (claimed.includes(actorName)) return res.status(409).json({ error: 'Already claimed.' });
                const myDamage = boss.damageByPlayer[actorName] ?? 0;
                if (myDamage <= 0) return res.status(403).json({ error: 'You did not damage this boss.' });

                // Reward formula: participation share + flat completion.
                // Top damage dealer gets MVP bonus (×2).
                const totalDmg = Object.values(boss.damageByPlayer).reduce((a, b) => a + b, 0) || 1;
                const share = myDamage / totalDmg;
                const baseRyo = Math.floor(boss.hpMax * 0.5);
                const baseXp = Math.floor(boss.hpMax * 0.25);
                const top = Object.entries(boss.damageByPlayer).sort(([, a], [, b]) => b - a)[0];
                const isMvp = top?.[0] === actorName;
                const reward = {
                    ryo: Math.max(100, Math.floor(baseRyo * share * (isMvp ? 2 : 1) + 200)),
                    xp: Math.max(50, Math.floor(baseXp * share * (isMvp ? 2 : 1) + 100)),
                    isMvp,
                };

                const updated: WeeklyBossState = {
                    ...boss,
                    lastKillRewardedAt: boss.lastKillRewardedAt ?? Date.now(),
                    killRewardedTo: [...claimed, actorName],
                };
                await kv.set(WEEKLY_BOSS_STATE_KEY, updated);
                return res.status(200).json({ boss: updated, reward });
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
