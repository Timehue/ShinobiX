/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useRef } from "react";
import "../styles/town-hall-aaa.css";
import { GiBroadsword, GiCrossedSwords, GiCrown, GiMoneyStack, GiPagoda, GiScrollUnfurled, GiShield, GiTreasureMap, GiUpgrade } from "../components/icons/LightweightGameIcons";
import { visiblePoll } from "../lib/poll";
import {
    KAGE_CHALLENGE_RYO_COST,
    kageActivityLines,
    kageEligibility,
    type ServerKageChallenge,
    type ServerKageState,
} from "../lib/kage-challenge-state";
import type { Character, ServerPlayerSummary, VersionedCharacterCommit } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { NoticePostType } from "../types/clan";
import type { VillageUpgradeKey, Screen } from "../types/core";
import { UPGRADE_IMAGES, HOLLOW_GATE_IMAGE } from "../data/upgrade-images";
import { contestVillageUnfed, fetchWarMap, upgradeWarStructure, type SectorWarContest } from "../lib/village-war-map";
import { storesLedgerEmptyLine, storesLedgerScopeLine, storesSpendAuthorityLine, villageSupplyCall } from "../lib/village-stores-signposts";
import { DAILY_CRAFT_POINT_DONATION_CAP, DAILY_RATION_DONATION_CAP, DEPOT_CONVERSION_POINTS_PER_WR, readStores, storesCreditNote, storesDonationBucket, storesDonationCapLine, storesDonationGate, storesLedgerRows } from "../lib/village-stores";
import { MAX_WILD_SECTOR } from "../../../shared/sector-geo";
import { STRUCTURE_IMAGES } from "../data/war-ui-images";
import { LeaderPortrait } from "../components/Marks";
import { FacilityHero } from "../components/FacilityHero";
import { gameConfirm } from "../components/GameAlert";
import { gameToast } from "../components/GameToast";
import { useCapabilityViewAvailability } from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed, sectorMapAdmissionMessage } from "../lib/live-capability-admission";
import { clampNumber, currentDateKey, currentMonthKey, makeId } from "../lib/utils";
import { cleanTreasuryItems, getAllItems, inventoryItemStacks, itemDisplayName, removeTreasuryItem } from "../lib/items";
import { ownsItem } from "../lib/inventory";
import { dailyMissionsCompleted } from "../lib/character-progress";
import { getBloodlineMultiplier } from "../lib/combat-math";
import { VILLAGE_UPGRADE_MAX_LEVEL, getBankInterestPercent, getHospitalDiscountPercent, getJutsuTrainingSpeedBonus, getMissionRewardBonus, getPetXpBonus, getShopDiscountPercent, getTownDefenseGuardBonus, getTrainingXpBonus, getVillageUpgrades, villageUpgradeCost, villageUpgradeDefinitions } from "../lib/village-upgrades";
import { makeNoticePost, normalizeNoticePosts, noticeTypeLabel } from "../lib/clan-notices";
import { postGuardQueue } from "../lib/clan-api";
import {
    HOLLOW_GATE_UNLOCK_COST,
    getPvpJutsuLoadout,
    normalizeCharacter,
    type DuelChallenge,
} from "../App";
import { loadVillageLeadershipImages } from "../lib/village-leadership-images";
import { villageLeadership } from "../data/village-leadership";
import {
    cleanVillageTreasury,
    normalizeAnbuAppointees,
    normalizeVillageDailyAgenda,
} from "../lib/village-state";
import { postPlayerChallengeNotice, postVillageTreasuryDonation } from "../lib/player-api";
import { MERCENARY_TIERS, hiredTiersForWar } from "../lib/mercenaries";
import { mercPortrait } from "../lib/merc-ai";
import { activeVillageWarsFor, endedVillageWarRecordsFor, hollowGateDaysLeft, HOLLOW_GATE_UNLOCK_DAYS, isHollowGateUnlocked, isVillageAnbu, loadVillageState, normalizeVillageState, saveVillageState, villageOwnedTerritories, VILLAGE_WAR_GROUND_HP_MAX, VILLAGE_WAR_HP_MAX, type VillageAgendaTask, type VillageState, type VillageTreasury, type VillageTreasuryCurrencyKey } from "../lib/world-state";

const TOWN_TABS = [
    { id: "status", label: "Command", caption: "Village posture", icon: GiPagoda },
    { id: "upgrades", label: "Upgrades", caption: "Civic works", icon: GiUpgrade },
    { id: "treasury", label: "Treasury", caption: "Shared stores", icon: GiMoneyStack },
    { id: "guard", label: "Guard", caption: "Defenders", icon: GiShield },
    { id: "notices", label: "Orders", caption: "Field dispatches", icon: GiScrollUnfurled },
    { id: "mercenaries", label: "Mercenaries", caption: "War bands", icon: GiCrossedSwords },
    { id: "politics", label: "Council", caption: "Leadership", icon: GiCrown },
] as const;

type ElderFocusKey = NonNullable<Character["elderFocus"]>;

const ELDER_FOCUS_OPTIONS: ReadonlyArray<{
    key: ElderFocusKey;
    role: string;
    bonus: string;
    brief: string;
}> = [
    { key: "war", role: "War Elder", bonus: "−1% wartime damage", brief: "Steel the village for open conflict." },
    { key: "trade", role: "Trade Elder", bonus: "−5% shop prices", brief: "Turn every ryo into more supplies." },
    { key: "training", role: "Training Elder", bonus: "+10% XP and jutsu speed", brief: "Accelerate the next generation." },
];

// Server-authoritative Kage succession (mirrors api/village/_kage-challenge.ts —
// keep these in sync). The full rules + obligation math live server-side; the
// client only declares, presses the overlap clock, sends the duel, and renders.
// The entry terms come from lib/kage-challenge-state, which is the single client
// mirror of api/village/_kage-challenge.ts. They used to be re-declared here as
// well; a second copy of a server price is how three of them silently drifted
// out of sync in this codebase. Declaring costs RYO, not Honor Seals — seals are
// the Vanguard's PvP earnings and fund VILLAGE upgrades, so a civic act must not
// tax them (owner ruling 2026-08-17).
// ServerKageChallenge/ServerKageState are imported from lib/kage-challenge-state,
// which is the canonical shape the server returns. The local copies that used to
// live here omitted challengeId, so the durable-challenge proof this screen now
// requires before sending the official duel could not be read.
function formatObligation(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

// The four PERMANENT war structures (Honor-Seal-funded, kept across wars) surfaced
// in the Upgrades tab. Ramparts + Watchtower are per-war (WR) and stay in the Sector
// War Map. Descriptions mirror api/_war-structures STRUCTURE_DEFS.
const PERMANENT_WAR_STRUCTURES: { key: string; name: string; desc: string }[] = [
    { key: "barracks", name: "Barracks", desc: "-1.5% mercenary WR cost per level." },
    { key: "warAcademy", name: "War Academy", desc: "+1.5% sector-war damage per level." },
    { key: "supplyDepot", name: "Supply Depot", desc: "+0.5 War Resources per controlled sector per level." },
    { key: "treasuryVault", name: "Treasury Vault", desc: "-3% of the daily tax rate per level." },
];

// Daily War-Resource upkeep of a permanent war structure at `level` — a client
// mirror of api/_war-economy.ts structureMaintenanceWr: round(2·level^1.25),
// clamped to 0..10. Surfaced per-structure in the Upgrades tab so the Kage can
// see the standing cost before raising a level.
function warStructureUpkeepWr(level: number): number {
    const lvl = Math.max(0, Math.min(10, Math.floor(Number(level) || 0)));
    return lvl <= 0 ? 0 : Math.round(2 * Math.pow(lvl, 1.25));
}

export function TownHall({ character, updateCharacter, onVersionedCharacter, onServerVersion, creatorItems, allServerPlayers, savedBloodlines, creatorJutsus, sharedImages, setScreen, onBack }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; onVersionedCharacter: VersionedCharacterCommit; onServerVersion: (version: unknown) => boolean; creatorItems: GameItem[]; allServerPlayers: ServerPlayerSummary[]; savedBloodlines: SavedBloodline[]; creatorJutsus: Jutsu[]; sharedImages: Record<string, string>; setScreen: (s: Screen) => void; onBack: () => void }) {
    const villageWarAvailability = useCapabilityViewAvailability("villageWar");
    const sectorMapOpen = capabilityAdmissionAllowed(villageWarAvailability);
    const sectorMapStatus = sectorMapAdmissionMessage(villageWarAvailability);
    const leadership = villageLeadership[character.village] ?? { kage: "Acting Kage Council", elders: ["First Elder", "Second Elder", "Third Elder"], atWar: false, pastWars: ["No recorded wars yet."] };
    const leadershipImages = loadVillageLeadershipImages()[character.village] ?? { kage: "", elders: ["", "", ""] };

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
    const [tab, setTab] = useState<(typeof TOWN_TABS)[number]["id"]>("status");
    const [mercBusy, setMercBusy] = useState<string | null>(null);
    const [elderFocusBusy, setElderFocusBusy] = useState<ElderFocusKey | null>(null);
    const elderFocusBusyRef = useRef(false);
    const [state, setState] = useState<VillageState>(() => loadVillageState(character.village));
    // MIRRORS api/_treasury-gift-tax.ts and the donate caps in
    // api/village/treasury/donate.ts — shown up front so the server's limits are
    // never a surprise mid-action.
    // Mount-stable clock for the Kage eligibility checklist (LegacyPanel.tsx:97
    // uses the same pattern). Only the account-age requirement needs a `now`, and
    // it moves on the scale of days — a per-second tick would buy nothing.
    const [kageNow] = useState(() => Date.now());
    const TREASURY_GIFT_TAX_LABEL = "10%";
    const TREASURY_DONATE_MAX_RYO = 200_000;

    // Village upgrades are SHARED: the levels live on the village record and the
    // copy on the character is a server-validated mirror. Read the village so a
    // member sees the real village level immediately after the Kage buys one,
    // without waiting for their own save to re-sync the mirror.
    const upgrades = { ...getVillageUpgrades(character), ...(state.upgrades ?? {}) } as ReturnType<typeof getVillageUpgrades>;
    const totalUpgradeLevel = Object.values(upgrades).reduce((sum, level) => sum + level, 0);

    const [donation, setDonation] = useState(1000);
    const [guardList, setGuardList] = useState<{ name: string; level: number; defenseBonusPercent?: number }[]>([]);
    const [guardBusy, setGuardBusy] = useState(false);
    const guardBusyRef = useRef(false);
    const donateBusyRef = useRef(false);
    const treasuryTransferBusyRef = useRef(false);
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
    const [warStructures, setWarStructures] = useState<Record<string, number> | null>(null);
    // Village Stores (api/_village-stores.ts): the war-map view carries the
    // village's ledger + a stores snapshot. Fetched once when the Treasury tab
    // opens; the stock rows prefer the polled village-state treasury (the blob
    // the server drains) and fall back to this snapshot while it lacks the keys.
    //
    // BOTH sources are optional by design, so a bare `?? 0` cannot tell "the
    // stores are empty" from "we have not read them yet" — the fetch status is
    // what separates those, and it also separates a failed read from an empty
    // log. The ledger is kept RAW: its rows carry "5m ago" stamps that go stale
    // the instant they are baked into state, so they are formatted in render
    // against a ticking clock instead.
    const [storesLedgerRaw, setStoresLedgerRaw] = useState<unknown>(null);
    const [storesFetch, setStoresFetch] = useState<"loading" | "ready" | "error">("loading");
    const [storesLedgerNow, setStoresLedgerNow] = useState(() => Date.now());
    const [storesSnapshot, setStoresSnapshot] = useState<{ provisions: number; materialPoints: number } | null>(null);
    // The same war-map read also carries this village's sector-war contests,
    // which is what turns "N rations" into "we are marching hungry". Kept raw
    // for the same reason the ledger is: the unfed verdict is scoped to a UTC
    // day and is read against a live clock in render, never frozen into state.
    const [storesContests, setStoresContests] = useState<SectorWarContest[] | null>(null);
    const [warStructBusy, setWarStructBusy] = useState("");
    const [townActionBusy, setTownActionBusy] = useState<VillageUpgradeKey | "hollow-gate" | null>(null);
    const townActionBusyRef = useRef(false);
    const allVillageItems = getAllItems(creatorItems);
    const villageInventoryStacks = inventoryItemStacks(character, allVillageItems);
    const villageTreasuryItems = cleanTreasuryItems(state.treasury.items);
    // Static village lore names are NPC flavor, not an occupied player seat.
    // Keep every Town Hall summary on the same authoritative seat state so the
    // header cannot say "Unclaimed" while another panel names an NPC as Kage.
    const displayedKage = state.seatedKage ?? (state.kageSystemUnlocked ? "Unclaimed" : "Acting Kage Council");
    // "Unclaimed" is a call to action, not a status. The only claim button in
    // the game lives in the Shinobi Council Hall, so the Town Hall has to say
    // where it is and take the player there.
    const kageSeatVacant = Boolean(state.kageSystemUnlocked) && !state.seatedKage;
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
    // Permanent war structures surfaced in the Upgrades tab: fetch the village's
    // war-record levels when the tab is open (best-effort; only a war village returns one).
    useEffect(() => {
        if (tab !== "upgrades") return;
        let alive = true;
        void fetchWarMap().then((wm) => {
            if (!alive) return;
            const mine = wm.villages.find((v) => v.village === character.village);
            setWarStructures(mine ? mine.structures : null);
        }).catch(() => { if (alive) setWarStructures(null); });
        return () => { alive = false; };
    }, [tab, character.village]);
    // Command AND Treasury read the stores. Command needs them for the supply
    // call to action ("{Village} is marching hungry"); reusing THIS fetch is the
    // point — the war-map aggregator already carries the stock and the contests,
    // so the banner costs no extra request and no new endpoint. It still fires
    // once per tab entry, not on a poll.
    useEffect(() => {
        if (tab !== "treasury" && tab !== "status") return;
        let alive = true;
        setStoresFetch("loading");
        void fetchWarMap().then((wm) => {
            if (!alive) return;
            const mine = wm.villages.find((v) => v.village === character.village);
            setStoresLedgerRaw(mine ? mine.storesLedger : []);
            setStoresSnapshot(mine ? { provisions: Math.max(0, Math.floor(Number(mine.provisions) || 0)), materialPoints: Math.max(0, Math.floor(Number(mine.materialPoints) || 0)) } : null);
            setStoresContests((wm.contests ?? []).filter((c) => c.attackerVillage === character.village || c.defenderVillage === character.village));
            setStoresFetch("ready");
        }).catch(() => { if (alive) { setStoresLedgerRaw(null); setStoresSnapshot(null); setStoresContests(null); setStoresFetch("error"); } });
        return () => { alive = false; };
    }, [tab, character.village]);
    // Keep "5m ago" honest while the tab stays open. visiblePoll pauses in a
    // hidden tab, so this costs nothing in the background.
    // (Command shares it: the supply banner compares a contest's endsAt against
    // this same clock, so a tab left open for hours must not keep judging a war
    // that has since closed.)
    useEffect(() => {
        if (tab !== "treasury" && tab !== "status") return;
        setStoresLedgerNow(Date.now());
        return visiblePoll(() => setStoresLedgerNow(Date.now()), 60_000);
    }, [tab]);
    // The Village Stores ride the war layer. When that layer is unavailable the
    // stores endpoints answer 'Not found.', so the rows, the cap line and the
    // supply log are hidden rather than shown as zeroes — failing CLOSED, the
    // same read the Sector Map door uses.
    const storesOpen = sectorMapOpen;
    // "Loaded" is a fetch fact, not a value fact: the treasury blob may legally
    // carry neither key, and 0 only becomes truthful once a read has landed.
    const storesLoaded = storesFetch === "ready" || state.treasury.provisions !== undefined || state.treasury.materialPoints !== undefined;
    // …and it is a PER-FIELD fact. `storesLoaded` is an OR across three
    // independent sources, so a treasury carrying materialPoints but no
    // provisions key reads as loaded while `provisions` is still unread — and
    // the `?? 0` below would then let an unread field assert "The stores stand
    // empty" at a village that is mid-siege. Track the two separately and hand
    // the banner null (never 0) for a field nobody has read.
    const provisionsKnown = state.treasury.provisions !== undefined || storesSnapshot?.provisions !== undefined;
    const storesView = {
        provisions: state.treasury.provisions ?? storesSnapshot?.provisions ?? 0,
        materialPoints: state.treasury.materialPoints ?? storesSnapshot?.materialPoints ?? 0,
    };
    const storesLedgerView = storesLedgerRows(storesLedgerRaw, storesLedgerNow);
    // Who may spend what a villager just donated. Copy only — the authority is
    // the server's and is unchanged: the Kage spends the stores, ANBU appointees
    // may order a garrison fed. Null while the read is still outstanding, so a
    // bare 0 never stands in for "unknown".
    const storesAuthorityLine = storesOpen ? storesSpendAuthorityLine({ loaded: storesLoaded, ...storesView }) : null;
    // The supply call to action. Every input is already on screen or already
    // fetched; the predicate itself (lib/village-stores-signposts) decides when
    // there is genuinely nothing to say, and says nothing then.
    const activeStoresContests = (storesContests ?? []).filter((c) => !c.flipped && storesLedgerNow < (Number(c.endsAt) || 0));
    const supplyCall = storesOpen
        ? villageSupplyCall({
            village: character.village,
            loaded: storesLoaded && storesContests !== null,
            provisions: provisionsKnown ? storesView.provisions : null,
            activeWars: activeStoresContests.length,
            unfedWars: activeStoresContests.filter((c) => contestVillageUnfed(c, character.village)).length,
        })
        : null;
    // Per-donor daily stores caps, mirrored from the save's own server-written
    // counters (api/_treasury-stores-donate.ts). Shown as a running total and
    // enforced before the request, the way the Cafeteria's cook cap already is.
    const villageDonateCapLine = storesDonationCapLine(character);
    const villageDonateGate = storesDonationGate(character, villageDonateItemId);
    // The button says what the button DOES. A refusal is a sentence, and a
    // sentence belongs in a hint under the select — not stretched across a
    // control's label.
    const villageDonateBucket = storesDonationBucket(villageDonateItemId);
    const villageDonateLabel = villageDonateBucket === "provisions" ? "Donate to Provisions"
        : villageDonateBucket === "materialPoints" ? "Donate to Materials"
            : "Donate Item";
    async function upgradeWarStruct(key: string) {
        setWarStructBusy(key);
        try {
            await upgradeWarStructure(character.name, character.village, key);
            const wm = await fetchWarMap();
            const mine = wm.villages.find((v) => v.village === character.village);
            setWarStructures(mine ? mine.structures : null);
        } catch (e) { alert(String((e as Error).message || e)); }
        finally { setWarStructBusy(""); }
    }
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
    useEffect(() => {
        if (tab !== "guard" && tab !== "status") return;
        let alive = true;
        fetch("/api/village-guard/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ village: character.village }) })
            .then(r => r.ok ? r.json() : [])
            .then(list => { if (alive) setGuardList(Array.isArray(list) ? list : []); })
            .catch(() => { if (alive) setGuardList([]); });
        return () => { alive = false; };
    }, [tab, character.village, character.guardQueued]);
    function updateVillageState(next: VillageState) { const normalized = normalizeVillageState(character.village, next); setState(normalized); saveVillageState(character.village, normalized); }
    // Village activity (upgrades, donations, Hollow Gate, war) is logged ONLY to
    // the legacy `notices` string board (Status tab). It must NOT be written to
    // `noticePosts` (the "Official Village Orders" board): those posts are minted
    // with author "System", which the server validator rejects for non-admin
    // callers (author ≠ caller), so they never persist — and the client would
    // then re-fold the legacy strings into fresh posts on every load, fabricating
    // duplicate, ever-re-timestamped "System" orders. Keep activity out of Orders.
    function addNotice(text: string, nextState: VillageState = state) { return { ...nextState, notices: [text, ...nextState.notices].slice(0, 8) }; }
    // (Removed: beginVillageWar — Town Hall's bypass declare path. The
    // canonical declare flow is VillageWarScreen.declareWar which POSTs
    // through /api/world-state with all the new server-side gates
    // applied: 500 Honor Seals cost, 7-day cooldown, single-war rule,
    // 1-hour pending window. The old function wrote straight to KV via
    // the cache and silently swallowed server rejections.)
    async function upgradeTownFeature(key: VillageUpgradeKey) {
        if (!isSeatedKage) return alert("Only the seated Kage can upgrade village structures.");
        if (townActionBusyRef.current) return;
        const currentLevel = upgrades[key];
        if (currentLevel >= VILLAGE_UPGRADE_MAX_LEVEL) return alert("This village upgrade is already maxed at level 50.");
        const cost = villageUpgradeCost(key, currentLevel);
        if ((state.treasury?.honorSeals ?? 0) < cost) return alert(`The village treasury needs ${cost.toLocaleString()} Honor Seals. Vanguards fund upgrades by donating seals to the treasury.`);
        const upgradeName = villageUpgradeDefinitions.find(def => def.key === key)?.name ?? key;
        townActionBusyRef.current = true;
        setTownActionBusy(key);
        const confirmed = await gameConfirm(
            `Upgrade ${upgradeName} from level ${currentLevel} to ${currentLevel + 1} for ${cost.toLocaleString()} Honor Seals from the village treasury? Every member of the village gains the bonus. This is permanent and cannot be refunded.`,
            { title: "Confirm Village Upgrade", confirmLabel: "Upgrade" },
        );
        if (!confirmed) {
            townActionBusyRef.current = false;
            setTownActionBusy(null);
            return;
        }
        try {
            const response = await fetch('/api/village/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, key }) });
            // Village upgrades are SHARED now: the server spends the treasury
            // pool and writes the level onto the village record, so the response
            // carries village state rather than a character.
            const data = await response.json().catch(() => null) as { upgrades?: Record<string, number>; treasuryHonorSeals?: number; cost?: number; level?: number; error?: string } | null;
            if (!response.ok || !data?.upgrades) return alert(data?.error || 'The village upgrade did not return an updated village. Refresh before retrying.');
            updateVillageState(addNotice(
                `${character.name} spent ${(data.cost ?? cost).toLocaleString()} Honor Seals from the treasury to upgrade ${upgradeName} to level ${data.level ?? currentLevel + 1} — every villager benefits.`,
                {
                    ...state,
                    upgrades: data.upgrades,
                    treasury: { ...state.treasury, honorSeals: data.treasuryHonorSeals ?? state.treasury?.honorSeals },
                    contributionPoints: state.contributionPoints + 10,
                },
            ));
        } catch {
            alert("The village upgrade response was lost. Refresh your save before retrying so you can confirm whether it committed.");
        } finally {
            townActionBusyRef.current = false;
            setTownActionBusy(null);
        }
    }
    async function purchaseHollowGateUnlock() {
        if (!isSeatedKage) return alert("Only the seated Kage can open the Hollow Gate.");
        if (townActionBusyRef.current) return;
        const cost = HOLLOW_GATE_UNLOCK_COST;
        if ((character.honorSeals ?? 0) < cost) return alert(`Not enough Honor Seals. The Hollow Gate seal demands ${cost.toLocaleString()} Honor Seals.`);
        const wasOpen = isHollowGateUnlocked(state);
        townActionBusyRef.current = true;
        setTownActionBusy("hollow-gate");
        const confirmed = await gameConfirm(
            `${wasOpen ? "Extend" : "Open"} the Hollow Gate for ${HOLLOW_GATE_UNLOCK_DAYS} days at a cost of ${cost.toLocaleString()} Honor Seals? The seals are spent immediately and cannot be refunded.`,
            { title: wasOpen ? "Extend Hollow Gate" : "Open Hollow Gate", confirmLabel: wasOpen ? "Extend Gate" : "Open Gate" },
        );
        if (!confirmed) {
            townActionBusyRef.current = false;
            setTownActionBusy(null);
            return;
        }
        try {
            const response = await fetch('/api/village/hollow-gate-unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name }) });
            const data = await response.json().catch(() => null) as { character?: Character; hollowGateUnlockedUntil?: number; error?: string; _saveVersion?: number } | null;
            if (!response.ok || !data?.character || !data.hollowGateUnlockedUntil) return alert(data?.error || 'The Hollow Gate action did not return an updated save. Refresh before retrying.');
            const until = data.hollowGateUnlockedUntil;
            const notice = wasOpen
                ? `${character.name} renewed the Hollow Gate seal for ${cost.toLocaleString()} Honor Seals. The shrine stays open until ${new Date(until).toLocaleDateString()}.`
                : `${character.name} broke the Hollow Gate seal for ${cost.toLocaleString()} Honor Seals. The shrine has revealed itself on the World Map until ${new Date(until).toLocaleDateString()}.`;
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
            updateVillageState(addNotice(notice, { ...state, hollowGateUnlockedUntil: until, contributionPoints: state.contributionPoints + 25 }));
        } catch {
            alert("The Hollow Gate response was lost. Refresh your save before retrying so you can confirm whether the seal changed.");
        } finally {
            townActionBusyRef.current = false;
            setTownActionBusy(null);
        }
    }
    async function donateVillageRyo() {
        if (donateBusyRef.current) return;
        const amount = Math.max(1, Math.floor(donation));
        if (character.ryo < amount) return alert("Not enough ryo.");
        donateBusyRef.current = true;
        try {
            const result = await postVillageTreasuryDonation(character.name, character.village, { currency: "ryo", amount });
            if (!result) return;
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            updateVillageState(addNotice(`${character.name} donated ${amount.toLocaleString()} ryo to the village treasury.`, { ...state, treasury: cleanVillageTreasury(result.treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + Math.max(1, Math.floor(amount / 1000)) }));
        } finally {
            donateBusyRef.current = false;
        }
    }
    async function donateVillageSpecial(currency: Exclude<VillageTreasuryCurrencyKey, "ryo">) {
        if (donateBusyRef.current) return;
        const current = character[currency] ?? 0;
        if (current < 1) return alert(`Not enough ${currency}.`);
        donateBusyRef.current = true;
        try {
            const result = await postVillageTreasuryDonation(character.name, character.village, { currency, amount: 1 });
            if (!result) return;
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            updateVillageState(addNotice(`${character.name} donated 1 ${currency} to the village treasury.`, { ...state, treasury: cleanVillageTreasury(result.treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + 5 }));
        } finally {
            donateBusyRef.current = false;
        }
    }
    async function donateVillageItem() {
        if (donateBusyRef.current) return;
        if (!villageDonateItemId) return alert("Choose an item to donate.");
        if (!ownsItem(character, villageDonateItemId)) return alert("You do not have that item.");
        // Mirror of the server's per-donor daily stores caps. Without it the
        // only feedback on a 1,500-point / 40-ration day was a bare 429.
        if (!villageDonateGate.ok) return alert(`${villageDonateGate.reason}. The cap resets at midnight UTC.`);
        donateBusyRef.current = true;
        try {
            const before = readStores({ ...storesSnapshot, ...state.treasury } as Record<string, unknown>);
            const result = await postVillageTreasuryDonation(character.name, character.village, { itemId: villageDonateItemId });
            if (!result) return;
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            // Village Stores routing: ration-pack → provisions, hunt-*/relics →
            // material points. The server says what it credited; the rows update
            // from the returned treasury and the toast names the credit.
            const credit = storesCreditNote(result.stores, before);
            const itemName = itemDisplayName(villageDonateItemId, allVillageItems);
            if (result.stores) setStoresSnapshot((prev) => ({ provisions: result.stores?.provisions ?? prev?.provisions ?? 0, materialPoints: result.stores?.materialPoints ?? prev?.materialPoints ?? 0 }));
            updateVillageState(addNotice(`${character.name} donated ${itemName} to the village ${result.stores ? "stores" : "treasury"}${credit ? ` (${credit})` : ""}.`, { ...state, treasury: cleanVillageTreasury(result.treasury as Partial<VillageTreasury>), contributionPoints: state.contributionPoints + 5 }));
            // ONE confirmation for a routine success, and a toast rather than a
            // modal: the alert used to fire on top of the notice-board line,
            // which is the village's shared activity log and not the donor's
            // receipt (see components/GameToast.tsx).
            gameToast(
                credit ? `${itemName} donated to the village stores — ${credit}.` : `${itemName} donated to the village treasury.`,
                { kind: "success" },
            );
        } finally {
            donateBusyRef.current = false;
        }
    }
    async function sendVillageCurrency() {
        if (treasuryTransferBusyRef.current) return;
        if (!isSeatedKage) return alert("Only the seated Kage can send village treasury resources.");
        const amount = Math.max(1, Math.floor(villageSendAmount));
        if (!villageSendPlayer) return alert("Choose a village player.");
        if ((state.treasury[villageSendCurrency] ?? 0) < amount) return alert("Not enough village treasury resources.");
        treasuryTransferBusyRef.current = true;
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
            const data = await r.json().catch(() => ({})) as { error?: string; character?: Character; _saveVersion?: number; amount?: number; burned?: number };
            if (!r.ok) {
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
            if (villageSendPlayer.trim().toLowerCase() === character.name.trim().toLowerCase() && (!data.character || !onVersionedCharacter(data.character, data._saveVersion))) return;
            // Say what actually LANDED. The gift leg burns a share of everything
            // except Honor Seals (api/_treasury-gift-tax.ts), so reporting the
            // requested amount would quietly overstate what the recipient got.
            const received = Number(data.amount ?? amount);
            const burned = Number(data.burned ?? 0);
            const burnNote = burned > 0 ? ` (${burned.toLocaleString()} burned in transit)` : "";
            updateVillageState(addNotice(`${character.name} gifted ${received.toLocaleString()} ${villageSendCurrency} to ${villageSendPlayer}${burnNote}.`, { ...state, treasury: { ...state.treasury, [villageSendCurrency]: state.treasury[villageSendCurrency] - amount } }));
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        } finally {
            treasuryTransferBusyRef.current = false;
        }
    }
    async function sendVillageItem() {
        if (treasuryTransferBusyRef.current) return;
        if (!isSeatedKage) return alert("Only the seated Kage can send village treasury items.");
        if (!villageSendPlayer) return alert("Choose a village player.");
        if (!villageSendItemId) return alert("Choose an item.");
        if (!state.treasury.items.some(stack => stack.itemId === villageSendItemId && stack.count > 0)) return alert("That item is not in the village treasury.");
        treasuryTransferBusyRef.current = true;
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
            const data = await r.json().catch(() => ({})) as { error?: string; character?: Character; _saveVersion?: number };
            if (!r.ok) {
                return alert(data?.error ?? `Transfer failed (HTTP ${r.status}).`);
            }
            if (villageSendPlayer.trim().toLowerCase() === character.name.trim().toLowerCase() && (!data.character || !onVersionedCharacter(data.character, data._saveVersion))) return;
            updateVillageState(addNotice(`${character.name} gifted ${itemDisplayName(villageSendItemId, allVillageItems)} to ${villageSendPlayer}.`, { ...state, treasury: { ...state.treasury, items: removeTreasuryItem(state.treasury.items, villageSendItemId) } }));
        } catch (err) {
            return alert(`Transfer failed: ${(err as Error).message}`);
        } finally {
            treasuryTransferBusyRef.current = false;
        }
    }
    async function toggleTownGuard() {
        if (guardBusyRef.current) return;
        const queued = character.guardQueued ?? false;
        guardBusyRef.current = true;
        setGuardBusy(true);
        try {
            await postGuardQueue(queued ? "dequeue" : "queue", queued
                ? { name: character.name, village: character.village }
                : { name: character.name, village: character.village, level: character.level, defenseBonusPercent: getTownDefenseGuardBonus(character) });
            updateCharacter(prev => prev ? ({ ...prev, guardQueued: !queued }) : prev);
            updateVillageState(addNotice(queued
                ? `${character.name} left the Village Guard queue.`
                : `${character.name} joined the Village Guard queue with +${getTownDefenseGuardBonus(character).toFixed(1)}% defense.`));
        } catch (error) {
            alert(error instanceof Error ? error.message : "Guard queue update failed. Your local status was not changed.");
        } finally {
            guardBusyRef.current = false;
            setGuardBusy(false);
        }
    }
    const isSeatedKage = (state.seatedKage ?? "").toLowerCase() === character.name.toLowerCase();
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
        const sector = villageNoticeSector ? clampNumber(Math.floor(Number(villageNoticeSector)), 1, MAX_WILD_SECTOR) : undefined;
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
        if (!(await gameConfirm(`Declare a Kage challenge against ${seatedKage}? This stakes ${KAGE_CHALLENGE_RYO_COST.toLocaleString()} ryo. You must beat them in a duel — and they must accept it or forfeit the seat.`))) return;
        const res = await fetch("/api/village/kage-challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "declare", village: character.village, playerName: character.name }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; challenge?: ServerKageChallenge; character?: Character; _saveVersion?: number };
        if (!res.ok || !data.ok) return alert(data.error || "Could not declare the challenge.");
        // Reflect the server-side 500-seal debit locally; the autosave re-asserts
        // the debited balance and the two converge (same pattern as the agenda /
        // map-control reward endpoints).
        if (data.character && !onVersionedCharacter(data.character, data._saveVersion)) return;
        setServerKage(prev => prev ? { ...prev, challenge: data.challenge ?? prev.challenge } : prev);
        alert(`Challenge declared against ${seatedKage}. Catch them online and send the official duel — they must accept it or forfeit the seat.`);
    }
    async function sendKageDuel() {
        const targetName = serverKage?.seatedKage;
        const kageChallengeId = serverKage?.challenge?.challengeId;
        if (!targetName || targetName.toLowerCase() === character.name.toLowerCase()) return;
        if (!kageChallengeId) return alert("The official Kage challenge proof is missing. Refresh and try again.");
        const duel: DuelChallenge = {
            id: makeId(),
            fromName: character.name,
            toName: targetName,
            challenger: character,
            challengerJutsus: getPvpJutsuLoadout(savedBloodlines, creatorJutsus, character),
            challengerBloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            createdAt: Date.now(),
            mode: "standard",
            kageChallengeId,
            kageVillage: character.village,
        };
        const sent = await postPlayerChallengeNotice(targetName, duel);
        if (!sent) return alert(`${targetName} is not reachable right now. Try again while they're online.`);
        alert(`Official Kage duel sent to ${targetName}. They must accept it — or keep burning their accept obligation until they forfeit the seat.`);
    }
    async function supportVillageFocus(focus: string, elderFocusKey: ElderFocusKey) {
        // The selected appointment is a state, not a repeatable action. This
        // guard also closes the small pre-render window in which a rapid second
        // click could post twice and award the same civic contribution twice.
        if (character.elderFocus === elderFocusKey || elderFocusBusyRef.current) return;
        elderFocusBusyRef.current = true;
        setElderFocusBusy(elderFocusKey);
        try {
            const response = await fetch('/api/village/elder-focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: character.name, focus: elderFocusKey }) });
            const data = await response.json().catch(() => null) as { character?: Character; error?: string; _saveVersion?: number } | null;
            if (!response.ok || !data?.character) return alert(data?.error || 'Could not select that focus.');
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
            updateVillageState(addNotice(`${character.name} selected the ${focus} elder focus.`, { ...state, contributionPoints: state.contributionPoints + 10 }));
            gameToast(`${focus} appointed — ${ELDER_FOCUS_OPTIONS.find(option => option.key === elderFocusKey)?.bonus ?? "focus active"}.`, { kind: "success" });
        } catch { alert('Could not reach the server. Try again.'); }
        finally {
            elderFocusBusyRef.current = false;
            setElderFocusBusy(null);
        }
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
    const endedVillageWars = endedVillageWarRecordsFor(character.village);
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
    const kageActivity = kageActivityLines(serverKage, kageNow);
    const isKageChallenger = !!kageChallenge && kageChallenge.challenger.toLowerCase() === character.name.toLowerCase();
    const agenda = normalizeVillageDailyAgenda(character.village, state.dailyAgenda);
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
        if (!agendaComplete) return alert("Complete the village agenda goals first.");
        if (agendaClaimed) return alert("You already claimed today's village agenda.");
        // Both personal and treasury rewards are server-authoritative and carry
        // independent durable receipts so an interrupted claim can safely resume.
        let data: { ok?: boolean; alreadyClaimed?: boolean; treasuryAlreadyClaimed?: boolean; personalAlreadyClaimed?: boolean; error?: string; treasury?: Partial<VillageTreasury>; personal?: { alreadyClaimed?: boolean; granted?: { ryo: number; boneCharms: number; honorSeals: number }; balances?: { ryo: number; boneCharms: number; honorSeals: number } }; _saveVersion?: number };
        try {
            const res = await fetch("/api/village/claim-daily-agenda", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, village: character.village }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not claim the village agenda. Please try again.");
            if (!onServerVersion(data._saveVersion)) return;
        } catch {
            return alert("Could not claim the village agenda. Please try again.");
        }
        const serverTreasury = cleanVillageTreasury(data.treasury as Partial<VillageTreasury>);
        // The absolute personal balances are the authoritative post-claim view.
        // The per-half flags matter during retry recovery: combined
        // `alreadyClaimed` is false whenever either half was newly completed.
        const personalNewlyClaimed = Boolean(data.personal && !data.personal.alreadyClaimed && data.personal.granted);
        if (data.treasuryAlreadyClaimed) {
            // Treasury half already claimed today (another device) — sync it.
            updateVillageState(normalizeVillageState(character.village, { ...state, dailyAgenda: agenda, treasury: serverTreasury }));
        } else {
            const nextState = normalizeVillageState(character.village, { ...state, dailyAgenda: agenda, contributionPoints: state.contributionPoints + 15, treasury: serverTreasury });
            updateVillageState(addNotice(`${character.name} completed today's village agenda. Village treasury gained Honor Seals, ryo, and Bone Charms.`, nextState));
        }
        updateCharacter(prev => prev ? ({
            ...prev,
            claimedVillageAgendaDate: agenda.date,
            ...(data.personal?.balances ? {
                ryo: data.personal.balances.ryo,
                honorSeals: data.personal.balances.honorSeals,
                boneCharms: data.personal.balances.boneCharms,
            } : {}),
        }) : prev);
        if (data.alreadyClaimed && !personalNewlyClaimed) return alert("Today's village agenda was already claimed.");
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
        let data: { ok?: boolean; alreadyClaimed?: boolean; error?: string; sectors?: number; granted?: { ryo: number; honorSeals: number; boneCharms: number; fateShards: number }; balances?: { ryo: number; honorSeals: number; boneCharms: number; fateShards: number }; _saveVersion?: number };
        try {
            const res = await fetch("/api/village/claim-map-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, village: character.village }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not claim the map control reward. Please try again.");
            if (!onServerVersion(data._saveVersion)) return;
        } catch {
            return alert("Could not claim the map control reward. Please try again.");
        }
        const grant = (!data.alreadyClaimed && data.granted) ? data.granted : null;
        const serverSectors = Math.max(0, Math.floor(Number(data.sectors ?? 0)));
        updateCharacter(prev => prev ? ({
            ...prev,
            claimedMapControlDate: currentDateKey(),
            ...(data.balances ? {
                ryo: data.balances.ryo,
                honorSeals: data.balances.honorSeals,
                boneCharms: data.balances.boneCharms,
                fateShards: data.balances.fateShards,
            } : {}),
        }) : prev);
        if (grant) {
            updateVillageState(addNotice(`${character.name} claimed map control rewards from ${serverSectors} village sector${serverSectors === 1 ? "" : "s"}.`, { ...state, contributionPoints: state.contributionPoints + serverSectors }));
        } else if (data.alreadyClaimed) {
            return alert("Today's map control reward was already claimed.");
        }
    }
    // Tiers already hired for THIS war (server-sealed; resets when the war does).
    const hiredMercTiers = hiredTiersForWar(character.warMercs, primaryVillageWar?.id ?? null);
    // War mercenaries — server-authoritative Honor Seal sink. The handler recomputes
    // the cost from the sealed tier table, deducts under the save lock, and lands the
    // sealed war damage on the enemy village (floored — a merc can't end a war). We
    // only adopt the server's returned balance + warMercs and let the world-state
    // poll refresh the enemy HP bar.
    async function hireMercenary(tierId: string) {
        const war = primaryVillageWar;
        if (!war) return alert("Mercenaries can only be hired during an active village war.");
        const tier = MERCENARY_TIERS.find(t => t.id === tierId);
        if (!tier) return;
        if (hiredMercTiers.includes(tierId)) return alert(`You already hired the ${tier.name} this war.`);
        if ((character.honorSeals ?? 0) < tier.costSeals) return alert(`You need ${tier.costSeals.toLocaleString()} Honor Seals to hire the ${tier.name}.`);
        setMercBusy(tierId);
        let data: { ok?: boolean; error?: string; balance?: number; warMercs?: { warId: string; tiers: string[] }; enemy?: string; dealt?: number };
        try {
            const res = await fetch("/api/village/hire-mercenary", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "hire", tierId }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) { alert(data.error || "Could not hire the mercenary. Please try again."); return; }
        } catch {
            alert("Could not hire the mercenary. Please try again.");
            return;
        } finally {
            setMercBusy(null);
        }
        updateCharacter(prev => prev ? ({
            ...prev,
            honorSeals: typeof data.balance === "number" ? data.balance : prev.honorSeals,
            warMercs: data.warMercs ?? prev.warMercs,
        }) : prev);
        alert(`The ${tier.name} joins the fight — ${(data.dealt ?? tier.warDamage).toLocaleString()} war damage struck against ${data.enemy ?? activeWarEnemyVillage}.`);
    }
    return <div className="card town-hall-screen civic-facility-screen">
        <FacilityHero
            facility="town-hall"
            eyebrow={`${character.village} · Village Command`}
            title="Town Hall"
            description="Lead the village. Claim today’s rewards, defend its borders, and shape its next upgrade."
            onBack={onBack}
            metrics={[
                { label: "Village level", value: villageLevel },
                { label: "Seated Kage", value: displayedKage },
                { label: "Honor seals", value: (character.honorSeals ?? 0).toLocaleString(), tone: "good" },
            ]}
        />
        <nav className="town-tabs" aria-label="Town Hall sections">{TOWN_TABS.map(({ id, label, caption, icon: TabIcon }) => <button key={id} type="button" className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}><TabIcon className="town-tab-icon" aria-hidden="true" /><span><strong>{label}</strong><small>{caption}</small></span></button>)}</nav>
        {tab === "status" && <div className="town-command">
            {supplyCall && <section className="summary-box town-supply-call" data-tone={supplyCall.tone} role="status"><div className="town-supply-call-copy"><p className="act-label">Village supply</p><h3>{supplyCall.headline}</h3><p>{supplyCall.body}</p></div><button type="button" className="town-supply-call-action" onClick={() => setScreen(supplyCall.screen)}>{supplyCall.actionLabel}</button></section>}
            <section className="town-action-center"><div className="town-section-heading"><p className="act-label">Ready now</p><h3>Village priorities</h3></div><div className="town-priority-grid">
                <article className="town-priority-card" data-state={agendaClaimed ? "done" : agendaComplete ? "ready" : "progress"}><div><span>Daily Agenda</span><strong>{agendaClaimed ? "Claimed" : agendaComplete ? "Rewards ready" : `${agenda.tasks.filter(task => agendaProgress(task) >= task.target).length}/${agenda.tasks.length} goals`}</strong></div><div className="town-task-list">{agenda.tasks.map(task => <span key={task.id}>{task.label}<b>{Math.min(agendaProgress(task), task.target).toLocaleString()} / {task.target.toLocaleString()}</b></span>)}</div><button disabled={!agendaComplete || agendaClaimed} onClick={claimVillageAgenda}>{agendaClaimed ? "Claimed today" : agendaComplete ? "Claim rewards" : "In progress"}</button></article>
                <article className="town-priority-card" data-state={mapControlClaimed ? "done" : ownedVillageSectors.length ? "ready" : "locked"}><div><span>Map Control</span><strong>{ownedVillageSectors.length} sector{ownedVillageSectors.length === 1 ? "" : "s"}</strong></div><p>+{mapControlRyo.toLocaleString()} ryo · +{mapControlHonor} seals · +{mapControlBone} charms</p><button disabled={!ownedVillageSectors.length || mapControlClaimed} onClick={claimMapControlRewards}>{mapControlClaimed ? "Claimed today" : ownedVillageSectors.length ? "Claim territory yield" : "No controlled sectors"}</button></article>
                <article className="town-priority-card" data-state={character.guardQueued ? "ready" : "progress"}><div><span>Village Guard</span><strong>{character.guardQueued ? "On duty" : `${guardList.length} active`}</strong></div><p>Town defense bonus +{getTownDefenseGuardBonus(character).toFixed(2)}% while queued.</p><button onClick={() => setTab("guard")}>{character.guardQueued ? "Review guard post" : "Open guard post"}</button></article>
            </div></section>
            <div className="town-hall-grid"><section className="summary-box town-hall-panel"><h3>Village overview</h3><div className="town-leader-row"><LeaderPortrait image={getLeaderImage(state.seatedKage, leadershipImages.kage)} name={displayedKage} fallback="?" /><div><small>Village leadership</small><strong>{displayedKage}</strong><p>{population.toLocaleString()} citizens · {villageStrength.toLocaleString()} strength</p></div></div>{kageSeatVacant && <p className="hint town-seat-vacant">The seat stands empty — claim it at the Shinobi Council Hall. <button type="button" className="town-seat-claim" onClick={() => setScreen("shinobiCouncil")}>Open the Council Hall</button></p>}<h4>Active village bonuses</h4><div className="village-buff-list"><span>Training +{getTrainingXpBonus(character).toFixed(2)}%</span><span>Jutsu +{getJutsuTrainingSpeedBonus(character).toFixed(2)}%</span><span>Shop −{getShopDiscountPercent(character).toFixed(2)}%</span><span>Guard +{getTownDefenseGuardBonus(character).toFixed(2)}%</span><span>Pet XP +{getPetXpBonus(character).toFixed(2)}%</span><span>Bank +{getBankInterestPercent(character).toFixed(2)}%</span><span>Missions +{getMissionRewardBonus(character).toFixed(2)}%</span><span>Hospital −{getHospitalDiscountPercent(character).toFixed(2)}%</span></div></section>
                <section className="summary-box town-hall-panel"><div className="town-panel-head"><h3>War operations</h3><span className={primaryVillageWar ? "war-status at-war" : "war-status peace"}>{primaryVillageWar ? `At war · ${activeWarEnemyVillage}` : "Peace"}</span></div>{primaryVillageWar ? <><p><strong>{character.village}</strong> · {primaryVillageWar.hp[character.village].toLocaleString()} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</p><div className="bar enemy-bar"><span style={{ width: `${primaryVillageWar.hp[character.village] / VILLAGE_WAR_HP_MAX * 100}%` }} /></div><p><strong>{activeWarEnemyVillage}</strong> · {activeWarEnemyVillage ? primaryVillageWar.hp[activeWarEnemyVillage].toLocaleString() : 0} / {VILLAGE_WAR_HP_MAX.toLocaleString()} HP</p><div className="town-upgrade-bar"><span style={{ width: `${activeWarEnemyVillage ? primaryVillageWar.hp[activeWarEnemyVillage] / VILLAGE_WAR_HP_MAX * 100 : 0}%` }} /></div><p className="hint">War Ground · Sector {primaryVillageWar.warGroundSector} · {primaryVillageWar.warGroundHp.toLocaleString()} / {VILLAGE_WAR_GROUND_HP_MAX.toLocaleString()} HP</p></> : <p className="hint">No active village war. Declarations and sector campaigns are managed in the war halls.</p>}<div className="town-war-actions"><button onClick={() => setScreen("villageWar")}><GiCrossedSwords aria-hidden="true" /> War Hall</button><button onClick={() => setScreen("villageWarMap")} disabled={!sectorMapOpen} title={!sectorMapOpen ? sectorMapStatus : undefined}><GiTreasureMap aria-hidden="true" /> Sector Map</button></div>{!sectorMapOpen && <p className="hint" role="status">{sectorMapStatus}</p>}</section></div>
            <div className="town-secondary-grid"><section className={state.kageSystemUnlocked ? "summary-box kage-unlock-panel unlocked" : "summary-box kage-unlock-panel"}><h3>{state.kageSystemUnlocked ? "Kage system open" : "Kage system sealed"}</h3><p>{state.kageSystemUnlocked ? "Leadership, upgrades, war access, and policy control are active." : "Defeat the village’s level 100 Kage story encounter to unlock civic leadership."}</p>{state.firstLiberator && <p><strong>First Liberator:</strong> {state.firstLiberator}</p>}</section><section className="summary-box town-notice-board"><h3>Village notices</h3>{state.notices.map((notice, idx) => <p key={`${notice}-${idx}`}>• {notice}</p>)}</section></div>
            <section className="summary-box"><h3>War records</h3><div className="war-record-grid">{endedVillageWars.map((war, idx) => <div key={`${war.opponent}-${idx}`} className="war-record-card"><strong>{war.winner} vs {war.opponent}</strong><span>{war.finalScore}</span><small>{war.date} · MVP {war.topDefender}</small><small>{war.rewards}</small></div>)}</div></section>
        </div>}
        {tab === "upgrades" && <section className="summary-box town-upgrade-summary"><div className="town-section-heading"><p className="act-label">Development office</p><h3>Village Upgrades</h3></div><div className="town-upgrade-overview"><span><small>Authority</small><strong>{isSeatedKage ? "Kage access" : state.seatedKage ?? "Seat unclaimed"}</strong></span><span><small>Development</small><strong>{totalUpgradeLevel} / {VILLAGE_UPGRADE_MAX_LEVEL * villageUpgradeDefinitions.length}</strong></span><span><small>Treasury funds</small><strong>{(state.treasury?.honorSeals ?? 0).toLocaleString()} seals</strong></span></div><p className="hint">Upgrades you can authorize now appear first. Future and completed projects follow.</p>
            <div className="town-upgrade-grid">
                <div className="town-upgrade-card hollow-gate-card" data-state={isSeatedKage && (character.honorSeals ?? 0) >= HOLLOW_GATE_UNLOCK_COST ? "ready" : "locked"} style={{ order: isSeatedKage && (character.honorSeals ?? 0) >= HOLLOW_GATE_UNLOCK_COST ? 0 : 1 }}>
                    <div className="town-upgrade-topline"><span className="town-upgrade-icon"><img src={HOLLOW_GATE_IMAGE} alt="Hollow Gate" /></span><div><strong>Hollow Gate</strong><p>{hollowGateOpen ? `Sealed Door Opened — ${hollowGateDaysLeft(state)}d left` : `Sealed Door — ${HOLLOW_GATE_UNLOCK_DAYS}-Day Unlock`}</p></div></div>
                    <p className="town-upgrade-desc">Opens the Hollow Gate dungeon from the World Map for {HOLLOW_GATE_UNLOCK_DAYS} days.</p>
                    <p className="town-upgrade-bonus">{hollowGateOpen ? <span style={{ color: "#86efac" }}>Open until {new Date(hollowGateUntil).toLocaleDateString()} · re-break to add {HOLLOW_GATE_UNLOCK_DAYS} days.</span> : <>Cost: <strong>{HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals</strong> · {HOLLOW_GATE_UNLOCK_DAYS} days</>}</p>
                    <button disabled={townActionBusy !== null || !isSeatedKage || (character.honorSeals ?? 0) < HOLLOW_GATE_UNLOCK_COST} onClick={purchaseHollowGateUnlock}>{townActionBusy === "hollow-gate" ? "Committing…" : !isSeatedKage ? "Kage Only" : (character.honorSeals ?? 0) < HOLLOW_GATE_UNLOCK_COST ? `Need ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals` : hollowGateOpen ? `Extend +${HOLLOW_GATE_UNLOCK_DAYS} Days — ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals` : `Break the Seal — ${HOLLOW_GATE_UNLOCK_COST.toLocaleString()} Honor Seals`}</button>
                </div>
                {villageUpgradeDefinitions.map((upgrade) => { const level = upgrades[upgrade.key]; const bonus = level * upgrade.perLevel; const cost = villageUpgradeCost(upgrade.key, level); const maxed = level >= VILLAGE_UPGRADE_MAX_LEVEL; const canAfford = (state.treasury?.honorSeals ?? 0) >= cost; const ready = isSeatedKage && canAfford && !maxed; return <div key={upgrade.key} className="town-upgrade-card" data-state={ready ? "ready" : maxed ? "done" : "locked"} style={{ order: ready ? 0 : maxed ? 2 : 1 }}><div className="town-upgrade-topline"><span className="town-upgrade-icon">{UPGRADE_IMAGES[upgrade.key] ? <img src={UPGRADE_IMAGES[upgrade.key]} alt="" /> : upgrade.icon}</span><div><strong>{upgrade.name}</strong><p>Level {level}/{VILLAGE_UPGRADE_MAX_LEVEL}</p></div></div><div className="town-upgrade-bar"><span style={{ width: `${level / VILLAGE_UPGRADE_MAX_LEVEL * 100}%` }} /></div><p className="town-upgrade-desc">{upgrade.description}</p><p className="town-upgrade-bonus">Current <strong>{bonus.toFixed(2)}{upgrade.unit}</strong></p><button disabled={townActionBusy !== null || !isSeatedKage || maxed || !canAfford} onClick={() => upgradeTownFeature(upgrade.key)}>{townActionBusy === upgrade.key ? "Upgrading…" : !isSeatedKage ? "Kage authorization required" : maxed ? "Complete" : canAfford ? `Upgrade · ${cost.toLocaleString()} seals` : `Need ${cost.toLocaleString()} seals`}</button></div>; })}
            </div>
            {warStructures && (
                <div className="town-war-structures" style={{ marginTop: "1.2rem" }}>
                    <h4><GiCrossedSwords aria-hidden="true" /> Permanent War Structures</h4>
                    <p className="hint">Permanent projects spend treasury seals and add daily WR upkeep. Unfunded structures go dormant. Per-war defenses remain on the Sector Map.</p>
                    <div className="town-upgrade-grid">
                        {PERMANENT_WAR_STRUCTURES.map((s) => {
                            const level = warStructures![s.key] ?? 0;
                            const maxed = level >= 10;
                            const upkeepNow = warStructureUpkeepWr(level);
                            const upkeepNext = warStructureUpkeepWr(level + 1);
                            return (
                                <div key={s.key} className="town-upgrade-card" data-state={isSeatedKage && !maxed ? "ready" : maxed ? "done" : "locked"} style={{ order: isSeatedKage && !maxed ? 0 : maxed ? 2 : 1 }}>
                                    <div className="town-upgrade-topline"><span className="town-upgrade-icon">{STRUCTURE_IMAGES[s.key] ? <img src={STRUCTURE_IMAGES[s.key]} alt="" /> : <GiPagoda aria-hidden="true" />}</span><div><strong>{s.name}</strong><p>Level {level}/10</p></div></div>
                                    <div className="town-upgrade-bar"><span style={{ width: `${(level / 10) * 100}%` }} /></div>
                                    <p className="town-upgrade-desc">{s.desc}</p>
                                    <p className="town-upgrade-bonus">Daily upkeep: <strong>{upkeepNow} WR/day</strong>{!maxed && <> · at L{level + 1}: <strong>{upkeepNext} WR/day</strong></>}</p>
                                    <button disabled={!isSeatedKage || warStructBusy === s.key || maxed} onClick={() => upgradeWarStruct(s.key)}>{!isSeatedKage ? "Kage Only" : maxed ? "Max Level" : warStructBusy === s.key ? "…" : "Upgrade — Treasury Honor Seals"}</button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </section>}
        {tab === "treasury" && <section className="summary-box"><h3><GiMoneyStack aria-hidden="true" /> Village Treasury</h3><p className="hint">Honor Seals are the village war and boost reserve for Kage spending.</p><div className="treasury-grid"><p><strong>Ryo:</strong> {state.treasury.ryo.toLocaleString()}</p><p><strong>Honor Seals:</strong> {state.treasury.honorSeals.toLocaleString()}</p><p><strong>Fate Shards:</strong> {state.treasury.fateShards}</p><p><strong>Bone Charms:</strong> {state.treasury.boneCharms}</p><p><strong>Aura Stones:</strong> {state.treasury.auraStones}</p><p><strong>Mythic Seals:</strong> {state.treasury.mythicSeals}</p>{storesOpen && <><p className="town-store-row"><strong>Provisions:</strong> {storesLoaded ? `${storesView.provisions.toLocaleString()} rations` : "—"}</p><p className="town-store-row"><strong>Materials:</strong> {storesLoaded ? `${storesView.materialPoints.toLocaleString()} materials` : "—"}</p></>}<p><strong>Your Contribution:</strong> {state.contributionPoints} points</p></div>{storesOpen && <>{!storesLoaded && <p className="hint" role="status">{storesFetch === "error" ? "The stores could not be read. Try again in a moment." : "Fetching the stores…"}</p>}{storesAuthorityLine && <p className="hint town-store-authority">{storesAuthorityLine}</p>}<p className="hint">Provisions feed sector wars, mercenary bands and fed garrisons, and 5% of them spoil nightly. Materials become War Resources at the Supply Depot ({DEPOT_CONVERSION_POINTS_PER_WR} materials = 1 War Resource) and pay for level 6+ structures.</p><p className="hint">🍚 Donated <b>ration packs</b> stock Provisions and <b>hunt materials / relics</b> stock Materials (up to {DAILY_RATION_DONATION_CAP} rations and {DAILY_CRAFT_POINT_DONATION_CAP.toLocaleString()} materials per player per day). Cook rations at the Cafeteria.</p><p className="hint">{villageDonateCapLine} Resets at midnight UTC.</p></>}<label>Donate Ryo <small>(max {TREASURY_DONATE_MAX_RYO.toLocaleString()} per donation)</small></label><input type="number" min={1} max={TREASURY_DONATE_MAX_RYO} value={donation} onChange={(e) => setDonation(Math.min(TREASURY_DONATE_MAX_RYO, Math.max(0, Number(e.target.value))))} /><div className="menu"><button onClick={donateVillageRyo}>Donate Ryo</button><button onClick={() => donateVillageSpecial("honorSeals")}>Donate 1 Honor Seal</button><button onClick={() => donateVillageSpecial("fateShards")}>Donate 1 Fate Shard</button><button onClick={() => donateVillageSpecial("boneCharms")}>Donate 1 Bone Charm</button><button onClick={() => donateVillageSpecial("auraStones")}>Donate 1 Aura Stone</button><button onClick={() => donateVillageSpecial("mythicSeals")}>Donate 1 Mythic Seal</button></div><label>Donate Item</label><select value={villageDonateItemId} onChange={(e) => setVillageDonateItemId(e.target.value)}><option value="">Choose item</option>{villageInventoryStacks.map(stack => <option key={stack.itemId} value={stack.itemId}>{stack.name} x{stack.count}</option>)}</select>{!villageDonateGate.ok && <p className="hint town-donate-reason" id="village-donate-reason" role="status">{villageDonateGate.reason}. The cap resets at midnight UTC.</p>}<button type="button" onClick={donateVillageItem} disabled={!villageDonateItemId || !villageDonateGate.ok} aria-describedby={villageDonateGate.ok ? undefined : "village-donate-reason"}>{villageDonateLabel}</button>{storesOpen && <><h4>Supply log</h4><p className="hint">{storesLedgerScopeLine(character.village)}</p>{storesFetch === "error" ? <p className="hint" role="status">The stores ledger could not be read. Try again in a moment.</p> : storesFetch === "loading" ? <p className="hint" role="status">Reading the supply log…</p> : storesLedgerView.length === 0 ? <p className="hint town-stores-log-empty">{storesLedgerEmptyLine(storesView)}</p> : <ul className="town-stores-log">{storesLedgerView.map((row) => <li key={row.key} data-kind={row.kind}><span className="town-stores-log-icon" aria-hidden="true">{row.icon}</span><span>{row.text}</span></li>)}</ul>}</>}<h4>Treasury Items</h4>{villageTreasuryItems.length === 0 ? <p className="hint">No donated items yet.</p> : <div className="treasury-grid">{villageTreasuryItems.map(stack => <p key={stack.itemId}><strong>{itemDisplayName(stack.itemId, allVillageItems)}:</strong> x{stack.count}</p>)}</div>}{isSeatedKage && <section className="summary-box"><h3>Kage Gift Village Treasury</h3><p className="hint">The seated Kage can gift donated resources or items to village players. A {TREASURY_GIFT_TAX_LABEL} transit levy is burned on everything except Honor Seals, which move in full.</p><label>Recipient</label><select value={villageSendPlayer} onChange={(e) => setVillageSendPlayer(e.target.value)}><option value="">Choose village player</option>{villagePlayers.map(name => <option key={name} value={name}>{name}</option>)}</select><label>Resource</label><select value={villageSendCurrency} onChange={(e) => setVillageSendCurrency(e.target.value as VillageTreasuryCurrencyKey)}><option value="ryo">Ryo</option><option value="honorSeals">Honor Seals</option><option value="fateShards">Fate Shards</option><option value="boneCharms">Bone Charms</option><option value="auraStones">Aura Stones</option><option value="mythicSeals">Mythic Seals</option></select><input type="number" min={1} value={villageSendAmount} onChange={(e) => setVillageSendAmount(Number(e.target.value))} /><div className="menu"><button onClick={sendVillageCurrency}>Gift Resource</button></div><label>Item</label><select value={villageSendItemId} onChange={(e) => setVillageSendItemId(e.target.value)}><option value="">Choose treasury item</option>{villageTreasuryItems.map(stack => <option key={stack.itemId} value={stack.itemId}>{itemDisplayName(stack.itemId, allVillageItems)} x{stack.count}</option>)}</select><button onClick={sendVillageItem} disabled={!villageSendItemId}>Gift Donated Item</button></section>}</section>}
        {tab === "guard" && <section className="summary-box"><h3>Village Guard Queue</h3><p className="hint">Queue to apply your Town Defense bonus against all combat styles.</p><p>Defense bonus <strong>+{getTownDefenseGuardBonus(character).toFixed(2)}%</strong></p><button className={character.guardQueued ? "danger-button" : ""} onClick={toggleTownGuard} disabled={guardBusy}>{guardBusy ? "Updating…" : character.guardQueued ? "Leave Guard Queue" : "Queue as Village Guard"}</button><h4>Active Defenders</h4>{guardList.length === 0 ? <p className="hint">No active guards.</p> : <div className="clan-guard-list">{guardList.map(g => <div key={g.name} className="clan-guard-row"><span><GiShield aria-hidden="true" /> <strong>{g.name}</strong></span><span className="clan-guard-lvl">Lv. {g.level}{g.defenseBonusPercent ? ` · DEF +${g.defenseBonusPercent.toFixed(1)}%` : ""}</span></div>)}</div>}</section>}
        {tab === "notices" && <section className="summary-box town-notice-board"><h3>Village Orders</h3><p className="hint">Kage, ANBU, and Elders can post and pin orders for {character.village}.</p>{canPostVillageOrder && <div className="summary-box"><div className="treasury-grid"><div><label>Type</label><select value={villageNoticeType} onChange={(event) => setVillageNoticeType(event.target.value as NoticePostType)}><option value="order">Leadership Order</option><option value="raid">Raid Target</option><option value="guard">Guard Request</option><option value="medic">Medic Request</option><option value="trade">Trade / Supply</option><option value="general">General</option></select></div><div><label>Sector</label><input type="number" min={1} max={MAX_WILD_SECTOR} value={villageNoticeSector} onChange={(event) => setVillageNoticeSector(event.target.value)} placeholder="Optional" /></div></div><label>Title</label><input value={villageNoticeTitle} maxLength={70} onChange={(event) => setVillageNoticeTitle(event.target.value)} placeholder="Defend Sector 18" /><label>Message</label><textarea value={villageNoticeBody} maxLength={500} onChange={(event) => setVillageNoticeBody(event.target.value)} placeholder="Issue the order…" /><button onClick={postVillageNotice} disabled={!villageNoticeTitle.trim() || !villageNoticeBody.trim()}>Post Order</button></div>}<div className="notice-board-list">{state.noticePosts.length === 0 ? <p className="hint">No active orders.</p> : state.noticePosts.map(notice => { const canEditNotice = isSeatedKage || notice.author === character.name; return <div key={notice.id} className={`notice-post ${notice.pinned ? "pinned" : ""}`}><div className="notice-post-head"><span>{notice.pinned ? "Pinned " : ""}{noticeTypeLabel(notice.type)}</span><small>{new Date(notice.createdAt).toLocaleString()} · {notice.author} · {notice.authorRole}</small></div><strong>{notice.title}</strong><p>{notice.body}</p>{notice.sector && <small>Sector {notice.sector}</small>}{canEditNotice && <div className="menu"><button onClick={() => toggleVillageNoticePin(notice.id)}>{notice.pinned ? "Unpin" : "Pin"}</button><button className="danger-button" onClick={() => removeVillageNotice(notice.id)}>Delete</button></div>}</div>; })}</div></section>}
        {tab === "mercenaries" && <section className="summary-box"><h3><GiCrossedSwords aria-hidden="true" /> War Mercenaries</h3>{!primaryVillageWar ? <p className="hint">Mercenaries become available during an active village war.</p> : <><p className="hint">Hire each band once per war to strike {activeWarEnemyVillage}. Mercenaries cannot land the final blow.</p><p className="hint"><strong>{(character.honorSeals ?? 0).toLocaleString()}</strong> seals · {hiredMercTiers.length}/{MERCENARY_TIERS.length} bands hired</p><div className="town-upgrade-grid">{MERCENARY_TIERS.map(tier => { const hired = hiredMercTiers.includes(tier.id); const afford = (character.honorSeals ?? 0) >= tier.costSeals; const busy = mercBusy === tier.id; return <div key={tier.id} className="town-upgrade-card" data-state={hired ? "done" : afford ? "ready" : "locked"} style={{ order: hired ? 2 : afford ? 0 : 1 }}><div className="town-upgrade-topline"><span className="town-upgrade-icon town-merc-icon">{mercPortrait(tier.id) ? <img src={mercPortrait(tier.id)} alt={tier.name} /> : <GiBroadsword aria-hidden="true" />}</span><div><strong>{tier.name}</strong><p>Level {tier.level}</p></div></div><p className="town-upgrade-desc">{tier.blurb}</p><p className="town-upgrade-bonus"><strong>{tier.warDamage.toLocaleString()}</strong> war damage · <strong>{tier.costSeals.toLocaleString()}</strong> seals</p><button disabled={hired || !afford || busy} onClick={() => hireMercenary(tier.id)}>{hired ? "Hired" : busy ? "Hiring…" : afford ? `Hire · ${tier.costSeals.toLocaleString()} seals` : `Need ${tier.costSeals.toLocaleString()} seals`}</button></div>; })}</div></>}</section>}
        {tab === "politics" && <>
            <section className="summary-box town-council-panel">
                <div className="town-council-heading">
                    <div><p className="act-label">Council chamber</p><h3>Village Council</h3><p className="hint">Choose one elder doctrine. Changing focus replaces your current personal bonus immediately.</p></div>
                    <span className="town-focus-summary" data-active={Boolean(character.elderFocus)}>{character.elderFocus ? `${character.elderFocus[0].toUpperCase()}${character.elderFocus.slice(1)} focus` : "No focus selected"}</span>
                </div>
                <div className="town-leader-row town-kage-card"><LeaderPortrait image={getLeaderImage(state.seatedKage, leadershipImages.kage)} name={displayedKage} fallback="?" /><p><small>Presiding seat</small><strong>{displayedKage}</strong>{kageActivity && <><br /><small>{kageActivity.lastActive}</small></>}{kageActivity?.warning && <><br /><small className="town-kage-warning">⚠️ {kageActivity.warning}</small></>}</p></div>
                {kageSeatVacant && <p className="hint town-seat-vacant">The seat stands empty — claim it at the Shinobi Council Hall. <button type="button" className="town-seat-claim" onClick={() => setScreen("shinobiCouncil")}>Open the Council Hall</button></p>}
                <div className="elder-seat-grid">{ELDER_FOCUS_OPTIONS.map((option, index) => {
                    const active = character.elderFocus === option.key;
                    const busy = elderFocusBusy === option.key;
                    const elderName = leadership.elders[index] ?? option.role;
                    return <article key={option.key} className={`elder-card${active ? " elder-card-active" : ""}`} data-focus={option.key} data-active={active}>
                        <span className="town-elder-state">{active ? "Appointed focus" : "Available doctrine"}</span>
                        <div className="town-elder-portrait"><LeaderPortrait image={leadershipImages.elders?.[index]} name={elderName} fallback="?" /></div>
                        <span className="town-elder-role">{option.role}</span>
                        <strong className="town-elder-name">{elderName}</strong>
                        <p className="town-elder-brief">{option.brief}</p>
                        <small className="town-elder-bonus">{option.bonus}</small>
                        {active
                            ? <div className="town-elder-selected" role="status"><GiCrown aria-hidden="true" /> Current focus</div>
                            : <button type="button" disabled={elderFocusBusy !== null} onClick={() => supportVillageFocus(option.role, option.key)}>{busy ? "Appointing…" : "Select focus"}</button>}
                    </article>;
                })}</div>
            </section>
            <section className="summary-box"><h3>ANBU Black Ops</h3><p className="hint">Seats 1–3 are Kage-appointed; 4–10 rank by monthly PvP kills ({currentAnbuMonth}).</p><datalist id="anbu-player-options">{villagePlayers.map(name => <option key={name} value={name} />)}</datalist>{isSeatedKage && <div className="treasury-grid">{[0, 1, 2].map(index => <div key={index}><label>Seat {index + 1}</label><input list="anbu-player-options" value={anbuAppointmentInputs[index] ?? ""} onChange={(event) => updateAnbuAppointmentInput(index, event.target.value)} placeholder="Choose player" /><div className="menu"><button onClick={() => appointAnbu(index)}>Appoint</button><button className="danger-button" onClick={() => clearAnbuAppointment(index)}>Clear</button></div></div>)}</div>}<div className="contrib-rank-grid">{anbuSlots.map((slot, idx) => <div key={`anbu-${idx}-${slot?.name ?? "empty"}`} className="clan-guard-row"><span>#{idx + 1} <strong>{slot?.name ?? "Open seat"}</strong>{slot && ` · ${slot.rankTitle}`}</span><span>{slot ? `${idx < 3 ? "Appointed" : "Earned"} · ${slot.monthlyKills.toLocaleString()} kills` : "Vacant"}</span></div>)}</div><h4>Field authority</h4><div className="contrib-rank-grid"><div className="clan-guard-row"><span>Recon sectors</span><span>Reveal defenses</span></div><div className="clan-guard-row"><span>Guard sectors</span><span>Village-wide access</span></div><div className="clan-guard-row"><span>Support raids</span><span>Clan pressure</span></div></div></section>
            <section className="summary-box"><h3>Kage Challenge</h3><p className="hint">Win the duel or exhaust the Kage’s accept clock. The seat gate is <strong>Village Merit</strong> — a personal record, not the village contribution ranking below.</p><div className="contrib-rank-grid">{kageEligibility(character, kageNow).map(req => <div key={req.label} className="clan-guard-row"><span>{req.ok ? "✅" : "⬜"} {req.label}</span><span>{req.detail ?? ""}</span></div>)}</div><div className="contrib-rank-grid">{contributionRankings.map((row, idx) => <div key={row.name} className="clan-guard-row"><span>#{idx + 1} <strong>{row.name}</strong> · {row.role}</span><span>{row.points.toLocaleString()} points</span></div>)}</div>{kageChallenge ? <div className={`notice-post ${kageChallenge.status === "accepted" ? "pinned" : ""}`}><div className="notice-post-head"><span>{kageChallenge.status.toUpperCase()}</span><small>{new Date(kageChallenge.createdAt).toLocaleString()}</small></div><strong>{kageChallenge.challenger} vs {serverKage?.seatedKage}</strong><p>Accept clock <strong>{formatObligation(kageChallenge.obligationRemainingMs)}</strong></p>{isKageChallenger && <button onClick={() => void sendKageDuel()}>Send Official Duel</button>}{isSeatedKage && <p className="hint">Accept the duel before the clock expires.</p>}</div> : <><button onClick={() => void declareChallenge()} disabled={!serverKage?.kageSystemUnlocked || isSeatedKage}>Declare Challenge · {KAGE_CHALLENGE_RYO_COST.toLocaleString()} ryo</button><p className="hint">{isSeatedKage ? "You hold the Kage seat." : "No active challenge."}</p></>}</section>
        </>}
    </div>;
}

// Shop family (shop, card packs, grand marketplace) moved to ./components/Shop.
