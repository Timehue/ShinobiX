/* eslint-disable react-hooks/purity */
import { useState, useEffect } from "react";
import { AURA_SPHERE_VN_ID, AWAKENING_VN_ID, DUNGEON_VN_ID } from "../constants/game";
import type { Biome, Screen } from "../types/core";
import type { Character } from "../types/character";
import { PET_CONSUMABLE_PVE_HEAL_PCT, petConsumableById, petPveGearById, petPveHealOnSummonPct, petPveLifestealPct, petPveLoyalty, petPveSummonDamageMult } from "../data/pet-config";
import { PET_CRIT_MULT } from "../lib/pet-battle-sim";
import { boostAmount } from "../lib/village-upgrades";
import { defaultVnPortrait, defaultVnScene } from "../lib/vn";
import { effectiveCharacterXpGain } from "../lib/progression";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { getOffenseStat } from "../lib/combat-math";
import { isPetOnExpedition, petCombatDamage, petDisplayName, petHappiness } from "../lib/pet";
import { storylines, getCurrentStory } from "../data/storylines";
import { STORY_BOSS_SAVE_TTL_MS, storyBossSaveKey } from "../lib/battle-save";
import { BattleLockKeeper } from "../components/BattleLockKeeper";
import {
    gainXp,
    type CreatorEvent,
    type StoryStep,
} from "../App";
import { unlockVillageKageSystem } from "../lib/world-state";

export function StoryHall({
    character,
    setScreen,
    onStartBattle,
    creatorEvents,
    sharedImages,
    onStartVisualNovel,
}: {
    character: Character;
    setScreen: (screen: Screen) => void;
    onStartBattle: (step: StoryStep) => void;
    creatorEvents: CreatorEvent[];
    sharedImages: Record<string, string>;
    onStartVisualNovel: (event: CreatorEvent) => void;
}) {
    const storyLine = storylines[character.storyVillage || character.village] || [];
    const current = getCurrentStory(character);
    const [lineIndex, setLineIndex] = useState(0);
    const hiddenCreatorVnIds = new Set([AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID]);
    const creatorVisualNovels = creatorEvents
        .filter((event) =>
            event.eventKind === "visualNovel" &&
            !event.id.startsWith("story-") &&
            !hiddenCreatorVnIds.has(event.id) &&
            character.level >= event.levelReq
        )
        .sort((a, b) => a.levelReq - b.levelReq || a.name.localeCompare(b.name));
    const creatorVnShelf = creatorVisualNovels.length > 0 ? (
        <div className="summary-box">
            <h3>Available Visual Novels</h3>
            <div className="location-grid">
                {creatorVisualNovels.map((event) => (
                    <button key={event.id} className="location-button" onClick={() => onStartVisualNovel(event)}>
                        <span className="tile-icon">{event.icon || "?"}</span>
                        <span>{event.vnTitle || event.name}</span>
                        <small>Level {event.levelReq} · {event.vnPages?.length ?? 1} page(s)</small>
                    </button>
                ))}
            </div>
        </div>
    ) : null;
    if (!current) return <div className="card cinematic-card"><div className="visual-novel"><div className="vn-stage vn-complete"><div className="vn-character hero-character">{character.name.slice(0, 2).toUpperCase()}</div><div className="vn-dialogue"><div className="vn-speaker">Narrator</div><p>Your village story is complete. The roads beyond level 100 whisper about clan invasions, forbidden bloodlines, and a war waiting under Central.</p></div></div>{creatorVnShelf}</div></div>;
    const locked = character.level < current.levelReq;
    const activeLine = current.dialogue[lineIndex] ?? current.dialogue[0] ?? "The night waits for your answer.";
    const splitLine = activeLine.includes(":") ? activeLine.split(":") : ["Narrator", activeLine];
    const speaker = splitLine[0].trim();
    const spoken = splitLine.slice(1).join(":").trim() || activeLine;
    const speakerInitials = speaker === "Narrator" ? "..." : speaker.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    const storyBiome: Biome = current.biome ?? (character.village?.toLowerCase().includes("frostfang") ? "snow"
        : character.village?.toLowerCase().includes("stormveil") ? "shadow"
        : character.village?.toLowerCase().includes("ember") || character.village?.toLowerCase().includes("ash") ? "volcano"
        : character.village?.toLowerCase().includes("verdant") ? "forest"
        : "central");
    // Match the eventId format used by the trigger flow at App.tsx:6881 so
    // admin-uploaded images stored under the same KV keys are visible here too.
    const storyVillage = character.storyVillage || character.village;
    const chapterIndex = storyLine.findIndex(s => s.levelReq === current.levelReq);
    const chapterId = `story-${storyVillage.toLowerCase().replace(/\W+/g, "-")}-${current.levelReq}-${Math.max(0, chapterIndex)}`;
    // KV lookup first (admin-uploaded via VN editor), then the on-disk
    // /scenes and /portraits fallbacks, then biome gradient / initials.
    const storySceneBg = sharedImages[`event:${chapterId}:bg`]
        || sharedImages[`vn:${chapterId}:page:0`]
        || defaultVnScene(chapterId, storyBiome);
    const speakerPortrait = sharedImages[`event:${chapterId}:avatar`]
        || sharedImages[`vn:${chapterId}:page:0:right`]
        || defaultVnPortrait(speaker);
    const hideSpeakerSlot = !speakerPortrait && speaker.trim().toLowerCase() === "narrator";
    return <div className="card cinematic-card"><div className="visual-novel"><div className="vn-header"><div><p className="act-label">{current.cinematicTitle}</p><h2>{current.title}</h2></div><div className="vn-progress">Chapter {character.storyProgress + 1}/{storyLine.length}</div></div><div className={"vn-stage vn-biome-" + storyBiome + (storySceneBg ? " vn-has-image" : "")} style={storySceneBg ? { backgroundImage: `linear-gradient(180deg, rgba(7,12,27,.18), rgba(7,12,27,.78)), url(${storySceneBg})` } : undefined}><div className="vn-backdrop"><span className="vn-moon"></span><span className="vn-village-silhouette"></span></div><div className="vn-character mentor-character">{character.avatarImage ? <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null}<span className="vn-character-initials">{character.name.slice(0, 2).toUpperCase()}</span></div>{!hideSpeakerSlot && (<div className="vn-character hero-character">{speakerPortrait ? <img src={speakerPortrait} alt={speaker} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null}<span className="vn-character-initials">{speakerInitials}</span></div>)}<div className="vn-scene-card">{current.scene}</div><div className="vn-dialogue"><div className="vn-speaker">{speaker}</div><p>{spoken}</p><div className="vn-controls"><button disabled={lineIndex === 0} onClick={() => setLineIndex((index) => Math.max(0, index - 1))}>Back</button>{lineIndex < current.dialogue.length - 1 ? <button onClick={() => setLineIndex((index) => Math.min(current.dialogue.length - 1, index + 1))}>Next</button> : locked ? <button disabled>Requires Level {current.levelReq}</button> : <button onClick={() => onStartBattle(current)}>Face {current.bossName}</button>}</div></div></div><div className="vn-choice-row"><button onClick={() => setLineIndex(0)}>Replay Scene</button><button onClick={() => setScreen("worldMap")}>Investigate World Map</button><button disabled={locked} onClick={() => onStartBattle(current)}>{current.bossIcon} Boss: {current.bossName}</button></div><div className="vn-reward-strip"><span>Requirement: Level {current.levelReq}</span><span>Reward: {effectiveCharacterXpGain(character, current.rewardXp)} XP / {current.rewardRyo} ryo</span></div>{creatorVnShelf}</div></div>;
}

type SavedStoryBoss = { savedAt: number; storyProgress: number; bossHp: number; playerHp: number; ap: number; turn: number; summonedPetId: string; log: string };
// Headless persister for the story-boss fight (isolated hooks, like
// ArenaBattlePersister). Serializes the in-progress fight to localStorage on each
// HP/turn change and rehydrates it on mount so a refresh resumes the same fight
// at the same boss/player HP instead of letting the player flee to heal and retry.
function StoryBossPersister(props: {
    characterName: string; storyProgress: number; active: boolean;
    bossHp: number; playerHp: number; ap: number; turn: number; summonedPetId: string; log: string;
    onRestore: (saved: SavedStoryBoss) => void;
}) {
    const key = storyBossSaveKey(props.characterName);
    useEffect(() => {
        if (!props.active) { try { localStorage.removeItem(key); } catch { /* ignore */ } return; }
        try {
            const snap: SavedStoryBoss = {
                savedAt: Date.now(), storyProgress: props.storyProgress,
                bossHp: props.bossHp, playerHp: props.playerHp, ap: props.ap,
                turn: props.turn, summonedPetId: props.summonedPetId, log: props.log,
            };
            localStorage.setItem(key, JSON.stringify(snap));
        } catch { /* quota — ignore */ }

    }, [props.active, props.bossHp, props.playerHp, props.turn]);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            const saved = JSON.parse(raw) as SavedStoryBoss;
            if (Date.now() - (saved.savedAt ?? 0) > STORY_BOSS_SAVE_TTL_MS) { localStorage.removeItem(key); return; }
            if (saved.storyProgress !== props.storyProgress) return;       // different chapter
            if (!(saved.bossHp > 0 && saved.playerHp > 0)) return;          // already resolved
            props.onRestore(saved);
        } catch { try { localStorage.removeItem(key); } catch { /* ignore */ } }

    }, []);
    return null;
}

export function StoryBoss({ character, updateCharacter, setScreen }: { character: Character; updateCharacter: (character: Character) => void; setScreen: (screen: Screen) => void }) {
    const storyStep = getCurrentStory(character);
    const [bossHp, setBossHp] = useState(storyStep?.bossHp ?? 100);
    const [playerHp, setPlayerHp] = useState(character.hp);
    const [ap, setAp] = useState(100);
    const [turn, setTurn] = useState(1);
    const [log, setLog] = useState("The boss steps forward. The air changes.");
    const [effect, setEffect] = useState("");
    const [summonedPetId, setSummonedPetId] = useState("");
    if (!storyStep) return <div className="card"><h2>No Boss Available</h2><button onClick={() => setScreen("storyHall")}>Back to Story</button></div>;
    const activeAuraBonuses = getActiveAuraSphereBonuses(character);
    const activeBattlePet = character.pets.find((pet) => pet.id === character.activePetId);
    const summonedPet = activeBattlePet && summonedPetId === activeBattlePet.id ? activeBattlePet : null;
    const basicAttackDamage = boostAmount(Math.floor(35 + getOffenseStat(character.stats, character.specialty) * 0.08), activeAuraBonuses.pveDamagePercent);
    const chakraStrikeDamage = boostAmount(Math.floor(65 + getOffenseStat(character.stats, character.specialty) * 0.12), activeAuraBonuses.pveDamagePercent);
    function winBossFight(newPlayerHp: number) {
        const leveled = gainXp({ ...character, hp: newPlayerHp }, storyStep.rewardXp);
        let nextCharacter: Character = {
            ...leveled,
            ryo: leveled.ryo + storyStep.rewardRyo,
            auraDust: (leveled.auraDust ?? 0) + 12,
            hp: Math.min(leveled.maxHp, newPlayerHp + 25),
            stamina: Math.min(leveled.maxStamina, leveled.stamina + 20),
            chakra: Math.min(leveled.maxChakra, leveled.chakra + 20),
            storyProgress: character.storyProgress + 1,
        };
        if (storyStep.kageFinale) {
            unlockVillageKageSystem(character.village, character.name);
            nextCharacter = { ...nextCharacter, storyTitle: storyStep.liberatorTitle ?? nextCharacter.storyTitle, rankTitle: storyStep.liberatorTitle ?? nextCharacter.rankTitle };
        }
        updateCharacter(nextCharacter);
        setLog(`${storyStep.bossName} defeated. +${effectiveCharacterXpGain(character, storyStep.rewardXp)} XP, +${storyStep.rewardRyo} ryo, +12 Aura Dust. Story advanced.`);
    }
    function summonBossPet() {
        if (!activeBattlePet) return setLog("No active pet selected. Choose one in the Pet Yard first.");
        if (isPetOnExpedition(activeBattlePet)) return setLog(`${petDisplayName(activeBattlePet)} is exploring and cannot join PvE battles.`);
        if (!activeBattlePet.unlockedForPve && activeBattlePet.level < 50) return setLog(`${petDisplayName(activeBattlePet)} must reach level 50 before it can join PvE battles.`);
        if (summonedPet) return setLog(`${petDisplayName(summonedPet)} is already fighting beside you.`);
        setSummonedPetId(activeBattlePet.id);
        // PVE gear durability — spent gear breaks before this fight; otherwise
        // it ticks down one summon and still applies this fight.
        const pveId = activeBattlePet.loadout?.pve;
        const pveDur = activeBattlePet.loadout?.pveDurability ?? 0;
        const gearBroke = !!pveId && pveDur <= 0;
        const gearActive = !!pveId && pveDur > 0;
        let nextPets = character.pets;
        if (gearBroke) {
            nextPets = character.pets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, pve: undefined, pveDurability: undefined } } : p);
        } else if (gearActive) {
            nextPets = character.pets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, pveDurability: pveDur - 1 } } : p);
        }
        const summonHealPct = gearActive ? petPveHealOnSummonPct(activeBattlePet) : 0;
        const heal = summonHealPct > 0 ? Math.floor(character.maxHp * summonHealPct / 100) : 0;
        // Battle consumable in PvE: the pet spends it to shield you on entry.
        const consId = activeBattlePet.loadout?.consumable;
        const consHeal = consId ? Math.max(1, Math.floor(character.maxHp * PET_CONSUMABLE_PVE_HEAL_PCT / 100)) : 0;
        if (consId) nextPets = nextPets.map((p) => p.id === activeBattlePet.id ? { ...p, loadout: { ...p.loadout, consumable: undefined } } : p);
        const healedFinal = Math.min(character.maxHp, playerHp + heal + consHeal);
        if (heal + consHeal > 0) setPlayerHp(healedFinal);
        updateCharacter({ ...character, hp: healedFinal, pets: nextPets });
        const brokeNote = gearBroke ? ` ${petPveGearById(pveId)?.name ?? "Its PVE gear"} has worn out and breaks.` : "";
        const healNote = heal > 0 ? ` It steadies you — +${heal} HP.` : "";
        const consNote = consHeal > 0 ? ` ${petConsumableById(consId)?.name ?? "A consumable"} shields you for +${consHeal} HP.` : "";
        setLog(`${petDisplayName(activeBattlePet)} joins the boss fight and will act after you do.${healNote}${consNote}${brokeNote}`);
    }
    function bossPetFollowUp(currentBossHp = bossHp, currentPlayerHp = playerHp) {
        if (!summonedPet || currentBossHp <= 0 || currentPlayerHp <= 0) return;
        const petName = petDisplayName(summonedPet);
        const happiness = petHappiness(summonedPet);
        const loyalTarget = happiness >= 71;
        const gearLoyal = petPveLoyalty(summonedPet);
        const attacksBoss = loyalTarget || gearLoyal || Math.random() >= 0.5;
        const enemyHpPct = (currentBossHp / Math.max(1, storyStep.bossHp)) * 100;
        const playerHpPct = (currentPlayerHp / Math.max(1, character.maxHp)) * 100;
        // Speed-scaled crit + a damage roll so summon hits have visible punch.
        const summonCrit = Math.random() < Math.min(0.45, 0.16 + summonedPet.speed / 1100);
        const summonVar = 0.9 + Math.random() * 0.2;
        const damage = Math.max(1, Math.floor(petCombatDamage(summonedPet) * petPveSummonDamageMult(summonedPet, enemyHpPct, playerHpPct) * (summonCrit ? PET_CRIT_MULT : 1) * summonVar));
        const critNote = summonCrit ? " — CRITICAL HIT!" : "";
        if (attacksBoss) {
            const nextBossHp = Math.max(0, currentBossHp - damage);
            setBossHp(nextBossHp);
            setEffect("💥");
            // PVE gear lifesteal — heal the player for a cut of the damage dealt.
            const lsPct = petPveLifestealPct(summonedPet);
            let healNote = "";
            if (lsPct > 0) {
                const heal = Math.max(1, Math.floor(damage * lsPct / 100));
                const healedHp = Math.min(character.maxHp, currentPlayerHp + heal);
                if (healedHp > currentPlayerHp) {
                    setPlayerHp(healedHp);
                    updateCharacter({ ...character, hp: healedHp });
                    healNote = ` It channels ${heal} HP back to you.`;
                }
            }
            if (nextBossHp <= 0) return winBossFight(currentPlayerHp);
            return setLog(`${petName} attacks ${storyStep.bossName}${(loyalTarget || gearLoyal) ? "" : " despite low happiness"} for ${damage} damage${critNote}.${healNote}`);
        }
        const friendlyDamage = Math.max(1, Math.floor(damage * 0.65));
        const nextPlayerHp = Math.max(0, currentPlayerHp - friendlyDamage);
        setPlayerHp(nextPlayerHp);
        updateCharacter({ ...character, hp: nextPlayerHp });
        setEffect("💥");
        setLog(`${petName}'s low happiness backfires. It attacks you for ${friendlyDamage} damage.`);
    }
    function bossCounter() { if (bossHp <= 0) return; const damage = Math.max(5, storyStep.bossDamage + Math.floor(turn * 2)); const afterHit = Math.max(0, playerHp - damage); setPlayerHp(afterHit); updateCharacter({ ...character, hp: afterHit }); if (afterHit <= 0) return setLog(`${storyStep.bossName} defeated you. Visit the Hospital and try again.`); setTurn((t) => t + 1); setAp(100); setLog(`${storyStep.bossName} counters for ${damage} damage.`); }
    function basicAttack() { if (ap < 40) return setLog("Not enough AP."); const newBossHp = Math.max(0, bossHp - basicAttackDamage); setBossHp(newBossHp); setAp((c) => c - 40); setEffect("💥"); if (newBossHp <= 0) return winBossFight(playerHp); setLog(`You strike ${storyStep.bossName} for ${basicAttackDamage} damage.`); bossPetFollowUp(newBossHp, playerHp); }
    function chakraStrike() { if (ap < 60) return setLog("Not enough AP."); if (character.chakra < 20) return setLog("Not enough chakra."); const newBossHp = Math.max(0, bossHp - chakraStrikeDamage); setBossHp(newBossHp); setAp((c) => c - 60); setEffect("💥"); updateCharacter({ ...character, chakra: Math.max(0, character.chakra - 20) }); if (newBossHp <= 0) return winBossFight(playerHp); setLog(`You unleash a chakra strike for ${chakraStrikeDamage} damage. -20 chakra.`); bossPetFollowUp(newBossHp, playerHp); }
    function guard() { if (ap < 30) return setLog("Not enough AP."); const reducedDamage = Math.max(1, Math.floor(storyStep.bossDamage * 0.45)); const afterHit = Math.max(0, playerHp - reducedDamage); setPlayerHp(afterHit); setAp(100); setTurn((t) => t + 1); setEffect("🛡️"); updateCharacter({ ...character, hp: afterHit }); setLog(`You guard. ${storyStep.bossName} only deals ${reducedDamage} damage.`); bossPetFollowUp(bossHp, afterHit); }
    function recover() { if (ap < 50) return setLog("Not enough AP."); const heal = 35 + Math.floor(character.stats.willpower * 0.05); const newHp = Math.min(character.maxHp, playerHp + heal); setPlayerHp(newHp); setAp((c) => c - 50); setEffect("💥"); updateCharacter({ ...character, hp: newHp, chakra: Math.min(character.maxChakra, character.chakra + 15) }); setLog(`You recover your breathing. +${heal} HP and +15 chakra.`); bossPetFollowUp(bossHp, newHp); }
    return <div className="card cinematic-card"><StoryBossPersister characterName={character.name} storyProgress={character.storyProgress} active={bossHp > 0 && playerHp > 0} bossHp={bossHp} playerHp={playerHp} ap={ap} turn={turn} summonedPetId={summonedPetId} log={log} onRestore={(saved) => { setBossHp(saved.bossHp); setPlayerHp(saved.playerHp); setAp(saved.ap); setTurn(saved.turn); setSummonedPetId(saved.summonedPetId); setLog("⚔ Battle resumed — the fight continues where you left off."); }} /><BattleLockKeeper active={bossHp > 0 && playerHp > 0} kind="storyBoss" screen="storyBoss" playerName={character.name} /><div className="boss-stage">{effect && <div className="combat-effect">{effect}</div>}<div className="cinematic-panel"><p className="act-label">{storyStep.cinematicTitle}</p><h2>{storyStep.bossIcon} {storyStep.bossName}</h2><p className="scene-text">{storyStep.scene}</p></div><div className="combat-stats"><div><strong>{character.name}</strong><div className="bar-label">HP {playerHp}/{character.maxHp}</div><div className="bar"><span style={{ width: `${(playerHp / character.maxHp) * 100}%` }}></span></div><div className="bar-label">Chakra {character.chakra}/{character.maxChakra}</div><div className="bar ap-bar"><span style={{ width: `${(character.chakra / character.maxChakra) * 100}%` }}></span></div><p>AP: {ap}/100</p>{summonedPet && <p>Pet: {petDisplayName(summonedPet)} · Happy {petHappiness(summonedPet)}%</p>}</div><div><strong>{storyStep.bossName}</strong><div className="bar-label">HP {bossHp}/{storyStep.bossHp}</div><div className="bar enemy-bar"><span style={{ width: `${(bossHp / storyStep.bossHp) * 100}%` }}></span></div><p>Boss Damage: {storyStep.bossDamage}</p><p>Turn: {turn}</p></div></div><div className="jutsu-combat-grid"><button onClick={basicAttack}><span className="jutsu-icon">⚔</span><strong>Basic Attack</strong><small>40 AP / no chakra</small></button><button onClick={chakraStrike}><span className="jutsu-icon">🌀</span><strong>Chakra Strike</strong><small>60 AP / -20 chakra</small></button><button onClick={guard}><span className="jutsu-icon">🛡</span><strong>Guard</strong><small>30 AP / reduce damage</small></button><button onClick={recover}><span className="jutsu-icon">✚</span><strong>Recover</strong><small>50 AP / heal + chakra</small></button><button onClick={summonBossPet} disabled={!activeBattlePet || Boolean(summonedPet)}><span className="jutsu-icon">🐾</span><strong>Summon Pet</strong><small>{summonedPet ? `${petDisplayName(summonedPet)} active` : activeBattlePet ? petDisplayName(activeBattlePet) : "No active pet"}</small></button></div><div className="menu"><button onClick={bossCounter}>End Turn</button><button onClick={() => setScreen("storyHall")}>Back to Story</button></div><div className="log">{log}</div></div></div>;
}

// Training screens (stat training, jutsu seal/paid training) moved to ./screens/Training.

// CardVisual / ClanImageMark / LeaderPortrait moved to ./components/Marks.
