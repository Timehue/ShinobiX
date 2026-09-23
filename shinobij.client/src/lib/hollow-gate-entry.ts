import type { Dispatch, SetStateAction } from "react";
import { gameConfirm } from "../components/GameAlert";
import { HOLLOW_GATE_KEY_ID } from "../constants/game";
import { weatherForBiome } from "../data/sectors";
import type { Pet } from "../types/pet";
import type { Character, HollowGateEventConfig, HollowGateShrineRun } from "../types/character";
import type { Screen, WeatherType } from "../types/core";
import { activeCarriedPets } from "./entitlements";
import { countItem } from "./inventory";
import { currentDateKey } from "./utils";
import { attunementDailyBonus } from "./hollow-gate-attunement";
import { buildHollowGateRunFromStart, HOLLOW_GATE_FLOOR_LOAD_FAILED } from "./hollow-gate-run-build";
import { sealHollowGateFloor } from "./hollow-gate-event-api";
import { startHollowGateServerRun, resumeHollowGateServerRun, attachStartedRun } from "./hollow-gate-server";
import { hollowGateRunMaxFloor, hollowGateBossDisplayName, variantFromEventConfig } from "./hollow-gate-variant";
import { isHollowGateUnlocked, loadVillageState } from "./world-state";
import { requireServerSettlement } from "./server-settlement-gate";
import type { HiddenChamberState, HollowGateEventModal } from "./hollow-gate-tile";

type SetState<T> = Dispatch<SetStateAction<T>>;

type HollowGateEntryParams = {
    eventCfg?: HollowGateEventConfig;
    character: Character | null;
    setHollowGateRun: SetState<HollowGateShrineRun | null>;
    setHollowGateLog: SetState<string[]>;
    setHollowGateEvent: SetState<HollowGateEventModal>;
    setHollowGateHiddenChamber: SetState<HiddenChamberState>;
    setCharacter: SetState<Character | null>;
    setCurrentBiome: (value: "shadow") => void;
    setCurrentWeather: (value: WeatherType) => void;
    setScreen: (value: Screen) => void;
    setHollowGateIntroPage: SetState<number | null>;
    pushHollowGateLog: (line: string) => void;
};

/** Restore or start one sealed Hollow Gate run, then publish its entry state. */
export async function enterHollowGateShrineFlow(params: HollowGateEntryParams) {
    const {
        eventCfg, character, setHollowGateRun, setHollowGateLog, setHollowGateEvent,
        setHollowGateHiddenChamber, setCharacter, setCurrentBiome, setCurrentWeather,
        setScreen, setHollowGateIntroPage, pushHollowGateLog,
    } = params;
    if (!requireServerSettlement("hollowGateRun")) return;
    if (!character) return;
    // Event gates reshape the run (fewer floors / smaller board / bespoke
    // boss) and may relax the entry gates; the standard shrine when absent.
    const variant = eventCfg ? variantFromEventConfig(eventCfg) : undefined;
    const gateName = eventCfg?.label || (eventCfg ? "Event Gate" : "Hollow Gate Shrine");
    // If the start response or first browser save was interrupted, replay
    // the exact request marker. This neither spends a second key nor bumps
    // the daily count; the start endpoint returns the durable original run.
    if (!character.hollowGateRun && character.lastHollowGateStart?.requestId) {
        const pending = character.lastHollowGateStart;
        const recovered = await startHollowGateServerRun(
            character.name,
            hollowGateRunMaxFloor({ variant }),
            variant?.id,
            pending.requestId,
        );
        if (!recovered?.token || recovered.token !== pending.token) {
            alert("Your paid Hollow Gate start could not be recovered safely. No new key was spent; retry after reconnecting.");
            return;
        }
        const recoveredBase = recovered.character ?? character;
        const run = await buildHollowGateRunFromStart(recovered, variant, recoveredBase).catch(() => null);
        if (!run) {
            alert(HOLLOW_GATE_FLOOR_LOAD_FAILED);
            return;
        }
        const floorSeal = await sealHollowGateFloor(character.name, recovered.token, run);
        setHollowGateRun(run);
        setHollowGateLog([
            "You recover the descent interrupted at the broken torii. The same sealed key record restores your route.",
            ...(!floorSeal.ok ? [`Floor seal pending: ${floorSeal.error || "retry after reconnect"}. Movement remains server-blocked until the seal succeeds.`] : []),
        ]);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setCharacter({ ...recoveredBase, hollowGateRun: run });
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setScreen("hollowGateShrine");
        attachStartedRun(recovered, { playerName: character.name, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
        return;
    }
    // Restore an in-progress run, if any. Resuming a run is always free —
    // the key was already consumed when the run was started. The Character
    // normalizer resets daily counters at midnight UTC.
    if (character.hollowGateRun && !character.hollowGateRun.completed) {
        setHollowGateRun(character.hollowGateRun);
        setHollowGateLog(prev => prev.length ? prev : ["You return to your unfinished run. The floor marks and opened passages are unchanged."]);
        setHollowGateEvent(null);
        setHollowGateHiddenChamber(null);
        setCurrentBiome("shadow");
        setCurrentWeather(weatherForBiome("shadow"));
        setScreen("hollowGateShrine");
        // Refreshed mid-pick? re-present the augment picker (never re-mints the token).
        resumeHollowGateServerRun({ playerName: character.name, run: character.hollowGateRun, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
        return;
    }

    if (variant?.id?.startsWith("rift-")) {
        const { riftEntryReadiness, riftEntryRequirementMessage } = await import("../../../shared/rift-entry-readiness");
        const readiness = riftEntryReadiness(
            activeCarriedPets<Pet>(character).length,
            character.cardClashDeck,
            character.tileCards,
        );
        if (!readiness.ready) {
            alert(riftEntryRequirementMessage(readiness));
            return;
        }
    }

    // Entry rules — BOTH conditions required to start a new run:
    //   (1) The Kage has purchased the Hollow Gate upgrade for this village.
    //       (Event gates skip this unless the config demands it.)
    //   (2) The player owns a Hollow Gate Key, consumed on entry (event
    //       gates may set keyCost 0 = free entry).
    const village = loadVillageState(character.village);
    if ((!eventCfg || eventCfg.requiresUnlock) && !isHollowGateUnlocked(village)) {
        alert("The Hollow Gate seal is still bound. Your village Kage must purchase the Hollow Gate upgrade from the Town Hall before anyone can enter.");
        return;
    }
    const keyCost = eventCfg ? (eventCfg.keyCost ?? 1) : 1;
    const ownedKeys = countItem(character, HOLLOW_GATE_KEY_ID);
    if (keyCost > 0 && ownedKeys <= 0) {
        alert("You need a Hollow Gate Key to enter the shrine. Forge one from Hollow Shards in Shrine Attunement (Key Forge), pry one from shrine chests, or complete your village story.");
        return;
    }
    // Daily run cap — hard-capped at 2 regardless of key inventory. The
    // shrine itself refuses to open more than twice between dawns.
    // Counter is reset when lastDailyReset != today. Event runs share it.
    const todayKey = currentDateKey();
    const runsToday = character.lastDailyReset === todayKey ? (character.dailyHollowGateRuns ?? 0) : 0;
    const DAILY_HOLLOW_GATE_CAP = 2 + attunementDailyBonus(character);
    if (runsToday >= DAILY_HOLLOW_GATE_CAP) {
        alert(`The entry seal has already admitted you ${runsToday}/${DAILY_HOLLOW_GATE_CAP} times today. Return at dawn.`);
        return;
    }
    const floorsLine = eventCfg ? `\nEvent gate: ${hollowGateRunMaxFloor({ variant })} floor${hollowGateRunMaxFloor({ variant }) === 1 ? "" : "s"}, final boss: ${hollowGateBossDisplayName({ variant })}.` : "";
    const keyLine = keyCost > 0 ? `This consumes 1 Hollow Gate Key (${ownedKeys} owned). Keys are one-time use.` : "Entry is free for this event.";
    const ok = await gameConfirm(`Enter the ${gateName}?\n${floorsLine}\n${keyLine}\nDaily runs: ${runsToday}/${DAILY_HOLLOW_GATE_CAP}.`, { title: gateName, confirmLabel: "Enter" });
    if (!ok) return;

    // Server daily-cap HARD-block (audit #7): with the server-auth flag on, ask the
    // server BEFORE spending the Key — a 'daily-cap' reply (e.g. a backdated reset
    // that beat the client gate) blocks the dive. Unreachable / SESSION unset → null
    // → hard stop. A reward-bearing local fallback is never mounted.
    // The settle ledger scales with floorDepth — a short event gate
    // declares its own depth so settlement matches the shorter run.
    const serverStart = await startHollowGateServerRun(character.name, hollowGateRunMaxFloor({ variant }), variant?.id, undefined, character.cardClashDeck);
    if (serverStart?.reason === "daily-cap") {
        alert("The daily entry seal has reached its limit. Return at dawn.");
        return;
    }
    // Named explicitly: the generic fallback below says to retry when the connection is stable, which is unactionable until discharge.
    if (serverStart?.reason === "hospitalized") { alert("You are still being treated. Leave the hospital before descending — no key was spent."); return; }
    if (serverStart?.reason === "rift-entry-not-ready") {
        alert("The rift requires 4 carried pets and a legal 40-card Chronicle deck from Card Hall. Prepare your party and deck, then return. No daily entry was used.");
        return;
    }
    if (!serverStart?.token || !serverStart.character) {
        alert("The Hollow Gate could not establish a secure server run. No key was spent locally; retry when the connection is stable.");
        return;
    }

    // The returned committed save contains the exact server-side key debit.
    const afterKey = serverStart.character;

    const run = await buildHollowGateRunFromStart(serverStart, variant, character).catch(() => null);
    if (!run) {
        alert(HOLLOW_GATE_FLOOR_LOAD_FAILED);
        return;
    }
    const floorSeal = await sealHollowGateFloor(character.name, serverStart.token, run);
    setHollowGateRun(run);
    setHollowGateLog([
        keyCost > 0
            ? "You press a Hollow Gate Key against the broken torii. The seal bends. You descend."
            : `The ${gateName} stands open because its event seal is already released. You descend.`,
        ...(!floorSeal.ok ? [`Floor seal pending: ${floorSeal.error || "retry after reconnect"}. Movement remains server-blocked until the seal succeeds.`] : []),
    ]);
    setHollowGateEvent(null);
    setHollowGateHiddenChamber(null);
    // First-time entry shows the intro VN (3 pages) before the grid is interactable.
    const isFirstEntry = !!variant || !character.hollowGateIntroSeen;
    setHollowGateIntroPage(isFirstEntry ? 0 : null);
    setCharacter({
        ...afterKey,
        hollowGateRun: run,
        ...(!variant ? { hollowGateIntroSeen: true } : {}),
        dailyHollowGateRuns: runsToday + 1,
        lastDailyReset: todayKey,
    });
    setCurrentBiome("shadow");
    setCurrentWeather(weatherForBiome("shadow"));
    setScreen("hollowGateShrine");
    // Attach the server token (already minted above, pre-Key) + present the augment
    // picker. No-op without a token (flag off / unreachable) — the token-first fallback.
    attachStartedRun(serverStart, { playerName: character.name, setRun: setHollowGateRun, setCharacter, setEvent: setHollowGateEvent, pushLog: pushHollowGateLog });
}
