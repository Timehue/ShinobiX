import { SHOWDOWN_DAILY_WIN_CAP } from "../../../shared/pet-showdown-contract";
import { petConsumableById, petPvpGearById } from "../data/pet-config";
import { openPetArenaView, openPetColosseum } from "../lib/pet-arena-navigation";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    canEnterTacticalArena,
    colosseumPetBusyReason,
    isPetAvailableForWarfront,
    petDisplayName,
    pickArenaTeam,
    warfrontPetBusyReason,
} from "../lib/pet";
import { derivePetRole, ROLE_BEATS, ROLE_META, type PetRole } from "../lib/pet-roles";
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

const WARFRONT_ROLES: PetRole[] = ["defender", "tracker", "assassin", "sage"];

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
            <i aria-hidden="true" /> {ready ? "Deployment ready" : "Deployment locked"} · {children}
        </span>
    );
}

function DataRow({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
    return (
        <div className="pet-deployment-data-row">
            <span>{label}</span>
            <strong>{value}</strong>
            {detail ? <small>{detail}</small> : null}
        </div>
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
    const counteredRole = ROLE_META[ROLE_BEATS[role]];
    const vulnerableRoleId = WARFRONT_ROLES.find((candidate) => ROLE_BEATS[candidate] === role) ?? role;
    const vulnerableRole = ROLE_META[vulnerableRoleId];
    const selectedColosseumBlocker = isOverflow
        ? "Resting in Sanctuary"
        : colosseumBlocker(pet, breedingPetIds, now);
    const selectedWarfrontBlocker = warfrontBlocker(pet, isOverflow, breedingPetIds, now);
    const selectedTacticalReady = !selectedWarfrontBlocker;
    const colosseumReadyPets = combatEligiblePets.filter((candidate) => !colosseumBlocker(candidate, breedingPetIds, now));
    const tacticalReadyPets = combatEligiblePets.filter((candidate) => isPetAvailableForWarfront(candidate, breedingPetIds));
    const tacticalUnlocked = canEnterTacticalArena(combatEligiblePets, breedingPetIds);
    const deploymentTeam = pickArenaTeam(combatEligiblePets, TACTICAL_ARENA_PET_REQUIREMENT, pet.id, breedingPetIds);
    const deploymentRoles = new Set(deploymentTeam.map((candidate) => candidate.role ?? derivePetRole(candidate).role));
    const paidWinsLeft = Math.max(0, SHOWDOWN_DAILY_WIN_CAP - dailyPetWins);
    const pvpGear = petPvpGearById(pet.loadout?.pvp);
    const consumable = petConsumableById(pet.loadout?.consumable);

    return (
        <section className="pet-battle-readiness" aria-labelledby="pet-battle-readiness-title">
            <header className="pet-battle-readiness-heading">
                <div>
                    <span className="pet-battle-readiness-kicker">Selected companion · live routing</span>
                    <h4 id="pet-battle-readiness-title">Battle Deployment</h4>
                </div>
                <span className="pet-deployment-signal"><i aria-hidden="true" /> Systems linked</span>
            </header>

            <div className="pet-deployment-profile">
                <span className="pet-native-role" style={{ "--pet-role-color": roleMeta.color } as React.CSSProperties}>
                    {roleMeta.icon} {roleMeta.label}<small>{subRole}</small>
                </span>
                <div>
                    <small>Deploying</small>
                    <strong>{name}</strong>
                    <span>Lv {pet.level}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : " · Neutral"}</span>
                </div>
            </div>

            <div className="pet-deployment-kit" aria-label={`${name} battle loadout`}>
                <div data-equipped={Boolean(pvpGear)}>
                    <span>PvP gear</span>
                    <strong>{pvpGear?.name ?? "No gear equipped"}</strong>
                    <small>{pvpGear?.desc ?? "Base stats only"}</small>
                </div>
                <div data-equipped={Boolean(consumable)}>
                    <span>Battle support</span>
                    <strong>{consumable?.name ?? "No consumable"}</strong>
                    <small>{consumable?.desc ?? "No one-use trigger armed"}</small>
                </div>
            </div>

            <div className="pet-circuit-grid">
                <article className="pet-circuit-card" data-circuit="colosseum">
                    <div className="pet-circuit-card-heading">
                        <span className="pet-circuit-icon"><GameIcon name="medal" size={22} /></span>
                        <span><small>Player-commanded combat</small><strong>Pet Colosseum</strong></span>
                    </div>
                    <PetCircuitStatus ready={!selectedColosseumBlocker}>
                        {selectedColosseumBlocker ?? `${name} can take the field`}
                    </PetCircuitStatus>
                    <div className="pet-deployment-data">
                        <DataRow
                            label="Available formats"
                            value={(
                                <span className="pet-circuit-formats" aria-label={`${colosseumReadyPets.length} Colosseum-ready companions`}>
                                    {[1, 2, 3].map((size) => <i key={size} data-ready={colosseumReadyPets.length >= size}>{size}v{size}</i>)}
                                </span>
                            )}
                        />
                        <DataRow label="Daily purse" value={`${paidWinsLeft}/${SHOWDOWN_DAILY_WIN_CAP} wins left`} detail="Paid victories reset daily" />
                        <DataRow label="Chronicle record" value={`${totalPetWins.toLocaleString()} victories`} />
                    </div>
                    <button
                        type="button"
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
                    <div className="pet-deployment-data">
                        <DataRow label="Native directive" value={`${roleMeta.label} · ${subRole}`} />
                        <DataRow label="Counter edge" value={`Strong vs ${counteredRole.label}`} detail={`Vulnerable to ${vulnerableRole.label}`} />
                        <DataRow
                            label="Suggested squad"
                            value={`${Math.min(tacticalReadyPets.length, TACTICAL_ARENA_PET_REQUIREMENT)}/${TACTICAL_ARENA_PET_REQUIREMENT} fielded`}
                            detail={`${deploymentRoles.size}/4 native roles covered`}
                        />
                    </div>
                    <div className="pet-warfront-role-coverage" aria-label={`${deploymentRoles.size} of 4 Warfront roles covered`}>
                        {WARFRONT_ROLES.map((candidate) => {
                            const meta = ROLE_META[candidate];
                            return <span key={candidate} data-covered={deploymentRoles.has(candidate)}>{meta.icon}<small>{meta.label}</small></span>;
                        })}
                    </div>
                    <button
                        type="button"
                        disabled={!selectedTacticalReady || !tacticalUnlocked}
                        onClick={() => openPetArenaView("tactical", setScreen, pet.id)}
                    >
                        {selectedWarfrontBlocker
                            ? selectedWarfrontBlocker.action
                            : tacticalUnlocked ? `Add ${name} to Squad` : `Need ${TACTICAL_ARENA_PET_REQUIREMENT - tacticalReadyPets.length} More Ready`} <span aria-hidden="true">→</span>
                    </button>
                </article>
            </div>

            <p className="pet-battle-readiness-note">
                Your selection carries into the destination. Colosseum commands stay in the bout; formation, doctrine, and War Council policy stay in Warfront setup.
            </p>
        </section>
    );
}
