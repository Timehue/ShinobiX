/*
 * Resolve a caller's VILLAGE without reading their save blob.
 *
 * WHY THIS EXISTS (perf, 100-200 concurrent players on one Railway process):
 * two hot per-viewer GETs — /api/village/intel and /api/village/war-map — used
 * to do `kv.get('save:<name>')` purely to read `character.village`, a single
 * short string. A save record is the fattest row in the store: it carries the
 * base64 `avatarImage` data URL (see api/_utils.ts) plus inventory, jutsu and
 * pets, so that one-string lookup pulled ~200 KB out of Postgres and JSON.parse'd
 * it. Worse, on /api/village/intel it happened BEFORE the proc-cache memo, so
 * the shared-frame cache could not absorb it: every single request paid it.
 * At the intel endpoint's real cadence that measured out at ~21 full-save reads
 * per second (~4 MB/s of egress + parse) on the one process that also serves
 * combat, PvP and presence — enough to starve the connection pool and drive GC
 * pressure long before request COUNT became the limit.
 *
 * The fix: the in-memory presence store already holds `village` on every online
 * player's slim character (api/_realtime/presence-input.ts PRESENCE_CHAR_KEEP —
 * the heartbeat and the socket ping both put it there), and anyone polling these
 * endpoints is by definition online. So read presence first at zero KV cost and
 * fall back to the save read only on a genuine presence miss.
 *
 * Trust: presence `character` is CLIENT-SUPPLIED, so this is display-grade only
 * — exactly the trust level both call sites already need (intel builds a view
 * keyed by village; war-map uses it to pick which garrison-feed mirror to
 * project). Neither grants currency, rewards, or write access, and neither can
 * be escalated by claiming a different village: the intel view is derived from
 * that village's OWN stored intel row, and a false claim just shows you a
 * village's public map layer. Do NOT reuse this for anything that pays out,
 * writes, or authorizes — those must keep reading the save.
 *
 * Cost note: a player whose save has NO village (villageless / brand-new) can
 * never be answered from presence, because '' is indistinguishable from "the
 * presence row didn't carry it". They pay the save read every time. That is the
 * rare case and it is the safe direction to fail.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { onlineStore } from './_realtime/online-store.js';

/** The village on a player's live presence row, or '' when there isn't one. */
export function presenceVillageOf(playerName: string): string {
    const name = safeName(String(playerName ?? ''));
    if (!name) return '';
    const character = onlineStore.get(name)?.character as { village?: unknown } | null | undefined;
    return String(character?.village ?? '').trim();
}

/**
 * A player's village: presence first (free), then their SAVED village.
 * Never a request body — the caller passes the authenticated identity name.
 */
export async function viewerVillageOf(playerName: string): Promise<string> {
    const name = safeName(String(playerName ?? ''));
    if (!name) return '';
    const fromPresence = presenceVillageOf(name);
    if (fromPresence) return fromPresence;
    const save = await kv.get<{ character?: { village?: string } }>(`save:${name}`);
    return String(save?.character?.village ?? '').trim();
}
