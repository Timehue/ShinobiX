/*
 * Client wrappers for /api/sector/chat. Auth headers are attached by the global
 * fetch interceptor (authFetch.ts), so these are plain fetches.
 *
 * A 404 means the chat is switched off (its incident valve) or the server does
 * not have it yet. Either way the answer will not change this session, so it is
 * latched and the panel stops asking, the same way lib/sector-contract treats
 * its own 404.
 */
import type { SectorChatMessage } from '../../../shared/sector-chat';

export type SectorChatRefusal = {
    ok: false;
    status: number;
    error: string;
    reason?: string;
    retryAfterMs?: number;
    guestLocked?: boolean;
    silencedUntil?: number;
};

/** `away` means the server does not place this player in the sector yet. */
export type SectorChatRead = { ok: true; messages: SectorChatMessage[]; now: number; away?: string } | SectorChatRefusal;
export type SectorChatSent = { ok: true; message: SectorChatMessage } | SectorChatRefusal;

let unavailable = false;

export function sectorChatUnavailable(): boolean {
    return unavailable;
}

/** Test seam: forget a latched 404. */
export function resetSectorChatAvailability(): void {
    unavailable = false;
}

async function refusal(response: Response): Promise<SectorChatRefusal> {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 404) unavailable = true;
    const silence = body.silence as { until?: unknown } | undefined;
    return {
        ok: false,
        status: response.status,
        error: typeof body.error === 'string' && body.error ? body.error : `HTTP ${response.status}`,
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        ...(typeof body.retryAfterMs === 'number' ? { retryAfterMs: body.retryAfterMs } : {}),
        ...(body.guestLocked === true ? { guestLocked: true } : {}),
        ...(typeof silence?.until === 'number' ? { silencedUntil: silence.until } : {}),
    };
}

const offline = (error: unknown): SectorChatRefusal => ({
    ok: false, status: 0, error: error instanceof Error && error.message ? error.message : 'Network error.',
});

export async function fetchSectorChat(sector: number, since: number, signal?: AbortSignal): Promise<SectorChatRead> {
    try {
        const response = await fetch(`/api/sector/chat?sector=${encodeURIComponent(sector)}&since=${Math.max(0, Math.floor(since))}`, { signal });
        if (!response.ok) return refusal(response);
        const body = await response.json().catch(() => ({})) as { messages?: unknown; now?: unknown; away?: unknown };
        return {
            ok: true,
            messages: Array.isArray(body.messages) ? body.messages as SectorChatMessage[] : [],
            now: typeof body.now === 'number' ? body.now : Date.now(),
            ...(typeof body.away === 'string' && body.away ? { away: body.away } : {}),
        };
    } catch (error) {
        return offline(error);
    }
}

export async function sendSectorChat(sector: number, text: string): Promise<SectorChatSent> {
    try {
        const response = await fetch('/api/sector/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sector, text }),
        });
        if (!response.ok) return refusal(response);
        const body = await response.json().catch(() => ({})) as { message?: SectorChatMessage };
        if (!body.message || typeof body.message.id !== 'string') return { ok: false, status: response.status, error: 'The sector did not answer.' };
        return { ok: true, message: body.message };
    } catch (error) {
        return offline(error);
    }
}
