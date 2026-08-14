/*
 * LegacyMoment — the ceremonial full-screen beat for Legacy trials: a trial
 * BEGINNING (the Sage's charge over the torii trial grounds) and a STAGE-UP
 * (badge, aura, granted title). Replaces the native alert()s the depth audit
 * flagged ("the second-most prestigious moment in the system landed as an OS
 * dialog box"). Controlled by the caller — no localStorage diffing — and
 * portaled to <body>, reusing the RankUpCelebration visual chrome so the
 * game's big moments share one language.
 */
import { type ChronicleRecordReceipt, type LegacyRarity } from "../lib/legacy";
import { Modal } from "./ui/Modal";
import "./RankUpCelebration.css";

const STAGE_ROMAN = ["", "I", "II", "III", "IV", "V"];

export type LegacyMomentData =
    | {
        mode: "trial-start";
        kindName: string;
        legacyName: string;
        rarity: LegacyRarity;
        text: string;
        /** Optional wayfinding line (e.g. where to track the trial). */
        hint?: string;
        /** The in-world trial-giver speaking the charge. Post-acceptance this
         *  is the player's category emissary (the actual trial overseer);
         *  omitted at acceptance, when the Wandering Sage himself speaks. */
        speaker?: { name: string; portrait: string };
        /** Server-confirmed Chronicle grant, announced without mutating cards. */
        chronicleRecord?: ChronicleRecordReceipt;
    }
    | {
        mode: "stage-up";
        stage: number;
        stageName: string;
        legacyName: string;
        rarity: LegacyRarity;
        badge: string | null;
        grantedTitle: string | null;
        text: string;
        /** Server-confirmed Chronicle grant, announced without mutating cards. */
        chronicleRecord?: ChronicleRecordReceipt;
    };

function ChronicleRecordNotice({ receipt }: { receipt?: ChronicleRecordReceipt }) {
    if (!receipt) return null;
    return (
        <section
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{ margin: "12px 0 0", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(240,196,99,.52)", background: "rgba(240,196,99,.09)", textAlign: "left" }}
        >
            <h3 style={{ margin: 0, color: "var(--gold)", fontSize: ".78rem", letterSpacing: ".04em" }}>
                {receipt.heading}
            </h3>
            <p style={{ margin: "4px 0 0", color: "var(--slate-200)", fontSize: ".74rem", lineHeight: 1.45 }}>
                {receipt.message}
            </p>
        </section>
    );
}

export function LegacyMoment({
    moment,
    onClose,
    dismissible = true,
}: {
    moment: LegacyMomentData;
    onClose: () => void;
    /** Optional ceremonies may close with Escape/backdrop; required beats use only their explicit action. */
    dismissible?: boolean;
}) {
    // Rank is owner-only — every legacy ceremony uses the same legacy accent.
    const color = "var(--purple-400)";
    return (
        <Modal
            open
            onClose={onClose}
            bare
            size="md"
            ariaLabel={moment.mode === "trial-start" ? `Trial begins: ${moment.kindName}` : `Legacy stage up: ${moment.stageName}`}
            disableBackdropClose={!dismissible}
            disableEscapeClose={!dismissible}
            backdropClassName={`rankup-backdrop${dismissible ? "" : " legacy-moment-required"}`}
            backdropDecoration={(
                <>
                    {moment.mode === "trial-start" && (
                        <img
                            src="/scenes/legacy-trial.png" alt=""
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.28, pointerEvents: "none" }}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                    )}
                    <div className="rankup-rays" aria-hidden="true" />
                </>
            )}
            className="rankup-card legacy-moment-card"
        >
            <div className="legacy-moment-content">
                {moment.mode === "trial-start" ? (
                    <>
                        <div className="rankup-kicker" style={{ color }}>A Trial Begins</div>
                        {moment.speaker && (
                            <span
                                style={{ width: 72, height: 72, borderRadius: "50%", display: "inline-block", margin: "4px auto", border: `2px solid ${color}88`, overflow: "hidden" }}
                            >
                                <img
                                    src={moment.speaker.portrait} alt=""
                                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                                />
                            </span>
                        )}
                        <h2 className="rankup-rank" style={{ fontSize: "1.35rem" }}>{moment.kindName}</h2>
                        <p style={{ fontSize: ".82rem", color: "var(--slate-300)", margin: "4px 0 2px", fontWeight: 700 }}>{moment.legacyName}</p>
                        <p style={{ fontSize: ".8rem", color: "var(--slate-200)", fontStyle: "italic", lineHeight: 1.5, margin: "10px 0 4px" }}>
                            “{moment.text}”
                        </p>
                        <p style={{ fontSize: ".72rem", color: "#9aa3b2", margin: "2px 0 0" }}>— {moment.speaker?.name ?? "the Wandering Sage"}</p>
                        {moment.hint && (
                            <p style={{ fontSize: ".74rem", color: "#c4b5fd", margin: "10px 0 0" }}>{moment.hint}</p>
                        )}
                        <ChronicleRecordNotice receipt={moment.chronicleRecord} />
                        <button type="button" className="rankup-continue" onClick={onClose}>Face It</button>
                    </>
                ) : (
                    <>
                        <div className="rankup-kicker" style={{ color }}>Stage {STAGE_ROMAN[moment.stage] ?? moment.stage}</div>
                        {moment.badge && (
                            <span
                                className={moment.stage >= 2 ? `legacy-aura-s${Math.min(5, moment.stage)}` : undefined}
                                style={{ width: 88, height: 88, borderRadius: 12, display: "inline-block", margin: "6px auto" }}
                            >
                                <img
                                    src={`/badges/legacy-${moment.badge}.png`} alt=""
                                    style={{ width: "100%", height: "100%", borderRadius: 12, display: "block" }}
                                    onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                                />
                            </span>
                        )}
                        <h2 className="rankup-rank" style={{ fontSize: "1.3rem", color }}>{moment.stageName}</h2>
                        <p style={{ fontSize: ".82rem", color: "var(--slate-300)", margin: "2px 0 0", fontWeight: 700 }}>{moment.legacyName}</p>
                        {moment.grantedTitle && (
                            <p style={{ margin: "10px 0 0" }}>
                                <span style={{
                                    padding: "3px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700,
                                    color: "#0b1020", background: color,
                                }}>« {moment.grantedTitle} »</span>
                            </p>
                        )}
                        <p style={{ fontSize: ".79rem", color: "var(--slate-200)", fontStyle: "italic", lineHeight: 1.5, margin: "12px 0 0" }}>
                            “{moment.text}”
                        </p>
                        <ChronicleRecordNotice receipt={moment.chronicleRecord} />
                        <button type="button" className="rankup-continue" onClick={onClose}>Continue</button>
                    </>
                )}
            </div>
        </Modal>
    );
}
