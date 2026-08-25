import { SHOWDOWN_DAILY_WIN_CAP } from "../../../shared/pet-showdown-contract";
import { petPvpGearById } from "../data/pet-config";
import { openPetArenaView, openPetColosseum } from "../lib/pet-arena-navigation";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    canEnterTacticalArena,
    colosseumPetBusyReason,
    isPetAvailableForWarfront,
    petDisplayName,
    warfrontPetBusyReason,
} from "../lib/pet";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { serverNow } from "../lib/server-clock";
import type { Screen } from "../types/core";
import type { Pet } from "../types/pet";
import { GameIcon } from "./icons/GameIcon";
import "../styles/pet-battle-readiness.css";

type PetBattleReadinessProps = {
    pet: Pet;
    combatEligiblePets: readonly Pet[];
    dailyPetWins: number;
    totalPetWins: number;
    breedingPetIds: ReadonlySet<string>;
    isOverflow: boolean;
    setScreen: (screen: Screen) => void;
};

function colosseumBlocker(pet: Pet, breedingPetIds: ReadonlySet<string>, now: number): string | null {
    switch (colosseumPetBusyReason(pet, breedingPetIds, now)) {
        case "expedition": return "On expedition";
        case "training": return "Training in progress";
        case "breeding": return "Committed to the Breeding Barn";
        default: return null;
    }
}

type WarfrontBlocker = { status: string; action: string };

function warfrontBlocker(
    pet: Pet,
    isOverflow: boolean,
    breedingPetIds: ReadonlySet<string>,
    now: number,
): WarfrontBlocker | null {
    if (isOverflow) return { status: "Resting in Sanctuary", action: "Move to carried roster" };
    switch (warfrontPetBusyReason(pet, breedingPetIds)) {
        case "breeding":
            return { status: "Committed to the Breeding Barn", action: "Breeding in progress" };
        case "training":
            return pet.training && now >= pet.training.endsAt
                ? { status: "Training results unclaimed", action: "Collect training results" }
                : { status: "Training in progress", action: "Training in progress" };
        case "expedition":
            return pet.expedition && now >= pet.expedition.endsAt
                ? { status: "Expedition results unclaimed", action: "Collect expedition results" }
                : { status: "On expedition", action: "Expedition in progress" };
        default:
            return null;
    }
}

function PetCircuitStatus({ ready, children }: { ready: boolean; children: React.ReactNode }) {
    return (
        <span className="pet-circuit-status" data-ready={ready}>
            {ready ? "Deployment ready" : "Deployment locked"} · {children}
        </span>
    );
}

export function PetBattleReadiness({
    pet,
    combatEligiblePets,
    dailyPetWins,
    totalPetWins,
    breedingPetIds,
    isOverflow,
    setScreen,
}: PetBattleReadinessProps) {
    const now = serverNow();
    const name = petDisplayName(pet);
    const derivedRole = derivePetRole(pet);
    const role = pet.role ?? derivedRole.role;
    const subRole = pet.subRole ?? derivedRole.subRole;
    const roleMeta = ROLE_META[role];
    const selectedColosseumBlocker = isOverflow
        ? "Resting in Sanctuary"
        : colosseumBlocker(pet, breedingPetIds, now);
    const selectedWarfrontBlocker = warfrontBlocker(pet, isOverflow, breedingPetIds, now);
    const selectedTacticalReady = !selectedWarfrontBlocker;
    const colosseumReadyPets = combatEligiblePets.filter((candidate) => !colosseumBlocker(candidate, breedingPetIds, now));
    const tacticalReadyPets = combatEligiblePets.filter((candidate) => isPetAvailableForWarfront(candidate, breedingPetIds));
    const tacticalUnlocked = canEnterTacticalArena(combatEligiblePets, breedingPetIds);
    const paidWinsLeft = Math.max(0, SHOWDOWN_DAILY_WIN_CAP - dailyPetWins);
    const pvpGear = petPvpGearById(pet.loadout?.pvp);
    return (
        <section className="pet-battle-readiness" aria-labelledby="pet-battle-readiness-title">
            <header className="pet-battle-readiness-heading">
                <div>
                    <span className="pet-battle-readiness-kicker">{name} · Lv {pet.level} · {roleMeta.icon} {roleMeta.label}</span>
                    <h4 id="pet-battle-readiness-title">Battle Deployment</h4>
                </div>
            </header>

            <div className="pet-circuit-grid">
                <article className="pet-circuit-card" data-circuit="colosseum">
                    <div className="pet-circuit-card-heading">
                        <span className="pet-circuit-icon"><GameIcon name="medal" size={22} /></span>
                        <span><small>Player-commanded combat</small><strong>Pet Colosseum</strong></span>
                    </div>
                    <PetCircuitStatus ready={!selectedColosseumBlocker}>
                        {selectedColosseumBlocker ?? `${name} can take the field`}
                    </PetCircuitStatus>
                    <p className="pet-circuit-summary">
                        <b>{colosseumReadyPets.length} ready</b><span>1v1 / 2v2 / 3v3 · {pvpGear?.name ?? "No PvP gear"}</span>
                        <b>{paidWinsLeft}/{SHOWDOWN_DAILY_WIN_CAP} paid</b><span>{totalPetWins.toLocaleString()} victories</span>
                    </p>
                    <button
                        type="button"
                        className="pet-home-primary"
                        disabled={Boolean(selectedColosseumBlocker)}
                        onClick={() => openPetColosseum(pet.id, setScreen)}
                    >
                        {selectedColosseumBlocker ? selectedColosseumBlocker : `Deploy ${name}`} <span aria-hidden="true">→</span>
                    </button>
                </article>

                <article className="pet-circuit-card" data-circuit="warfront">
                    <div className="pet-circuit-card-heading">
                        <span className="pet-circuit-icon"><GameIcon name="shield" size={22} /></span>
                        <span><small>Squad-command combat · 4v4</small><strong>Hollow Warfront</strong></span>
                    </div>
                    <PetCircuitStatus ready={selectedTacticalReady && tacticalUnlocked}>
                        {selectedWarfrontBlocker
                            ? selectedWarfrontBlocker.status
                            : tacticalUnlocked ? `${name} is slotted first` : `${tacticalReadyPets.length}/${TACTICAL_ARENA_PET_REQUIREMENT} companions ready`}
                    </PetCircuitStatus>
                    <p className="pet-circuit-summary">
                        <b>{tacticalReadyPets.length}/{TACTICAL_ARENA_PET_REQUIREMENT} ready</b><span>suggested squad</span>
                        <b>{roleMeta.label}</b><span>{subRole} directive</span>
                    </p>
                    <button
                        type="button"
                        className="pet-home-primary"
                        disabled={!selectedTacticalReady || !tacticalUnlocked}
                        onClick={() => openPetArenaView("tactical", setScreen, pet.id)}
                    >
                        {selectedWarfrontBlocker
                            ? selectedWarfrontBlocker.action
                            : tacticalUnlocked ? `Add ${name} to Squad` : `Need ${TACTICAL_ARENA_PET_REQUIREMENT - tacticalReadyPets.length} More Ready`} <span aria-hidden="true">→</span>
                    </button>
                </article>
            </div>
        </section>
    );
}
