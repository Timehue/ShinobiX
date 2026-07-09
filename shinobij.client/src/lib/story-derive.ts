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

/**
 * Every village's proof-trial (L88) state machine has the same SHAPE as Ashen
 * Leaf's better-winter chain; only the trait names differ. This builds the
 * AL-identical rule set from a village's naming: ready = the proof works AND
 * the number is counted AND a lane was recorded AND the provenance was either
 * carried by the player or handed to the companion (humility still qualifies);
 * carried/deferred split the finale; unfinished = saved the object but never
 * earned the handoff; witness-present = the elder walked the L92 road on the
 * open/civic lanes.
 */
function proofChainRules(v: {
    works: string; number: string; lanes: string[];
    ready: string; deferred: string;
    composite: string; carried: string; deferredComposite: string;
    any: string; unfinished: string;
    /** Ways the proof object survived L65: kept by the player OR handed to the
     *  companion. Either form supports provenance; both reach "unfinished" if
     *  the handoff conversation never happens. */
    savedObjects: string[];
    witnessPresent: string; witnessLanes: string[];
}): DeriveRule[] {
    return [
        { grant: v.works, when: (has) => has(v.number) },
        {
            grant: v.composite,
            when: (has) => has(v.works) && has(v.number) && v.lanes.some(has) && (has(v.ready) || has(v.deferred)),
        },
        { grant: v.carried, when: (has) => has(v.composite) && has(v.ready) },
        { grant: v.deferredComposite, when: (has) => has(v.composite) && has(v.deferred) },
        { grant: v.any, when: (has) => has(v.ready) || has(v.deferred) },
        {
            grant: v.unfinished,
            when: (has) => v.savedObjects.some(has) && v.lanes.some(has) && !has(v.ready) && !has(v.deferred),
        },
        { grant: v.witnessPresent, when: (has) => v.witnessLanes.some(has) },
    ];
}

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

    // ── Stormveil: the quiet-storm proof chain (Kesa Volt's ridge anchor line) ──
    ...proofChainRules({
        works: "sv88-line-held", number: "sv88-one-district",
        lanes: ["sv88-woke-the-district", "sv88-logged-the-storm", "sv88-baited-the-board"],
        ready: "sv88-reason-proof-ready", deferred: "sv88-reason-proof-deferred",
        composite: "sv88-better-storm-ready", carried: "sv88-better-storm-carried",
        deferredComposite: "sv88-better-storm-deferred", any: "sv88-reason-proof-any",
        unfinished: "sv88-unfinished-answer", savedObjects: ["sv65-saved-the-reason", "sv65-gave-mira-the-page"],
        witnessPresent: "sv92-witness-present", witnessLanes: ["sv92-open-road", "sv92-signed-muster"],
    }),
    // Stormveil: any surviving form of Kesa's reason — including keeping it
    // unfinished in your own kit — counts as reason-proof-any. proofChainRules
    // already grants it for ready/deferred; extend to unfinished so the name-less
    // "A Sky Without a Why" branch (forbid reason-proof-any) truly means NO reason.
    { grant: "sv88-reason-proof-any", when: (has) => has("sv88-unfinished-answer") },
    // ── Frostfang: the chosen-count proof chain (Dren Coldewe's long lanterns) ──
    ...proofChainRules({
        works: "ff88-relay-held", number: "ff88-nineteen-minutes",
        lanes: ["ff88-woke-the-rows", "ff88-logged-the-drill", "ff88-baited-the-wardens"],
        ready: "ff88-exit-proof-ready", deferred: "ff88-exit-proof-deferred",
        composite: "ff88-better-roll-ready", carried: "ff88-better-roll-carried",
        deferredComposite: "ff88-better-roll-deferred", any: "ff88-exit-proof-any",
        unfinished: "ff88-unfinished-answer", savedObjects: ["ff65-saved-the-letter", "ff65-gave-yura-the-letter"],
        witnessPresent: "ff92-witness-present", witnessLanes: ["ff92-called-the-camp", "ff92-took-her-terms"],
    }),
    // ── Moonshadow: the witnessed-return proof chain (the Returning) ──
    ...proofChainRules({
        works: "ms88-return-proven", number: "ms88-eleven-files",
        lanes: ["ms88-open-returns", "ms88-sealed-receipts", "ms88-baited-the-market"],
        ready: "ms88-nyx-proof-carried", deferred: "ms88-nyx-proof-deferred",
        composite: "ms88-better-truth-ready", carried: "ms88-better-truth-carried",
        deferredComposite: "ms88-better-truth-deferred", any: "ms88-nyx-proof-any",
        unfinished: "ms88-unfinished-answer", savedObjects: ["ms65-saved-the-file", "ms65-gave-nyx-the-file"],
        witnessPresent: "ms92-witness-present", witnessLanes: ["ms92-vowed-open-ledgers", "ms92-vowed-a-keeper"],
    }),
    // Moonshadow: any L80 "Harrow's Shortcut" completion means the player heard
    // Harrow name the Hollow Gate at the Mirror manifest. Persists Gate-knowledge
    // for the cross-village / final-seat plot, whichever Harrow choice was made.
    { grant: "ms80-named-hollow-gate", when: (has) => has("ms80-pulled-her-back") || has("ms80-partnered") || has("ms80-let-her-burn") },
    // Moonshadow: the player still physically/legally holds Nyx's bill-of-sale
    // going into L100 iff they took it at L65 AND never resolved ownership
    // consensually (carried WITH her consent, or handed it back for her to carry).
    // Gates "The File in Your Coat" so it only ever accuses a genuine holder, and
    // never a player who returned the file to Nyx. Mutually exclusive with the
    // better-truth chain by construction (that needs a nyx-proof state).
    { grant: "ms88-player-still-holds-nyx-file", when: (has) => has("ms65-saved-the-file") && !has("ms88-nyx-proof-carried") && !has("ms88-nyx-proof-deferred") },
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
export const DERIVED_TRAIT_LEVELS: Record<string, number> = Object.fromEntries([
    ...["al88-water-proven", "al88-better-winter-ready", "al88-better-winter-carried",
        "al88-better-winter-deferred", "al88-reed-proof-any", "al88-unfinished-answer"].map((t) => [t, 88]),
    ["al92-mori-present", 92],
    ...["sv88-line-held", "sv88-better-storm-ready", "sv88-better-storm-carried",
        "sv88-better-storm-deferred", "sv88-reason-proof-any", "sv88-unfinished-answer"].map((t) => [t, 88]),
    ["sv92-witness-present", 92],
    ...["ff88-relay-held", "ff88-better-roll-ready", "ff88-better-roll-carried",
        "ff88-better-roll-deferred", "ff88-exit-proof-any", "ff88-unfinished-answer"].map((t) => [t, 88]),
    ["ff92-witness-present", 92],
    ["ms80-named-hollow-gate", 80],
    ...["ms88-return-proven", "ms88-better-truth-ready", "ms88-better-truth-carried",
        "ms88-better-truth-deferred", "ms88-nyx-proof-any", "ms88-unfinished-answer",
        "ms88-player-still-holds-nyx-file"].map((t) => [t, 88]),
    ["ms92-witness-present", 92],
]);
