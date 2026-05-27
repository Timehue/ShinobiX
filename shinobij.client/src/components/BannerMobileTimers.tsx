/*
 * Mobile banner timer widget.
 *
 * Shown in the top-right corner of the journey banner on xs/sm screens
 * only — desktop already has the left profile card for this information.
 * Displays the current UTC time plus any in-flight stat training,
 * jutsu training, pet training, or pet expedition timer.
 *
 * Pure leaf — takes all data via props, calls useSharedNow to subscribe
 * to the global tick so the countdown updates without local timers.
 *
 * Extracted from App.tsx.
 */

import { useSharedNow, petTrainingOptions } from "../App";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import type { Pet } from "../types/pet";
import { formatPetTimer } from "../lib/utils";
import { petDisplayName } from "../lib/pet";
import { memo, type ReactNode } from "react";

// React.memo wraps the function so unrelated App re-renders don't repaint
// the mobile banner — the only scheduled refresh is the every-second
// useSharedNow tick. `activeTraining`, `activeJutsuTraining`, and `pets`
// are passed by reference and replaced immutably from App, so shallow
// compare still catches every real change.
export const BannerMobileTimers = memo(function BannerMobileTimers({
    activeTraining,
    activeJutsuTraining,
    pets,
}: {
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
    pets: Pet[];
}) {
    useSharedNow(); // sync to global timer so desktop timers match mobile

    const t = new Date();
    const utcTime = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} UTC`;

    const timerRows: ReactNode[] = [];
    if (activeTraining && Date.now() < activeTraining.endsAt) {
        timerRows.push(
            <div key="stat" className="bmt-row">
                <span className="bmt-icon">💪</span>
                <span className="bmt-label">{activeTraining.label}</span>
                <span className="bmt-value">{formatPetTimer(activeTraining.endsAt - Date.now())}</span>
            </div>,
        );
    }
    if (activeJutsuTraining && Date.now() < activeJutsuTraining.endsAt) {
        timerRows.push(
            <div key="jutsu" className="bmt-row">
                <span className="bmt-icon">🌀</span>
                <span className="bmt-label">{activeJutsuTraining.label}</span>
                <span className="bmt-value">{formatPetTimer(activeJutsuTraining.endsAt - Date.now())}</span>
            </div>,
        );
    }
    for (const pet of pets) {
        if (pet.training && Date.now() < pet.training.endsAt) {
            const label = petTrainingOptions.find(o => o.type === pet.training!.type)?.label ?? pet.training.type;
            timerRows.push(
                <div key={`pt-${pet.id}`} className="bmt-row">
                    <span className="bmt-icon">🐾</span>
                    <span className="bmt-label">{petDisplayName(pet)} · {label}</span>
                    <span className="bmt-value">{formatPetTimer(pet.training!.endsAt - Date.now())}</span>
                </div>,
            );
        }
        if (pet.expedition && Date.now() < pet.expedition.endsAt) {
            timerRows.push(
                <div key={`pe-${pet.id}`} className="bmt-row">
                    <span className="bmt-icon">🗺️</span>
                    <span className="bmt-label">{petDisplayName(pet)} · Exp</span>
                    <span className="bmt-value">{formatPetTimer(pet.expedition!.endsAt - Date.now())}</span>
                </div>,
            );
        } else if (pet.expedition && Date.now() >= pet.expedition.endsAt) {
            timerRows.push(
                <div key={`pe-${pet.id}`} className="bmt-row">
                    <span className="bmt-icon">🎁</span>
                    <span className="bmt-label">{petDisplayName(pet)} · Exp</span>
                    <span className="bmt-value" style={{ color: "#4ade80" }}>Ready!</span>
                </div>,
            );
        }
    }

    return (
        <div className="banner-mobile-timers">
            <div className="bmt-clock">🕐 {utcTime}</div>
            {timerRows.length > 0 && <div className="bmt-timers">{timerRows}</div>}
        </div>
    );
});
