import { useState } from "react";
import type { Character } from "../types/character";
import type { VillageState } from "../lib/world-state";

export function LogbookCareerRecord({ character, village }: { character: Character; village: VillageState }) {
    const [observedAt] = useState(() => Date.now());
    const ownKageTerms = (village.kageHistory ?? []).filter((term) => term.name.toLowerCase() === character.name.toLowerCase());
    const currentKage = village.seatedKage?.toLowerCase() === character.name.toLowerCase();
    const currentAnbu = [...village.anbuAppointees, ...(village.anbuEarned ?? []), ...(village.anbuMembers ?? [])]
        .some((name) => name.toLowerCase() === character.name.toLowerCase());
    const currentElderSeat = village.elderTerm && village.elderTerm.nextSelectionAt > observedAt
        ? village.elderAppointees.findIndex((name) => name.toLowerCase() === character.name.toLowerCase()) : -1;
    return <section className="summary-box mission-board-section" aria-label="Career record">
        <h3>Career Record</h3>
        <p><strong>Rank:</strong> {character.rankTitle} · Level {character.level}</p>
        {character.profession && <p><strong>Profession:</strong> {character.profession}{character.professionRank != null ? ` · Rank ${character.professionRank}` : ""}</p>}
        {character.legacy && <p><strong>Legacy:</strong> Stage {character.legacy.stage} · World Era {character.legacy.eraBorn ?? "unrecorded"}</p>}
        {ownKageTerms.length > 0 && <p><strong>Kage service:</strong> {ownKageTerms.length} recorded {ownKageTerms.length === 1 ? "term" : "terms"}{currentKage ? " · currently seated" : ""}</p>}
        {currentKage && ownKageTerms.length === 0 && <p><strong>Kage service:</strong> Currently seated</p>}
        {currentAnbu && <p><strong>ANBU service:</strong> Current village operative</p>}
        {currentElderSeat >= 0 && <p><strong>Elder service:</strong> Current council seat {currentElderSeat + 1}</p>}
        {!character.legacy && ownKageTerms.length === 0 && !currentKage && <p className="hint">Leadership and Legacy milestones appear here when recorded.</p>}
    </section>;
}
