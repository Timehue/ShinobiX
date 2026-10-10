import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { onlineStore } from '../_realtime/online-store.js';
import { withKvLock } from '../_lock.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { findTowerBattleStartConflict } from '../_tower-battle-guard.js';
import { loadPvpPendingSessionPointer } from '../pvp/_pending-session.js';
import { WORLD_BOSS_EVENT_MAX_PARTY, worldBossEventPosition, worldBossEventStatus } from '../../shared/world-boss-event.js';
import {
    readActiveWorldBossEvent,
    readWorldBossEvent,
    readWorldBossMatch,
    readWorldBossPlayerPointer,
    readWorldBossQueueCooldownUntil,
    readWorldBossQueue,
    worldBossEventIsOpen,
    worldBossEventKey,
    worldBossQueueKey,
    worldBossQueueCooldownKey,
    writeWorldBossQueue,
    writeWorldBossEvent,
    writeWorldBossPlayerPointer,
    type WorldBossQueueTicket,
} from './_event.js';
import { leaveWorldBossQueue, tickWorldBossQueue, worldBossQueueView } from './_queue.js';

function safeLoadout(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const allowed = ['pvpItems', 'bloodlineMult', 'armorFactor', 'armorRawDR', 'itemDamagePct', 'itemAbsorbPct', 'itemReflectPct', 'itemLifeStealPct', 'itemShield'];
    const loadout: Record<string, unknown> = {};
    for (const key of allowed) if (source[key] !== undefined) loadout[key] = source[key];
    return loadout;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const action = String(body.action ?? '');
        if (!playerName || (action !== 'join' && action !== 'leave')) return res.status(400).json({ error: 'Invalid player or queue action.' });
        if (!enforceRateLimit(req, res, 'world-boss-event-queue-preauth', 80, 60_000)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only change your own queue ticket.' });
        const playerSlug = identity.admin ? playerName : identity.name;
        if (!enforceRateLimit(req, res, 'world-boss-event-queue', 20, 60_000, playerSlug)) return;

        const event = await readActiveWorldBossEvent();
        if (!event) return res.status(404).json({ error: 'No world boss event is active.' });
        const now = Date.now();
        const status = worldBossEventStatus(event, now);
        if (action === 'leave') {
            const left = await leaveWorldBossQueue(event.eventId, playerSlug, now);
            if (left.activeMatch) return res.status(409).json({ error: 'Your team has formed. Finish or resume the encounter instead.' });
            if (!left.removed) {
                const pointer = await readWorldBossPlayerPointer(event.eventId, playerSlug);
                if (pointer?.status === 'preparing' || pointer?.status === 'active') {
                    return res.status(409).json({ error: 'Your team has formed. Finish or resume the encounter instead.' });
                }
            }
            return res.status(200).json({ ok: true, queue: await worldBossQueueView(event, playerSlug, now), serverNow: now });
        }
        if (!worldBossEventIsOpen({ ...event, status }, now)) {
            return res.status(409).json({ error: 'This event is no longer accepting teams.' });
        }

        const save = await kv.get<Record<string, unknown>>(`save:${playerSlug}`);
        const character = save?.character as Record<string, unknown> | undefined;
        if (!save || !character) return res.status(404).json({ error: 'Your character save was not found.' });
        const presence = onlineStore.get(playerSlug);
        if (presence?.pendingAttacker) return res.status(409).json({ error: 'Resolve your current PvP engagement before joining the world boss queue.' });
        if (presence?.inBattle) return res.status(409).json({ error: 'Finish your current battle before joining the world boss queue.' });
        const position = worldBossEventPosition(event, now);
        if (!position?.active) return res.status(409).json({ error: 'The boss is not accepting encounters right now.' });
        if (Math.floor(Number(save.currentSector)) !== position.currentSector) {
            return res.status(409).json({ error: `Travel to Sector ${position.currentSector} to join the team queue.` });
        }
        if (!identity.admin && isIncapacitated(character)) return res.status(409).json({ error: 'Recover before joining the world boss team.' });
        if (await findTowerBattleStartConflict([playerSlug])) return res.status(409).json({ error: 'Finish your current battle before joining the queue.' });

        const pointer = await readWorldBossPlayerPointer(event.eventId, playerSlug);
        if (pointer?.status === 'preparing' || pointer?.status === 'active') {
            const pointedMatch = pointer.matchId ? await readWorldBossMatch(event.eventId, pointer.matchId) : null;
            if (pointedMatch?.status === 'preparing' || pointedMatch?.status === 'active') {
                return res.status(409).json({ error: 'Your current world boss team is still active.' });
            }
            await writeWorldBossPlayerPointer(event.eventId, playerSlug, {
                ...(pointer.matchId ? { matchId: pointer.matchId } : {}),
                status: pointedMatch?.status === 'cancelled' ? 'cancelled' : 'settled',
                updatedAt: now,
                ...(pointedMatch?.error ? { error: pointedMatch.error } : {}),
            });
        }
        const ticketId = `wbt_${playerSlug}_${now.toString(36)}`;
        const hostLoadout = safeLoadout(body.hostLoadout);
        const ticket: WorldBossQueueTicket = {
            ticketId,
            slug: playerSlug,
            name: String(character.name ?? playerSlug).slice(0, 40),
            joinedAt: now,
            village: String(character.village ?? '').slice(0, 40),
            clan: String(character.clan ?? '').slice(0, 60),
            ...(hostLoadout ? { loadout: hostLoadout } : {}),
        };
        const queueKey = worldBossQueueKey(event.eventId);
        const accepted = await withKvLock(worldBossEventKey(event.eventId), async () => {
            const fresh = await readWorldBossEvent(event.eventId);
            if (!fresh || !worldBossEventIsOpen({ ...fresh, status: worldBossEventStatus(fresh, now) }, now)) {
                return { ok: false as const, status: 409, reason: 'This event is no longer accepting teams.' };
            }
            const freshPosition = worldBossEventPosition(fresh, now);
            if (!freshPosition?.active) return { ok: false as const, status: 409, reason: 'The boss is not accepting encounters right now.' };
            if (Math.floor(Number(save.currentSector)) !== freshPosition.currentSector) {
                return { ok: false as const, status: 409, reason: `The boss moved. Travel to Sector ${freshPosition.currentSector} to join the team queue.` };
            }
            const freshPresence = onlineStore.get(playerSlug);
            if (freshPresence?.pendingAttacker) return { ok: false as const, status: 409, reason: 'Resolve your current PvP engagement before joining the world boss queue.' };
            if (freshPresence?.inBattle) return { ok: false as const, status: 409, reason: 'Finish your current battle before joining the world boss queue.' };
            const pvpPointer = await loadPvpPendingSessionPointer(kv, playerSlug);
            if (pvpPointer?.phase === 'reserving' && (pvpPointer.reservedUntil ?? 0) > now) {
                return { ok: false as const, status: 409, reason: 'Finish starting your PvP battle before joining the world boss queue.' };
            }
            if (pvpPointer?.phase === 'active') {
                const pvpSession = await kv.get<{ status?: unknown }>(`pvp:${pvpPointer.battleId}`);
                if (pvpSession?.status === 'active') return { ok: false as const, status: 409, reason: 'Finish your current PvP battle before joining the world boss queue.' };
            }
            const result = await withKvLock(worldBossQueueCooldownKey(playerSlug), async () => {
                const cooldownUntil = await readWorldBossQueueCooldownUntil(playerSlug);
                if (cooldownUntil != null && cooldownUntil > now) {
                    const seconds = Math.ceil((cooldownUntil - now) / 1_000);
                    return {
                        ok: false as const,
                        status: 429,
                        reason: `You recently left the world boss queue. You can rejoin in ${seconds} seconds.`,
                        rejoinAfter: cooldownUntil,
                    };
                }
                return withKvLock(queueKey, async () => {
                    const queue = await readWorldBossQueue(event.eventId);
                    const existing = queue.tickets.find(entry => entry.slug === playerSlug);
                    if (existing) {
                        await writeWorldBossPlayerPointer(event.eventId, playerSlug, {
                            ticketId: existing.ticketId,
                            status: 'queued',
                            updatedAt: now,
                        });
                        return { ok: true as const, waiting: queue.tickets.length };
                    }
                    if (queue.tickets.length >= 300) return { ok: false as const, status: 503, reason: 'The queue is busy. Try again in a moment.' };
                    queue.tickets.push(ticket);
                    queue.updatedAt = now;
                    await writeWorldBossQueue(event.eventId, queue);
                    await writeWorldBossPlayerPointer(event.eventId, playerSlug, {
                        ticketId,
                        status: 'queued',
                        updatedAt: now,
                    });
                    return { ok: true as const, waiting: queue.tickets.length };
                }, { failClosed: true });
            }, { failClosed: true });
            if (result.ok && result.waiting > 0 && fresh.movementPausedAt == null && now < fresh.roamEndsAt) {
                fresh.movementPausedAt = now;
                fresh.updatedAt = now;
                await writeWorldBossEvent(fresh);
            }
            return result;
        }, { failClosed: true });
        if (!accepted.ok) return res.status(accepted.status).json({ error: accepted.reason, ...('rejoinAfter' in accepted ? { rejoinAfter: accepted.rejoinAfter } : {}), serverNow: now });

        const queue = await tickWorldBossQueue(event.eventId, now);
        return res.status(200).json({
            ok: true,
            queue: await worldBossQueueView(event, playerSlug, now),
            waitingCount: queue.tickets.length,
            serverNow: now,
            partySizeLimit: WORLD_BOSS_EVENT_MAX_PARTY,
        });
    } catch (error) {
        console.error('[world-boss-event/queue]', error);
        return res.status(503).json({ error: 'The world boss queue is temporarily unavailable.' });
    }
}
