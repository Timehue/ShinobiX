import { useEffect } from 'react';
import type { ChatPushChannel } from '../../../shared/chat-push';
import { createChatPushHub } from './chat-push';
import { emitRealtime, isRealtimeConnected, onChatPush, onStatus, requestRealtime } from './presence-socket';
import { visiblePoll } from './poll';

/**
 * The tavern and clan chat poll every two minutes, socket or not. With the
 * socket up each new line arrives as a push hint and this poll only
 * reconciles (a hint lost to a refused or failed join). Without it, this poll
 * is the delivery.
 */
export const CHAT_POLL_MS = 120_000;

/**
 * A hint is followed by a refetch after a short random wait. A burst of lines
 * then costs each reader one GET, and a busy tavern's readers don't all land
 * on the server in the same millisecond.
 */
const PUSH_REFETCH_MIN_MS = 150;
const PUSH_REFETCH_SPREAD_MS = 650;

export const watchChatPush = createChatPushHub({
    isConnected: isRealtimeConnected,
    request: requestRealtime,
    emit: emitRealtime,
    onPush: onChatPush,
    onStatus,
});

/**
 * Keep one chat fresh while `enabled`: fetch now, on every push hint, after
 * every reconnect, and on the two-minute reconcile poll. Paused with the
 * browser tab (a hidden tab ignores hints and refetches on return, through
 * visiblePoll). Overlapping triggers collapse into at most one queued rerun.
 *
 * `refresh` receives `isActive`; check it before applying a response, since a
 * request can outlive the chat it was made for.
 */
export function useChatPushRefresh(
    channel: ChatPushChannel,
    name: string,
    enabled: boolean,
    refresh: (isActive: () => boolean) => Promise<void>,
): void {
    useEffect(() => {
        if (!enabled) return undefined;
        let active = true;
        const isActive = () => active;
        let running: Promise<void> | null = null;
        let again = false;
        const run = (): Promise<void> => {
            if (running) { again = true; return running; }
            running = (async () => {
                do {
                    again = false;
                    await refresh(isActive);
                } while (again && active);
            })().finally(() => { running = null; });
            return running;
        };

        let pushTimer: ReturnType<typeof setTimeout> | null = null;
        const stopPush = watchChatPush(channel, name, () => {
            if (!active || pushTimer || document.hidden) return;
            pushTimer = setTimeout(() => {
                pushTimer = null;
                if (active) void run();
            }, PUSH_REFETCH_MIN_MS + Math.random() * PUSH_REFETCH_SPREAD_MS);
        });
        const stopPoll = visiblePoll(run, CHAT_POLL_MS, 0.1, { immediate: true });

        return () => {
            active = false;
            stopPoll();
            stopPush();
            if (pushTimer) clearTimeout(pushTimer);
        };
    }, [channel, name, enabled, refresh]);
}
