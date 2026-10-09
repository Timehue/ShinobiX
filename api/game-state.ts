import { readElderCouncil } from './village/_elder-council.js';
import { readVillageAnbu } from './village/_anbu.js';
import { createVillageMembershipReader } from './village/_membership-reader.js';
import { readPublicPlayerIndex } from './player/_public-index-store.js';
import { WAR_VILLAGES } from './_war-map-sectors.js';
import { leadershipVillageKey } from '../shared/village-anbu.js';
import { safeLogValue } from './_safe-log.js';
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cachedFor } from './_proc-cache.js';
import { cors, safeName, setSafeRecordValue } from './_utils.js';
import { authedPlayerOrAdmin, isFullAdmin } from './_auth.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { withKvLock, LockContendedError } from './_lock.js';
import { validateVillageStateWrite, loadAuthoritativeKage } from './_village-state-validate.js';
import { publicVillageStateView } from './_village-state-view.js';
import { mutatePlayerSave } from './save/_mutate-player-save.js';
import { applyTournamentVictory } from './achievements/_tournament.js';
import { setCircuitEnabled } from './dojo-circuit/_store.js';
import { readActiveBoostEvent } from './_boost-event.js';

const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';
const DOJO_CIRCUIT_ENABLED_KEY = 'game:dojo-circuit:enabled';
// Process-local cache for the hot ~5s frame: bounds the two keyspace scans to
// once per 3s no matter how many clients poll. s-maxage is dropped 8->5 below to
// offset this window, so proc ttl (3s) + CDN (5s) = the original 8s worst-case
// staleness — a village-state write from another handler surfaces no later than
// it did before this cache existed. The village endpoints that write the row
// (orders, leadership, treasury donate/transfer, upgrade, agenda, Hollow Gate,
// war-structure) also drop the entry, so the next poll after one of them
// rebuilds instead of serving the pre-write frame. (Since the frame went public
// fields only, api/_village-state-view.ts, just the leadership and Hollow Gate
// writes change what it shows; the rest only cost a rebuild.) The villageState POST below
// deliberately does NOT: it is free to call, so dropping the entry there would
// let any player force a rebuild of this shared frame on demand.
const GAME_STATE_TTL_MS = 3000;

function clanPetBattleKey(clanName: string) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            if (req.query.activeFights === '1') {
                const fights = await kv.get<Array<{ startedAt?: number }>>(ARENA_ACTIVE_FIGHTS_KEY) ?? [];
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).json({ arenaActiveFights: fights.filter(f =>
                    f && Number.isFinite(f.startedAt) && Date.now() - Number(f.startedAt) < 2 * 60 * 60 * 1000),
                });
            }
            // Village leadership portraits are large base64 images that change
            // rarely. They used to ride this frame — which clients poll every 5s
            // — at ~355KB per response. They're now served only on an explicit
            // ?images=1 request (long CDN TTL); the default frame below omits
            // them so the hot poll stays tiny. The client polls the images
            // variant on a slow ~5-min cadence. Mirrors the presence/pet-image strip.
            if (req.query.images === '1') {
                const leadershipImages = await kv.get<Record<string, unknown>>(LEADERSHIP_IMAGES_KEY);
                res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
                return res.status(200).json({ villageLeadershipImages: leadershipImages ?? null });
            }

            // Collapse the two keyspace scans (+ their mgets + the body hash) across
            // every client polling this hot frame into at most one build per
            // GAME_STATE_TTL_MS, regardless of how many poll at once. Safe on the
            // single-process Railway host (see api/_realtime/online-store.ts).
            const { payload, etag } = await cachedFor('game-state:frame', GAME_STATE_TTL_MS, async () => {
                const [storedVillageStateKeys, arenaTournament, arenaActiveFights, clanPetBattleKeys, weeklyBossAiId, dojoCircuitEnabled, boostEvent] = await Promise.all([
                    kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                    kv.get<unknown>(ARENA_TOURNAMENT_KEY),
                    kv.get<unknown[]>(ARENA_ACTIVE_FIGHTS_KEY),
                    kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
                    kv.get<string>(WEEKLY_BOSS_OVERRIDE_KEY),
                    kv.get<boolean>(DOJO_CIRCUIT_ENABLED_KEY),
                    readActiveBoostEvent(),
                ]);

                // Leadership has its own authority rows. A newly initialized
                // village must be visible before its first shared-state write.
                const villageStateKeys = [...new Set([...storedVillageStateKeys,
                    ...WAR_VILLAGES.map(village => `${VILLAGE_STATE_PREFIX}${leadershipVillageKey(village)}`)])];

                // Both collections are independent indexed reads. One batch
                // avoids a second round trip and a serial wait on cache misses.
                const villageNames = villageStateKeys.map(key => {
                    const slug = key.slice(VILLAGE_STATE_PREFIX.length);
                    return WAR_VILLAGES.find(village => leadershipVillageKey(village) === slug) ?? slug;
                });
                const kageKeys = villageNames.map(village => `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`);
                const stateKeys = [...villageStateKeys, ...clanPetBattleKeys, ...kageKeys];
                const stateValues = stateKeys.length ? await kv.mget<unknown[]>(...stateKeys) : [];
                const candidates = villageStateKeys.length ? [...(await readPublicPlayerIndex({ backfill: true, logContext: 'game-state-anbu' })).entries.values()] : [];
                // Membership needs only the current village, not each complete
                // save blob. Batch simultaneous display checks across councils;
                // election resolution and every authority caller keep live kv.
                const membershipStore = createVillageMembershipReader(kv);
                const villageStates: Record<string, unknown> = {};
                if (villageStateKeys.length > 0) {
                    await Promise.all(villageStateKeys.map(async (k, i) => {
                        const name = k.slice(VILLAGE_STATE_PREFIX.length);
                        const state = (stateValues[i] ?? {}) as Record<string, unknown>;
                        const kage = stateValues[villageStateKeys.length + clanPetBattleKeys.length + i] as { seatedKage?: string; kageSystemUnlocked?: boolean; firstLiberator?: string } | null;
                        const [elders, anbu] = await Promise.all([
                            readElderCouncil(name, state, Date.now(), membershipStore),
                            readVillageAnbu(name, state, membershipStore, candidates),
                        ]);
                        // Public fields only (owner ruling 2026-10-08): this frame
                        // needs no login and is CDN-cached, so a village's
                        // treasury, upgrades, orders and logs are served to its
                        // members by /api/village/state (api/_village-state-view.ts).
                        setSafeRecordValue(villageStates, name, { ...publicVillageStateView(state), seatedKage: kage?.seatedKage,
                            kageSystemUnlocked: Boolean(kage?.kageSystemUnlocked), firstLiberator: kage?.firstLiberator,
                            elderAppointees: elders.seats, elderTerm: elders, anbuAppointees: anbu.appointed, anbuEarned: anbu.earned, anbuMembers: anbu.members });
                    }));
                }

                const clanPetBattles: Record<string, unknown> = {};
                if (clanPetBattleKeys.length > 0) {
                    clanPetBattleKeys.forEach((k, i) => {
                        const value = stateValues[villageStateKeys.length + i];
                        if (value != null) {
                            const name = k.slice(CLAN_PET_BATTLE_PREFIX.length);
                            setSafeRecordValue(clanPetBattles, name, value);
                        }
                    });
                }

                const built = {
                    villageStates,
                    arenaTournament: arenaTournament ?? null,
                    arenaActiveFights: Array.isArray(arenaActiveFights) ? arenaActiveFights : [],
                    clanPetBattles,
                    weeklyBossAiId: weeklyBossAiId ?? null,
                    dojoCircuitEnabled: dojoCircuitEnabled === true,
                    // The running timed boost event, or null. Clients re-check
                    // endsAt themselves, so a cached frame never shows a stale one.
                    boostEvent,
                };
                const builtEtag = `W/"${createHash('sha256').update(JSON.stringify(built)).digest('base64')}"`;
                return { payload: built, etag: builtEtag };
            });

            // s-maxage lowered 8->5 to offset the 3s process cache above, so the
            // total worst-case staleness stays at the original ~8s while origin
            // scans are bounded to once per 3s. The content-hash ETag lets the CDN
            // (and origin) skip re-sending an unchanged body via a 304.
            res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=5');
            res.setHeader('ETag', etag);
            if (req.headers['if-none-match'] === etag) {
                return res.status(304).end();
            }
            return res.status(200).json(payload);
        } catch (err) {
            console.error('[game-state]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body as { kind?: string };

            // Every kind now requires auth. The previous "openKinds" branch
            // that exempted `pendingClanPetBattle` let any anonymous caller
            // write or delete the pet-battle slot for any clan (since the
            // body provides the clanName) — blocking legit battles or
            // injecting fake records.
            const identity = await authedPlayerOrAdmin(req);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });

            // Admin-only kinds — wholesale state writes.
            //
            // Admin 2 (content role) is treated as `identity.admin === true`
            // by authedPlayerOrAdmin (the new isAdmin accepts either password),
            // so they pass the basic admin check. But for the kinds Admin 2
            // shouldn't touch (arenaTournament, weeklyBossOverride — neither
            // is exposed by their UI), require the full admin password.
            const adminOnlyKinds = new Set(['villageLeadershipImages', 'arenaTournament', 'arenaTournamentWinner', 'weeklyBossOverride', 'dojoCircuitEnabled']);
            const fullAdminOnlyKinds = new Set(['arenaTournament', 'arenaTournamentWinner', 'weeklyBossOverride', 'dojoCircuitEnabled']);
            if (adminOnlyKinds.has(String(kind)) && !identity.admin) {
                return res.status(403).json({ error: 'Admin only.' });
            }
            if (fullAdminOnlyKinds.has(String(kind)) && !isFullAdmin(req)) {
                return res.status(403).json({ error: 'Full admin only.' });
            }

            if (kind === 'villageState') {
                const { village, state } = body as { village?: string; state?: unknown };
                if (!village || !state || typeof state !== 'object') {
                    return res.status(400).json({ error: 'Missing village or state.' });
                }

                // Rate-limit per-caller: legitimate gameplay writes village
                // state on donate / notice / agenda / kage actions — far
                // below 30/min. Higher cadence = abuse loop.
                const rlName = identity.admin ? undefined : identity.name;
                if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-state-write', 30, 60_000, rlName))) return;

                // Actor must be a member of the village they're writing for.
                if (!identity.admin) {
                    try {
                        const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const char = (save?.character ?? null) as Record<string, unknown> | null;
                        const myVillage = (char?.village as string | undefined) ?? '';
                        if (myVillage.trim() !== village.trim()) {
                            return res.status(403).json({ error: 'Cannot write state for a village you do not belong to.' });
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify village membership.' });
                    }
                }

                const key = `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

                // Read-validate-write under a lock so concurrent kage
                // challenge / donation / notice writes can't race-overwrite
                // each other. Audit-validate per field — see
                // _village-state-validate.ts. Suppressed mutations fall
                // back to the existing value (silently — admin can find
                // them in server logs).
                //
                // failClosed: this row carries the village TREASURY, and the
                // validator pins every currency key to the value it just read.
                // Run unlocked, a stale read racing the daily Village Stores
                // pass (now a frequent concurrent writer of provisions /
                // materialPoints) would RESTORE the pre-debit balances — the
                // village would be handed back rations and materials it had
                // already spent. Refusing the write and letting the client
                // retry is the only safe outcome; the 503 below says so.
                const suppressedLog = await withKvLock(key, async () => {
                    const existing = await kv.get<Record<string, unknown>>(key);
                    const kageState = await loadAuthoritativeKage(village);
                    const { next, suppressed } = await validateVillageStateWrite(
                        existing as never,
                        state as never,
                        {
                            callerName: identity.admin ? '' : identity.name,
                            isAdmin: identity.admin,
                            village,
                        },
                        kageState,
                    );
                    await kv.set(key, next);
                    return suppressed;
                }, { failClosed: true });
                if (suppressedLog.length > 0) {
                    console.warn('[game-state villageState] suppressed:', identity.admin ? 'admin' : identity.name, suppressedLog.join('; '));
                }
                return res.status(200).json({ ok: true, suppressed: suppressedLog.length });
            }

            if (kind === 'villageLeadershipImages') {
                const { images } = body as { images?: unknown };
                if (!images) return res.status(400).json({ error: 'Missing images.' });
                await kv.set(LEADERSHIP_IMAGES_KEY, images);
                return res.status(200).json({ ok: true });
            }

            if (kind === 'dojoCircuitEnabled') {
                const { enabled } = body as { enabled?: unknown };
                if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Dojo Circuit enabled must be a boolean.' });
                await setCircuitEnabled(enabled);
                return res.status(200).json({ ok: true, enabled });
            }

            if (kind === 'arenaTournament') {
                const { tournament } = body as { tournament?: unknown };
                if (tournament != null && await kv.get<boolean>(DOJO_CIRCUIT_ENABLED_KEY) !== true) {
                    return res.status(409).json({ error: 'The Dojo Circuit is disabled.' });
                }
                if (tournament == null) {
                    await kv.del(ARENA_TOURNAMENT_KEY);
                } else {
                    await kv.set(ARENA_TOURNAMENT_KEY, tournament);
                }
                return res.status(200).json({ ok: true });
            }

            if (kind === 'arenaTournamentWinner') {
                if (await kv.get<boolean>(DOJO_CIRCUIT_ENABLED_KEY) !== true) {
                    return res.status(409).json({ error: 'The Dojo Circuit is disabled.' });
                }
                const { tournamentId, winnerName } = body as { tournamentId?: unknown; winnerName?: unknown };
                const id = String(tournamentId ?? '').trim();
                const winnerSlug = safeName(String(winnerName ?? ''));
                if (!id || !winnerSlug) return res.status(400).json({ error: 'Tournament and winner are required.' });

                const settled = await withKvLock(ARENA_TOURNAMENT_KEY, async () => {
                    const current = await kv.get<Record<string, unknown>>(ARENA_TOURNAMENT_KEY);
                    if (!current || String(current.id ?? '') !== id) {
                        return { ok: false as const, status: 409, error: 'Tournament is no longer current.' };
                    }
                    const participants = Array.isArray(current.participants)
                        ? current.participants.filter((name): name is string => typeof name === 'string') : [];
                    const advanced = Array.isArray(current.advancedPlayers)
                        ? current.advancedPlayers.filter((name): name is string => typeof name === 'string') : [];
                    const canonicalWinner = participants.find((name) => safeName(name) === winnerSlug);
                    if (!canonicalWinner) return { ok: false as const, status: 400, error: 'Winner must be a tournament participant.' };
                    if (!advanced.some((name) => safeName(name) === winnerSlug)) {
                        return { ok: false as const, status: 409, error: 'Advance the winner before finalizing the tournament.' };
                    }
                    if (current.winnerName && safeName(String(current.winnerName)) !== winnerSlug) {
                        return { ok: false as const, status: 409, error: 'Tournament already has a different winner.' };
                    }

                    const credited = await mutatePlayerSave(canonicalWinner, ({ character }) => {
                        const victory = applyTournamentVictory(character, id);
                        return {
                            ok: true as const,
                            character: victory.character,
                            write: victory.replayed ? false : undefined,
                            value: { replayed: victory.replayed },
                        };
                    });
                    if (!credited.ok) return { ok: false as const, status: credited.status, error: credited.error };

                    const tournament = {
                        ...current,
                        winnerName: canonicalWinner,
                        endedAt: Number(current.endedAt) || Date.now(),
                    };
                    await kv.set(ARENA_TOURNAMENT_KEY, tournament);
                    return {
                        ok: true as const,
                        tournament,
                        character: credited.character,
                        _saveVersion: credited._saveVersion,
                        replayed: credited.value.replayed,
                    };
                }, { failClosed: true });
                if (!settled.ok) return res.status(settled.status).json({ error: settled.error });
                return res.status(200).json(settled);
            }

            if (kind === 'arenaActiveFights') {
                const { fights } = body as { fights?: unknown[] };
                if (!Array.isArray(fights)) return res.status(400).json({ error: 'Missing fights array.' });

                function fighterNames(f: unknown): string[] {
                    if (!f || typeof f !== 'object') return [];
                    const rec = f as Record<string, unknown>;
                    const names = [rec.p1Name, rec.p2Name].filter((n): n is string => typeof n === 'string');
                    if (Array.isArray(rec.fighters)) {
                        for (const ff of rec.fighters) {
                            if (typeof ff === 'string') names.push(ff);
                            else if (ff && typeof ff === 'object' && typeof ff.name === 'string') names.push(ff.name);
                        }
                    }
                    return names;
                }
                const me = identity.admin ? '' : identity.name;
                const includesMe = (f: unknown) => fighterNames(f).some(n => safeName(n) === me);
                const updated = await withKvLock(ARENA_ACTIVE_FIGHTS_KEY, async () => {
                    const oldFights = await kv.get<unknown[]>(ARENA_ACTIVE_FIGHTS_KEY) ?? [];
                    if (!identity.admin && !fights.some(includesMe) && !oldFights.some(includesMe)) return false;
                    // Older clients send a whole cached list. Apply only this
                    // fighter's entries so their stale copy cannot erase another
                    // ranked match registered by a different player.
                    const next = identity.admin ? fights : [
                        ...oldFights.filter(f => !includesMe(f)),
                        ...fights.filter(includesMe),
                    ];
                    await kv.set(ARENA_ACTIVE_FIGHTS_KEY, next.slice(0, 20));
                    return true;
                }, { failClosed: true });
                if (!updated) return res.status(403).json({ error: 'Actor must be one of the fighters to update the arena fight list.' });
                return res.status(200).json({ ok: true });
            }

            if (kind === 'arenaActiveFight') {
                const { action, fight, fightId } = body as {
                    action?: 'register' | 'remove';
                    fight?: { id?: string; battleId?: string; title?: string; mode?: string; startedAt?: number; fighters?: string[]; biome?: string };
                    fightId?: string;
                };
                const id = action === 'register' ? fight?.id : fightId;
                const battleId = action === 'register' ? fight?.battleId : id?.startsWith('pvp-') ? id.slice(4) : '';
                if (!id || !battleId || id !== `pvp-${battleId}` || (action !== 'register' && action !== 'remove')) {
                    return res.status(400).json({ error: 'Invalid arena fight.' });
                }
                const raw = await kv.get<unknown>(`pvp:${battleId}`);
                const session = raw && typeof raw === 'object' && !Array.isArray(raw)
                    ? raw as { battleId?: string; status?: string; p1?: { name?: string }; p2?: { name?: string }; createdAt?: number; rankedCloseFence?: unknown }
                    : null;
                const sessionOwned = session?.battleId === battleId && (identity.admin
                    || [session.p1?.name, session.p2?.name].some(n => safeName(n ?? '') === identity.name));
                if (action === 'register' && !sessionOwned) {
                    return res.status(403).json({ error: 'Only a fighter can publish this battle.' });
                }
                if (action === 'register' && (session?.status !== 'active' || session.rankedCloseFence)) {
                    return res.status(409).json({ error: 'This battle has ended.' });
                }
                const entry = action === 'register' ? {
                    id, battleId,
                    title: `${session!.p1!.name} vs ${session!.p2!.name}`,
                    mode: (raw as { ranked?: boolean; playerRankedAuthorityVersion?: number }).ranked === true
                        || (raw as { playerRankedAuthorityVersion?: number }).playerRankedAuthorityVersion === 2
                        ? 'Ranked' : typeof fight?.mode === 'string' ? fight.mode.slice(0, 40) : 'PvP',
                    startedAt: Number(session!.createdAt) || Date.now(),
                    fighters: [session!.p1!.name!, session!.p2!.name!],
                    ...(typeof fight?.biome === 'string' ? { biome: fight.biome.slice(0, 40) } : {}),
                } : null;
                const updated = await withKvLock(ARENA_ACTIVE_FIGHTS_KEY, async () => {
                    const current = await kv.get<Array<{ id?: string; startedAt?: number; fighters?: string[] }>>(ARENA_ACTIVE_FIGHTS_KEY) ?? [];
                    const existing = current.find(f => f.id === id);
                    if (action === 'remove' && !existing) return true;
                    if (action === 'remove' && !sessionOwned && !identity.admin
                        && !existing?.fighters?.some(n => safeName(n) === identity.name)) return false;
                    const remaining = current.filter(f => f.id !== id && Date.now() - Number(f.startedAt) < 2 * 60 * 60 * 1000);
                    if (entry) remaining.unshift(entry);
                    await kv.set(ARENA_ACTIVE_FIGHTS_KEY, remaining.slice(0, 20));
                    return true;
                }, { failClosed: true });
                if (!updated) return res.status(403).json({ error: 'Only a fighter can remove this battle.' });
                return res.status(200).json({ ok: true });
            }

            if (kind === 'pendingClanPetBattle') {
                const { clanName, battle } = body as { clanName?: string; battle?: unknown };
                if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });

                // Membership gate: only members of the named clan (or admin)
                // can write or delete its pet-battle slot. Previously this
                // was wide open (the kind was in `openKinds`), so any
                // anonymous caller could clobber any clan's battle slot.
                if (!identity.admin) {
                    try {
                        const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const char = (save?.character ?? null) as Record<string, unknown> | null;
                        const myClan = String(char?.clan ?? '').trim();
                        if (!myClan || myClan !== clanName.trim()) {
                            return res.status(403).json({ error: 'Can only set the pet battle slot for your own clan.' });
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify clan membership.' });
                    }
                    // Rate limit so a member can't griefly thrash their own
                    // clan's battle slot either.
                    if (!(await enforceRateLimitKv(req, res, 'clan-pet-battle-write', 10, 60_000, identity.name))) return;
                }

                const key = clanPetBattleKey(clanName);
                if (battle == null) {
                    await kv.del(key);
                } else {
                    await kv.set(key, battle, { ex: 24 * 60 * 60 }); // 24-hour TTL
                }
                return res.status(200).json({ ok: true });
            }

            if (kind === 'weeklyBossOverride') {
                if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
                const { aiId } = body as { aiId?: string | null };
                if (aiId) {
                    await kv.set(WEEKLY_BOSS_OVERRIDE_KEY, aiId);
                } else {
                    await kv.del(WEEKLY_BOSS_OVERRIDE_KEY);
                }
                return res.status(200).json({ ok: true });
            }

            return res.status(400).json({ error: 'Unknown kind.' });
        } catch (err) {
            // A failClosed lock refused rather than raced (see villageState
            // above). Nothing was written — tell the client to retry instead of
            // reporting a hard failure.
            if (err instanceof LockContendedError) {
                return res.status(503).json({ error: 'That village record is busy — please retry.', retryable: true });
            }
            console.error('[game-state]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
