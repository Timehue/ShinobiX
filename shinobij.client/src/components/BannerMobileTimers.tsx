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
import { serverNow } from "../lib/server-clock";
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
    onOpenExpedition,
}: {
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
    pets: Pet[];
    onOpenExpedition?: (petId: string) => void;
}) {
    useSharedNow(); // sync to global timer so desktop timers match mobile

    const now = serverNow();
    const t = new Date();
    const utcTime = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} UTC`;

    const timerRows: ReactNode[] = [];
    if (activeTraining) {
        const trainingReady = now >= activeTraining.endsAt;
        timerRows.push(
            <div key="stat" className="bmt-row">
                <span className="bmt-icon">💪</span>
                <span className="bmt-label">{activeTraining.label}</span>
                <span className="bmt-value" style={trainingReady ? { color: "var(--green-400)" } : undefined}>
                    {trainingReady ? "Ready" : formatPetTimer(activeTraining.endsAt - now)}
                </span>
            </div>,
        );
    }
    if (activeJutsuTraining) {
        const jutsuTrainingReady = now >= activeJutsuTraining.endsAt;
        timerRows.push(
            <div key="jutsu" className="bmt-row">
                <span className="bmt-icon">🌀</span>
                <span className="bmt-label">{activeJutsuTraining.label}</span>
                <span className="bmt-value" style={jutsuTrainingReady ? { color: "var(--green-400)" } : undefined}>
                    {jutsuTrainingReady ? "Ready" : formatPetTimer(activeJutsuTraining.endsAt - now)}
                </span>
            </div>,
        );
    }
    for (const pet of pets) {
        if (pet.training) {
            const petTrainingReady = now >= pet.training.endsAt;
            const label = petTrainingOptions.find(o => o.type === pet.training!.type)?.label ?? pet.training.type;
            timerRows.push(
                <div key={`pt-${pet.id}`} className="bmt-row">
                    <span className="bmt-icon">🐾</span>
                    <span className="bmt-label">{petDisplayName(pet)} · {label}</span>
                    <span className="bmt-value" style={petTrainingReady ? { color: "var(--green-400)" } : undefined}>
                        {petTrainingReady ? "Ready" : formatPetTimer(pet.training.endsAt - now)}
                    </span>
                </div>,
            );
        }
        if (pet.expedition && now < pet.expedition.endsAt) {
            timerRows.push(
                <button type="button" key={`pe-${pet.id}`} className="bmt-row bmt-row-link" onClick={() => onOpenExpedition?.(pet.id)} disabled={!onOpenExpedition}>
                    <span className="bmt-icon">🗺️</span>
                    <span className="bmt-label">{petDisplayName(pet)} · Exp</span>
                    <span className="bmt-value">{formatPetTimer(pet.expedition.endsAt - now)}</span>
                </button>,
            );
        } else if (pet.expedition) {
            timerRows.push(
                <button type="button" key={`pe-${pet.id}`} className="bmt-row bmt-row-link" onClick={() => onOpenExpedition?.(pet.id)} disabled={!onOpenExpedition}>
                    <span className="bmt-icon">🎁</span>
                    <span className="bmt-label">{petDisplayName(pet)} · Exp</span>
                    <span className="bmt-value" style={{ color: "var(--green-400)" }}>Ready!</span>
                </button>,
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
