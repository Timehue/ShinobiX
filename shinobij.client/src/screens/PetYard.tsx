/* eslint-disable react-hooks/purity */
import { useState, useEffect } from "react";
import type { Character } from "../types/character";
import type { Pet, PetExpeditionType, PetTrainingType } from "../types/pet";
import type { Screen } from "../types/core";
import { boostAmount, getPetXpBonus } from "../lib/village-upgrades";
import { capPetStats, collectPetTraining, gainPetXp, petTrainingGains, petTrainingPreview, petXpNeeded } from "../lib/pet-balance";
import { nextEvolution, EVOLUTION_STONE_NAMES, petVisualId } from "../data/pet-evolutions";
import { petEvolveCutsceneEnabled } from "../lib/pet-coliseum-flag";
import { PetEvolutionCutscene } from "../components/PetEvolutionCutscene";
import { currentDateKey, formatPetTimer } from "../lib/utils";
import { increasePetHappiness, isPetOnExpedition, petDisplayName, petHappiness } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { PET_PVE_DURABILITY, petCollarById, petCollarVisual, petCollars, petConsumableById, petConsumables, petExpeditionOptions, petExpeditionStories, petFeedItems, petPveGear, petPveGearById, petPvpGear, petPvpGearById, petTrainingDurations, petTrainingOptions, petTraitDescriptions } from "../data/pet-config";
import { petTamerClaimFirstExpeditionToday, petTamerExpeditionMult, petTamerTrainingSpeedPct } from "../App";
import { addItem, removeItem, countItem, ownsItem } from "../lib/inventory";
import { useWarLossDebuff } from "../lib/war-debuff";
import { masteryBonus } from "../lib/profession-mastery";

export function PetYard({ character, updateCharacter, setScreen, onBack, onImmediateSave }: { character: Character; updateCharacter: (c: Character) => void; setScreen: (s: Screen) => void; onBack: () => void; onImmediateSave?: (c: Character) => void }) {
    const [selectedPetId, setSelectedPetId] = useState(character.pets[0]?.id ?? "");
    const warDebuff = useWarLossDebuff(character.village);
    const [trainingType, setTrainingType] = useState<PetTrainingType>("strength");
    const [trainingDuration, setTrainingDuration] = useState(petTrainingDurations[0].ms);
    const [expeditionType, setExpeditionType] = useState<PetExpeditionType>("scout");
    const [expeditionResult, setExpeditionResult] = useState<{
        petName: string; summary: string; expType: PetExpeditionType;
        ryo: number; xp: number; statGain: number;
        foundFate: number; foundAura: number; foundBone: number; leveledUp: boolean;
    } | null>(null);
    const [tick, setTick] = useState(0);
    const [petHeartBurst, setPetHeartBurst] = useState(0);
    const [nicknameInput, setNicknameInput] = useState("");
    const [nicknameMsg, setNicknameMsg] = useState("");
    const [evolveBusy, setEvolveBusy] = useState(false);
    const [evolveMsg, setEvolveMsg] = useState("");
    const [evolveCutscene, setEvolveCutscene] = useState<{ pet: Pet; oldName: string; oldImage?: string } | null>(null);
    // Pet escort offer state (Pet Tamer in clan only).
    const [escortOffered, setEscortOffered] = useState<boolean | null>(null);
    const [escortBusy, setEscortBusy] = useState(false);
    const selectedPet = character.pets.find((p) => p.id === selectedPetId) ?? character.pets[0] ?? null;
    const petXpBonus = getPetXpBonus(character);
    const canOfferEscort = character.profession === "petTamer" && !!character.clan;

    useEffect(() => {
        if (!canOfferEscort) return;
        let cancelled = false;
        async function fetchOffer() {
            try {
                const res = await fetch(`/api/clan/pet-escort/list?clanName=${encodeURIComponent(character.clan ?? "")}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (Array.isArray(data.escorters)) {
                    setEscortOffered(data.escorters.some((n: string) => n.toLowerCase() === character.name.toLowerCase()));
                }
            } catch { /* ignore */ }
        }
        void fetchOffer();
        const id = setInterval(fetchOffer, 60_000);
        return () => { cancelled = true; clearInterval(id); };
     
    }, [canOfferEscort, character.clan, character.name]);

    async function toggleEscort() {
        if (!canOfferEscort || escortBusy) return;
        setEscortBusy(true);
        try {
            const endpoint = escortOffered ? '/api/clan/pet-escort/cancel' : '/api/clan/pet-escort/offer';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name }),
            });
            if (res.ok) setEscortOffered(!escortOffered);
        } catch { /* ignore */ }
        setEscortBusy(false);
    }

    useEffect(() => {
        const hasActivePetTimer = character.pets.some((p) => (p.training && Date.now() < p.training.endsAt) || Boolean(p.expedition));
        if (!hasActivePetTimer) return;
        const id = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [character.pets, tick]);

    function startTraining() {
        if (!selectedPet) return;
        if (isPetOnExpedition(selectedPet)) return alert(`${selectedPet.name} is away on an expedition.`);
        if (selectedPet.expedition) return alert(`${petDisplayName(selectedPet)} has an unclaimed expedition. Collect it first!`);
        if (selectedPet.training && Date.now() < selectedPet.training.endsAt) return alert(`${selectedPet.name} is already training.`);
        // Training builds stats through the level-ups it fuels, so a max-level pet
        // can't grow further — block it here (and the preview shows "Maxed").
        if (selectedPet.level >= selectedPet.maxLevel) return alert(`${petDisplayName(selectedPet)} is fully trained (Level ${selectedPet.maxLevel}).`);
        // Pet Tamer training-speed bonus shortens the wait but the durationMs
        // multiplier (which scales gains) stays at the picked tier so we
        // don't accidentally double-dip on payouts.
        const speedPct = petTamerTrainingSpeedPct(character);
        const effectiveDuration = Math.max(60_000, Math.floor(trainingDuration * Math.max(0.5, 1 - speedPct / 100)));
        updateCharacter({
            ...character,
            pets: character.pets.map((p) => p.id === selectedPet.id ? { ...p, training: { type: trainingType, endsAt: Date.now() + effectiveDuration, durationMs: trainingDuration } } : p),
        });
    }

    async function startExpedition() {
        if (!selectedPet) return;
        if (selectedPet.level < PET_EXPEDITION_UNLOCK_LEVEL) return alert(`${petDisplayName(selectedPet)} must reach Level ${PET_EXPEDITION_UNLOCK_LEVEL} before going on expeditions.`);
        if (selectedPet.training && Date.now() < selectedPet.training.endsAt) return alert(`${selectedPet.name} is training right now.`);
        if (isPetOnExpedition(selectedPet)) return alert(`${selectedPet.name} is already exploring.`);
        if (selectedPet.expedition) return alert(`${petDisplayName(selectedPet)} has an unclaimed expedition. Collect it first!`);
        const option = petExpeditionOptions.find(entry => entry.type === expeditionType) ?? petExpeditionOptions[0];

        // Pet Tamers mint a single-use server token at launch — the ONLY way to
        // earn expedition Ryo/drops/Tamer XP on collect (server requires it; no
        // fallback). Non-Tamers run expeditions for pet XP/stats only and need
        // no token. On a genuine server/network failure we block (don't waste an
        // expedition that would have earned currency). Past the daily reward cap
        // the trip still runs for pet XP/stats with no token — the same 12/day
        // currency ceiling as before, so no blocking prompt is needed.
        let token: string | undefined;
        if (character.profession === "petTamer") {
            let data: { token?: string; reason?: string } | null;
            try {
                const r = await fetch('/api/missions/expedition-start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerName: character.name, petId: selectedPet.id, expType: option.type, petLevel: selectedPet.level }),
                });
                if (!r.ok) return alert("Couldn't start the expedition (server error). Please try again.");
                data = await r.json();
            } catch {
                return alert("Couldn't reach the expedition server. Please try again.");
            }
            token = typeof data?.token === "string" ? data.token : undefined;
            // No token AND not the daily-cap path means an unexpected response —
            // don't burn an expedition that should have earned rewards.
            if (!token && data?.reason !== "daily-mint-cap") {
                return alert("Couldn't start the expedition. Please try again.");
            }
        }

        updateCharacter({
            ...character,
            activePetId: character.activePetId === selectedPet.id ? undefined : character.activePetId,
            activePetId2v2: character.activePetId2v2 === selectedPet.id ? undefined : character.activePetId2v2,
            pets: character.pets.map((p) => p.id === selectedPet.id ? { ...p, expedition: { type: option.type, startedAt: Date.now(), endsAt: Date.now() + option.durationMs, durationMs: option.durationMs, token } } : p),
        });
        alert(`${petDisplayName(selectedPet)} started ${option.label}. It cannot battle or join PvE until it returns.`);
    }

    function collectExpedition() {
        if (!selectedPet?.expedition) return;
        if (Date.now() < selectedPet.expedition.endsAt)
            return alert(`${petDisplayName(selectedPet)} returns in ${formatPetTimer(selectedPet.expedition.endsAt - Date.now())}.`);

        const expType = selectedPet.expedition.type;
        const durationHours = Math.max(1, selectedPet.expedition.durationMs / 3600000);

        // Per-type XP/ryo multipliers. ryo is computed server-side now (see
        // comment a few lines below), so the client multiplier is preserved
        // here as documentation only — prefixed with `_` to silence lint.
        const _ryoMult = expType === "scout" ? 1.35 : expType === "forage" ? 1.0 : 1.1;
        void _ryoMult;
        const xpMult  = expType === "forage" ? 1.45 : expType === "ruins"  ? 1.2 : 1.0;

        // Pet Tamer Phase 2 — base expedition reward bonus + daily First Expedition 2x.
        // Pet XP gain stays client-side (per-pet state, not global currency).
        // Ryo + drops are computed server-side via report-pet-event below.
        const tamerMult = petTamerExpeditionMult(character);
        const todayKey = currentDateKey();
        const firstResult = petTamerClaimFirstExpeditionToday(character, todayKey);
        const firstBonus = firstResult.isFirst ? 2 : 1;

        const xp       = Math.round(120 * durationHours * xpMult * tamerMult * firstBonus);
        const statGain = Math.max(1, Math.round(durationHours));

        const levelBefore = selectedPet.level;
        const returnedPet = capPetStats(gainPetXp({
            ...selectedPet,
            attack:  selectedPet.attack  + statGain,
            defense: selectedPet.defense + statGain + (expType === "ruins" ? statGain : 0),
            speed:   selectedPet.speed   + (expType === "scout"  ? statGain : 0),
            hp:      selectedPet.hp      + statGain * 5,
            expedition: undefined,
        }, xp));
        const leveledUp = returnedPet.level > levelBefore;

        const stories = petExpeditionStories[expType];
        const summary = stories[Math.floor(Math.random() * stories.length)];

        // Apply pet state changes immediately. Currencies (Ryo / drops) wait for
        // server response below to avoid client-trusted reward farming.
        const nextCharacter: Character = {
            ...firstResult.nextCharacter,
            pets: firstResult.nextCharacter.pets.map((p) => p.id === selectedPet.id ? returnedPet : p),
        };
        updateCharacter(nextCharacter);
        onImmediateSave?.(nextCharacter);

        setExpeditionResult({
            petName: petDisplayName(selectedPet),
            summary, expType, ryo: 0, xp, statGain,
            foundFate: 0, foundAura: 0, foundBone: 0, leveledUp,
        });

        // Tamer XP + daily First Expedition tracking + escort consumption are
        // all server-authoritative now. Client posts durationMinutes; server
        // computes XP and returns the post-grant character snapshot, which we
        // overlay onto local state to avoid a stale UI lag.
        if (character.profession === "petTamer") {
            const minutes = Math.floor(selectedPet.expedition.durationMs / 60_000);
            const longExpedition = minutes >= 240;
            fetch('/api/missions/report-pet-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerName: character.name,
                    event: longExpedition ? 'long-expedition' : 'expedition',
                    durationMinutes: minutes,
                    expType,
                    petLevel: selectedPet.level,
                    // Single-use token minted at launch; the server requires it
                    // (and that the run has fully elapsed) before paying out.
                    expeditionToken: selectedPet.expedition?.token,
                }),
            }).then(r => r.ok ? r.json() : null).then(data => {
                if (!data) return;
                const completed: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
                for (const m of completed) {
                    window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                        detail: { name: m.name, xp: m.xpReward, profession: 'petTamer' },
                    }));
                }
                // Apply server-granted currencies (Ryo + drops) on top of pet
                // state changes that already landed above. Server is source of
                // truth for currencies; client just mirrors.
                const ryoEarned = Number(data.ryoEarned ?? 0);
                const foundBone = Number(data.foundBone ?? 0);
                const foundAura = Number(data.foundAura ?? 0);
                const foundFate = Number(data.foundFate ?? 0);
                const escortConsumed = character.petEscortBonusReady && data.expeditionXp > 0;
                updateCharacter({
                    ...character,
                    ryo: (character.ryo ?? 0) + ryoEarned,
                    boneCharms: (character.boneCharms ?? 0) + foundBone,
                    auraStones: (character.auraStones ?? 0) + foundAura,
                    fateShards: (character.fateShards ?? 0) + foundFate,
                    professionXp: typeof data.professionXp === 'number' ? data.professionXp : (character.professionXp ?? 0),
                    professionRank: typeof data.professionRank === 'number' ? data.professionRank : (character.professionRank ?? 1),
                    petEscortBonusReady: escortConsumed ? false : character.petEscortBonusReady,
                });
                // Update the result modal so the player sees the actual Ryo/drops earned.
                setExpeditionResult(prev => prev ? ({ ...prev, ryo: ryoEarned, foundBone, foundAura, foundFate }) : prev);
                if (escortConsumed) {
                    window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                        detail: { name: '🐾 Pet Escort Bonus', xp: Math.floor((data.expeditionXp ?? 0) * (1 - 1 / 1.2)), profession: 'petTamer' },
                    }));
                }
            }).catch(() => { /* best-effort */ });
        }
    }

    function collectTraining() {
        if (!selectedPet?.training) return;
        if (Date.now() < selectedPet.training.endsAt) {
            return alert(`${selectedPet.name} needs ${formatPetTimer(selectedPet.training.endsAt - Date.now())} more.`);
        }
        // -10% pet training XP while the village is "demoralized" from a war loss,
        // and +Mentor mastery bonus (PvE/utility). Combined into one XP multiplier.
        const trainXpMult = warDebuff.xpMult * (1 + masteryBonus(character, "petTrainXpPct") / 100);
        const focus = selectedPet.training.type;
        const completedBase = collectPetTraining(selectedPet, trainXpMult);
        const gains = petTrainingGains(selectedPet);
        const baseXp = focus === "bond" ? gains.xp + Math.round(gains.xp * 0.35) : gains.xp;
        // Village pet-XP boost, applied with the SAME training focus so the bonus
        // XP's level-ups build the same stat the session was training.
        const bonusXp = Math.max(0, Math.round((boostAmount(baseXp, petXpBonus) - baseXp) * trainXpMult));
        const completed = bonusXp > 0 ? gainPetXp(completedBase, bonusXp, focus) : completedBase;
        const leveledUp = completed.level > selectedPet.level;
        updateCharacter({ ...character, pets: character.pets.map((p) => p.id === selectedPet.id ? completed : p) });
        alert(`${selectedPet.name} completed ${focus} training!${leveledUp ? ` Now Level ${completed.level}.` : ""}${bonusXp > 0 ? ` +${bonusXp} bonus pet XP.` : ""}`);
        // Pet Tamer mission progress for "pet-train" — rate-limited server-side.
        if (character.profession === "petTamer") {
            fetch('/api/missions/report-pet-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, event: 'pet-train' }),
            }).then(r => r.ok ? r.json() : null).then(data => {
                const completedMissions: Array<{ id: string; name: string; xpReward: number }> = Array.isArray(data?.missionsCompleted) ? data.missionsCompleted : [];
                for (const m of completedMissions) {
                    window.dispatchEvent(new CustomEvent('profession-mission-complete', {
                        detail: { name: m.name, xp: m.xpReward, profession: 'petTamer' },
                    }));
                }
            }).catch(() => { /* best-effort */ });
        }
    }

    function inventoryCount(itemId: string) {
        return countItem(character, itemId);
    }

    // Equip a glow collar (or clear it with id = undefined) on the selected
    // pet's Collar slot. Cosmetic unlock model: the collar stays in inventory
    // and can be equipped on any pet, so equipping just records the id.
    function equipCollar(collarId?: string) {
        if (!selectedPet) return;
        if (collarId && !ownsItem(character, collarId)) return;
        updateCharacter({
            ...character,
            pets: character.pets.map((p) => p.id === selectedPet.id
                ? { ...p, loadout: { ...p.loadout, collar: collarId } }
                : p),
        });
    }

    // Equip PVP battle gear (or clear with id = undefined) on the selected pet.
    // Same unlock model as collars: the gear stays in inventory and can be
    // equipped on any pet, so this just records the id on pet.loadout.pvp.
    function equipPvpGear(gearId?: string) {
        if (!selectedPet) return;
        if (gearId && !ownsItem(character, gearId)) return;
        updateCharacter({
            ...character,
            pets: character.pets.map((p) => p.id === selectedPet.id
                ? { ...p, loadout: { ...p.loadout, pvp: gearId } }
                : p),
        });
    }

    // Equip a battle consumable (or clear with id = undefined). It's installed
    // from inventory into the slot and spent the next time the pet fights;
    // unequipping before then returns it to inventory.
    function equipConsumable(consumableId?: string) {
        if (!selectedPet) return;
        const current = selectedPet.loadout?.consumable;
        if (consumableId === current) return;
        if (consumableId && !ownsItem(character, consumableId)) return;
        // Install the new one (consume from the stack) and return the old one.
        let next = character;
        if (consumableId) next = removeItem(next, consumableId, 1);
        if (current) next = addItem(next, current, 1);
        updateCharacter({
            ...next,
            pets: character.pets.map((p) => p.id === selectedPet.id
                ? { ...p, loadout: { ...p.loadout, consumable: consumableId } }
                : p),
        });
    }

    // Equip PVE companion gear (or clear with id = undefined). Consumable model:
    // equipping installs one piece from inventory at full durability; the piece
    // already in the slot is discarded (its remaining durability is lost).
    function equipPveGear(gearId?: string) {
        if (!selectedPet) return;
        const current = selectedPet.loadout?.pve;
        if (gearId === current) return; // no change
        if (gearId && !ownsItem(character, gearId)) return; // must own one to install
        const next = gearId ? removeItem(character, gearId, 1) : character;
        updateCharacter({
            ...next,
            pets: character.pets.map((p) => p.id === selectedPet.id
                ? { ...p, loadout: { ...p.loadout, pve: gearId, pveDurability: gearId ? PET_PVE_DURABILITY : undefined } }
                : p),
        });
    }

    function petSelectedPet() {
        if (!selectedPet) return;
        setPetHeartBurst(Date.now());
        const happierPet = increasePetHappiness(selectedPet);
        updateCharacter({
            ...character,
            pets: character.pets.map((p) => p.id === selectedPet.id ? happierPet : p),
        });
    }

    function feedPet(treat: typeof petFeedItems[number]) {
        if (!selectedPet) return;
        if (!ownsItem(character, treat.id)) {
            return alert(`You need ${treat.name} to feed ${selectedPet.name}.`);
        }

        const fedPet = increasePetHappiness(gainPetXp(selectedPet, treat.xp));
        updateCharacter({
            ...removeItem(character, treat.id, 1),
            pets: character.pets.map((p) => p.id === selectedPet.id ? fedPet : p),
        });
        alert(`${selectedPet.name} ate ${treat.name} and gained ${treat.xp} XP. Happiness +10%.${fedPet.level > selectedPet.level ? ` Level ${fedPet.level}!` : ""}`);
    }

    function setNickname() {
        if (!selectedPet) return;
        const nick = nicknameInput.trim();
        if (!nick) { setNicknameMsg("Enter a nickname first."); return; }
        if (nick.length > 24) { setNicknameMsg("Max 24 characters."); return; }
        if (character.fateShards < 10) { setNicknameMsg("❌ Need 10 Fate Shards."); return; }
        updateCharacter({
            ...character,
            fateShards: character.fateShards - 10,
            pets: character.pets.map(p => p.id === selectedPet.id ? { ...p, nickname: nick } : p),
        });
        setNicknameInput("");
        setNicknameMsg(`✅ Nickname set to "${nick}"`);
    }

    function releasePet() {
        if (!selectedPet) return;
        if (!confirm(`Release ${selectedPet.name}? This cannot be undone.`)) return;
        const updatedPets = character.pets.filter((p) => p.id !== selectedPet.id);
        updateCharacter({
            ...character,
            pets: updatedPets,
            activePetId: character.activePetId === selectedPet.id ? updatedPets[0]?.id : character.activePetId,
            activePetId2v2: character.activePetId2v2 === selectedPet.id ? undefined : character.activePetId2v2,
        });
        setSelectedPetId(updatedPets[0]?.id ?? "");
    }

    // Server-authoritative starter evolution. The endpoint validates the level
    // gate + consumes one stone + computes the evolved stats; we only mirror the
    // result (replace the pet, drop one consumed stone) into the local save.
    async function evolveSelectedPet() {
        if (!selectedPet || evolveBusy) return;
        const next = nextEvolution(selectedPet);
        if (!next) return;
        const stoneName = EVOLUTION_STONE_NAMES[next.requiredItem] ?? "evolution stone";
        if (selectedPet.level < next.requiredLevel) { setEvolveMsg(`❌ Reach level ${next.requiredLevel} first.`); return; }
        if (!character.inventory.includes(next.requiredItem)) { setEvolveMsg(`❌ Need ${stoneName} (Grand Marketplace).`); return; }
        if (!confirm(`Evolve ${petDisplayName(selectedPet)} into ${next.name}? This consumes 1 ${stoneName}.`)) return;
        const oldName = petDisplayName(selectedPet);
        const oldImage = selectedPet.image ?? selectedPet.bodyImage ?? `/pet-poses/${selectedPet.id}-idle.webp`;
        setEvolveBusy(true); setEvolveMsg("");
        try {
            const res = await fetch("/api/pet/evolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, petId: selectedPet.id }),
            });
            const data = await res.json().catch(() => ({})) as { pet?: Pet; error?: string };
            if (!res.ok || !data.pet) { setEvolveMsg(`❌ ${data.error ?? "Evolution failed."}`); setEvolveBusy(false); return; }
            // Point the evolved pet at its generated stage art (served from
            // public/pet-evos/<visualId>.webp). image/bodyImage are the universal
            // portrait/sprite source, so this lights up the cutscene reveal, the
            // Pet Yard portrait, and the arena sprite at once.
            const evoArt = `/pet-evos/${petVisualId(data.pet)}.webp`;
            const evolved: Pet = { ...data.pet, image: evoArt, bodyImage: evoArt };
            const invIdx = character.inventory.indexOf(next.requiredItem);
            const nextInventory = invIdx >= 0
                ? [...character.inventory.slice(0, invIdx), ...character.inventory.slice(invIdx + 1)]
                : character.inventory;
            updateCharacter({
                ...character,
                inventory: nextInventory,
                pets: character.pets.map((p) => (p.id === selectedPet.id ? evolved : p)),
            });
            if (petEvolveCutsceneEnabled()) {
                setEvolveCutscene({ pet: evolved, oldName, oldImage });
                setEvolveMsg("");
            } else {
                setEvolveMsg(`✅ Evolved into ${evolved.name}!`);
            }
        } catch {
            setEvolveMsg("❌ Network error — try again.");
        }
        setEvolveBusy(false);
    }

    const expTypeLabel: Record<PetExpeditionType, string> = { scout: "Scout Routes", forage: "Forage Wilds", ruins: "Explore Old Ruins" };
    const expTypeIcon:  Record<PetExpeditionType, string> = { scout: "🏃", forage: "🌿", ruins: "🏛️" };

    return (
        <div className="pet-yard-screen">

            {evolveCutscene && (
                <PetEvolutionCutscene
                    pet={evolveCutscene.pet}
                    oldName={evolveCutscene.oldName}
                    oldImage={evolveCutscene.oldImage}
                    newImage={evolveCutscene.pet.image}
                    onClose={() => setEvolveCutscene(null)}
                />
            )}

            {/* ── Expedition reward modal ── */}
            {expeditionResult && (
                <div className="expedition-result-backdrop" onClick={() => setExpeditionResult(null)}>
                    <div className="expedition-result-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="expedition-result-header">
                            <span className="expedition-result-icon">{expTypeIcon[expeditionResult.expType]}</span>
                            <div>
                                <h3 className="expedition-result-title">{expeditionResult.petName} has returned!</h3>
                                <p className="expedition-result-type">{expTypeLabel[expeditionResult.expType]}</p>
                            </div>
                        </div>

                        <p className="expedition-result-story">
                            <em>{expeditionResult.petName}</em> {expeditionResult.summary}.
                        </p>

                        {expeditionResult.leveledUp && (
                            <div className="expedition-level-up">⭐ Level Up! Your pet grew stronger from this journey.</div>
                        )}

                        <div className="expedition-rewards-grid">
                            <div className="expedition-reward-row">
                                <span className="expedition-reward-icon">💰</span>
                                <span className="expedition-reward-label">Ryo</span>
                                <span className="expedition-reward-value">+{expeditionResult.ryo.toLocaleString()}</span>
                            </div>
                            <div className="expedition-reward-row">
                                <span className="expedition-reward-icon">✨</span>
                                <span className="expedition-reward-label">Pet XP</span>
                                <span className="expedition-reward-value">+{expeditionResult.xp.toLocaleString()}</span>
                            </div>
                            <div className="expedition-reward-row">
                                <span className="expedition-reward-icon">📈</span>
                                <span className="expedition-reward-label">Stats</span>
                                <span className="expedition-reward-value">+{expeditionResult.statGain} ATK / DEF / HP</span>
                            </div>
                            {expeditionResult.foundBone > 0 && (
                                <div className="expedition-reward-row expedition-reward-rare">
                                    <span className="expedition-reward-icon">🦴</span>
                                    <span className="expedition-reward-label">Bone Charm</span>
                                    <span className="expedition-reward-value">+{expeditionResult.foundBone}</span>
                                </div>
                            )}
                            {expeditionResult.foundAura > 0 && (
                                <div className="expedition-reward-row expedition-reward-rare">
                                    <span className="expedition-reward-icon">💎</span>
                                    <span className="expedition-reward-label">Aura Stone</span>
                                    <span className="expedition-reward-value">+{expeditionResult.foundAura}</span>
                                </div>
                            )}
                            {expeditionResult.foundFate > 0 && (
                                <div className="expedition-reward-row expedition-reward-legendary">
                                    <span className="expedition-reward-icon">🌟</span>
                                    <span className="expedition-reward-label">Fate Shard</span>
                                    <span className="expedition-reward-value">+{expeditionResult.foundFate}</span>
                                </div>
                            )}
                        </div>

                        <button className="admin-button" style={{ width: "100%", marginTop: 8 }} onClick={() => setExpeditionResult(null)}>
                            Claim Rewards
                        </button>
                    </div>
                </div>
            )}

            <div className="pet-yard-overlay">
                <div className="pet-yard-header">
                    <button className="back-btn" onClick={onBack}>← Back</button>
                    <div>
                        <h2>Pet Yard</h2>
                        <p className="hint">{character.pets.length}/5 pets · Town Hall Pet XP Bonus: {petXpBonus.toFixed(2)}%</p>
                    </div>
                    {character.activePetId && (
                        <p className="hint">Active: {character.pets.find((p) => p.id === character.activePetId)?.name ?? "—"}</p>
                    )}
                    {character.activePetId2v2 && (
                        <p className="hint">2v2 Partner: {character.pets.find((p) => p.id === character.activePetId2v2)?.name ?? "—"}</p>
                    )}
                </div>

                <div className="pet-slots-row">
                    {Array.from({ length: 5 }, (_, i) => {
                        const pet = character.pets[i];
                        return (
                            <div
                                key={i}
                                className={`pet-slot-card${pet ? (selectedPet?.id === pet.id ? " pet-selected" : "") : " pet-empty"}${character.activePetId === pet?.id ? " pet-active" : ""}`}
                                onClick={() => pet && setSelectedPetId(pet.id)}
                            >
                                {pet ? (
                                    <>
                                        <div className="pet-slot-avatar">
                                            {(() => {
                                                const avatar = petCardImage(pet);
                                                return avatar
                                                    ? <img src={avatar} alt={pet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                                    : <span className="pet-initials">{pet.name.slice(0, 2).toUpperCase()}</span>;
                                            })()}
                                        </div>
                                        <p className="pet-slot-name">{petDisplayName(pet)}</p>
                                        <span className={`pet-rarity-tag rarity-${pet.rarity}`}>{pet.rarity}</span>
                                        {pet.trait && <span className="pet-trait-tag">{pet.trait}</span>}
                                        {character.activePetId === pet.id && <span className="pet-active-tag">Active</span>}
                                        {character.activePetId2v2 === pet.id && <span className="pet-2v2-tag">2v2</span>}
                                        {pet.expedition && Date.now() < pet.expedition.endsAt && <span className="pet-training-tag">Exploring {formatPetTimer(pet.expedition!.endsAt - Date.now())}</span>}
                                        {pet.expedition && Date.now() >= pet.expedition.endsAt && <span className="pet-ready-tag" onClick={(e) => { e.stopPropagation(); setSelectedPetId(pet.id); }}>🎁 Claim</span>}
                                        {pet.training && Date.now() < pet.training.endsAt && (
                                            <span className="pet-training-tag">⏳ {formatPetTimer(pet.training.endsAt - Date.now())}</span>
                                        )}
                                        {pet.training && Date.now() >= pet.training.endsAt && (
                                            <span className="pet-ready-tag">✅ Ready</span>
                                        )}
                                    </>
                                ) : (
                                    <span className="pet-empty-label">Empty</span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {selectedPet ? (
                    <div className="pet-detail-panel">
                        <div className="pet-detail-left pet-profile-panel">
                            <div className="pet-heart-anchor">
                                {(() => {
                                    // Equipped collar tints the big profile avatar with the same
                                    // glow color it gives the pet in battle (prismatic cycles).
                                    const detailCollar = petCollarVisual(selectedPet.loadout?.collar);
                                    const detailGlowClass = detailCollar ? (detailCollar.prismatic ? " pet-collar-detail-prismatic" : " pet-collar-detail-glow") : "";
                                    const detailImg = petCardImage(selectedPet);
                                    return (
                                        <div
                                            className={`pet-detail-avatar${detailGlowClass}`}
                                            style={detailCollar ? { ["--collar-glow" as string]: detailCollar.glow } : undefined}
                                        >
                                            {detailImg ? <img src={detailImg} alt={selectedPet.name} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span className="pet-detail-initials">{selectedPet.name.slice(0, 2).toUpperCase()}</span>}
                                            {detailCollar?.prismatic && <span className="pet-collar-sparkles" aria-hidden="true" />}
                                        </div>
                                    );
                                })()}
                                {petHeartBurst > 0 && <span key={petHeartBurst} className="pet-heart-pop">❤️</span>}
                            </div>
                            <h3>{petDisplayName(selectedPet)}</h3>
                            {selectedPet.nickname && <p className="hint" style={{ fontSize: "0.72rem", marginTop: -4 }}>({selectedPet.name})</p>}
                            <p>Level {selectedPet.level} | {selectedPet.rarity}</p>
                            <p className="pet-xp-line">
                                XP {selectedPet.level >= selectedPet.maxLevel ? "MAX" : `${selectedPet.xp}/${petXpNeeded(selectedPet.level)}`}
                            </p>
                            <div style={{ marginTop: 8, width: "100%" }}>
                                <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                                    <input
                                        value={nicknameInput}
                                        onChange={e => { setNicknameInput(e.target.value); setNicknameMsg(""); }}
                                        placeholder={selectedPet.nickname ? `Current: ${selectedPet.nickname}` : "Set nickname…"}
                                        maxLength={24}
                                        style={{ flex: 1, fontSize: "0.8rem", padding: "3px 6px" }}
                                    />
                                    <button onClick={setNickname} style={{ fontSize: "0.75rem", padding: "3px 8px", whiteSpace: "nowrap" }}>
                                        🔮 10 Shards
                                    </button>
                                </div>
                                {nicknameMsg && <p className="hint" style={{ fontSize: "0.72rem", color: nicknameMsg.startsWith("✅") ? "#4ade80" : "#f87171" }}>{nicknameMsg}</p>}
                            </div>
                            <div className="pet-happiness-meter" style={{ ["--pet-happiness" as string]: `${petHappiness(selectedPet)}%` }}>
                                <div className="pet-happiness-meter-top">
                                    <strong>Happiness</strong>
                                    <span>{petHappiness(selectedPet)}%</span>
                                </div>
                                <div className="pet-happiness-track">
                                    <span />
                                </div>
                            </div>
                            <div className="pet-stats-grid">
                                <span>❤️ HP: {selectedPet.hp}</span>
                                <span>⚔️ ATK: {selectedPet.attack}</span>
                                <span>🛡️ DEF: {selectedPet.defense}</span>
                                <span>💨 SPD: {selectedPet.speed}</span>
                            </div>
                            {selectedPet.description && <p className="pet-description">{selectedPet.description}</p>}
                            {(() => {
                                const next = nextEvolution(selectedPet);
                                if (!next) return null;
                                const stoneName = EVOLUTION_STONE_NAMES[next.requiredItem] ?? "Evolution Stone";
                                const hasLevel = selectedPet.level >= next.requiredLevel;
                                const hasStone = character.inventory.includes(next.requiredItem);
                                const ready = hasLevel && hasStone;
                                return (
                                    <section className="pet-evolve-panel" style={{ marginTop: 8, width: "100%", border: "1px solid #7c3aed", borderRadius: 8, padding: 8, background: "rgba(124,58,237,0.10)" }}>
                                        <h4 style={{ margin: "0 0 4px" }}>✨ Evolution</h4>
                                        <p className="hint" style={{ margin: "0 0 4px" }}>{petDisplayName(selectedPet)} → <strong>{next.name}</strong> <span style={{ textTransform: "capitalize" }}>({next.rarity})</span></p>
                                        <p className="hint" style={{ margin: "0 0 6px", fontSize: "0.72rem" }}>{next.description}</p>
                                        <ul style={{ margin: "0 0 6px", paddingLeft: 16, fontSize: "0.72rem", listStyle: "none" }}>
                                            <li style={{ color: hasLevel ? "#4ade80" : "#f87171" }}>{hasLevel ? "✓" : "✗"} Level {next.requiredLevel} (now {selectedPet.level})</li>
                                            <li style={{ color: hasStone ? "#4ade80" : "#f87171" }}>{hasStone ? "✓" : "✗"} {stoneName}</li>
                                        </ul>
                                        <button onClick={evolveSelectedPet} disabled={!ready || evolveBusy} style={{ width: "100%" }}>
                                            {evolveBusy ? "Evolving…" : ready ? `✨ Evolve into ${next.name}` : !hasLevel ? `Reach Lv ${next.requiredLevel}` : `Need ${stoneName}`}
                                        </button>
                                        {evolveMsg && <p className="hint" style={{ fontSize: "0.72rem", marginTop: 4, color: evolveMsg.startsWith("✅") ? "#4ade80" : "#f87171" }}>{evolveMsg}</p>}
                                    </section>
                                );
                            })()}
                            <div className="pet-care-actions">
                                <button onClick={petSelectedPet}>Pet +10% Happiness</button>
                            </div>
                            <section className="pet-feed-panel">
                                <h4>Feed</h4>
                                <div className="pet-feed-grid">
                                    {petFeedItems.map((treat) => {
                                        const count = inventoryCount(treat.id);
                                        return (
                                            <button key={treat.id} onClick={() => feedPet(treat)} disabled={count <= 0}>
                                                <strong>{treat.name}</strong>
                                                <span>+{treat.xp} XP | Owned {count}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                            <div className="menu">
                                <button onClick={() => updateCharacter({ ...character, activePetId: selectedPet.id })}>
                                    {character.activePetId === selectedPet.id ? "⭐ Active Pet" : "Set as Active"}
                                </button>
                                <button
                                    onClick={() => updateCharacter({
                                        ...character,
                                        activePetId2v2: character.activePetId2v2 === selectedPet.id ? undefined : selectedPet.id,
                                    })}
                                    title="The 2v2 partner pre-fills your reserve slot in the Pet Arena. It is never summoned into PvE."
                                >
                                    {character.activePetId2v2 === selectedPet.id ? "🐾 2v2 Partner" : "Set as 2v2 Partner"}
                                </button>
                                <button className="danger-button" onClick={releasePet}>Release</button>
                            </div>
                        </div>

                        <div className="pet-center-column">
                        <div className="pet-loadout-panel">
                            <h4>Loadout</h4>
                            <p className="hint" style={{ margin: "0 0 4px" }}>Pick a Collar to set your pet's battle glow. Other slots coming soon.</p>
                            <div className="pet-loadout-grid">
                                {PET_LOADOUT_SLOTS.map((slot) => {
                                    const equippedId = selectedPet.loadout?.[slot.key];
                                    if (slot.key === "collar") {
                                        const collar = petCollarById(equippedId);
                                        const visual = petCollarVisual(equippedId);
                                        const iconStyle = visual && !visual.prismatic ? { color: visual.glow, textShadow: `0 0 8px ${visual.glow}` } : undefined;
                                        return (
                                            <div
                                                key={slot.key}
                                                className={`pet-loadout-slot${equippedId ? " pet-loadout-filled" : ""}${visual?.prismatic ? " pet-collar-slot-prismatic" : ""}`}
                                                style={visual ? { ["--collar-glow" as string]: visual.glow } : undefined}
                                            >
                                                <span className={`pet-loadout-icon${visual?.prismatic ? " pet-collar-prismatic-text" : ""}`} style={iconStyle}>{slot.icon}</span>
                                                <span className="pet-loadout-label">{slot.label}</span>
                                                <span className="pet-loadout-value">{collar?.name ?? "Empty"}</span>
                                                <span className="pet-loadout-hint">{equippedId ? "Glow active" : slot.hint}</span>
                                            </div>
                                        );
                                    }
                                    if (slot.key === "pvp") {
                                        const gear = petPvpGearById(equippedId);
                                        return (
                                            <div key={slot.key} className={`pet-loadout-slot${equippedId ? " pet-loadout-filled" : ""}`}>
                                                <span className="pet-loadout-icon">{slot.icon}</span>
                                                <span className="pet-loadout-label">{slot.label}</span>
                                                <span className="pet-loadout-value">{gear?.name ?? "Empty"}</span>
                                                <span className="pet-loadout-hint">{gear ? gear.desc : slot.hint}</span>
                                            </div>
                                        );
                                    }
                                    if (slot.key === "consumable") {
                                        const cons = petConsumableById(equippedId);
                                        return (
                                            <div key={slot.key} className={`pet-loadout-slot${equippedId ? " pet-loadout-filled" : ""}`}>
                                                <span className="pet-loadout-icon">{slot.icon}</span>
                                                <span className="pet-loadout-label">{slot.label}</span>
                                                <span className="pet-loadout-value">{cons?.name ?? "Empty"}</span>
                                                <span className="pet-loadout-hint">{cons ? cons.desc : slot.hint}</span>
                                            </div>
                                        );
                                    }
                                    if (slot.key === "pve") {
                                        const gear = petPveGearById(equippedId);
                                        const dur = selectedPet.loadout?.pveDurability ?? 0;
                                        return (
                                            <div key={slot.key} className={`pet-loadout-slot${equippedId ? " pet-loadout-filled" : ""}`}>
                                                <span className="pet-loadout-icon">{slot.icon}</span>
                                                <span className="pet-loadout-label">{slot.label}</span>
                                                <span className="pet-loadout-value">{gear?.name ?? "Empty"}</span>
                                                <span className="pet-loadout-hint">{gear ? `${dur}/${PET_PVE_DURABILITY} summons left` : slot.hint}</span>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={slot.key} className={`pet-loadout-slot${equippedId ? " pet-loadout-filled" : ""}`}>
                                            <span className="pet-loadout-icon">{slot.icon}</span>
                                            <span className="pet-loadout-label">{slot.label}</span>
                                            <span className="pet-loadout-value">{equippedId ?? "Empty"}</span>
                                            <span className="pet-loadout-hint">{slot.hint}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            {(() => {
                                const owned = petCollars.filter((c) => ownsItem(character, c.id));
                                if (owned.length === 0) {
                                    return <p className="hint" style={{ margin: "8px 0 0" }}>Buy collars in the Grand Marketplace (Aura / Accessory, 🔮 Fate Shards) to glow your pet.</p>;
                                }
                                const current = selectedPet.loadout?.collar;
                                return (
                                    <div className="pet-collar-picker">
                                        <button
                                            type="button"
                                            className={`pet-collar-swatch pet-collar-none${current ? "" : " selected"}`}
                                            onClick={() => equipCollar(undefined)}
                                            title="No collar"
                                        >✕</button>
                                        {owned.map((c) => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className={`pet-collar-swatch${c.prismatic ? " pet-collar-swatch-prismatic" : ""}${current === c.id ? " selected" : ""}`}
                                                style={{ ["--collar-glow" as string]: c.glow }}
                                                onClick={() => equipCollar(c.id)}
                                                title={c.name}
                                                aria-label={c.name}
                                            />
                                        ))}
                                    </div>
                                );
                            })()}
                            {(() => {
                                const ownedGear = petPvpGear.filter((g) => ownsItem(character, g.id));
                                return (
                                    <div className="pet-gear-picker">
                                        <label>PVP Gear</label>
                                        {ownedGear.length === 0 ? (
                                            <p className="hint" style={{ margin: "2px 0 0" }}>Buy PVP gear in the Grand Marketplace (Aura / Accessory, 🔮 Fate Shards) to boost your pet in pet battles.</p>
                                        ) : (
                                            <select value={selectedPet.loadout?.pvp ?? ""} onChange={(e) => equipPvpGear(e.target.value || undefined)}>
                                                <option value="">None</option>
                                                {ownedGear.map((g) => (
                                                    <option key={g.id} value={g.id}>{g.name} — {g.desc}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                );
                            })()}
                            {(() => {
                                const equippedPveId = selectedPet.loadout?.pve;
                                const pveDur = selectedPet.loadout?.pveDurability ?? 0;
                                const ownedIds = petPveGear.filter((g) => ownsItem(character, g.id)).map((g) => g.id);
                                const optionIds = [...new Set([...(equippedPveId ? [equippedPveId] : []), ...ownedIds])];
                                if (optionIds.length === 0) {
                                    return (
                                        <div className="pet-gear-picker">
                                            <label>PVE Gear</label>
                                            <p className="hint" style={{ margin: "2px 0 0" }}>Craft PVE gear in the Crafter (Supplies) or buy it in the ryo Shop (Aura / Accessory). It wears out after {PET_PVE_DURABILITY} summons.</p>
                                        </div>
                                    );
                                }
                                return (
                                    <div className="pet-gear-picker">
                                        <label>PVE Gear</label>
                                        <select value={equippedPveId ?? ""} onChange={(e) => equipPveGear(e.target.value || undefined)}>
                                            <option value="">None</option>
                                            {optionIds.map((id) => {
                                                const g = petPveGearById(id);
                                                if (!g) return null;
                                                const isEquipped = id === equippedPveId;
                                                const ownCount = countItem(character, id);
                                                const label = isEquipped
                                                    ? `${g.name} — equipped (${pveDur}/${PET_PVE_DURABILITY})`
                                                    : `${g.name} — ${g.desc}${ownCount > 1 ? ` ×${ownCount}` : ""}`;
                                                return <option key={id} value={id}>{label}</option>;
                                            })}
                                        </select>
                                    </div>
                                );
                            })()}
                            {(() => {
                                const equippedConsId = selectedPet.loadout?.consumable;
                                const ownedIds = petConsumables.filter((c) => ownsItem(character, c.id)).map((c) => c.id);
                                const optionIds = [...new Set([...(equippedConsId ? [equippedConsId] : []), ...ownedIds])];
                                if (optionIds.length === 0) {
                                    return (
                                        <div className="pet-gear-picker">
                                            <label>Consumable</label>
                                            <p className="hint" style={{ margin: "2px 0 0" }}>Buy battle consumables in the ryo Shop (Aura / Accessory) or craft them in the Crafter (Supplies). Spent the next time your pet fights — 1v1, 2v2, or a PvE summon.</p>
                                        </div>
                                    );
                                }
                                return (
                                    <div className="pet-gear-picker">
                                        <label>Consumable</label>
                                        <select value={equippedConsId ?? ""} onChange={(e) => equipConsumable(e.target.value || undefined)}>
                                            <option value="">None</option>
                                            {optionIds.map((id) => {
                                                const c = petConsumableById(id);
                                                if (!c) return null;
                                                const isEquipped = id === equippedConsId;
                                                const ownCount = countItem(character, id);
                                                const label = isEquipped
                                                    ? `${c.name} — equipped`
                                                    : `${c.name} — ${c.desc}${ownCount > 1 ? ` ×${ownCount}` : ""}`;
                                                return <option key={id} value={id}>{label}</option>;
                                            })}
                                        </select>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="pet-training-panel">
                            <h4>Training</h4>
                            {character.profession === "petTamer" && (
                                <p className="hint" style={{ color: "#84cc16", margin: "0 0 6px" }}>
                                    🐾 Pet Tamer · training {petTamerTrainingSpeedPct(character)}% faster · expedition rewards ×{petTamerExpeditionMult(character).toFixed(2)}
                                </p>
                            )}
                            {canOfferEscort && (
                                <div className="summary-box" style={{ background: "rgba(132,204,22,0.08)", border: "1px solid rgba(132,204,22,0.35)", padding: 8, marginBottom: 8 }}>
                                    <strong style={{ color: "#84cc16", fontSize: "0.85rem" }}>🐾 Clan Pet Escort</strong>
                                    <p className="hint" style={{ margin: "4px 0 6px", fontSize: "0.75rem" }}>
                                        Offer your pet's escort to clan-mates for 1 hour. Vanguards in your clan get +5% Seals on raids with an active pet, and you get +20% Tamer XP on your next expedition.
                                    </p>
                                    <button
                                        onClick={() => void toggleEscort()}
                                        disabled={escortBusy || escortOffered === null}
                                        style={{ background: escortOffered ? "linear-gradient(#4d7c0f,#365314)" : "linear-gradient(#365314,#1a2e05)", borderColor: "#84cc16", fontSize: "0.8rem", padding: "4px 10px" }}
                                    >
                                        {escortBusy ? "…" : escortOffered ? "Cancel escort offer" : "Offer escort (1h)"}
                                    </button>
                                    {character.petEscortBonusReady && (
                                        <p className="hint" style={{ margin: "6px 0 0", color: "#84cc16", fontSize: "0.78rem" }}>
                                            🎁 +20% Tamer XP ready for your next expedition!
                                        </p>
                                    )}
                                </div>
                            )}
                            {selectedPet.training && Date.now() < selectedPet.training.endsAt ? (
                                <div className="training-in-progress">
                                    <p>⏳ {petTrainingOptions.find((o) => o.type === selectedPet.training?.type)?.label}</p>
                                    <p className="training-timer">{formatPetTimer(selectedPet.training.endsAt - Date.now())} remaining</p>
                                </div>
                            ) : selectedPet.training ? (
                                <div className="training-complete">
                                    <p>✅ {petTrainingOptions.find((o) => o.type === selectedPet.training?.type)?.label} complete!</p>
                                    <button className="admin-button" onClick={collectTraining}>Collect Results</button>
                                </div>
                            ) : (
                                <>
                                    <label>Training Type</label>
                                    <select value={trainingType} onChange={(e) => setTrainingType(e.target.value as PetTrainingType)}>
                                        {petTrainingOptions.map((opt) => (
                                            <option key={opt.type} value={opt.type}>{opt.label} — {opt.desc}</option>
                                        ))}
                                    </select>
                                    <label>Duration</label>
                                    <select value={trainingDuration} onChange={(e) => setTrainingDuration(Number(e.target.value))}>
                                        {petTrainingDurations.map((d) => (
                                            <option key={d.ms} value={d.ms}>{d.label}</option>
                                        ))}
                                    </select>
                                    <p className="hint">Expected gains: {petTrainingPreview(selectedPet, trainingType, trainingDuration)}</p>
                                    <button className="admin-button" onClick={startTraining}>Start Training</button>
                                </>
                            )}
                        </div>

                        <div className="pet-training-panel">
                            <h4>Expedition</h4>
                            {selectedPet.expedition && Date.now() < selectedPet.expedition.endsAt ? (
                                <div className="training-in-progress">
                                    <p>Exploring Badge Active</p>
                                    <p className="training-timer">{formatPetTimer(selectedPet.expedition.endsAt - Date.now())} remaining</p>
                                    <p className="hint">This pet cannot enter pet battles or PvE until it returns.</p>
                                </div>
                            ) : selectedPet.expedition ? (
                                <div className="training-complete">
                                    <p>Expedition complete!</p>
                                    <button className="admin-button" onClick={collectExpedition}>Collect Expedition</button>
                                </div>
                            ) : selectedPet.level < PET_EXPEDITION_UNLOCK_LEVEL ? (
                                <div className="pet-expedition-locked">
                                    <p className="pet-lock-title">🔒 Unlocks at Level {PET_EXPEDITION_UNLOCK_LEVEL}</p>
                                    <p className="hint">{petDisplayName(selectedPet)} is Level {selectedPet.level}. Train to Level {PET_EXPEDITION_UNLOCK_LEVEL} to send it on expeditions.</p>
                                </div>
                            ) : (
                                <>
                                    <label>Expedition Type</label>
                                    <select value={expeditionType} onChange={(e) => setExpeditionType(e.target.value as PetExpeditionType)}>
                                        {petExpeditionOptions.map((option) => <option key={option.type} value={option.type}>{option.label} ({option.durationLabel}) - {option.desc}</option>)}
                                    </select>
                                    <button className="admin-button" onClick={startExpedition}>Send Exploring</button>
                                    <p className="hint">Expeditions give ryo, pet XP, stat gains, and a chance for Aura Stones, Bone Charms, and Fate Shards.</p>
                                </>
                            )}
                        </div>
                        </div>

                        <div className="pet-info-panel">
                            <section className="pet-trait-display">
                                <h4>Trait</h4>
                                {selectedPet.trait ? (
                                    <>
                                        <strong>{selectedPet.trait}</strong>
                                        <p>{petTraitDescriptions[selectedPet.trait]}</p>
                                    </>
                                ) : (
                                    <p>No trait discovered.</p>
                                )}
                            </section>

                            <section className="pet-jutsu-panel">
                                <h4>Pet Jutsus</h4>
                                {selectedPet.jutsus.length === 0 ? (
                                    <p className="hint">This pet has no jutsu yet.</p>
                                ) : selectedPet.jutsus.map((jutsu, i) => {
                                    const kindMeta: Record<string, { icon: string; label: string; color: string }> = {
                                        damage:    { icon: "⚔",  label: "Damage",   color: "#fca5a5" },
                                        buff:      { icon: "⬆",  label: "Buff",     color: "#86efac" },
                                        heal:      { icon: "✚",  label: "Heal",     color: "#4ade80" },
                                        debuff:    { icon: "⬇",  label: "Debuff",   color: "#f97316" },
                                        dot:       { icon: "☠",  label: "Poison",   color: "#c084fc" },
                                        move:      { icon: "➡",  label: "Move",     color: "#93c5fd" },
                                        barrier:   { icon: "◇",  label: "Barrier",  color: "#7dd3fc" },
                                        movelock:  { icon: "⛓",  label: "Rootlock", color: "#fbbf24" },
                                        lifesteal: { icon: "🩸", label: "Lifesteal",color: "#f87171" },
                                        shield:    { icon: "🛡", label: "Shield",   color: "#7dd3fc" },
                                        absorb:    { icon: "✨", label: "Absorb",   color: "#a5b4fc" },
                                        crush:     { icon: "🪨", label: "Crush",    color: "#fca5a5" },
                                        burn:      { icon: "🔥", label: "Burn",     color: "#fb923c" },
                                        freeze:    { icon: "🧊", label: "Freeze",   color: "#7dd3fc" },
                                        confuse:   { icon: "🌀", label: "Confuse",  color: "#93c5fd" },
                                        stun:      { icon: "💫", label: "Stun",     color: "#fde047" },
                                        wound:     { icon: "🩸", label: "Wound",    color: "#f87171" },
                                        mark:      { icon: "🔻", label: "Mark",     color: "#f97316" },
                                        slow:      { icon: "🐌", label: "Slow",     color: "#7dd3fc" },
                                        haste:     { icon: "⚡", label: "Haste",    color: "#fde047" },
                                        taunt:     { icon: "❗", label: "Taunt",    color: "#f97316" },
                                        push:      { icon: "👊", label: "Push",     color: "#fca5a5" },
                                        pull:      { icon: "🪝", label: "Pull",     color: "#93c5fd" },
                                    };
                                    const km = kindMeta[jutsu.kind] ?? { icon: "✦", label: jutsu.kind, color: "#aaa" };
                                    return (
                                        <div key={i} className="pet-jutsu-row">
                                            <span className="pet-jutsu-kind-badge" style={{ color: km.color, borderColor: km.color }}>
                                                {km.icon} {km.label}
                                            </span>
                                            <strong>{jutsu.name}</strong>
                                            {jutsu.power > 0 && <span className="pet-jutsu-stat">P {jutsu.power}</span>}
                                            <span className="pet-jutsu-stat">CD {jutsu.cooldown}</span>
                                        </div>
                                    );
                                })}
                            </section>
                        </div>
                    </div>
                ) : (
                    <div className="pet-empty-state">
                        <p>You haven't captured any pets yet.</p>
                        <p>Explore the World Map to encounter and befriend pets!</p>
                        <button onClick={() => setScreen("worldMap")}>Go to World Map</button>
                    </div>
                )}
            </div>
        </div>
    );
}

const PET_EXPEDITION_UNLOCK_LEVEL = 20;

// Loadout slots shown above Training. The Collar slot is functional — pick any
// glow collar you own (see petCollars) from the swatch row below the grid.
// PVP / PVE / Consumable are visual scaffolds for now — they read their
// equipped item id off pet.loadout and render "Empty".
const PET_LOADOUT_SLOTS: Array<{ key: "collar" | "pvp" | "pve" | "consumable"; label: string; icon: string; hint: string }> = [
    { key: "collar",     label: "Collar",     icon: "✨", hint: "Glowing battle aura" },
    { key: "pvp",        label: "PVP",        icon: "⚔️", hint: "PvP gear" },
    { key: "pve",        label: "PVE",        icon: "🛡️", hint: "PvE gear" },
    { key: "consumable", label: "Consumable", icon: "🧪", hint: "Used in PvP & PvE" },
];
