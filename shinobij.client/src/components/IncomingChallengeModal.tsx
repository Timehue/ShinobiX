import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { playFightNotificationSfx } from "../lib/match-alert-sfx";
import type { DuelChallenge } from "../App";
import { noticeKeyCanDismiss } from "./GameAlert";
import { GameArtIcon } from "./GameArtIcon";
import "./IncomingChallengeModal.css";

/**
 * Centered, clickable "you've been challenged" popup — shown from any screen the
 * instant a duel/spar/pet challenge lands in `duelChallenges`.
 *
 * Replaces the old top-of-screen banner that reused `.incoming-attack-banner`,
 * which strobed red at 0.4s AND set `pointer-events: none` — so its Accept /
 * Decline buttons could never actually be clicked. This is a real modal: portaled
 * to <body> (so the fixed side rails don't paint over it), a soft slow glow
 * instead of a strobe, and fully interactive.
 *
 * Sector attacks are intentionally excluded here (they auto-route straight into
 * the live battle elsewhere); this surfaces spar / ranked / pet / clan-war invites
 * that require an explicit Accept or Decline.
 */
function challengeLabel(mode: DuelChallenge["mode"]): string {
    if (mode === "rankedPet") return "ranked pet battle";
    if (mode === "clanWarPet") return "pet battle";
    if (mode === "ranked") return "ranked duel";
    return "spar";
}

export function IncomingChallengeModal({
    challenges,
    selfName,
    processingIds,
    onAccept,
    onDecline,
}: {
    challenges: DuelChallenge[];
    selfName: string;
    processingIds: string[];
    onAccept: (challenge: DuelChallenge) => void;
    onDecline: (challenge: DuelChallenge) => void;
}) {
    const meLower = selfName.toLowerCase();
    const incoming = challenges.filter((c) => !c.accepted && !c.declined && c.toName.toLowerCase() === meLower);
    const pending = incoming.filter((c) => !c.sectorAttack);

    // Sound once per new challenge, including the sector attacks this modal
    // never shows: the heartbeat re-delivers each one every beat until it
    // expires, so the ids heard are remembered for as long as App is mounted.
    const incomingIds = incoming.map((c) => c.id).join("\n");
    const heardIds = useRef(new Set<string>());
    useEffect(() => {
        let fresh = false;
        for (const id of incomingIds.split("\n")) {
            if (id && !heardIds.current.has(id)) { heardIds.current.add(id); fresh = true; }
        }
        if (fresh) playFightNotificationSfx();
    }, [incomingIds]);

    // Take focus when the popup opens, so keys stop landing in the chat box
    // underneath, and hand it back when the last challenge is answered.
    const shownId = pending[0]?.id ?? "";
    const open = shownId !== "";
    const shownBusy = open && processingIds.includes(shownId);
    const acceptRef = useRef<HTMLButtonElement>(null);
    const openedAtRef = useRef(0);
    const declineShownRef = useRef<(() => void) | null>(null);
    useLayoutEffect(() => {
        const shown = pending[0];
        // Only an official Kage challenge's "Later" is safe on Escape: it keeps
        // the invitation open. An ordinary "Decline" rejects the fight, so a
        // stray Escape must never send it.
        const laterOnly = !!shown?.kageChallengeId && !!shown?.kageVillage;
        declineShownRef.current = shown && !shownBusy && laterOnly ? () => onDecline(shown) : null;
    });
    useEffect(() => {
        if (!open) return;
        const restore = document.activeElement as HTMLElement | null;
        return () => { if (restore?.isConnected) restore.focus(); };
    }, [open]);
    useEffect(() => {
        if (!shownId) return;
        openedAtRef.current = performance.now();
        acceptRef.current?.focus();
        // Escape answers "Later" on a Kage invitation and is otherwise held here,
        // so it neither declines a fight nor reaches the screen underneath. A
        // notice or confirm stacked above keeps its own Escape, and a held key
        // or an Escape pressed as the popup arrived never answers anything.
        function onKey(e: KeyboardEvent) {
            if (e.key !== "Escape" || e.defaultPrevented) return;
            if (document.querySelector(".game-alert-backdrop")) return;
            e.preventDefault();
            e.stopPropagation();
            if (noticeKeyCanDismiss(e, openedAtRef.current, performance.now())) declineShownRef.current?.();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [shownId]);

    if (!pending.length) return null;

    const c = pending[0];
    const busy = processingIds.includes(c.id);
    const officialKage = !!c.kageChallengeId && !!c.kageVillage;
    const label = officialKage ? "duel for the Kage seat" : challengeLabel(c.mode);
    const avatar =
        typeof c.challenger?.avatarImage === "string" && c.challenger.avatarImage.trim()
            ? c.challenger.avatarImage
            : "";
    const extra = pending.length - 1;

    return createPortal(
        <div className="ic-backdrop" role="presentation">
            <div className="ic-card" role="alertdialog" aria-modal="true" aria-label="Incoming challenge">
                <div className="ic-glyph" aria-hidden="true"><GameArtIcon kind="attack" size={42} /></div>
                <div className="ic-kicker">{officialKage ? "Official Kage challenge" : "Challenge"}</div>

                <div className="ic-body">
                    <div className="ic-avatar" aria-hidden="true">
                        {avatar ? <img src={avatar} alt="" /> : <span>忍</span>}
                    </div>
                    <p className="ic-text">
                        <strong>{c.fromName}</strong> challenged you to a <span className="ic-mode">{label}</span>!
                    </p>
                </div>

                <div className="ic-actions">
                    <button
                        ref={acceptRef}
                        type="button"
                        className="ic-accept"
                        disabled={busy}
                        onClick={() => onAccept(c)}
                        onKeyDown={(e) => {
                            // Focus lands here as the popup opens, so a held key or an
                            // Enter typed into chat as it arrived must not accept a fight.
                            if ((e.key === "Enter" || e.key === " ") && !noticeKeyCanDismiss(e, openedAtRef.current, performance.now())) e.preventDefault();
                        }}
                    >
                        {busy ? "Opening…" : "Accept"}
                    </button>
                    <button type="button" className="ic-decline" disabled={busy} onClick={() => onDecline(c)}>
                        {officialKage ? "Later" : "Decline"}
                    </button>
                </div>

                {officialKage && <p className="ic-more">Accept to fight for the seat. Choosing Later keeps your response clock active under the Town Hall rules; you can reopen this invitation there.</p>}
                {extra > 0 && (
                    <div className="ic-more">
                        +{extra} more challenge{extra === 1 ? "" : "s"} waiting
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
