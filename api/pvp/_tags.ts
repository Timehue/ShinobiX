/*
 * Canonical PvP tag contract — the single source of truth for tag names,
 * aliases, stacking, percent-cap rules, and the small validation predicates the
 * combat engine and the session sanitizer both depend on.
 *
 * Imported by:
 *   • api/pvp/session.ts  — sanitizeJutsuList / sanitizePvpItems canonicalize +
 *     whitelist tag names against KNOWN_TAG_NAMES *before* the session is sealed.
 *   • api/pvp/move.ts     — combat resolution branches on canonical names only.
 *
 * Two registries that used to be copy-pasted across move.ts + session.ts now
 * live here once, so they can't drift. Cross-root parity with the client tag
 * tables (shinobij.client/src/lib/tags.ts) is guarded by
 * scripts/pvp-tags-parity.test.mjs; the server-internal invariants are guarded
 * by api/pvp/_tags.test.ts.
 */

// ─── Aliases ──────────────────────────────────────────────────────────────────
// Historical tag spellings the engine still accepts on input. Everything is
// canonicalized to the right-hand value before the session is sealed, so combat
// resolution only ever sees the canonical name. Mirrors normalizeTagName in
// shinobij.client/src/lib/tags.ts.
export const TAG_ALIASES: Readonly<Record<string, string>> = {
    'Seal': 'Bloodline Seal',
    'Afterburn': 'Ignition',
    'Time Compression': 'Lag',
    'Time Dilation': 'Overclock',
    'Vamp': 'Siphon',
};

export function canonicalTagName(name: string): string {
    return TAG_ALIASES[name] ?? name;
}

// True when two names refer to the same canonical tag (alias-aware).
export function tagNameMatches(name: string, canonicalName: string): boolean {
    return canonicalTagName(name) === canonicalName;
}

// ─── Canonical tag set ────────────────────────────────────────────────────────
// The closed set of canonical names the combat resolver in move.ts branches on.
// `Pierce` is handled as a damage-mode flag (not a status) but is still a valid
// loadout tag, so it lives here too.
export const CANONICAL_TAG_NAMES: readonly string[] = [
    'Heal', 'Shield', 'Barrier', 'Pierce', 'Stun', 'Poison', 'Drain', 'Absorb', 'Reflect',
    'Lifesteal', 'Increase Damage Given', 'Decrease Damage Given', 'Increase Damage Taken',
    'Decrease Damage Taken', 'Increase Heal', 'Debuff Prevent', 'Buff Prevent',
    'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent', 'Copy', 'Mirror', 'Push', 'Pull',
    'Bloodline Seal', 'Elemental Seal', 'Wound', 'Recoil', 'Move',
    'Ignition', 'Lag', 'Overclock', 'Siphon',
];

// Accepted INPUT names = canonical names + their aliases. The session sanitizer
// whitelists tag names against this; the combat resolver only sees the
// canonical projection of whatever survives.
export const KNOWN_TAG_NAMES: ReadonlySet<string> = new Set<string>([
    ...CANONICAL_TAG_NAMES,
    ...Object.keys(TAG_ALIASES),
]);

// ─── Stacking / percent rules ─────────────────────────────────────────────────
// Statuses that allow multiple coexisting instances. Everything else REPLACES a
// same-named instance on re-apply (see addStatus in move.ts).
export const STACKABLE_STATUS: ReadonlySet<string> = new Set([
    'Increase Damage Given', 'Increase Damage Taken', 'Ignition',
    'Decrease Damage Given', 'Decrease Damage Taken',
    'Wound', 'Lifesteal', 'Reflect', 'Absorb',
]);

// Amp/DR tags whose percent is clamped to the bloodline rank cap. Mirrors the
// client's cappedDamageTags (shinobij.client/src/lib/tags.ts). Wound is NOT here
// — it has its own per-rank cap (woundCapForJutsu in move.ts).
export const CAPPED_AMP_TAGS: ReadonlySet<string> = new Set([
    'Increase Damage Given', 'Decrease Damage Given', 'Increase Damage Taken',
    'Decrease Damage Taken', 'Absorb', 'Siphon', 'Ignition', 'Reflect', 'Recoil', 'Lifesteal',
]);

// ─── Validation predicates ────────────────────────────────────────────────────
// Tags that can ONLY resolve when the cast actually deals damage (or pierces) —
// they read the post-mitigation damage. On a pure-utility / zero-EP jutsu they
// can never fire, so the sanitizer strips them rather than leaving a silent
// no-op tag on the loadout.
export const REQUIRES_DAMAGE_TAGS: ReadonlySet<string> = new Set(['Wound', 'Siphon']);

// Tags allowed inside an INSTANT_EFFECT ground zone. Anything else on such a
// jutsu is dropped from the zone (it has nowhere to resolve).
export const GROUND_EFFECT_TAGS: ReadonlySet<string> = new Set([
    'Decrease Damage Given', 'Recoil', 'Poison',
]);

// "Fixed-effect-power" tags — binary control + displacement. The bloodline
// builder used to stamp effectPower = 100 on any jutsu carrying one of these as
// a point-budget sentinel ("the effect always applies at 100%"), but the damage
// formula read that 100 as ~3200 damage. These jutsu instead deal STANDARD
// 60-AP damage (FIXED_EFFECT_STANDARD_EP) plus their always-on effect; the EP is
// normalized at the data boundary (sanitizeJutsuList here, normalizeJutsu on the
// client) so the sentinel can never reach the damage formula. Mirrors the
// client's fixedEffectPowerTags (binaryTags + Push + Pull). Canonical names only.
export const FIXED_EFFECT_POWER_TAGS: ReadonlySet<string> = new Set([
    'Stun', 'Bloodline Seal', 'Elemental Seal', 'Copy', 'Mirror', 'Move',
    'Buff Prevent', 'Debuff Prevent', 'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent',
    'Lag', 'Overclock', 'Push', 'Pull',
]);
// Standard 60-AP effect power — the damage a fixed-effect jutsu deals once the
// EP-100 sentinel is removed. Matches the bloodline builder's "Standard" tier.
export const FIXED_EFFECT_STANDARD_EP = 40;

export function jutsuHasFixedEffectPower(tags: ReadonlyArray<{ name?: string }> | undefined): boolean {
    return (tags ?? []).some(t => typeof t?.name === 'string' && FIXED_EFFECT_POWER_TAGS.has(canonicalTagName(t.name)));
}

// Tags that mean a jutsu TOUCHES THE OPPONENT (debuffs / displacement / DoTs).
// The move handler uses this (plus effectPower > 0) to decide a jutsu needs an
// in-range opponent target; the client mirrors the exact same set so "armed a
// jutsu, clicked, nothing happened" can't happen. Canonical names only.
export const OPPONENT_AFFECTING_TAGS: ReadonlySet<string> = new Set([
    'Stun', 'Bloodline Seal', 'Elemental Seal', 'Buff Prevent', 'Cleanse Prevent',
    'Decrease Damage Given', 'Increase Damage Taken', 'Ignition', 'Poison', 'Drain',
    'Lag', 'Mirror', 'Push', 'Pull', 'Recoil',
]);
