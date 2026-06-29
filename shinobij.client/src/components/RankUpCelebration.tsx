/*
 * RankUpCelebration (PX-3) — a brief, earned "you advanced a ninja rank" moment.
 *
 * The redesign makes ranking up a real power spike (the per-rank combat stat cap
 * lifts — see lib/rank-progression), but the spike was silent. This surfaces it:
 * when the player crosses a rank band (Academy→Genin→Chunin→Jonin→Special Jonin)
 * it shows a one-shot overlay naming the new rank and the cap that just opened up.
 *
 * Detection is localStorage-diff, NOT a render-time ref, so it's robust to the
 * host card unmounting (e.g. during a full-screen battle): the celebration fires
 * the next time this component mounts with a rank higher than the last one
 * celebrated. On a device's FIRST load the current rank is seeded silently, so
 * existing players never get a spurious celebration on the deploy.
 *
 * Hosted by LeftProfileCard (always mounted, has `character`); portals to <body>
 * so it shows full-screen on desktop AND mobile without touching App.tsx's line
 * budget — same pattern as DailyBriefingModal. Cosmetic only; never touches the
 * save, balance, or shown stats. Disable with localStorage rankUpFx.v1 = "0".
 */
/* eslint-disable react-hooks/set-state-in-effect -- the detection effect syncs
   with an external store (localStorage) and only calls setState on a genuine
   rank increase, not on every render. */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import { MAX_STAT } from "../constants/game";
import { isLowEndMobile } from "../lib/device-tier";
import { RANK_BANDS, rankBandIndexForLevel, rankBandForLevel, type RankBand } from "../lib/rank-progression";
import "./RankUpCelebration.css";

const CELEBRATED_KEY = "rankUp.celebrated.v1";
const FX_FLAG_KEY = "rankUpFx.v1";
const AUTO_DISMISS_MS = 8000;

function celebrationEnabled(): boolean {
    try { return window.localStorage?.getItem(FX_FLAG_KEY) !== "0"; } catch { return true; }
}

function readStoredIndex(): number | null {
    try {
        const raw = window.localStorage?.getItem(CELEBRATED_KEY);
        if (raw == null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch { return null; }
}

function writeStoredIndex(idx: number): void {
    try { window.localStorage?.setItem(CELEBRATED_KEY, String(idx)); } catch { /* private mode — skip */ }
}

export function RankUpCelebration({ character }: { character: Character }) {
    const [band, setBand] = useState<RankBand | null>(null);

    useEffect(() => {
        const idx = rankBandIndexForLevel(character.level);
        const stored = readStoredIndex();
        if (stored === null) {
            // First load on this device — seed silently, never celebrate retroactively.
            writeStoredIndex(idx);
            return;
        }
        if (idx === stored) return;
        writeStoredIndex(idx);
        // Only a rank *increase* is a celebration (de-levels just resync the marker).
        if (idx > stored && celebrationEnabled()) setBand(rankBandForLevel(character.level));
    }, [character.level]);

    useEffect(() => {
        if (!band) return;
        const t = setTimeout(() => setBand(null), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [band]);

    if (!band) return null;

    const prevRank = band.index > 0 ? RANK_BANDS[band.index - 1].rank : null;
    const uncapped = band.statCap >= MAX_STAT;
    const lite = isLowEndMobile();

    return createPortal(
        <div className={`rankup-backdrop${lite ? " rankup-lite" : ""}`} role="dialog" aria-modal="true" aria-label={`Rank up: ${band.rank}`} onClick={() => setBand(null)}>
            <div className="rankup-rays" aria-hidden="true" />
            <div className="rankup-card" onClick={(e) => e.stopPropagation()}>
                <div className="rankup-kicker">Rank Up</div>
                <div className="rankup-emblem" aria-hidden="true">昇</div>
                {prevRank && <div className="rankup-from">{prevRank} →</div>}
                <h2 className="rankup-rank">{band.rank}</h2>
                <p className="rankup-cap">
                    {uncapped
                        ? "Your full stats now apply in combat — no rank cap."
                        : <>Combat stat cap raised to <strong>{band.statCap.toLocaleString()}</strong></>}
                </p>
                <button type="button" className="rankup-continue" onClick={() => setBand(null)} autoFocus>Continue</button>
            </div>
        </div>,
        document.body,
    );
}
