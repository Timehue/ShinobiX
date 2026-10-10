import type { VercelRequest, VercelResponse } from './_vercel.js';
import { authedPlayerOrAdmin } from './_auth.js';
import { cors, parseJsonBody, safeName } from './_utils.js';
import { enforceRateLimit } from './_ratelimit.js';
import { readActiveWorldBossEvent, readWorldBossEvent, publicWorldBossEvent, worldBossEventKey } from './world-boss-event/_event.js';
import { worldBossEventPosition, worldBossEventStatus } from '../shared/world-boss-event.js';
import { closeWorldBossQueue, tickWorldBossQueue, worldBossQueueView } from './world-boss-event/_queue.js';
import { withKvLock } from './_lock.js';
import { writeWorldBossEvent } from './world-boss-event/_event.js';
import { applyWorldBossRetreatPenalty } from './world-boss-event/_retreat.js';
import { WORLD_BOSS_CRYSTAL_NODES } from '../shared/resource-nodes.js';
import { depositWorldBossHollowShards } from './world-boss-event/_crystals.js';
import { rememberWorldBossTopCacheEvent, settlePendingWorldBossTopCaches, settleWorldBossTopCaches, worldBossTopCacheEventComplete } from './world-boss-event/_top-cache.js';
import { kv } from './_storage.js';
import { announceWorldBossEventTransition } from './world-boss-event/_announcements.js';

function participantPoints(player: { damage?: number; score?: number; crystalPoints?: number }): number {
    return Math.max(0, Math.floor(Number(player.damage) || 0))
        + Math.max(0, Math.floor(Number(player.score) || 0))
        + Math.max(0, Math.floor(Number(player.crystalPoints) || 0));
}

function standings(event: NonNullable<Awaited<ReturnType<typeof readActiveWorldBossEvent>>>) {
    const players = Object.values(event.participants ?? {}).sort((a, b) => participantPoints(b) - participantPoints(a) || a.slug.localeCompare(b.slug));
    const villageTotals = new Map<string, { points: number; damage: number; crystalPoints: number; supportPoints: number }>();
    const clanTotals = new Map<string, { points: number; damage: number; crystalPoints: number; supportPoints: number }>();
    for (const player of players) {
        const total = participantPoints(player);
        if (player.village) {
            const prior = villageTotals.get(player.village) ?? { points: 0, damage: 0, crystalPoints: 0, supportPoints: 0 };
            villageTotals.set(player.village, {
                points: prior.points + total,
                damage: prior.damage + player.damage,
                crystalPoints: prior.crystalPoints + (player.crystalPoints ?? 0),
                supportPoints: prior.supportPoints + player.score,
            });
        }
        if (player.clan) {
            const prior = clanTotals.get(player.clan) ?? { points: 0, damage: 0, crystalPoints: 0, supportPoints: 0 };
            clanTotals.set(player.clan, {
                points: prior.points + total,
                damage: prior.damage + player.damage,
                crystalPoints: prior.crystalPoints + (player.crystalPoints ?? 0),
                supportPoints: prior.supportPoints + player.score,
            });
        }
    }
    return {
        individual: players.slice(0, 20).map((player, index) => ({
            rank: index + 1,
            name: player.name,
            damage: player.damage,
            crystalPoints: player.crystalPoints ?? 0,
            hollowShardsDeposited: player.hollowShardsDeposited ?? 0,
            supportPoints: player.score ?? 0,
            points: participantPoints(player),
        })),
        villages: [...villageTotals.entries()].sort((a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0]))
            .slice(0, 4).map(([name, totals], index) => ({ rank: index + 1, name, ...totals })),
        clans: [...clanTotals.entries()].sort((a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0]))
            .slice(0, 10).map(([name, totals], index) => ({ rank: index + 1, name, ...totals })),
    };
}

function personalRank(event: NonNullable<Awaited<ReturnType<typeof readActiveWorldBossEvent>>>, playerSlug: string): number | null {
    const index = Object.values(event.participants ?? {})
        .sort((a, b) => participantPoints(b) - participantPoints(a) || a.slug.localeCompare(b.slug))
        .findIndex(player => player.slug === playerSlug);
    return index < 0 ? null : index + 1;
}

async function depositHollowShards(req: VercelRequest, res: VercelResponse) {
    const parsed = parseJsonBody(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) return res.status(400).json({ error: 'Expected a Hollow Shard turn-in.' });
    const body = parsed.body as Record<string, unknown>;
    const playerName = safeName(String(body.playerName ?? ''));
    const eventId = String(body.eventId ?? '').slice(0, 100);
    const requestId = String(body.requestId ?? '');
    if (String(body.action ?? '') !== 'depositHollowShards') return res.status(400).json({ error: 'Unknown world boss action.' });
    if (!playerName || !eventId || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
        return res.status(400).json({ error: 'A player, event, and valid turn-in ID are required.' });
    }
    if (!enforceRateLimit(req, res, 'world-boss-event-deposit-preauth', 30, 60_000)) return;
    const identity = await authedPlayerOrAdmin(req, playerName);
    if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
    if (identity.name !== playerName) return res.status(403).json({ error: 'Can only turn in your own Hollow Shards.' });
    if (!enforceRateLimit(req, res, 'world-boss-event-deposit', 10, 60_000, identity.name)) return;
    const result = await depositWorldBossHollowShards(eventId, {
        slug: identity.name,
        name: identity.name,
        village: '',
        clan: '',
    }, requestId);
    if (!result.ok) return res.status(409).json({ error: result.error });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...result, serverNow: Date.now() });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method === 'POST') return depositHollowShards(req, res);
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        let playerSlug = '';
        if (playerName) {
            if (!enforceRateLimit(req, res, 'world-boss-event-view-preauth', 240, 60_000)) return;
            const identity = await authedPlayerOrAdmin(req, playerName);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only read your own event status.' });
            playerSlug = identity.admin ? playerName : identity.name;
            if (!enforceRateLimit(req, res, 'world-boss-event-view', 240, 60_000, playerSlug)) return;
        }

        let event = await readActiveWorldBossEvent();
        if (!event) return res.status(200).json({ ok: true, event: null, serverNow: Date.now() });
        const now = Date.now();
        if (playerSlug && event.status === 'victory' && !worldBossTopCacheEventComplete(event)) {
            await rememberWorldBossTopCacheEvent(event.eventId);
            await settleWorldBossTopCaches(event.eventId, now);
            event = (await readWorldBossEvent(event.eventId)) ?? event;
        }
        const pendingCacheDeliveries = playerSlug ? await settlePendingWorldBossTopCaches(now) : [];
        let status = worldBossEventStatus(event, now);
        if (status === 'retreated') {
            await withKvLock(worldBossEventKey(event.eventId), async () => {
                const fresh = await readWorldBossEvent(event!.eventId);
                if (!fresh || fresh.status === 'victory' || fresh.status === 'stopped') return;
                fresh.status = 'retreated';
                fresh.endedAt = fresh.endedAt ?? fresh.endsAt;
                await applyWorldBossRetreatPenalty(fresh, now);
                fresh.updatedAt = now;
                await writeWorldBossEvent(fresh);
                event = fresh;
            }, { failClosed: true });
            await closeWorldBossQueue(event.eventId, now);
            status = worldBossEventStatus(event, now);
        }

        const queue = playerSlug
            ? await worldBossQueueView(event, playerSlug, now)
            : { waitingCount: (await tickWorldBossQueue(event.eventId, now)).tickets.length };
        event = (await readWorldBossEvent(event.eventId)) ?? event;
        status = worldBossEventStatus(event, now);
        await announceWorldBossEventTransition(event, status);
        const position = worldBossEventPosition(event, now);
        const result: Record<string, unknown> = {
            ok: true,
            event: { ...publicWorldBossEvent(event, status, position), crystalNodeCount: WORLD_BOSS_CRYSTAL_NODES.length },
            queue,
            serverNow: now,
        };
        if (playerSlug) {
            const participant = event.participants[playerSlug];
            const heldHollowShards = Math.max(0, Math.floor(Number(event.hollowShardsHeldByPlayer?.[playerSlug]) || 0));
            result.personal = participant || heldHollowShards > 0 ? {
                damage: participant?.damage ?? 0,
                score: participant?.score ?? 0,
                actions: participant?.actions ?? 0,
                matches: participant?.matches ?? 0,
                hollowShardsHeld: heldHollowShards,
                hollowShardsDeposited: participant?.hollowShardsDeposited ?? 0,
                crystalPoints: participant?.crystalPoints ?? 0,
                points: participant ? participantPoints(participant) : 0,
            } : null;
            const cacheRecipient = event.topCacheRecipients?.find(entry => entry.slug === playerSlug);
            if (cacheRecipient) {
                const existingPersonal = result.personal as Record<string, unknown> | null | undefined;
                result.personal = {
                    ...(existingPersonal ?? {}),
                    hollowBeastCacheRank: cacheRecipient.rank,
                    hollowBeastCacheAwarded: event.topCacheClaims?.[playerSlug]?.rank === cacheRecipient.rank,
                };
                if (event.topCacheClaims?.[playerSlug]?.rank === cacheRecipient.rank) {
                    const save = await kv.get<Record<string, unknown>>(`save:${playerSlug}`);
                    if (save?.character && Number.isFinite(Number(save._saveVersion))) {
                        result.character = save.character;
                        result._saveVersion = Number(save._saveVersion);
                    }
                }
            }
            result.standings = standings(event);
            result.personalRank = personalRank(event, playerSlug);
            const pendingCache = pendingCacheDeliveries.find(entry => entry.slug === playerSlug);
            if (pendingCache) {
                result.character = pendingCache.character;
                result._saveVersion = pendingCache.saveVersion;
            }
        } else if (status === 'victory' || status === 'retreated' || status === 'stopped') {
            result.standings = standings(event);
        }
        res.setHeader('Cache-Control', playerSlug ? 'no-store' : 'public, max-age=5, s-maxage=5');
        return res.status(200).json(result);
    } catch (error) {
        console.error('[world-boss-event]', error);
        return res.status(503).json({ error: 'World event status is temporarily unavailable.' });
    }
}
