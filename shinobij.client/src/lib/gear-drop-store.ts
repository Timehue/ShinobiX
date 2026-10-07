import { isStepItemId } from "../../../shared/gear-steps";
import { collapseGearDrops, gainedGearDrops, type GearDrop } from "./gear-drop-watch";

/**
 * Which gear step items the player has already been told about, and the queue of
 * announcements still on screen.
 *
 * Why it remembers across sessions: the app paints a cached copy of the save first
 * and the real one a moment later, and the cache can be missing a drop earned just
 * before the tab closed. Counting only within a session would announce that drop a
 * second time. So each account keeps `seen`, the most copies of each item it has
 * been told about, in local storage. A drop is announced only when the player holds
 * more copies than `seen`.
 *
 * Why decreases are ignored for a short while: the stale cache looks like a loss.
 * Inside the boot window a lower count is left alone, so the real save arriving
 * with the original count is not mistaken for a new drop. After the window a lower
 * count is a real sale or trade, and `seen` follows it down so a later drop of the
 * same piece is announced.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Expected = { itemId: string; until: number };
type State = { name: string | null; seen: Record<string, number>; last: Record<string, number>; bootUntil: number; drops: GearDrop[]; serial: number; expected: Expected[] };

export const BOOT_WINDOW_MS = 20_000;
/**
 * How long a screen that shows its own reveal may ask the pop-up to stay quiet for an
 * item. It only needs to cover the moment between the request and adopting the save,
 * and a short window keeps an unused request from swallowing a later real drop.
 */
export const REVEAL_WINDOW_MS = 10_000;

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
const storageKey = (account: string) => `gear-drops-seen:${account}`;
const fresh = (serial = 0): State => ({ name: null, seen: {}, last: {}, bootUntil: 0, drops: [], serial, expected: [] });

let state: State = fresh();
let snapshot: readonly GearDrop[] = state.drops;
let storage: StorageLike | null | undefined;
const listeners = new Set<() => void>();

function activeStorage(): StorageLike | null {
    if (storage !== undefined) return storage;
    try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function loadSeen(account: string): Record<string, number> | null {
    try {
        const raw = activeStorage()?.getItem(storageKey(account));
        if (raw == null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const out: Record<string, number> = {};
        for (const [id, count] of Object.entries(parsed as Record<string, unknown>)) {
            if (isStepItemId(id) && Number.isFinite(Number(count)) && Number(count) > 0) out[id] = Math.floor(Number(count));
        }
        return out;
    } catch { return null; }
}

function persist(account: string, seen: Record<string, number>): void {
    try { activeStorage()?.setItem(storageKey(account), JSON.stringify(seen)); } catch { /* The session copy still prevents a repeat. */ }
}

function emit(drops: GearDrop[]): void {
    snapshot = drops;
    for (const listener of listeners) listener();
}

function countsToRecord(counts: ReadonlyMap<string, number>): Record<string, number> {
    return Object.fromEntries([...counts].filter(([, count]) => count > 0));
}

/** Call with the player's current step item counts every time they change. */
export function observeGearCounts(name: string | null, counts: ReadonlyMap<string, number>, now: number = Date.now()): void {
    // Card numbers keep counting across a logout or account switch, so a new card can
    // never share a number with one still on screen.
    if (!name) {
        const hadDrops = state.drops.length > 0;
        state = fresh(state.serial);
        if (hadDrops) emit(state.drops);
        return;
    }
    const account = slug(name);
    if (state.name !== account) {
        const stored = loadSeen(account);
        const hadDrops = state.drops.length > 0;
        state = { ...fresh(state.serial), name: account, seen: stored ?? countsToRecord(counts), bootUntil: now + BOOT_WINDOW_MS };
        if (hadDrops) emit(state.drops);
        // A brand new record is a baseline: what the player already owns is not news.
        if (stored === null) { persist(account, state.seen); state = { ...state, last: countsToRecord(counts) }; return; }
    }
    const seen = { ...state.seen };
    const expected = state.expected.filter((entry) => entry.until > now);
    const settled = now >= state.bootUntil;
    let changed = false;
    // Once the boot window has closed, a count that fell below what was seen is a real loss.
    // Follow it down BEFORE looking for gains, so a later drop of that same piece is
    // announced even if nothing else changed in between.
    if (settled) {
        for (const itemId of Object.keys(seen)) {
            const lastCount = state.last[itemId] ?? 0;
            if (lastCount < seen[itemId]) { if (lastCount > 0) seen[itemId] = lastCount; else delete seen[itemId]; changed = true; }
        }
    }
    const before = new Map(Object.entries(seen));
    for (const [itemId, count] of counts) {
        const known = seen[itemId] ?? 0;
        if (count > known) { seen[itemId] = count; changed = true; }
    }
    const everyGain = gainedGearDrops(before, counts, state.serial);
    const gained = everyGain.filter((drop) => {
        // A screen that is about to show this very item itself has asked for quiet, once.
        const at = expected.findIndex((entry) => entry.itemId === drop.itemId);
        if (at < 0) return true;
        expected.splice(at, 1);
        return false;
    });
    if (settled) {
        for (const itemId of Object.keys(seen)) {
            const count = counts.get(itemId) ?? 0;
            if (count < seen[itemId]) { if (count > 0) seen[itemId] = count; else delete seen[itemId]; changed = true; }
        }
    }
    const drops = gained.length ? [...state.drops, ...collapseGearDrops(gained)] : state.drops;
    // Keys advance past every gain, shown or not, so a quieted drop's number is never reused.
    state = { ...state, seen, last: countsToRecord(counts), expected, drops, serial: state.serial + everyGain.length };
    if (changed) persist(account, seen);
    if (gained.length) emit(drops);
}

/**
 * A screen that shows its own reveal for a dropped item (the chest, a clan cache, an
 * Exchange purchase) calls this just before it adopts the new save, so the same
 * item is not announced twice. It covers one copy and lapses after a short while.
 */
export function expectGearDropReveal(itemId: string, now: number = Date.now()): void {
    if (!isStepItemId(itemId)) return;
    state = { ...state, expected: [...state.expected.filter((entry) => entry.until > now), { itemId, until: now + REVEAL_WINDOW_MS }] };
}

export function dismissGearDrop(key: number): void {
    if (!state.drops.some((drop) => drop.key === key)) return;
    state = { ...state, drops: state.drops.filter((drop) => drop.key !== key) };
    emit(state.drops);
}

export function subscribeGearDrops(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getGearDropsSnapshot(): readonly GearDrop[] { return snapshot; }

/** Test seams. */
export function resetGearDropStore(next?: { storage?: StorageLike | null }): void {
    state = fresh();
    storage = next && "storage" in next ? next.storage : undefined;
    emit(state.drops);
}
