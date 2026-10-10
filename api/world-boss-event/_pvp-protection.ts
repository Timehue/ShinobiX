import { worldBossEventStatus } from '../../shared/world-boss-event.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import {
    readActiveWorldBossEvent,
    worldBossEventIsOpen,
    readWorldBossMatch,
    readWorldBossPlayerPointer,
    readWorldBossQueue,
    worldBossEventKey,
} from './_event.js';

export type WorldBossPvpBlock = { status: 409; error: string };

/** Server-authoritative PvP immunity while a player waits for or enters a boss team. */
export async function worldBossPvpProtectionBlock(playerName: string, now = Date.now()): Promise<WorldBossPvpBlock | null> {
    const playerSlug = safeName(playerName);
    if (!playerSlug) return null;

    const event = await readActiveWorldBossEvent();
    if (!event) return null;

    const queue = await readWorldBossQueue(event.eventId);
    const eventOpen = worldBossEventIsOpen({ ...event, status: worldBossEventStatus(event, now) }, now);
    if (eventOpen && queue.tickets.some(ticket => ticket.slug === playerSlug)) {
        return { status: 409, error: 'Players waiting for a world boss team are protected from PvP.' };
    }

    const pointer = await readWorldBossPlayerPointer(event.eventId, playerSlug);
    if (pointer?.matchId && (pointer.status === 'preparing' || pointer.status === 'active')) {
        const match = await readWorldBossMatch(event.eventId, pointer.matchId);
        if (match?.status === 'preparing' || match?.status === 'active') {
            return { status: 409, error: 'Players entering or fighting a world boss are protected from PvP.' };
        }
    }

    return null;
}

/** Serialize a PvP admission against queue joins on the same active event. */
export async function withWorldBossPvpLock<T>(
    playerNames: readonly string[],
    action: () => Promise<T> | T,
): Promise<{ ok: true; value: T } | { ok: false; block: WorldBossPvpBlock }> {
    const names = [...new Set(playerNames.map(safeName).filter(Boolean))];
    const event = await readActiveWorldBossEvent();
    if (!event) return { ok: true, value: await action() };

    return withKvLock(worldBossEventKey(event.eventId), async () => {
        const current = await readActiveWorldBossEvent();
        if (current && current.eventId !== event.eventId) {
            return { ok: false as const, block: { status: 409 as const, error: 'The world event changed. Refresh and retry PvP.' } };
        }
        for (const name of names) {
            const block = await worldBossPvpProtectionBlock(name);
            if (block) return { ok: false as const, block };
        }
        return { ok: true as const, value: await action() };
    }, { failClosed: true });
}
