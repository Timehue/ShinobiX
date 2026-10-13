/*
 * patch-notes — player-facing "What's New" registry, newest first.
 *
 * PatchNotesModal auto-shows the latest entry once per device (localStorage
 * version gate) to any established player, and can be re-opened anytime via the
 * "What's New" button. Add a new entry at the TOP and bump its `version`; that's
 * the only thing the modal compares.
 *
 * Empty since 2026-10-13: the three notes from the testing phase (June 29 to
 * July 28, 2026) described changes no current player needs announced, so the
 * owner had them removed. With no entry, nothing pops up and the Profile
 * "What's New" button is hidden.
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

export const PATCH_NOTES: PatchNote[] = [];

export const LATEST_PATCH_NOTE: PatchNote | undefined = PATCH_NOTES[0];
