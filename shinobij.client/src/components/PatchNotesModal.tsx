/*
 * PatchNotesModal — the in-game "What's New" delivery for the patch-notes
 * registry (data/patch-notes.ts). Two ways in:
 *   • Auto-popup: once per device for any established player (level ≥ MIN_LEVEL),
 *     via a localStorage version gate.
 *   • Manual: any "What's New" button dispatches a `shinobix:open-patch-notes`
 *     window event; this listens and opens regardless of seen-state.
 *
 * The level gate (not account age) is deliberate: createdAt is backfilled to
 * first-save time, so a returning veteran logging in fresh after the deploy
 * would look "new" and miss the note — exactly the audience it's for. A level
 * gate catches every established player and just avoids interrupting the opening
 * minutes of a brand-new account, mirroring DailyBriefingModal's MIN_LEVEL.
 *
 * Hosted by LeftProfileCard (has `character`, always mounted) and rendered via
 * the canonical <Modal> (portals to <body>) — no App.tsx line-budget cost.
 * Pure client + localStorage: no server, save, or schema change.
 */
import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { LATEST_PATCH_NOTE } from "../data/patch-notes";
import "./PatchNotesModal.css";

const SEEN_KEY = "patchNotes.lastSeenVersion.v1";
const MIN_LEVEL = 5; // don't interrupt brand-new onboarding; matches DailyBriefingModal

export function PatchNotesModal({ character }: { character: Character }) {
    // Decide the one-time auto-popup at mount (lazy init, not an effect): show
    // the latest unseen note once per device to any established player.
    const [open, setOpen] = useState<boolean>(() => {
        if (!LATEST_PATCH_NOTE || character.level < MIN_LEVEL) return false;
        let lastSeen: string | null;
        try { lastSeen = window.localStorage?.getItem(SEEN_KEY) ?? null; } catch { lastSeen = null; }
        return lastSeen !== LATEST_PATCH_NOTE.version;
    });

    // Manual re-open from any "What's New" button.
    useEffect(() => {
        function onOpen() { setOpen(true); }
        window.addEventListener("shinobix:open-patch-notes", onOpen);
        return () => window.removeEventListener("shinobix:open-patch-notes", onOpen);
    }, []);

    function close() {
        setOpen(false);
        if (LATEST_PATCH_NOTE) {
            try { window.localStorage?.setItem(SEEN_KEY, LATEST_PATCH_NOTE.version); } catch { /* private mode — skip */ }
        }
    }

    if (!LATEST_PATCH_NOTE) return null;
    const note = LATEST_PATCH_NOTE;

    return (
        <Modal open={open} onClose={close} title={`📜 ${note.title}`} size="lg">
            <div className="patch-notes">
                <p className="patch-notes-date">{note.date}</p>
                {note.intro && <p className="patch-notes-intro">{note.intro}</p>}
                {note.sections.map((s) => (
                    <div className="patch-notes-section" key={s.heading}>
                        <h4>{s.heading}</h4>
                        <p>{s.body}</p>
                    </div>
                ))}
                <div className="patch-notes-actions">
                    <Button variant="primary" onClick={close}>Got it</Button>
                </div>
            </div>
        </Modal>
    );
}
