/**
 * Chat rooms on the shared socket: the village tavern and clan chat.
 *
 * A reader with one of those chats open asks to join its room; the server
 * checks the same membership the chat's GET checks, then joins. Writers
 * (api/village/chat.ts, api/clan/chat/send.ts, the World Herald and the
 * moderation delete) emit a contentless hint to the room through notify.ts,
 * and each reader refetches over HTTP. The HTTP endpoints stay the only
 * source of truth, so moderation, rate limits, block lists and the guest lock
 * are untouched: a hint that reaches the wrong socket reveals only that
 * something was said, never what.
 *
 * Membership is checked at join time only. A player who leaves a village or
 * clan keeps hearing hints until they close the chat or reconnect; their next
 * refetch is refused by the GET as before.
 */
import type { Socket } from 'socket.io';
import {
    CHAT_SUBSCRIBE_EVENT,
    CHAT_UNSUBSCRIBE_EVENT,
    chatPushRoom,
    parseChatPushRequest,
    type ChatSubscribeResult,
} from '../../shared/chat-push.js';
import { villageChatWatchable } from '../village/chat.js';
import { isClanChatMember } from '../clan/chat/_access.js';

/**
 * Each subscribe costs a save read. A real client sends one per open chat on
 * mount and one per open chat on each reconnect; this window leaves plenty of
 * room for that while refusing a loop that would turn reads into a DOS.
 */
const SUBSCRIBE_WINDOW_MS = 10_000;
const SUBSCRIBES_PER_WINDOW = 8;

export function wireChatRooms(socket: Socket): void {
    const name: string = socket.data.name;
    let windowStart = 0;
    let windowCount = 0;
    // The membership read is async, so an unsubscribe can land while a
    // subscribe is still checking. Only rooms with a check in flight are
    // tracked (so the map is bounded by the subscribe throttle, not by how many
    // names a client sends to unsubscribe); an unsubscribe bumps the room's
    // generation, and a check that sees it move does not join.
    const checking = new Map<string, { inFlight: number; generation: number }>();

    socket.on(CHAT_SUBSCRIBE_EVENT, async (payload: unknown, acknowledge?: (result: ChatSubscribeResult) => void) => {
        const reply = (result: ChatSubscribeResult) => { if (typeof acknowledge === 'function') acknowledge(result); };
        const now = Date.now();
        if (now - windowStart >= SUBSCRIBE_WINDOW_MS) { windowStart = now; windowCount = 0; }
        if (++windowCount > SUBSCRIBES_PER_WINDOW) return reply({ ok: false, reason: 'throttled' });

        const request = parseChatPushRequest(payload);
        if (!request) return reply({ ok: false, reason: 'invalid' });
        const room = chatPushRoom(request.channel, request.slug);
        let check = checking.get(room);
        if (!check) checking.set(room, check = { inFlight: 0, generation: 0 });
        check.inFlight++;
        const generation = check.generation;

        let allowed: boolean;
        try {
            allowed = request.channel === 'village'
                ? await villageChatWatchable(name, request.name)
                : await isClanChatMember(name, request.slug);
        } catch {
            // A storage blip is not a refusal: the client retries later, and
            // its reconcile poll keeps the chat current meanwhile.
            return reply({ ok: false, reason: 'unavailable' });
        } finally {
            if (--check.inFlight === 0) checking.delete(room);
        }
        if (!allowed) return reply({ ok: false, reason: 'forbidden' });
        // Withdrawn mid-check: the client has stopped watching, so don't join.
        if (check.generation !== generation) return reply({ ok: false, reason: 'unavailable' });
        if (!socket.connected) return;
        socket.join(room);
        reply({ ok: true });
    });

    socket.on(CHAT_UNSUBSCRIBE_EVENT, (payload: unknown) => {
        const request = parseChatPushRequest(payload);
        if (!request) return;
        const room = chatPushRoom(request.channel, request.slug);
        const check = checking.get(room);
        if (check) check.generation++;
        socket.leave(room);
    });
}
