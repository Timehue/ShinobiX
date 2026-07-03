/*
 * patch-notes — player-facing "What's New" registry, newest first.
 *
 * PatchNotesModal auto-shows the latest entry once per device (localStorage
 * version gate) to any established player, and can be re-opened anytime via the
 * "What's New" button. Add a new entry at the TOP and bump its `version`; that's
 * the only thing the modal compares.
 */

export type PatchNoteSection = { heading: string; body: string };

export type PatchNote = {
    /** Bump this to re-trigger the one-time popup. Compared as an opaque string. */
    version: string;
    /** Human display date. */
    date: string;
    title: string;
    intro?: string;
    sections: PatchNoteSection[];
};

export const PATCH_NOTES: PatchNote[] = [
    {
        version: "2026.07.02-legacy",
        date: "July 2, 2026",
        title: "The Legacy System",
        intro:
            "A third path opens beside your bloodline. Somewhere out there a Wandering Sage " +
            "has started watching shinobi who've proven themselves — and when he finds you, " +
            "he'll offer you a Legacy: a permanent identity earned by how you've lived. Here's what's new.",
        sections: [
            {
                heading: "A Wandering Sage walks the roads",
                body:
                    "At Level 50, a hooded stranger begins appearing on the world map. He has been " +
                    "reading your battles, missions, and choices, and offers you the legacies your life " +
                    "has opened. Accepting one is permanent — you may only ever hold a single Legacy, " +
                    "forever — so choose the path that feels like yours. Turning him down is always free; " +
                    "he'll find you again.",
            },
            {
                heading: "A signature technique, all your own",
                body:
                    "Every Legacy carries its own signature jutsu. Prove your path through its trials and it " +
                    "becomes yours: a dedicated 16th technique that sits outside your fifteen-jutsu loadout, " +
                    "always at your side, that no other shinobi can wield.",
            },
            {
                heading: "Trials, stages, and titles",
                body:
                    "Your Legacy deepens through five stages, each earned by an in-world trial its emissary " +
                    "sets for you — and each stage grants a title the whole world can see on your nameplate. " +
                    "Accept a Legacy and you're granted a handful of Aura Stones on the spot to mark the moment.",
            },
            {
                heading: "The world remembers",
                body:
                    "A living Hall of Legends now records the shinobi who shaped the world, the Ages it passes " +
                    "through, and the first to walk each path. Your Legacy, its stage, and its earned titles " +
                    "show on your profile and in the tavern for everyone to see.",
            },
            {
                heading: "How to find your path",
                body:
                    "Legacies are never bought or grinded — they open based on what you actually do. Keep playing " +
                    "the way you play. Below Level 50, watch for whispers about the path you're carving; at 50, " +
                    "the Sage will come looking for you.",
            },
        ],
    },
    {
        version: "2026.06.29-progression",
        date: "June 29, 2026",
        title: "The Shinobi Path Rebalance",
        intro:
            "We've reworked leveling, stat points, ranks, and the economy so your whole " +
            "journey from Academy to legend feels steady and earned. Here's what changed.",
        sections: [
            {
                heading: "A longer, smoother climb",
                body:
                    "The road to Level 90 is now paced for roughly three months of regular play. " +
                    "Early levels still fly by; the later ranks are the real test. No more " +
                    "training-speed multiplier inflating your XP — every point you earn is real.",
            },
            {
                heading: "More stat points to spend",
                body:
                    "Stat points now follow a clean line that maxes every stat exactly at Level 100. " +
                    "Most veterans will log in to a pile of unspent points waiting on the Stats tab — " +
                    "go allocate them.",
            },
            {
                heading: "Ranks finally matter",
                body:
                    "Each ninja rank now has a combat stat cap (Academy 350 → Genin 700 → Chunin 1,300 " +
                    "→ Jonin 2,100; Special Jonin is uncapped). Your saved stats are never touched — but " +
                    "in battle they're held to your rank's ceiling until you rank up, then the cap jumps. " +
                    "Dumping everything into one stat at a low rank no longer wins fights, and ranking " +
                    "up is a genuine power spike. The new Progression panel on your Stats tab shows your " +
                    "current cap and the next one.",
            },
            {
                heading: "The bank is a vault, not a paycheck",
                body:
                    "Bank interest has been cut sharply. Savings stay safe, but real ryo now comes from " +
                    "playing — missions, hunts, fights, and the field.",
            },
            {
                heading: "Endless Tower",
                body:
                    "Still the best place to farm ryo and materials. Its daily XP now has a soft cap so it " +
                    "complements the journey instead of skipping it.",
            },
        ],
    },
];

export const LATEST_PATCH_NOTE: PatchNote | undefined = PATCH_NOTES[0];
