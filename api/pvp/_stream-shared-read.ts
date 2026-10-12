import { kv } from '../_storage.js';

/*
 * One database read per battle per moment, however many viewers watch it.
 *
 * Every open /api/pvp/stream reads `pvp:<battleId>` (uncached by design:
 * `pvp:` is a no-cache prefix) when a move is written and on its own 1 s safety
 * poll. Two fighters plus N spectators therefore cost N+2 reads a second, and a
 * write woke all of them into N+2 simultaneous reads of the same row. Streams
 * only DISPLAY the session (the turn-deadline enforcer re-reads under the move
 * lock before it writes anything), so they can share a read:
 *
 *  - concurrent readers of one battle join a single in-flight read;
 *  - a result is reused for SHARED_READ_TTL_MS, which caps a battle at a few
 *    reads a second no matter how many viewers it has;
 *  - a write to the key in this process (the stream's onKeyWritten listener
 *    calls forgetSharedStreamRead) discards the result and orphans any read
 *    already in flight, so nobody is served a session older than a write it
 *    was woken by. Only a write this process cannot hear (another process
 *    during a deploy overlap) can be up to SHARED_READ_TTL_MS staler than
 *    before, on top of the existing 1 s safety poll.
 *
 * Consumers get the same object; the stream never mutates it.
 */
export const SHARED_READ_TTL_MS = 250;

type Entry = { generation: number; at: number; value?: unknown; pending?: Promise<unknown> };

const entries = new Map<string, Entry>();
const generations = new Map<string, number>();
const viewers = new Map<string, number>();

/** A stream starts watching `key`. Pair with releaseSharedStreamRead. */
export function retainSharedStreamRead(key: string): void {
    viewers.set(key, (viewers.get(key) ?? 0) + 1);
}

/** A stream stopped watching `key`; the last one out drops its state. */
export function releaseSharedStreamRead(key: string): void {
    const left = (viewers.get(key) ?? 1) - 1;
    if (left > 0) { viewers.set(key, left); return; }
    viewers.delete(key);
    entries.delete(key);
    generations.delete(key);
}

/** The key was written: no reader may be served anything read before now. */
export function forgetSharedStreamRead(key: string): void {
    generations.set(key, (generations.get(key) ?? 0) + 1);
    entries.delete(key);
}

export async function readSharedStreamSession(key: string, now: () => number = Date.now): Promise<unknown> {
    const generation = generations.get(key) ?? 0;
    const entry = entries.get(key);
    if (entry && entry.generation === generation) {
        if (entry.pending) return entry.pending;
        if (now() - entry.at < SHARED_READ_TTL_MS) return entry.value;
    }
    const pending = kv.get<unknown>(key);
    const mine: Entry = { generation, at: 0, pending };
    entries.set(key, mine);
    try {
        const value = await pending;
        // Publish only if nothing replaced this read (a write, or a release).
        if (entries.get(key) === mine) entries.set(key, { generation, at: now(), value });
        return value;
    } catch (error) {
        if (entries.get(key) === mine) entries.delete(key);
        throw error;
    }
}

/** Test-only. */
export function __sharedStreamReadState() {
    return { entries: entries.size, generations: generations.size, viewers: viewers.size };
}
