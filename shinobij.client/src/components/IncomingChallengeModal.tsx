import { createPortal } from "react-dom";
import type { DuelChallenge } from "../App";
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
    const pending = challenges.filter(
        (c) => !c.accepted && !c.declined && !c.sectorAttack && c.toName.toLowerCase() === meLower,
    );
    if (!pending.length) return null;

    const c = pending[0];
    const busy = processingIds.includes(c.id);
    const label = challengeLabel(c.mode);
    const avatar =
        typeof c.challenger?.avatarImage === "string" && c.challenger.avatarImage.trim()
            ? c.challenger.avatarImage
            : "";
    const extra = pending.length - 1;

    return createPortal(
        <div className="ic-backdrop" role="presentation">
            <div className="ic-card" role="alertdialog" aria-modal="true" aria-label="Incoming challenge">
                <div className="ic-glyph" aria-hidden="true">⚔️</div>
                <div className="ic-kicker">Challenge</div>

                <div className="ic-body">
                    <div className="ic-avatar" aria-hidden="true">
                        {avatar ? <img src={avatar} alt="" /> : <span>忍</span>}
                    </div>
                    <p className="ic-text">
                        <strong>{c.fromName}</strong> challenged you to a <span className="ic-mode">{label}</span>!
                    </p>
                </div>

                <div className="ic-actions">
                    <button type="button" className="ic-accept" disabled={busy} onClick={() => onAccept(c)}>
                        {busy ? "Opening…" : "Accept"}
                    </button>
                    <button type="button" className="ic-decline" disabled={busy} onClick={() => onDecline(c)}>
                        Decline
                    </button>
                </div>

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
