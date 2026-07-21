import { createPortal } from "react-dom";
import type { HuntChoice, HuntOpening, HuntSign } from "../lib/hunt-encounter";
import "./HuntEncounterCard.css";

/**
 * The beat between tracking and the kill.
 *
 * Hunting used to be a bare button that advanced a counter and cut straight to
 * the Arena — no reason, no read, and the beast's painted portrait never left
 * the contract board. This card carries both: the sign you found and the choice
 * of how to work it while tracking, then the beast itself when it breaks cover.
 *
 * Portaled to <body> like the other centre-screen modals — the fixed side rails
 * (right-menu 999999, left-profile 10000) paint over anything rendered in-tree.
 */
export type HuntEncounterView =
    | { kind: "track"; sign: HuntSign }
    | { kind: "confront"; opening: HuntOpening };

export function HuntEncounterCard({
    view,
    beastName,
    beastRank,
    portrait,
    icon,
    sector,
    regionName,
    trailStep,
    trailTotal,
    description,
    onChoose,
    onEngage,
    onClose,
}: {
    view: HuntEncounterView;
    beastName: string;
    beastRank: string;
    /** Bundled beast art. Falls back to the AI's emoji when absent. */
    portrait?: string;
    icon: string;
    sector: number;
    regionName: string;
    trailStep: number;
    trailTotal: number;
    description: string;
    onChoose: (choice: HuntChoice) => void;
    onEngage: () => void;
    onClose: () => void;
}) {
    const confronting = view.kind === "confront";
    const tierClass = confronting ? ` he-card--${view.opening.tier}` : "";

    return createPortal(
        <div className="he-backdrop" role="presentation">
            <div
                className={`he-card${tierClass}`}
                role="dialog"
                aria-modal="true"
                aria-label={confronting ? `${beastName} breaks cover` : "Hunt trail"}
            >
                <div className="he-head">
                    <div className="he-portrait" aria-hidden="true">
                        {portrait
                            ? <img src={portrait} alt="" />
                            : <span className="he-portrait-icon">{icon}</span>}
                    </div>
                    <div className="he-ident">
                        <div className="he-kicker">
                            {confronting ? view.opening.kicker : view.sign.kicker}
                        </div>
                        <h3 className="he-name">{beastName}</h3>
                        <div className="he-meta">
                            <span className="he-rank">{beastRank}</span>
                            <span className="he-dot" aria-hidden="true">·</span>
                            <span>{regionName}, Sector {sector}</span>
                        </div>
                    </div>
                </div>

                <p className="he-prose">
                    {confronting ? view.opening.prose : view.sign.prose}
                </p>

                {confronting
                    ? (
                        <>
                            <p className="he-contract">{description}</p>
                            <div className={`he-opening he-opening--${view.opening.tier}`}>
                                {view.opening.effect}
                            </div>
                            <div className="he-actions">
                                <button type="button" className="he-engage" onClick={onEngage}>
                                    Close in
                                </button>
                                <button type="button" className="he-back" onClick={onClose}>
                                    Back off
                                </button>
                            </div>
                        </>
                    )
                    : (
                        <>
                            <div className="he-trail">
                                Trail {trailStep} / {trailTotal}
                            </div>
                            <div className="he-choices">
                                {view.sign.choices.map((choice) => (
                                    <button
                                        key={choice.id}
                                        type="button"
                                        className="he-choice"
                                        onClick={() => onChoose(choice)}
                                    >
                                        <span className="he-choice-label">{choice.label}</span>
                                        <span className="he-choice-detail">{choice.detail}</span>
                                        {choice.risk && (
                                            <span className="he-choice-risk">⚠ {choice.risk}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                            <button type="button" className="he-back he-back--wide" onClick={onClose}>
                                Leave the trail for now
                            </button>
                        </>
                    )}
            </div>
        </div>,
        document.body,
    );
}
