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
    updateCharacter: (c: Character) => void;
    currentSector: number;
    setScreen: (s: Screen) => void;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
}) {
    useSharedNow(); // sync to global timer so mobile timers match desktop

    return (
        <aside className="left-profile-card">
            <div className="left-profile-avatar-wrap">
                <button
                    className={`left-profile-avatar ${getActiveAuraSphereBonuses(character).avatarAura ? "aura-sphere-avatar" : ""}`}
                    onClick={() => setScreen("profile")}
                    title="View character profile"
                >
                    {character.avatarImage ? (
                        <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                        character.name.slice(0, 2).toUpperCase()
                    )}
                </button>
            </div>

            <div className="left-profile-name">{character.name}</div>
            <div className="left-profile-rank">{character.rankTitle}</div>
            <div className="left-profile-stat">HP {character.hp}/{character.maxHp}</div>
            <div className="left-profile-stat">Chakra {character.chakra}/{character.maxChakra}</div>
            <div className="left-profile-stat">Stamina {character.stamina}/{character.maxStamina}</div>
            <div className="left-profile-stat">Sector {currentSector}</div>
            <div className="left-profile-stat">Weather Clear Skies</div>

            {/* Currencies */}
            <div className="left-currencies">
                <div className="left-currency-row">
                    <span className="left-currency-icon">💰</span>
                    <span className="left-currency-label">Ryo</span>
                    <span className="left-currency-value">{character.ryo.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🏅</span>
                    <span className="left-currency-label">Honor Seals</span>
                    <span className="left-currency-value" style={{ color: "#facc15" }}>{character.honorSeals.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">✨</span>
                    <span className="left-currency-label">Aura Dust</span>
                    <span className="left-currency-value" style={{ color: "#fef3c7" }}>{character.auraDust.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🔮</span>
                    <span className="left-currency-label">Fate Shards</span>
                    <span className="left-currency-value" style={{ color: "#ce93d8" }}>{character.fateShards.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🔷</span>
                    <span className="left-currency-label">Aura Stones</span>
                    <span className="left-currency-value" style={{ color: "#60a5fa" }}>{character.auraStones.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🔱</span>
                    <span className="left-currency-label">Mythic Seals</span>
                    <span className="left-currency-value" style={{ color: "#fde047" }}>{character.mythicSeals.toLocaleString()}</span>
                </div>
                <div className="left-currency-row">
                    <span className="left-currency-icon">🦴</span>
                    <span className="left-currency-label">Bone Charms</span>
                    <span className="left-currency-value" style={{ color: "#94a3b8" }}>{character.boneCharms.toLocaleString()}</span>
                </div>
            </div>

            {/* Daily caps */}
            <div className="left-daily-caps">
                <div className="left-caps-grid">
                    <div className="left-caps-cell">
                        <span className="left-caps-label">🗺️ Tiles</span>
                        <span className="left-caps-value" style={{ color: (character.dailyTilesExplored ?? 0) >= 150 ? "#ef4444" : "#86efac" }}>{character.dailyTilesExplored ?? 0}/150</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label">📜 Missions</span>
                        <span className="left-caps-value" style={{ color: dailyMissionsCompleted(character) >= DAILY_MISSION_LIMIT ? "#ef4444" : "#fcd34d" }}>{dailyMissionsCompleted(character)}/{DAILY_MISSION_LIMIT}</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label">🎯 Hunts</span>
                        <span className="left-caps-value" style={{ color: dailyHuntsCompleted(character) >= DAILY_HUNT_LIMIT ? "#ef4444" : "#fcd34d" }}>{dailyHuntsCompleted(character)}/{DAILY_HUNT_LIMIT}</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label">🎰 Fate Spins</span>
                        <span className="left-caps-value" style={{ color: (character.dailyFateSpins ?? 0) >= 5 ? "#ef4444" : "#a5b4fc" }}>{character.dailyFateSpins ?? 0}/5</span>
                    </div>
                    <div className="left-caps-cell">
                        <span className="left-caps-label">⏰ Reset In</span>
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
                                <span className="left-timer-icon">💪</span>
                                <span className="left-timer-label">{activeTraining.label}</span>
                                <span className="left-timer-value">{formatPetTimer(activeTraining.endsAt - Date.now())}</span>
                            </div>
                        </div>
                    )}
                    {activeJutsuTraining && Date.now() < activeJutsuTraining.endsAt && (
                        <div className="left-timer-bar">
                            <div className="left-timer-row">
                                <span className="left-timer-icon">🌀</span>
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
                                        <span className="left-timer-icon">🐾</span>
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
                                        <span className="left-timer-icon">🗺️</span>
                                        <span className="left-timer-label">{petDisplayName(pet)} · Expedition</span>
                                        <span className="left-timer-value">{formatPetTimer(pet.expedition!.endsAt - Date.now())}</span>
                                    </div>
                                </div>,
                            );
                        } else if (pet.expedition && Date.now() >= pet.expedition.endsAt) {
                            rows.push(
                                <div key={`pe-${pet.id}`} className="left-timer-bar">
                                    <div className="left-timer-row">
                                        <span className="left-timer-icon">🎁</span>
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
