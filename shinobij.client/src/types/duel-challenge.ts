/*
 * The client-side PvP/pet-duel challenge shape (inbox entries, arena/warfront
 * challenges, ranked tokens).
 *
 * Drained verbatim from App.tsx (which sits at its line-budget ceiling).
 * App.tsx re-exports this so external `import … from "../App"` sites
 * (IncomingChallengeModal, Arena, ArenaDistrictLobby, BattleArenaLobby,
 * player-api, duel-challenge lib) keep resolving identically.
 */

import type { Character } from "./character";
import type { Jutsu } from "./combat";
import type { Pet } from "./pet";
import type { WarfrontChallengePlan } from "../lib/arena-challenge";

export type DuelChallenge = {
    id: string;
    fromName: string;
    toName: string;
    challenger: Character;
    challengerJutsus?: Jutsu[];
    challengerBloodlineMult?: number;
    challengerPetId?: string; // which pet the challenger is using for pet battles
    petBattleSeed?: number;
    responderPetId?: string;
    responderPet?: Pet;
    // ── 2v2 Pet Party extensions ──────────────────────────────────────
    // When set, the pet battle resolves as a 2-pet party set (lead + reserve)
    // via runPetArenaParty. Both fields are optional so old 1v1 challenges
    // remain valid. The responder's two pets are auto-selected at accept
    // time (top two by level) — no protocol change needed for them.
    petParty?: boolean;
    challengerPetIds?: [string, string];
    responderPetIds?: [string, string];
    responderParty?: [Pet, Pet];
    // Tactical Arena PvP challenge — deterministic teams + seed; see lib/arena-challenge.
    arenaMatch?: boolean;
    arenaSize?: 2 | 4;
    challengerTeamIds?: string[];
    responderTeam?: Pet[];
    challengerWarfrontPlan?: WarfrontChallengePlan;
    responderWarfrontPlan?: WarfrontChallengePlan;
    createdAt: number;
    mode?: "standard" | "ranked" | "clanWar1v1" | "clanWar2v2" | "clanWarPet" | "rankedPet";
    // Exact player-ranked queue capability. All three fields are server-minted,
    // preserved through the challenge inbox, and required by session creation.
    rankedMatchId?: string;
    rankedSeasonId?: number;
    rankedSeasonEpoch?: number;
    clanWarPoints?: number;
    // Pet ranked 1v1 — each side's account-level petRankedRating snapshot at
    // challenge time, so the winner/loser can compute symmetric Elo deltas
    // without an extra round-trip. challengerPetRating = the challenge sender.
    challengerPetRating?: number;
    responderPetRating?: number;
    // Server-minted pet-ranked match token (/api/pet/ranked-start). Minted by
    // the challenger and carried to both sides (rides the accepted-notice
    // spread) so the petRankedRating swing settles server-side exactly once
    // (server NX-dedups per token). Absent → local Elo fallback.
    petRankedToken?: string;
    sectorAttack?: boolean; // true = initiated from world-map sector, auto-routes defender
    kageChallengeId?: string;
    kageVillage?: string;
    battleId?: string;     // if set, both players join a shared PvP session instead of separate arenas
    accepted?: boolean;    // true = defender accepted spar/ranked, routes original challenger to pvpBattle as p1
    declined?: boolean;
};
