/*
 * Tavern + clan chat push — which rooms this tab is listening to.
 *
 * The socket only says "this chat changed" (shared/chat-push.ts); the screen
 * refetches over HTTP. This hub owns the room bookkeeping so a screen just
 * says what it is showing:
 *
 *   - one server subscription per room, however many components watch it;
 *   - every watched room is re-joined on each reconnect (Socket.IO forgets
 *     rooms with the old connection), and a confirmed join tells the watchers
 *     to refetch, which picks up anything said while the socket was down;
 *   - a refused join (not a member, a locked guest) is final; a failed or
 *     timed-out one is retried, and the screen's reconcile poll covers the gap.
 *
 * The transport is injected so the bookkeeping is testable without a socket;
 * lib/use-chat-push.ts binds it to the shared presence socket.
 */
import {
    CHAT_SUBSCRIBE_EVENT,
    CHAT_UNSUBSCRIBE_EVENT,
    chatPushRoom,
    chatPushSlug,
    type ChatPush,
    type ChatPushChannel,
    type ChatSubscribeResult,
} from '../../../shared/chat-push';

export type ChatPushTransport = {
    isConnected(): boolean;
    /** Acknowledged emit; null when there is no connected socket to send on. */
    request(event: string, payload: unknown): Promise<unknown> | null;
    emit(event: string, payload: unknown): boolean;
    onPush(fn: (push: ChatPush) => void): () => void;
    onStatus(fn: (connected: boolean) => void): () => void;
};

/** "Something in this chat may have changed — refetch it." */
export type ChatPushListener = () => void;

const DEFAULT_RETRY_MS = 15_000;

type Watch = {
    channel: ChatPushChannel;
    name: string;
    room: string;
    listeners: Set<ChatPushListener>;
    subscribed: boolean;
    retry: ReturnType<typeof setTimeout> | null;
};

export function createChatPushHub(transport: ChatPushTransport, options: { retryMs?: number } = {}) {
    const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    const watches = new Map<string, Watch>();
    let wired = false;

    const isLive = (watch: Watch) => watches.get(watch.room) === watch;
    const notify = (watch: Watch) => { for (const listener of [...watch.listeners]) listener(); };
    const clearRetry = (watch: Watch) => {
        if (watch.retry) clearTimeout(watch.retry);
        watch.retry = null;
    };
    const scheduleRetry = (watch: Watch) => {
        if (watch.retry || !isLive(watch)) return;
        watch.retry = setTimeout(() => {
            watch.retry = null;
            if (isLive(watch) && !watch.subscribed) subscribe(watch);
        }, retryMs);
    };

    function subscribe(watch: Watch): void {
        if (!transport.isConnected()) return;
        const pending = transport.request(CHAT_SUBSCRIBE_EVENT, { channel: watch.channel, key: watch.name });
        if (!pending) return;
        pending.then((raw) => {
            if (!isLive(watch)) return;
            const result = raw as ChatSubscribeResult | null | undefined;
            if (result?.ok === true) {
                watch.subscribed = true;
                // Catch-up: anything said before the join reached no hint.
                notify(watch);
                return;
            }
            if (result && (result.reason === 'forbidden' || result.reason === 'invalid')) return;
            scheduleRetry(watch);
        }, () => scheduleRetry(watch));
    }

    function wire(): void {
        if (wired) return;
        wired = true;
        transport.onStatus((connected) => {
            for (const watch of watches.values()) {
                clearRetry(watch);
                watch.subscribed = false;
                if (connected) subscribe(watch);
            }
        });
        transport.onPush((push) => {
            const watch = watches.get(chatPushRoom(push.channel, push.key));
            if (watch) notify(watch);
        });
    }

    /** Listen to one chat's hints until the returned function is called. */
    return function watchChatPush(channel: ChatPushChannel, name: string, listener: ChatPushListener): () => void {
        const slug = chatPushSlug(channel, name);
        if (!slug) return () => {};
        wire();
        const room = chatPushRoom(channel, slug);
        let watch = watches.get(room);
        if (!watch) {
            watch = { channel, name: name.trim(), room, listeners: new Set(), subscribed: false, retry: null };
            watches.set(room, watch);
            subscribe(watch);
        }
        const mine = watch;
        mine.listeners.add(listener);
        return () => {
            mine.listeners.delete(listener);
            if (mine.listeners.size > 0 || !isLive(mine)) return;
            watches.delete(room);
            clearRetry(mine);
            transport.emit(CHAT_UNSUBSCRIBE_EVENT, { channel, key: mine.name });
        };
    };
}
