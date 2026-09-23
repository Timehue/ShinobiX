/* eslint-disable react-hooks/purity */
import { useState } from "react";
import { GiCrossedSwords, GiCrownedSkull, GiHealthIncrease, GiPawPrint, GiShield, GiSpiralThrust } from "../components/icons/LightweightGameIcons";
import "../styles/battle-skin.css";
import type { Screen } from "../types/core";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { PET_CONSUMABLE_PVE_HEAL_PCT, petConsumableById, petPveGearById, petPveHealOnSummonPct, petPveLifestealPct, petPveLoyalty, petPveSummonDamageMult } from "../data/pet-config";
import { PET_CRIT_MULT } from "../lib/pet-battle-sim";
import { boostAmount } from "../lib/village-upgrades";
import { gameConfirm } from "../components/GameAlert";
import { getActiveAuraSphereBonuses } from "../lib/aura-sphere";
import { activeCarriedPets } from "../lib/entitlements";
import { getOffenseStat } from "../lib/combat-math";
import { isPetOnExpedition, petCombatDamage, petCurrentHappiness, petDisplayName } from "../lib/pet";
import {
    PET_HAPPINESS_OBEDIENT,
    petHappinessCombatMult,
    petHappinessDisobeyChance,
} from "../../../shared/pet-happiness";
import { spendPetSummonCost } from "../lib/pet-acquisition-api";
import { isStoryContentVillage } from "../lib/story-content-contract";
import { readStoryContent } from "../lib/story-content-loader";
import { BattleLockKeeper } from "../components/BattleLockKeeper";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { StoryJourney } from "../components/StoryJourney";
import { LivingChronicle } from "../components/LivingChronicle";
import { StoryContentBoundary } from "../components/StoryContentBoundary";

export function StoryArchiveHall({
    character,
    setScreen,
    onResumeStory,
    sharedImages,
}: {
    character: Character;
    setScreen: (screen: Screen) => void;
    onResumeStory?: () => void;
    sharedImages?: Record<string, string>;
}) {
    const village = character.storyVillage || character.village;
    const [section, setSection] = useState<"stories" | "chronicle">("stories");
    if (!isStoryContentVillage(village)) throw new Error(`No story content is published for ${village || "this village"}.`);
    return (
        <div className="card cinematic-card story-hall-archive">
            <BackToVillageButton onClick={() => setScreen("village")} />
            <header className="story-hall-heading">
                <p className="act-label">VILLAGE MEMORY · LIVING RECORD</p>
                <h1>Story Hall</h1>
                <p>Revisit the road you chose, then see the deeds your world has preserved around it.</p>
            </header>
            <nav className="story-hall-tabs" aria-label="Story Hall sections">
                <button type="button" aria-pressed={section === "stories"} onClick={() => setSection("stories")}>
                    Completed Stories
                </button>
                <button type="button" aria-pressed={section === "chronicle"} onClick={() => setSection("chronicle")}>
                    Living Chronicle
                </button>
            </nav>
            {section === "stories" ? (
                <StoryContentBoundary village={village} onReturn={() => setScreen("village")}>
                    <StoryJourney character={character} onReturnToVillage={() => setScreen("village")} onResumeStory={onResumeStory} sharedImages={sharedImages} />
                </StoryContentBoundary>
            ) : (
                <LivingChronicle key={`${character.name}:${character.clan ?? ""}`} character={character} />
            )}
        </div>
    );
}

type StoryBossProps = { character: Character; updateCharacter: (next: Character | ((prev: Character | null) => Character)) => void; setScreen: (screen: Screen) => void };

export function StoryBoss(props: StoryBossProps) {
    const storyVillage = props.character.storyVillage || props.character.village;
    if (!isStoryContentVillage(storyVillage)) throw new Error(`No story content is published for ${storyVillage || "this village"}.`);
    return (
        <StoryContentBoundary village={storyVillage}>
            <StoryBossContent {...props} storyVillage={storyVillage} />
        </StoryContentBoundary>
    );
}

function StoryBossContent({ character, updateCharacter, setScreen, storyVillage }: StoryBossProps & { storyVillage: import("../lib/story-content-contract").StoryContentVillage }) {
    const storyStep = readStoryContent(storyVillage).chapters[character.storyProgress] ?? null;
    const [bossHp, setBossHp] = useState(storyStep?.bossHp ?? 100);
    const [playerHp, setPlayerHp] = useState(character.hp);
    const [ap, setAp] = useState(100);
    const [turn, setTurn] = useState(1);
    const [log, setLog] = useState("The boss steps forward. The air changes.");
    const [effect, setEffect] = useState<"" | "strike" | "guard">("");
    const [summonedPetId, setSummonedPetId] = useState("");
    if (!storyStep) return <div className="card"><h2>No Boss Available</h2><button onClick={() => setScreen("storyHall")}>Back to Story</button></div>;
    const activeAuraBonuses = getActiveAuraSphereBonuses(character);
    const activeBattlePet = activeCarriedPets<Pet>(character).find((pet) => pet.id === character.activePetId);
    const summonedPet = activeBattlePet && summonedPetId === activeBattlePet.id ? activeBattlePet : null;
    const basicAttackDamage = boostAmount(Math.floor(35 + getOffenseStat(character.stats, character.specialty) * 0.08), activeAuraBonuses.pveDamagePercent);
    const chakraStrikeDamage = boostAmount(Math.floor(65 + getOffenseStat(character.stats, character.specialty) * 0.12), activeAuraBonuses.pveDamagePercent);
    // currentChakra threads the post-spend chakra of the killing-blow action
    // (e.g. Chakra Strike's -20) so the reward respread doesn't rebuild from the
    // stale pre-spend value and refund the cost. Functional so the base picks up
    // any chakra already committed by the action that triggered this win; when no
    // explicit override is passed (e.g. a pet follow-up kill), the latest committed
    // chakra is used as-is rather than reverting to the stale closure value.
    function winBossFight(newPlayerHp: number, currentChakra?: number) {
        updateCharacter((prev) => {
            const base = prev ?? character;
            const chakra = currentChakra ?? base.chakra;
            return { ...base, hp: Math.min(base.hp, newPlayerHp), chakra: Math.min(base.chakra, chakra) };
        });
        setLog(`${storyStep.bossName} defeated in the retired local battle. No reward was granted; return to Story Hall for the server-sealed encounter.`);
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
        // `loadout` is server-owned, so the nextPets edit above is only the
        // optimistic mirror — this is what actually spends the durability and the
        // consumable. Fire-and-forget (see spendPetSummonCost).
        void spendPetSummonCost(character.name, activeBattlePet.id);
        const brokeNote = gearBroke ? ` ${petPveGearById(pveId)?.name ?? "Its PVE gear"} has worn out and breaks.` : "";
        const healNote = heal > 0 ? ` It steadies you — +${heal} HP.` : "";
        const consNote = consHeal > 0 ? ` ${petConsumableById(consId)?.name ?? "A consumable"} shields you for +${consHeal} HP.` : "";
        setLog(`${petDisplayName(activeBattlePet)} joins the boss fight and will act after you do.${healNote}${consNote}${brokeNote}`);
    }
    function bossPetFollowUp(currentBossHp = bossHp, currentPlayerHp = playerHp) {
        if (!summonedPet || currentBossHp <= 0 || currentPlayerHp <= 0) return;
        const petName = petDisplayName(summonedPet);
        // Bond upkeep: the disobey chance scales with happiness (35% restless /
        // 50% unhappy / 65% neglected) instead of the flat coin-flip this used,
        // and a neglected companion also strikes softer. Same table the
        // server-authoritative companion runs — shared/pet-happiness.ts.
        const happiness = petCurrentHappiness(summonedPet);
        const loyalTarget = happiness >= PET_HAPPINESS_OBEDIENT;
        const gearLoyal = petPveLoyalty(summonedPet);
        const attacksBoss = loyalTarget || gearLoyal || Math.random() >= petHappinessDisobeyChance(happiness);
        const enemyHpPct = (currentBossHp / Math.max(1, storyStep.bossHp)) * 100;
        const playerHpPct = (currentPlayerHp / Math.max(1, character.maxHp)) * 100;
        // Speed-scaled crit + a damage roll so summon hits have visible punch.
        const summonCrit = Math.random() < Math.min(0.45, 0.16 + summonedPet.speed / 1100);
        const summonVar = 0.9 + Math.random() * 0.2;
        const damage = Math.max(1, Math.floor(petCombatDamage(summonedPet) * petHappinessCombatMult(happiness) * petPveSummonDamageMult(summonedPet, enemyHpPct, playerHpPct) * (summonCrit ? PET_CRIT_MULT : 1) * summonVar));
        const critNote = summonCrit ? " — CRITICAL HIT!" : "";
        if (attacksBoss) {
            const nextBossHp = Math.max(0, currentBossHp - damage);
            setBossHp(nextBossHp);
            setEffect("strike");
            // PVE gear lifesteal — heal the player for a cut of the damage dealt.
            const lsPct = petPveLifestealPct(summonedPet);
            let healNote = "";
            if (lsPct > 0) {
                const heal = Math.max(1, Math.floor(damage * lsPct / 100));
                const healedHp = Math.min(character.maxHp, currentPlayerHp + heal);
                if (healedHp > currentPlayerHp) {
                    setPlayerHp(healedHp);
                    // Functional so this HP write doesn't clobber chakra (or any
                    // other field) committed by the player action that triggered
                    // this follow-up — e.g. Chakra Strike's -20.
                    updateCharacter((prev) => ({ ...(prev ?? character), hp: healedHp }));
                    healNote = ` It channels ${heal} HP back to you.`;
                }
            }
            if (nextBossHp <= 0) return winBossFight(currentPlayerHp);
            return setLog(`${petName} attacks ${storyStep.bossName}${(loyalTarget || gearLoyal) ? "" : " despite low happiness"} for ${damage} damage${critNote}.${healNote}`);
        }
        const friendlyDamage = Math.max(1, Math.floor(damage * 0.65));
        const nextPlayerHp = Math.max(0, currentPlayerHp - friendlyDamage);
        setPlayerHp(nextPlayerHp);
        // Functional so this HP write preserves chakra committed by the player
        // action that triggered this follow-up (e.g. Chakra Strike's -20).
        updateCharacter((prev) => ({ ...(prev ?? character), hp: nextPlayerHp }));
        setEffect("strike");
        setLog(`${petName}'s low happiness backfires. It attacks you for ${friendlyDamage} damage.`);
    }
    function bossCounter() { if (bossHp <= 0) return; const damage = Math.max(5, storyStep.bossDamage + Math.floor(turn * 2)); const afterHit = Math.max(0, playerHp - damage); setPlayerHp(afterHit); updateCharacter({ ...character, hp: afterHit }); if (afterHit <= 0) return setLog(`${storyStep.bossName} defeated you. Visit the Hospital and try again.`); setTurn((t) => t + 1); setAp(100); setLog(`${storyStep.bossName} counters for ${damage} damage.`); }
    function basicAttack() { if (ap < 40) return setLog("Not enough AP."); const newBossHp = Math.max(0, bossHp - basicAttackDamage); setBossHp(newBossHp); setAp((c) => c - 40); setEffect("strike"); if (newBossHp <= 0) return winBossFight(playerHp); setLog(`You strike ${storyStep.bossName} for ${basicAttackDamage} damage.`); bossPetFollowUp(newBossHp, playerHp); }
    function chakraStrike() { if (ap < 60) return setLog("Not enough AP."); if (character.chakra < 20) return setLog("Not enough chakra."); const newBossHp = Math.max(0, bossHp - chakraStrikeDamage); setBossHp(newBossHp); setAp((c) => c - 60); setEffect("strike"); const postSpendChakra = Math.max(0, character.chakra - 20); updateCharacter({ ...character, chakra: postSpendChakra }); if (newBossHp <= 0) return winBossFight(playerHp, postSpendChakra); setLog(`You unleash a chakra strike for ${chakraStrikeDamage} damage. -20 chakra.`); bossPetFollowUp(newBossHp, playerHp); }
    function guard() { if (ap < 30) return setLog("Not enough AP."); const reducedDamage = Math.max(1, Math.floor(storyStep.bossDamage * 0.45)); const afterHit = Math.max(0, playerHp - reducedDamage); setPlayerHp(afterHit); setAp(100); setTurn((t) => t + 1); setEffect("guard"); updateCharacter({ ...character, hp: afterHit }); setLog(`You guard. ${storyStep.bossName} only deals ${reducedDamage} damage.`); bossPetFollowUp(bossHp, afterHit); }
    function recover() { if (ap < 50) return setLog("Not enough AP."); const heal = 35 + Math.floor(character.stats.willpower * 0.05); const newHp = Math.min(character.maxHp, playerHp + heal); setPlayerHp(newHp); setAp((c) => c - 50); setEffect("strike"); updateCharacter({ ...character, hp: newHp, chakra: Math.min(character.maxChakra, character.chakra + 15) }); setLog(`You recover your breathing. +${heal} HP and +15 chakra.`); bossPetFollowUp(bossHp, newHp); }
    return <div className="card cinematic-card"><BattleLockKeeper active={bossHp > 0 && playerHp > 0} kind="storyBoss" screen="storyBoss" playerName={character.name} /><div className="boss-stage">{effect && <div className="combat-effect">{effect === "guard" ? <GiShield aria-hidden="true" /> : <GiCrossedSwords aria-hidden="true" />}</div>}<div className="cinematic-panel"><p className="act-label">{storyStep.cinematicTitle}</p><h2><GiCrownedSkull aria-hidden="true" /> {storyStep.bossName}</h2><p className="scene-text">{storyStep.scene}</p></div><div className="combat-stats"><div><strong>{character.name}</strong><div className="bar-label">HP {playerHp}/{character.maxHp}</div><div className="bar"><span style={{ width: `${(playerHp / character.maxHp) * 100}%` }}></span></div><div className="bar-label">Chakra {character.chakra}/{character.maxChakra}</div><div className="bar ap-bar"><span style={{ width: `${(character.chakra / character.maxChakra) * 100}%` }}></span></div><p>AP: {ap}/100</p>{summonedPet && <p>Pet: {petDisplayName(summonedPet)} · Happy {petCurrentHappiness(summonedPet)}%</p>}</div><div><strong>{storyStep.bossName}</strong><div className="bar-label">HP {bossHp}/{storyStep.bossHp}</div><div className="bar enemy-bar"><span style={{ width: `${(bossHp / storyStep.bossHp) * 100}%` }}></span></div><p>Boss Damage: {storyStep.bossDamage}</p><p>Turn: {turn}</p></div></div><div className="jutsu-combat-grid"><button onClick={basicAttack}><span className="jutsu-icon"><GiCrossedSwords aria-hidden="true" /></span><strong>Basic Attack</strong><small>40 AP / no chakra</small></button><button onClick={chakraStrike}><span className="jutsu-icon"><GiSpiralThrust aria-hidden="true" /></span><strong>Chakra Strike</strong><small>60 AP / -20 chakra</small></button><button onClick={guard}><span className="jutsu-icon"><GiShield aria-hidden="true" /></span><strong>Guard</strong><small>30 AP / reduce damage</small></button><button onClick={recover}><span className="jutsu-icon"><GiHealthIncrease aria-hidden="true" /></span><strong>Recover</strong><small>50 AP / heal + chakra</small></button><button onClick={summonBossPet} disabled={!activeBattlePet || Boolean(summonedPet)}><span className="jutsu-icon"><GiPawPrint aria-hidden="true" /></span><strong>Summon</strong><small>{summonedPet ? `${petDisplayName(summonedPet)} active` : activeBattlePet ? petDisplayName(activeBattlePet) : "No active pet"}</small></button></div><div className="menu"><button onClick={bossCounter}>End Turn</button><button onClick={async () => { if (bossHp > 0 && playerHp > 0) { if (!(await gameConfirm("Forfeit this boss fight? You'll be downed and make no story progress.", { danger: true, confirmLabel: "Forfeit" }))) return; updateCharacter({ ...character, hp: 0 }); } setScreen("storyHall"); }}>{bossHp > 0 && playerHp > 0 ? "Forfeit (take the loss)" : "Back to Story"}</button></div><div className="log">{log}</div></div></div>;
}

// Training screens (stat training, jutsu seal/paid training) moved to ./screens/Training.

// CardVisual / ClanImageMark / LeaderPortrait moved to ./components/Marks.
