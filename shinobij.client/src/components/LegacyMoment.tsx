/*
 * LegacyMoment — the ceremonial full-screen beat for Legacy trials: a trial
 * BEGINNING (the Sage's charge over the torii trial grounds) and a STAGE-UP
 * (badge, aura, granted title). Replaces the native alert()s the depth audit
 * flagged ("the second-most prestigious moment in the system landed as an OS
 * dialog box"). Controlled by the caller — no localStorage diffing — and
 * portaled to <body>, reusing the RankUpCelebration visual chrome so the
 * game's big moments share one language.
 */
import { createPortal } from "react-dom";
import { RARITY_COLORS, type LegacyRarity } from "../lib/legacy";
import "./RankUpCelebration.css";

const STAGE_ROMAN = ["", "I", "II", "III", "IV", "V"];

export type LegacyMomentData =
    | {
        mode: "trial-start";
        kindName: string;
        legacyName: string;
        rarity: LegacyRarity;
        text: string;
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
    };

export function LegacyMoment({ moment, onClose }: { moment: LegacyMomentData; onClose: () => void }) {
    const color = RARITY_COLORS[moment.rarity];
    return createPortal(
        <div
            className="rankup-backdrop"
            role="dialog" aria-modal="true"
            aria-label={moment.mode === "trial-start" ? `Trial begins: ${moment.kindName}` : `Legacy stage up: ${moment.stageName}`}
            onClick={onClose}
        >
            {moment.mode === "trial-start" && (
                <img
                    src="/scenes/legacy-trial.png" alt=""
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.28, pointerEvents: "none" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
            )}
            <div className="rankup-rays" aria-hidden="true" />
            <div className="rankup-card" onClick={(e) => e.stopPropagation()} style={{ borderColor: `${color}88` }}>
                {moment.mode === "trial-start" ? (
                    <>
                        <div className="rankup-kicker" style={{ color }}>A Trial Begins</div>
                        <h2 className="rankup-rank" style={{ fontSize: "1.35rem" }}>{moment.kindName}</h2>
                        <p style={{ fontSize: ".82rem", color: "#cbd5e1", margin: "4px 0 2px", fontWeight: 700 }}>{moment.legacyName}</p>
                        <p style={{ fontSize: ".8rem", color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.5, margin: "10px 0 4px" }}>
                            “{moment.text}”
                        </p>
                        <p style={{ fontSize: ".68rem", color: "#9aa3b2", margin: "2px 0 0" }}>— the Wandering Sage</p>
                        <button type="button" className="rankup-continue" onClick={onClose} autoFocus>Face It</button>
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
                        <p style={{ fontSize: ".82rem", color: "#cbd5e1", margin: "2px 0 0", fontWeight: 700 }}>{moment.legacyName}</p>
                        {moment.grantedTitle && (
                            <p style={{ margin: "10px 0 0" }}>
                                <span style={{
                                    padding: "3px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700,
                                    color: "#0b1020", background: color,
                                }}>« {moment.grantedTitle} »</span>
                            </p>
                        )}
                        <p style={{ fontSize: ".79rem", color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.5, margin: "12px 0 0" }}>
                            “{moment.text}”
                        </p>
                        <button type="button" className="rankup-continue" onClick={onClose} autoFocus>Continue</button>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}
