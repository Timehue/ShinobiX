import { useState } from "react";
import type { Pet } from "../types/pet";
import { petDisplayName } from "../lib/pet";
import { WARFRONT_LADDER_CELLS, moveWarfrontLadderPet, type WarfrontLadderPlan } from "../lib/pet-ladder-setup";

export function WarfrontLadderFormation({ pets, plan, onChange, disabled }: {
    pets: Array<Pet | undefined>;
    plan: WarfrontLadderPlan;
    onChange: (plan: WarfrontLadderPlan) => void;
    disabled?: boolean;
}) {
    const [selectedSlot, setSelectedSlot] = useState(0);
    return <div className="pl-setup">
        <h4>Sealed formation</h4>
        <p className="pl-sub">Choose a pet, then its starting cell. Front cells engage sooner; back cells protect ranged pets. Spread out to reduce splash damage, or keep allies close for support.</p>
        <div className="pl-formation-pets" role="group" aria-label="Pet to position">
            {Array.from({ length: 4 }, (_, slot) => <button key={slot} type="button"
                className={`pl-btn${selectedSlot === slot ? " pl-btn-gold" : ""}`}
                aria-pressed={selectedSlot === slot} disabled={disabled || !pets[slot]}
                onClick={() => setSelectedSlot(slot)}>
                {slot + 1}. {pets[slot] ? petDisplayName(pets[slot]) : "Pick a pet"}
            </button>)}
        </div>
        <div className="pl-formation-head" aria-hidden="true"><span>Back</span><span>Front → rival</span></div>
        <div className="pl-formation-board" role="group" aria-label="Warfront starting positions">
            {WARFRONT_LADDER_CELLS.map((cell) => {
                const slot = plan.deployment.indexOf(cell.id);
                const pet = pets[slot];
                return <button key={cell.id} type="button"
                    className={`pl-formation-cell${slot === selectedSlot ? " selected" : ""}${pet ? " occupied" : ""}`}
                    disabled={disabled || !pets[selectedSlot]}
                    aria-label={`${cell.rank} file ${cell.file}${pet ? `, ${petDisplayName(pet)}` : ", empty"}`}
                    aria-pressed={slot === selectedSlot}
                    onClick={() => onChange(moveWarfrontLadderPet(plan, selectedSlot, cell.id))}>
                    <small>{cell.rank} {cell.file}</small>
                    <span>{pet ? `${slot + 1}. ${petDisplayName(pet)}` : "Empty"}</span>
                </button>;
            })}
        </div>
        <p className="pl-sub">This formation holds through every clash, for both attacks and offline defense. Selecting an occupied cell swaps the two pets. Save your defense to lock changes.</p>
    </div>;
}
