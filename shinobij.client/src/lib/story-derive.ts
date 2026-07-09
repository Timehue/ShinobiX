/*
 * story-derive — composite / derived story traits.
 *
 * The VN engine grants exactly ONE atomic trait per choice and gates on a
 * single requireTrait / forbidTrait. Some story state is a boolean COMBINATION
 * of choices that no single choice can express — e.g. Ashen Leaf's "the better
 * winter is ready to carry" is: the machine climbed AND a form of proof was
 * preserved AND Aren's provenance was honored. Those are DERIVED here: a pure,
 * idempotent fixpoint pass that materializes composite traits from the atomic
 * ones the player actually earned.
 *
 * Run it after every story choice (so a later page in the SAME scene can gate
 * on the freshly-derived composite) and on save load (so existing saves stay
 * consistent). Rules are village-scoped by trait prefix, so a player who never
 * touched a village's traits triggers none of its rules — a no-op for everyone
 * else.
 *
 * Zero imports on purpose: the story-derive test and the client both pull this
 * in without dragging other modules along.
 */

type DeriveRule = { grant: string; when: (has: (trait: string) => boolean) => boolean };

// The three Ashen Leaf "Wet Field" (L88) recorded lanes — having any one means
// the player completed the trial and watched the water climb.
const AL88_LANES = ["al88-proved-the-winter", "al88-held-the-proof", "al88-baited-the-survey"];

const RULES: DeriveRule[] = [
    // ── Ashen Leaf: the better-winter proof chain (owner brief 2026-07-09) ──
    // The full-size screw climbed. Set explicitly at L88 "The Water Climbs";
    // also derivable from the number beat as a fallback for older saves.
    { grant: "al88-water-proven", when: (has) => has("al88-ninety-mouths") },
    // The strongest confrontation: machine proven, a form of proof preserved
    // (any lane), AND Aren's provenance either carried by the player or handed
    // to the Reeds. Humility (deferred) is NOT punished — it still qualifies.
    {
        grant: "al88-better-winter-ready",
        when: (has) =>
            has("al88-water-proven") &&
            has("al88-ninety-mouths") &&
            AL88_LANES.some(has) &&
            (has("al88-reed-proof-ready") || has("al88-reed-proof-deferred")),
    },
    // Who does the arguing at the tower — used to split the L100 finale and the
    // "Warm Chair" ending cleanly (single-trait gates instead of AND chains).
    { grant: "al88-better-winter-carried", when: (has) => has("al88-better-winter-ready") && has("al88-reed-proof-ready") },
    { grant: "al88-better-winter-deferred", when: (has) => has("al88-better-winter-ready") && has("al88-reed-proof-deferred") },
    // Aren's proof exists in some carriable form — gates the "answer for Aren"
    // reckoning, which should not hinge on one early Toma choice any more.
    { grant: "al88-reed-proof-any", when: (has) => has("al88-reed-proof-ready") || has("al88-reed-proof-deferred") },
    // Saved Aren's model but never turned it into the village's argument (the
    // trust / provenance handoff was never earned): a real answer, but a lesser
    // one. Mutually exclusive with better-winter-ready by construction (that
    // needs a reed-proof state; this needs the absence of one). Also set
    // explicitly on the keep-the-model choice; derivation covers the player who
    // skipped provenance entirely (saved the screw, let the numbers stand).
    {
        grant: "al88-unfinished-answer",
        when: (has) =>
            has("al65-saved-the-screw") &&
            AL88_LANES.some(has) &&
            !has("al88-reed-proof-ready") &&
            !has("al88-reed-proof-deferred"),
    },
    // Mori walked the road with his signed charts (L92 civic / trusting lanes),
    // so he can step forward to answer for his own records at the finale.
    { grant: "al92-mori-present", when: (has) => has("al92-carried-their-trust") || has("al92-took-the-count") },
];

/**
 * Materialize composite story traits from the atomic ones. Pure + idempotent;
 * iterates to a fixpoint so one rule can build on another's output (water-proven
 * → better-winter-ready). Returns a deduped array; content-stable input yields
 * equivalent output.
 */
export function deriveStoryTraits(traits: readonly string[]): string[] {
    const set = new Set(traits);
    let changed = true;
    while (changed) {
        changed = false;
        for (const rule of RULES) {
            if (!set.has(rule.grant) && rule.when((t) => set.has(t))) {
                set.add(rule.grant);
                changed = true;
            }
        }
    }
    return [...set];
}

/**
 * Traits this layer can DERIVE (never granted by a choice) and the level at
 * which they become earnable. The story-content earnability test and the
 * al-rewrite integrator treat these as earnable so requireTrait gates on them
 * validate. Keep in sync with RULES above.
 */
export const DERIVED_TRAIT_LEVELS: Record<string, number> = {
    "al88-water-proven": 88,
    "al88-better-winter-ready": 88,
    "al88-better-winter-carried": 88,
    "al88-better-winter-deferred": 88,
    "al88-reed-proof-any": 88,
    "al88-unfinished-answer": 88,
    "al92-mori-present": 92,
};
