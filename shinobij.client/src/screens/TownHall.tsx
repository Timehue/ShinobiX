/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { visiblePoll } from "../lib/poll";
import type { Character, ServerPlayerSummary } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { NoticePostType } from "../types/clan";
import type { VillageUpgradeKey, Screen } from "../types/core";
import { LeaderPortrait } from "../components/Marks";
import { clampNumber, currentDateKey, currentMonthKey, makeId } from "../lib/utils";
import { cleanTreasuryItems, getAllItems, inventoryItemStacks, itemDisplayName, removeTreasuryItem } from "../lib/items";
import { addItem, removeItem, ownsItem } from "../lib/inventory";
import { dailyMissionsCompleted } from "../lib/character-progress";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { VILLAGE_UPGRADE_MAX_LEVEL, getBankInterestPercent, getHospitalDiscountPercent, getJutsuTrainingSpeedBonus, getMissionRewardBonus, getPetXpBonus, getShopDiscountPercent, getTownDefenseGuardBonus, getTrainingXpBonus, getVillageUpgrades, villageUpgradeCost, villageUpgradeDefinitions } from "../lib/village-upgrades";
import { makeNoticePost, normalizeNoticePosts, noticeTypeLabel } from "../lib/clan-notices";
import { postGuardQueue } from "../lib/clan-api";
import {
    HOLLOW_GATE_UNLOCK_COST,
    getPvpJutsuLoadout,
    loadVillageLeadershipImages,
    normalizeCharacter,
    villageLeadership,
    type DuelChallenge,
} from "../App";
import {
    cleanVillageTreasury,
    makeVillageDailyAgenda,
    normalizeAnbuAppointees,
} from "../lib/village-state";
import { postPlayerChallengeNotice, postVillageTreasuryDonation } from "../lib/player-api";
import { activeVillageWarsFor, extendHollowGateUnlock, hollowGateDaysLeft, HOLLOW_GATE_UNLOCK_DAYS, isHollowGateUnlocked, isVillageAnbu, loadVillageState, normalizeVillageState, saveVillageState, villageOwnedTerritories, VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX, type VillageAgendaTask, type VillageState, type VillageTreasury, type VillageTreasuryCurrencyKey } from "../lib/world-state";

// Server-authoritative Kage succession (mirrors api/village/_kage-challenge.ts —
// keep these in sync). The full rules + obligation math live server-side; the
// client only declares, presses the overlap clock, sends the duel, and renders.
const KAGE_CHALLENGE_SEAL_COST = 500;
const KAGE_CHALLENGE_MIN_LEVEL = 90;
const KAGE_CHALLENGE_MIN_CONTRIBUTION = 250;
type ServerKageChallenge = { challenger: string; status: "pending" | "accepted"; createdAt: number; obligationRemainingMs: number; battleId?: string };
type ServerKageState = { kageSystemUnlocked?: boolean; seatedKage?: string; firstLiberator?: string; challenge?: ServerKageChallenge | null; postDefenseGraceUntil?: number };
function formatObligation(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function TownHall({ character, updateCharacter, creatorItems, allServerPlayers, savedBloodlines, creatorJutsus, sharedImages, setScreen }: { character: Character; updateCharacter: (character: Character) => void; creatorItems: GameItem[]; allServerPlayers: ServerPlayerSummary[]; savedBloodlines: SavedBloodline[]; creatorJutsus: Jutsu[]; sharedImages: Record<string, string>; setScreen: (s: Screen) => void }) {
    const leadership = villageLeadership[character.village] ?? { kage: "Acting Kage Council", elders: ["First Elder", "Second Elder", "Third Elder"], atWar: false, pastWars: ["No recorded wars yet."] };
    const leadershipImages = loadVillageLeadershipImages()[character.village] ?? { kage: "", elders: ["", "", ""] };
    const upgrades = getVillageUpgrades(character);

    // Helper to get leader image: shows real player avatar if seated, falls back to admin image.
    // Priority: 1) current player's avatar, 2) shared images store, 3) roster character data, 4) admin NPC image
    const getLeaderImage = (playerName: string | undefined | null, fallbackImage: string | undefined): string => {
        if (!playerName) return fallbackImage ?? "";
        const nameLower = playerName.toLowerCase();
        // Check if the seated leader is the current player (excluded from allServerPlayers)
        if (character.name.toLowerCase() === nameLower && character.avatarImage) {
            return character.avatarImage;
        }
        // Check shared images store (avatars are stored here since base64 is stripped from saves)
        const sharedAvatar = sharedImages['avatar:' + nameLower];
        if (sharedAvatar) return sharedAvatar;
        // Check other players in the roster
        const player = allServerPlayers.find(p => p.name.toLowerCase() === nameLower);
        if (player?.character && typeof player.character === 'object') {
            const char = player.character as Record<string, unknown>;
            const avatarImage = char.avatarImage as string | undefined;
            if (avatarImage) return avatarImage;
        }
        return fallbackImage ?? "";
    };
    const totalUpgradeLevel = Object.values(upgrades).reduce((sum, level) => sum + level, 0);
    const [tab, setTab] = useState<"status" | "upgrades" | "treasury" | "guard" | "politics" | "notices">("status");
    const [state, setState] = useState<VillageState>(() => loadVillageState(character.village));
    const [donation, setDonation] = useState(1000);
    const [guardList, setGuardList] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [guardBusy, setGuardBusy] = useState(false);
    const [villageDonateItemId, setVillageDonateItemId] = useState("");
    const [villageSendItemId, setVillageSendItemId] = useState("");
    const [villageSendPlayer, setVillageSendPlayer] = useState("");
    const [villageSendCurrency, setVillageSendCurrency] = useState<VillageTreasuryCurrencyKey>("ryo");
    const [villageSendAmount, setVillageSendAmount] = useState(1);
    const [anbuAppointmentInputs, setAnbuAppointmentInputs] = useState<string[]>(() => normalizeAnbuAppointees(loadVillageState(character.village).anbuAppointees));
    // Authoritative Kage state (seat + active challenge) polled from the server.
    const [serverKage, setServerKage] = useState<ServerKageState | null>(null);
    // (Removed: warTargetVillage state — Town Hall no longer has its own
    // "Start Village War" bypass. The single canonical declare flow lives
    // in VillageWarScreen, gated by 500 Honor Seals + 7-day cooldown +
    // 1-hour pending window + single-war rule. Players click "Open
    // Village War Hall →" below to reach it.)
    const [villageNoticeType, setVillageNoticeType] = useState<NoticePostType>("order");
    const [villageNoticeTitle, setVillageNoticeTitle] = useState("");
    const [villageNoticeBody, setVillageNoticeBody] = useState("");
    const [villageNoticeSector, setVillageNoticeSector] = useState("");
    const allVillageItems = getAllItems(creatorItems);
    const villageInventoryStacks = inventoryItemStacks(character, allVillageItems);
    const villageTreasuryItems = cleanTreasuryItems(state.treasury.items);
    const villagePlayers = [
        character.name,
        ...allServerPlayers
            .filter(player => player.village === character.village)
            .map(player => player.name),
    ].filter((name, index, names) => Boolean(name) && names.indexOf(name) === index).sort((a, b) => a.localeCompare(b));
    useEffect(() => {
        const next = loadVillageState(character.village);
        setState(next);
        setAnbuAppointmentInputs(normalizeAnbuAppointees(next.anbuAppointees));
    }, [character.village]);
    useEffect(() => {
        const refreshVillageState = () => {
            const next = loadVillageState(character.village);
            setState(current => {
                const normalized = normalizeVillageState(character.village, next);
                if (JSON.stringify(current) === JSON.stringify(normalized)) return current;
                setAnbuAppointmentInputs(normalizeAnbuAppointees(normalized.anbuAppointees));
                return normalized;
            });
        };
        refreshVillageState();
        return visiblePoll(refreshVillageState, 10000);
    }, [character.village]);
    useEffect(() => saveVillageState(character.village, state), [character.village, state]);
    // Poll authoritative kage state (seat + active challenge) so every player
    // sees the same seated Kage and the live challenge. Replaces the old
    // one-shot fetch; the seat still mirrors into `state` for the displays.
    useEffect(() => {
        let alive = true;
        const fetchKage = () => fetch(`/api/village/kage?village=${encodeURIComponent(character.village)}`)
            .then(r => r.ok ? r.json() : null)
            .then((serverState: ServerKageState | null) => {
                if (!alive || !serverState) return;
                setServerKage(serverState);
                if (serverState.kageSystemUnlocked) {
                    setState(prev => normalizeVillageState(character.village, {
                        ...prev,
                        kageSystemUnlocked: true,
                        seatedKage: serverState.seatedKage ?? prev.seatedKage,
                        firstLiberator: serverState.firstLiberator ?? prev.firstLiberator,
                    }));
                }
            })
            .catch(() => {});
        fetchKage();
        const stop = visiblePoll(fetchKage, 12_000);
        return () => { alive = false; stop(); };
    }, [character.village]);
    // Challenger drives the overlap "accept obligation" clock: while their
    // challenge is pending, press the server every ~25s. The server only burns
    // the Kage's obligation when BOTH are verifiably online, so an offline Kage
    // can't be forfeited unfairly and an AFK challenger can't steal the seat.
    useEffect(() => {
        const ch = serverKage?.challenge;
        if (!ch || ch.status !== "pending") return;
        if (ch.challenger.toLowerCase() !== character.name.toLowerCase()) return;
        let alive = true;
        const press = () => fetch("/api/village/kage-challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "press", village: character.village, playerName: character.name }),
        })
            .then(r => r.ok ? r.json() : null)
            .then((res: { forfeited?: boolean; obligationRemainingMs?: number } | null) => {
                if (!alive || !res) return;
                if (res.forfeited) { setServerKage(prev => prev ? { ...prev, seatedKage: character.name, challenge: null } : prev); return; }
                if (typeof res.obligationRemainingMs === "number") {
                    setServerKage(prev => prev?.challenge ? { ...prev, challenge: { ...prev.challenge, obligationRemainingMs: res.obligationRemainingMs! } } : prev);
                }
            })
            .catch(() => {});
        press();
        const stop = visiblePoll(press, 25_000);
        return () => { alive = false; stop(); };
        // Interval keyed on the challenge IDENTITY (status + challenger), not the
        // whole challenge object — which mutates every poll (obligationRemainingMs)
        // and would otherwise restart the 25s interval on every tick. Intentional.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverKage?.challenge?.status, serverKage?.challenge?.challenger, character.name, character.village]);
    useEffect(() => { if (tab !== "guard" && tab !== "status") return; fetch("/api/village-guard/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ village: character.village }) }).then(r => r.ok ? r.json() : []).then(list => setGuardList(Array.isArray(list) ? list : [])).catch(() => setGuardList([])); }, [tab, character.village, character.guardQueued]);
    function updateVillageState(next: VillageState) { const normalized = normalizeVillageState(character.village, next); setState(normalized); saveVillageState(character.village, normalized); }
    function addNotice(text: string, nextState: VillageState = state) { const post = makeNoticePost("general", "Village Notice", text, "System", "System"); return { ...nextState, notices: [text, ...nextState.notices].slice(0, 8), noticePosts: normalizeNoticePosts([post, ...nextState.noticePosts]) }; }
    // (Removed: beginVillageWar — Town Hall's bypass declare path. The
    // canonical declare flow is VillageWarScreen.declareWar which POSTs
    // through /api/world-state with all the new server-side gates
    // applied: 500 Honor Seals cost, 7-day cooldown, single-war rule,
    // 1-hour pending window. The old function wrote straight to KV via
    // the cache and silently swallowed server rejections.)
    function upgradeTownFeature(key: VillageUpgradeKey) { if (!isSeatedKage) return alert("Only the seated Kage can upgrade village structures."); const currentLevel = upgrades[key]; if (currentLevel >= VILLAGE_UPGRADE_MAX_LEVEL) return alert("This village upgrade is already maxed at level 50."); const cost = villageUpgradeCost(key, currentLevel); if ((character.honorSeals ?? 0) < cost) return alert(`Not enough Honor Seals. You need ${cost.toLocaleString()} Honor Seals.`); updateCharacter({ ...character, honorSeals: (character.honorSeals ?? 0) - cost, villageUpgrades: { ...upgrades, [key]: currentLevel + 1 } }); updateVillageState(addNotice(`${character.name} spent ${cost.toLocaleString()} Honor Seals to upgrade ${villageUpgradeDefinitions.find(def => def.key === key)?.name ?? key} to level ${currentLevel + 1}.`, { ...state, contributionPoints: state.contributionPoints + 10 })); }
    function purchaseHollowGateUnlock() {
        if (!isSeatedKage) return alert("Only the seated Kage can open the Hollow Gate.");
        const cost = HOLLOW_GATE_UNLOCK_COST;
        if ((character.honorSeals ?? 0) < cost) return alert(`Not enough Honor Seals. The Hollow Gate seal demands ${cost.toLocaleString()} Honor Seals.`);
        const wasOpen = isHollowGateUnlocked(state);
        const until = extendHollowGateUnlock(state.hollowGateUnlockedUntil);
        const notice = wasOpen
            ? `${character.name} renewed the Hollow Gate seal for ${cost.toLocaleString()} Honor Seals. The shrine stays open until ${new Date(until).toLocaleDateString()}.`
            : `${character.name} broke the Hollow Gate seal for ${cost.toLocaleString()} Honor Seals. The shrine has revealed itself on the World Map until ${new Date(until).toLocaleDateString()}.`;
        updateCharacter({ ...character, honorSeals: (character.honorSeals ?? 0) - cost });
        updateVillageState(addNotice(notice, { ...state, hollowGateUnlockedUntil: until, contributionPoints: state.contributionPoints + 25 }));
    }
    async function donateVillageRyo() {
        const amount = Math.max(1, Math.floor(donation));
        if (character.ryo < amount) return alert("Not enough ryo.");
        const treasury = await postVillageTreasuryDonation(character.name, character.village, { currency: "ryo", amount });
        if (!treasury) return;
        updateCharacter({ ...character, ryo: character.ryo - amount });
        updateVillageState(addNotice(`${character.name} donated ${amount.toLocaleString()} ryo to the village treasury.`, { ...state, treasury: cleanVillageTreasury(treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + Math.max(1, Math.floor(amount / 1000)) }));
    }
    async function donateVillageSpecial(currency: Exclude<VillageTreasuryCurrencyKey, "ryo">) {
        const current = character[currency] ?? 0;
        if (current < 1) return alert(`Not enough ${currency}.`);
        const treasury = await postVillageTreasuryDonation(character.name, character.village, { currency, amount: 1 });
        if (!treasury) return;
        updateCharacter({ ...character, [currency]: current - 1 } as Character);
        updateVillageState(addNotice(`${character.name} donated 1 ${currency} to the village treasury.`, { ...state, treasury: cleanVillageTreasury(treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + 5 }));
    }
    async function donateVillageItem() {
        if (!villageDonateItemId) return alert("Choose an item to donate.");
        if (!ownsItem(character, villageDonateItemId)) return alert("You do not have that item.");
        const treasury = await postVillageTreasuryDonation(character.name, character.village, { itemId: villageDonateItemId });
        if (!treasury) return;
        updateCharacter(removeItem(character, villageDonateItemId, 1));
        updateVillageState(addNotice(`${character.name} donated ${itemDisplayName(villageDonateItemId, allVillageItems)} to the village treasury.`, { ...state, treasury: cleanVillageTreasury(treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + 5 }));
    }
    async function sendVillageCurrency() {
        if (!isSeatedKage) return alert("Only the seated Kage can send village treasury resources.");
        const amount = Math.max(1, Math.floor(villageSendAmount));
        if (!villageSendPlayer) return alert("Choose a village player.");
        if ((state.treasury[villageSendCurrency] ?? 0) < amount) return alert("Not enough village treasury resources.");
        // Route through the dedicated server-side endpoint instead of the old
        // 2-write client flow (deduct-treasury + patch-recipient). The new
        // endpoint impersonates both ends under per-row locks and emits an
        // audit log, and is the only Kage-gift path that actually works for
        // non-admin Kages (cross-player save POSTs 403 outside this route).
        try {
            const r = await fetch("/api/village/treasury/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    village: character.village,
                    recipientName: villageSendPlayer,
                    currency: villageSendCurrency,
                    amount,
                }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        }
        // Reflect the deduction in the local cache + drop a notice. The
        // server has already persisted both sides; this is purely UX.
        // If the recipient is the actor (Kage gifting themselves), credit
        // their in-memory character too so the UI updates immediately.
        if (villageSendPlayer === character.name) {
            updateCharacter({ ...character, [villageSendCurrency]: (character[villageSendCurrency] ?? 0) + amount } as Character);
        }
        updateVillageState(addNotice(`${character.name} gifted ${amount.toLocaleString()} ${villageSendCurrency} to ${villageSendPlayer}.`, { ...state, treasury: { ...state.treasury, [villageSendCurrency]: state.treasury[villageSendCurrency] - amount } }));
    }
    async function sendVillageItem() {
        if (!isSeatedKage) return alert("Only the seated Kage can send village treasury items.");
        if (!villageSendPlayer) return alert("Choose a village player.");
        if (!villageSendItemId) return alert("Choose an item.");
        if (!state.treasury.items.some(stack => stack.itemId === villageSendItemId && stack.count > 0)) return alert("That item is not in the village treasury.");
        try {
            const r = await fetch("/api/village/treasury/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    village: character.village,
                    recipientName: villageSendPlayer,
                    itemId: villageSendItemId,
                }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        }
        if (villageSendPlayer === character.name) {
            updateCharacter(addItem(character, villageSendItemId, 1));
        }
        updateVillageState(addNotice(`${character.name} gifted ${itemDisplayName(villageSendItemId, allVillageItems)} to ${villageSendPlayer}.`, { ...state, treasury: { ...state.treasury, items: removeTreasuryItem(state.treasury.items, villageSendItemId) } }));
    }
    async function toggleTownGuard() { const queued = character.guardQueued ?? false; setGuardBusy(true); if (queued) { await postGuardQueue("dequeue", { name: character.name, village: character.village }); updateCharacter({ ...character, guardQueued: false }); updateVillageState(addNotice(`${character.name} left the Village Guard queue.`)); } else { await postGuardQueue("queue", { name: character.name, village: character.village, level: character.level, defenseBonusPercent: getTownDefenseGuardBonus(character) }); updateCharacter({ ...character, guardQueued: true }); updateVillageState(addNotice(`${character.name} joined the Village Guard queue with +${getTownDefenseGuardBonus(character).toFixed(1)}% defense.`)); } setGuardBusy(false); }
    const isSeatedKage = state.seatedKage === character.name;
    const hollowGateOpen = isHollowGateUnlocked(state);
    const hollowGateUntil = state.hollowGateUnlockedUntil ?? 0;
    const isAnbu = isVillageAnbu(character);
    const canPostVillageOrder = isSeatedKage || isAnbu || Boolean(character.elderFocus);
    function postVillageNotice() {
        if (!canPostVillageOrder) return alert("Only the Kage, ANBU, or a selected Elder focus can post village orders.");
        const title = villageNoticeTitle.trim();
        const body = villageNoticeBody.trim();
        if (!title || !body) return alert("Add a title and message for the village order.");
        const role = isSeatedKage ? "Kage" : isAnbu ? "ANBU" : `${character.elderFocus} Elder`;
        const sector = villageNoticeSector ? clampNumber(Math.floor(Number(villageNoticeSector)), 1, 60) : undefined;
        const notice = makeNoticePost(villageNoticeType, title, body, character.name, role, villageNoticeType === "order", sector);
        updateVillageState({ ...state, noticePosts: normalizeNoticePosts([notice, ...state.noticePosts]) });
        setVillageNoticeTitle("");
        setVillageNoticeBody("");
        setVillageNoticeSector("");
    }
    function removeVillageNotice(id: string) {
        updateVillageState({ ...state, noticePosts: state.noticePosts.filter(notice => notice.id !== id) });
    }
    function toggleVillageNoticePin(id: string) {
        updateVillageState({ ...state, noticePosts: normalizeNoticePosts(state.noticePosts.map(notice => notice.id === id ? { ...notice, pinned: !notice.pinned } : notice)) });
    }
    async function declareChallenge() {
        if (!serverKage?.kageSystemUnlocked) return alert("The Kage system is still sealed for this village.");
        const seatedKage = serverKage.seatedKage;
        if (!seatedKage) return alert("No seated Kage is available to challenge yet.");
        if (seatedKage.toLowerCase() === character.name.toLowerCase()) return alert("You are already the seated Kage.");
        if (!window.confirm(`Declare a Kage challenge against ${seatedKage}? This stakes ${KAGE_CHALLENGE_SEAL_COST} Honor Seals. You must beat them in a duel — and they must accept it or forfeit the seat.`)) return;
        const res = await fetch("/api/village/kage-challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "declare", village: character.village, playerName: character.name }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; challenge?: ServerKageChallenge };
        if (!res.ok || !data.ok) return alert(data.error || "Could not declare the challenge.");
        // Reflect the server-side 500-seal debit locally; the autosave re-asserts
        // the debited balance and the two converge (same pattern as the agenda /
        // map-control reward endpoints).
        updateCharacter({ ...character, honorSeals: Math.max(0, (character.honorSeals ?? 0) - KAGE_CHALLENGE_SEAL_COST) });
        setServerKage(prev => prev ? { ...prev, challenge: data.challenge ?? prev.challenge } : prev);
        alert(`Challenge declared against ${seatedKage}. Catch them online and send the official duel — they must accept it or forfeit the seat.`);
    }
    async function sendKageDuel() {
        const targetName = serverKage?.seatedKage;
        if (!targetName || targetName.toLowerCase() === character.name.toLowerCase()) return;
        const duel: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: targetName,
            challenger: character,
            challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
            challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            createdAt: Date.now(),
            mode: "standard",
            kageVillage: character.village,
        };
        const sent = await postPlayerChallengeNotice(targetName, duel);
        if (!sent) return alert(`${targetName} is not reachable right now. Try again while they're online.`);
        alert(`Official Kage duel sent to ${targetName}. They must accept it — or keep burning their accept obligation until they forfeit the seat.`);
    }
    function supportVillageFocus(focus: string, elderFocusKey: "war" | "trade" | "training") {
        updateVillageState(addNotice(`${character.name} selected the ${focus} elder focus.`, { ...state, contributionPoints: state.contributionPoints + 10 }));
        updateCharacter({ ...character, elderFocus: elderFocusKey });
    }
    function updateAnbuAppointmentInput(index: number, value: string) {
        setAnbuAppointmentInputs(inputs => inputs.map((input, inputIndex) => inputIndex === index ? value : input));
    }
    function appointAnbu(index: number) {
        if (!isSeatedKage) return alert("Only the seated Kage can appoint ANBU seats.");
        const requestedName = anbuAppointmentInputs[index]?.trim();
        if (!requestedName) return alert("Choose or type a village player name.");
        const matchedName = villagePlayers.find(name => name.toLowerCase() === requestedName.toLowerCase());
        if (!matchedName) return alert("That player is not in your village.");
        const nextAppointees = normalizeAnbuAppointees(state.anbuAppointees).map((name, seatIndex) => seatIndex === index ? matchedName : name);
        const duplicateSeat = nextAppointees.findIndex((name, seatIndex) => seatIndex !== index && name.toLowerCase() === matchedName.toLowerCase());
        if (duplicateSeat >= 0) nextAppointees[duplicateSeat] = "";
        setAnbuAppointmentInputs(nextAppointees);
        updateVillageState(addNotice(`${character.name} appointed ${matchedName} to ANBU seat ${index + 1}.`, { ...state, anbuAppointees: nextAppointees }));
    }
    function clearAnbuAppointment(index: number) {
        if (!isSeatedKage) return alert("Only the seated Kage can clear ANBU appointments.");
        const nextAppointees = normalizeAnbuAppointees(state.anbuAppointees).map((name, seatIndex) => seatIndex === index ? "" : name);
        setAnbuAppointmentInputs(nextAppointees);
        updateVillageState(addNotice(`${character.name} cleared ANBU seat ${index + 1}.`, { ...state, anbuAppointees: nextAppointees }));
    }
    const villageLevel = Math.max(1, Math.floor(totalUpgradeLevel / 8) + 1);
    const activeVillageWars = activeVillageWarsFor(character.village);
    const primaryVillageWar = activeVillageWars[0];
    const activeWarEnemyVillage = primaryVillageWar?.villages.find(village => village !== character.village);
    const villageStrength = totalUpgradeLevel * 25 + state.contributionPoints + guardList.length * 75;
    const population = 1000 + villageLevel * 90 + state.contributionPoints * 2;
    const contributionRankings = [{ name: character.name, role: "Candidate", points: state.contributionPoints + totalUpgradeLevel * 12 }, { name: leadership.elders[0] ?? "War Elder", role: "War Elder", points: totalUpgradeLevel * 8 + 120 }, { name: leadership.elders[1] ?? "Trade Elder", role: "Trade Elder", points: totalUpgradeLevel * 7 + 95 }, { name: leadership.elders[2] ?? "Training Elder", role: "Training Elder", points: totalUpgradeLevel * 6 + 80 }].sort((a, b) => b.points - a.points);
    const currentAnbuMonth = currentMonthKey();
    const anbuCandidateCharacters = [
        character,
        ...allServerPlayers
            .filter(player => player.character)
            .map(player => normalizeCharacter(player.character as Character)),
    ]
        .filter((player, index, players) => player.village === character.village && players.findIndex(candidate => candidate.name === player.name) === index);
    const anbuCandidates = anbuCandidateCharacters.map(player => ({
        name: player.name,
        level: player.level,
        rankTitle: player.rankTitle,
        monthlyKills: player.pvpKillMonth === currentAnbuMonth ? player.monthlyPvpKills ?? 0 : 0,
        totalKills: player.totalPvpKills ?? 0,
    }));
    const appointedAnbuSlots = normalizeAnbuAppointees(state.anbuAppointees).map(name => anbuCandidates.find(candidate => candidate.name.toLowerCase() === name.toLowerCase()) ?? null);
    const appointedNames = new Set(appointedAnbuSlots.flatMap(slot => slot ? [slot.name.toLowerCase()] : []));
    const earnedAnbuSlots = anbuCandidates
        .filter(candidate => !appointedNames.has(candidate.name.toLowerCase()))
        .sort((a, b) => b.monthlyKills - a.monthlyKills || b.totalKills - a.totalKills || b.level - a.level || a.name.localeCompare(b.name))
        .slice(0, 7);
    const anbuSlots = [...appointedAnbuSlots, ...Array.from({ length: 7 }, (_, index) => earnedAnbuSlots[index] ?? null)];
    const kageChallenge = serverKage?.challenge ?? null;
    const isKageChallenger = !!kageChallenge && kageChallenge.challenger.toLowerCase() === character.name.toLowerCase();
    const agenda = state.dailyAgenda.date === currentDateKey() ? state.dailyAgenda : makeVillageDailyAgenda(character.village);
    const ownedVillageSectors = villageOwnedTerritories(character.village);
    function agendaProgress(task: VillageAgendaTask) {
        if (task.kind === "missions") return dailyMissionsCompleted(character);
        if (task.kind === "explore") return character.dailyTilesExplored ?? 0;
        if (task.kind === "ai") return character.dailyAiKills ?? 0;
        if (task.kind === "pet") return character.dailyPetWins ?? 0;
        if (task.kind === "control") return ownedVillageSectors.length;
        return 0;
    }
    const agendaComplete = agenda.tasks.every(task => agendaProgress(task) >= task.target);
    const agendaClaimed = character.claimedVillageAgendaDate === agenda.date;
    async function claimVillageAgenda() {
        if (!agendaComplete) return alert("Complete all three village agenda goals first.");
        if (agendaClaimed) return alert("You already claimed today's village agenda.");
        // The shared village-treasury credit is now server-authoritative (fixed
        // amounts, once/day via an NX marker). We re-assert the returned treasury
        // (zero delta into the validator); contributionPoints + the personal
        // reward stay client-side (capped by the save sanitizer).
        let data: { ok?: boolean; alreadyClaimed?: boolean; error?: string; treasury?: Partial<VillageTreasury>; personal?: { alreadyClaimed?: boolean; granted?: { ryo: number; boneCharms: number; honorSeals: number } } };
        try {
            const res = await fetch("/api/village/claim-daily-agenda", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, village: character.village }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not claim the village agenda. Please try again.");
        } catch {
            return alert("Could not claim the village agenda. Please try again.");
        }
        const serverTreasury = cleanVillageTreasury(data.treasury as Partial<VillageTreasury>);
        // Personal reward is now server-authorized (audit #7 / Stage 3 Phase 2):
        // the endpoint credits the player's save under its own lock + day-marker
        // and returns the exact `granted` delta. We add that delta to our OWN
        // balance (preserving any concurrent ryo gains) and re-assert via the
        // autosave — converges with the server write. `grant` is null when the
        // personal half was already claimed today (gated independently of the
        // treasury marker), so a stale re-claim never double-credits.
        const grant = (data.personal && !data.personal.alreadyClaimed && data.personal.granted) ? data.personal.granted : null;
        if (data.alreadyClaimed) {
            // Treasury half already claimed today (another device) — sync it.
            updateVillageState(normalizeVillageState(character.village, { ...state, dailyAgenda: agenda, treasury: serverTreasury }));
        } else {
            const nextState = normalizeVillageState(character.village, { ...state, dailyAgenda: agenda, contributionPoints: state.contributionPoints + 15, treasury: serverTreasury });
            updateVillageState(addNotice(`${character.name} completed today's village agenda. Village treasury gained Honor Seals, ryo, and Bone Charms.`, nextState));
        }
        updateCharacter({
            ...character,
            claimedVillageAgendaDate: agenda.date,
            ...(grant ? {
                ryo: character.ryo + grant.ryo,
                honorSeals: (character.honorSeals ?? 0) + grant.honorSeals,
                boneCharms: (character.boneCharms ?? 0) + grant.boneCharms,
            } : {}),
        });
        if (data.alreadyClaimed && !grant) return alert("Today's village agenda was already claimed.");
    }
    const mapControlClaimed = character.claimedMapControlDate === currentDateKey();
    const mapControlRyo = ownedVillageSectors.length * 100;
    const mapControlHonor = ownedVillageSectors.length * 2;
    const mapControlBone = Math.floor(ownedVillageSectors.length / 3);
    async function claimMapControlRewards() {
        if (ownedVillageSectors.length <= 0) return alert("Your village does not control any sectors yet.");
        if (mapControlClaimed) return alert("You already claimed today's map control reward.");
        // The map-control reward is now server-authoritative (audit #7 / Stage 3
        // Phase 2): the server counts the village's owned world:territory:* sectors,
        // computes the payout (verbatim formula), and credits the player's save
        // under lock:save:<name> once per UTC day via an NX marker. We add the
        // returned `granted` delta to our OWN balance (preserving concurrent ryo
        // gains) and re-assert via autosave — converges with the server write. The
        // contributionPoints credit uses the SERVER sector count, so it can't be
        // inflated past the true owned-sector count.
        let data: { ok?: boolean; alreadyClaimed?: boolean; error?: string; sectors?: number; granted?: { ryo: number; honorSeals: number; boneCharms: number; fateShards: number } };
        try {
            const res = await fetch("/api/village/claim-map-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, village: character.village }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not claim the map control reward. Please try again.");
        } catch {
            return alert("Could not claim the map control reward. Please try again.");
        }
        const grant = (!data.alreadyClaimed && data.granted) ? data.granted : null;
        const serverSectors = Math.max(0, Math.floor(Number(data.sectors ?? 0)));
        updateCharacter({
            ...character,
            claimedMapControlDate: currentDateKey(),
            ...(grant ? {
                ryo: character.ryo + grant.ryo,
                honorSeals: (character.honorSeals ?? 0) + grant.honorSeals,
                boneCharms: (character.boneCharms ?? 0) + grant.boneCharms,
                fateShards: (character.fateShards ?? 0) + grant.fateShards,
            } : {}),
        });
        if (grant) {
            updateVillageState(addNotice(`${character.name} claimed map control rewards from ${serverSectors} village sector${serverSectors === 1 ? "" : "s"}.`, { ...state, contributionPoints: state.contributionPoints + serverSectors }));
        } else if (data.alreadyClaimed) {
            return alert("Today's map control reward was already claimed.");
        }
    }
    return <div className="card town-hall-screen">
        <div className="town-hall-hero"><div><p className="act-label">{character.village}</p><h2>Town Hall</h2><p className="hint">Village government, war records, guard defense, upgrades, treasury, and leadership.</p></div><div className="town-hall-wallet"><span>Honor Seals</span><strong>{(character.honorSeals ?? 0).toLocaleString()}</strong></div></div>
        <div className="clan-tabs expanded-tabs town-tabs"><button className={tab === "status" ? "active" : ""} onClick={() => setTab("status")}>Status</button><button className={tab === "upgrades" ? "active" : ""} onClick={() => setTab("upgrades")}>Upgrades</button><button className={tab === "treasury" ? "active" : ""} onClick={() => setTab("treasury")}>Treasury</button><button className={tab === "guard" ? "active" : ""} onClick={() => setTab("guard")}>Guard</button><button className={tab === "notices" ? "active" : ""} onClick={() => setTab("notices")}>Orders</button><button className={tab === "politics" ? "active" : ""} onClick={() => setTab("politics")}>Kage/Elders</button></div>
        {tab === "status" && <><div className="town-hall-grid"><section className="summary-box town-hall-panel"><h3>Village Status</h3><div className="town-leader-row"><LeaderPortrait image={getLeaderImage(state.seatedKage, leadershipImages.kage)} name={state.seatedKage ?? leadership.kage} fallback="?" /><p><strong>Kage:</strong> {state.seatedKage ?? leadership.kage}</p></div><p><strong>Population:</strong> {population.toLocaleString()}</p><p><strong>Village Level:</strong> {villageLevel}</p><p><strong>Village Strength:</strong> {villageStrength.toLocaleString()}</p><p><strong>Guard Queue:</strong> {guardList.length} active defender{guardList.length === 1 ? "" : "s"}</p></section><section className="summary-box town-hall-panel"><h3>War Status</h3><div className={primaryVillageWar ? "war-status at-war" : "war-status peace"}>{primaryVillageWar ? `At War with ${activeWarEnemyVillage}` : "Not At War"}</div>{primaryVillageWar ? <><p><strong>{character.village} HP:</strong> {primaryVillageWar.hp[character.village].toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()}</p><div className="bar enemy-bar"><span style={{ width: `${(primaryVillageWar.hp[character.village] / VILLAGE_WAR_HP_MAX) * 100}%` }} /></div><p><strong>{activeWarEnemyVillage} HP:</strong> {activeWarEnemyVillage ? primaryVillageWar.hp[activeWarEnemyVillage].toLocaleString() : 0} / {VILLAGE_WAR_HP_MAX.toLocaleString()}</p><div className="town-upgrade-bar"><span style={{ width: `${activeWarEnemyVillage ? (primaryVillageWar.hp[activeWarEnemyVillage] / VILLAGE_WAR_HP_MAX) * 100 : 0}%` }} /></div><p><strong>War Ground:</strong> Sector {primaryVillageWar.warGroundSector} · HP {primaryVillageWar.warGroundHp.toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()}</p><p className="hint">{primaryVillageWar.capturedBy ? `Captured by ${primaryVillageWar.capturedBy}.` : "Raid from the war ground to damage enemy village HP and the sector HP."}</p></> : <><p className="hint">Village wars start at 5,000 HP. Declare from the War Hall — costs 500 Honor Seals, 7-day cooldown between rematches, one war per village at a time.</p></>}<div className="menu" style={{ marginTop: "0.6rem" }}><button onClick={() => setScreen("villageWar")} style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171", fontWeight: 700 }}>⚔ Open Village War Hall →</button></div><h4>Current Village Buffs</h4><div className="village-buff-list"><span>Training +{getTrainingXpBonus(character).toFixed(2)}%</span><span>Jutsu Speed +{getJutsuTrainingSpeedBonus(character).toFixed(2)}%</span><span>Shop Discount +{getShopDiscountPercent(character).toFixed(2)}%</span><span>Guard DEF +{getTownDefenseGuardBonus(character).toFixed(2)}%</span><span>Pet XP +{getPetXpBonus(character).toFixed(2)}%</span><span>Bank Interest +{getBankInterestPercent(character).toFixed(2)}%</span><span>Mission Rewards +{getMissionRewardBonus(character).toFixed(2)}%</span><span>Hospital Discount +{getHospitalDiscountPercent(character).toFixed(2)}%</span>{character.elderFocus === "war" && <span>⚔️ War Focus: -1% dmg taken (wartime)</span>}{character.elderFocus === "trade" && <span>💰 Trade Focus: -5% shop costs</span>}{character.elderFocus === "training" && <span>📚 Training Focus: +10% XP, +10% jutsu speed</span>}</div></section></div><section className="summary-box"><h3>Daily Village Agenda</h3><p className="hint">Three village goals refresh each day. If there is no player Kage, the board randomizes automatically.</p><div className="contrib-rank-grid">{agenda.tasks.map(task => <div key={task.id} className="clan-guard-row"><span><strong>{task.label}</strong></span><span>{Math.min(agendaProgress(task), task.target).toLocaleString()} / {task.target.toLocaleString()}</span></div>)}</div><div className="menu"><button disabled={!agendaComplete || agendaClaimed} onClick={claimVillageAgenda}>{agendaClaimed ? "Agenda Claimed" : agendaComplete ? "Claim Agenda Rewards" : "Agenda Incomplete"}</button></div><p className="hint">Rewards: village treasury +15 Honor Seals, +1,500 ryo, +2 Bone Charms. Player: +8 Honor Seals, +750 ryo, +1 Bone Charm.</p></section><section className="summary-box"><h3>Map Control Rewards</h3><p>Your village controls <strong>{ownedVillageSectors.length}</strong> sector{ownedVillageSectors.length === 1 ? "" : "s"}.</p><p className="hint">Daily player reward: +{mapControlRyo.toLocaleString()} ryo, +{mapControlHonor.toLocaleString()} Honor Seals, +{mapControlBone.toLocaleString()} Bone Charms.</p><button disabled={ownedVillageSectors.length <= 0 || mapControlClaimed} onClick={claimMapControlRewards}>{mapControlClaimed ? "Map Reward Claimed" : "Claim Map Control Reward"}</button></section><section className={state.kageSystemUnlocked ? "summary-box kage-unlock-panel unlocked" : "summary-box kage-unlock-panel"}><h3>{state.kageSystemUnlocked ? "Kage System Open" : "Kage System Sealed"}</h3><p>{state.kageSystemUnlocked ? "The false Kage has fallen. The village is no longer ruled by secrecy. The Kage seat is now open." : "Clear your village's level 100 Kage story fight to open elections, elder seats, village upgrades, war access, and policy control."}</p>{state.firstLiberator && <p><strong>First Liberator:</strong> {state.firstLiberator}</p>}{state.seatedKage && <p><strong>Seated Kage:</strong> {state.seatedKage}</p>}</section><section className="summary-box town-notice-board"><h3>Village Notice Board</h3>{state.notices.map((notice, idx) => <p key={`${notice}-${idx}`}>• {notice}</p>)}</section><section className="summary-box"><h3>Detailed War Records</h3><div className="war-record-grid">{state.warRecords.map((war, idx) => <div key={`${war.opponent}-${idx}`} className="war-record-card"><strong>{war.winner} vs {war.opponent}</strong><span>{war.finalScore}</span><small>{war.date} · MVP Clan: {war.mvpClan}</small><small>Top Attacker: {war.topAttacker}</small><small>Top Defender: {war.topDefender}</small><small>Rewards: {war.rewards}</small></div>)}</div></section></>}
        {tab === "upgrades" && <section className="summary-box town-upgrade-summary"><h3>Village Upgrades</h3><p className="hint">Village upgrades now spend <strong>Honor Seals</strong>. Only the seated Kage can upgrade village structures.</p><p className="hint">Current Kage: <strong>{state.seatedKage ?? "No player seated yet"}</strong>{isSeatedKage ? " — you can upgrade structures." : " — upgrades are locked for your account."}</p><p className="hint">Total Village Development: <strong>{totalUpgradeLevel}</strong> / {VILLAGE_UPGRADE_MAX_LEVEL * villageUpgradeDefinitions.length}</p>
            <div className="town-upgrade-grid">
                <div className="town-upgrade-card" style={{ borderColor: hollowGateOpen ? "#a855f7" : "#7c3aed", boxShadow: hollowGateOpen ? "0 0 16px rgba(168,85,247,0.35)" : undefined }}>
                    <div className="town-upgrade-topline"><span className="town-upgrade-icon">⛩️</span><div><strong>Hollow Gate</strong><p>{hollowGateOpen ? `Sealed Door Opened — ${hollowGateDaysLeft(state)}d left` : `Sealed Door — ${HOLLOW_GATE_UNLOCK_DAYS}-Day Unlock`}</p></div></div>
                    <p className="town-upgrade-desc">A forbidden shrine between Sectors 1, 52 and 57. Breaking its chained seal opens the Hollow Gate Shrine on the World Map for {HOLLOW_GATE_UNLOCK_DAYS} days — a crawler of corrupted shinobi, traps, hidden chambers, and the Hollow Gate Warden. When the seal re-binds, the Kage must break it again.</p>
                    <p className="town-upgrade-bonus">{hollowGateOpen ? <span style={{ color: "#86efac" }}>Open until {new Date(hollowGateUntil).toLocaleDateString()} · re-break to add {HOLLOW_GATE_UNLOCK_DAYS} days.</span> : <>Cost: <strong>{HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals</strong> · {HOLLOW_GATE_UNLOCK_DAYS} days</>}</p>
                    <button disabled={!isSeatedKage || (character.honorSeals ?? 0) < HOLLOW_GATE_UNLOCK_COST} onClick={purchaseHollowGateUnlock}>{!isSeatedKage ? "Kage Only" : (character.honorSeals ?? 0) < HOLLOW_GATE_UNLOCK_COST ? `Need ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals` : hollowGateOpen ? `Extend +${HOLLOW_GATE_UNLOCK_DAYS} Days — ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals` : `Break the Seal — ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals`}</button>
                </div>
                {villageUpgradeDefinitions.map((upgrade) => { const level = upgrades[upgrade.key]; const bonus = level * upgrade.perLevel; const cost = villageUpgradeCost(upgrade.key, level); const maxed = level >= VILLAGE_UPGRADE_MAX_LEVEL; const canAfford = (character.honorSeals ?? 0) >= cost; return <div key={upgrade.key} className="town-upgrade-card"><div className="town-upgrade-topline"><span className="town-upgrade-icon">{upgrade.icon}</span><div><strong>{upgrade.name}</strong><p>Level {level}/{VILLAGE_UPGRADE_MAX_LEVEL}</p></div></div><div className="town-upgrade-bar"><span style={{ width: `${(level / VILLAGE_UPGRADE_MAX_LEVEL) * 100}%` }} /></div><p className="town-upgrade-desc">{upgrade.description}</p><p className="town-upgrade-bonus">Current Bonus: <strong>{bonus.toFixed(2)}{upgrade.unit}</strong></p><button disabled={!isSeatedKage || maxed || !canAfford} onClick={() => upgradeTownFeature(upgrade.key)}>{!isSeatedKage ? "Kage Only" : maxed ? "Max Level" : canAfford ? `Upgrade — ${cost.toLocaleString()} Honor Seals` : `Need ${cost.toLocaleString()} Honor Seals`}</button></div>; })}
            </div>
        </section>}
        {tab === "treasury" && <section className="summary-box"><h3>💰 Village Treasury</h3><p className="hint">Honor Seals are the village war and boost reserve for Kage spending.</p><div className="treasury-grid"><p><strong>Ryo:</strong> {state.treasury.ryo.toLocaleString()}</p><p><strong>Honor Seals:</strong> {state.treasury.honorSeals.toLocaleString()}</p><p><strong>Fate Shards:</strong> {state.treasury.fateShards}</p><p><strong>Bone Charms:</strong> {state.treasury.boneCharms}</p><p><strong>Aura Stones:</strong> {state.treasury.auraStones}</p><p><strong>Mythic Seals:</strong> {state.treasury.mythicSeals}</p><p><strong>Your Contribution:</strong> {state.contributionPoints} pts</p></div><label>Donate Ryo</label><input type="number" value={donation} onChange={(e) => setDonation(Number(e.target.value))} /><div className="menu"><button onClick={donateVillageRyo}>Donate Ryo</button><button onClick={() => donateVillageSpecial("honorSeals")}>Donate 1 Honor Seal</button><button onClick={() => donateVillageSpecial("fateShards")}>Donate 1 Fate Shard</button><button onClick={() => donateVillageSpecial("boneCharms")}>Donate 1 Bone Charm</button><button onClick={() => donateVillageSpecial("auraStones")}>Donate 1 Aura Stone</button><button onClick={() => donateVillageSpecial("mythicSeals")}>Donate 1 Mythic Seal</button></div><label>Donate Item</label><select value={villageDonateItemId} onChange={(e) => setVillageDonateItemId(e.target.value)}><option value="">Choose item</option>{villageInventoryStacks.map(stack => <option key={stack.itemId} value={stack.itemId}>{stack.name} x{stack.count}</option>)}</select><button onClick={donateVillageItem} disabled={!villageDonateItemId}>Donate Item</button><h4>Treasury Items</h4>{villageTreasuryItems.length === 0 ? <p className="hint">No donated items yet.</p> : <div className="treasury-grid">{villageTreasuryItems.map(stack => <p key={stack.itemId}><strong>{itemDisplayName(stack.itemId, allVillageItems)}:</strong> x{stack.count}</p>)}</div>}{isSeatedKage && <section className="summary-box"><h3>Kage Gift Village Treasury</h3><p className="hint">The seated Kage can gift donated resources or items to village players.</p><label>Recipient</label><select value={villageSendPlayer} onChange={(e) => setVillageSendPlayer(e.target.value)}><option value="">Choose village player</option>{villagePlayers.map(name => <option key={name} value={name}>{name}</option>)}</select><label>Resource</label><select value={villageSendCurrency} onChange={(e) => setVillageSendCurrency(e.target.value as VillageTreasuryCurrencyKey)}><option value="ryo">Ryo</option><option value="honorSeals">Honor Seals</option><option value="fateShards">Fate Shards</option><option value="boneCharms">Bone Charms</option><option value="auraStones">Aura Stones</option><option value="mythicSeals">Mythic Seals</option></select><input type="number" min={1} value={villageSendAmount} onChange={(e) => setVillageSendAmount(Number(e.target.value))} /><div className="menu"><button onClick={sendVillageCurrency}>Gift Resource</button></div><label>Item</label><select value={villageSendItemId} onChange={(e) => setVillageSendItemId(e.target.value)}><option value="">Choose treasury item</option>{villageTreasuryItems.map(stack => <option key={stack.itemId} value={stack.itemId}>{itemDisplayName(stack.itemId, allVillageItems)} x{stack.count}</option>)}</select><button onClick={sendVillageItem} disabled={!villageSendItemId}>Gift Donated Item</button></section>}</section>}
        {tab === "guard" && <section className="summary-box"><h3>Village Guard Queue</h3><p className="hint">Town Defense gives +0.1% defense per level vs Genjutsu, Taijutsu, Bukijutsu, and Ninjutsu while defending through this queue.</p><p>Current Town Defense Bonus: <strong>+{getTownDefenseGuardBonus(character).toFixed(2)}%</strong></p><button className={character.guardQueued ? "danger-button" : ""} onClick={toggleTownGuard} disabled={guardBusy}>{guardBusy ? "Updating…" : character.guardQueued ? "Leave Guard Queue" : "Queue as Village Guard"}</button><h4>Active Defenders</h4>{guardList.length === 0 ? <p className="hint">No active guards right now.</p> : <div className="clan-guard-list">{guardList.map(g => <div key={g.name} className="clan-guard-row"><span>🛡️ <strong>{g.name}</strong></span><span className="clan-guard-lvl">Lv. {g.level}{g.defenseBonusPercent ? ` · DEF +${g.defenseBonusPercent.toFixed(1)}%` : ""}</span></div>)}</div>}</section>}
        {tab === "notices" && <section className="summary-box town-notice-board"><h3>Official Village Orders</h3><p className="hint">Kage, ANBU, and Elders can post village-wide orders. Pinned orders stay at the top for everyone in {character.village}.</p>{canPostVillageOrder && <div className="summary-box"><div className="treasury-grid"><div><label>Type</label><select value={villageNoticeType} onChange={(event) => setVillageNoticeType(event.target.value as NoticePostType)}><option value="order">Kage / Elder Order</option><option value="raid">Raid Target</option><option value="guard">Guard Request</option><option value="medic">Medic Request</option><option value="trade">Trade / Supply</option><option value="general">General</option></select></div><div><label>Sector Optional</label><input type="number" min={1} max={60} value={villageNoticeSector} onChange={(event) => setVillageNoticeSector(event.target.value)} placeholder="1-60" /></div></div><label>Title</label><input value={villageNoticeTitle} maxLength={70} onChange={(event) => setVillageNoticeTitle(event.target.value)} placeholder="Example: Defend Sector 18 tonight" /><label>Message</label><textarea value={villageNoticeBody} maxLength={500} onChange={(event) => setVillageNoticeBody(event.target.value)} placeholder="Post orders, guard calls, raid targets, medic requests, or supply needs." /><button onClick={postVillageNotice} disabled={!villageNoticeTitle.trim() || !villageNoticeBody.trim()}>Post Village Order</button></div>}<div className="notice-board-list">{state.noticePosts.length === 0 ? <p className="hint">No village orders posted yet.</p> : state.noticePosts.map(notice => { const canEditNotice = isSeatedKage || notice.author === character.name; return <div key={notice.id} className={`notice-post ${notice.pinned ? "pinned" : ""}`}><div className="notice-post-head"><span>{notice.pinned ? "Pinned " : ""}{noticeTypeLabel(notice.type)}</span><small>{new Date(notice.createdAt).toLocaleString()} · {notice.author} · {notice.authorRole}</small></div><strong>{notice.title}</strong><p>{notice.body}</p>{notice.sector && <small>Sector {notice.sector}</small>}{canEditNotice && <div className="menu"><button onClick={() => toggleVillageNoticePin(notice.id)}>{notice.pinned ? "Unpin" : "Pin"}</button><button className="danger-button" onClick={() => removeVillageNotice(notice.id)}>Delete</button></div>}</div>; })}</div></section>}
        {tab === "politics" && <><section className="summary-box"><h3>Kage & Elder Seats</h3><div className="town-leader-row town-kage-card"><LeaderPortrait image={getLeaderImage(state.seatedKage, leadershipImages.kage)} name={state.seatedKage ?? leadership.kage} fallback="?" /><p><strong>Current Kage:</strong> {state.seatedKage ?? leadership.kage}</p></div><div className="elder-seat-grid"><div className={`elder-card${character.elderFocus === "war" ? " elder-card-active" : ""}`}><LeaderPortrait image={leadershipImages.elders?.[0]} name={leadership.elders[0]} fallback="?" /><span>War Elder</span><strong>{leadership.elders[0]}</strong><small className="elder-focus-desc">+1% damage reduction during village wars (applied to incoming damage in combat)</small><button className={character.elderFocus === "war" ? "active" : ""} onClick={() => supportVillageFocus("War Elder", "war")}>{character.elderFocus === "war" ? "✅ War Focus Active" : "Select War Focus"}</button></div><div className={`elder-card${character.elderFocus === "trade" ? " elder-card-active" : ""}`}><LeaderPortrait image={leadershipImages.elders?.[1]} name={leadership.elders[1]} fallback="?" /><span>Trade Elder</span><strong>{leadership.elders[1]}</strong><small className="elder-focus-desc">5% discount on all items in the Shop and Grand Marketplace</small><button className={character.elderFocus === "trade" ? "active" : ""} onClick={() => supportVillageFocus("Trade Elder", "trade")}>{character.elderFocus === "trade" ? "✅ Trade Focus Active" : "Select Trade Focus"}</button></div><div className={`elder-card${character.elderFocus === "training" ? " elder-card-active" : ""}`}><LeaderPortrait image={leadershipImages.elders?.[2]} name={leadership.elders[2]} fallback="?" /><span>Training Elder</span><strong>{leadership.elders[2]}</strong><small className="elder-focus-desc">+10% XP from all sources and 10% faster jutsu training</small><button className={character.elderFocus === "training" ? "active" : ""} onClick={() => supportVillageFocus("Training Elder", "training")}>{character.elderFocus === "training" ? "✅ Training Focus Active" : "Select Training Focus"}</button></div></div></section><section className="summary-box"><h3>ANBU Black Ops</h3><p className="hint">Seats 1-3 are appointed by the seated Kage. Seats 4-10 are earned by PvP kills this month ({currentAnbuMonth}).</p><datalist id="anbu-player-options">{villagePlayers.map(name => <option key={name} value={name} />)}</datalist>{isSeatedKage && <div className="treasury-grid">{[0, 1, 2].map(index => <div key={`anbu-appoint-${index}`}><label>Appointed Seat {index + 1}</label><input list="anbu-player-options" value={anbuAppointmentInputs[index] ?? ""} onChange={(event) => updateAnbuAppointmentInput(index, event.target.value)} placeholder="Type or choose player" /><div className="menu"><button onClick={() => appointAnbu(index)}>Appoint</button><button className="danger-button" onClick={() => clearAnbuAppointment(index)}>Clear</button></div></div>)}</div>}<div className="contrib-rank-grid">{anbuSlots.map((slot, idx) => <div key={`anbu-${idx}-${slot?.name ?? "empty"}`} className="clan-guard-row"><span>#{idx + 1} <strong>{slot?.name ?? "Open ANBU Seat"}</strong>{slot ? ` — ${slot.rankTitle}` : idx < 3 ? " — Kage appointed seat" : " — No qualifying player yet"}</span><span>{slot ? `${idx < 3 ? "Appointed" : "Earned"} · ${slot.monthlyKills.toLocaleString()} monthly PvP kill${slot.monthlyKills === 1 ? "" : "s"}` : "0 kills"}</span></div>)}</div><h4>ANBU Missions</h4><div className="contrib-rank-grid"><div className="clan-guard-row"><span>Scout enemy-controlled sectors</span><span>Reveal owner, HP, guards</span></div><div className="clan-guard-row"><span>Queue as sector guard</span><span>ANBU may guard any village sector</span></div><div className="clan-guard-row"><span>Sabotage raids</span><span>Support clan raids and defense pressure</span></div></div></section><section className="summary-box"><h3>Kage Challenge Board</h3><p className="hint">Beat the seated Kage in a duel to take the seat. Declaring costs {KAGE_CHALLENGE_SEAL_COST} Honor Seals and requires level {KAGE_CHALLENGE_MIN_LEVEL}+ with {KAGE_CHALLENGE_MIN_CONTRIBUTION}+ village contribution. The Kage must accept your duel or forfeit the seat.</p><div className="contrib-rank-grid">{contributionRankings.map((row, idx) => <div key={row.name} className="clan-guard-row"><span>#{idx + 1} <strong>{row.name}</strong> — {row.role}</span><span>{row.points.toLocaleString()} pts</span></div>)}</div>{kageChallenge ? <div className={`notice-post ${kageChallenge.status === "accepted" ? "pinned" : ""}`}><div className="notice-post-head"><span>{kageChallenge.status.toUpperCase()}</span><small>{new Date(kageChallenge.createdAt).toLocaleString()}</small></div><strong>{kageChallenge.challenger} vs {serverKage?.seatedKage}</strong><p>Kage accept obligation remaining: <strong>{formatObligation(kageChallenge.obligationRemainingMs)}</strong> of online overlap.</p>{isKageChallenger && <><div className="menu"><button onClick={() => void sendKageDuel()}>Send Official Duel</button></div><p className="hint">Stay online together to burn the Kage's accept obligation — if it hits 0:00 they forfeit the seat to you. Or just beat them in the duel.</p></>}{isSeatedKage && <p className="hint">{kageChallenge.challenger} is challenging you. Accept their incoming duel to defend — if your accept obligation hits 0:00 while you're online, you forfeit the seat.</p>}</div> : <><button onClick={() => void declareChallenge()} disabled={!serverKage?.kageSystemUnlocked || isSeatedKage}>Declare Kage Challenge ({KAGE_CHALLENGE_SEAL_COST} Seals)</button><p className="hint">{isSeatedKage ? "You hold the Kage seat." : "No active challenge right now."}</p></>}</section></>}
    </div>;
}

// Shop family (shop, card packs, grand marketplace) moved to ./components/Shop.
