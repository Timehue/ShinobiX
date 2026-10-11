import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { WORLD_BOSS_DEFINITIONS, WORLD_BOSS_EVENT_DURATION_MS, WORLD_BOSS_EVENT_ROAM_MS, worldBossDefinition, worldBossEventPosition, worldBossEventStatus, worldBossRoute } from '../../shared/world-boss-event.js';
import { isPlayableWildSector, VILLAGE_OUTSKIRTS } from '../../shared/sector-geo.js';
import {
    WORLD_BOSS_ACTIVE_KEY,
    WORLD_BOSS_EVENT_TTL_SECONDS,
    emptyWorldBossQueue,
    readActiveWorldBossEvent,
    readWorldBossEvent,
    worldBossEventIsOpen,
    worldBossEventKey,
    writeWorldBossEvent,
    writeWorldBossQueue,
    type WorldBossEventRecord,
} from '../world-boss-event/_event.js';
import { closeWorldBossQueue } from '../world-boss-event/_queue.js';
import { applyWorldBossRetreatPenalty } from '../world-boss-event/_retreat.js';
import { announceWorldBossEventTransition } from '../world-boss-event/_announcements.js';
import { rememberWorldBossTopCacheEvent, settlePendingWorldBossTopCaches, settleWorldBossTopCaches, worldBossTopCacheEventComplete } from '../world-boss-event/_top-cache.js';

function requestedHp(value: unknown): number {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(100_000, Math.min(3_000_000, parsed)) : 600_000;
}

function adminEventSnapshot(event: WorldBossEventRecord | null, now: number) {
    if (!event) return { event: null, active: false };
    const boss = worldBossDefinition(event.bossId);
    const status = worldBossEventStatus(event, now);
    const position = worldBossEventPosition(event, now);
    return {
        event: {
            ...event,
            currentSector: position?.currentSector ?? null,
            targetSector: position?.targetSector ?? null,
            destinationReached: position?.destinationReached === true,
            bossId: boss.id,
            bossName: !event.bossName || event.bossName === 'The Hollow Beast' ? boss.name : event.bossName,
            status,
        },
        active: worldBossEventIsOpen({ ...event, status }, now),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-world-boss-event', req.method === 'GET' ? 30 : 8, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
        if (req.method === 'GET') {
            let event = await readActiveWorldBossEvent();
            if (event?.status === 'victory' && !worldBossTopCacheEventComplete(event)) {
                await rememberWorldBossTopCacheEvent(event.eventId);
                await settleWorldBossTopCaches(event.eventId);
            }
            await settlePendingWorldBossTopCaches();
            event = await readActiveWorldBossEvent();
            if (event) await announceWorldBossEventTransition(event, worldBossEventStatus(event, Date.now()));
            return res.status(200).json(adminEventSnapshot(event, Date.now()));
        }
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body.action ?? '');
        if (action === 'start') {
            const boss = WORLD_BOSS_DEFINITIONS.find(entry => entry.id === String(body.bossId ?? 'hollow-beast'));
            if (!boss) return res.status(400).json({ error: 'Choose a supported world boss.' });
            const spawnSector = Number(body.spawnSector);
            if (!Number.isInteger(spawnSector) || !isPlayableWildSector(spawnSector)) {
                return res.status(400).json({ error: 'Choose a playable wilderness sector for the boss spawn.' });
            }
            const targetVillage = String(body.targetVillage ?? '');
            if (!Object.hasOwn(VILLAGE_OUTSKIRTS, targetVillage) || !worldBossRoute(spawnSector, targetVillage)) {
                return res.status(400).json({ error: 'Choose a village reachable from the selected spawn sector.' });
            }
            const now = Date.now();
            const started = await withKvLock(WORLD_BOSS_ACTIVE_KEY, async () => {
                const current = await readActiveWorldBossEvent();
                if (current && worldBossEventIsOpen({ ...current, status: worldBossEventStatus(current, now) }, now)) {
                    return { ok: false as const, error: 'A world boss event is already active.' };
                }
                let retreatedAnnouncement: WorldBossEventRecord | null = null;
                if (current && worldBossEventStatus(current, now) === 'retreated' && current.hp > 0) {
                    retreatedAnnouncement = await withKvLock(worldBossEventKey(current.eventId), async () => {
                        const expired = await readWorldBossEvent(current.eventId);
                        if (!expired || expired.hp <= 0 || expired.status === 'victory' || expired.status === 'stopped') return null;
                        expired.status = 'retreated';
                        expired.endedAt = expired.endedAt ?? expired.endsAt;
                        await applyWorldBossRetreatPenalty(expired, now);
                        expired.updatedAt = now;
                        await writeWorldBossEvent(expired);
                        return expired;
                    }, { failClosed: true });
                    await closeWorldBossQueue(current.eventId, now);
                }
                if (current?.status === 'victory' && !worldBossTopCacheEventComplete(current)) {
                    await rememberWorldBossTopCacheEvent(current.eventId);
                }
                const eventId = `muster-${randomUUID().replace(/-/g, '')}`;
                const hpMax = requestedHp(body.hpMax);
                const event: WorldBossEventRecord = {
                    version: 1,
                    eventId,
                    bossId: boss.id,
                    bossName: boss.name,
                    status: 'roaming',
                    startedAt: now,
                    roamEndsAt: now + WORLD_BOSS_EVENT_ROAM_MS,
                    endsAt: now + WORLD_BOSS_EVENT_DURATION_MS,
                    spawnSector,
                    targetVillage,
                    endedAt: null,
                    hpMax,
                    hp: hpMax,
                    participants: {},
                    settledMatchIds: [],
                    movementPausedAt: null,
                    movementPausedTotalMs: 0,
                    minedCrystalNodeIds: [],
                    hollowShardsHeldByPlayer: {},
                    hollowShardsDeposited: 0,
                    crystalDepositReceipts: {},
                    updatedAt: now,
                };
                await writeWorldBossEvent(event);
                if ((await kv.set(WORLD_BOSS_ACTIVE_KEY, eventId, { ex: WORLD_BOSS_EVENT_TTL_SECONDS })) === null) {
                    throw new Error('World boss active pointer write rejected.');
                }
                await writeWorldBossQueue(eventId, emptyWorldBossQueue(now));
                return { ok: true as const, event, retreatedAnnouncement };
            }, { failClosed: true });
            if (!started.ok) return res.status(409).json({ error: started.error });
            if (started.retreatedAnnouncement) await announceWorldBossEventTransition(started.retreatedAnnouncement, 'retreated');
            await announceWorldBossEventTransition(started.event, 'roaming');
            return res.status(200).json({ ok: true, ...adminEventSnapshot(started.event, now) });
        }
        if (action === 'stop') {
            const event = await readActiveWorldBossEvent();
            const expectedEventId = String(body.eventId ?? '');
            if (expectedEventId && event?.eventId !== expectedEventId) {
                return res.status(409).json({ error: 'The active world boss changed. Refresh the panel before stopping it.' });
            }
            if (!event || !worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, Date.now()) }, Date.now())) {
                return res.status(200).json({ ok: true, stopped: false, ...adminEventSnapshot(event, Date.now()) });
            }
            const now = Date.now();
            const stopped = await withKvLock(worldBossEventKey(event.eventId), async () => {
                const fresh = await readActiveWorldBossEvent();
                if (!fresh || fresh.eventId !== event.eventId || (expectedEventId && fresh.eventId !== expectedEventId) || !worldBossEventIsOpen(fresh, now)) return false;
                fresh.status = 'stopped';
                fresh.endedAt = now;
                fresh.updatedAt = now;
                await writeWorldBossEvent(fresh);
                return true;
            }, { failClosed: true });
            if (stopped) await closeWorldBossQueue(event.eventId, now);
            return res.status(200).json({ ok: true, stopped, ...adminEventSnapshot(await readActiveWorldBossEvent(), Date.now()) });
        }
        return res.status(400).json({ error: "action must be 'start' or 'stop'." });
    } catch (error) {
        console.error('[admin/world-boss-event]', error);
        return res.status(503).json({ error: 'World boss event controls are temporarily unavailable.' });
    }
}
