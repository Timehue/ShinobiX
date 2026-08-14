import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "../styles/battle-skin.css";
import "../styles/mission-arena-fight.css";
import { CombatInstance } from "../components/CombatInstance";
import type { StoryFightTheme } from "../lib/story-fight-theme";
import { playStoryChapterSting, playStoryFinalPhaseSting, playStoryVictorySting, primeStorySfx } from "../lib/story-sfx";
import { buildActionsFromTowerLog, makeBattleEntry } from "../lib/battle-log-history";
import { SparCoach } from "../components/SparCoach";
import { GiBoxingGlove, GiCrossedSwords, GiEyeball, GiFireSpellCast, GiTargeted, GiHealthPotion, GiBriefcase,
    // Command-deck glyphs (one per basic action), matching Arena + PvP.
    GiBootPrints, GiHealing, GiMagicSwirl, GiWaterDrop, GiRun, GiSandsOfTime, GiPawPrint } from "react-icons/gi";
import type { Character, BattleHistoryEntry } from "../types/character";
import type {
    ServerArenaAction,
    ServerArenaSession,
    ServerArenaStatus,
    ServerArenaTransport,
} from "../lib/server-arena-runtime";
import { presentSoloActionRejection } from "../lib/solo-action-rejection";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, HEX_W, HEX_H,
} from "../lib/tower-grid";
import { useBoardScale } from "../lib/use-board-scale";
import { useBattleTabs } from "../lib/use-battle-tabs";
import { CombatSideHud } from "../components/CombatSideHud";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import { BattleTabBar } from "../components/BattleTabBar";
import {
    CombatApPanel,
    CombatCommandBar,
    CombatEnvironmentStrip,
    CombatHudHeader,
    CombatHudLayout,
    CombatHudMain,
    PlainCombatBattleLog,
} from "../components/CombatHudLayout";
import { CombatJutsuMeta } from "../components/CombatJutsuMeta";
import { adjustedCombatApCost } from "../lib/combat-action-display";
import { FighterHpBadge } from "../components/FighterHpBadge";
import { BattlefieldActor } from "../components/BattlefieldActor";
import { isImageAvatar } from "../lib/avatar";
import { battlefieldAiSprite } from "../lib/battlefield-actor-art";
import { resolveOwnAvatar } from "../lib/own-avatar";
import { petCardImage, petStripVariant } from "../lib/pet-battle-anim";
import { firstSharedImage, petVisualVariantClass, variantImageKeys } from "../lib/pet-visual-variant";
import { getAllJutsus } from "../App";
import { getAllItems } from "../lib/items";
import type { Pet } from "../types/pet";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";

// The board token is a CIRCULAR orb (same treatment as the player/enemy), so the
// pet's PORTRAIT is the right art. petCardImage reaches for the un-clipped
// FULL-BODY battle sprite (`petbody:` / bodyImage) first — that's built for the
// Pet Arena and reads wrong clipped into a circle. Prefer the portrait (`pet:` /
// pet.image), then fall back to petCardImage so portrait-less starters still show
// their baked idle pose instead of bare initials.
function petOrbPortrait(pet: Pet, shared: Record<string, string>): string {
    return firstSharedImage(shared, variantImageKeys("pet:", pet, [pet.id, petStripVariant(pet.id)]))
        || pet.image
        || petCardImage(pet, shared);
}
import { biomeLabel } from "../data/world";
import { equipSlotForItem } from "../lib/equipment";
import { tagMatchesName } from "../lib/tags";
import { hollowGateCombatDirective } from "../../../shared/hollow-gate-combat-director";
import type { HollowGateHoundKind } from "../../../shared/hollow-gate-contract";

// ─── Solo Arena Fight (missions + story bosses) ───────────────────────────────
// Renders any server-authoritative solo 1v1 session using
// the SAME shell as the normal Arena PvE duel — CombatSideHud dossiers, the
// arena-top-panel header, the dual-AP bar, the identical 12×10 hex board, and the
// basic-action-bar + jutsu/item cards — instead of the tactical "Battle Tower"
// rail layout. The fight is still resolved 100% server-side: every button submits
// an intent through the selected runtime transport and reflects returned state; nothing is
// computed on the client. This closes the "combat looks like an older PvP model"
// gap while keeping the reward-integrity guarantee (the reward is settled on a
// completed server session, not a client-attested outcome).
//
// TWO callers share this screen because their fights are structurally identical
// (all adapt their authority into the presentation-only ServerArenaSession):
//   • Missions (Missions.tsx) — settles via /api/missions/queue-combat-claim.
//   • Story bosses (StoryBossFightHost.tsx) — settles via /api/story/settle and
//     passes `storyTheme` (backdrop/chapter label/boss barks) + a `renderResult`
//     that shows the chapter-reward card. Story presentation is display-only —
//     it never touches stats, damage, or rewards. When `storyTheme` is absent the
//     screen behaves byte-identically to the original mission-only version.
//
// The board geometry is byte-identical to Arena.tsx (HEX_W/HEX_H, odd-q offset,
// 12 wide × 10 tall, ORB 52), so the tiles/orbs line up exactly with the arena
// skin's CSS. A solo fight is always 1v1 (one player vs one boss), so there is no
// squad rail, pylons, hazards, or spire chrome to draw.

type Mode = "idle" | "move" | "attack" | "jutsu" | "weapon" | "clear";
type JutsuLike = { id?: string; name?: string; type?: string; element?: string; target?: string; ap?: number; range?: number; method?: string; cooldown?: number; chakraCost?: number; staminaCost?: number; image?: string; tags?: Array<{ name?: string }> };
type ItemLike = { id?: string; name?: string; slot?: string; rarity?: string; image?: string; weaponRange?: number; apCost?: number };

const ORB = 52;             // matches Arena.tsx ORB — orbs centre over the hex
const ATTACK_AP = 40, MOVE_AP = 30, UTILITY_AP = 60, MAX_ACTIONS = 5;

// Which jutsu school the biome's +10% terrain buff favors (mirrors the server's
// combat-core terrainMultiplier), for the terrain strip readout.
const BIOME_SCHOOL: Record<string, string> = { forest: "Taijutsu", snow: "Bukijutsu", volcano: "Ninjutsu", shadow: "Genjutsu" };

// A Move-tagged jutsu (Flicker) repositions the caster; normalizeJutsu forces its
// target to EMPTY_GROUND, so valid destinations are OPEN tiles like a plain move.
function isMoveJutsu(j: JutsuLike | null | undefined): boolean {
    return Boolean(j) && Array.isArray(j!.tags) && j!.tags.some(t => tagMatchesName(t?.name ?? "", "Move"));
}
const isSelfCastJutsu = (j: JutsuLike | null | undefined) => Boolean(j) && j!.target === "SELF";

// Runtime status → CombatSideHud status shape (it requires an explicit kind).
function hudStatuses(statuses: ServerArenaStatus[] | undefined): { name: string; source?: string; rounds: number; amount?: number; percent?: number; kind: "positive" | "negative" }[] {
    return (statuses ?? []).map((s) => ({
        name: s.name,
        source: s.source,
        rounds: s.rounds,
        amount: s.amount,
        percent: s.percent,
        kind: s.kind === "negative" ? "negative" : "positive",
    }));
}

export function MissionArenaFight({
    character,
    sharedImages,
    runId,
    initialSession,
    missionName,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    settleFn,
    onExit,
    storyTheme,
    coach,
    renderResult,
    transport,
    settleOnAnyDone,
    outcomeFn,
    onRecordBattle,
    recordMode,
    enemyAvatarOverride,
    hollowGate,
    retreatSealed,
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    runId: string;
    initialSession: ServerArenaSession;
    /** Mission label (e.g. "C-Rank Patrol") shown on the result banner. */
    missionName?: string;
    /** The player's own jutsu catalog — the SEALED session's jutsu carry combat
     *  fields but NO art, so card thumbnails resolve from here by id. */
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    /** Settle the server-authoritative outcome on a win (missions queue the claim,
     *  story pays the chapter reward). Its resolved value is handed to renderResult. */
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    onExit: () => void;
    /** Story-boss presentation (display-only — never touches stats or rewards):
     *  chapter backdrop art, a chapter label, and boss "barks" spoken at fight
     *  start and as the boss's HP falls. See lib/story-fight-theme.ts. */
    storyTheme?: StoryFightTheme;
    /**
     * In-battle tutorial coaching. `"academySpar"` renders the SparCoach banner
     * — the same read-only "use Basic Attack → now a jutsu → press Wait" hints
     * the local Arena spar shows. Without it the sealed spar (step 5 of the
     * AI-fight migration) would be the one fight in the game where a brand-new
     * player gets no guidance, because the coaching lived in Arena.tsx only.
     */
    coach?: "academySpar";
    /** Optional result-overlay override. When provided it fully replaces the
     *  built-in mission result card — the story lane uses this to show its own
     *  chapter-reward / defeat card. Absent → the mission card renders as before. */
    renderResult?: (ctx: {
        won: boolean;
        draw: boolean;
        settleState: "idle" | "pending" | "settled" | "failed";
        settleResult: unknown;
        retry: () => void;
        onExit: () => void;
    }) => ReactNode;
    /** Explicit runtime boundary. The Arena shell only renders returned state. */
    transport: ServerArenaTransport;
    /** Settle on ANY resolution, not just a squad win — the Weekly Boss banks damage
     *  on a knockout, and the Anbu raid reports win OR loss. Default (unset) keeps the
     *  mission/story rule of settling only on a win. */
    settleOnAnyDone?: boolean;
    /** Record the fight to Profile → Battles when it resolves (win or loss). */
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    /** Human label for the recorded battle's mode (e.g. "Anbu Vault"). Default "Duel". */
    recordMode?: string;
    /** Force the enemy's portrait (dossier + bark face). Used when the correct art
     *  isn't sealed into the session or published under `ai:<visual>` — e.g. the story
     *  boss's authored chapter portrait, or the Anbu defender's masked art. Falls
     *  through to the sealed avatar / published art / initials when absent. */
    enemyAvatarOverride?: string;
    /** Display-only shrine direction. Damage, hazards, and retreat are enforced by the returned Solo PvE session. */
    hollowGate?: { floor: number; kind: HollowGateHoundKind };
    retreatSealed?: boolean;
    /**
     * Report the fight's PHYSICAL cost — surviving HP, and the hospital stay on a
     * defeat or a forfeit (lib/pve-outcome-api). Separate from `settleFn`, which
     * is the REWARD and refuses a losing run by design; without this a lost
     * server fight costs nothing and can be retried instantly at full HP.
     *
     * Fires on any terminal resolution, including a successful flee. The fight
     * hosts separately protect forced/unresolved closes from becoming a free
     * escape hatch. Opt-in: modes that do not pass it are unchanged.
     */
    outcomeFn?: (runId: string, playerName: string) => Promise<unknown>;
}) {
    const [session, setSession] = useState<ServerArenaSession>(initialSession);
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [selWeaponId, setSelWeaponId] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [reject, setReject] = useState<string | null>(null);
    const settledRef = useRef(false);
    // Settlement of a WON run is what actually mints the durable server-side
    // claim token (api/missions/queue-combat-claim). Until it lands, the Mission
    // Hall has nothing to claim — so the result banner must not tell the player
    // the reward is waiting, and must not offer a clean exit, while it is still
    // in flight or has failed. See the retry loop below.
    const [settleState, setSettleState] = useState<"idle" | "pending" | "settled" | "failed">("idle");
    // The resolved settle value (handed to renderResult so the story lane can show
    // its reward breakdown). Mission callers ignore it (they claim later in the Hall).
    const [settleResult, setSettleResult] = useState<unknown>(null);

    // Tutorial coaching progress (display-only — see the `coach` prop).
    const [sparAttacked, setSparAttacked] = useState(false);
    const [sparCasted, setSparCasted] = useState(false);

    // ── Story presentation (display-only): the boss speaks its own authored VN
    // lines at fight start / 2⁄3 / 1⁄3 HP and its last words on the killing blow;
    // the mentor cuts in when the PLAYER is hurting; the last-stand threshold adds a
    // vignette + sting. One bubble at a time, ~6s. Ported from BattleTowerFight so
    // the story flavor is preserved on the arena shell. All gated on `storyTheme`.
    const [bark, setBark] = useState<{ name: string; text: string; side: "boss" | "ally" } | null>(null);
    const barkStageRef = useRef(0);
    const allyStageRef = useRef(0);
    const barkTimerRef = useRef(0);
    const stingRef = useRef({ opened: false, finalPhase: false, victory: false });

    const me = character.name;
    const meSlug = me.toLowerCase();
    const ownedByMe = (slug: string | null) => !!slug && slug.toLowerCase() === meSlug;

    const w = session.map.width, h = session.map.height;
    const layer = useMemo(() => towerLayerSize(w, h), [w, h]);
    const { battlefieldCallbackRef, boardContainerSize, effectiveScale } = useBoardScale(layer.width, layer.height);
    const tabs = useBattleTabs(session.log?.length ?? 0);

    const activeId = session.turnQueue[session.activeIndex];
    const activeActor = session.actors.find(a => a.id === activeId);
    // A summoned pet is ALSO a squad-side actor, so every "my fighter" lookup must
    // exclude it — otherwise the HUD/targeting could latch onto the pet.
    const isCompanion = (a: { character?: Record<string, unknown> }) => a.character?.companion === true;
    const myActor = session.actors.find(a => a.side === "squad" && !isCompanion(a) && ownedByMe(a.ownerSlug))
        ?? session.actors.find(a => a.side === "squad" && !isCompanion(a)) ?? null;
    const companion = session.actors.find(a => a.side === "squad" && isCompanion(a)) ?? null;
    const enemy = session.actors.find(a => a.side === "enemy") ?? null;
    const myTurn = session.status === "active" && !!activeActor && activeActor.ai === false && ownedByMe(activeActor.ownerSlug) && activeActor.hp > 0;
    const enemyActive = !!activeActor && activeActor.side === "enemy";

    const myPos = myActor?.pos ?? -1;
    const enemyPos = enemy?.pos ?? -1;
    const biome = String(session.map.biome ?? "central");
    const gateFloor = hollowGate?.floor;
    const gateKind = hollowGate?.kind;
    const gateEnemyHp = enemy?.hp;
    const gateEnemyMaxHp = enemy?.maxHp;
    const hasGateCombatants = !!hollowGate && !!enemy && !!myActor;
    const gateDirective = hasGateCombatants && gateFloor != null && gateKind && gateEnemyHp != null && gateEnemyMaxHp != null ? hollowGateCombatDirective({
        floor: gateFloor,
        kind: gateKind,
        turn: session.round,
        enemyHp: gateEnemyHp,
        enemyMaxHp: gateEnemyMaxHp,
        playerPos: myPos,
        enemyPos,
        gridWidth: w,
        gridHeight: h,
    }) : null;
    const gateHazards = new Set(gateDirective?.hazardTiles ?? []);
    const gateSafe = new Set(gateDirective?.safeTiles ?? []);

    // Reconnect: always pull the latest revision once after mounting.
    useEffect(() => {
        transport.fetchState(runId, me).then(setSession).catch(() => {});
    }, [runId, me, transport]);

    // While it is NOT our turn, poll so we see the enemy's moves and learn the
    // instant it is our turn again. A poll also nudges the server's AFK auto-pass.
    useEffect(() => {
        if (session.status !== "active" || myTurn) return;
        let alive = true;
        const id = setInterval(() => {
            if (document.visibilityState === "hidden") return;
            transport.fetchState(runId, me).then(s => { if (alive) setSession(s); }).catch(() => {});
        }, 2500);
        return () => { alive = false; clearInterval(id); };
    }, [session.status, myTurn, runId, me, transport]);

    // Auto-settle the win (queue the claim). Losses/draws pay nothing — the run
    // just resolves and the player exits back to the Mission Hall.
    //
    // This call is load-bearing: it is the ONLY thing that mints the durable
    // claim token the Mission Hall's "Claim Reward" needs. Swallowing its error
    // used to leave the player looking at "Return to the Mission Hall to claim
    // your reward" with no reward queued anywhere. Retry a few times with
    // backoff, then surface the failure and keep a manual retry available.
    const runSettle = useCallback(async () => {
        setSettleState("pending");
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const result = await settleFn(runId, me);
                setSettleResult(result);
                setSettleState("settled");
                return;
            } catch {
                if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
            }
        }
        setSettleState("failed");
    }, [runId, me, settleFn]);

    useEffect(() => {
        const done = session.status === "done";
        // Missions/story settle only on a win; Weekly Boss (score-attack) and the
        // Anbu raid pass settleOnAnyDone to settle on any resolution.
        const shouldSettle = settleOnAnyDone ? done : (done && session.winner === "squad");
        if (shouldSettle && !settledRef.current) {
            settledRef.current = true;
            void runSettle();
        }
    }, [session.status, session.winner, runSettle, settleOnAnyDone]);

    // The fight's physical cost, reported on ANY resolution — including the
    // losses `settleFn` refuses. Fire-and-forget: it grants nothing, so a failure
    // must never block the result screen or a reward already earned.
    const outcomeReportedRef = useRef(false);
    useEffect(() => {
        if (session.status !== "done" || outcomeReportedRef.current || !outcomeFn) return;
        outcomeReportedRef.current = true;
        void outcomeFn(runId, me).catch(() => { /* the run simply costs nothing */ });
    }, [session.status, runId, me, outcomeFn]);

    // Reflection log (display-only): record the fight once it resolves (win OR loss)
    // so it shows on Profile → Battles. De-duped by runId, so a refresh on the result
    // screen re-records harmlessly. Mirrors BattleTowerFight's recorder.
    const recordedRef = useRef(false);
    useEffect(() => {
        if (session.status !== "done" || recordedRef.current || !onRecordBattle) return;
        recordedRef.current = true;
        const allyNames = session.actors.filter(a => a.side === "squad" || a.side === "npc").map(a => a.name);
        const enemyNames = session.actors.filter(a => a.side === "enemy").map(a => a.name);
        const outcome: BattleHistoryEntry["outcome"] = session.winner === "squad" ? "win" : session.winner === "draw" ? "draw" : "loss";
        onRecordBattle(makeBattleEntry({
            id: `arena-${runId}`,
            ts: Date.now(),
            mode: recordMode ?? "Duel",
            opponent: enemyNames[0] ?? "Enemy",
            outcome,
            rounds: session.round ?? 1,
            self: me,
            actions: buildActionsFromTowerLog(session.log ?? [], allyNames, enemyNames),
        }));
        // Fire once on resolve; recordedRef makes later session updates no-ops.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.status]);

    // ── Story flavor: the boss (enemy) speaks at fight start / 2⁄3 / 1⁄3 HP and on
    // the killing blow; the mentor cuts in when the PLAYER is hurting. Display-only.
    const storyDone = session.status === "done";
    const storyBossHpFrac = enemy ? Math.max(0, enemy.hp) / Math.max(1, enemy.maxHp) : 1;
    const storySelfHpFrac = myActor ? Math.max(0, myActor.hp) / Math.max(1, myActor.maxHp) : 1;
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
        const bossName = storyTheme.bossName || enemy?.name || "???";
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
    }, [storyTheme, storyBossHpFrac, storySelfHpFrac, storyDone, session.winner, enemy?.name]);
    useEffect(() => {
        if (storyFinalPhase && !stingRef.current.finalPhase) {
            stingRef.current.finalPhase = true;
            playStoryFinalPhaseSting();
        }
    }, [storyFinalPhase]);
    useEffect(() => () => window.clearTimeout(barkTimerRef.current), []);

    // ── Loadout: jutsu + equipped weapons/consumables from the sealed fighter ──
    // Plain derivations (the React Compiler auto-memoizes the component); the
    // board is a small 1v1 so recomputing per render is cheap.
    const loadout = (() => {
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
    })();
    const { weapons: myWeapons, consumables: myConsumables } = loadout;
    const myJutsu: JutsuLike[] = Array.isArray(myActor?.character?.jutsu) ? (myActor!.character.jutsu as JutsuLike[]) : [];

    const myAp = myTurn ? session.activeAp : 0;
    const actionsUsed = myTurn ? session.actionsThisTurn : 0;
    const outOfActions = actionsUsed >= MAX_ACTIONS;
    const myChakra = myActor?.chakra ?? 0;
    const healCd = Number(myActor?.cooldowns?.basicHeal ?? 0);
    const clearCd = Number(myActor?.cooldowns?.clear ?? 0);
    const cleanseCd = Number(myActor?.cooldowns?.cleanse ?? 0);
    const enemyInMelee = myPos >= 0 && enemyPos >= 0 && towerHexDistance(myPos, enemyPos, w) <= 1;

    const armedWeapon = mode === "weapon" ? myWeapons.find(x => x.item.id === selWeaponId) : undefined;
    const weaponRange = armedWeapon?.range ?? 1;

    // Whether the (single) enemy is reachable by the currently-armed action.
    const enemyInRange = (() => {
        if (!enemy || enemy.hp <= 0 || myPos < 0) return false;
        const range = mode === "clear" ? Infinity : mode === "jutsu" ? Math.max(1, Number(selJutsu?.range ?? 1)) : mode === "weapon" ? weaponRange : 1;
        return towerHexDistance(myPos, enemy.pos, w) <= range;
    })();

    // Adjacent open tiles for a plain Move.
    const moveTiles = (() => {
        if (mode !== "move" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        const blocked = new Set(session.map.blockedTiles);
        return new Set(towerNeighbors(myPos, w, h).filter(t => !occupied.has(t) && !blocked.has(t)));
    })();

    // Reach highlight for an armed jutsu/weapon (or Flicker landing tiles).
    const rangeTiles = (() => {
        if (!myActor) return new Set<number>();
        if (mode === "jutsu") {
            const inRange = towerTilesInRange(myPos, Math.max(1, Number(selJutsu?.range ?? 1)), w, h);
            if (isMoveJutsu(selJutsu)) {
                const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
                const blocked = new Set(session.map.blockedTiles);
                return new Set([...inRange].filter(t => t !== myPos && !occupied.has(t) && !blocked.has(t)));
            }
            return inRange;
        }
        if (mode === "weapon") return towerTilesInRange(myPos, weaponRange, w, h);
        return new Set<number>();
    })();

    async function send(action: ServerArenaAction) {
        if (busy) return;
        setBusy(true); setReject(null);
        try {
            const res = await transport.submitAction(runId, me, session, action);
            setSession(res.session);
            if (res.applied) {
                // Display-only tutorial progress follows authoritative success;
                // an out-of-range or otherwise rejected attempt keeps its lesson.
                if (action.type === "attack") setSparAttacked(true);
                if (action.type === "jutsu") setSparCasted(true);
            } else {
                setReject(presentSoloActionRejection(res.reason));
            }
        } catch (e) {
            setReject(presentSoloActionRejection(String((e as Error)?.message ?? e)));
        } finally {
            setBusy(false);
            setMode("idle"); setSelJutsu(null); setSelWeaponId("");
        }
    }

    function resetTargeting() { setMode("idle"); setSelJutsu(null); setSelWeaponId(""); }

    function onTileClick(tile: number) {
        if (!myTurn || busy) return;
        if (mode === "move" && moveTiles.has(tile)) { void send({ type: "move", tile }); return; }
        // Ground-target jutsu → place the zone on a non-blocked tile in range.
        if (mode === "jutsu" && selJutsu?.id && selJutsu.target === "EMPTY_GROUND" && rangeTiles.has(tile) && !session.map.blockedTiles.includes(tile)) {
            void send({ type: "jutsu", jutsuId: selJutsu.id, tile }); return;
        }
        // Self-cast jutsu → click your OWN ninja.
        if (mode === "jutsu" && selJutsu?.id && isSelfCastJutsu(selJutsu) && myActor && tile === myPos) {
            void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: myActor.id }); return;
        }
        // Otherwise this is an offensive click on the enemy's tile.
        if (enemy && enemy.hp > 0 && tile === enemyPos && enemyInRange) {
            if (mode === "attack") void send({ type: "attack", targetId: enemy.id });
            else if (mode === "weapon" && selWeaponId) void send({ type: "weapon", targetId: enemy.id, itemId: selWeaponId });
            else if (mode === "clear") void send({ type: "clear", targetId: enemy.id });
            else if (mode === "jutsu" && selJutsu?.id) void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: enemy.id });
        }
    }

    function armJutsu(j: JutsuLike) {
        if (busy || !myTurn) return;
        const same = selJutsu?.id === j.id;
        setSelJutsu(same ? null : j);
        setSelWeaponId("");
        setMode(same ? "idle" : "jutsu");
    }
    function armWeapon(id: string) {
        if (busy || !myTurn) return;
        const same = selWeaponId === id && mode === "weapon";
        setSelWeaponId(same ? "" : id);
        setSelJutsu(null);
        setMode(same ? "idle" : "weapon");
    }

    // Avatar resolution — player's live avatar; enemy's sealed avatar or the
    // published AI portrait (ai:<id>), matching how the Mission Hall card resolves it.
    const playerAvatar = resolveOwnAvatar(character, sharedImages) || me.slice(0, 2).toUpperCase();
    const enemyVisual = String(enemy?.character?.visual ?? "");
    const sealedEnemyAvatar = typeof enemy?.character?.avatarImage === "string" ? enemy!.character.avatarImage as string : "";
    const enemyAvatar = enemyAvatarOverride || sealedEnemyAvatar || sharedImages?.[`ai:${enemyVisual}`] || (enemy?.name ? enemy.name.slice(0, 2).toUpperCase() : "EN");
    const enemyName = enemy?.name ?? "Enemy";
    const enemyBattleSprite = battlefieldAiSprite(enemyVisual, sharedImages);
    // The pet's portrait is resolved from the player's OWN save (character.pets) rather
    // than sealed into the session — a base64 pet image would bloat every 2.5s poll.
    // Portrait-first (see petOrbPortrait) — `pet.image` alone misses published art.
    const companionPetId = String(companion?.character?.visual ?? "");
    const companionPet = companionPetId ? (character.pets ?? []).find((p) => p.id === companionPetId) : undefined;
    const companionImage = companionPet ? petOrbPortrait(companionPet, sharedImages ?? {}) : "";
    const companionRoundsLeft = Number(companion?.character?.companionRoundsLeft ?? 0);

    // The sealed session strips jutsu art (combat fields only), so card thumbnails
    // come from the player's OWN catalog by id — the same source the Arena's cards
    // use. Inline/shared art stays as a fallback.
    const jutsuArtById = (() => {
        const map: Record<string, string> = {};
        for (const j of getAllJutsus(savedBloodlines ?? [], creatorJutsus ?? [], character)) {
            if (j?.id && typeof j.image === "string" && j.image) map[j.id] = j.image;
        }
        return map;
    })();
    const jutsuArt = (j: JutsuLike) => jutsuArtById[String(j.id ?? "")] || (typeof j.image === "string" && j.image) || sharedImages?.[`jutsu:${j.id}`] || "";
    // Same story as jutsu: the sealed pvpItems carry combat fields, not art, so
    // weapon/consumable thumbnails resolve from the player's own item catalog by id.
    const itemArtById = (() => {
        const map: Record<string, string> = {};
        for (const it of getAllItems(creatorItems ?? [])) {
            if (it?.id && typeof it.image === "string" && it.image) map[it.id] = it.image;
        }
        return map;
    })();
    const itemArt = (it: ItemLike) => itemArtById[String(it.id ?? "")] || (typeof it.image === "string" && it.image) || sharedImages?.[`item:${it.id}`] || "";

    const done = session.status === "done";
    const won = done && session.winner === "squad";
    const turnLabel = session.status !== "active" ? "" : myTurn ? "Your turn" : enemyActive ? `${enemyName} acting…` : "Waiting…";

    // The armed-action hint line under the action bar.
    const targetingHint = !myTurn ? "" :
        mode === "move" ? "Click a highlighted tile to move." :
        mode === "attack" ? (enemyInMelee ? `Click ${enemyName} to strike.` : `Move next to ${enemyName} to strike.`) :
        mode === "weapon" ? `Click ${enemyName} if in range.` :
        mode === "clear" ? `Click ${enemyName} to strip its buffs.` :
        mode === "jutsu" && isSelfCastJutsu(selJutsu) ? `Click yourself to cast ${selJutsu?.name ?? "it"}.` :
        mode === "jutsu" && isMoveJutsu(selJutsu) ? `Click a highlighted tile to flicker there.` :
        mode === "jutsu" && selJutsu?.target === "EMPTY_GROUND" ? `Click a highlighted tile to place ${selJutsu?.name ?? "the zone"}.` :
        mode === "jutsu" && selJutsu ? `Click ${enemyName} to cast ${selJutsu?.name ?? "it"}.` : "";

    // `.combat-main-area` is a FIXED-track grid on every tier (battle-skin.css) and
    // its bands are placed by `order` (AP 1, terrain 2, board 3, commands 4, …).
    // An extra child with the default `order: 0` therefore sorts AHEAD of all of
    // them and claims row 1, shoving every band down one track — the terrain strip
    // inherits the board's minmax(300px, 1fr) row and the board collapses into the
    // command bar's `auto` row (measured: 362px → 30px). Arena hit this with its
    // rookie tip and fixed it with `has-rookie-tip`, which adds the extra track on
    // each tier. Do the same here, and keep BOTH conditional lines in one wrapper
    // so the grid only ever gains the single row that class reserves.
    const showTargetingHint = myTurn && !!targetingHint;
    const hasActionNotice = !!reject || showTargetingHint;

    const playerAp = myTurn ? session.activeAp : (done ? 0 : 100);
    const enemyAp = enemyActive ? session.activeAp : (done ? 0 : 100);

    function jutsuIcon(type: string | undefined) {
        return type === "Taijutsu" ? GiBoxingGlove : type === "Bukijutsu" ? GiCrossedSwords : type === "Genjutsu" ? GiEyeball : GiFireSpellCast;
    }

    return (
        <CombatInstance
            className={`pvp-battle-layout mission-arena-fight arena-bg-${biome}${storyTheme ? " story-arena-fight" : ""}`}
            style={storyTheme?.backdropImage ? { background: `linear-gradient(rgba(6,10,20,0.82), rgba(6,10,20,0.9)), url(${storyTheme.backdropImage}) center/cover fixed` } : undefined}
        >
            {/* Onboarding coaching (display-only). Portals to document.body like the
                fight itself, so it is given a z-index ABOVE this portal's 1000000. */}
            {coach === "academySpar" && enemy && (
                <SparCoach
                    attacked={sparAttacked}
                    casted={sparCasted}
                    ap={myAp}
                    enemyHp={enemy.hp}
                    enemyMaxHp={enemy.maxHp}
                    zIndex={1_000_001}
                />
            )}

            {/* Story flavor overlays (display-only) — float above the arena board. */}
            {storyTheme?.chapterLabel && <div className="story-fight-chapter">{storyTheme.chapterLabel}</div>}
            {storyFinalPhase && <div className="story-fight-vignette" aria-hidden="true" />}
            {bark && (
                <div className={`story-fight-bark${bark.side === "ally" ? " story-fight-bark--ally" : ""}`} role="status">
                    {bark.side === "boss" && isImageAvatar(enemyAvatar) && (
                        <img className="story-fight-bark-face" src={enemyAvatar} alt="" />
                    )}
                    <div className="story-fight-bark-body">
                        <strong>{bark.name}</strong>
                        <span>{bark.text}</span>
                    </div>
                </div>
            )}
            <CombatHudLayout hasActionNotice={hasActionNotice}>
                {/* Player dossier */}
                <CombatSideHud
                    name={me}
                    avatar={playerAvatar}
                    hp={myActor?.hp ?? character.maxHp}
                    maxHp={myActor?.maxHp ?? character.maxHp}
                    chakra={myActor?.chakra ?? character.chakra}
                    maxChakra={myActor?.maxChakra ?? character.maxChakra}
                    stamina={myActor?.stamina ?? character.stamina}
                    maxStamina={myActor?.maxStamina ?? character.maxStamina}
                    shield={myActor?.shield ?? 0}
                    village={character.village}
                    turn={session.round}
                    statuses={hudStatuses(myActor?.statuses)}
                    isActive={myTurn}
                />

                <CombatHudMain activeTab={tabs.tab}>
                    <CombatHudHeader
                        title={biomeLabel(biome as Parameters<typeof biomeLabel>[0])}
                        subtitle={<>Round {session.round} | Shinobi Duel</>}
                    />

                    <CombatEnvironmentStrip>
                        <span className="twp-strip-biome">{biomeLabel(biome as Parameters<typeof biomeLabel>[0])}</span>
                        <span className="twp-strip-sep">·</span>
                        <span className="twp-strip-label">Terrain</span>
                        {BIOME_SCHOOL[biome]
                            ? <span className="twp-buff twp-positive">{BIOME_SCHOOL[biome]} +10%</span>
                            : <span className="twp-strip-value">Neutral ground</span>}
                        {session.weather && (session.weather.positiveElement || session.weather.negativeElement) && (
                            <>
                                <span className="twp-strip-sep">·</span>
                                <span className="twp-strip-label">Weather</span>
                                {session.weather.positiveElement && <span className="twp-buff twp-positive">{session.weather.positiveElement} +5%</span>}
                                {session.weather.negativeElement && <span className="twp-buff twp-negative">{session.weather.negativeElement} −2%</span>}
                            </>
                        )}
                        {gateDirective && (
                            <>
                                <span className="twp-strip-sep">·</span>
                                <span className={`hg-combat-directive hg-tone-${gateDirective.tone} hg-phase-${gateDirective.phase}`} aria-live="polite">
                                    <strong>{hollowGate?.kind === "boss" ? `PHASE ${gateDirective.phase} · ` : ""}{gateDirective.phaseName}</strong>
                                    <span>{gateDirective.title}</span>
                                    <small>{gateDirective.instruction}</small>
                                </span>
                            </>
                        )}
                    </CombatEnvironmentStrip>

                    <CombatApPanel>
                        <div>
                            <strong>{me} AP</strong>
                            <div className="hud-bar ap-display-bar"><span style={{ width: `${playerAp}%` }} /></div>
                            <small>{playerAp}/100 | {myTurn ? "Active" : "Waiting"}</small>
                        </div>
                        {myTurn && !done ? (
                            <CombatRoundTimer
                                active={myTurn && !done}
                                resetSignal={session.round * 100 + session.actionsThisTurn}
                                seconds={Math.round(transport.turnTimeoutMs / 1000)}
                                onExpire={() => { if (myTurn) void send({ type: "wait" }); }}
                            />
                        ) : (
                            <div className="round-timer-display round-timer-inactive">
                                <div className="round-timer-ring"><span className="round-timer-num">—</span></div>
                                <small>{enemyActive ? `${enemyName}'s Turn` : "—"}</small>
                            </div>
                        )}
                        <div>
                            <strong>{enemyName} AP</strong>
                            <div className="hud-bar enemy-ap-display-bar"><span style={{ width: `${enemyAp}%` }} /></div>
                            <small>{enemyAp}/100 | {enemyActive ? "Active" : "Waiting"}</small>
                        </div>
                    </CombatApPanel>

                    <div className={`hex-battlefield hex-${biome}${gateDirective ? ` hollow-gate-combat hg-tone-${gateDirective.tone} hg-phase-${gateDirective.phase}` : ""}`} ref={battlefieldCallbackRef}>
                        <div style={(() => {
                            const scaledW = layer.width * effectiveScale;
                            const scaledH = layer.height * effectiveScale;
                            const cW = boardContainerSize.w || scaledW;
                            const cH = boardContainerSize.h || scaledH;
                            return {
                                position: "absolute" as const,
                                left: `${Math.max(0, (cW - scaledW) / 2)}px`,
                                top: `${Math.max(0, (cH - scaledH) / 2)}px`,
                                width: `${scaledW}px`, height: `${scaledH}px`,
                            };
                        })()}>
                            <div className="hex-grid-layer" style={{ position: "absolute", left: 0, top: 0, width: layer.width, height: layer.height, transform: `scale(${effectiveScale})`, transformOrigin: "top left" }}>
                                {/* Actor orbs + HP bars (overlay above the tiles) */}
                                {myActor && (() => {
                                    const { left, top } = towerHexPixel(myPos, w);
                                    return <BattlefieldActor key="player-orb" side="player" label={me} portrait={playerAvatar} fallback={me.slice(0, 2).toUpperCase()} style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }} />;
                                })()}
                                {myActor && (() => {
                                    const { left, top } = towerHexPixel(myPos, w);
                                    return <FighterHpBadge key="player-hp" left={left + HEX_W / 2 - ORB / 2} top={top + HEX_H * 0.85 - ORB - 16} width={ORB} hp={myActor.hp} maxHp={myActor.maxHp} side="player" />;
                                })()}
                                {companion && isImageAvatar(companionImage) && (() => {
                                    const { left, top } = towerHexPixel(companion.pos, w);
                                    return <div key="pet-orb" className={`avatar-orb pet-summon-orb ${companionPet ? petVisualVariantClass(companionPet) : ""}`} style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 9, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                        <img className="tiny-map-avatar" src={companionImage} alt={companion.name} />
                                    </div>;
                                })()}
                                {companion && (() => {
                                    const { left, top } = towerHexPixel(companion.pos, w);
                                    return <FighterHpBadge key="pet-hp" left={left + HEX_W / 2 - ORB / 2} top={top + HEX_H * 0.85 - ORB - 16} width={ORB} hp={companion.hp} maxHp={companion.maxHp} side="pet" caption={`${companion.name} · ${companionRoundsLeft}⟳`} />;
                                })()}
                                {enemy && (() => {
                                    const { left, top } = towerHexPixel(enemyPos, w);
                                    return <BattlefieldActor key="enemy-orb" side="enemy" label={enemyName} portrait={enemyAvatar} sprite={enemyBattleSprite} fallback={enemyName.slice(0, 2).toUpperCase()} className={gateDirective ? `hg-hound-orb hg-tone-${gateDirective.tone} hg-phase-${gateDirective.phase}` : ""} style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                        {gateDirective ? <span className="hg-hound-spectral-aura" aria-hidden="true" /> : null}
                                    </BattlefieldActor>;
                                })()}
                                {enemy && (() => {
                                    const { left, top } = towerHexPixel(enemyPos, w);
                                    return <FighterHpBadge key="enemy-hp" left={left + HEX_W / 2 - ORB / 2} top={top + HEX_H * 0.85 - ORB - 16} width={ORB} hp={enemy.hp} maxHp={enemy.maxHp} side="enemy" />;
                                })()}

                                {/* Tiles */}
                                {Array.from({ length: w * h }, (_, i) => {
                                    const { left, top } = towerHexPixel(i, w);
                                    const isMoveTile = moveTiles.has(i);
                                    const isRangeTile = (mode === "weapon" || (mode === "jutsu" && !isSelfCastJutsu(selJutsu) && !isMoveJutsu(selJutsu) && selJutsu?.target !== "EMPTY_GROUND")) && rangeTiles.has(i);
                                    const isGroundTile = mode === "jutsu" && selJutsu?.target === "EMPTY_GROUND" && rangeTiles.has(i) && !session.map.blockedTiles.includes(i);
                                    const isFlickerTile = mode === "jutsu" && isMoveJutsu(selJutsu) && rangeTiles.has(i);
                                    const isEnemyTarget = enemy != null && i === enemyPos && enemyInRange && (mode === "attack" || mode === "weapon" || mode === "clear" || (mode === "jutsu" && !isSelfCastJutsu(selJutsu) && selJutsu?.target !== "EMPTY_GROUND" && !isMoveJutsu(selJutsu)));
                                    const isSelfTarget = mode === "jutsu" && isSelfCastJutsu(selJutsu) && i === myPos;
                                    const tileOccupant = i === myPos
                                        ? "your position"
                                        : i === enemyPos
                                            ? `${enemyName} position`
                                            : companion && i === companion.pos
                                                ? `${companion.name} position`
                                                : "empty";
                                    const tilePurpose = isEnemyTarget || isSelfTarget
                                        ? "target"
                                        : isGroundTile
                                            ? "ground target"
                                            : isMoveTile || isFlickerTile
                                                ? "move target"
                                                : isRangeTile
                                                    ? "in range"
                                                    : null;
                                    const tileLabel = `Tile ${i + 1}, row ${Math.floor(i / w) + 1}, column ${(i % w) + 1}: ${tileOccupant}${tilePurpose ? `, ${tilePurpose}` : ""}`;
                                    const cls = [
                                        "hex-tile",
                                        i === myPos ? "hex-player" : "",
                                        i === enemyPos ? "hex-enemy" : "",
                                        (isMoveTile || isFlickerTile) ? "dash-target-tile" : "",
                                        isRangeTile ? "jutsu-range-tile" : "",
                                        isGroundTile ? "ground-target-tile" : "",
                                        isEnemyTarget ? "jutsu-target-tile" : "",
                                        isSelfTarget ? "jutsu-target-tile jutsu-self-target-tile" : "",
                                        gateHazards.has(i) ? "hg-hazard-tile" : "",
                                        gateSafe.has(i) ? "hg-safe-tile" : "",
                                    ].filter(Boolean).join(" ");
                                    return (
                                        <button
                                            key={i}
                                            data-tile={i}
                                            className={cls}
                                            aria-label={tileLabel}
                                            style={{ left: `${left}px`, top: `${top}px`, width: `${HEX_W}px`, height: `${HEX_H}px` }}
                                            onClick={() => onTileClick(i)}
                                        >
                                            {i === myPos ? ""
                                                : i === enemyPos ? ""
                                                    : (companion && i === companion.pos) ? (isImageAvatar(companionImage) ? "" : companion.name.slice(0, 2).toUpperCase())
                                                        : ""}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <BattleTabBar tab={tabs.tab} setTab={tabs.setTab} unread={tabs.unread} />

                    {/* ONE grid child (see hasActionNotice above) — a rejection and an
                        armed-action hint can be on screen together, and two bare
                        children would take two tracks the grid has not reserved. */}
                    {hasActionNotice && (
                        <div className="combat-action-notice">
                            {reject && <div className="rookie-combat-tip" role="alert" style={{ borderColor: "var(--danger)" }}><strong>Can't do that</strong><span>{reject}</span></div>}
                            {showTargetingHint && <div className="combat-targeting-hint">{targetingHint}</div>}
                        </div>
                    )}

                    <CombatCommandBar>
                        <button onClick={() => { if (enemyInMelee) void send({ type: "attack", targetId: enemy!.id }); else { setMode("attack"); setSelJutsu(null); setSelWeaponId(""); } }}
                            disabled={busy || !myTurn || outOfActions || myAp < ATTACK_AP || !enemy || enemy.hp <= 0}
                            title={!enemyInMelee ? `Move next to ${enemyName} first` : undefined}
                            className={mode === "attack" ? "selected-action" : ""}><i className="cmd-icon" aria-hidden="true"><GiCrossedSwords /></i><span>Attack</span><small>{ATTACK_AP} AP | R1</small></button>
                        <button className={mode === "move" ? "selected-action" : ""}
                            disabled={busy || !myTurn || outOfActions || myAp < MOVE_AP}
                            onClick={() => { setSelJutsu(null); setSelWeaponId(""); setMode(m => m === "move" ? "idle" : "move"); }}><i className="cmd-icon" aria-hidden="true"><GiBootPrints /></i><span>Move</span><small>{MOVE_AP} AP / tile</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "heal" }); }}
                            disabled={busy || !myTurn || outOfActions || healCd > 0 || myChakra < 10 || myAp < UTILITY_AP}><i className="cmd-icon" aria-hidden="true"><GiHealing /></i><span>Heal</span><small>{UTILITY_AP} AP | CD {healCd}</small></button>
                        <button onClick={() => { resetTargeting(); if (enemy) void send({ type: "clear", targetId: enemy.id }); }}
                            disabled={busy || !myTurn || outOfActions || clearCd > 0 || myAp < UTILITY_AP || !enemy || enemy.hp <= 0}><i className="cmd-icon" aria-hidden="true"><GiMagicSwirl /></i><span>Clear</span><small>{UTILITY_AP} AP | CD {clearCd}</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "cleanse" }); }}
                            disabled={busy || !myTurn || outOfActions || cleanseCd > 0 || myAp < UTILITY_AP}><i className="cmd-icon" aria-hidden="true"><GiWaterDrop /></i><span>Cleanse</span><small>{UTILITY_AP} AP | CD {cleanseCd}</small></button>
                        <button
                            onClick={() => { resetTargeting(); void send({ type: "summon" }); }}
                            disabled={busy || !myTurn || !session.pendingCompanion || !!companion || session.companionUsed}
                            title={companion
                                ? `${companion.name} is already on the field`
                                : session.pendingCompanion
                                    ? `Summon ${session.pendingCompanion.name}`
                                    : session.companionUsed
                                        ? "Your pet summon was already used in this fight"
                                        : "Choose an eligible active PvE pet in the Pet Yard"}
                        >
                            <i className="cmd-icon" aria-hidden="true"><GiPawPrint /></i>
                            <span>Summon Pet</span>
                            <small>{companion
                                ? `${companion.name} · ${companionRoundsLeft}⟳`
                                : session.pendingCompanion
                                    ? session.pendingCompanion.name
                                    : session.companionUsed
                                        ? "Already used"
                                        : "No eligible active pet"}</small>
                        </button>
                        <button
                            disabled={busy || !myTurn || outOfActions || myAp < 100 || retreatSealed}
                            title={retreatSealed ? "Berserker's Gamble seals retreat." : "Attempt to escape for 100 AP and 10% max HP. Failure continues the fight."}
                            onClick={() => { resetTargeting(); void send({ type: "flee" }); }}
                        ><i className="cmd-icon" aria-hidden="true"><GiRun /></i><span>Flee</span><small>{retreatSealed ? "Retreat sealed" : "100 AP · escape roll"}</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "wait" }); }} disabled={busy || !myTurn}><i className="cmd-icon" aria-hidden="true"><GiSandsOfTime /></i><span>Wait</span><small>End turn</small></button>
                    </CombatCommandBar>

                    <div className="jutsu-layout-card combat-jutsu-bar">
                        {myJutsu.length === 0 && myWeapons.length === 0 && myConsumables.length === 0 ? (
                            <div className="summary-box">No equipped jutsu or combat items.</div>
                        ) : (
                            <div className="combat-equipped-jutsu-grid">
                                {myJutsu.map((j) => {
                                    const cd = Number(myActor?.cooldowns?.[j.id ?? ""] ?? 0);
                                    const onCd = cd > 0;
                                    const armed = selJutsu?.id === j.id;
                                    const Icon = jutsuIcon(j.type);
                                    const art = jutsuArt(j);
                                    return (
                                        <div key={j.id} className={`combat-jutsu-card-wrap ${armed ? "selected-action" : ""}`}>
                                            {onCd && <span className="combat-cd-badge" title={`${cd} round(s) until ready`}>{cd}</span>}
                                            <button
                                                type="button"
                                                className={`combat-jutsu-button ${armed ? "selected-action" : ""} ${onCd ? "jutsu-on-cooldown" : ""}`}
                                                disabled={busy || !myTurn || outOfActions || onCd || myAp < adjustedCombatApCost(myActor?.statuses, Number(j.ap ?? 0))}
                                                title={`${j.name} | ${j.ap} AP | Range ${j.range}`}
                                                onClick={() => armJutsu(j)}
                                            >
                                                <span className="combat-jutsu-thumb">{art ? <img src={art} alt={j.name} /> : <strong><Icon size={22} aria-hidden="true" /></strong>}</span>
                                                <span className="combat-jutsu-name">{j.name}</span>
                                                {/* "CD 0" is noise on every card; an ACTIVE cooldown already
                                                    shows as the corner pip. */}
                                                <CombatJutsuMeta character={character} jutsu={j} statuses={myActor?.statuses} activeCooldown={cd} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {myWeapons.map(({ item, thrown, range, left, cd }) => {
                                    const onCd = cd > 0;
                                    const armed = selWeaponId === item.id && mode === "weapon";
                                    const out = thrown && left <= 0;
                                    const Icon = thrown ? GiTargeted : GiCrossedSwords;
                                    const art = itemArt(item);
                                    return (
                                        <div key={item.id} className={`combat-jutsu-card-wrap combat-item-card-wrap combat-weapon-card${onCd ? " jutsu-on-cooldown" : ""}`}>
                                            {onCd && <span className="combat-cd-badge">{cd}</span>}
                                            <button
                                                type="button"
                                                className={`combat-jutsu-button combat-item-button rarity-${item.rarity ?? "common"}${armed ? " jutsu-armed" : ""}${onCd ? " jutsu-on-cooldown" : ""}`}
                                                disabled={busy || !myTurn || outOfActions || onCd || out || myAp < Number(item.apCost ?? ATTACK_AP)}
                                                title={out ? `${item.name} — none left` : `${item.name} | ${item.apCost ?? ATTACK_AP} AP | R${range}`}
                                                onClick={() => armWeapon(item.id ?? "")}
                                            >
                                                <span className="combat-jutsu-thumb combat-item-thumb">{art ? <img src={art} alt={item.name} /> : <strong><Icon size={22} aria-hidden="true" /></strong>}</span>
                                                <span className="combat-jutsu-name">{item.name}</span>
                                                <span className="combat-jutsu-info">{item.apCost ?? ATTACK_AP} AP | R{range}{thrown ? ` | ×${left === Infinity ? "∞" : left}` : ""}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                                {myConsumables.map(({ item, left, cd }) => {
                                    const onCd = cd > 0;
                                    const out = left <= 0;
                                    const art = itemArt(item);
                                    const Icon = String(item.slot ?? "").includes("potion") ? GiHealthPotion : GiBriefcase;
                                    return (
                                        <div key={item.id} className={`combat-jutsu-card-wrap combat-item-card-wrap combat-consumable-card${onCd ? " jutsu-on-cooldown" : ""}`}>
                                            {onCd && <span className="combat-cd-badge">{cd}</span>}
                                            <button
                                                type="button"
                                                className={`combat-jutsu-button combat-item-button rarity-${item.rarity ?? "common"}${onCd ? " jutsu-on-cooldown" : ""}`}
                                                disabled={busy || !myTurn || outOfActions || onCd || out || myAp < Number(item.apCost ?? UTILITY_AP)}
                                                title={out ? `${item.name} — none left` : `${item.name} | Use`}
                                                onClick={() => { resetTargeting(); if (item.id) void send({ type: "item", itemId: item.id }); }}
                                            >
                                                <span className="combat-jutsu-thumb combat-item-thumb">{art ? <img src={art} alt={item.name} /> : <strong><Icon size={22} aria-hidden="true" /></strong>}</span>
                                                <span className="combat-jutsu-name">{item.name}</span>
                                                <span className="combat-jutsu-info">Use | ×{left}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <PlainCombatBattleLog lines={session.log ?? []} turnLabel={turnLabel} />
                </CombatHudMain>

                {/* Enemy dossier */}
                <CombatSideHud
                    name={enemyName}
                    avatar={enemyAvatar}
                    hp={enemy?.hp ?? 0}
                    maxHp={enemy?.maxHp ?? 1}
                    chakra={enemy?.chakra ?? 0}
                    maxChakra={enemy?.maxChakra ?? 1}
                    stamina={enemy?.stamina ?? 0}
                    maxStamina={enemy?.maxStamina ?? 1}
                    shield={enemy?.shield ?? 0}
                    village={String(enemy?.character?.village ?? "Mission")}
                    turn={session.round}
                    statuses={hudStatuses(enemy?.statuses)}
                    isActive={enemyActive}
                />
            </CombatHudLayout>

            {done && (renderResult
                ? renderResult({ won, draw: session.winner === "draw", settleState, settleResult, retry: () => { void runSettle(); }, onExit })
                : (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            <h2>{won ? "Victory!" : session.winner === "draw" ? "Draw" : "Defeat"}</h2>
                            <p>
                                {!won
                                    ? "The mission failed. No reward was earned — you can try again from the Mission Hall."
                                    : settleState === "settled"
                                        ? `${missionName ?? "Mission"} cleared. Return to the Mission Hall to claim your reward.`
                                        : settleState === "failed"
                                            ? `${missionName ?? "Mission"} cleared, but the reward could not be registered with the server. Retry before leaving — otherwise there will be nothing to claim.`
                                            : `${missionName ?? "Mission"} cleared. Registering your reward…`}
                            </p>
                            {won && settleState === "failed"
                                ? <button className="start-primary-btn" onClick={() => { void runSettle(); }}>Retry</button>
                                : <button className="start-primary-btn" disabled={won && settleState === "pending"} onClick={onExit}>Return to Mission Hall</button>}
                        </div>
                    </div>
                )
            )}
        </CombatInstance>
    );
}
