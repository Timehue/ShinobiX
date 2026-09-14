import {
    PUBLIC_CHAR_FIELDS,
    PUBLIC_TOPLEVEL_FIELDS,
    PUBLIC_COMBAT_TOPLEVEL_FIELDS,
    SHARED_ADMIN_CONTENT_FIELDS,
    COMBAT_STRIP_CHAR_FIELDS,
    COMBAT_STRIP_TOPLEVEL_FIELDS,
} from './_state-ownership.js';
import { stripForgedItems } from './_forged-items.js';

// Pure projections retain ownership-manifest iteration order and never mutate the stored save.
export function isReleaseSafeCreatorEvent(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const event = raw as Record<string, unknown>;
    if (event.eventKind !== 'visualNovel' || event.kageFinale === true) return false;
    for (const field of ['xpReward', 'ryoReward', 'staminaReward']) {
        if (Number(event[field] ?? 0) !== 0) return false;
    }
    if (event.currencyRewards && typeof event.currencyRewards === 'object') {
        if (Object.values(event.currencyRewards as Record<string, unknown>).some((value) => Number(value ?? 0) !== 0)) return false;
    }
    if (Array.isArray(event.vnPages)) {
        for (const page of event.vnPages as Array<Record<string, unknown>>) {
            if (Array.isArray(page?.choices) && (page.choices as Array<Record<string, unknown>>).some((choice) => choice?.battle)) return false;
        }
    }
    return true;
}

// Build the non-owner response: an explicit allowlist DTO. Nothing from the
// stored save reaches a foreign reader unless it is named here — no top-level
// spread, no internal metadata (_saveVersion / _saveAt), and future fields are
// private until deliberately added.
export function buildPublicSaveDTO(data: Record<string, unknown>, opts: { combat: boolean; sharedContent?: boolean }): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    const projectedChar: Record<string, unknown> = {};
    if (char && typeof char === 'object') {
        for (const k of PUBLIC_CHAR_FIELDS) {
            if (k in char) projectedChar[k] = char[k];
        }
    }
    const out: Record<string, unknown> = { character: projectedChar };
    for (const k of PUBLIC_TOPLEVEL_FIELDS) {
        if (k in data) out[k] = data[k];
    }
    if (opts.combat) {
        for (const k of PUBLIC_COMBAT_TOPLEVEL_FIELDS) {
            if (k in data) out[k] = data[k];
        }
    }
    // Admin content slots only — see SHARED_ADMIN_CONTENT_FIELDS.
    if (opts.sharedContent) {
        for (const k of SHARED_ADMIN_CONTENT_FIELDS) {
            // Creator missions and raids currently have no authoritative
            // published-catalog settlement. Do not advertise claim/start
            // buttons that the server must reject or whose authored rewards it
            // ignores. Keep them editable on the owning admin slot.
            if (k === 'creatorMissions' || k === 'creatorRaids') continue;
            if (k in data) out[k] = data[k];
        }
        // Narrative-only events remain publishable. Any rewardful or
        // battle-bearing creator event stays admin-preview-only until it has a
        // receipt-backed settlement path.
        if (Array.isArray(out.creatorEvents)) out.creatorEvents = out.creatorEvents.filter(isReleaseSafeCreatorEvent);
        // A player-forged item is NEVER shared game content. One that reaches an
        // admin slot (see stripForgedItems) would otherwise be handed to every
        // client, which merges shared content into its own `creatorItems` and
        // persists it — that is exactly how one forged weapon ended up mirrored
        // into 88 unrelated saves. Filtering on the way OUT also neutralizes any
        // copy already stored on a slot, with no data migration.
        if (Array.isArray(out.creatorItems)) out.creatorItems = stripForgedItems(out.creatorItems);
    }
    return out;
}

// Character-level fields stripped under ?combatOnly=1 — none of these affect
// combat resolution (only meta progression / cosmetic / lifetime counters).
// Whitelisting was considered but a blacklist is safer here since combat
// touches many character fields and a missed whitelist entry would silently
// break opponent rendering. Both strip lists derive from the ownership
// manifest (boundaries 'combat-strip-char' / 'combat-strip-toplevel').

// Exported for the ownership golden-master characterization tests only —
// the handler remains the sole runtime caller.
export function combatProjection(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const f of COMBAT_STRIP_TOPLEVEL_FIELDS) delete out[f];
    const char = out.character as Record<string, unknown> | undefined;
    if (char && typeof char === 'object') {
        const trimmed = { ...char };
        for (const f of COMBAT_STRIP_CHAR_FIELDS) delete trimmed[f];
        out.character = trimmed;
    }
    return out;
}
