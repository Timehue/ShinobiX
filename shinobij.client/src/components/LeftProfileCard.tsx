/*
 * Desktop left-rail profile card — avatar + name/rank + HP/Chakra/Stamina
 * + currency bar + daily caps + XP bar + in-flight timers.
 *
 * Subscribes to the shared "now" ticker (useSharedNow) so the timer rows
 * update every second without local intervals. Most game-state helpers
 * arrive via "../App" re-exports.
 *
 * Pure leaf — props give it character + sector + active training; it
 * only reads them, never mutates closure state.
 *
 * Extracted from App.tsx.
 */

import { memo, type ReactNode } from "react";
import {
    useSharedNow,
    petTrainingOptions,
    getActiveAuraSphereBonuses,
    dailyMissionsCompleted,
    dailyHuntsCompleted,
    xpNeeded,
    gainXp,
} from "../App";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import { DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT, MAX_LEVEL } from "../constants/game";
import { formatPetTimer } from "../lib/utils";
import { petDisplayName } from "../lib/pet";
import { GameIcon } from "./icons/GameIcon";
import type { GameIconName } from "./icons/GameIcon";
import { DailyBriefingModal } from "./DailyBriefingModal";
import { RankUpCelebration } from "./RankUpCelebration";
import { PatchNotesModal } from "./PatchNotesModal";
import { RankBadge } from "./RankBadge";
import { NextGoalPin } from "./NextGoalPin";

// Wrapped in React.memo so the every-second useSharedNow re-render is the
// ONLY scheduled refresh — parent (App) state churn no longer triggers a
// repaint of the left rail when the props are referentially unchanged.
// `character`, `activeTraining`, `activeJutsuTraining` are all replaced
// immutably from App so the shallow prop compare still catches real
// changes (hp swap, training start/end, sector hop, etc).
export const LeftProfileCard = memo(function LeftProfileCard({
    character,
    updateCharacter,
    currentSector,
    setScreen,
    activeTraining,
    activeJutsuTraining,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    currentSector: number;
    setScreen: (s: Screen) => void;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
}) {
    useSharedNow(); // sync to global timer so mobile timers match desktop

    return (
        <aside className="left-profile-card">
            {/* Daily Briefing — once-per-day login notice board. Self-gating
                (level 5+, once per UTC day) and portal-rendered to <body>, so it
                appears full-screen on desktop AND mobile even though this host
                card is CSS-hidden on mobile. Hosted here (rather than App.tsx)
                because this card already receives character + both training
                timers, keeping App.tsx within its line budget. */}
            <DailyBriefingModal
                character={character}
                updateCharacter={updateCharacter}
                navigate={setScreen}
                activeTraining={activeTraining}
                activeJutsuTraining={activeJutsuTraining}
            />
            {/* Global progression overlays — both portal to <body>, so they show
                full-screen on desktop AND mobile even though this host card is
                CSS-hidden on mobile. Hosted here (not App.tsx) to stay within the
                App.tsx line budget, same pattern as DailyBriefingModal above. */}
            <RankUpCelebration character={character} />
            <PatchNotesModal character={character} />
            <div className="left-profile-avatar-wrap">
                <button
                    className={`left-profile-avatar ${getActiveAuraSphereBonuses(character).avatarAura ? "aura-sphere-avatar" : ""}`}
                    onClick={() => setScreen("profile")}
                    title="View character profile"
                >
                    {character.avatarImage ? (
                        <img src={character.avatarImage} alt={`Character avatar for ${character.name}`} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                        character.name.slice(0, 2).toUpperCase()
                    )}
                </button>
            </div>

            <div className="left-profile-name">{character.name}</div>
            <div className="left-profile-rank">{character.rankTitle}</div>
            {((character.rankedWins ?? 0) + (character.rankedLosses ?? 0)) > 0 && (
                <div className="left-profile-rank" style={{ marginTop: 2 }}>
                    <RankBadge rating={character.rankedRating ?? 1000} showRating size="xs" />
                </div>
            )}
            <div className="left-profile-stat">HP {character.hp}/{character.maxHp}</div>
            <div className="left-profile-stat">Chakra {character.chakra}/{character.maxChakra}</div>
            <div className="left-profile-stat">Stamina {character.stamina}/{character.maxStamina}</div>
            <div className="left-profile-stat">Sector {currentSector}</div>
            <div className="left-profile-stat">Weather Clear Skies</div>

            {/* Currencies — icons from the GameIcon SVG set (themeable, no emoji) */}
            <div className="left-currencies">
                {([
                    { icon: "ryo",     iconColor: "#f4c95d", label: "Ryo",          value: character.ryo },
                    { icon: "medal",   iconColor: "#facc15", label: "Honor Seals",  value: character.honorSeals,  valueColor: "#facc15" },
                    { icon: "sparkle", iconColor: "#fcd34d", label: "Aura Dust",    value: character.auraDust,    valueColor: "#fef3c7" },
                    { icon: "shard",   iconColor: "#ce93d8", label: "Fate Shards",  value: character.fateShards,  valueColor: "#ce93d8" },
                    { icon: "crystal", iconColor: "#60a5fa", label: "Aura Stones",  value: character.auraStones,  valueColor: "#60a5fa" },
                    { icon: "sigil",   iconColor: "#fde047", label: "Mythic Seals", value: character.mythicSeals, valueColor: "#fde047" },
                    { icon: "bone",    iconColor: "#cbd5e1", label: "Bone Charms",  value: character.boneCharms,  valueColor: "#94a3b8" },
                ] as { icon: GameIconName; iconColor: string; label: string; value: number; valueColor?: string }[]).map((c) => (
                    <div className="left-currency-row" key={c.label}>
                        <span className="left-currency-icon">
                            <GameIcon name={c.icon} size={14} style={{ color: c.iconColor, display: "block", margin: "0 auto" }} />
                        </span>
                        <span className="left-currency-label">{c.label}</span>
                        <span className="left-currency-value" style={c.valueColor ? { color: c.valueColor } : undefined}>{c.value.toLocaleString()}</span>
                    </div>
                ))}
            </div>

            {/* Daily caps */}
            <div className="left-daily-caps">
                <div className="left-caps-grid">
                    <div className="left-caps-cell">
                        <span className="left-caps-label"><GameIcon name="map" size={10} style={{ verticalAlign: "-2px", marginRight: 3, color: "#86efac" }} />Tiles</span>
                        <span className="left-caps-value" style={{ color: (character.dailyTilesExplored ?? 0) >= 150 ? "#ef4444" : "#86efac" }}>{character.dailyTilesExplored ?? 0}/150</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label"><GameIcon name="scroll" size={10} style={{ verticalAlign: "-2px", marginRight: 3, color: "#fcd34d" }} />Missions</span>
                        <span className="left-caps-value" style={{ color: dailyMissionsCompleted(character) >= DAILY_MISSION_LIMIT ? "#ef4444" : "#fcd34d" }}>{dailyMissionsCompleted(character)}/{DAILY_MISSION_LIMIT}</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label"><GameIcon name="target" size={10} style={{ verticalAlign: "-2px", marginRight: 3, color: "#fcd34d" }} />Hunts</span>
                        <span className="left-caps-value" style={{ color: dailyHuntsCompleted(character) >= DAILY_HUNT_LIMIT ? "#ef4444" : "#fcd34d" }}>{dailyHuntsCompleted(character)}/{DAILY_HUNT_LIMIT}</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label"><GameIcon name="dice" size={10} style={{ verticalAlign: "-2px", marginRight: 3, color: "#a5b4fc" }} />Fate Spins</span>
                        <span className="left-caps-value" style={{ color: (character.dailyFateSpins ?? 0) >= 5 ? "#ef4444" : "#a5b4fc" }}>{character.dailyFateSpins ?? 0}/5</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label"><GameIcon name="clock" size={10} style={{ verticalAlign: "-2px", marginRight: 3, color: "#94a3b8" }} />Reset In</span>
                        <span className="left-caps-value" style={{ color: "#94a3b8" }}>{(() => { const now = new Date(); const ms = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).getTime() - now.getTime(); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; })()}</span>
                    </div>
                </div>
            </div>

            {/* XP bar */}
            <div className="left-xp-section">
                {character.level >= MAX_LEVEL ? (
                    <div className="left-xp-label">Lv {character.level} — MAX</div>
                ) : (
                    <>
                        <div className="left-xp-label">
                            Lv {character.level} &nbsp;·&nbsp; {character.xp} / {xpNeeded(character.level)} XP
                        </div>
                        <div className="left-xp-bar-track">
                            <div
                                className="left-xp-bar-fill"
                                style={{ width: `${Math.min(100, Math.round((character.xp / xpNeeded(character.level)) * 100))}%` }}
                            />
                        </div>
                        {character.xp >= xpNeeded(character.level) && (
                            <button
                                className="left-levelup-btn"
                                onClick={() => updateCharacter(gainXp(character, 0))}
                            >
                                ⬆️ Level Up!
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* "What's next" breadcrumb, tucked under the XP bar (desktop rail).
                The full hub-top banner is CSS-hidden on desktop so this is the only
                copy there; mobile (no left rail) still gets the hub-top banner. */}
            <NextGoalPin character={character} navigate={setScreen} compact />

            {/* Active training timers */}
            {((activeTraining && Date.now() < activeTraining.endsAt) ||
              (activeJutsuTraining && Date.now() < activeJutsuTraining.endsAt) ||
              (character.pets ?? []).some(
                  (p) => (p.training && Date.now() < p.training.endsAt) ||
                         (p.expedition)
              )) && (
                <div className="left-active-timers">
                    {activeTraining && Date.now() < activeTraining.endsAt && (
                        <div className="left-timer-bar">
                            <div className="left-timer-row">
                                <span className="left-timer-icon"><GameIcon name="dumbbell" size={13} style={{ display: "block", color: "#f87171" }} /></span>
                                <span className="left-timer-label">{activeTraining.label}</span>
                                <span className="left-timer-value">{formatPetTimer(activeTraining.endsAt - Date.now())}</span>
                            </div>
                        </div>
                    )}
                    {activeJutsuTraining && Date.now() < activeJutsuTraining.endsAt && (
                        <div className="left-timer-bar">
                            <div className="left-timer-row">
                                <span className="left-timer-icon"><GameIcon name="chakra" size={13} style={{ display: "block", color: "#67e8f9" }} /></span>
                                <span className="left-timer-label">{activeJutsuTraining.label}</span>
                                <span className="left-timer-value">{formatPetTimer(activeJutsuTraining.endsAt - Date.now())}</span>
                            </div>
                        </div>
                    )}
                    {(character.pets ?? []).map((pet) => {
                        const rows: ReactNode[] = [];
                        if (pet.training && Date.now() < pet.training.endsAt) {
                            const label = petTrainingOptions.find((o) => o.type === pet.training!.type)?.label ?? pet.training.type;
                            rows.push(
                                <div key={`pt-${pet.id}`} className="left-timer-bar">
                                    <div className="left-timer-row">
                                        <span className="left-timer-icon"><GameIcon name="paw" size={13} style={{ display: "block", color: "#6ee7b7" }} /></span>
                                        <span className="left-timer-label">{petDisplayName(pet)} · {label}</span>
                                        <span className="left-timer-value">{formatPetTimer(pet.training!.endsAt - Date.now())}</span>
                                    </div>
                                </div>,
                            );
                        }
                        if (pet.expedition && Date.now() < pet.expedition.endsAt) {
                            rows.push(
                                <div key={`pe-${pet.id}`} className="left-timer-bar">
                                    <div className="left-timer-row">
                                        <span className="left-timer-icon"><GameIcon name="map" size={13} style={{ display: "block", color: "#93c5fd" }} /></span>
                                        <span className="left-timer-label">{petDisplayName(pet)} · Expedition</span>
                                        <span className="left-timer-value">{formatPetTimer(pet.expedition!.endsAt - Date.now())}</span>
                                    </div>
                                </div>,
                            );
                        } else if (pet.expedition && Date.now() >= pet.expedition.endsAt) {
                            rows.push(
                                <div key={`pe-${pet.id}`} className="left-timer-bar">
                                    <div className="left-timer-row">
                                        <span className="left-timer-icon"><GameIcon name="gift" size={13} style={{ display: "block", color: "#4ade80" }} /></span>
                                        <span className="left-timer-label">{petDisplayName(pet)} · Expedition</span>
                                        <span className="left-timer-value" style={{ color: "#4ade80" }}>Ready!</span>
                                    </div>
                                </div>,
                            );
                        }
                        return rows;
                    })}
                </div>
            )}
        </aside>
    );
});
