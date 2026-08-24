/*
 * Professions screen — the single destination of the right-menu Professions
 * button. It routes by state:
 *
 *   • No profession chosen yet → <ProfessionOverview>: a description + layout of
 *     all three paths (Healer / Vanguard / Pet Tamer) so the player can read up
 *     before the Elder's choice. The initial choice happens in the forced
 *     ProfessionPicker overlay (fires at Level 13); this screen also owns the
 *     approval-gated path-change control after a choice is made.
 *   • Profession chosen → the matching hub (HealerHub / VanguardHub /
 *     PetTamerHub), which the menu button also relabels to.
 *
 * Lazy-loaded by App.tsx; the three hubs ride in this chunk.
 */
import overviewBg from "../assets/professions/overview.webp";
import healerBg from "../assets/professions/healer.webp";
import vanguardBg from "../assets/professions/vanguard.webp";
import petTamerBg from "../assets/professions/pettamer.webp";
import { useState } from "react";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { gameConfirm } from "../components/GameAlert";
import { PROFESSION_INFO } from "../data/professions";
import { HealerHub } from "./professions/HealerHub";
import { VanguardHub } from "./professions/VanguardHub";
import { PetTamerHub } from "./professions/PetTamerHub";
import type { Character, PlayerRecord, Profession, Screen } from "../App";
import type { VersionedCharacterCommit } from "../types/character";
import { GameIcon, type GameIconName } from "../components/icons/GameIcon";
import { countItem } from "../lib/inventory";
import {
    PROFESSION_CHANGE_APPROVAL_COST,
    PROFESSION_CHANGE_APPROVAL_ID,
    PROFESSION_CHANGE_APPROVAL_NAME,
} from "../../../shared/profession-change";

// Mirrors api/profession/choose.ts PROFESSION_UNLOCK_LEVEL.
const PROFESSION_UNLOCK_LEVEL = 13;

const CARD_IMAGE: Record<Profession, string> = {
    healer: healerBg,
    vanguard: vanguardBg,
    petTamer: petTamerBg,
};

const PROFESSION_ICON: Record<Profession, GameIconName> = {
    healer: "hp",
    vanguard: "sword",
    petTamer: "paw",
};

function ProfessionRespecPanel({
    character,
    onVersionedCharacter,
    onOpenMarketplace,
}: {
    character: Character;
    onVersionedCharacter: VersionedCharacterCommit;
    onOpenMarketplace: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const current = PROFESSION_INFO.find(info => info.id === character.profession);
    if (!current) return null;
    const currentName = current.name;
    const approvalCount = countItem(character, PROFESSION_CHANGE_APPROVAL_ID);
    const hasApproval = approvalCount > 0;

    const choices = PROFESSION_INFO.filter(info => info.id !== character.profession);

    async function changeProfession(next: Profession) {
        if (busy) return;
        const nextInfo = PROFESSION_INFO.find(info => info.id === next);
        if (!nextInfo) return;
        const confirmed = await gameConfirm(
            `Change from ${currentName} to ${nextInfo.name}? This consumes 1 ${PROFESSION_CHANGE_APPROVAL_NAME} and resets profession rank, XP, and mastery allocation to Rank 1.`,
            { title: "Use Profession Approval", confirmLabel: `Become ${nextInfo.name}`, danger: true },
        );
        if (!confirmed) return;

        setBusy(true);
        setError("");
        try {
            const response = await fetch("/api/profession/choose", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, profession: next, respec: true }),
            });
            const data = await response.json().catch(() => ({})) as { error?: string; character?: Character; _saveVersion?: number };
            if (!response.ok || !data.character) {
                setError(data.error ?? `Server error (${response.status})`);
                return;
            }
            onVersionedCharacter(data.character, data._saveVersion);
        } catch {
            setError("Network error. Your profession was not changed; try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="card profession-respec-panel" aria-labelledby="profession-change-heading" style={{ marginTop: "1rem" }}>
            <h3 id="profession-change-heading">Profession Path Change</h3>
            <div className="profession-approval-summary">
                <img src="/items/item-territory-control-scroll-v1.webp" alt="A sealed paper profession approval" />
                <div>
                    <strong>{PROFESSION_CHANGE_APPROVAL_NAME}</strong>
                    <span>{hasApproval ? `${approvalCount} ready to use` : "Required to change paths"}</span>
                    <small>Grand Marketplace · {PROFESSION_CHANGE_APPROVAL_COST} Fate Shards</small>
                </div>
            </div>
            <p className="hint">Each path change consumes one approval and resets profession rank, profession XP, and mastery allocation to Rank 1. Your normal character progress and other inventory stay intact.</p>
            <div className="menu profession-change-actions">
                {choices.map(info => (
                    <button key={info.id} type="button" disabled={busy || !hasApproval} onClick={() => void changeProfession(info.id)}>
                        {busy ? "Changing…" : `Change to ${info.name}`}
                    </button>
                ))}
                {!hasApproval && <button type="button" onClick={onOpenMarketplace}>Visit Grand Marketplace</button>}
            </div>
            {error && <p role="alert" style={{ color: "#f87171" }}>{error}</p>}
        </section>
    );
}

export function Professions({
    character,
    updateCharacter,
    setScreen,
    onBack,
    playerRoster,
    onVersionedCharacter,
    onServerVersion,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    setScreen: (s: Screen) => void;
    onBack: () => void;
    playerRoster: PlayerRecord[];
    onVersionedCharacter: VersionedCharacterCommit;
    onServerVersion: (version: unknown) => boolean;
}) {
    let hub: React.ReactNode = null;
    if (character.profession === "healer") {
        hub = <HealerHub character={character} updateCharacter={updateCharacter} setScreen={setScreen} onBack={onBack} playerRoster={playerRoster} onServerVersion={onServerVersion} onVersionedCharacter={onVersionedCharacter} />;
    } else if (character.profession === "vanguard") {
        hub = <VanguardHub character={character} onVersionedCharacter={onVersionedCharacter} setScreen={setScreen} onBack={onBack} />;
    } else if (character.profession === "petTamer") {
        hub = <PetTamerHub character={character} onVersionedCharacter={onVersionedCharacter} setScreen={setScreen} onBack={onBack} />;
    }
    if (hub) {
        return <div className={`profession-screen profession-screen-${character.profession}`}>{hub}<ProfessionRespecPanel character={character} onVersionedCharacter={onVersionedCharacter} onOpenMarketplace={() => setScreen("grandMarketplace")} /></div>;
    }

    // No profession yet → the three-path overview.
    const eligible = character.level >= PROFESSION_UNLOCK_LEVEL;

    return (
        <div className="card profession-overview">
            <BackToVillageButton onClick={onBack} label="← Back" />

            <div
                className="profession-overview-hero"
                style={{
                    position: "relative",
                    borderRadius: 12,
                    overflow: "hidden",
                    marginBottom: "1rem",
                    border: "1px solid rgba(168,85,247,0.4)",
                    minHeight: 170,
                    backgroundImage: `linear-gradient(180deg, rgba(8,10,22,0.25), rgba(8,10,22,0.9)), url(${overviewBg})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                }}
            >
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 18px" }}>
                    <p className="act-label" style={{ color: "#c4b5fd", letterSpacing: 3, margin: 0 }}>CHOOSE YOUR PATH</p>
                    <h2 style={{ margin: "4px 0 0", color: "#faf5ff", textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>The Three Professions</h2>
                </div>
            </div>

            <p className="hint" style={{ marginTop: 0 }}>
                At <strong>Level {PROFESSION_UNLOCK_LEVEL}</strong>, the village elder summons you to choose a profession — a
                path that shapes how you grow. Later changes require a {PROFESSION_CHANGE_APPROVAL_NAME} from the Grand Marketplace and reset profession rank, XP, and mastery. Read each one below.
                {eligible
                    ? " You're ready: the elder will call on you to choose."
                    : ` You're Level ${character.level} — keep training to unlock the choice.`}
            </p>

            <div className="profession-overview-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: "1rem" }}>
                {PROFESSION_INFO.map(info => (
                    <article
                        key={info.id}
                        className={`profession-overview-card profession-overview-card-${info.id}`}
                        style={{
                            background: "linear-gradient(180deg, rgba(15,18,34,0.9), rgba(8,10,22,0.95))",
                            border: `2px solid ${info.accent}`,
                            borderRadius: 12,
                            overflow: "hidden",
                            boxShadow: `0 0 20px ${info.accent}22`,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div
                            style={{
                                height: 120,
                                backgroundImage: `linear-gradient(180deg, rgba(8,10,22,0.1), rgba(8,10,22,0.75)), url(${CARD_IMAGE[info.id]})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        />
                        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ color: info.accent, lineHeight: 1 }}><GameIcon name={PROFESSION_ICON[info.id]} size={30} /></span>
                                <div>
                                    <h3 style={{ margin: 0, color: info.accent, fontSize: 20 }}>{info.name}</h3>
                                    <p style={{ margin: "2px 0 0", color: "#c4b5fd", fontStyle: "italic", fontSize: 13 }}>{info.tagline}</p>
                                </div>
                            </div>
                            <p style={{ margin: 0, color: "var(--slate-300)", fontSize: "0.85rem", lineHeight: 1.5 }}>{info.summary}</p>
                            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5, fontSize: "0.82rem", color: "var(--slate-200)" }}>
                                {info.perks.map(b => <li key={b}>{b}</li>)}
                            </ul>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                                {info.rankHighlights.map(h => (
                                    <div key={h.rank} style={{ display: "flex", gap: 8, fontSize: "0.76rem" }}>
                                        <strong style={{ color: info.accent, minWidth: 56 }}>{h.rank}</strong>
                                        <span className="hint">{h.perk}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </article>
                ))}
            </div>

            <p className="hint" style={{ marginTop: "1rem", fontSize: "0.78rem", opacity: 0.75 }}>
                Your first choice opens that profession's hub. Future changes each consume a {PROFESSION_CHANGE_APPROVAL_NAME}, sold in the Grand Marketplace for {PROFESSION_CHANGE_APPROVAL_COST} Fate Shards.
            </p>
        </div>
    );
}
