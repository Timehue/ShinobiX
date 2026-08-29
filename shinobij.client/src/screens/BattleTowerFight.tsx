import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import "../styles/battle-skin.css";
import "../styles/tower-tactical.css";
import type { Character, BattleHistoryEntry, VersionedCharacterCommit } from "../types/character";
import { buildActionsFromTowerLog, makeBattleEntry } from "../lib/battle-log-history";
import {
    submitTowerAction, submitTowerActionWithLostResponseRetry, settleTowerRun, fetchTowerState, joinTowerRun, towerPlayerSlug, TOWER_TURN_AFK_MS,
    type TowerSession, type TowerActor, type TowerStatus, type TowerSettleResponse, type TowerSettleResult, type TowerFeature, type TowerBoardObject, type TowerHostLoadout, type TowerActionInput, type TowerActionResponse,
} from "../lib/towers-api";
import gameBg from "../assets/background-image.webp";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, towerClosingRingTiles, HEX_W, HEX_H,
} from "../lib/tower-grid";
import { safeCombatVfxSpec, combatVfxAnchorKey, dedupeCombatVfx, type CombatVfxSpec } from "../lib/combat-vfx";
import { combatVfxAssetFor } from "../lib/combat-vfx-assets";
import { prefersLiteCombatFx } from "../lib/device-tier";
import { useBoardScale } from "../lib/use-board-scale";
import {
    buildTowerMilestoneReceipt, buildTowerThreatSummary, buildTowerTileLabel, clampTowerPan, clampTowerZoom,
    TOWER_ZOOM_MAX, TOWER_ZOOM_MIN, TOWER_ZOOM_STEP, type TowerPan,
} from "../lib/tower-tactical-ui";
import type { StoryFightTheme } from "../lib/story-fight-theme";
import { playStoryChapterSting, playStoryFinalPhaseSting, playStoryVictorySting, primeStorySfx } from "../lib/story-sfx";
import { pvpAffectsOpponent, tagMatchesName } from "../lib/tags";
import {
    activeCombatDisplayStatuses,
    activeBarrierTilesForDisplay,
    adjustedCombatApCost,
    isElementallySealedForDisplay,
} from "../lib/combat-action-display";
import { equipSlotForItem } from "../lib/equipment";
import {
    resolveTowerCombatantArt, resolveTowerStoryArt, TOWER_SPIRE_PORTRAITS, UNKNOWN_TOWER_COMBATANT,
} from "../lib/tower-art-manifest";
import { gameConfirm } from "../components/GameAlert";
import { CombatInstance } from "../components/CombatInstance";
import { BattlefieldActor } from "../components/BattlefieldActor";
import { battlefieldFacingTowardNearest } from "../lib/battlefield-sprite";
import { battlefieldAiSprite } from "../lib/battlefield-actor-art";
import { resolveOwnAvatar } from "../lib/own-avatar";
import { visiblePoll } from "../lib/poll";
import { isRealtimeConnected, onStatus, onTowerKick } from "../lib/presence-socket";
import { spireFloorMeta, SPIRE_SHARDS_PER_TIER } from "../lib/spire-catalog";
import arenaFloorForest from "../assets/towers/arena-floor-forest.webp";
import arenaFloorSnow from "../assets/towers/arena-floor-snow.webp";
import arenaFloorVolcano from "../assets/towers/arena-floor-volcano.webp";
import arenaFloorCentral from "../assets/towers/arena-floor-central.webp";
import arenaFloorShadow from "../assets/towers/arena-floor-shadow.webp";
import objectFont from "../assets/towers/objects/font.webp";
import objectShrine from "../assets/towers/objects/shrine.webp";
import hazardGeyser from "../assets/towers/hazards/geyser.webp";
import obstacleForest from "../assets/towers/obstacles/forest.webp";
import obstacleSnow from "../assets/towers/obstacles/snow.webp";
import obstacleVolcano from "../assets/towers/obstacles/volcano.webp";
import obstacleShadow from "../assets/towers/obstacles/shadow.webp";
import obstacleCentral from "../assets/towers/obstacles/central.webp";
import pylonFire from "../assets/towers/pylons/fire.webp";
import pylonWater from "../assets/towers/pylons/water.webp";
import pylonEarth from "../assets/towers/pylons/earth.webp";
import pylonLightning from "../assets/towers/pylons/lightning.webp";
import pylonWind from "../assets/towers/pylons/wind.webp";
import hazardSprite from "../assets/towers/pylons/hazard.webp";
import wardSprite from "../assets/towers/pylons/ward.webp";

// ─── Battle Tower Fight (fullscreen pop-out combat shell) ─────────────────────
// Renders the server-authoritative tower:<runId> session as a top-down hex
// battlefield — the SAME tessellating clip-path hexes + avatar orbs + biome floor
// the live PvP screen uses (PvpBattleScreen), generalised to N actors. The human
// controls their own actor; allies + enemies are AI, advanced server-side. Boss
// units render larger; pylon/ward/hazard tiles are drawn so the tactical layer is
// usable. On a squad clear it auto-settles rewards. See docs/battle-towers-plan.md §11.

type Mode = "idle" | "move" | "dash" | "attack" | "jutsu" | "weapon" | "clear";
/** A VFX plate in flight on the board. `target` is the anchoring actor's id
 *  (absent for a purely tile-anchored plate). */
type TowerCombatVfx = { id: string; target?: string; spec: CombatVfxSpec };
type ActionFeedback =
    | { phase: "idle" }
    | { phase: "submitting"; label: string }
    | { phase: "error"; label: string; message: string };
type SettlementState = {
    phase: "idle" | "pending" | "settled" | "error";
    response: TowerSettleResponse | null;
    message: string | null;
    attempts: number;
};

const RETRYABLE_SETTLEMENT_REASONS = new Set(["contended", "no-save", "unknown", "invalid-receipt"]);

function settlementRetryMessage(response: TowerSettleResponse, memberSlug: string): string {
    const reasons = [
        response.results[memberSlug]?.reason,
        response.consumables?.[memberSlug]?.reason,
    ].filter((reason): reason is string => Boolean(reason && RETRYABLE_SETTLEMENT_REASONS.has(reason)));
    if (reasons.length > 0) return `The server asked to retry ${reasons.map(reason => reason.replace(/-/g, " ")).join(" and ")}.`;
    return "The server returned a result but did not confirm a stable receipt.";
}

function isStableTowerSettlement(response: TowerSettleResponse): boolean {
    if (response.settled !== true) return false;
    const reasons = [
        ...Object.values(response.results).map(result => result.reason),
        ...Object.values(response.consumables ?? {}).map(result => result.reason),
    ];
    return reasons.every(reason => !reason || !RETRYABLE_SETTLEMENT_REASONS.has(reason));
}

function towerRewardReceiptText(result: TowerSettleResult, spire: boolean): string {
    if (result.paid) return spire
        ? `+${SPIRE_SHARDS_PER_TIER} Fate Shards`
        : result.score ? `First-clear reward paid · score +${result.score}` : "First-clear reward paid";
    if (result.reason === "already-paid") return spire ? "Weekly floor reward already banked" : "This run reward was already banked";
    if (result.reason === "already-first-cleared") return "First-clear reward already claimed · no new reward";
    if (result.reason === "unverified-assist") return "Unverified assist · no progression reward";
    if (result.reason === "not-cleared") return "No clear reward on this attempt";
    return `No new reward${result.reason ? ` · ${result.reason.replace(/-/g, " ")}` : ""}`;
}

function towerActionRejectionText(reason?: string): string {
    if (reason === "stale-version") return "The battlefield changed before this command landed. Review the refreshed board and try again.";
    if (reason === "not-your-turn") return "The turn advanced before this command landed. Wait for your next turn.";
    if (reason === "invalid-target") return "That target is no longer valid. Choose a highlighted target.";
    if (reason === "actor-defeated") return "Your fighter can no longer act in this run.";
    return reason ? reason.replace(/-/g, " ") : "The Tower rejected this command.";
}
type JutsuLike = { id?: string; name?: string; type?: string; element?: string; target?: string; ap?: number; range?: number; effectPower?: number; chakraCost?: number; staminaCost?: number; cooldown?: number; method?: string; tags?: Array<{ name?: string }> };

const TOWER_DIALOG_FOCUSABLE = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Focus the primary action, trap Tab, restore focus, and gate Escape for Tower modals. */
function useTowerDialogFocus<TDialog extends HTMLElement, TPrimary extends HTMLElement>({
    open,
    dialogRef,
    primaryRef,
    escapeAllowed,
    onEscape,
    focusRevision,
}: {
    open: boolean;
    dialogRef: RefObject<TDialog | null>;
    primaryRef: RefObject<TPrimary | null>;
    escapeAllowed: boolean;
    onEscape: () => void;
    focusRevision?: unknown;
}) {
    const escapeAllowedRef = useRef(escapeAllowed);
    const onEscapeRef = useRef(onEscape);
    useEffect(() => {
        escapeAllowedRef.current = escapeAllowed;
        onEscapeRef.current = onEscape;
    }, [escapeAllowed, onEscape]);

    useEffect(() => {
        if (!open) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusFrame = window.requestAnimationFrame(() => {
            const dialog = dialogRef.current;
            const primary = primaryRef.current;
            const primaryEnabled = primary && !primary.matches(":disabled") && primary.getAttribute("aria-disabled") !== "true";
            const fallback = dialog?.querySelector<HTMLElement>(TOWER_DIALOG_FOCUSABLE) ?? dialog;
            (primaryEnabled ? primary : fallback)?.focus({ preventScroll: true });
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (escapeAllowedRef.current) onEscapeRef.current();
                return;
            }
            if (event.key !== "Tab") return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>(TOWER_DIALOG_FOCUSABLE))
                .filter(control => control.getAttribute("aria-hidden") !== "true");
            if (controls.length === 0) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = controls[0]!;
            const last = controls[controls.length - 1]!;
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener("keydown", onKeyDown, true);
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, [open, dialogRef, primaryRef, focusRevision]);
}

function towerTurnRemaining(turnStartedAt: number): number {
    return Math.max(0, Math.ceil((TOWER_TURN_AFK_MS - (Date.now() - turnStartedAt)) / 1_000));
}

function TowerTurnCountdown({ turnStartedAt }: { turnStartedAt: number }) {
    const [remaining, setRemaining] = useState(() => towerTurnRemaining(turnStartedAt));
    useEffect(() => {
        const id = window.setInterval(() => setRemaining(towerTurnRemaining(turnStartedAt)), 1_000);
        return () => window.clearInterval(id);
    }, [turnStartedAt]);
    return <span role="timer" aria-label={`${remaining} seconds remaining`}> · {remaining}s</span>;
}

type TowerRoundPresentation = {
    debriefLabel: string;
    debriefValue: string;
    hudLabel: string;
    hudTitle: string;
    hardLimit: number | null;
};

/**
 * Keep Story score pace, timed objectives, and true hard limits visually distinct.
 * Story `roundBudget` is a par used for score pacing; only protect/survive objectives
 * and sealed Spire/embedded `roundCap` values are deadlines.
 */
function towerRoundPresentation(session: TowerSession): TowerRoundPresentation {
    const objective = session.objectiveState.kind;
    const goal = Number((session.sealedCatalogFloor ?? session.encounterFloor)?.roundBudget ?? 0);
    const isTimedHold = objective === "protect-npc" || objective === "survive";
    if (isTimedHold) {
        const held = Math.max(0, Number(session.objectiveState.roundsSurvived ?? 0));
        return {
            debriefLabel: "Hold duration",
            debriefValue: goal > 0 ? `${held} / ${goal} rounds` : `${held} rounds`,
            hudLabel: goal > 0 ? `Hold ${held}/${goal}` : `Held ${held} rounds`,
            hudTitle: goal > 0 ? `Hold the objective for ${goal} completed rounds.` : "Completed objective-hold rounds.",
            hardLimit: goal > 0 ? goal : null,
        };
    }

    const isStory = session.towerId === "celestial"
        && Number(session.ascensionTier ?? 0) === 0
        && session.floor >= 1 && session.floor <= 15;
    if (isStory && goal > 0) {
        return {
            debriefLabel: "Rounds / par",
            debriefValue: `${session.round} · Par ${goal}`,
            hudLabel: `Round ${session.round} · Par ${goal}`,
            hudTitle: `Par ${goal} affects clear score only; the Story fight continues beyond it.`,
            hardLimit: null,
        };
    }

    const hardLimit = Math.max(0, Number(session.roundCap ?? 0));
    if (hardLimit > 0) {
        return {
            debriefLabel: "Round limit",
            debriefValue: `${session.round} / ${hardLimit}`,
            hudLabel: `Round ${session.round}/${hardLimit} · limit`,
            hudTitle: `The encounter ends after round ${hardLimit}.`,
            hardLimit,
        };
    }

    return {
        debriefLabel: "Rounds",
        debriefValue: String(session.round),
        hudLabel: `Round ${session.round}`,
        hudTitle: `Current round ${session.round}.`,
        hardLimit: null,
    };
}

function TowerBattleDebrief({ session, score, teamLabel = "Squad" }: { session: TowerSession; score?: number; teamLabel?: string }) {
    const squad = session.actors.filter(actor => actor.side === "squad");
    const standing = squad.filter(actor => actor.hp > 0).length;
    const totalHp = squad.reduce((sum, actor) => sum + Math.max(0, actor.hp), 0);
    const maxHp = squad.reduce((sum, actor) => sum + Math.max(1, actor.maxHp), 0);
    const healthPercent = maxHp > 0 ? Math.round((totalHp / maxHp) * 100) : 0;
    const objective = session.objectiveState.kind.replace(/-/g, " ");
    const objectiveOutcome = session.objectiveState.completed ? `${objective} complete`
        : session.objectiveState.failed ? `${objective} failed`
        : session.winner === "squad" ? `${objective} secured` : `${objective} incomplete`;
    const roundPresentation = towerRoundPresentation(session);
    return (
        <dl className="tower-result-debrief" aria-label="Battle debrief">
            <div><dt>Objective</dt><dd>{objectiveOutcome}</dd></div>
            <div><dt>{roundPresentation.debriefLabel}</dt><dd>{roundPresentation.debriefValue}</dd></div>
            <div><dt>{teamLabel} standing</dt><dd>{standing} / {squad.length}</dd></div>
            <div><dt>Team health</dt><dd>{healthPercent}%</dd></div>
            {Number.isFinite(score) && <div><dt>Clear score</dt><dd>{score}</dd></div>}
        </dl>
    );
}

// A Move-tagged jutsu (Flicker / body-flicker) repositions the caster — its valid
// destinations are OPEN tiles (like Dash), not ground-zone tiles. normalizeJutsu forces
// `target: "EMPTY_GROUND"` for any Move jutsu, so the Move tag is what distinguishes a
// relocation from a ground trap. Mirrors the server's Move branch in api/towers/_engine.ts.
function isMoveJutsu(j: JutsuLike | null | undefined): boolean {
    return Boolean(j) && Array.isArray(j!.tags) && j!.tags.some(t => tagMatchesName(t?.name ?? "", "Move"));
}
// AOE Burst — a target-centred radius-1 blast: striking one foe also hits every
// enemy in the 6 hexes touching it (api/towers/_engine.ts jutsuAreaRadius → applyAoeSplash).
// The board paints its splash footprint so it doesn't read as a single-target nuke.
function isBurstJutsu(j: JutsuLike | null | undefined): boolean {
    return Boolean(j) && String(j!.method ?? "") === "AOE_BURST";
}
type ItemLike = { id?: string; name?: string; slot?: string; weaponEp?: number; weaponRange?: number; apCost?: number; restoreChakra?: number; restoreStamina?: number; weaponCooldown?: number };

const ORB = 50;          // squad/enemy orb diameter (scales with the board)
const BOSS_ORB = 78;     // bosses render larger

// Tower combatant art is resolved through the Tower-only manifest. Unknown enemy
// visual IDs deliberately render the visible unknown treatment below; player and
// allied actors may use their sealed avatarImage.
// Painted elemental-pylon sprites, by element (drawn on the flower centre).
const PYLON_SPRITE: Record<string, string> = {
    Fire: pylonFire, Water: pylonWater, Earth: pylonEarth, Lightning: pylonLightning, Wind: pylonWind,
};
// Ward / hazard flower sprites.
const FEATURE_SPRITE: Record<string, string> = { ward: wardSprite, hazard: hazardSprite };
// Impassable terrain-pillar sprites, keyed by the floor biome (painted game props that
// sit on blocked tiles — the tile itself also tints dark via tileFill's isBlocked branch).
const OBSTACLE_SPRITE: Record<string, string> = {
    forest: obstacleForest, snow: obstacleSnow, volcano: obstacleVolcano,
    shadow: obstacleShadow, central: obstacleCentral,
};
// Board-object sprites (fonts / shrines — tiles worth holding).
const OBJECT_SPRITE: Record<string, string> = { font: objectFont, shrine: objectShrine };
const FONT_RESOURCE_WORD: Record<string, string> = { hp: "HP", chakra: "chakra", stamina: "stamina" };
function objectLabel(o: TowerBoardObject): string {
    if (o.kind === "shrine") return `${o.label ?? "Battle Shrine"}: your whole team deals +${o.percent}% damage while a living ally stands here (capped; enraged bosses gain nothing)`;
    return `${o.label ?? "Font"}: whoever ends the round standing here restores ${o.percent}% ${FONT_RESOURCE_WORD[o.resource] ?? o.resource} (up to ${o.cap})`;
}
const ENEMY_EMOJI: Record<string, string> = {
    bandit: "🥷", archer: "🏹", blocker: "🛡️", brute: "👹", acolyte: "🔮",
    warden: "🐲", ravager: "😈", genin: "🧑",
};
const ELEMENT_ICON: Record<string, string> = { Fire: "🔥", Water: "🌊", Earth: "🪨", Wind: "🌪️", Lightning: "⚡" };

// Manifest-chip palette by modifier kind: the Wave-2 keystones (hazard/debuff/healcut) read
// distinctly from the amber stat chassis (hp/dmg/roundCap/enrageCap → default).
const MODIFIER_CHIP_COLOR: Record<string, { fg: string; bg: string; border: string }> = {
    hazard: { fg: "var(--red-300)", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.32)" },       // crimson — tile burn
    debuff: { fg: "#d8b4fe", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.32)" },     // violet — vulnerability
    healcut: { fg: "#5eead4", bg: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.32)" },    // teal — healing throttle
    extraPhase: { fg: "#fdba74", bg: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.32)" }, // ember — extra boss phase (W3)
    objective: { fg: "#7dd3fc", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.32)" },  // sky — secondary condition (W3)
    dualAugment: { fg: "#f0abfc", bg: "rgba(232,121,249,0.12)", border: "rgba(232,121,249,0.34)" }, // fuchsia — keystone synergy (W3)
    default: { fg: "#f0b27e", bg: "rgba(240,161,90,0.12)", border: "rgba(240,161,90,0.28)" },     // amber — stat chassis
};
// Boss portrait for a spire floor (reuses the enemy sprite atlas, keyed by boss key).
const SPIRE_BOSS_MECHANIC_FLAVOR: Record<string, string> = {
    bulwark: "hardens its guard!", regen: "digs in and knits its wounds!",
    summon: "calls reinforcements!", enrage: "swells with fury!",
};

type TowerPhaseBanner = { key: string; title: string; instruction: string };

function buildTowerPhaseBanner(session: TowerSession, boss: TowerActor | undefined, spireMechanic?: string, spireName?: string): TowerPhaseBanner | null {
    if (!boss) return null;
    const mechanic = String(boss.character.mechanic ?? spireMechanic ?? "");
    const name = boss.name || spireName || "Boss";
    const latestGate = session.phaseState.triggeredPhases.at(-1);
    const instructions: string[] = [];
    const livingGuards = session.actors.filter(actor => actor.side === "enemy" && actor.id !== boss.id && actor.hp > 0).length;
    const addsRemaining = Math.max(0, Number(session.objectiveState.addsRemaining ?? livingGuards));

    if (mechanic === "summon" || session.objectiveState.bossUnlocked === false) {
        instructions.push(session.objectiveState.bossUnlocked === false
            ? `Eliminate ${addsRemaining || "the"} reinforcement${addsRemaining === 1 ? "" : "s"} to break the boss barrier.`
            : "Reinforcements entered the arena — thin them out before they overwhelm the squad.");
    }
    if (boss.shield > 0 || boss.character.aegis) {
        instructions.push(`Aegis raised${boss.shield > 0 ? ` (${Math.round(boss.shield)} shield)` : ""} — break it before committing burst damage.`);
    }
    if (mechanic === "enrage") instructions.push("Damage increased — protect the weakest ally and finish this phase quickly.");
    if (mechanic === "regen") instructions.push("Regeneration persists — focus attacks to outpace its end-of-round healing.");
    if (mechanic === "bulwark") instructions.push(livingGuards > 0
        ? `Bulwark active — defeat ${livingGuards} guard${livingGuards === 1 ? "" : "s"} to remove its damage reduction.`
        : "Bulwark active — coordinate burst damage while its guard is exposed.");
    if (Number(boss.character.phasePillars ?? 0) > 0) instructions.push("Arena reshaped — recheck safe routes and telegraphed tiles.");
    if (instructions.length === 0) instructions.push("Reposition and recheck hazards before committing the next action.");

    const spireFlavor = spireMechanic ? SPIRE_BOSS_MECHANIC_FLAVOR[spireMechanic] : undefined;
    return {
        key: `${session.runId}:${session.phaseState.triggeredPhases.length}:${latestGate ?? "phase"}`,
        title: spireFlavor ? `${spireName || name} ${spireFlavor}` : `${name} changes the fight`,
        instruction: `${latestGate != null ? `${latestGate}% gate · ` : ""}${instructions.slice(0, 3).join(" ")}`,
    };
}

// Wide top-down battlefield floors, one per biome (swap any file in
// src/assets/towers/arena-floor-<biome>.webp to re-theme — see the image spec).
const TOWER_FLOOR: Record<string, string> = {
    forest: arenaFloorForest, central: arenaFloorCentral, shadow: arenaFloorShadow,
    snow: arenaFloorSnow, volcano: arenaFloorVolcano,
};

// Per-element pylon-flower colours (top-lit → dark for the 3D bevel).
const PYLON_COLOR: Record<string, { top: string; bot: string; border: string }> = {
    Fire: { top: "rgba(254,178,120,0.66)", bot: "rgba(124,45,18,0.66)", border: "rgba(251,146,60,0.95)" },
    Water: { top: "rgba(125,211,252,0.66)", bot: "rgba(7,76,120,0.66)", border: "rgba(56,189,248,0.95)" },
    Earth: { top: "rgba(214,184,130,0.66)", bot: "rgba(87,57,24,0.66)", border: "rgba(202,138,72,0.95)" },
    Lightning: { top: "rgba(253,230,138,0.7)", bot: "rgba(120,90,8,0.66)", border: "rgba(250,204,21,0.95)" },
    Wind: { top: "rgba(167,243,208,0.64)", bot: "rgba(16,90,72,0.66)", border: "rgba(52,211,153,0.95)" },
};

export function BattleTowerFight({
    character,
    onVersionedCharacter,
    sharedImages,
    hostLoadout,
    runId,
    initialSession,
    onExit,
    onLeaveActive,
    onRecordBattle,
    settleFn,
    settleOnAnyDone,
    actionFn,
    actionRetryFn,
    stateFn = fetchTowerState,
    storyTheme,
    variant = "tower",
}: {
    character: Character;
    onVersionedCharacter?: VersionedCharacterCommit;
    sharedImages?: Record<string, string>;
    hostLoadout?: TowerHostLoadout;
    runId: string;
    initialSession: TowerSession;
    onExit: () => void;
    /** Leave only the active battle view; public Towers keep a recovery breadcrumb. */
    onLeaveActive?: () => void;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    // Optional settle override — the Clan Boss reuses this whole fight screen but
    // banks damage into its weekly pool (api/clan-boss/assault-settle) instead of
    // paying tower rewards. When set, the tower rewards panel is skipped.
    settleFn?: (runId: string, playerName: string) => Promise<unknown>;
    // Some modes settle on ANY resolution: Clan Boss banks partial damage, and
    // story towers finalize server-recorded consumable/throwable spends on wipes.
    settleOnAnyDone?: boolean;
    // Optional action-sender override — the Anbu Vault Infiltration reuses this
    // whole fight screen but submits moves to its own route
    // (api/village/anbu-infiltration action:'act') instead of /api/towers/action.
    // Same request/response shape (the server runs the shared tower engine).
    actionFn?: typeof submitTowerAction;
    /** Retry-aware transport for modes that require the current optimistic revision. */
    actionRetryFn?: (runId: string, playerName: string, action: TowerActionInput, expectedVersion?: number) => Promise<TowerActionResponse>;
    // Test/dev harness seam. Production defaults to the authoritative Tower state route.
    stateFn?: typeof fetchTowerState;
    // Story-boss presentation (display-only — never touches stats or rewards):
    // chapter backdrop art, a chapter label, and boss "barks" spoken at fight
    // start and as the boss's HP falls. See lib/story-fight-theme.ts.
    storyTheme?: StoryFightTheme;
    variant?: "tower" | "team-pvp";
}) {
    const isTeamPvp = variant === "team-pvp";
    const [session, setSession] = useState<TowerSession>(initialSession);
    const combatFloor = session.sealedCatalogFloor ?? session.encounterFloor;
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [selWeaponId, setSelWeaponId] = useState<string>("");
    // Enemy the cursor is over — centres the AOE Burst splash preview on desktop.
    const [hoverEnemyPos, setHoverEnemyPos] = useState<number | null>(null);
    const [actionFeedback, setActionFeedback] = useState<ActionFeedback>({ phase: "idle" });
    const busy = actionFeedback.phase === "submitting";
    const reject = actionFeedback.phase === "error" ? actionFeedback.message : null;
    const [settlement, setSettlement] = useState<SettlementState>({ phase: "idle", response: null, message: null, attempts: 0 });
    const settlementPromiseRef = useRef<Promise<void> | null>(null);
    const mountedRef = useRef(true);
    const actionInFlightRef = useRef(false);
    const [fightSyncState, setFightSyncState] = useState<"live" | "reconnecting">("live");
    const [realtimeConnected, setRealtimeConnected] = useState(() => isRealtimeConnected());
    const initialTowerMilestonesRef = useRef(new Set(character.battleTowerMilestones ?? []));
    const introDialogRef = useRef<HTMLDivElement | null>(null);
    const introPrimaryRef = useRef<HTMLButtonElement | null>(null);
    const resultDialogRef = useRef<HTMLDivElement | null>(null);
    const resultPrimaryRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        setRealtimeConnected(isRealtimeConnected());
        return onStatus(setRealtimeConnected);
    }, []);

    const me = character.name;
    // Actor ownership is sealed to the server's safeName slug. Mirror that canonical
    // transform while continuing to send the authenticated display name to APIs.
    const meSlug = towerPlayerSlug(me);
    const ownedByMe = (slug: string | null) => !!slug && towerPlayerSlug(slug) === meSlug;

    // ── Story presentation (display-only): the boss speaks its own authored VN
    // lines at fight start / 2⁄3 / 1⁄3 HP and its last words on the killing
    // blow; the mentor cuts in when the PLAYER is hurting; the last-stand
    // threshold adds a vignette + sting. One bubble at a time, ~6s.
    const [bark, setBark] = useState<{ name: string; text: string; side: "boss" | "ally" } | null>(null);
    const barkStageRef = useRef(0);
    const allyStageRef = useRef(0);
    const barkTimerRef = useRef(0);
    const stingRef = useRef({ opened: false, finalPhase: false, victory: false });
    const storyBoss = storyTheme
        ? session.actors.find((a) => a.side !== "squad" && (a.character as { boss?: boolean } | undefined)?.boss)
            ?? session.actors.find((a) => a.side !== "squad")
        : undefined;
    const storyBossHpFrac = storyBoss ? Math.max(0, storyBoss.hp) / Math.max(1, storyBoss.maxHp) : 1;
    const storySelf = storyTheme ? session.actors.find((a) => a.side === "squad" && ownedByMe(a.ownerSlug)) : undefined;
    const storySelfHpFrac = storySelf ? Math.max(0, storySelf.hp) / Math.max(1, storySelf.maxHp) : 1;
    const storyDone = session.status === "done";
    const storyFinalPhase = !!storyTheme && !storyDone && storyBossHpFrac <= 1 / 3;
    useEffect(() => {
        if (!storyTheme) return;
        if (!stingRef.current.opened) {
            stingRef.current.opened = true;
            primeStorySfx();
            playStoryChapterSting(storyTheme.village);
        }
        const show = (name: string, text: string, side: "boss" | "ally") => {
            setBark({ name, text, side });
            window.clearTimeout(barkTimerRef.current);
            barkTimerRef.current = window.setTimeout(() => setBark(null), 6500);
        };
        const bossName = storyTheme.bossName || storyBoss?.name || "???";
        if (storyDone) {
            if (session.winner === "squad" && !stingRef.current.victory) {
                stingRef.current.victory = true;
                playStoryVictorySting();
                if (storyTheme.defeatLine && barkStageRef.current < 4) {
                    barkStageRef.current = 4;
                    show(bossName, storyTheme.defeatLine, "boss");
                }
            }
            return;
        }
        const barks = storyTheme.barks ?? [];
        const next = barkStageRef.current < 1 && barks[0] ? 0
            : barkStageRef.current < 2 && storyBossHpFrac <= 2 / 3 && barks[1] ? 1
                : barkStageRef.current < 3 && storyBossHpFrac <= 1 / 3 && barks[2] ? 2 : -1;
        if (next >= 0) {
            barkStageRef.current = next + 1;
            show(bossName, barks[next], "boss");
            return;
        }
        const ally = storyTheme.ally;
        if (ally?.lines[0] && allyStageRef.current < 1 && storySelfHpFrac <= 0.5) {
            allyStageRef.current = 1;
            show(ally.name, ally.lines[0], "ally");
            return;
        }
        if (ally?.lines[1] && allyStageRef.current < 2 && storySelfHpFrac <= 0.2) {
            allyStageRef.current = 2;
            show(ally.name, ally.lines[1], "ally");
        }
    }, [storyTheme, storyBossHpFrac, storySelfHpFrac, storyDone, session.winner, storyBoss?.name]);
    useEffect(() => {
        if (storyFinalPhase && !stingRef.current.finalPhase) {
            stingRef.current.finalPhase = true;
            playStoryFinalPhaseSting();
        }
    }, [storyFinalPhase]);
    useEffect(() => () => window.clearTimeout(barkTimerRef.current), []);

    const w = session.map.width, h = session.map.height;
    const layer = useMemo(() => towerLayerSize(w, h), [w, h]);

    // ── Server-authored combat VFX ───────────────────────────────────────────
    // The engine replaces session.vfx wholesale per resolved action / DoT tick
    // and bumps vfxSeq (api/towers/_engine.ts). Draw a batch once per bump;
    // re-polling the same session must not replay it. Cosmetic only — nothing
    // here is read back as combat authority.
    const liteFx = useMemo(() => prefersLiteCombatFx(), []);
    const [combatVfx, setCombatVfx] = useState<TowerCombatVfx[]>([]);
    const lastVfxSeqRef = useRef<number | undefined>(undefined);
    const hasObservedVfxRef = useRef(false);

    const tileCenter = useCallback((pos: number) => {
        const { left, top } = towerHexPixel(pos, w);
        return { x: left + HEX_W / 2, y: top + HEX_H / 2 };
    }, [w]);

    useEffect(() => {
        // Mounting mid-run (refresh, or joining a co-op fight already in
        // progress) must not replay whatever plate the session happens to hold.
        const watchedFromStart = hasObservedVfxRef.current;
        hasObservedVfxRef.current = true;
        const seq = session.vfxSeq;
        if (seq == null) return;
        const last = lastVfxSeqRef.current;
        lastVfxSeqRef.current = seq;
        if (seq === last) return;
        if (last === undefined && !watchedFromStart) return;

        const plates = session.vfx ?? [];
        if (!plates.length) return;
        const mapped = plates.map((plate, i) => ({
            id: `${plate.target ?? "tile"}-vfx-${seq}-${i}`,
            target: plate.target,
            spec: safeCombatVfxSpec({
                key: plate.key,
                target: plate.anchor,
                persistent: plate.persistent,
                tiles: plate.tiles,
                ...(liteFx ? { maxParticles: 4 } : {}),
            }),
        }));
        // Collapse plates that would land on the same tile (a hit plus its
        // ward reaction, several DoTs ticking together). Mirrors PvP/solo PvE.
        const deduped = dedupeCombatVfx(mapped, (fx) =>
            combatVfxAnchorKey(fx.spec, session.actors.find(a => a.id === fx.target)?.pos ?? -1));
        setCombatVfx((existing) => [...existing, ...deduped].slice(liteFx ? -6 : -14));
        const lifetime = Math.max(...deduped.map((fx) => fx.spec.durationMs), 900);
        const timeout = window.setTimeout(() => {
            setCombatVfx((existing) => existing.filter((fx) => !deduped.some((added) => added.id === fx.id)));
        }, lifetime + 80);
        return () => window.clearTimeout(timeout);
        // Keyed on vfxSeq ALONE: session.vfx/actors get fresh identities on every
        // poll, so listing them would replay the same plates on an idle board.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.vfxSeq]);

    // Same markup and class contract as PvP and solo PvE, so all three modes
    // share one stylesheet (.pvp-combat-vfx / .pvp-vfx-* in battle-skin.css).
    const renderCombatVfx = (fx: TowerCombatVfx) => {
        const tiles = (fx.spec.tiles ?? [])
            .filter((tile) => tile >= 0 && tile < w * h)
            .slice(0, liteFx ? 7 : 14);
        const anchored = session.actors.find(a => a.id === fx.target);
        const centers = tiles.length
            ? tiles.map(tileCenter)
            : anchored
                ? [tileCenter(anchored.pos)]
                : [];
        if (!centers.length) return null;
        const avg = centers.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
        const center = { x: avg.x / centers.length, y: avg.y / centers.length };
        const asset = combatVfxAssetFor(fx.spec.key);
        const baseClass = `pvp-combat-vfx pvp-vfx-${fx.spec.key} pvp-vfx-${fx.spec.intensity} pvp-vfx-has-asset pvp-vfx-plane-${asset.plane}${liteFx ? " pvp-vfx-lite" : ""}`;
        const styleFor = (point: { x: number; y: number }, scale = 1) => ({
            left: `${point.x}px`,
            top: `${point.y}px`,
            "--vfx-duration": `${fx.spec.durationMs}ms`,
            "--vfx-scale": scale,
            "--vfx-asset-scale": asset.assetScale,
            "--vfx-asset-lift": `${asset.liftPx}px`,
            "--vfx-asset-opacity": asset.opacity,
        } as React.CSSProperties);
        return (
            <div key={fx.id} className="pvp-combat-vfx-group" aria-hidden="true">
                {centers.length > 1 && centers.map((point, idx) => (
                    <span key={`${fx.id}-tile-${idx}`} className={`${baseClass} pvp-combat-vfx-tile`} style={styleFor(point, 0.72)}>
                        <i className="pvp-vfx-ring" />
                    </span>
                ))}
                <span className={`${baseClass} pvp-combat-vfx-burst`} style={styleFor(center, fx.spec.intensity === "finisher" ? 1.1 : fx.spec.intensity === "heavy" ? 1 : 0.92)}>
                    <i className="pvp-vfx-art">
                        <img className={`pvp-vfx-asset pvp-vfx-asset-${asset.plane}`} src={asset.url} alt="" draggable={false} />
                    </i>
                    <i className="pvp-vfx-ring" />
                    <i className="pvp-vfx-core" />
                    <i className="pvp-vfx-cut" />
                    {!liteFx && <i className="pvp-vfx-sparks" />}
                </span>
            </div>
        );
    };
    const { battlefieldCallbackRef, boardContainerSize, effectiveScale: fittedScale } = useBoardScale(layer.width, layer.height);
    const [boardZoom, setBoardZoom] = useState(TOWER_ZOOM_MIN);
    const [boardPan, setBoardPan] = useState<TowerPan>({ x: 0, y: 0 });
    const boardDragRef = useRef<{ pointerId: number; startX: number; startY: number; pan: TowerPan; moved: boolean } | null>(null);
    const suppressBoardClickRef = useRef(false);
    const suppressBoardClickTimerRef = useRef<number | null>(null);

    const activeId = session.turnQueue[session.activeIndex];
    const activeActor = session.actors.find(a => a.id === activeId);
    const summonedCompanion = session.actors.find(a => (a.character as Record<string, unknown> | undefined)?.companion === true && a.hp > 0);
    const myTurn = session.status === "active" && !!activeActor && activeActor.ai === false && ownedByMe(activeActor.ownerSlug) && activeActor.hp > 0;
    // Keep the owned fighter and sealed loadout visible while allies/enemies act.
    // `activeAp` belongs to the current actor, but HP/resources/cooldowns belong to
    // this persistent actor and must not disappear between the player's turns.
    const myActor = session.actors.find(a => a.side === "squad" && ownedByMe(a.ownerSlug)) ?? null;
    const bossId = session.phaseState?.bossId;
    const lockedBossId = session.objectiveState.bossUnlocked === false ? bossId : undefined;

    const maximumBoardZoom = fittedScale > 0
        ? clampTowerZoom(TOWER_ZOOM_MAX, TOWER_ZOOM_MAX / fittedScale)
        : TOWER_ZOOM_MAX;
    const renderedScale = Math.min(TOWER_ZOOM_MAX, fittedScale * boardZoom);
    const renderedBoardSize = useMemo(() => ({
        width: layer.width * renderedScale,
        height: layer.height * renderedScale,
    }), [layer.width, layer.height, renderedScale]);
    const clampPanToBoard = useCallback((pan: TowerPan) => clampTowerPan(
        pan,
        { width: boardContainerSize.w, height: boardContainerSize.h },
        renderedBoardSize,
    ), [boardContainerSize.w, boardContainerSize.h, renderedBoardSize]);

    useEffect(() => {
        setBoardZoom(current => clampTowerZoom(current, maximumBoardZoom));
    }, [maximumBoardZoom]);
    useEffect(() => {
        setBoardPan(current => clampPanToBoard(current));
    }, [clampPanToBoard]);

    const changeBoardZoom = useCallback((delta: number) => {
        setBoardZoom(current => clampTowerZoom(current + delta, maximumBoardZoom));
    }, [maximumBoardZoom]);
    const resetBoardView = useCallback(() => {
        setBoardZoom(TOWER_ZOOM_MIN);
        setBoardPan({ x: 0, y: 0 });
    }, []);
    const onBoardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (boardZoom <= TOWER_ZOOM_MIN) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        boardDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            pan: boardPan,
            moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [boardPan, boardZoom]);
    const onBoardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = boardDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        event.preventDefault();
        setBoardPan(clampPanToBoard({ x: drag.pan.x + dx, y: drag.pan.y + dy }));
    }, [clampPanToBoard]);
    const endBoardPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = boardDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.moved) {
            suppressBoardClickRef.current = true;
            if (suppressBoardClickTimerRef.current != null) window.clearTimeout(suppressBoardClickTimerRef.current);
            suppressBoardClickTimerRef.current = window.setTimeout(() => {
                suppressBoardClickRef.current = false;
                suppressBoardClickTimerRef.current = null;
            }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        boardDragRef.current = null;
    }, []);
    useEffect(() => () => {
        if (suppressBoardClickTimerRef.current != null) window.clearTimeout(suppressBoardClickTimerRef.current);
        suppressBoardClickTimerRef.current = null;
        suppressBoardClickRef.current = false;
        boardDragRef.current = null;
    }, []);

    // ── Endless Spire theater — boss identity, intro nameplate, phase banners ────
    const spireTier = Number(session.ascensionTier ?? 0);
    const isSpire = spireTier > 0;
    const spireMeta = useMemo(() => (isSpire ? spireFloorMeta(spireTier) : null), [isSpire, spireTier]);
    const bossPortrait = spireMeta ? TOWER_SPIRE_PORTRAITS[spireMeta.boss.key] : undefined;

    // A fresh entry (round 1) into a spire floor gets a ~2.8s cinematic nameplate; a
    // refresh-resume mid-fight skips it (only shown when initialSession is round ≤ 1).
    const [showIntro, setShowIntro] = useState(() => isSpire && (initialSession.round ?? 1) <= 1 && initialSession.status === "active");
    const dismissIntro = useCallback(() => setShowIntro(false), []);
    const introOpen = showIntro && isSpire && spireMeta != null && session.status === "active";
    useTowerDialogFocus({
        open: introOpen,
        dialogRef: introDialogRef,
        primaryRef: introPrimaryRef,
        escapeAllowed: true,
        onEscape: dismissIntro,
    });
    useEffect(() => {
        if (!showIntro) return;
        const id = setTimeout(dismissIntro, 2800);
        return () => clearTimeout(id);
    }, [showIntro, dismissIntro]);

    // Phase-change banner — when the boss crosses an HP-gate (triggeredPhases grows), flash a
    // mechanic-flavored banner. Uses a ref so it fires once per crossing, not per re-render.
    const [phaseBanner, setPhaseBanner] = useState<TowerPhaseBanner | null>(null);
    const triggeredCountRef = useRef(session.phaseState?.triggeredPhases?.length ?? 0);
    const triggeredCount = session.phaseState?.triggeredPhases?.length ?? 0;
    const phaseBoss = bossId ? session.actors.find(actor => actor.id === bossId) : undefined;
    useEffect(() => {
        if (triggeredCount > triggeredCountRef.current) {
            setPhaseBanner(buildTowerPhaseBanner(session, phaseBoss, spireMeta?.boss.mechanic, spireMeta?.boss.name));
        }
        triggeredCountRef.current = triggeredCount;
    }, [triggeredCount, session, phaseBoss, spireMeta]);
    useEffect(() => {
        if (!phaseBanner) return;
        const id = setTimeout(() => setPhaseBanner(null), 4200);
        return () => clearTimeout(id);
    }, [phaseBanner]);

    // Whose turn is it? + the AFK countdown for a live player's turn.
    const activeIsLiveHuman = !!activeActor && activeActor.ai === false
        && (isTeamPvp || activeActor.side !== "enemy") && activeActor.hp > 0;
    const turnLabel = session.status !== "active" || !activeActor ? ""
        : myTurn ? "🟢 Your turn"
        : isTeamPvp && activeActor.ai === false ? `⏳ ${activeActor.name}'s turn`
        : activeActor.side === "enemy" ? "⚔️ Enemies acting…"
        : activeActor.ai === false ? `⏳ ${activeActor.name}'s turn`
        : `${activeActor.name} acting…`;

    useEffect(() => {
        if (myTurn) return;
        setMode("idle");
        setSelJutsu(null);
        setSelWeaponId("");
        setHoverEnemyPos(null);
        setActionFeedback(current => current.phase === "submitting" ? current : { phase: "idle" });
    }, [myTurn, activeId]);

    // Reconnect: if mounted without a fresh session (or to recover), pull the latest once.
    useEffect(() => {
        if (initialSession.status === "active") return;
        const controller = new AbortController();
        stateFn(runId, me, controller.signal).then(next => {
            if (controller.signal.aborted) return;
            setSession(current => (next.actionVersion ?? 0) >= (current.actionVersion ?? 0) ? next : current);
        }).catch(() => {});
        return () => controller.abort();
    }, [runId, me, initialSession.status, stateFn]);

    // Refresh the server-sealed actor/session when entering a run. The join route is
    // deliberately read-only and ignores this compatibility loadout; it never re-gears
    // the actor from client state. Best-effort and once per mount.
    useEffect(() => {
        if (!hostLoadout) return;
        let alive = true;
        joinTowerRun(runId, me, hostLoadout).then(next => {
            if (!alive || !next) return;
            setSession(current => (next.actionVersion ?? 0) >= (current.actionVersion ?? 0) ? next : current);
        });
        return () => { alive = false; };
    }, [runId, me, hostLoadout]);

    // Reconcile on every authenticated socket revision hint, including during our turn:
    // another member's request can authoritatively auto-pass an idle local turn. HTTP
    // remains the authority and a bounded poll remains as the outage / dropped-event path.
    useEffect(() => {
        if (session.status !== "active") return;
        let alive = true;
        let inFlight = false;
        let refreshPending = false;
        const controller = new AbortController();
        const poll = () => {
            if (!alive) return;
            if (inFlight) {
                refreshPending = true;
                return;
            }
            refreshPending = false;
            inFlight = true;
            stateFn(runId, me, controller.signal).then(next => {
                if (!alive) return;
                setSession(current => (next.actionVersion ?? 0) >= (current.actionVersion ?? 0) ? next : current);
                setFightSyncState("live");
            }).catch(() => {
                if (alive && !controller.signal.aborted) setFightSyncState("reconnecting");
            }).finally(() => {
                inFlight = false;
                if (alive && refreshPending) queueMicrotask(poll);
            });
        };
        void poll();
        const stopPush = onTowerKick(kick => {
            const matchesFight = isTeamPvp
                ? kick.channel === "pvp" && kick.matchId === runId
                : kick.channel === "session" && kick.runId === runId;
            if (kick.channel === "reconcile" || matchesFight) poll();
        });
        const stopFallback = visiblePoll(poll, realtimeConnected ? 20_000 : 2_500, 0.08);
        return () => { alive = false; controller.abort(); stopPush(); stopFallback(); };
    }, [session.status, runId, me, stateFn, realtimeConnected, isTeamPvp]);

    // Auto-settle once the fight resolves. Tower rewards pay only on a squad
    // clear, but the server can still finalize spent consumables on a wipe.
    const performSettlement = useCallback(() => {
        if (settlementPromiseRef.current) return settlementPromiseRef.current;
        setSettlement(current => ({ ...current, phase: "pending", message: null, attempts: current.attempts + 1 }));
        const request = (async () => {
            try {
                if (settleFn) {
                    const response = await settleFn(runId, me);
                    if (!mountedRef.current) return;
                    const mutation = (response ?? {}) as { character?: Character; _saveVersion?: unknown };
                    if (mutation.character) onVersionedCharacter?.(mutation.character, mutation._saveVersion);
                    setSettlement(current => ({ ...current, phase: "settled", message: null }));
                    return;
                }
                const response = await settleTowerRun(runId, me);
                if (!mountedRef.current) return;
                if (response.character) onVersionedCharacter?.(response.character, response._saveVersion);
                if (!isStableTowerSettlement(response)) {
                    setSettlement(current => ({
                        ...current,
                        phase: "error",
                        response,
                        message: settlementRetryMessage(response, meSlug),
                    }));
                    return;
                }
                setSettlement(current => ({ ...current, phase: "settled", response, message: null }));
            } catch (error) {
                if (!mountedRef.current) return;
                setSettlement(current => ({
                    ...current,
                    phase: "error",
                    message: String((error as Error)?.message || "Settlement could not be confirmed."),
                }));
            }
        })();
        settlementPromiseRef.current = request;
        void request.finally(() => {
            if (settlementPromiseRef.current === request) settlementPromiseRef.current = null;
        });
        return request;
    }, [runId, me, meSlug, settleFn, onVersionedCharacter]);

    const shouldSettle = session.status === "done" && (settleOnAnyDone || session.winner === "squad");
    useEffect(() => {
        if (shouldSettle && settlement.phase === "idle") void performSettlement();
    }, [shouldSettle, settlement.phase, performSettlement]);
    const resultCanExit = !shouldSettle || settlement.phase === "settled";
    const exitResult = useCallback(() => {
        if (resultCanExit) onExit();
    }, [resultCanExit, onExit]);
    useTowerDialogFocus({
        open: session.status === "done",
        dialogRef: resultDialogRef,
        primaryRef: resultPrimaryRef,
        escapeAllowed: resultCanExit,
        onEscape: exitResult,
        focusRevision: settlement.phase,
    });

    // Reflection log (display-only): record the floor once it resolves (win OR
    // loss) so it shows on Profile → Battles. The squad log names many fighters,
    // so buildActionsFromTowerLog colors each line by side (ally = blue, enemy =
    // red). De-duped by runId, so a refresh on the result screen re-records
    // harmlessly.
    const recordedRef = useRef(false);
    useEffect(() => {
        if (session.status !== "done" || recordedRef.current || !onRecordBattle) return;
        recordedRef.current = true;
        const allyNames = session.actors.filter(a => a.side === "squad" || a.side === "npc").map(a => a.name);
        const enemyNames = session.actors.filter(a => a.side === "enemy").map(a => a.name);
        const boss = session.actors.find(a => a.id === session.phaseState?.bossId);
        const outcome: BattleHistoryEntry["outcome"] = session.winner === "squad" ? "win" : session.winner === "draw" ? "draw" : "loss";
        onRecordBattle(makeBattleEntry({
            id: `tower-${runId}`,
            ts: Date.now(),
            mode: "Tower",
            opponent: boss?.name ?? enemyNames[0] ?? "Tower enemies",
            outcome,
            rounds: session.round ?? 1,
            self: me,
            actions: buildActionsFromTowerLog(session.log ?? [], allyNames, enemyNames),
        }));
        // Fire once when the floor resolves; the recordedRef guard makes extra
        // session updates no-ops, so we intentionally don't list every field.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.status, session.winner]);

    // Full equipped kit (weapons + consumables) from the sealed loadout → action cards.
    // Classify by the CANONICAL equipment slot (equipSlotForItem, the same helper PvP/PvE use)
    // so ARMOR (body/head/legs/feet/waist) and GLOVES never leak into the action bar and a glove
    // on the hand slot isn't mistaken for a weapon. Weapons = hand/thrown; consumables = the
    // spent-on-use combat items + potion (NOT thrown — it's a weapon; NOT any worn slot).
    const loadout = useMemo(() => {
        const slotOf = (it: ItemLike): string => equipSlotForItem({ slot: (it.slot ?? "") as never, name: it.name ?? "" });
        const items = (Array.isArray(myActor?.character?.pvpItems) ? myActor!.character.pvpItems : []) as ItemLike[];
        const equippedIds = new Set(Object.values((myActor?.character?.equipment ?? {}) as Record<string, string | undefined>).filter(Boolean) as string[]);
        const charges = (myActor?.itemCharges ?? {}) as Record<string, number>;
        const cooldowns = (myActor?.cooldowns ?? {}) as Record<string, number>;
        const equipped = items.filter(it => it.id && equippedIds.has(it.id));
        const CONSUMABLE = new Set(["item", "item1", "item2", "item3", "potion"]);
        const weapons = equipped
            .filter(it => { const s = slotOf(it); return s === "hand" || s === "thrown"; })
            .map(it => {
                const thrown = slotOf(it) === "thrown";
                const cdKey = it.id ?? it.name ?? "";
                return { item: it, thrown, range: Math.max(1, Number(it.weaponRange ?? (thrown ? 4 : 1))), left: thrown ? (charges[it.id!] ?? 0) : Infinity, cd: Number(cooldowns[cdKey] ?? 0) };
            });
        const consumables = equipped
            .filter(it => CONSUMABLE.has(slotOf(it)))
            .map(it => {
                const cdKey = it.id ?? it.name ?? "";
                return { item: it, left: charges[it.id!] ?? 0, cd: Number(cooldowns[cdKey] ?? 0) };
            });
        return { weapons, consumables };
    }, [myActor]);
    const { weapons: myWeapons, consumables: myConsumables } = loadout;
    const actionWeapons = isTeamPvp ? myWeapons.filter(({ thrown }) => !thrown) : myWeapons;
    const actionConsumables = isTeamPvp ? [] : myConsumables;
    const arenaSuppressedGear = isTeamPvp && (actionWeapons.length !== myWeapons.length || myConsumables.length > 0);
    const myChakra = myActor?.chakra ?? 0;
    const myStamina = myActor?.stamina ?? 0;
    const healCd = Number(myActor?.cooldowns?.basicHeal ?? 0);
    const clearCd = Number(myActor?.cooldowns?.clear ?? 0);
    const cleanseCd = Number(myActor?.cooldowns?.cleanse ?? 0);
    // Mirror the ordinary PvP/PvE Lag-then-Overclock contract for every paid action.
    const adjustedActionAp = (base: number) => adjustedCombatApCost(myActor?.statuses, base, session.round);
    const attackAp = adjustedActionAp(40);
    const moveAp = adjustedActionAp(30);
    const utilityAp = adjustedActionAp(60);
    // The weapon currently armed for targeting (when in weapon mode).
    const armedWeapon = mode === "weapon" ? myWeapons.find(w => w.item.id === selWeaponId) : undefined;
    const weaponRange = armedWeapon?.range ?? 1;

    // Valid target/move sets for the current mode.
    const myPos = myActor?.pos ?? -1;
    const barrierTiles = useMemo(
        () => activeBarrierTilesForDisplay(
            session.actors.flatMap(actor => actor.statuses),
            session.round,
            w * h,
            "tower-grid:",
        ),
        [session.actors, session.round, w, h],
    );
    const impassableTiles = useMemo(
        () => new Set([...session.map.blockedTiles, ...barrierTiles]),
        [session.map.blockedTiles, barrierTiles],
    );
    const enemiesInRange = useMemo(() => {
        if (!myActor) return new Set<string>();
        const out = new Set<string>();
        // Clear has no range (strips buffs from any foe); jutsu/weapon use their reach; else melee.
        const range = mode === "clear" ? Infinity : mode === "jutsu" ? Math.max(1, Number(selJutsu?.range ?? 1)) : mode === "weapon" ? weaponRange : 1;
        for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== "enemy") continue;
            if (a.id === lockedBossId) continue;
            if (towerHexDistance(myPos, a.pos, w) <= range) out.add(a.id);
        }
        return out;
    }, [myActor, mode, selJutsu, weaponRange, session.actors, lockedBossId, myPos, w]);

    const moveTiles = useMemo(() => {
        if (mode !== "move" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        return new Set(towerNeighbors(myPos, w, h).filter(t => !occupied.has(t) && !impassableTiles.has(t)));
    }, [mode, myActor, session.actors, impassableTiles, myPos, w, h]);

    // Dash: any open, unoccupied tile within 3 hexes.
    const dashTiles = useMemo(() => {
        if (mode !== "dash" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        return new Set([...towerTilesInRange(myPos, 3, w, h)].filter(t => t !== myPos && !occupied.has(t) && !impassableTiles.has(t)));
    }, [mode, myActor, session.actors, impassableTiles, myPos, w, h]);

    // Reach highlight for a ranged action: jutsu range, or the equipped weapon's range.
    const jutsuRangeTiles = useMemo(() => {
        if (!myActor) return new Set<number>();
        if (mode === "jutsu") {
            const inRange = towerTilesInRange(myPos, Math.max(1, Number(selJutsu?.range ?? 1)), w, h);
            // Movement jutsu: valid destinations are OPEN tiles only (exclude self / occupants /
            // blocked) — clicking an occupied tile would just bounce server-side.
            if (isMoveJutsu(selJutsu)) {
                const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
                return new Set([...inRange].filter(t => t !== myPos && !occupied.has(t) && !impassableTiles.has(t)));
            }
            return inRange;
        }
        if (mode === "weapon") return towerTilesInRange(myPos, weaponRange, w, h);
        return new Set<number>();
    }, [mode, myActor, selJutsu, weaponRange, myPos, w, h, session.actors, impassableTiles]);

    // AOE Burst splash footprint — the target-centred radius-1 blast (target tile + its
    // 6 touching hexes) that resolveHit → applyAoeSplash applies server-side. Centres on
    // the hovered enemy (desktop); with no hover (mobile / no cursor) it shows the footprint
    // around EVERY in-range enemy so the jutsu always reads as an area hit, never single-target.
    const aoeBurstTiles = useMemo(() => {
        const out = new Set<number>();
        if (mode !== "jutsu" || !isBurstJutsu(selJutsu)) return out;
        const hovered = hoverEnemyPos != null && session.actors.some(a => a.hp > 0 && a.side === "enemy" && a.pos === hoverEnemyPos && enemiesInRange.has(a.id));
        const centres = hovered
            ? [hoverEnemyPos!]
            : session.actors.filter(a => a.hp > 0 && a.side === "enemy" && enemiesInRange.has(a.id)).map(a => a.pos);
        for (const c of centres) { out.add(c); for (const n of towerNeighbors(c, w, h)) out.add(n); }
        return out;
    }, [mode, selJutsu, hoverEnemyPos, session.actors, enemiesInRange, w, h]);

    // First feature occupying each tile (for tinting + markers).
    const featureByTile = useMemo(() => {
        const m = new Map<number, TowerFeature>();
        for (const f of session.map.features ?? []) for (const t of f.tiles) if (!m.has(t)) m.set(t, f);
        return m;
    }, [session.map.features]);
    const boardObjectByTile = useMemo(() => {
        const objects = new Map<number, TowerBoardObject>();
        for (const object of session.map.boardObjects ?? []) for (const tile of object.tiles ?? []) if (!objects.has(tile)) objects.set(tile, object);
        return objects;
    }, [session.map.boardObjects]);
    const dynamicHazardByTile = useMemo(() => {
        const hazards = new Map<number, NonNullable<TowerSession["map"]["dynamicHazards"]>[number]>();
        for (const hazard of session.map.dynamicHazards ?? []) for (const tile of hazard.tiles ?? []) if (!hazards.has(tile)) hazards.set(tile, hazard);
        return hazards;
    }, [session.map.dynamicHazards]);

    // ── "Board attacks back" overlays — three DISTINCT danger reads ──────────────
    // violet = the boss's telegraphed strike (detonates at THIS round's end)
    // ember  = the closing ring (the arena collapsing inward; client mirror of the server)
    // crimson = the remaining spire hazard telegraph (everything else in nextRoundHazardTiles)
    const strikeTiles = useMemo(() => {
        const st = session.bossStrike;
        return new Set<number>(st && st.round === session.round ? st.tiles : []);
    }, [session.bossStrike, session.round]);
    const ringTiles = useMemo(
        () => new Set<number>(towerClosingRingTiles(w, h, session.map.blockedTiles, session.map.closingRing, session.round)),
        [w, h, session.map.blockedTiles, session.map.closingRing, session.round],
    );
    const crimsonTiles = useMemo(
        () => (session.map.nextRoundHazardTiles ?? []).filter(t => !strikeTiles.has(t) && !ringTiles.has(t)),
        [session.map.nextRoundHazardTiles, strikeTiles, ringTiles],
    );
    const crimsonTileSet = useMemo(() => new Set(crimsonTiles), [crimsonTiles]);

    // Surface the run-sealed boss profile even when Spire's modifier manifest is present;
    // target selection and recurring strikes are distinct threats, not modifier aliases.
    const encounterChips = useMemo(() => {
        const hasModifierManifest = Array.isArray(session.modifierStack) && session.modifierStack.length > 0;
        const chips: Array<{ icon: string; text: string; kind: string }> = [];
        const boss = session.actors.find(a => a.id === session.phaseState.bossId);
        const sealedBoss = combatFloor?.boss;
        const strike = sealedBoss?.strike ?? boss?.character?.bossStrike as { kind?: "nova" | "volley" | "slam"; everyRounds?: number; firstRound?: number; radius?: number } | undefined;
        const hunt = String(sealedBoss?.targetMode ?? boss?.character?.aiTargetMode ?? "");
        if (strike?.kind) {
            const strikeName = strike.kind === "volley" ? "Telegraphed barrage" : strike.kind === "slam" ? "Telegraphed slam and knockback" : "Telegraphed nova";
            const cadence = Math.max(2, Number(strike.everyRounds ?? 3));
            const firstRound = Math.max(1, Number(strike.firstRound ?? cadence));
            chips.push({ icon: "☄️", text: `${strikeName} from round ${firstRound}, every ${cadence} rounds${strike.radius ? ` · radius ${strike.radius}` : ""} — step off violet tiles`, kind: "debuff" });
        }
        if (hunt) chips.push({ icon: "🎯", text: hunt === "support" ? "Hunts your support" : hunt === "squishiest" ? "Hunts your weakest guard" : "Finishes the wounded", kind: "objective" });
        if (!hasModifierManifest) {
            if (boss?.character?.phasePillars) chips.push({ icon: "🪨", text: "Shatters the arena at phase gates", kind: "default" });
            if (boss?.character?.aegis) chips.push({ icon: "🛡️", text: "Raises a shield at phase gates", kind: "healcut" });
            if (session.map.closingRing) chips.push({ icon: "🔥", text: `Arena contracts after round ${Math.max(1, Number(session.map.closingRing.fromRound ?? 6))}`, kind: "extraPhase" });
            if ((session.map.dynamicHazards ?? []).length) chips.push({ icon: "♨️", text: "Geysers erupt on a beat — don't end the round on a vent", kind: "hazard" });
        }
        for (const warning of combatFloor?.briefing?.warnings?.slice(0, 3) ?? []) {
            if (warning.trim()) chips.push({ icon: "⚠️", text: warning.trim(), kind: "debuff" });
        }
        return chips;
    }, [session.modifierStack, session.actors, session.phaseState.bossId, combatFloor, session.map.closingRing, session.map.dynamicHazards]);

    function actionLabel(action: TowerActionInput): string {
        if (action.type === "jutsu") return selJutsu?.name ?? "jutsu";
        if (action.type === "weapon") return armedWeapon?.item.name ?? "weapon attack";
        if (action.type === "item") return myConsumables.find(entry => entry.item.id === action.itemId)?.item.name ?? "combat item";
        if (action.type === "wait") return "end turn";
        if (action.type === "clear") return "clear enemy buffs";
        if (action.type === "cleanse") return "cleanse debuffs";
        if (action.type === "summon") return "summon pet";
        if (action.type === "forfeit") return "forfeit match";
        return action.type;
    }

    function clearTargeting() {
        setMode("idle");
        setSelJutsu(null);
        setSelWeaponId("");
        setHoverEnemyPos(null);
    }

    function cancelAction() {
        if (busy) return;
        clearTargeting();
        setActionFeedback({ phase: "idle" });
    }

    function toggleMode(next: Exclude<Mode, "idle">) {
        if (busy || !myTurn) return;
        setActionFeedback({ phase: "idle" });
        setSelJutsu(null);
        setSelWeaponId("");
        setMode(current => current === next ? "idle" : next);
    }

    async function send(action: TowerActionInput) {
        // Forfeit is an owner command rather than a turn action. Every other
        // command is tied to the authoritative active fighter.
        if (actionInFlightRef.current || (action.type !== "forfeit" && !myTurn)) return;
        actionInFlightRef.current = true;
        const label = actionLabel(action);
        setActionFeedback({ phase: "submitting", label });
        try {
            // Injected encounter transports retain their established 3-argument
            // contract. Public Towers get one token per intent and one same-token
            // retry only when the response is lost at the transport layer.
            const res = actionRetryFn
                ? await actionRetryFn(runId, me, action, session.actionVersion)
                : actionFn
                    ? await actionFn(runId, me, action)
                    : await submitTowerActionWithLostResponseRetry(runId, me, action, session.actionVersion);
            if (!mountedRef.current) return;
            const responseActionVersion = res.actionVersion ?? res.currentVersion;
            const nextSession = responseActionVersion != null && res.session.actionVersion == null
                ? { ...res.session, actionVersion: responseActionVersion }
                : res.session;
            setSession(current => (nextSession.actionVersion ?? 0) >= (current.actionVersion ?? 0) ? nextSession : current);
            setFightSyncState("live");
            if (res.applied) {
                clearTargeting();
                setActionFeedback({ phase: "idle" });
            } else {
                setActionFeedback({ phase: "error", label, message: towerActionRejectionText(res.reason) });
            }
        } catch (e) {
            if (!mountedRef.current) return;
            setActionFeedback({ phase: "error", label, message: String((e as Error)?.message ?? e) });
        } finally {
            actionInFlightRef.current = false;
        }
    }

    function onTileClick(tile: number) {
        if (suppressBoardClickRef.current) return;
        if (!myTurn || busy) return;
        if (mode === "move" && moveTiles.has(tile)) { void send({ type: "move", tile }); return; }
        if (mode === "dash" && dashTiles.has(tile)) { void send({ type: "dash", tile }); return; }
        if (mode === "jutsu" && selJutsu?.id && isMoveJutsu(selJutsu) && jutsuRangeTiles.has(tile)) {
            void send({ type: "jutsu", jutsuId: selJutsu.id, tile }); return;
        }
        // Ground-target jutsu → place the zone on a non-blocked tile in range (occupied or not).
        if (mode === "jutsu" && selJutsu?.id && selJutsu.target === "EMPTY_GROUND" && jutsuRangeTiles.has(tile) && !impassableTiles.has(tile)) {
            void send({ type: "jutsu", jutsuId: selJutsu.id, tile }); return;
        }
        // Self-cast jutsu → confirmed by clicking your OWN ninja's tile.
        if (mode === "jutsu" && selJutsu?.id && isSelfCastJutsu(selJutsu) && myActor && tile === myPos) {
            void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: myActor.id }); return;
        }
        const occ = session.actors.find(a => a.hp > 0 && a.pos === tile);
        if (occ && occ.side === "enemy" && enemiesInRange.has(occ.id)) {
            if (mode === "attack") void send({ type: "attack", targetId: occ.id });
            else if (mode === "weapon" && selWeaponId) void send({ type: "weapon", targetId: occ.id, itemId: selWeaponId });
            else if (mode === "clear") void send({ type: "clear", targetId: occ.id });
            else if (mode === "jutsu" && selJutsu?.id) void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: occ.id });
        }
    }

    function avatarFor(a: TowerActor): string | null {
        // Player's own actor → the live avatar prop; allies → their sealed avatar if present;
        // PvP rivals are live players, so prefer their server-sealed avatar before
        // interpreting an enemy-side actor as a Tower NPC sprite.
        if (ownedByMe(a.ownerSlug)) {
            const ownAvatar = resolveOwnAvatar(character, sharedImages);
            if (ownAvatar) return ownAvatar;
        }
        const sealed = a.character?.avatarImage;
        if (isTeamPvp && typeof sealed === "string" && sealed) return sealed;
        if (a.side === "enemy") {
            return resolveTowerCombatantArt(String(a.character?.visual ?? ""), sharedImages).src;
        }
        if (typeof sealed === "string" && sealed) return sealed;
        const visual = String(a.character?.visual ?? "");
        return resolveTowerCombatantArt(visual, sharedImages).src;
    }
    function isUnknownCombatant(a: TowerActor): boolean {
        if (a.side !== "enemy") return false;
        if (isTeamPvp && typeof a.character?.avatarImage === "string" && a.character.avatarImage) return false;
        return resolveTowerCombatantArt(String(a.character?.visual ?? ""), sharedImages).kind === "unknown";
    }
    function emojiFor(a: TowerActor): string {
        if (isUnknownCombatant(a)) return UNKNOWN_TOWER_COMBATANT.glyph;
        if (a.side === "squad") return "🥷";
        const visual = String(a.character?.visual ?? "");
        return ENEMY_EMOJI[visual] ?? (a.side === "npc" ? "🧑" : "✦");
    }

    const myJutsu: JutsuLike[] = Array.isArray(myActor?.character?.jutsu) ? (myActor!.character.jutsu as JutsuLike[]) : [];
    // Painted card art — same source as the main combat UI (jutsu.image, else the shared
    // image cache keyed by `jutsu:<id>` / `item:<id>`).
    const jutsuArt = (j: JutsuLike) => (typeof (j as { image?: string }).image === "string" && (j as { image?: string }).image) || sharedImages?.[`jutsu:${j.id}`] || "";
    const itemArt = (it: ItemLike) => sharedImages?.[`item:${it.id}`] || "";
    // Self-cast jutsu (heal/shield/buff) arm and are confirmed by clicking your OWN
    // ninja — matching PvP and the main PvE arena — instead of firing the instant
    // the card is clicked. Tower jutsu objects don't carry tags, so the SELF target
    // field is the self-cast signal here.
    const isSelfCastJutsu = (j: JutsuLike | null | undefined) => Boolean(j)
        && !isMoveJutsu(j)
        && j!.target !== "EMPTY_GROUND"
        && (j!.target === "SELF" || !pvpAffectsOpponent(j!));
    // Clicking a jutsu card only ARMS it; the cast fires on the follow-up click
    // (a foe in range, a ground tile, or — for a self-cast — your own ninja).
    function armJutsuCard(j: JutsuLike) {
        if (busy || !myTurn) return;
        setActionFeedback({ phase: "idle" });
        setSelWeaponId("");
        setSelJutsu(prev => prev?.id === j.id ? null : j);
        setMode(prev => (prev === "jutsu" && selJutsu?.id === j.id) ? "idle" : "jutsu");
    }
    function armWeaponCard(itemId: string) {
        if (busy || !myTurn) return;
        const alreadyArmed = mode === "weapon" && selWeaponId === itemId;
        setActionFeedback({ phase: "idle" });
        setSelJutsu(null);
        setSelWeaponId(alreadyArmed ? "" : itemId);
        setMode(alreadyArmed ? "idle" : "weapon");
    }
    const objective = session.objectiveState.kind;
    const sealedStoryFloor = combatFloor;
    const encounterArt = !isTeamPvp && sealedStoryFloor?.artKey
        ? resolveTowerStoryArt(sealedStoryFloor.artKey)
        : null;
    const storyEncounterTitle = sealedStoryFloor?.name
        ? `Floor ${session.floor} · ${sealedStoryFloor.name}`
        : `Floor ${session.floor} · ${objective.replace(/-/g, " ")}`;
    // The squad rail also lists protect-target npcs (allies) so the player can watch
    // the genin's HP on a protect floor.
    const allies = session.actors.filter(a => a.side === "squad" || a.side === "npc");
    const enemies = session.actors.filter(a => a.side === "enemy");
    const actorById = useMemo(() => new Map(session.actors.map(actor => [actor.id, actor])), [session.actors]);
    const actorByTile = useMemo(() => new Map(session.actors.filter(actor => actor.hp > 0).map(actor => [actor.pos, actor])), [session.actors]);
    const blockedTileSet = impassableTiles;
    const objectiveTileSet = useMemo(() => new Set(session.map.objectiveTiles), [session.map.objectiveTiles]);
    const hazardTileSet = useMemo(() => new Set(session.map.hazardTiles), [session.map.hazardTiles]);
    const groundEffectByTile = useMemo(() => {
        const effects = new Map<number, string[]>();
        for (const zone of session.groundEffects ?? []) {
            for (const tile of zone.tiles) {
                const labels = effects.get(tile) ?? [];
                labels.push(`${zone.name}, ${zone.rounds} round${zone.rounds === 1 ? "" : "s"} remaining`);
                effects.set(tile, labels);
            }
        }
        return effects;
    }, [session.groundEffects]);
    const remainingTurnActors = useMemo(() => session.turnQueue
        .slice(session.activeIndex)
        .map(id => actorById.get(id))
        .filter((actor): actor is TowerActor => Boolean(actor && actor.hp > 0)), [session.turnQueue, session.activeIndex, actorById]);
    const biomeFloor = TOWER_FLOOR[String(session.map.biome)] ?? arenaFloorForest;

    // Objective progress readout (so the player can see how close they are to win/lose).
    const enemiesAlive = enemies.filter(e => e.hp > 0).length;
    const npcActor = session.actors.find(a => a.side === "npc");
    const bossActor = bossId ? session.actors.find(a => a.id === bossId) : undefined;
    const hpPct = (a: TowerActor) => Math.max(0, Math.round((a.hp / Math.max(1, a.maxHp)) * 100));
    const addsRemaining = session.objectiveState.addsRemaining;
    const bossUnlocked = session.objectiveState.bossUnlocked;
    const breakProgress = session.objectiveState.breakProgress ?? session.objectiveState.breakStagesCompleted;
    const breakGoal = session.objectiveState.breakGoal ?? session.objectiveState.breakStagesTotal;
    const roundsSurvived = session.objectiveState.roundsSurvived ?? 0;
    const holdGoal = combatFloor?.roundBudget;
    const holdRemaining = holdGoal == null ? null : Math.max(0, holdGoal - roundsSurvived);
    const roundPresentation = towerRoundPresentation(session);
    const objectiveProgress =
        bossUnlocked === false && Number.isFinite(addsRemaining) ? `Boss barrier · ${addsRemaining} reinforcement${addsRemaining === 1 ? "" : "s"} left`
        : Number.isFinite(breakProgress) && Number.isFinite(breakGoal) ? `Break seals ${breakProgress}/${breakGoal}`
        : bossUnlocked === true && bossActor ? `Boss vulnerable · ${hpPct(bossActor)}% HP`
        : objective === "defeat-boss" && bossActor ? `Boss ${hpPct(bossActor)}% HP`
        : objective === "protect-npc" && npcActor ? `${npcActor.name} ${hpPct(npcActor)}% HP · hold ${roundsSurvived}${holdGoal == null ? " rounds" : `/${holdGoal} rounds · ${holdRemaining} remaining`}`
        : objective === "survive" ? `Held ${roundsSurvived}${holdGoal == null ? " rounds" : `/${holdGoal} rounds · ${holdRemaining} remaining`}`
        : objective === "kill-escort" && npcActor ? `${npcActor.name} ${hpPct(npcActor)}% HP · ${enemiesAlive} foe${enemiesAlive !== 1 ? "s" : ""} left`
        : objective === "reach-tile" ? (session.objectiveState.reachedGoal ? "Goal reached" : "Reach the goal tile")
        : `${enemiesAlive} foe${enemiesAlive !== 1 ? "s" : ""} left`;
    const nextEnemyWave = (session.pendingEnemyWaves ?? []).find(wave => wave.actors.length > 0);
    const pendingBossPhases = session.phaseState.pendingPhases ?? [];
    const nextBossPhase = pendingBossPhases.length > 0 ? Math.max(...pendingBossPhases) : undefined;
    const objectiveDirective = bossUnlocked === false
        ? { title: "Break the boss barrier", detail: "Eliminate the remaining reinforcements to expose the commander." }
        : Number.isFinite(breakProgress) && Number.isFinite(breakGoal)
            ? { title: "Shatter the objective seals", detail: "Advance the break condition before the enemy formation overwhelms the squad." }
            : isTeamPvp
                ? { title: "Eliminate the rival team", detail: "Coordinate focus fire and leave no opposing fighter standing." }
                : objective === "defeat-boss" && bossActor
                    ? { title: `Defeat ${bossActor.name}`, detail: "Read each phase gate, avoid telegraphed ground, and finish the commander." }
                    : objective === "protect-npc" && npcActor
                        ? { title: `Protect ${npcActor.name}`, detail: "Keep the protected ally alive until the hold is complete." }
                        : objective === "survive"
                            ? { title: "Hold the line", detail: "Keep at least one squad fighter standing through the final hold round." }
                            : objective === "kill-escort" && npcActor
                                ? { title: `Eliminate ${npcActor.name}`, detail: "Break through the escort and defeat the marked target." }
                                : objective === "reach-tile"
                                    ? { title: "Reach the marked tile", detail: "Create a safe route and move a squad fighter onto the objective." }
                                    : { title: "Eliminate the enemy force", detail: "Control the field and defeat every remaining hostile." };
    const bossDossierBarrierActive = Boolean(bossActor && (
        lockedBossId === bossActor.id
        || (String(bossActor.character?.mechanic ?? "") === "bulwark"
            && enemies.some(enemy => enemy.id !== bossActor.id && enemy.hp > 0))
    ));
    const bossDossierArt = bossActor ? avatarFor(bossActor) : null;
    const fieldFeatures = new Set((session.map.features ?? []).map(feature => feature.kind));
    const fieldObjects = new Set((session.map.boardObjects ?? []).map(object => object.kind));
    const boardLegend: Array<{ kind: string; label: string; detail: string }> = [];
    if (strikeTiles.size > 0) boardLegend.push({ kind: "strike", label: "Boss strike", detail: "Leave violet tiles before round end." });
    if (crimsonTiles.length > 0 || fieldFeatures.has("hazard") || (session.map.dynamicHazards ?? []).length > 0) {
        boardLegend.push({ kind: "hazard", label: "Hazard", detail: "Crimson ground deals end-round damage." });
    }
    if (ringTiles.size > 0) boardLegend.push({ kind: "ring", label: "Collapse zone", detail: "Ember tiles sit outside the safe ring." });
    if (fieldFeatures.has("pylon")) boardLegend.push({ kind: "pylon", label: "Elemental pylon", detail: "Attack from its field for the shown affinity." });
    if (fieldFeatures.has("ward")) boardLegend.push({ kind: "ward", label: "Ward", detail: "Reduces damage while you hold its tiles." });
    if (fieldObjects.has("font")) boardLegend.push({ kind: "font", label: "Restoration font", detail: "Restores the displayed resource at round end." });
    if (fieldObjects.has("shrine")) boardLegend.push({ kind: "shrine", label: "Battle shrine", detail: "Hold it to empower your team's damage." });
    if (session.map.objectiveTiles.length > 0) boardLegend.push({ kind: "objective", label: "Objective tile", detail: "Gold ground advances the mission." });
    if (session.map.blockedTiles.length > 0) boardLegend.push({ kind: "terrain", label: "Impassable terrain", detail: "Pillars block movement and line routes." });
    const threatSummary = buildTowerThreatSummary({
        round: session.round,
        strikeLabel: session.bossStrike?.label,
        strikeTiles: strikeTiles.size,
        hazardTiles: crimsonTiles.length,
        ringTiles: ringTiles.size,
        reinforcementRound: nextEnemyWave?.round,
        reinforcementCount: nextEnemyWave?.actors.length,
        nextBossPhase,
        roundCap: session.roundCap,
    });
    const armedActionName = mode === "jutsu" ? selJutsu?.name ?? "Jutsu"
        : mode === "weapon" ? armedWeapon?.item.name ?? "Weapon"
        : mode === "clear" ? "Clear enemy buffs"
        : mode === "attack" ? "Attack"
        : mode === "move" ? "Move"
        : mode === "dash" ? "Dash"
        : null;
    const hasGroundJutsuTarget = mode === "jutsu" && !!selJutsu
        && [...jutsuRangeTiles].some(tile => !session.map.blockedTiles.includes(tile));
    const targetingBlockedMessage = !myTurn ? ""
        : mode === "attack" && enemiesInRange.size === 0 ? "No enemy is in melee range. Move, Dash, or choose a ranged technique."
        : mode === "weapon" && enemiesInRange.size === 0 ? `No enemy is within ${weaponRange} hex${weaponRange === 1 ? "" : "es"} of this weapon.`
        : mode === "clear" && enemiesInRange.size === 0 ? "No living enemy can be cleared."
        : mode === "move" && moveTiles.size === 0 ? "No adjacent tile is open. Dash or use a movement technique."
        : mode === "dash" && dashTiles.size === 0 ? "No legal Dash destination is open."
        : mode === "jutsu" && !!selJutsu && !isSelfCastJutsu(selJutsu)
            && selJutsu.target !== "EMPTY_GROUND" && enemiesInRange.size === 0 ? `No enemy is within range of ${selJutsu.name ?? "this technique"}.`
        : mode === "jutsu" && !!selJutsu && selJutsu.target === "EMPTY_GROUND" && !hasGroundJutsuTarget ? `No legal tile is within range of ${selJutsu.name ?? "this technique"}.`
        : "";
    const targetingBlocked = targetingBlockedMessage.length > 0;
    // What to do with the currently-armed action (esp. ground jutsu, which need a tile).
    const targetingHint = !myTurn ? "" :
        targetingBlocked ? targetingBlockedMessage :
        mode === "move" ? "Click an adjacent tile to move." :
        mode === "dash" ? "Click a highlighted tile to dash (up to 3 hexes)." :
        mode === "attack" ? "Click an enemy in range to attack." :
        mode === "weapon" ? "Click an enemy in range." :
        mode === "clear" ? "Click any enemy to strip its buffs." :
        mode === "jutsu" && isSelfCastJutsu(selJutsu) ? `Click yourself to cast ${selJutsu?.name ?? "it"}.` :
        mode === "jutsu" && isMoveJutsu(selJutsu) ? `Click a highlighted tile to flicker there with ${selJutsu?.name ?? "it"}.` :
        mode === "jutsu" && selJutsu?.target === "EMPTY_GROUND" ? `Click a highlighted tile to place ${selJutsu.name ?? "the zone"}.` :
        mode === "jutsu" && isBurstJutsu(selJutsu) ? `Click an enemy — ${selJutsu?.name ?? "the blast"} also hits foes in the amber tiles around them.` :
        mode === "jutsu" && selJutsu ? `Click an enemy in range to cast ${selJutsu.name ?? "it"}.` : "";
    const newlyRecordedTowerMilestones = (settlement.response?.character?.battleTowerMilestones ?? [])
        .filter(milestone => !initialTowerMilestonesRef.current.has(milestone));
    const mySettlementResult = settlement.response?.results[meSlug];

    return (
        <CombatInstance className={`screen-battleTowerFight${variant === "team-pvp" ? " tower-team-pvp-fight" : ""}`} style={{ color: "var(--slate-200)", background: `linear-gradient(rgba(6,10,20,0.82), rgba(6,10,20,0.9)), url(${storyTheme?.backdropImage || gameBg}) center/cover fixed` }}>
            {storyTheme?.chapterLabel && <div className="story-fight-chapter">{storyTheme.chapterLabel}</div>}
            {storyFinalPhase && <div className="story-fight-vignette" aria-hidden="true" />}
            {bark && (
                <div className={`story-fight-bark${bark.side === "ally" ? " story-fight-bark--ally" : ""}`} role="status">
                    {bark.side === "boss" && storyBoss && avatarFor(storyBoss) && (
                        <img className="story-fight-bark-face" src={avatarFor(storyBoss)!} alt="" />
                    )}
                    <div className="story-fight-bark-body">
                        <strong>{bark.name}</strong>
                        <span>{bark.text}</span>
                    </div>
                </div>
            )}
            {/* Endless Spire — boss intro nameplate (fresh entry only; click to skip) */}
            {introOpen && spireMeta && (
                <div className="spire-intro" onMouseDown={event => { if (event.target === event.currentTarget) dismissIntro(); }}>
                    <div ref={introDialogRef} className="spire-intro-card" role="dialog" aria-modal="true"
                        aria-labelledby="tower-spire-intro-title" aria-describedby="tower-spire-intro-description" tabIndex={-1}
                        style={{ ["--boss-accent" as string]: spireMeta.boss.accent, ["--boss-glow" as string]: spireMeta.boss.glow }}>
                        <div className="spire-intro-band" style={{ color: spireMeta.band.color }}>{spireMeta.band.label} · Floor {spireMeta.tier}</div>
                        {bossPortrait && <img className="spire-intro-portrait" src={bossPortrait} alt={spireMeta.boss.name} />}
                        <div id="tower-spire-intro-title" className="spire-intro-name" style={{ color: spireMeta.boss.accent }}>{spireMeta.boss.name}</div>
                        <div id="tower-spire-intro-description" className="spire-intro-mech"><b>{spireMeta.boss.mechanicLabel}</b> — {spireMeta.boss.blurb}</div>
                        <button ref={introPrimaryRef} type="button" className="tower-dialog-primary" onClick={dismissIntro}>Enter battle</button>
                    </div>
                </div>
            )}
            {/* Endless Spire — phase-change banner (boss crosses an HP gate) */}
            {phaseBanner && (
                <div key={phaseBanner.key} className="spire-phase-banner tower-phase-banner" role="status" aria-live="polite" aria-atomic="true"
                    style={{ ["--boss-accent" as string]: spireMeta?.boss.accent ?? "#f0a15a" }}>
                    <span>
                        <strong>⚠ {phaseBanner.title}</strong>
                        <small>{phaseBanner.instruction}</small>
                    </span>
                </div>
            )}
            <div className="tower-fight-grid">

                {/* Squad rail (+ protect-target allies) */}
                <aside className="tower-squad-rail" style={{ minWidth: 0 }} aria-label={isTeamPvp ? "Your Team" : "Squad"}>
                    <RailHeader icon="🛡" label={isTeamPvp ? "Your Team" : "Squad"} accent="var(--green-400)" />
                    {allies.map(a => <ActorCard key={a.id} actor={a} round={session.round} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} ally={a.side === "npc"} />)}
                    <section className="tower-combat-intel" aria-labelledby="tower-combat-intel-title"
                        style={encounterArt ? { ["--tower-intel-art" as string]: `url("${encounterArt.src}")` } : undefined}
                        data-has-encounter-art={encounterArt ? "true" : undefined}>
                        <header className="tower-intel-header">
                            <span aria-hidden="true">◈</span>
                            <div>
                                <small>Live tactical feed</small>
                                <strong id="tower-combat-intel-title">Combat intel</strong>
                            </div>
                            <em>LIVE</em>
                        </header>

                        <article className="tower-objective-dossier" aria-label="Primary objective">
                            <span className="tower-intel-kicker">Primary objective</span>
                            <strong>{objectiveDirective.title}</strong>
                            <p>{objectiveDirective.detail}</p>
                            <span className="tower-intel-progress">{objectiveProgress}</span>
                        </article>

                        {bossActor && (
                            <article className="tower-boss-dossier" aria-label={`${bossActor.name} boss dossier`} data-barrier-active={bossDossierBarrierActive ? "true" : undefined}>
                                <div className="tower-boss-dossier-heading">
                                    <div className="tower-boss-dossier-portrait" aria-hidden="true">
                                        {bossDossierArt
                                            ? <img src={bossDossierArt} alt="" />
                                            : <span className={isUnknownCombatant(bossActor) ? "tower-unknown-combatant" : undefined}>{emojiFor(bossActor)}</span>}
                                    </div>
                                    <div>
                                        <small>Floor commander</small>
                                        <strong>{bossActor.name}</strong>
                                        <em>{bossActor.hp <= 0 ? "Defeated" : bossDossierBarrierActive ? "Barrier active" : "Target vulnerable"}</em>
                                    </div>
                                </div>
                                <div className="tower-boss-health-meter" role="progressbar" aria-label={`${bossActor.name} health`}
                                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={hpPct(bossActor)}>
                                    <span style={{ width: `${hpPct(bossActor)}%` }} />
                                </div>
                                <div className="tower-boss-dossier-metrics">
                                    <span><b>{hpPct(bossActor)}%</b>Health</span>
                                    <span><b>{Math.max(0, Math.round(bossActor.shield))}</b>Aegis</span>
                                </div>
                                <p className="tower-boss-phase-readout">
                                    {bossDossierBarrierActive
                                        ? "Reinforcements are sustaining the barrier."
                                        : nextBossPhase != null
                                            ? `Next phase shift at ${nextBossPhase}% HP.`
                                            : "Final phase active — commit the finish."}
                                </p>
                            </article>
                        )}

                        {boardLegend.length > 0 && (
                            <div className="tower-board-legend">
                                <span className="tower-intel-kicker">Field recognition</span>
                                <div role="list" aria-label="Battlefield legend">
                                    {boardLegend.map(item => (
                                        <div key={item.kind} className="tower-board-legend-item" role="listitem">
                                            <i className={`tower-legend-swatch tower-legend-swatch--${item.kind}`} aria-hidden="true" />
                                            <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                </aside>

                {/* Board */}
                <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <header className="tower-fight-header tower-fight-statusbar" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8,
                            ...(encounterArt ? { ["--tower-encounter-art" as string]: `url("${encounterArt.src}")` } : {}),
                        }} data-has-encounter-art={encounterArt ? "true" : undefined} data-art-kind={encounterArt?.kind}>
                        <h1 className="tower-fight-title">{isTeamPvp ? "2v2 Team Arena · eliminate the rival team" : storyEncounterTitle}</h1>
                        <span className="tower-objective-progress" role="status" aria-label={`Objective progress: ${objectiveProgress}`}>🎯 {objectiveProgress}</span>
                        <span className="tower-round-readout" title={roundPresentation.hudTitle} aria-label={roundPresentation.hudTitle} style={{
                            color: roundPresentation.hardLimit && session.round >= roundPresentation.hardLimit - 2 ? "var(--red-400)"
                                : roundPresentation.hardLimit && session.round >= Math.floor(roundPresentation.hardLimit * 0.66) ? "var(--gold)" : "var(--text-dim)",
                        }}>{roundPresentation.hudLabel}</span>
                        {turnLabel && (
                            <span className="tower-fight-turn-pill" style={{
                                display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", overflow: "hidden", padding: "3px 10px", borderRadius: 16, fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap",
                                background: myTurn ? "linear-gradient(180deg,#16803a,#0c5226)" : "rgba(15,23,42,0.85)",
                                border: `1px solid ${myTurn ? "var(--green-400)" : activeActor?.side === "enemy" ? "var(--red-400)" : "var(--blue-400)"}`,
                                color: myTurn ? "#dcfce7" : "var(--slate-200)",
                            }}>
                                <span className="tower-fight-turn-label" aria-live="polite">{turnLabel}</span>
                                {activeIsLiveHuman && session.turnStartedAt ? <TowerTurnCountdown turnStartedAt={session.turnStartedAt} /> : null}
                            </span>
                        )}
                        {session.status === "active" && (
                            <button
                                type="button"
                                className="tower-fight-leave"
                                disabled={busy}
                                style={{ padding: "4px 10px", fontSize: "0.8rem", borderColor: isTeamPvp ? "var(--red-400)" : "var(--slate-600)", color: isTeamPvp ? "#fecaca" : "var(--slate-300)" }}
                                onClick={async () => {
                                    if (isTeamPvp) {
                                        if (await gameConfirm("Forfeit your fighter from this 2v2 match? This is immediate and your teammate may have to continue alone.")) void send({ type: "forfeit" });
                                    } else if (await gameConfirm("Leave the battle view? The server run will continue and may auto-pass your turns. Reopen Battle Towers to recover it.")) {
                                        (onLeaveActive ?? onExit)();
                                    }
                                }}
                            >{isTeamPvp ? "Forfeit" : "Leave view"}</button>
                        )}
                    </header>

                    {/* Endless Spire — sealed modifier manifest (why the numbers are bigger this floor).
                        Wave-2 keystones (hazard/debuff/healcut) are colour-coded apart from the stat
                        chassis (hp/dmg/round/enrage) so tactical demands read at a glance. */}
                    {session.status === "active" && remainingTurnActors.length > 0 && (
                        <ol className="tower-turn-queue" aria-label="Remaining turn order" title="Scroll horizontally for later fighters." tabIndex={0}>
                            {remainingTurnActors.map((actor, index) => (
                                <li key={actor.id} className={index === 0 ? "is-active" : undefined} aria-current={index === 0 ? "step" : undefined}>
                                    <span className={`tower-turn-dot tower-turn-dot--${actor.side}`} aria-hidden="true" />
                                    <span>{index === 0 ? "Now: " : "Next: "}{actor.name}</span>
                                </li>
                            ))}
                        </ol>
                    )}

                    <div className={`tower-threat-summary${threatSummary.length > 0 ? " has-threats" : ""}`} role="status" aria-live="polite" aria-label="Immediate battlefield threats">
                        <strong>{threatSummary.length > 0 ? "Immediate threats" : "Tactical read"}</strong>
                        {threatSummary.length > 0
                            ? threatSummary.map(threat => <span key={threat}>{threat}</span>)
                            : <span>No telegraphed strike this round. Hold formation and advance the objective.</span>}
                    </div>

                    {Array.isArray(session.modifierStack) && session.modifierStack.length > 0 && (
                        <div className="tower-mechanic-strip" role="list" aria-label="Sealed floor modifiers">
                            {session.modifierStack.map((m, i) => {
                                const c = MODIFIER_CHIP_COLOR[m.kind] ?? MODIFIER_CHIP_COLOR.default!;
                                return (
                                    <span key={i} className="tower-mechanic-chip" role="listitem" title={m.label} style={{
                                        fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                                        color: c.fg, background: c.bg, border: `1px solid ${c.border}`,
                                    }}>{m.label}</span>
                                );
                            })}
                        </div>
                    )}

                    {/* Story encounter manifest — the boss's kit as chips (mirrors the spire chips) */}
                    {encounterChips.length > 0 && (
                        <div className="tower-mechanic-strip" role="list" aria-label="Encounter mechanics and warnings">
                            {encounterChips.map((c, i) => {
                                const pal = MODIFIER_CHIP_COLOR[c.kind] ?? MODIFIER_CHIP_COLOR.default!;
                                return (
                                    <span key={i} className="tower-mechanic-chip" role="listitem" style={{
                                        fontSize: "0.72rem", fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                                        color: pal.fg, background: pal.bg, border: `1px solid ${pal.border}`,
                                    }}>{c.icon} {c.text}</span>
                                );
                            })}
                        </div>
                    )}

                    <div className="tower-board-toolbar">
                        <span className="tower-board-help">Drag the field to pan after zooming in.</span>
                        <div className="tower-board-controls" role="group" aria-label="Battlefield view controls">
                            <button type="button" onClick={() => changeBoardZoom(-TOWER_ZOOM_STEP)} disabled={boardZoom <= TOWER_ZOOM_MIN} aria-label="Zoom battlefield out">−</button>
                            <input type="range" min={TOWER_ZOOM_MIN} max={maximumBoardZoom} step={0.05} value={boardZoom} aria-label="Battlefield zoom"
                                onChange={event => setBoardZoom(clampTowerZoom(Number(event.target.value), maximumBoardZoom))} />
                            <output aria-live="polite">{Math.round(boardZoom * 100)}%</output>
                            <button type="button" onClick={() => changeBoardZoom(TOWER_ZOOM_STEP)} disabled={boardZoom >= maximumBoardZoom} aria-label="Zoom battlefield in">+</button>
                            <button type="button" onClick={resetBoardView} disabled={boardZoom === TOWER_ZOOM_MIN && boardPan.x === 0 && boardPan.y === 0}>Fit / reset</button>
                        </div>
                    </div>

                    <div ref={battlefieldCallbackRef} className={`tower-board-area${boardZoom > TOWER_ZOOM_MIN ? " is-pannable" : ""}`}
                        role="region" aria-label="Tactical battlefield. Use the zoom controls, then drag to pan."
                        aria-describedby={(fightSyncState === "reconnecting" || actionFeedback.phase !== "idle" || armedActionName || (!myTurn && session.status === "active")) ? "tower-action-guidance" : undefined}
                        onPointerDown={onBoardPointerDown} onPointerMove={onBoardPointerMove} onPointerUp={endBoardPointer} onPointerCancel={endBoardPointer}
                        style={{ flex: 1, position: "relative", overflow: "hidden", borderRadius: 10, border: "2px solid #1f2937", background: `radial-gradient(ellipse at center, rgba(5,12,8,0.05), rgba(4,9,6,0.4)), url(${biomeFloor}) center/cover no-repeat` }}>
                        <div style={{
                            position: "absolute",
                            left: `${(boardContainerSize.w - renderedBoardSize.width) / 2 + boardPan.x}px`,
                            top: `${(boardContainerSize.h - renderedBoardSize.height) / 2 + boardPan.y}px`,
                            width: `${renderedBoardSize.width}px`, height: `${renderedBoardSize.height}px`,
                        }}>
                            <div className="hex-grid-layer" style={{ position: "absolute", left: 0, top: 0, width: layer.width, height: layer.height, transform: `scale(${renderedScale})`, transformOrigin: "top left" }}>
                                {/* hex tiles */}
                                {Array.from({ length: w * h }, (_, pos) => {
                                    const { left, top } = towerHexPixel(pos, w);
                                    const isMove = moveTiles.has(pos) || dashTiles.has(pos);
                                    const inJ = (mode === "weapon" || (mode === "jutsu" && !isSelfCastJutsu(selJutsu))) && jutsuRangeTiles.has(pos);
                                    const isGoal = objectiveTileSet.has(pos);
                                    const isBlocked = blockedTileSet.has(pos);
                                    const feat = featureByTile.get(pos);
                                    const boardObject = boardObjectByTile.get(pos);
                                    const dynamicHazard = dynamicHazardByTile.get(pos);
                                    const occupant = actorByTile.get(pos);
                                    const isJutsuMoveTarget = mode === "jutsu"
                                        && !!selJutsu
                                        && isMoveJutsu(selJutsu)
                                        && jutsuRangeTiles.has(pos)
                                        && !isBlocked;
                                    const validGroundTarget = mode === "jutsu"
                                        && selJutsu?.target === "EMPTY_GROUND"
                                        && !isMoveJutsu(selJutsu)
                                        && jutsuRangeTiles.has(pos)
                                        && !isBlocked;
                                    const validAction = isMove
                                        ? (mode === "dash" ? "Dash here" : "Move here")
                                        : isJutsuMoveTarget ? "jutsu move destination"
                                        : validGroundTarget ? `Place ${selJutsu?.name ?? "jutsu"} here` : undefined;
                                    const danger: string[] = [];
                                    if (strikeTiles.has(pos)) danger.push(`${session.bossStrike?.label ?? "Boss strike"} at round end`);
                                    if (ringTiles.has(pos)) danger.push("Outside the safe ring");
                                    if (crimsonTileSet.has(pos) || hazardTileSet.has(pos)) danger.push("Hazard damage at round end");
                                    const tileFeatures = [
                                        feat ? featureLabel(feat) : undefined,
                                        boardObject ? objectLabel(boardObject) : undefined,
                                        dynamicHazard ? `Geyser vent: ${dynamicHazard.pct}% max HP, erupts every ${Math.max(2, Number(dynamicHazard.everyRounds ?? 3))} rounds` : undefined,
                                    ].filter((label): label is string => Boolean(label));
                                    const tileLabel = buildTowerTileLabel({
                                        position: pos,
                                        width: w,
                                        occupant: occupant?.name,
                                        feature: tileFeatures.length > 0 ? tileFeatures.join(". ") : undefined,
                                        groundEffect: groundEffectByTile.get(pos)?.join("; "),
                                        blocked: isBlocked,
                                        objective: isGoal,
                                        danger,
                                        validAction,
                                    });
                                    const tileActionable = Boolean(validAction && myTurn && !busy);
                                    return (
                                        <button key={pos} type="button" onClick={() => onTileClick(pos)} title={tileLabel} aria-label={tileLabel}
                                            data-combat-tile={pos}
                                            aria-disabled={!tileActionable} tabIndex={tileActionable ? 0 : -1}
                                            aria-hidden={!tileActionable}
                                            inert={!tileActionable ? true : undefined}
                                            className="tower-hex-tile"
                                            style={{
                                                left, top, width: HEX_W, height: HEX_H,
                                                cursor: tileActionable ? "pointer" : "default",
                                                ...tileFill(feat, { isMove, inJ, isGoal, isBlocked }),
                                            }} />
                                    );
                                })}

                                {/* persistent ground-effect zones (tile-placed jutsu) */}
                                {(session.groundEffects ?? []).flatMap((z, zi) => z.tiles.map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    const tag = z.tags?.[0]?.name;
                                    // toxic-green Poison / red Recoil / purple debuff — saturated + outlined so the
                                    // zone reads clearly over the floor and pylon tints.
                                    const fill = tag === "Poison" ? "rgba(190,242,100,0.5)" : tag === "Recoil" ? "rgba(248,113,113,0.5)" : "rgba(192,132,252,0.5)";
                                    const edge = tag === "Poison" ? "rgba(132,204,22,0.95)" : tag === "Recoil" ? "rgba(239,68,68,0.95)" : "rgba(168,85,247,0.95)";
                                    return <div key={`z-${zi}-${t}`} className="tower-hex-tile" title={`${z.name} — ${z.rounds} round${z.rounds !== 1 ? "s" : ""} left`}
                                        style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: fill, filter: `drop-shadow(0 0 2px ${edge})`, zIndex: 3, pointerEvents: "none", animation: "towerZonePulse 1.6s ease-in-out infinite" }} />;
                                }))}

                                {/* AOE Burst splash preview — amber footprint of the target-centred blast (target + touching hexes) */}
                                {[...aoeBurstTiles].map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    return <div key={`burst-${t}`} className="tower-hex-tile" aria-hidden
                                        style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: "rgba(251,146,60,0.34)", filter: "drop-shadow(0 0 2px rgba(249,115,22,0.95))", zIndex: 3, pointerEvents: "none", animation: "towerZonePulse 1.6s ease-in-out infinite" }} />;
                                })}

                                {/* Endless Spire hazard telegraph — crimson "this burns at round end" warning so the
                                    squad can step off before it lands. Exact deterministic hazards only (server omits
                                    reactive proximity tiles). Boss-strike + closing-ring tiles are filtered OUT here —
                                    they get their own violet / ember reads below so each danger is distinguishable. */}
                                {crimsonTiles.map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    return <div key={`haz-${t}`} className="tower-hex-tile" aria-hidden title="Hazard — burns at round end"
                                        style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: "rgba(220,38,38,0.32)", filter: "drop-shadow(0 0 3px rgba(239,68,68,0.95))", zIndex: 3, pointerEvents: "none", animation: "towerHazardPulse 1s ease-in-out infinite" }} />;
                                })}

                                {/* Boss strike telegraph — VIOLET "the boss detonates HERE at round's end" zone.
                                    Snapshotted server-side when primed, so this footprint is a hard guarantee. */}
                                {[...strikeTiles].map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    return <div key={`strike-${t}`} className="tower-hex-tile" aria-hidden title={`${session.bossStrike?.label ?? "Boss strike"} — erupts at round's end`}
                                        style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: "rgba(147,51,234,0.38)", filter: "drop-shadow(0 0 4px rgba(192,132,252,0.95))", zIndex: 3, pointerEvents: "none", animation: "towerHazardPulse 0.8s ease-in-out infinite" }} />;
                                })}

                                {/* Closing ring — EMBER collapse zone outside the shrinking safe circle. A slower,
                                    heavier pulse than the strike so "terrain" reads apart from "attack". */}
                                {[...ringTiles].map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    return <div key={`ring-${t}`} className="tower-hex-tile" aria-hidden title="Collapsing arena — chips you at round end"
                                        style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: "rgba(194,65,12,0.4)", filter: "drop-shadow(0 0 3px rgba(251,146,60,0.9))", zIndex: 3, pointerEvents: "none", animation: "towerZonePulse 2.2s ease-in-out infinite" }} />;
                                })}

                                {/* feature markers — one icon at a pylon flower's centre, one per
                                    tile for scattered hazards / single wards */}
                                {(session.map.features ?? []).map((feat, fi) => {
                                    const center = feat.tiles[0];
                                    if (center == null) return null;
                                    const { left, top } = towerHexPixel(center, w);
                                    const cx = left + HEX_W / 2, cy = top + HEX_H / 2;
                                    const sprite = feat.kind === "pylon" ? PYLON_SPRITE[feat.element] : FEATURE_SPRITE[feat.kind];
                                    if (sprite) {
                                        const S = 38;
                                        return <img key={`f-${fi}`} src={sprite} alt="" aria-hidden="true" title={featureLabel(feat)}
                                            style={{ position: "absolute", left: cx - S / 2, top: cy - S + 9, width: S, height: S, objectFit: "contain", zIndex: 5, pointerEvents: "none", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.75))" }} />;
                                    }
                                    return (
                                        <div key={`f-${fi}`} title={featureLabel(feat)} aria-hidden
                                            style={{ position: "absolute", left: cx - 11, top: cy - 13, fontSize: 18, lineHeight: 1, zIndex: 4, pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>
                                            {featureIcon(feat)}
                                        </div>
                                    );
                                })}

                                {/* terrain pillars — painted biome props on the impassable tiles (movement,
                                    pathing and the dark tile tint are already handled; this is the body) */}
                                {session.map.blockedTiles.map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    const sprite = OBSTACLE_SPRITE[session.map.biome ?? "central"] ?? OBSTACLE_SPRITE.central!;
                                    const S = 46;
                                    return <img key={`obs-${t}`} src={sprite} alt="" aria-hidden title="Impassable terrain"
                                        style={{ position: "absolute", left: left + HEX_W / 2 - S / 2, top: top + HEX_H * 0.9 - S, width: S, height: S, objectFit: "contain", zIndex: 5, pointerEvents: "none", filter: "drop-shadow(0 3px 3px rgba(0,0,0,0.8))" }} />;
                                })}

                                {/* dynamic hazards — geyser vents. The vent sits on the tile always; when it's
                                    about to erupt the tile also joins the crimson telegraph (rendered above). */}
                                {(session.map.dynamicHazards ?? []).flatMap((hz, hi) => (hz.tiles ?? []).map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    const primed = (session.map.nextRoundHazardTiles ?? []).includes(t);
                                    const S = 40;
                                    return (
                                        <span key={`geyser-${hi}-${t}`}>
                                            <div className="tower-hex-tile" aria-hidden
                                                style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: primed ? "rgba(234,88,12,0.34)" : "rgba(234,88,12,0.12)", filter: "drop-shadow(0 0 3px rgba(249,115,22,0.7))", zIndex: 2, pointerEvents: "none", animation: primed ? "towerHazardPulse 0.9s ease-in-out infinite" : "towerZonePulse 2.8s ease-in-out infinite" }} />
                                            <img src={hazardGeyser} alt="" aria-hidden="true" title={`Geyser — erupts every ${Math.max(2, Number(hz.everyRounds ?? 3))} rounds for ${hz.pct}% max HP; don't end the round on it`}
                                                style={{ position: "absolute", left: left + HEX_W / 2 - S / 2, top: top + HEX_H * 0.9 - S, width: S, height: S, objectFit: "contain", zIndex: 5, pointerEvents: "none", filter: `drop-shadow(0 2px 3px rgba(0,0,0,0.8))${primed ? " drop-shadow(0 0 7px rgba(249,115,22,0.95))" : ""}` }} />
                                        </span>
                                    );
                                }))}

                                {/* board objects — fonts & shrines. The tile glows (turquoise font / gold
                                    shrine, tinted by the holder for shrines) and the prop sits on it. */}
                                {(session.map.boardObjects ?? []).flatMap((o, oi) => (o.tiles ?? []).map(t => {
                                    const { left, top } = towerHexPixel(t, w);
                                    const holder = o.kind === "shrine"
                                        ? session.actors.find(a => a.hp > 0 && (a.side === "squad" || a.side === "enemy") && a.pos === t)?.side
                                        : undefined;
                                    const glow = o.kind === "font" ? "rgba(45,212,191,0.9)"
                                        : holder === "squad" ? "rgba(103,232,249,0.95)"
                                        : holder === "enemy" ? "rgba(251,113,133,0.95)"
                                        : "rgba(250,204,21,0.85)";
                                    const fill = o.kind === "font" ? "rgba(20,184,166,0.3)"
                                        : holder === "squad" ? "rgba(34,211,238,0.3)"
                                        : holder === "enemy" ? "rgba(244,63,94,0.3)"
                                        : "rgba(250,204,21,0.24)";
                                    const S = 42;
                                    return (
                                        <span key={`bo-${oi}-${t}`}>
                                            <div className="tower-hex-tile" aria-hidden
                                                style={{ position: "absolute", left, top, width: HEX_W, height: HEX_H, background: fill, filter: `drop-shadow(0 0 3px ${glow})`, zIndex: 2, pointerEvents: "none", animation: "towerZonePulse 2.4s ease-in-out infinite" }} />
                                            <img src={OBJECT_SPRITE[o.kind]} alt="" aria-hidden="true" title={objectLabel(o)}
                                                style={{ position: "absolute", left: left + HEX_W / 2 - S / 2, top: top + HEX_H * 0.9 - S, width: S, height: S, objectFit: "contain", zIndex: 5, pointerEvents: "none", filter: `drop-shadow(0 2px 3px rgba(0,0,0,0.8)) drop-shadow(0 0 6px ${glow})` }} />
                                        </span>
                                    );
                                }))}

                                {/* actor orbs */}
                                {session.actors.filter(a => a.hp > 0).map(a => {
                                    const { left, top } = towerHexPixel(a.pos, w);
                                    const isBoss = a.id === bossId;
                                    const bossBarrierActive = isBoss && (
                                        lockedBossId === a.id
                                        || (String(a.character?.mechanic ?? "") === "bulwark"
                                            && session.actors.some(other => other.side === "enemy" && other.id !== a.id && other.hp > 0))
                                    );
                                    const size = isBoss ? BOSS_ORB : ORB;
                                    const ox = left + HEX_W / 2 - size / 2;
                                    const oy = top + HEX_H * 0.85 - size;
                                    const row = Math.floor(a.pos / w);
                                    const targetable = enemiesInRange.has(a.id) && (mode === "attack" || mode === "weapon" || mode === "clear" || (mode === "jutsu" && !!selJutsu && !isSelfCastJutsu(selJutsu) && !isMoveJutsu(selJutsu) && selJutsu.target !== "EMPTY_GROUND"));
                                    // Self-cast jutsu: the player's own orb is the click target.
                                    const selfTargetable = mode === "jutsu" && !!selJutsu && isSelfCastJutsu(selJutsu) && myActor != null && a.id === myActor.id;
                                    const isActive = a.id === activeId;
                                    const img = avatarFor(a);
                                    const battleSprite = a.side === "enemy" && !isTeamPvp
                                        ? battlefieldAiSprite(String(a.character?.visual ?? ""), sharedImages)
                                        : null;
                                    const spriteFacing = battleSprite
                                        ? battlefieldFacingTowardNearest(a, session.actors, w)
                                        : undefined;
                                    const unknownCombatant = isUnknownCombatant(a);
                                    const ringColor = a.side === "squad" ? "#67e8f9" : a.side === "npc" ? "var(--gold)" : "#fb7185";
                                    const pct = Math.max(0, Math.min(100, (a.hp / Math.max(1, a.maxHp)) * 100));
                                    return (
                                        <button key={a.id} type="button" className="tower-board-actor" onClick={() => onTileClick(a.pos)} data-protected={bossBarrierActive ? "true" : undefined}
                                            data-combat-target-tile={a.pos}
                                            aria-disabled={busy || (!targetable && !selfTargetable)}
                                            tabIndex={!busy && (targetable || selfTargetable) ? 0 : -1}
                                            aria-hidden={busy || (!targetable && !selfTargetable)}
                                            inert={busy || (!targetable && !selfTargetable) ? true : undefined}
                                            aria-label={`${a.name}, ${Math.max(0, a.hp)} of ${a.maxHp} health${unknownCombatant ? ". Unknown combatant portrait" : ""}${bossBarrierActive ? ". Barrier active" : ""}. ${targetable || selfTargetable ? `Select as target for ${armedActionName ?? "armed action"}` : "Not a valid target"}.`}
                                            title={`${a.name} ${a.hp}/${a.maxHp}`}
                                            onMouseEnter={a.side === "enemy" ? () => setHoverEnemyPos(a.pos) : undefined}
                                            onMouseLeave={a.side === "enemy" ? () => setHoverEnemyPos(null) : undefined}
                                            style={{ position: "absolute", left: ox, top: oy, width: size, zIndex: 10 + row, cursor: targetable || selfTargetable ? "pointer" : "default" }}>
                                            <BattlefieldActor
                                                side={a.side === "enemy" ? "enemy" : "player"}
                                                label={a.name}
                                                portrait={img}
                                                sprite={battleSprite}
                                                facing={spriteFacing}
                                                fallback={emojiFor(a)}
                                                style={{
                                                    width: size, height: size,
                                                    outline: isActive ? "3px solid #fde047" : targetable ? "3px solid var(--red-300)" : selfTargetable ? "3px solid #67e8f9" : "none",
                                                    outlineOffset: 2,
                                                    boxShadow: targetable ? "0 0 16px 4px rgba(248,113,113,0.9)" : selfTargetable ? "0 0 16px 4px rgba(34,211,238,0.85)" : undefined,
                                                }}>
                                                {isBoss && <span aria-hidden="true" style={{ position: "absolute", top: -2, right: -2, fontSize: 16, filter: "drop-shadow(0 1px 2px #000)" }}>👑</span>}
                                                {bossBarrierActive && <span className="tower-boss-barrier" aria-hidden="true" />}
                                                {unknownCombatant && <span className="tower-unknown-combatant-badge" aria-hidden="true">Unknown</span>}
                                            </BattlefieldActor>
                                            {/* name + hp bar */}
                                            <span style={{ display: "block", marginTop: 3, textAlign: "center", pointerEvents: "none" }}>
                                                <span style={{ display: "block", height: 4, width: size, borderRadius: 2, background: "rgba(2,6,18,0.85)", border: "1px solid rgba(0,0,0,0.5)" }}>
                                                    <span style={{ display: "block", width: `${pct}%`, height: "100%", borderRadius: 2, background: ringColor }} />
                                                </span>
                                                <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: "var(--slate-200)", textShadow: "0 1px 3px #000", whiteSpace: "nowrap", marginTop: 1 }}>
                                                    {a.name}{isBoss ? "" : ""}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}

                                {/* Server-authored combat VFX (cosmetic; see the stream above). */}
                                {combatVfx.map(renderCombatVfx)}
                            </div>
                        </div>
                    </div>

                    {/* Action bar — command bar + painted jutsu/weapon/item cards (the main combat UI) */}
                    <div className="tower-action-dock">
                        {/* AP / chakra / stamina readout + turn status */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: "#0b1220", border: "1px solid var(--slate-700)" }}>
                                <strong style={{ color: "var(--gold)", fontSize: "1rem", lineHeight: 1 }}>{myTurn ? session.activeAp : "—"}</strong>
                                <span style={{ color: "var(--text-dim)", fontSize: "0.68rem" }}>AP</span>
                                <span style={{ color: "var(--slate-600)" }}>·</span>
                                <span style={{ color: "var(--text-dim)", fontSize: "0.68rem" }}>{myTurn ? `${session.actionsThisTurn}/5` : "waiting"}</span>
                                <span style={{ color: "var(--slate-600)" }}>·</span>
                                <span title="Health" style={{ color: "#fb7185", fontSize: "0.7rem", fontWeight: 700 }}>♥ {Math.max(0, myActor?.hp ?? 0)}/{myActor?.maxHp ?? 0}</span>
                                <span title="Chakra" style={{ color: "var(--cyan)", fontSize: "0.7rem", fontWeight: 700 }}>◆ {myChakra}</span>
                                <span title="Stamina" style={{ color: "#a3e635", fontSize: "0.7rem", fontWeight: 700 }}>⬢ {myStamina}</span>
                            </span>
                        </div>

                        <div id="tower-action-guidance" className={`tower-action-state tower-action-state--${actionFeedback.phase}${targetingBlocked ? " tower-action-state--blocked" : ""}`} role={actionFeedback.phase === "error" ? "alert" : "status"} aria-live="polite" aria-busy={busy}>
                            <div>
                                <strong>{fightSyncState === "reconnecting" ? "Reconnecting to the Tower…"
                                    : actionFeedback.phase === "submitting" ? `Submitting ${actionFeedback.label}…`
                                    : actionFeedback.phase === "error" ? `${actionFeedback.label} was rejected`
                                    : targetingBlocked ? `${armedActionName ?? "Action"} has no legal target`
                                    : armedActionName ? `${armedActionName} armed`
                                    : !myTurn && session.status === "active" ? (turnLabel || "Waiting for the active fighter")
                                    : "Choose an action"}</strong>
                                <span>{fightSyncState === "reconnecting" ? "Showing the last confirmed battlefield. Actions remain available and the server will verify the current revision."
                                    : actionFeedback.phase === "error" ? reject
                                    : actionFeedback.phase === "submitting" ? "Waiting for the authoritative Tower result."
                                    : targetingHint || (!myTurn && session.status === "active"
                                        ? `${activeActor?.name ?? "Another fighter"} is acting. Your HUD and loadout remain available to inspect.`
                                        : "Select a command or inspect your sealed loadout.")}</span>
                            </div>
                            {(armedActionName || actionFeedback.phase === "error") && (
                                <button type="button" onClick={cancelAction} disabled={busy}>Cancel action</button>
                            )}
                        </div>

                        {/* Command bar */}
                        <div className="basic-action-bar shinobi-command-bar" style={myTurn ? undefined : { opacity: 0.65 }}>
                            <button className={mode === "attack" ? "selected-action" : ""}
                                aria-pressed={mode === "attack"} onClick={() => toggleMode("attack")}
                                disabled={!myTurn || busy || session.activeAp < attackAp}>
                                <span>Attack</span><small>{attackAp} AP | R1</small>
                            </button>
                            <button className={mode === "move" ? "selected-action" : ""}
                                aria-pressed={mode === "move"} onClick={() => toggleMode("move")}
                                disabled={!myTurn || busy || session.activeAp < moveAp}>
                                <span>Move</span><small>{moveAp} AP / tile</small>
                            </button>
                            <button className={mode === "dash" ? "selected-action" : ""}
                                aria-pressed={mode === "dash"} onClick={() => toggleMode("dash")}
                                disabled={!myTurn || busy || session.activeAp < moveAp}>
                                <span>Dash</span><small>3 tiles | {moveAp} AP</small>
                            </button>
                            <button onClick={() => void send({ type: "heal" })}
                                disabled={!myTurn || busy || healCd > 0 || myChakra < 10 || session.activeAp < utilityAp}>
                                <span>Heal</span><small>{utilityAp} AP | 10◆ | CD {healCd}</small>
                            </button>
                            <button className={mode === "clear" ? "selected-action" : ""}
                                aria-pressed={mode === "clear"} onClick={() => toggleMode("clear")}
                                disabled={!myTurn || busy || clearCd > 0 || session.activeAp < utilityAp}>
                                <span>Clear</span><small>{utilityAp} AP | CD {clearCd}</small>
                            </button>
                            <button onClick={() => void send({ type: "cleanse" })}
                                disabled={!myTurn || busy || cleanseCd > 0 || session.activeAp < utilityAp}>
                                <span>Cleanse</span><small>{utilityAp} AP | CD {cleanseCd}</small>
                            </button>
                            {(session.pendingCompanion || summonedCompanion) && (
                                <button
                                    onClick={() => void send({ type: "summon" })}
                                    disabled={!myTurn || busy || !session.pendingCompanion || !!summonedCompanion}
                                    title={summonedCompanion
                                        ? `${summonedCompanion.name} is already on the field`
                                        : `Summon ${session.pendingCompanion?.name ?? "your active pet"}`}
                                >
                                    <span>Summon Pet</span>
                                    <small>{summonedCompanion?.name ?? session.pendingCompanion?.name ?? "Active pet"}</small>
                                </button>
                            )}
                            <button onClick={() => void send({ type: "wait" })} disabled={!myTurn || busy}>
                                <span>End Turn</span><small>Pass</small>
                            </button>
                        </div>

                        {/* Jutsu / weapon / consumable cards */}
                        {arenaSuppressedGear && (
                            <p className="tower-arena-loadout-note" role="note">
                                Team Arena disables consumables and thrown ammunition. Reusable hand weapons remain available.
                            </p>
                        )}
                        {(myJutsu.length > 0 || actionWeapons.length > 0 || actionConsumables.length > 0) && (
                            <div className="jutsu-layout-card combat-jutsu-bar" style={{ marginTop: 8 }}>
                                <div className="combat-equipped-jutsu-grid" style={myTurn ? undefined : { opacity: 0.65 }}>
                                    {myJutsu.map(j => {
                                        const ck = Number(j.chakraCost ?? 0), st = Number(j.staminaCost ?? 0);
                                        const cd = Number(myActor?.cooldowns?.[j.id ?? ""] ?? 0);
                                        const armed = mode === "jutsu" && selJutsu?.id === j.id;
                                        const effectiveAp = adjustedActionAp(Number(j.ap ?? 40));
                                        const sealed = isElementallySealedForDisplay(myActor?.statuses, j.element, session.round);
                                        const afford = session.activeAp >= effectiveAp && myChakra >= ck && myStamina >= st && cd <= 0 && !sealed;
                                        const art = jutsuArt(j);
                                        return (
                                            <div key={j.id} className={`combat-jutsu-card-wrap${armed ? " selected-action" : ""}`}>
                                                <button type="button"
                                                    className={`combat-jutsu-button${armed ? " selected-action" : ""}${cd > 0 ? " jutsu-on-cooldown" : ""}`}
                                                    title={`${j.name ?? j.id} | ${effectiveAp} AP | R${j.range ?? 1}${ck ? ` | ${ck} CP` : ""}${st ? ` | ${st} SP` : ""}${sealed ? " | Elementally sealed" : ""}${cd > 0 ? ` | CD ${cd}` : ""}`}
                                                    aria-pressed={armed} onClick={() => armJutsuCard(j)} disabled={!myTurn || busy || !afford}>
                                                    <span className="combat-jutsu-thumb">{art ? <img src={art} alt={j.name ?? ""} /> : <strong>✨</strong>}</span>
                                                    <span className="combat-jutsu-name">{j.name ?? j.id}</span>
                                                    <span className="combat-jutsu-info">{effectiveAp} AP | R{j.range ?? 1} | CD {cd}</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {/* Weapon cards (green) — hand reusable, thrown spends a charge */}
                                    {actionWeapons.map(({ item: wp, thrown, range, left, cd }) => {
                                        const armed = mode === "weapon" && selWeaponId === wp.id;
                                        const ap = adjustedActionAp(Number(wp.apCost ?? 40));
                                        const out = thrown && left <= 0;
                                        return (
                                            <div key={wp.id} className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${armed ? " selected-action" : ""}`}>
                                                <button type="button"
                                                    className={`combat-jutsu-button combat-item-button${armed ? " selected-action" : ""}${cd > 0 ? " jutsu-on-cooldown" : ""}`}
                                                    title={`${wp.name ?? "Weapon"} | ${ap} AP | R${range}${thrown ? " | Thrown" : ""}${cd > 0 ? ` | CD ${cd}` : ""}`}
                                                    aria-pressed={armed} onClick={() => armWeaponCard(wp.id ?? "")}
                                                    disabled={!myTurn || busy || out || cd > 0 || session.activeAp < ap}>
                                                    <span className="combat-jutsu-thumb combat-item-thumb">{itemArt(wp) ? <img src={itemArt(wp)} alt={wp.name ?? ""} /> : <strong>🗡</strong>}</span>
                                                    <span className="combat-jutsu-name">{wp.name ?? "Weapon"}</span>
                                                    <span className="combat-jutsu-info">{ap} AP | R{range}{thrown ? ` | ×${left}` : ""} | CD {cd}</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {/* Consumable cards (red) — potions / combat items, used on self */}
                                    {actionConsumables.map(({ item: cs, left, cd }) => {
                                        const ap = adjustedActionAp(Number(cs.apCost ?? 35));
                                        return (
                                            <div key={cs.id} className="combat-jutsu-card-wrap combat-item-card-wrap combat-consumable-card">
                                                <button type="button" className={`combat-jutsu-button combat-item-button${cd > 0 ? " jutsu-on-cooldown" : ""}`}
                                                    title={`${cs.name ?? "Item"} | ${ap} AP | Use${cd > 0 ? ` | CD ${cd}` : ""}`}
                                                    onClick={() => void send({ type: "item", itemId: cs.id })}
                                                    disabled={!myTurn || busy || left <= 0 || cd > 0 || session.activeAp < ap}>
                                                    <span className="combat-jutsu-thumb combat-item-thumb">{itemArt(cs) ? <img src={itemArt(cs)} alt={cs.name ?? ""} /> : <strong>🧪</strong>}</span>
                                                    <span className="combat-jutsu-name">{cs.name ?? "Item"}</span>
                                                    <span className="combat-jutsu-info">{ap} AP | Use ×{left} | CD {cd}</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </main>

                {/* Enemy + log rail */}
                <aside style={{ minWidth: 0 }} aria-label={isTeamPvp ? "Rival Team and battle log" : "Enemies and battle log"}>
                    <RailHeader icon="👹" label={isTeamPvp ? "Rival Team" : "Enemies"} accent="var(--red-400)" />
                    {enemies.map(a => <ActorCard key={a.id} actor={a} round={session.round} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} boss={a.id === bossId} unknown={isUnknownCombatant(a)} />)}
                    <RailHeader icon="📜" label="Battle Log" accent="var(--text-dim)" mt={12} />
                    <div role="log" aria-live={isTeamPvp ? "off" : "polite"} aria-relevant="additions text" aria-label="Battle log" style={{ maxHeight: 220, overflow: "auto", fontSize: "0.74rem", lineHeight: 1.45, color: "var(--slate-300)", background: "rgba(2,6,18,0.55)", border: "1px solid var(--slate-800)", borderRadius: 8, padding: "6px 8px" }}>
                        {session.log.slice(-30).map((line, i) => <div key={i} style={{ padding: "1px 0", borderBottom: i < Math.min(29, session.log.length - 1) ? "1px solid rgba(30,41,59,0.5)" : undefined }}>{line}</div>)}
                    </div>
                    {isTeamPvp && (
                        <div className="tower-sr-only" role="status" aria-live="polite" aria-atomic="true">
                            {session.log[session.log.length - 1] ?? "The Team Arena match is ready."}
                        </div>
                    )}
                </aside>
            </div>

            {/* Result overlay */}
            {session.status === "done" && (isSpire && spireMeta ? (
                // ── Endless Spire — cinematic ascension result ──
                <div className="spire-result">
                    <div ref={resultDialogRef} className={`spire-result-card ${session.winner === "squad" ? "win" : "loss"}`}
                        role="dialog" aria-modal="true" aria-labelledby="tower-spire-result-title" tabIndex={-1}
                        style={{ ["--boss-accent" as string]: spireMeta.boss.accent, ["--boss-glow" as string]: spireMeta.boss.glow }}>
                        {bossPortrait && <img className="spire-result-portrait" src={bossPortrait} alt={spireMeta.boss.name} />}
                        <div className="spire-result-kicker">Floor {spireMeta.tier} · {spireMeta.boss.name}</div>
                        {session.winner === "squad" ? (
                            <>
                                <h1 id="tower-spire-result-title" className="spire-result-title win">Floor {spireMeta.tier} Ascended</h1>
                                {spireMeta.isMilestone && (
                                    <div className="spire-result-milestone">🏅 Title unlocked — <b>{spireMeta.milestoneTitle}</b></div>
                                )}
                                <div className="spire-result-rewards">
                                    {/* settle.results is keyed by the canonical ownerSlug (settle.ts),
                                        not the display name — look it up by meSlug, and only claim a
                                        banked/paid state once the member's result actually arrives. */}
                                    {settlement.response?.results[meSlug]
                                        ? <span className={`spire-reward-shard in${settlement.response.results[meSlug]!.paid ? "" : " muted"}`}>
                                            💠 {towerRewardReceiptText(settlement.response.results[meSlug]!, true)}
                                        </span>
                                        : <span className="spire-reward-shard pending">💠 {settlement.phase === "error" ? "Settlement paused" : "Settling…"}</span>}
                                </div>
                                {newlyRecordedTowerMilestones.map(milestone => (
                                    <p key={milestone} className="tower-result-milestone-receipt">{buildTowerMilestoneReceipt(milestone)}</p>
                                ))}
                                <p className="spire-result-sub">
                                    {spireMeta.tier < 20 ? <>Floor <b>{spireMeta.tier + 1}</b> now open.</> : <>The Spire is conquered — the apex is yours.</>}
                                </p>
                            </>
                        ) : (
                            <>
                                <h1 id="tower-spire-result-title" className="spire-result-title loss">Turned Back</h1>
                                <p className="spire-result-sub">The {spireMeta.boss.name} holds Floor {spireMeta.tier}. Regroup and climb again — retries are free.</p>
                            </>
                        )}
                        <TowerBattleDebrief session={session} score={mySettlementResult?.score} teamLabel={isTeamPvp ? "Team" : "Squad"} />
                        <SettlementStatusNotice state={settlement} required={shouldSettle} onRetry={() => void performSettlement()} primaryRef={!resultCanExit ? resultPrimaryRef : undefined} />
                        <button ref={resultCanExit ? resultPrimaryRef : undefined} className="spire-result-btn" onClick={exitResult} aria-disabled={!resultCanExit} disabled={!resultCanExit}
                            title={!resultCanExit ? "Confirm settlement before leaving so this result remains recoverable." : undefined}>
                            {session.winner === "squad" ? "▲ Return to the Spire" : "↺ Back to the Spire"}
                        </button>
                    </div>
                </div>
            ) : (
                // ── Story floors — the original result card ──
                <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,14,0.82)" }}>
                    <div ref={resultDialogRef} className="card" role="dialog" aria-modal="true" aria-labelledby="tower-story-result-title" tabIndex={-1}
                        style={{ textAlign: "center", padding: "1.6rem", maxWidth: 420 }}>
                        {!isTeamPvp && (sealedStoryFloor?.name || sealedStoryFloor?.chapterTitle) ? (
                            <div className="tower-story-result-kicker">
                                {sealedStoryFloor.chapterTitle ? `${sealedStoryFloor.chapterTitle} · ` : ""}{sealedStoryFloor.name ?? `Floor ${session.floor}`}
                            </div>
                        ) : null}
                        <h1 id="tower-story-result-title" style={{ marginTop: 0, color: session.winner === "squad" ? "var(--green-400)" : session.winner === "draw" ? "var(--gold)" : "var(--red-400)" }}>
                            {isTeamPvp
                                ? session.winner === "squad" ? "🏆 Team Victory" : session.winner === "draw" ? "⚖ Match Draw" : "Team Defeat"
                                : session.winner === "squad" ? `🏆 Floor ${session.floor} Cleared` : `💀 Floor ${session.floor} Failed`}
                        </h1>
                        <TowerBattleDebrief session={session} score={mySettlementResult?.score} teamLabel={isTeamPvp ? "Team" : "Squad"} />
                        {isTeamPvp && <p className="hint">Competitive exhibition complete · no rating, currency, items, or progression rewards.</p>}
                        {!isTeamPvp && session.winner === "squad" && (
                            settlement.response?.results[meSlug]
                                ? <p>{towerRewardReceiptText(settlement.response.results[meSlug]!, false)}</p>
                                : <p className="hint">{settlement.phase === "error" ? "Reward settlement paused." : "Settling rewards…"}</p>
                        )}
                        {newlyRecordedTowerMilestones.map(milestone => (
                            <p key={milestone} className="tower-result-milestone-receipt">{buildTowerMilestoneReceipt(milestone)}</p>
                        ))}
                        <SettlementStatusNotice state={settlement} required={shouldSettle} onRetry={() => void performSettlement()} primaryRef={!resultCanExit ? resultPrimaryRef : undefined} />
                        <button ref={resultCanExit ? resultPrimaryRef : undefined} style={{ marginTop: 12, padding: "0.7rem 1.4rem" }} onClick={exitResult}
                            aria-disabled={!resultCanExit} disabled={!resultCanExit}
                            title={!resultCanExit ? "Confirm settlement before leaving so this result remains recoverable." : undefined}>
                            {isTeamPvp ? "Return to Team Arena" : "Return to the Tower"}
                        </button>
                    </div>
                </div>
            ))}
        </CombatInstance>
    );
}

// ── Tile fill (feature tint + state highlight) ───────────────────────────────
function SettlementStatusNotice({ state, required, onRetry, primaryRef }: { state: SettlementState; required: boolean; onRetry: () => void; primaryRef?: RefObject<HTMLButtonElement | null> }) {
    if (!required || state.phase === "settled") return null;
    if (state.phase === "error") {
        return (
            <div className="tower-settlement-status tower-settlement-status--error" role="alert">
                <strong>Settlement was not confirmed</strong>
                <span>{state.message ?? "The server did not confirm this receipt."} Your completed run is still saved.</span>
                <button ref={primaryRef} type="button" onClick={onRetry}>Retry settlement</button>
            </div>
        );
    }
    return (
        <div className="tower-settlement-status" role="status" aria-live="polite">
            <strong>{state.attempts > 1 ? `Retrying settlement (attempt ${state.attempts})…` : "Finalizing the run receipt…"}</strong>
            <span>Keep this result open until the server confirms it.</span>
        </div>
    );
}

function tileFill(
    feat: TowerFeature | undefined,
    s: { isMove: boolean; inJ: boolean; isGoal: boolean; isBlocked: boolean },
): { background: string; borderColor: string; boxShadow?: string } {
    // Top-lit → dark-bottom gradient gives each hex a raised, beveled 3D look.
    const g = (top: string, bot: string) => `linear-gradient(180deg, ${top} 0%, ${bot} 100%)`;
    if (s.isMove) return { background: g("rgba(196,255,150,0.8)", "rgba(45,120,28,0.62)"), borderColor: "#bef264" };
    if (s.inJ) return { background: g("rgba(147,197,253,0.62)", "rgba(29,78,216,0.55)"), borderColor: "var(--blue-400)" };
    if (s.isBlocked) return { background: g("rgba(120,130,150,0.62)", "rgba(30,38,56,0.72)"), borderColor: "rgba(148,163,184,0.5)" };
    if (feat) {
        if (feat.kind === "pylon") {
            const c = PYLON_COLOR[feat.element] ?? PYLON_COLOR.Water!;
            return { background: g(c.top, c.bot), borderColor: c.border };
        }
        if (feat.kind === "ward") return { background: g("rgba(226,232,240,0.6)", "rgba(71,85,105,0.64)"), borderColor: "rgba(226,232,240,0.9)" };
        if (feat.kind === "hazard") return { background: g("rgba(254,160,120,0.68)", "rgba(127,29,29,0.68)"), borderColor: "rgba(248,113,113,0.95)" };
    }
    if (s.isGoal) return { background: g("rgba(253,224,71,0.62)", "rgba(133,77,14,0.62)"), borderColor: "var(--gold)" };
    // Default tile: muted grass-green top → dark forest base, matching the arena floor.
    // Translucent so the grass shows through; the dark hex outline (CSS) keeps it visible.
    return { background: g("rgba(126,162,96,0.42)", "rgba(20,38,18,0.6)"), borderColor: "rgba(60,80,45,0.6)" };
}
function featureIcon(feat: TowerFeature): string {
    if (feat.kind === "pylon") return ELEMENT_ICON[feat.element] ?? "🔆";
    if (feat.kind === "ward") return "🛡️";
    return "⚠️";
}
function featureLabel(feat: TowerFeature): string {
    if (feat.kind === "pylon") return `${feat.label ?? "Pylon"}: +${feat.percent}% ${feat.element} / −${feat.percent}% ${feat.weakenElement} (attacking from here)`;
    if (feat.kind === "ward") return `${feat.label ?? "Ward"}: −${feat.percent}% damage taken while standing here`;
    return `${feat.label ?? "Hazard"}: ${feat.percent}% max HP if you end the round here`;
}

function ActorCard({ actor, round, highlight, avatar, emoji, boss, ally, unknown }: { actor: TowerActor; round: number; highlight: boolean; avatar: string | null; emoji: string; boss?: boolean; ally?: boolean; unknown?: boolean }) {
    const pct = Math.max(0, Math.min(100, (actor.hp / Math.max(1, actor.maxHp)) * 100));
    const dead = actor.hp <= 0;
    const accent = actor.side === "squad" ? "var(--green-400)" : actor.side === "npc" ? "var(--gold)" : "var(--red-400)";
    const visibleStatuses = activeCombatDisplayStatuses(actor.statuses, round);
    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 7px", marginBottom: 5, borderRadius: 6, background: highlight ? "#15233b" : "rgba(11,18,32,0.7)", border: `1px solid ${highlight ? "var(--blue-400)" : "var(--slate-800)"}`, opacity: dead ? 0.4 : 1 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220" }}>
                {avatar ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span className={unknown ? "tower-unknown-combatant" : undefined} aria-label={unknown ? UNKNOWN_TOWER_COMBATANT.label : undefined} style={{ fontSize: 15 }}>{emoji}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", gap: 4 }}>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boss ? "👑 " : ally ? "🛡️ " : ""}{actor.name}{ally ? " (protect)" : ""}</strong>
                    <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{Math.max(0, actor.hp)}/{actor.maxHp}</span>
                </div>
                <div style={{ height: 5, background: "#0b1220", borderRadius: 3, marginTop: 3 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: dead ? "var(--slate-600)" : accent }} />
                </div>
                {actor.side === "squad" && (
                    <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        <MiniBar val={actor.chakra} max={actor.maxChakra} color="var(--cyan)" />
                        <MiniBar val={actor.stamina} max={actor.maxStamina} color="#a3e635" />
                    </div>
                )}
                {visibleStatuses.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 3 }}>
                        {visibleStatuses.slice(0, 8).map((st, i) => <StatusChip key={i} status={st} />)}
                    </div>
                )}
                {unknown && <span className="tower-unknown-combatant-label">Unknown combatant art</span>}
            </div>
        </div>
    );
}

// Short, color-coded badge for a buff/debuff/DoT on an actor card (green = positive,
// red = negative). Full name + percent/turns on hover.
const STATUS_ABBR: Record<string, string> = {
    "Increase Damage Given": "+DMG", "Decrease Damage Given": "−DMG",
    "Increase Damage Taken": "+VULN", "Decrease Damage Taken": "−VULN",
    "Increase Heal": "+HEAL", "Lifesteal": "LIFE", "Reflect": "RFLCT", "Absorb": "ABSRB",
    "Poison": "PSN", "Wound": "BLEED", "Drain": "DRAIN", "Stun": "STUN", "Stunned": "STUN",
    "Shield": "SHLD", "Barrier": "WALL", "Bloodline Seal": "BL-SEAL", "Elemental Seal": "EL-SEAL",
    "Buff Prevent": "NO-BUFF", "Debuff Prevent": "WARD", "Recoil": "RECOIL", "Ignition": "IGNITE",
};
function StatusChip({ status }: { status: TowerStatus }) {
    const positive = status.kind === "positive";
    const label = STATUS_ABBR[status.name] ?? status.name.slice(0, 5).toUpperCase();
    const detail = `${status.name}${status.percent ? ` ${status.percent}%` : ""}${status.rounds ? ` · ${status.rounds} turn${status.rounds !== 1 ? "s" : ""}` : ""}`;
    return (
        <span title={detail} style={{
            fontSize: 8, fontWeight: 800, padding: "0 3px", borderRadius: 3, lineHeight: "12px", letterSpacing: 0.2,
            color: positive ? "#bbf7d0" : "#fecaca",
            background: positive ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)",
            border: `1px solid ${positive ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
        }}>{label}</span>
    );
}

/** Thin chakra / stamina bar under a squad card's HP bar. */
function MiniBar({ val, max, color }: { val: number; max: number; color: string }) {
    const pct = Math.max(0, Math.min(100, (val / Math.max(1, max)) * 100));
    return (
        <div style={{ flex: 1, height: 3, background: "#0b1220", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: color }} />
        </div>
    );
}

function RailHeader({ icon, label, accent, mt }: { icon: string; label: string; accent: string; mt?: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 7, margin: `${mt ?? 0}px 0 8px`, padding: "5px 8px", borderRadius: 7, background: "rgba(15,23,42,0.65)", borderLeft: `3px solid ${accent}` }}>
            <span style={{ fontSize: 15 }} aria-hidden="true">{icon}</span>
            <strong style={{ fontSize: "0.88rem", letterSpacing: 0.3 }}>{label}</strong>
        </div>
    );
}
