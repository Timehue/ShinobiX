import type { Character } from "../types/character";
import type { VillageState } from "../lib/world-state";
import { useSharedNow } from "../lib/use-shared-now";
import { CAREER_MILESTONES, hasCareerExam } from "../../../shared/career-milestones";

export function LogbookCareerRecord({ character, village, onOpenAchievements }: { character: Character; village: VillageState; onOpenAchievements?: () => void }) {
    const observedAt = useSharedNow();
    const ownKageTerms = (village.kageHistory ?? []).filter((term) => term.name.toLowerCase() === character.name.toLowerCase());
    const currentKage = village.seatedKage?.toLowerCase() === character.name.toLowerCase();
    const currentAnbu = [...village.anbuAppointees, ...(village.anbuEarned ?? []), ...(village.anbuMembers ?? [])]
        .some((name) => name.toLowerCase() === character.name.toLowerCase());
    const currentElderSeat = village.elderTerm && village.elderTerm.nextSelectionAt > observedAt
        ? village.elderAppointees.findIndex((name) => name.toLowerCase() === character.name.toLowerCase()) : -1;
    const distinctions = CAREER_MILESTONES.filter((milestone) => hasCareerExam(character.examsPassed, milestone.examKey)
        || character.unlockedAchievements?.includes(milestone.id));
    return <section className="summary-box mission-board-section logbook-career-record" aria-label="Career record">
        <h3>Career Record</h3>
        <p><strong>{character.name}</strong> · {character.village}</p>
        <p><strong>Rank:</strong> {character.rankTitle} · Level {character.level}</p>
        {distinctions.length > 0 && <p><strong>Career distinctions:</strong> {distinctions.map((milestone) => milestone.name).join(" · ")}</p>}
        {character.profession && <p><strong>Profession:</strong> {character.profession}{character.professionRank != null ? ` · Rank ${character.professionRank}` : ""}</p>}
        {character.legacy && <p><strong>Legacy:</strong> Stage {character.legacy.stage} · World Era {character.legacy.eraBorn ?? "unrecorded"}</p>}
        {ownKageTerms.length > 0 && <p><strong>Kage service:</strong> {ownKageTerms.length} recorded {ownKageTerms.length === 1 ? "term" : "terms"}{currentKage ? " · currently seated" : ""}</p>}
        {currentKage && ownKageTerms.length === 0 && <p><strong>Kage service:</strong> Currently seated</p>}
        {currentAnbu && <p><strong>ANBU service:</strong> Current village operative</p>}
        {currentElderSeat >= 0 && <p><strong>Elder service:</strong> Current council seat {currentElderSeat + 1}</p>}
        <p className="hint">Your full achievement collection and Nindō live on your shinobi profile.</p>
        {onOpenAchievements && <button onClick={onOpenAchievements}>View achievements</button>}
    </section>;
}
