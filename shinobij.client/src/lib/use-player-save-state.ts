import { useRef, useState } from 'react';
import { isReleaseSafeClientEvent } from "./release-safe-content";
import { normalizePendingTravel } from "./player-accounts";
import type { PendingTravelSave } from "./player-accounts";
import { normalizeInventory } from "./inventory";
import type { TileCard } from "../data/tile-cards";
import { normalizeJutsu } from "./jutsu";
import { rebalanceNonBloodlineJutsu, starterJutsus } from "../data/jutsu";
import { balanceExistingAiProfiles } from "./combat-ai";
import { type Biome } from "../types/core";
import { type Pet } from "../types/pet";
import { type Jutsu, type GameItem, type SavedBloodline, type ActiveTraining, type ActiveJutsuTraining } from "../types/combat";
import type { CreatorEvent } from "../types/vn";
import { type HollowGateEventConfig, type Character } from "../types/character";
import { type CreatorAi } from "../types/creator-ai";
import { type CreatorMission, type CreatorRaid } from "../types/missions";
import { mergeMissingBuiltInPets, petPool } from "./pet-roster";
import { defaultAncientChestVn, defaultPetEncounterVn } from "../data/default-vn-events";
import type { PlayerSavePayload, PlayerSaveSnapshot } from './player-save-types';
import { withSharedAdminItems } from './shared-admin-items';

export function isContentAdminName(raw: unknown): boolean {
    const name = String(raw ?? "").trim().toLowerCase();
    return name === "admin 1" || name === "admin 2" || name === "admin1" || name === "admin2";
}

export function savedJutsuPool(source: Partial<PlayerSavePayload>) {
    return [
        ...starterJutsus,
        ...(((source.creatorJutsus ?? []) as Jutsu[]).map(normalizeJutsu).map(rebalanceNonBloodlineJutsu)),
    ];
}

/** Own the non-character fields persisted in a player save. Native React setters
 * remain available to feature screens; restore operations never request a flush. */
export function usePlayerSaveState() {
    const [savedBloodlines, setSavedBloodlines] = useState<SavedBloodline[]>([]);
    const [currentBiome, setCurrentBiome] = useState<Biome>("central");
    const [activeTraining, setActiveTraining] = useState<ActiveTraining | null>(null);
    const [creatorJutsus, setCreatorJutsus] = useState<Jutsu[]>([]);
    const [creatorEvents, setCreatorEvents] = useState<CreatorEvent[]>([]);
    const [creatorItems, setCreatorItems] = useState<GameItem[]>([]);
    const [creatorAis, setCreatorAis] = useState<CreatorAi[]>([]);
    const [creatorMissions, setCreatorMissions] = useState<CreatorMission[]>([]);
    const [creatorRaids, setCreatorRaids] = useState<CreatorRaid[]>([]);
    const [creatorCards, setCreatorCards] = useState<TileCard[]>([]);
    const [petEncounterVn, setPetEncounterVn] = useState<CreatorEvent>(defaultPetEncounterVn);
    const [ancientChestVn, setAncientChestVn] = useState<CreatorEvent>(defaultAncientChestVn);
    const [editablePets, setEditablePets] = useState<Pet[]>(petPool);
    const [acceptedMissionIds, setAcceptedMissionIds] = useState<string[]>([]);
    const [missionProgress, setMissionProgress] = useState<Record<string, number>>({});
    const [activeJutsuTraining, setActiveJutsuTraining] = useState<ActiveJutsuTraining | null>(null);
    const [hollowGateEventConfig, setHollowGateEventConfig] = useState<HollowGateEventConfig | null>(null);
    const [currentSector, setCurrentSector] = useState(40);
    const [travelingUntil, setTravelingUntil] = useState(0);
    const [pendingTravel, setPendingTravel] = useState<PendingTravelSave | null>(null);
    const [triggeredEvents, setTriggeredEvents] = useState<string[]>([]);
    const lastSnapshotMissionSigRef = useRef<string | null>(null);

    function buildPlayerSavePayload(characterToSave: Character, overrides: Partial<{
        savedBloodlines: SavedBloodline[];
    }> = {}) {
        // Shared admin content (jutsu / AIs / events / cards / pet kits) is only
        // authored on the admin slots. For an ordinary player the server never
        // takes it from the save body — the ledger keeps the stored copy and the
        // admin slots are the source (api/save/_slim-player-save.ts) — so sending
        // it re-uploaded ~250 KB of dead weight on every autosave. In-memory state
        // still holds it (admin pull + device cache). creatorItems stays: it
        // carries the player's own forged gear.
        const sharedContent: Partial<{
            creatorJutsus: Jutsu[];
            creatorAis: CreatorAi[];
            creatorEvents: CreatorEvent[];
            creatorCards: TileCard[];
            editablePets: Pet[];
        }> = isContentAdminName(characterToSave.name)
            ? { creatorJutsus, creatorAis, creatorEvents, creatorCards, editablePets }
            : {};
        return {
            // Compact stackables into itemStacks before the server cap (save-side migration).
            character: normalizeInventory(characterToSave),
            currentBiome,
            activeTraining,
            activeJutsuTraining,
            acceptedMissionIds,
            missionProgress,
            triggeredEvents,
            currentSector,
            pendingTravel,
            savedBloodlines,
            ...sharedContent,
            creatorMissions,
            creatorRaids,
            creatorItems,
            petEncounterVn,
            ancientChestVn,
            hollowGateEventConfig,
            ...overrides,
        };
    }

    function applyProgressSnapshot(snap: PlayerSaveSnapshot, ports: { clearPendingAi: () => void; applySector: (sector: number) => void }): void {
        setCurrentBiome(snap.currentBiome ?? "central");
        setActiveTraining(snap.activeTraining ?? null);
        setActiveJutsuTraining(snap.activeJutsuTraining ?? null);
        setAcceptedMissionIds(snap.acceptedMissionIds ?? []);
        setMissionProgress(snap.missionProgress ?? {});
        setTriggeredEvents(snap.triggeredEvents ?? []);
        // Pre-cutover local Arena opponent ids are presentation authority,
        // not resumable combat proof. Never hydrate them into the reducer.
        ports.clearPendingAi();
        const snapPendingTravel = normalizePendingTravel((snap as Record<string, unknown>).pendingTravel);
        setPendingTravel(snapPendingTravel);
        setTravelingUntil(snapPendingTravel?.arrivalAt ?? 0);
        lastSnapshotMissionSigRef.current = JSON.stringify([snap.acceptedMissionIds ?? [], snap.missionProgress ?? {}, snap.triggeredEvents ?? [], snap.currentBiome ?? "central", snapPendingTravel]);
        ports.applySector(snap.currentSector ?? 40);
    }

    function applyContentSnapshot(snap: PlayerSaveSnapshot): void {
        if (snap.savedBloodlines) setSavedBloodlines(snap.savedBloodlines.map((bloodline: SavedBloodline) => ({ ...bloodline, jutsus: bloodline.jutsus.map(normalizeJutsu) })));
        if (snap.creatorJutsus) setCreatorJutsus(snap.creatorJutsus.map(normalizeJutsu));
        if (snap.creatorAis) setCreatorAis(balanceExistingAiProfiles(snap.creatorAis, savedJutsuPool(snap)));
        const contentAdmin = isContentAdminName(snap.character.name);
        if (snap.creatorEvents) setCreatorEvents(contentAdmin ? snap.creatorEvents : snap.creatorEvents.filter(isReleaseSafeClientEvent));
        setCreatorMissions(contentAdmin ? (snap.creatorMissions ?? []) : []);
        setCreatorRaids(contentAdmin ? (snap.creatorRaids ?? []) : []);
        if (snap.creatorCards) setCreatorCards(snap.creatorCards);
        // A slimmed save carries only the player's own items; keep the admin item
        // definitions already pulled this page so a mid-session refetch (409,
        // force reload) does not drop them until the next login.
        if (snap.creatorItems) setCreatorItems(contentAdmin ? snap.creatorItems : withSharedAdminItems(snap.creatorItems));
        if (snap.petEncounterVn) setPetEncounterVn(snap.petEncounterVn);
        if (snap.ancientChestVn) setAncientChestVn(snap.ancientChestVn);
        if (snap.editablePets) setEditablePets(mergeMissingBuiltInPets(snap.editablePets));
    }

    return {
        savedBloodlines, setSavedBloodlines,
        currentBiome, setCurrentBiome,
        activeTraining, setActiveTraining,
        creatorJutsus, setCreatorJutsus,
        creatorEvents, setCreatorEvents,
        creatorItems, setCreatorItems,
        creatorAis, setCreatorAis,
        creatorMissions, setCreatorMissions,
        creatorRaids, setCreatorRaids,
        creatorCards, setCreatorCards,
        petEncounterVn, setPetEncounterVn,
        ancientChestVn, setAncientChestVn,
        editablePets, setEditablePets,
        acceptedMissionIds, setAcceptedMissionIds,
        missionProgress, setMissionProgress,
        activeJutsuTraining, setActiveJutsuTraining,
        hollowGateEventConfig, setHollowGateEventConfig,
        currentSector, setCurrentSector,
        travelingUntil, setTravelingUntil,
        pendingTravel, setPendingTravel,
        triggeredEvents, setTriggeredEvents,
        lastSnapshotMissionSigRef, buildPlayerSavePayload, applyProgressSnapshot, applyContentSnapshot,
    };
}
