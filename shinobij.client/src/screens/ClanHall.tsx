/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useEffect } from "react";
import { CLAN_RANK_COLOR, CLAN_RANK_ICON, CLAN_ROLE_ICON, CLAN_UPGRADE_MAX_LEVEL, clanMissionDefinitions } from "../constants/clan";
import { CLAN_UPGRADE_DEFS, clanUpgradeCost, isClanUpgradeMaxed } from "../lib/clan-upgrades";
import type { Character } from "../types/character";
import { ClanImageMark } from "../components/Marks";
import type { ClanJoinRequest, ClanMemberEntry, ClanTreasury, ClanTreasuryCurrencyKey, ClanUpgradeKey, ClanWarRecord, EnhancedClanData, NoticePostType } from "../types/clan";
import { ClanSealPool } from "../screens/ClanSealPool";
import type { GameItem } from "../types/combat";
import { TERRITORY_CONTROL_MAX, TERRITORY_CONTROL_SCROLL_ID, TERRITORY_HP_MAX, TERRITORY_REBUILD_COOLDOWN_MS } from "../constants/game";
import type { WeatherType, Screen } from "../types/core";
import { clanMissionProgress } from "../lib/clan-math";
import { CLAN_DOCTRINES, doctrineName, doctrineIcon, type ClanDoctrine } from "../lib/clan-doctrines";
import { addClanXp, canManageClan, clanBoostTiers, clanContribTotal, clanHallTier, clanMemberBoostPercent, clanRankOf, clanRoleOf, clanUpgradeBonus, clanXpNeeded, cleanClanTreasury, enhanceClanData } from "../lib/clan-math";
import { clanLore } from "../data/clan-lore";
import { postClanTreasuryDonation, postClanUpgradePurchase, postClanKick } from "../lib/player-api";
import { clampNumber } from "../lib/utils";
import { clanSlug, fetchClanData, fetchClanDataDetailed, postGuardQueue, writeClanData } from "../lib/clan-api";
import { cleanTreasuryItems, getAllItems, inventoryItemStacks, itemDisplayName, removeTreasuryItem } from "../lib/items";
import { removeItem, ownsItem } from "../lib/inventory";
import { getTownDefenseGuardBonus } from "../lib/village-upgrades";
import { makeNoticePost, normalizeNoticePosts, noticeTypeLabel } from "../lib/clan-notices";
import { readImageFile } from "../lib/shared-images";
import { villageForOutskirtsSector, villages } from "../data/sectors";
import { weatherEffects } from "../data/world";
import {
    ClanWarsPanel,
} from "../App";
import { claimPendingWarCrates, clanOwnedTerritories, clanTerritoryStartingScore, clanTerritoryWarMultiplier, damageSectorTerritory, grantTerritoryScrolls, isVillageAnbu, loadAllSectorTerritories, loadSectorTerritory, removeTerritoryScrolls, saveSectorTerritory, sectorRaidDamageAmount, territoryScrollCount, villageOwnedTerritories, villageTerritoryWarSupply, weatherForSector, type TerritoryBuffStat } from "../lib/world-state";

export function ClanHall({ character, updateCharacter, creatorItems, setScreen }: { character: Character; updateCharacter: (c: Character) => void; creatorItems: GameItem[]; setScreen: (s: Screen) => void }) {
    const lore = clanLore[character.village];
    const isInClan = !!character.clan;
    const [clanName, setClanName] = useState("");
    const [clanImage, setClanImage] = useState("");
    const [clanDoctrine, setClanDoctrine] = useState<ClanDoctrine>("warmonger");
    const [view, setView] = useState<"roster" | "guard" | "treasury" | "boosts" | "upgrades" | "missions" | "wars" | "territory" | "notices" | "hall">("roster");
    const [loading, setLoading] = useState(false);
    const [clanData, setClanData] = useState<EnhancedClanData | null>(null);
    // "ok" while data loaded fine, "notFound" when the server has no record
    // for this clan (e.g. it was wiped by a reset), "error" for transient
    // failures (network down, 5xx). Used to pick a clearer error UI.
    const [clanLoadStatus, setClanLoadStatus] = useState<"ok" | "notFound" | "error">("ok");
    const [availableClans, setAvailableClans] = useState<EnhancedClanData[]>([]);
    const [clanListLoading, setClanListLoading] = useState(false);
    const [guardList, setGuardList] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [guardBusy, setGuardBusy] = useState(false);
    const [donation, setDonation] = useState(1000);
    const [clanDonateItemId, setClanDonateItemId] = useState("");
    const [clanSendItemId, setClanSendItemId] = useState("");
    const [clanSendPlayer, setClanSendPlayer] = useState("");
    const [clanSendCurrency, setClanSendCurrency] = useState<ClanTreasuryCurrencyKey>("ryo");
    const [clanSendAmount, setClanSendAmount] = useState(1);
    const [territorySector, setTerritorySector] = useState(40);
    const [territoryWeather, setTerritoryWeather] = useState<WeatherType>("clear");
    const [territoryBuffStat, setTerritoryBuffStat] = useState<TerritoryBuffStat>("bukijutsuOffense");
    const [territoryRefresh, setTerritoryRefresh] = useState(0);
    const [clanNoticeType, setClanNoticeType] = useState<NoticePostType>("clan");
    const [clanNoticeTitle, setClanNoticeTitle] = useState("");
    const [clanNoticeBody, setClanNoticeBody] = useState("");
    const [clanNoticeSector, setClanNoticeSector] = useState("");
    const [upgradeBusy, setUpgradeBusy] = useState<ClanUpgradeKey | "">("");
    const allClanItems = getAllItems(creatorItems);
    const clanInventoryStacks = inventoryItemStacks(character, allClanItems);
    const clanTreasuryItems = cleanTreasuryItems(clanData?.treasury.items);

    function myMemberEntry(): ClanMemberEntry {
        return { name: character.name, village: character.village, level: character.level, specialty: character.specialty, battleContrib: character.clanBattleContrib ?? 0, eventContrib: character.clanEventContrib ?? 0, missionContrib: character.clanMissionContrib ?? 0, isFounder: character.clanFounder ?? false, month: new Date().toISOString().slice(0, 7) };
    }
    async function saveClan(next: EnhancedClanData) {
        const enhanced = enhanceClanData(next); setClanData(enhanced);
        try { await writeClanData(enhanced); }
        catch (e) { alert(e instanceof Error ? e.message : "Clan changes couldn't be saved. Please retry."); }
    }

    async function loadAvailableClans() {
        setClanListLoading(true);
        try {
            const res = await fetch("/api/clans/list");
            const data = res.ok ? await res.json() : [];
            const clans = Array.isArray(data) ? data.map((clan) => enhanceClanData(clan)).filter((clan) => clan.village === character.village) : [];
            setAvailableClans(clans);
            const acceptedClan = clans.find((clan) => clan.members.some((member) => member.name === character.name));
            if (acceptedClan && !character.clan) {
                updateCharacter({ ...character, clan: acceptedClan.name, clanFounder: acceptedClan.founderName === character.name });
            }
        } catch {
            setAvailableClans([]);
        } finally {
            setClanListLoading(false);
        }
    }

    useEffect(() => {
        if (!character.clan) { setClanData(null); setClanLoadStatus("ok"); return; }
        setLoading(true);
        fetchClanDataDetailed(character.clan).then(async result => {
            if (!result.ok) {
                setClanData(null);
                setClanLoadStatus(result.reason);
                setLoading(false);
                return;
            }
            const enhanced = enhanceClanData(result.data);
            const myEntry = myMemberEntry();
            const exists = enhanced.members.find(m => m.name === character.name);
            const synced = enhanceClanData({ ...enhanced, members: exists ? enhanced.members.map(m => m.name === character.name ? { ...m, ...myEntry, isFounder: m.isFounder || myEntry.isFounder } : m) : [...enhanced.members, myEntry] });
            setClanData(synced); setClanLoadStatus("ok");
            // Stamp the clan's upgrade-building levels onto the character so the
            // per-character bonus helpers can apply the clan member-passives
            // (training/pet XP, shop/hospital discounts). Only write on change.
            if (JSON.stringify(character.clanUpgradeLevels ?? {}) !== JSON.stringify(synced.upgrades) || character.clanDoctrine !== synced.doctrine) {
                updateCharacter({ ...character, clanUpgradeLevels: synced.upgrades, clanDoctrine: synced.doctrine });
            }
            // Background member-sync write — non-fatal if it fails (the next
            // clan load re-syncs), so don't let a rejection block setLoading.
            writeClanData(synced).catch(() => { /* re-syncs on next load */ });
            setLoading(false);
        });
    }, [character.clan, character.name, character.level, character.village, character.specialty, character.clanBattleContrib, character.clanEventContrib, character.clanMissionContrib]);

    useEffect(() => {
        if (character.clan) return;
        loadAvailableClans();
    }, [character.clan, character.name, character.village]);

    // Clan war crate distribution — fires whenever clanData loads or updates.
    // If the most recent war was a win and this player hasn't claimed the crate yet,
    // add it to their inventory automatically.
    useEffect(() => {
        if (!clanData) return;
        const { character: updated, count } = claimPendingWarCrates(character, clanData);
        if (count === 0) return;
        updateCharacter(updated);
        alert(`You received ${count} Legendary War Crate${count > 1 ? "s" : ""} from a clan war victory! Check your inventory.`);
     
    }, [clanData?.warHistory?.[0]?.warCrateId]);

    useEffect(() => {
        if (!isInClan || view !== "guard") return;
        fetch("/api/village-guard/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ village: character.village }) })
            .then(r => r.ok ? r.json() : []).then(list => setGuardList(Array.isArray(list) ? list : [])).catch(() => setGuardList([]));
    }, [isInClan, view, character.village, character.guardQueued]);

    async function createClan() {
        const name = clanName.trim(); if (name.length < 3) return alert("Clan name must be at least 3 characters.");
        const existing = await fetchClanData(name); if (existing) return alert("That clan already exists.");
        const newClan = enhanceClanData({ name, image: clanImage, doctrine: clanDoctrine, village: character.village, founderName: character.name, createdAt: Date.now(), members: [{ ...myMemberEntry(), isFounder: true }] });
        // Only flip the character into the new clan once the server has
        // actually persisted the record — otherwise a failed write leaves the
        // player pointing at a clan that doesn't exist ("can't reach clan server").
        try { await writeClanData(newClan); }
        catch (e) { return alert(e instanceof Error ? e.message : "Couldn't create the clan. Please retry."); }
        updateCharacter({ ...character, clan: name, clanFounder: true }); setClanData(newClan);
    }
    async function requestJoinClan(targetClan: EnhancedClanData) {
        if (targetClan.village !== character.village) return alert("You can only request clans from your own village.");
        if (targetClan.members.some(member => member.name === character.name)) {
            updateCharacter({ ...character, clan: targetClan.name, clanFounder: targetClan.founderName === character.name });
            return;
        }
        if (targetClan.joinRequests.some(request => request.name === character.name)) return alert("You already requested to join this clan.");
        const request: ClanJoinRequest = { ...myMemberEntry(), isFounder: false, requestedAt: Date.now() };
        const updated = enhanceClanData({ ...targetClan, joinRequests: [...targetClan.joinRequests, request] });
        try { await writeClanData(updated); }
        catch (e) { return alert(e instanceof Error ? e.message : "Couldn't send the join request. Please retry."); }
        setAvailableClans(availableClans.map(clan => clan.name === updated.name ? updated : clan));
        alert(`Join request sent to ${updated.name}. A clan leader or elder can accept it in the Clan Hall.`);
    }
    async function acceptJoinRequest(request: ClanJoinRequest) {
        if (!clanData) return;
        const updated = enhanceClanData({
            ...clanData,
            members: clanData.members.some(member => member.name === request.name) ? clanData.members : [...clanData.members, { ...request, isFounder: false }],
            joinRequests: clanData.joinRequests.filter(joinRequest => joinRequest.name !== request.name),
        });
        await saveClan(updated);
    }
    async function denyJoinRequest(request: ClanJoinRequest) {
        if (!clanData) return;
        await saveClan({ ...clanData, joinRequests: clanData.joinRequests.filter(joinRequest => joinRequest.name !== request.name) });
    }
    // Server-authoritative kick: removing a member from the blob alone doesn't
    // stick (their client re-adds itself while character.clan is still set), so
    // this goes through /api/clan/kick which also clears the kicked player's
    // character.clan. Leadership-only; the founder can't be kicked (both gated
    // server-side too). On success we adopt the returned roster locally.
    async function kickMember(member: ClanMemberEntry) {
        if (!clanData) return;
        if (member.name === clanData.founderName) return;
        if (!window.confirm(`Remove ${member.name} from "${clanData.name}"? They'll lose clan access immediately.`)) return;
        const result = await postClanKick(character.name, clanData.name, member.name);
        if (!result) return;
        setClanData(enhanceClanData({ ...clanData, members: clanData.members.filter(m => m.name !== member.name), joinRequests: clanData.joinRequests.filter(r => r.name !== member.name) }));
    }
    async function leaveClan() {
        if (!character.clan) return;
        // Guard against the one-click mis-tap. Founders especially can't undo
        // this — leaving clears clanFounder, and reclaim requires going
        // through the founder-bootstrap path again.
        const founderWarning = character.clanFounder ? "\n\nYou're the founder — leaving doesn't transfer ownership. You can recreate the clan but anyone else can claim the name first." : "";
        if (!window.confirm(`Leave "${character.clan}"?${founderWarning}\n\nThis can't be undone with one click — you'd need to re-request to join, or be re-invited.`)) {
            return;
        }
        const data = await fetchClanData(character.clan);
        if (data) {
            // Best-effort roster removal — the player is leaving locally
            // regardless; the member list re-syncs on the next clan load.
            await writeClanData(enhanceClanData({ ...data, members: data.members.filter(m => m.name !== character.name) }))
                .catch(() => { /* non-fatal */ });
        }
        updateCharacter({ ...character, clan: undefined, clanFounder: false, guardQueued: false });
        setClanData(null);
    }
    // Reclaim a clan name that exists on the player's character but has been
    // wiped from the server (e.g. by a server reset). One-click recreate:
    // skip the dead-record write that leaveClan does, then immediately write
    // a fresh clan record with this player as founder and update local state.
    async function reclaimClan() {
        if (!character.clan) return;
        const targetName = character.clan;
        // Belt-and-suspenders: make sure nothing currently exists under that
        // name before we recreate. If somehow a record reappeared between
        // load and click, fall through to a regular reload rather than
        // clobbering it.
        const existing = await fetchClanData(targetName);
        if (existing) {
            setClanData(enhanceClanData(existing));
            setClanLoadStatus("ok");
            return;
        }
        const founderCharacter = { ...character, clan: targetName, clanFounder: true };
        const newClan = enhanceClanData({
            name: targetName,
            image: "",
            village: character.village,
            founderName: character.name,
            createdAt: Date.now(),
            members: [{ ...myMemberEntry(), isFounder: true }],
        });
        try { await writeClanData(newClan); }
        catch (e) { return alert(e instanceof Error ? e.message : "Couldn't reclaim the clan. Please retry."); }
        updateCharacter(founderCharacter);
        setClanData(newClan);
        setClanLoadStatus("ok");
    }
    async function deleteClan() {
        if (!character.clan || !character.clanFounder) return;
        if (!window.confirm(`Delete "${character.clan}"? This permanently removes the clan for all members and cannot be undone.`)) return;
        await fetch(`/api/save/${clanSlug(character.clan)}`, { method: "DELETE" }).catch(() => {});
        updateCharacter({ ...character, clan: undefined, clanFounder: false, guardQueued: false });
        setClanData(null);
    }
    async function toggleGuard() {
        const queued = character.guardQueued ?? false; setGuardBusy(true);
        if (queued) { await postGuardQueue("dequeue", { name: character.name, village: character.village }); updateCharacter({ ...character, guardQueued: false }); }
        else { await postGuardQueue("queue", { name: character.name, village: character.village, level: character.level, defenseBonusPercent: getTownDefenseGuardBonus(character) }); updateCharacter({ ...character, guardQueued: true }); }
        setGuardBusy(false);
    }
    async function donateRyo() {
        if (!clanData) return; const amount = Math.max(1, Math.floor(donation)); if (character.ryo < amount) return alert("Not enough ryo.");
        const treasury = await postClanTreasuryDonation(character.name, clanData.name, { currency: "ryo", amount });
        if (!treasury) return;
        await saveClan(addClanXp({ ...clanData, treasury: cleanClanTreasury(treasury as Partial<ClanTreasury>) }, Math.floor(amount / 35)));
        updateCharacter({ ...character, ryo: character.ryo - amount, clanEventContrib: (character.clanEventContrib ?? 0) + Math.max(1, Math.floor(amount / 1000)) });
    }
    async function donateSpecial(currency: Exclude<ClanTreasuryCurrencyKey, "ryo">, amount: number) {
        if (!clanData) return; const current = character[currency] ?? 0; if (current < amount) return alert(`Not enough ${currency}.`);
        const treasury = await postClanTreasuryDonation(character.name, clanData.name, { currency, amount });
        if (!treasury) return;
        await saveClan(addClanXp({ ...clanData, treasury: cleanClanTreasury(treasury as Partial<ClanTreasury>) }, amount * 200));
        updateCharacter({ ...character, [currency]: current - amount, clanEventContrib: (character.clanEventContrib ?? 0) + amount } as Character);
    }
    async function donateClanItem() {
        if (!clanData) return;
        if (!clanDonateItemId) return alert("Choose an item to donate.");
        if (!ownsItem(character, clanDonateItemId)) return alert("You do not have that item.");
        const treasury = await postClanTreasuryDonation(character.name, clanData.name, { itemId: clanDonateItemId });
        if (!treasury) return;
        await saveClan(addClanXp({ ...clanData, treasury: cleanClanTreasury(treasury as Partial<ClanTreasury>) }, 50));
        updateCharacter({ ...removeItem(character, clanDonateItemId, 1), clanEventContrib: (character.clanEventContrib ?? 0) + 1 });
    }
    async function donateAllTerritoryScrollsToClan() {
        if (!clanData) return;
        const count = territoryScrollCount(character);
        if (count <= 0) return alert("You do not have any Territory Control Scrolls.");
        const treasury = await postClanTreasuryDonation(character.name, clanData.name, { itemId: TERRITORY_CONTROL_SCROLL_ID, count });
        if (!treasury) return;
        await saveClan(addClanXp({ ...clanData, treasury: cleanClanTreasury(treasury as Partial<ClanTreasury>) }, count * 20));
        updateCharacter({ ...removeTerritoryScrolls(character, count), clanEventContrib: (character.clanEventContrib ?? 0) + count });
        alert(`Donated ${count} Territory Control Scroll${count === 1 ? "" : "s"} to the clan hall.`);
    }
    async function sendClanCurrency() {
        if (!clanData) return;
        if (!canManageClan(myRole)) return alert("Only clan leadership can send treasury resources.");
        const amount = Math.max(1, Math.floor(clanSendAmount));
        if (!clanSendPlayer) return alert("Choose a clan member.");
        if ((clanData.treasury[clanSendCurrency] ?? 0) < amount) return alert("Not enough treasury resources.");
        // Route through the atomic server endpoint (audit #18). The old
        // grant-then-save flow PATCHed the recipient's save directly, which
        // /api/save 403s for non-admins — so leadership gifts silently failed.
        // The server moves BOTH sides under per-row locks; check the response
        // before reflecting the deduction locally.
        try {
            const r = await fetch("/api/clan/treasury/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clanName: clanData.name, recipientName: clanSendPlayer, currency: clanSendCurrency, amount }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        }
        // Server already persisted both sides — reflect the deduction in local
        // clan state (no redundant clan write) and credit the actor's in-memory
        // character if they gifted themselves.
        if (clanSendPlayer === character.name) {
            updateCharacter({ ...character, [clanSendCurrency]: (character[clanSendCurrency] ?? 0) + amount } as Character);
        }
        setClanData(enhanceClanData({ ...clanData, treasury: { ...clanData.treasury, [clanSendCurrency]: clanData.treasury[clanSendCurrency] - amount } }));
        alert(`Sent ${amount.toLocaleString()} ${clanSendCurrency} to ${clanSendPlayer}.`);
    }
    async function sendClanItem() {
        if (!clanData) return;
        if (!canManageClan(myRole)) return alert("Only clan leadership can send treasury items.");
        if (!clanSendPlayer) return alert("Choose a clan member.");
        if (!clanSendItemId) return alert("Choose an item.");
        if (!clanData.treasury.items.some(stack => stack.itemId === clanSendItemId && stack.count > 0)) return alert("That item is not in the clan treasury.");
        try {
            const r = await fetch("/api/clan/treasury/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clanName: clanData.name, recipientName: clanSendPlayer, itemId: clanSendItemId }),
            });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        }
        setClanData(enhanceClanData({ ...clanData, treasury: { ...clanData.treasury, items: removeTreasuryItem(clanData.treasury.items, clanSendItemId) } }));
        alert(`Sent ${itemDisplayName(clanSendItemId, allClanItems)} to ${clanSendPlayer}.`);
    }
    // Legacy scripted clan-war helpers — superseded by the live /api/clan/war/*
    // endpoints. Kept in case the maintainer wants the bot-clan fallback mode
    // back; underscore-prefixed to silence lint.
    async function _startClanWar() {
        if (!clanData) return; if (clanData.activeWar) return alert("Your clan already has an active war.");
        const rivals = ["Iron Lanterns", "Black Rain Circle", "Crimson Market Ronin", "White Ridge Pack"];
        await saveClan({ ...clanData, activeWar: { opponentClan: rivals[(clanData.warHistory.length + clanData.level) % rivals.length], enemyVillage: villages[(villages.indexOf(character.village) + 1) % villages.length], ourScore: clanTerritoryStartingScore(clanData.name), enemyScore: 0, startedAt: Date.now(), endsAt: Date.now() + 48 * 60 * 60 * 1000 } });
    }
    void _startClanWar;
    async function _addWarScore(points: number) { if (!clanData?.activeWar) return; const boosted = Math.max(1, Math.round(points * (1 + clanUpgradeBonus(clanData, "warRoom") / 100) * clanTerritoryWarMultiplier(clanData.name))); await saveClan({ ...clanData, activeWar: { ...clanData.activeWar, ourScore: clanData.activeWar.ourScore + boosted, enemyScore: clanData.activeWar.enemyScore + Math.floor(points / 2) } }); updateCharacter({ ...character, auraDust: (character.auraDust ?? 0) + Math.max(1, points) }); }
    void _addWarScore;
    async function purchaseUpgrade(key: ClanUpgradeKey) {
        if (!clanData) return;
        setUpgradeBusy(key);
        const result = await postClanUpgradePurchase(character.name, clanData.name, key);
        setUpgradeBusy("");
        if (result) {
            setClanData({ ...clanData, upgrades: { ...clanData.upgrades, ...(result.upgrades as Record<ClanUpgradeKey, number>) }, treasury: cleanClanTreasury(result.treasury) });
        }
    }
    async function collectTerritoryWarSupply() {
        if (!clanData || !canSpendTerritoryScrolls) return alert("Only the clan leader or Clan Elders can collect sector war supply.");
        // Server-authoritative: the endpoint scans owned sectors, accrues +
        // zeroes them, and credits the clan treasury under locks. We re-assert
        // the returned treasury (zero delta into the validator) instead of
        // crediting client-side. The next world-state poll reconciles the
        // sector displays.
        let data: { ok?: boolean; error?: string; treasury?: Partial<ClanTreasury>; collected?: number };
        try {
            const res = await fetch("/api/clan/territory/collect-supply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, clan: clanData.name }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not collect war supply. Please try again.");
        } catch {
            return alert("Could not collect war supply. Please try again.");
        }
        if (!data.collected || data.collected <= 0) return alert("Your owned sectors have not produced war supply yet.");
        await saveClan({ ...clanData, treasury: cleanClanTreasury(data.treasury as Partial<ClanTreasury>) });
        refreshTerritoryPanel();
        alert(`Collected ${data.collected.toLocaleString()} War Supply from clan sectors.`);
    }
    async function _spendWarSupplyOnActiveWar() {
        if (!clanData?.activeWar) return alert("Start a clan war before spending War Supply.");
        if (clanData.treasury.warSupply < 100) return alert("The clan treasury needs at least 100 War Supply.");
        await saveClan({
            ...clanData,
            treasury: { ...clanData.treasury, warSupply: clanData.treasury.warSupply - 100 },
            activeWar: { ...clanData.activeWar, ourScore: clanData.activeWar.ourScore + 10 },
        });
    }
    void _spendWarSupplyOnActiveWar;
    async function _resolveClanWar() {
        if (!clanData?.activeWar) return; const war = clanData.activeWar; const result: ClanWarRecord["result"] = war.ourScore > war.enemyScore ? "Won" : war.ourScore < war.enemyScore ? "Lost" : "Draw";
        const now = Date.now();
        const record: ClanWarRecord = { opponent: war.opponentClan, result, finalScore: `${war.ourScore} - ${war.enemyScore}`, topAttacker: character.name, topDefender: character.guardQueued ? character.name : "Village Guard", mvpClan: result === "Won" ? clanData.name : result === "Lost" ? war.opponentClan : "None", reward: result === "Won" ? "4,000 ryo / 800 Clan XP / War Crate (all members)" : result === "Draw" ? "1,500 ryo / 300 Clan XP" : "250 Clan XP", date: new Date().toLocaleDateString(), endedAt: now, warCrateId: result === "Won" ? `clan-crate-${clanData.name}-${now}` : undefined };
        if (result === "Lost") loadAllSectorTerritories().filter(territory => territory.ownerClan === clanData.name).slice(0, 1).forEach(territory => damageSectorTerritory(territory.sector, 10000));
        await saveClan(addClanXp({ ...clanData, activeWar: undefined, warHistory: [record, ...clanData.warHistory].slice(0, 12), treasury: { ...clanData.treasury, ryo: clanData.treasury.ryo + (result === "Won" ? 4000 : result === "Draw" ? 1500 : 0) } }, result === "Won" ? 800 : result === "Draw" ? 300 : 250));
        // Territory scrolls + aura dust still go to the player who ends the war.
        // The war crate itself is now distributed to ALL members via claimPendingWarCrates.
        if (result === "Won") updateCharacter({ ...grantTerritoryScrolls(character, 25), auraDust: (character.auraDust ?? 0) + 5 });
    }
    void _resolveClanWar;
    function refreshTerritoryPanel() { setTerritoryRefresh(value => value + 1); }
    async function donateTerritoryScrolls(sector: number, count = 1) {
        if (!clanData) return;
        if (villageForOutskirtsSector(sector)) return alert("Village sectors cannot be captured. This sector belongs to the village itself.");
        if (!canSpendTerritoryScrolls) return alert("Only the clan leader or Clan Elders can assign Territory Control Scrolls to sectors.");
        const amount = Math.max(1, Math.floor(count));
        if (clanTerritoryScrolls < amount) return alert(`The clan hall needs ${amount} Territory Control Scroll${amount === 1 ? "" : "s"}.`);
        const territory = loadSectorTerritory(sector);
        const isOwnedByUs = territory.ownerClan === clanData.name;
        if (territory.ownerClan && !isOwnedByUs) return alert("Raid or war this sector down before your clan can claim it.");
        // Clans are limited to one captured sector at a time
        if (!isOwnedByUs && clanOwnedTerritories(clanData.name).length >= 1) return alert("Your clan already controls a sector. Clans may only hold one sector at a time.");
        // Rebuild cooldown — sector cannot be captured while recovering from destruction
        if (!isOwnedByUs && territory.rebuiltAt) {
            const msLeft = TERRITORY_REBUILD_COOLDOWN_MS - (Date.now() - territory.rebuiltAt);
            if (msLeft > 0) {
                const minsLeft = Math.ceil(msLeft / 60000);
                return alert(`This sector was just destroyed and is recovering. It can be captured again in ${minsLeft} minute${minsLeft === 1 ? "" : "s"}.`);
            }
        }
        const nextScore = Math.min(TERRITORY_CONTROL_MAX, territory.controlScore + amount * 1000);
        const nextHp = isOwnedByUs ? Math.min(TERRITORY_HP_MAX, territory.hp + amount * 1000) : territory.hp;
        const captured = !territory.ownerClan && nextScore >= TERRITORY_CONTROL_MAX;
        saveSectorTerritory({
            ...territory,
            controlScore: captured ? TERRITORY_CONTROL_MAX : nextScore,
            hp: captured ? TERRITORY_HP_MAX : nextHp,
            ownerClan: captured ? clanData.name : territory.ownerClan,
            ownerVillage: captured ? clanData.village : territory.ownerVillage,
            backgroundImage: captured ? clanData.image : territory.backgroundImage,
            weather: captured ? territoryWeather : territory.weather,
            terrainBuffStat: captured ? territoryBuffStat : territory.terrainBuffStat,
            warSupply: captured ? 0 : territory.warSupply,
            lastSupplyAt: captured ? Date.now() : territory.lastSupplyAt,
        });
        await saveClan({ ...clanData, treasury: { ...clanData.treasury, items: removeTreasuryItem(clanData.treasury.items, TERRITORY_CONTROL_SCROLL_ID, amount) } });
        refreshTerritoryPanel();
    }
    function saveTerritorySettings(sector: number) {
        if (!clanData || !canSpendTerritoryScrolls) return alert("Only the clan leader or Clan Elders can adjust owned territory.");
        const territory = loadSectorTerritory(sector);
        if (territory.ownerClan !== clanData.name) return alert("Your clan does not own this sector.");
        saveSectorTerritory({ ...territory, weather: territoryWeather, terrainBuffStat: territoryBuffStat });
        refreshTerritoryPanel();
        alert(`Sector ${sector} terrain and weather updated.`);
    }
    function toggleTerritoryGuard(sector: number) {
        if (!clanData) return;
        const territory = loadSectorTerritory(sector);
        const isAnbu = isVillageAnbu(character);
        if (territory.ownerClan !== clanData.name && !isAnbu) return alert("Only the owning clan or ANBU can guard this sector.");
        const guards = territory.guards.includes(character.name)
            ? territory.guards.filter(name => name !== character.name)
            : [...territory.guards, character.name];
        saveSectorTerritory({ ...territory, guards });
        refreshTerritoryPanel();
    }
    async function postClanNotice() {
        if (!clanData) return;
        const title = clanNoticeTitle.trim();
        const body = clanNoticeBody.trim();
        if (!title || !body) return alert("Add a title and message for the clan notice.");
        const canPin = canManageClan(myRole) || myRank === "Clan Elder" || myRank === "Clan Head";
        const sector = clanNoticeSector ? clampNumber(Math.floor(Number(clanNoticeSector)), 1, 60) : undefined;
        const notice = makeNoticePost(clanNoticeType, title, body, character.name, myRank, canPin, sector);
        await saveClan({ ...clanData, notices: normalizeNoticePosts([notice, ...clanData.notices]) });
        setClanNoticeTitle("");
        setClanNoticeBody("");
        setClanNoticeSector("");
    }

    async function removeClanNotice(id: string) {
        if (!clanData) return;
        await saveClan({ ...clanData, notices: clanData.notices.filter(notice => notice.id !== id) });
    }

    async function toggleClanNoticePin(id: string) {
        if (!clanData) return;
        await saveClan({ ...clanData, notices: normalizeNoticePosts(clanData.notices.map(notice => notice.id === id ? { ...notice, pinned: !notice.pinned } : notice)) });
    }

    if (!isInClan) return <div className="card clan-hall-screen"><div className="clan-create-hero"><div><p className="act-label">{character.village}</p><h2>Clan Hall</h2><p className="hint">{lore?.motto}</p></div><ClanImageMark image={clanImage} name={clanName || "Clan"} village={character.village} /></div><p>{lore?.lore}</p><div className="clan-join-grid"><div className="summary-box"><h3>Create Clan</h3><p className="hint">Become founder, open a clan treasury, unlock member-count boosts, missions, wars, and a growing clan hall.</p><label>Clan Name</label><input value={clanName} onChange={e => setClanName(e.target.value)} placeholder="Example: Fated Reunion" /><label>Clan Image</label><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) readImageFile(file, setClanImage, 100); }} />{clanImage && <div className="admin-event-list-preview"><img src={clanImage} alt={clanName || "Clan"} /></div>}<label>Clan Doctrine</label><p className="hint">Your clan's identity — pick the perk that fits your playstyle. Chosen at creation.</p><div className="clan-doctrine-pick">{CLAN_DOCTRINES.map(d => <button key={d.id} type="button" className={`clan-doctrine-option${clanDoctrine === d.id ? " active" : ""}`} onClick={() => setClanDoctrine(d.id)}><span>{d.icon} <strong>{d.name}</strong></span><small>{d.effect}</small></button>)}</div><button onClick={createClan}>Create Clan</button></div><div className="summary-box clan-browse-panel"><div className="clan-section-title"><div><h3>Current Clans</h3><p className="hint">Request to join any clan from your village. Leaders and Clan Elders approve requests in their Clan Hall.</p></div><button onClick={loadAvailableClans} disabled={clanListLoading}>{clanListLoading ? "Loading..." : "Refresh"}</button></div>{availableClans.length === 0 ? <p className="hint">{clanListLoading ? "Loading clans..." : "No clans from your village exist yet."}</p> : <div className="clan-request-list">{availableClans.map(clan => { const requested = clan.joinRequests.some(request => request.name === character.name); return <div className="clan-request-card" key={clan.name}><ClanImageMark image={clan.image} name={clan.name} village={clan.village} /><div><strong>{clan.name}</strong><small>{clan.village} · Lv.{clan.level} · {clan.members.length} members</small><small>Founder: {clan.founderName}</small><small>{doctrineIcon(clan.doctrine ?? "none")} {doctrineName(clan.doctrine ?? "none")}</small></div><button disabled={requested} onClick={() => requestJoinClan(clan)}>{requested ? "Request Sent" : "Request Join"}</button></div>; })}</div>}</div></div></div>;
    if (loading) return <div className="card"><p style={{ color: "#94a3b8" }}>Loading clan data…</p></div>;
    if (!clanData) {
        const isMissing = clanLoadStatus === "notFound";
        return (
            <div className="card">
                <h2>Clan Hall</h2>
                {isMissing ? (
                    <>
                        <p>The clan <strong>{character.clan}</strong> no longer exists on the server. It may have been deleted by its founder or wiped during a server reset.</p>
                        <p className="hint">Reclaim the name to instantly recreate the clan with you as founder, or leave it to free up your slot for a different clan.</p>
                    </>
                ) : (
                    <>
                        <p>Could not reach the clan server. This is usually a temporary network or storage hiccup.</p>
                        <p className="hint">Try refreshing in a moment. If the problem persists, leaving the clan will clear it from your character so you can rejoin or create another.</p>
                    </>
                )}
                <div className="menu">
                    {isMissing && (
                        <button onClick={reclaimClan}>Reclaim "{character.clan}"</button>
                    )}
                    {!isMissing && (
                        <button onClick={() => { if (character.clan) { setLoading(true); void fetchClanDataDetailed(character.clan).then(r => { if (r.ok) { setClanData(enhanceClanData(r.data)); setClanLoadStatus("ok"); } else { setClanLoadStatus(r.reason); } setLoading(false); }); } }}>Retry</button>
                    )}
                    <button className="danger-button" onClick={leaveClan}>Leave Clan</button>
                </div>
            </div>
        );
    }

    const founderEntry = clanData.members.find(m => m.name === clanData.founderName);
    const nonFounders = [...clanData.members].filter(m => m.name !== clanData.founderName).sort((a, b) => clanContribTotal(b) - clanContribTotal(a));
    const sortedMembers = founderEntry ? [founderEntry, ...nonFounders] : nonFounders;
    const myEntry = clanData.members.find(m => m.name === character.name) ?? myMemberEntry();
    const myRank = clanRankOf(myEntry, clanData.members, clanData.founderName);
    const myRole = clanRoleOf(myEntry, clanData);
    const canReviewJoinRequests = myRole === "Founder" || myRole === "Leader" || myRank === "Clan Elder";
    const canSpendTerritoryScrolls = myRole === "Founder" || myRole === "Leader" || myRank === "Clan Elder" || myRank === "Clan Head";
    const myContrib = clanContribTotal(myEntry);
    const hall = clanHallTier(clanData.level);
    const xpNeed = clanXpNeeded(clanData.level);
    const clanBoostPercent = clanMemberBoostPercent(clanData.members.length);
    const clanBuffs = [
        { label: "Training XP", value: clanBoostPercent }, { label: "Mission XP", value: clanBoostPercent }, { label: "Ryo Gain", value: clanBoostPercent },
    ].filter(buff => buff.value > 0);
    void territoryRefresh;
    const allTerritories = loadAllSectorTerritories();
    const ownedTerritories = allTerritories.filter(territory => territory.ownerClan === clanData.name);
    const selectedTerritory = loadSectorTerritory(territorySector);
    const personalTerritoryScrolls = territoryScrollCount(character);
    const clanTerritoryScrolls = clanTreasuryItems.find(stack => stack.itemId === TERRITORY_CONTROL_SCROLL_ID)?.count ?? 0;
    const canGuardSelectedTerritory = selectedTerritory.ownerClan === clanData.name || isVillageAnbu(character);
    const clanSectorWarSupply = ownedTerritories.reduce((sum, territory) => sum + territory.warSupply, 0);
    const villageSectorCount = villageOwnedTerritories(character.village).length;
    const villageSectorWarSupply = villageTerritoryWarSupply(character.village);
    // Territory-derived display values for the legacy scripted war panel.
    // Unread today (panel is hidden); kept + underscored so the lint passes.
    const _territoryWarBonusPercent = Math.round((clanTerritoryWarMultiplier(clanData.name) - 1) * 100);
    const _territoryStartingScore = clanTerritoryStartingScore(clanData.name);
    void _territoryWarBonusPercent;
    void _territoryStartingScore;

    return <div className="card clan-hall-screen">
        <div className="clan-header"><div className="clan-title-block"><ClanImageMark image={clanData.image} name={clanData.name} village={clanData.village} /><div><h2 style={{ margin: 0 }}>{clanData.name}</h2><p className="hint" style={{ margin: "2px 0 0" }}>{clanData.village} · {clanData.members.length} members · Level {clanData.level}</p><div className="clan-xp-track"><span style={{ width: `${Math.min(100, (clanData.xp / xpNeed) * 100)}%` }} /></div><small>{clanData.xp.toLocaleString()} / {xpNeed.toLocaleString()} Clan XP</small></div></div><div className="clan-my-badge"><span className="clan-rank-badge" style={{ background: CLAN_RANK_COLOR[myRank] + "22", color: CLAN_RANK_COLOR[myRank], borderColor: CLAN_RANK_COLOR[myRank] + "55" }}>{CLAN_RANK_ICON[myRank]} {myRank}</span><span className="clan-role-badge">{CLAN_ROLE_ICON[myRole]} {myRole}</span><span className="clan-my-contrib">{myContrib} pts this month</span></div></div>
        <div className="clan-buff-banner"><strong>Active Clan Boosts</strong>{clanBuffs.length === 0 ? <span>No clan boosts yet — recruit at least 3 members.</span> : clanBuffs.map(buff => <span key={buff.label}>{buff.label} +{buff.value.toFixed(2)}%</span>)}</div>
        <div className="clan-tabs expanded-tabs"><button className={view === "roster" ? "active" : ""} onClick={() => setView("roster")}>👥 Roster</button><button className={view === "treasury" ? "active" : ""} onClick={() => setView("treasury")}>Treasury</button><button className={view === "boosts" ? "active" : ""} onClick={() => setView("boosts")}>⬆️ Boosts</button><button className={view === "upgrades" ? "active" : ""} onClick={() => setView("upgrades")}>🏗️ Upgrades</button><button className={view === "missions" ? "active" : ""} onClick={() => setView("missions")}>📜 Missions</button><button className={view === "wars" ? "active" : ""} onClick={() => setView("wars")}>⚔️ Wars</button><button className={view === "territory" ? "active" : ""} onClick={() => setView("territory")}>🗺️ Territory</button><button className={view === "guard" ? "active" : ""} onClick={() => setView("guard")}>Guard</button><button className={view === "notices" ? "active" : ""} onClick={() => setView("notices")}>📋 Notices</button><button className={view === "hall" ? "active" : ""} onClick={() => setView("hall")}>🏯 Hall</button></div>
        {view === "roster" && <div className="clan-roster">{canReviewJoinRequests && <section className="summary-box clan-join-requests"><h3>Join Requests</h3>{clanData.joinRequests.length === 0 ? <p className="hint">No pending join requests.</p> : <div className="clan-request-list">{clanData.joinRequests.map(request => <div className="clan-request-card" key={request.name}><div><strong>{request.name}</strong><small>Lv.{request.level} · {request.specialty} · {request.village}</small><small>Requested {new Date(request.requestedAt).toLocaleString()}</small></div><div className="menu"><button onClick={() => acceptJoinRequest(request)}>Accept</button><button className="danger-button" onClick={() => denyJoinRequest(request)}>Deny</button></div></div>)}</div>}</section>}<div className="clan-roster-header clan-roster-header-wide"><span>#</span><span>Member</span><span>Rank</span><span>Role</span><span>Contribution</span></div>{sortedMembers.map((member, idx) => { const rank = clanRankOf(member, clanData.members, clanData.founderName); const role = clanRoleOf(member, clanData); const contrib = clanContribTotal(member); const isMe = member.name === character.name; const rankColor = CLAN_RANK_COLOR[rank]; return <div key={member.name} className={`clan-member-row clan-member-row-wide${isMe ? " clan-member-me" : ""}`}><span className="clan-member-pos">#{idx + 1}</span><div className="clan-member-info"><span className="clan-member-name">{member.name}{isMe ? " ⭐" : ""}</span><span className="clan-member-sub">Lv.{member.level} · {member.specialty}</span></div><span className="clan-rank-badge" style={{ background: rankColor + "1a", color: rankColor, borderColor: rankColor + "44" }}>{CLAN_RANK_ICON[rank]} {rank}</span><span className="clan-role-badge">{CLAN_ROLE_ICON[role]} {role}</span><div className="clan-contrib-col"><span className="clan-contrib-total">{contrib} pts</span><span className="clan-contrib-breakdown">⚔️{member.battleContrib} 🎯{member.eventContrib} 📜{member.missionContrib}</span></div>{canManageClan(myRole) && !isMe && member.name !== clanData.founderName && <button className="danger-button clan-kick-btn" title={`Remove ${member.name}`} onClick={() => kickMember(member)}>Kick</button>}</div>; })}<div className="summary-box clan-rank-legend"><strong style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Permissions</strong><p className="hint">Founder, Leader, and Clan Elders can approve join requests. Founder, Leader, and Officer can start clan wars.</p></div></div>}
        {view === "treasury" && <div className="summary-box"><h3>💰 Clan Treasury</h3><div className="treasury-grid"><p><strong>Ryo:</strong> {clanData.treasury.ryo.toLocaleString()}</p><p><strong>Fate Shards:</strong> {clanData.treasury.fateShards}</p><p><strong>Bone Charms:</strong> {clanData.treasury.boneCharms}</p><p><strong>Aura Stones:</strong> {clanData.treasury.auraStones}</p><p><strong>Mythic Seals:</strong> {clanData.treasury.mythicSeals}</p><p><strong>War Supply:</strong> {clanData.treasury.warSupply.toLocaleString()}</p></div><label>Donate Ryo</label><input type="number" value={donation} onChange={(e) => setDonation(Number(e.target.value))} /><div className="menu"><button onClick={donateRyo}>Donate Ryo</button><button onClick={() => donateSpecial("fateShards", 1)}>Donate 1 Fate Shard</button><button onClick={() => donateSpecial("boneCharms", 1)}>Donate 1 Bone Charm</button><button onClick={() => donateSpecial("auraStones", 1)}>Donate 1 Aura Stone</button><button onClick={() => donateSpecial("mythicSeals", 1)}>Donate 1 Mythic Seal</button></div><label>Donate Item</label><select value={clanDonateItemId} onChange={(e) => setClanDonateItemId(e.target.value)}><option value="">Choose item</option>{clanInventoryStacks.map(stack => <option key={stack.itemId} value={stack.itemId}>{stack.name} x{stack.count}</option>)}</select><button onClick={donateClanItem} disabled={!clanDonateItemId}>Donate Item</button><h4>Treasury Items</h4>{clanTreasuryItems.length === 0 ? <p className="hint">No donated items yet.</p> : <div className="treasury-grid">{clanTreasuryItems.map(stack => <p key={stack.itemId}><strong>{itemDisplayName(stack.itemId, allClanItems)}:</strong> x{stack.count}</p>)}</div>}{canManageClan(myRole) && <section className="summary-box"><h3>Send Treasury Resources</h3><p className="hint">Clan leadership can send donated resources or items to clan members.</p><label>Recipient</label><select value={clanSendPlayer} onChange={(e) => setClanSendPlayer(e.target.value)}><option value="">Choose clan member</option>{sortedMembers.map(member => <option key={member.name} value={member.name}>{member.name}</option>)}</select><label>Resource</label><select value={clanSendCurrency} onChange={(e) => setClanSendCurrency(e.target.value as ClanTreasuryCurrencyKey)}><option value="ryo">Ryo</option><option value="fateShards">Fate Shards</option><option value="boneCharms">Bone Charms</option><option value="auraStones">Aura Stones</option><option value="mythicSeals">Mythic Seals</option></select><input type="number" min={1} value={clanSendAmount} onChange={(e) => setClanSendAmount(Number(e.target.value))} /><div className="menu"><button onClick={sendClanCurrency}>Send Resource</button></div><label>Item</label><select value={clanSendItemId} onChange={(e) => setClanSendItemId(e.target.value)}><option value="">Choose treasury item</option>{clanTreasuryItems.map(stack => <option key={stack.itemId} value={stack.itemId}>{itemDisplayName(stack.itemId, allClanItems)} x{stack.count}</option>)}</select><button onClick={sendClanItem} disabled={!clanSendItemId}>Send Item</button></section>}<p className="hint">Donations add clan XP and treasury resources.</p><ClanSealPool character={character} updateCharacter={updateCharacter} /></div>}
        {view === "boosts" && <div className="clan-upgrade-grid">{clanBoostTiers.map(tier => { const active = clanData.members.length >= tier.min && clanData.members.length <= tier.max; const label = Number.isFinite(tier.max) ? `${tier.min}-${tier.max} members` : `${tier.min}+ members`; return <div key={label} className={`town-upgrade-card clan-upgrade-card ${active ? "active" : ""}`}><div className="town-upgrade-topline"><span className="town-upgrade-icon">⬆️</span><div><strong>{label}</strong><p>{active ? "Active Boost" : "Recruitment Tier"}</p></div></div><div className="town-upgrade-bar"><span style={{ width: active ? "100%" : "0%" }} /></div><p className="town-upgrade-desc">Clan members receive +{tier.percent}% training XP, mission XP, and ryo gain at this roster size.</p><p className="town-upgrade-bonus">Boost: <strong>+{tier.percent}%</strong></p></div>; })}</div>}
        {view === "upgrades" && <div className="clan-upgrade-grid">
            <div className="summary-box clan-upgrade-intro" style={{ gridColumn: "1 / -1" }}><strong>🏗️ Clan Buildings</strong><p className="hint">Clan leadership spends the treasury to raise buildings — funded by Ryo + War Supply (earned from owned territory). Treasury: <strong>{clanData.treasury.ryo.toLocaleString()}</strong> Ryo · <strong>{clanData.treasury.warSupply.toLocaleString()}</strong> War Supply</p></div>
            {CLAN_UPGRADE_DEFS.map(def => {
                const level = clanData.upgrades?.[def.key] ?? 0;
                const maxed = isClanUpgradeMaxed(level);
                const cost = clanUpgradeCost(level);
                const canAfford = clanData.treasury.ryo >= cost.ryo && clanData.treasury.warSupply >= cost.warSupply;
                const isLeader = canManageClan(myRole);
                return <div key={def.key} className={`town-upgrade-card clan-upgrade-card ${level > 0 ? "active" : ""}`}>
                    <div className="town-upgrade-topline"><span className="town-upgrade-icon">{def.icon}</span><div><strong>{def.name}</strong><p>Level {level}{maxed ? " · Max" : ` / ${CLAN_UPGRADE_MAX_LEVEL}`}</p></div></div>
                    <div className="town-upgrade-bar"><span style={{ width: `${(level / CLAN_UPGRADE_MAX_LEVEL) * 100}%` }} /></div>
                    <p className="town-upgrade-desc">{def.desc}</p>
                    <p className="town-upgrade-bonus">Current: <strong>{def.effectLabel(level)}</strong></p>
                    {!maxed && <p className="hint">Next level: {cost.ryo.toLocaleString()} Ryo + {cost.warSupply} War Supply</p>}
                    {isLeader
                        ? <div className="menu"><button disabled={maxed || !canAfford || upgradeBusy === def.key} onClick={() => purchaseUpgrade(def.key)}>{maxed ? "Maxed" : upgradeBusy === def.key ? "Upgrading…" : canAfford ? "Upgrade" : "Not enough"}</button></div>
                        : !maxed && <p className="hint">Only clan leadership can upgrade.</p>}
                </div>;
            })}
        </div>}
        {view === "missions" && <div className="clan-mission-grid">{clanMissionDefinitions.map(mission => { const progress = clanMissionProgress(clanData, mission.key); return <div key={mission.key} className="summary-box clan-mission-card"><h3>{mission.icon} {mission.name}</h3><p>{mission.description}</p><div className="town-upgrade-bar"><span style={{ width: `${Math.min(100, (progress / mission.target) * 100)}%` }} /></div><p><strong>{Math.min(progress, mission.target).toLocaleString()}</strong> / {mission.target.toLocaleString()}</p><p className="hint">Reward: {mission.reward}</p></div>; })}</div>}
        {view === "wars" && <ClanWarsPanel character={character} clanName={clanData.name} setScreen={setScreen} />}
        {view === "territory" && <div className="summary-box"><h3>Clan Territory Control</h3><p className="hint">Members donate Territory Control Scrolls to the clan hall. Owned sectors generate War Supply, boost clan war scoring, and reduce raid damage when guarded.</p><p><strong>Your Scrolls:</strong> {personalTerritoryScrolls} · <strong>Clan Hall Scrolls:</strong> {clanTerritoryScrolls} · <strong>Clan War Supply:</strong> {clanData.treasury.warSupply.toLocaleString()} · <strong>Uncollected:</strong> {clanSectorWarSupply.toLocaleString()}</p><p className="hint">Your village owns {villageSectorCount} sector{villageSectorCount === 1 ? "" : "s"} with {villageSectorWarSupply.toLocaleString()} uncollected village-wide War Supply.</p><div className="menu"><button disabled={personalTerritoryScrolls < 1} onClick={donateAllTerritoryScrollsToClan}>Donate All Territory Scrolls To Clan Hall</button><button disabled={!canSpendTerritoryScrolls || clanSectorWarSupply < 1} onClick={collectTerritoryWarSupply}>Collect Sector War Supply</button></div><div className="treasury-grid"><div><label>Sector</label><input type="number" min={1} max={60} value={territorySector} onChange={(event) => setTerritorySector(clampNumber(Number(event.target.value), 1, 60))} /></div><div><label>Weather</label><select value={territoryWeather} onChange={(event) => setTerritoryWeather(event.target.value as WeatherType)}>{Object.entries(weatherEffects).map(([key, weather]) => <option key={key} value={key}>{weather.name}</option>)}</select></div><div><label>Terrain Bonus</label><select value={territoryBuffStat} onChange={(event) => setTerritoryBuffStat(event.target.value as TerritoryBuffStat)}><option value="bukijutsuOffense">Bukijutsu Offense +10%</option><option value="taijutsuOffense">Taijutsu Offense +10%</option><option value="ninjutsuOffense">Ninjutsu Offense +10%</option><option value="genjutsuOffense">Genjutsu Offense +10%</option></select></div></div><section className="summary-box"><h4>Sector {territorySector}</h4><p><strong>Owner:</strong> {selectedTerritory.ownerClan ? `${selectedTerritory.ownerClan} (${selectedTerritory.ownerVillage})` : "Unclaimed"}</p><div className="town-upgrade-bar"><span style={{ width: `${(selectedTerritory.controlScore / TERRITORY_CONTROL_MAX) * 100}%` }} /></div><p>Control Score: {selectedTerritory.controlScore.toLocaleString()} / {TERRITORY_CONTROL_MAX.toLocaleString()}</p><div className="bar enemy-bar"><span style={{ width: `${(selectedTerritory.hp / TERRITORY_HP_MAX) * 100}%` }} /></div><p>Sector HP: {selectedTerritory.hp.toLocaleString()} / {TERRITORY_HP_MAX.toLocaleString()}</p><p>War Supply: {selectedTerritory.warSupply.toLocaleString()} · Raid Damage Taken: {sectorRaidDamageAmount(territorySector).toLocaleString()}</p><p>Fixed Weather: {weatherEffects[selectedTerritory.weather ?? weatherForSector(territorySector, "central")].name} · Terrain: {selectedTerritory.terrainBuffStat.replace("Offense", " Offense")} +10%</p><p>Guards: {selectedTerritory.guards.length ? selectedTerritory.guards.join(", ") : "None"}</p><div className="menu"><button disabled={!canSpendTerritoryScrolls || clanTerritoryScrolls < 1 || Boolean(selectedTerritory.ownerClan && selectedTerritory.ownerClan !== clanData.name)} onClick={() => donateTerritoryScrolls(territorySector)}>Assign 1 Clan Scroll</button><button disabled={!canSpendTerritoryScrolls || clanTerritoryScrolls < 5 || Boolean(selectedTerritory.ownerClan && selectedTerritory.ownerClan !== clanData.name)} onClick={() => donateTerritoryScrolls(territorySector, 5)}>Assign 5 Clan Scrolls</button><button disabled={!canSpendTerritoryScrolls || selectedTerritory.ownerClan !== clanData.name} onClick={() => saveTerritorySettings(territorySector)}>Save Terrain / Weather</button><button disabled={!canGuardSelectedTerritory} onClick={() => toggleTerritoryGuard(territorySector)}>{selectedTerritory.guards.includes(character.name) ? "Leave Sector Guard" : "Queue Sector Guard"}</button></div></section><h4>Your Clan Sectors</h4>{ownedTerritories.length === 0 ? <p className="hint">Your clan does not own a sector yet.</p> : <div className="war-record-grid">{ownedTerritories.map(territory => <div key={territory.sector} className="war-record-card"><strong>Sector {territory.sector}</strong><span>HP {territory.hp.toLocaleString()} / {TERRITORY_HP_MAX.toLocaleString()}</span><small>{weatherEffects[territory.weather ?? "clear"].name} · {territory.terrainBuffStat.replace("Offense", " Offense")} +10%</small><small>War Supply: {territory.warSupply.toLocaleString()} · Guards: {territory.guards.length}</small></div>)}</div>}</div>}
        {view === "notices" && <div className="summary-box town-notice-board"><h3>Clan Notice Board</h3><p className="hint">Clan Head, leaders, officers, and Clan Elders can post tactical clan notices for members.</p><div className="treasury-grid"><div><label>Type</label><select value={clanNoticeType} onChange={(event) => setClanNoticeType(event.target.value as NoticePostType)}><option value="clan">Clan Notice</option><option value="raid">Raid Target</option><option value="guard">Guard Request</option><option value="trade">Trade / Supply</option><option value="general">General</option></select></div><div><label>Sector Optional</label><input type="number" min={1} max={60} value={clanNoticeSector} onChange={(event) => setClanNoticeSector(event.target.value)} placeholder="1-60" /></div></div><label>Title</label><input value={clanNoticeTitle} maxLength={70} onChange={(event) => setClanNoticeTitle(event.target.value)} placeholder="Example: Prepare Sector 33 raid team" /><label>Message</label><textarea value={clanNoticeBody} maxLength={500} onChange={(event) => setClanNoticeBody(event.target.value)} placeholder="Post clan plans, resource needs, guard rotations, or war instructions." /><button onClick={() => void postClanNotice()} disabled={!clanNoticeTitle.trim() || !clanNoticeBody.trim()}>Post Clan Notice</button><div className="notice-board-list">{clanData.notices.length === 0 ? <p className="hint">No clan notices posted yet.</p> : clanData.notices.map(notice => { const canEditNotice = canManageClan(myRole) || myRank === "Clan Elder" || notice.author === character.name; return <div key={notice.id} className={`notice-post ${notice.pinned ? "pinned" : ""}`}><div className="notice-post-head"><span>{notice.pinned ? "Pinned " : ""}{noticeTypeLabel(notice.type)}</span><small>{new Date(notice.createdAt).toLocaleString()} · {notice.author} · {notice.authorRole}</small></div><strong>{notice.title}</strong><p>{notice.body}</p>{notice.sector && <small>Sector {notice.sector}</small>}{canEditNotice && <div className="menu"><button onClick={() => void toggleClanNoticePin(notice.id)}>{notice.pinned ? "Unpin" : "Pin"}</button><button className="danger-button" onClick={() => void removeClanNotice(notice.id)}>Delete</button></div>}</div>; })}</div></div>}
        {view === "guard" && <div className="summary-box"><h3>🛡️ Village Guard</h3><p className="hint">Queue as a guard to defend <strong>{character.village}</strong>. Town Hall defense bonus applies while you are queued.</p><button className={character.guardQueued ? "danger-button" : ""} onClick={toggleGuard} disabled={guardBusy} style={{ marginBottom: 12 }}>{guardBusy ? "Updating…" : character.guardQueued ? "Leave Guard Queue" : "Queue as Village Guard"}</button><h4>Active Guards for {character.village} ({guardList.length})</h4>{guardList.length === 0 ? <p className="hint">No active guards. Village is undefended.</p> : <div className="clan-guard-list">{guardList.map(g => <div key={g.name} className="clan-guard-row"><span>🛡️ <strong>{g.name}</strong></span><span className="clan-guard-lvl">Lv. {g.level}{g.defenseBonusPercent ? ` · DEF +${g.defenseBonusPercent.toFixed(1)}%` : ""}</span></div>)}</div>}</div>}
        {view === "hall" && <div className="summary-box clan-visual-hall"><ClanImageMark image={clanData.image} name={clanData.name} village={clanData.village} /><span className="clan-hall-tier-icon">{hall.icon}</span><div><h3>{hall.name}</h3><p>{hall.desc}</p><p className="hint">Doctrine: {doctrineIcon(clanData.doctrine ?? "none")} <strong>{doctrineName(clanData.doctrine ?? "none")}</strong></p><p className="hint">Hall tier grows automatically from clan level: Camp → Dojo → Compound → Fortress → Citadel.</p></div></div>}
        <div className="menu" style={{ marginTop: 12 }}>
            <button className="danger-button" onClick={leaveClan}>Leave Clan</button>
            {character.clanFounder && <button className="danger-button" onClick={deleteClan}>Delete Clan</button>}
        </div>
    </div>;
}

// -- Expanded Town Hall state ----------------------------------------------
