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
