import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/battle-skin.css";
import "../styles/mission-arena-fight.css";
import { GiBoxingGlove, GiCrossedSwords, GiEyeball, GiFireSpellCast, GiTargeted, GiHealthPotion, GiBriefcase } from "react-icons/gi";
import type { Character } from "../types/character";
import {
    submitTowerAction, fetchTowerState, TOWER_TURN_AFK_MS,
    type TowerSession, type TowerStatus,
} from "../lib/towers-api";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, HEX_W, HEX_H,
} from "../lib/tower-grid";
import { useBoardScale } from "../lib/use-board-scale";
import { useBattleTabs } from "../lib/use-battle-tabs";
import { CombatSideHud } from "../components/CombatSideHud";
import { CombatRoundTimer } from "../components/CombatRoundTimer";
import { BattleTabBar } from "../components/BattleTabBar";
import { FighterHpBadge } from "../components/FighterHpBadge";
import { isImageAvatar } from "../lib/avatar";
import { petCardImage, petStripVariant } from "../lib/pet-battle-anim";
import type { Pet } from "../types/pet";

// The board token is a CIRCULAR orb (same treatment as the player/enemy), so the
// pet's PORTRAIT is the right art. petCardImage reaches for the un-clipped
// FULL-BODY battle sprite (`petbody:` / bodyImage) first — that's built for the
// Pet Arena and reads wrong clipped into a circle. Prefer the portrait (`pet:` /
// pet.image), then fall back to petCardImage so portrait-less starters still show
// their baked idle pose instead of bare initials.
function petOrbPortrait(pet: Pet, shared: Record<string, string>): string {
    return shared[`pet:${pet.id}`]
        || shared[`pet:${petStripVariant(pet.id)}`]
        || pet.image
        || petCardImage(pet, shared);
}
import { biomeLabel } from "../data/world";
import { equipSlotForItem } from "../lib/equipment";
import { tagMatchesName } from "../lib/tags";
import { gameConfirm } from "../components/GameAlert";

// ─── Mission Arena Fight ──────────────────────────────────────────────────────
// Renders the server-authoritative combat-mission session (tower:<runId>) using
// the SAME shell as the normal Arena PvE duel — CombatSideHud dossiers, the
// arena-top-panel header, the dual-AP bar, the identical 12×10 hex board, and the
// basic-action-bar + jutsu/item cards — instead of the tactical "Battle Tower"
// rail layout. The fight is still resolved 100% server-side: every button submits
// a move to /api/towers/action and reflects the returned session; nothing is
// computed on the client. This closes the "combat missions look like an older PvP
// model" gap while keeping the reward-integrity guarantee (C/B/A/S missions are
// won on a completed server session, not a client-attested outcome).
//
// The board geometry is byte-identical to Arena.tsx (HEX_W/HEX_H, odd-q offset,
// 12 wide × 10 tall, ORB 52), so the tiles/orbs line up exactly with the arena
// skin's CSS. A combat mission is always solo 1v1 (one player vs one boss), so
// there is no squad rail, pylons, hazards, or spire chrome to draw.

type Mode = "idle" | "move" | "attack" | "jutsu" | "weapon" | "clear";
type JutsuLike = { id?: string; name?: string; type?: string; element?: string; target?: string; ap?: number; range?: number; method?: string; image?: string; tags?: Array<{ name?: string }> };
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

// TowerStatus → CombatSideHud status shape (it requires an explicit kind).
function hudStatuses(statuses: TowerStatus[] | undefined): { name: string; rounds: number; amount?: number; percent?: number; kind: "positive" | "negative" }[] {
    return (statuses ?? []).map((s) => ({
        name: s.name,
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
    settleFn,
    onExit,
}: {
    character: Character;
    sharedImages?: Record<string, string>;
    runId: string;
    initialSession: TowerSession;
    /** Mission label (e.g. "C-Rank Patrol") shown on the result banner. */
    missionName?: string;
    /** Queue the server-authoritative claim on a win (Missions.settleAuthoritativeMission). */
    settleFn: (runId: string, playerName: string) => Promise<unknown>;
    onExit: () => void;
}) {
    const [session, setSession] = useState<TowerSession>(initialSession);
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [selWeaponId, setSelWeaponId] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [reject, setReject] = useState<string | null>(null);
    const settledRef = useRef(false);

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

    // Reconnect: if mounted without a fresh session, pull the latest once.
    useEffect(() => {
        if (initialSession.status === "active") return;
        fetchTowerState(runId, me).then(setSession).catch(() => {});
    }, [runId, me, initialSession.status]);

    // While it is NOT our turn, poll so we see the enemy's moves and learn the
    // instant it is our turn again. A poll also nudges the server's AFK auto-pass.
    useEffect(() => {
        if (session.status !== "active" || myTurn) return;
        let alive = true;
        const id = setInterval(() => {
            if (document.visibilityState === "hidden") return;
            fetchTowerState(runId, me).then(s => { if (alive) setSession(s); }).catch(() => {});
        }, 2500);
        return () => { alive = false; clearInterval(id); };
    }, [session.status, myTurn, runId, me]);

    // Auto-settle the win (queue the claim). Losses/draws pay nothing — the run
    // just resolves and the player exits back to the Mission Hall.
    useEffect(() => {
        if (session.status === "done" && session.winner === "squad" && !settledRef.current) {
            settledRef.current = true;
            void settleFn(runId, me).catch(() => {});
        }
    }, [session.status, session.winner, runId, me, settleFn]);

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

    async function send(action: Parameters<typeof submitTowerAction>[2]) {
        if (busy) return;
        setBusy(true); setReject(null);
        try {
            const res = await submitTowerAction(runId, me, action);
            setSession(res.session);
            if (!res.applied) setReject(res.reason ?? "That move wasn't allowed.");
        } catch (e) {
            setReject(String((e as Error)?.message ?? e));
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
    const playerAvatar = character.avatarImage || me.slice(0, 2).toUpperCase();
    const enemyVisual = String(enemy?.character?.visual ?? "");
    const sealedEnemyAvatar = typeof enemy?.character?.avatarImage === "string" ? enemy!.character.avatarImage as string : "";
    const enemyAvatar = sealedEnemyAvatar || sharedImages?.[`ai:${enemyVisual}`] || (enemy?.name ? enemy.name.slice(0, 2).toUpperCase() : "EN");
    const enemyName = enemy?.name ?? "Enemy";
    // The pet's portrait is resolved from the player's OWN save (character.pets) rather
    // than sealed into the session — a base64 pet image would bloat every 2.5s poll.
    // Portrait-first (see petOrbPortrait) — `pet.image` alone misses published art.
    const companionPetId = String(companion?.character?.visual ?? "");
    const companionPet = companionPetId ? (character.pets ?? []).find((p) => p.id === companionPetId) : undefined;
    const companionImage = companionPet ? petOrbPortrait(companionPet, sharedImages ?? {}) : "";
    const companionRoundsLeft = Number(companion?.character?.companionRoundsLeft ?? 0);

    const jutsuArt = (j: JutsuLike) => (typeof j.image === "string" && j.image) || sharedImages?.[`jutsu:${j.id}`] || "";
    const itemArt = (it: ItemLike) => (typeof it.image === "string" && it.image) || sharedImages?.[`item:${it.id}`] || "";

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

    const playerAp = myTurn ? session.activeAp : (done ? 0 : 100);
    const enemyAp = enemyActive ? session.activeAp : (done ? 0 : 100);

    function jutsuIcon(type: string | undefined) {
        return type === "Taijutsu" ? GiBoxingGlove : type === "Bukijutsu" ? GiCrossedSwords : type === "Genjutsu" ? GiEyeball : GiFireSpellCast;
    }

    async function leaveFight() {
        if (done) { onExit(); return; }
        if (await gameConfirm("Leave this mission fight? You'll forfeit the run and earn no reward.")) onExit();
    }

    return createPortal(
        <div className={`arena-fullscreen pvp-battle-layout mission-arena-fight arena-bg-${biome}`}>
            <div className="combat-layout">
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

                <main className={`combat-main-area bt-${tabs.tab}`}>
                    <div className="arena-top-panel">
                        <div className="arena-title-panel">
                            <h2>{biomeLabel(biome as Parameters<typeof biomeLabel>[0])}</h2>
                            <p>Round {session.round} | Shinobi Duel</p>
                        </div>
                    </div>

                    <div className="twp-strip">
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
                    </div>

                    <div className="dual-ap-panel">
                        <div>
                            <strong>{me} AP</strong>
                            <div className="hud-bar ap-display-bar"><span style={{ width: `${playerAp}%` }} /></div>
                            <small>{playerAp}/100 | {myTurn ? "Active" : "Waiting"}</small>
                        </div>
                        {myTurn && !done ? (
                            <CombatRoundTimer
                                active={myTurn && !done}
                                resetSignal={session.round * 100 + session.actionsThisTurn}
                                seconds={Math.round(TOWER_TURN_AFK_MS / 1000)}
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
                    </div>

                    <div className={`hex-battlefield hex-${biome}`} ref={battlefieldCallbackRef}>
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
                                {isImageAvatar(playerAvatar) && myActor && (() => {
                                    const { left, top } = towerHexPixel(myPos, w);
                                    return <div key="player-orb" className="avatar-orb" style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                        <img className="tiny-map-avatar" src={playerAvatar} alt={me} />
                                    </div>;
                                })()}
                                {myActor && (() => {
                                    const { left, top } = towerHexPixel(myPos, w);
                                    return <FighterHpBadge key="player-hp" left={left + HEX_W / 2 - ORB / 2} top={top + HEX_H * 0.85 - ORB - 16} width={ORB} hp={myActor.hp} maxHp={myActor.maxHp} side="player" />;
                                })()}
                                {companion && isImageAvatar(companionImage) && (() => {
                                    const { left, top } = towerHexPixel(companion.pos, w);
                                    return <div key="pet-orb" className="avatar-orb pet-summon-orb" style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 9, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                        <img className="tiny-map-avatar" src={companionImage} alt={companion.name} />
                                    </div>;
                                })()}
                                {companion && (() => {
                                    const { left, top } = towerHexPixel(companion.pos, w);
                                    return <FighterHpBadge key="pet-hp" left={left + HEX_W / 2 - ORB / 2} top={top + HEX_H * 0.85 - ORB - 16} width={ORB} hp={companion.hp} maxHp={companion.maxHp} side="pet" caption={`${companion.name} · ${companionRoundsLeft}⟳`} />;
                                })()}
                                {enemy && isImageAvatar(enemyAvatar) && (() => {
                                    const { left, top } = towerHexPixel(enemyPos, w);
                                    return <div key="enemy-orb" className="avatar-orb enemy-orb" style={{ position: "absolute", left: left + HEX_W / 2 - ORB / 2, top: top + HEX_H * 0.85 - ORB, width: ORB, height: ORB, zIndex: 10, pointerEvents: "none", transition: "left 280ms ease, top 280ms ease" }}>
                                        <img className="tiny-map-avatar" src={enemyAvatar} alt={enemyName} />
                                    </div>;
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
                                    const cls = [
                                        "hex-tile",
                                        i === myPos ? "hex-player" : "",
                                        i === enemyPos ? "hex-enemy" : "",
                                        (isMoveTile || isFlickerTile) ? "dash-target-tile" : "",
                                        isRangeTile ? "jutsu-range-tile" : "",
                                        isGroundTile ? "ground-target-tile" : "",
                                        isEnemyTarget ? "jutsu-target-tile" : "",
                                        isSelfTarget ? "jutsu-target-tile jutsu-self-target-tile" : "",
                                    ].filter(Boolean).join(" ");
                                    return (
                                        <button
                                            key={i}
                                            data-tile={i}
                                            className={cls}
                                            style={{ left: `${left}px`, top: `${top}px`, width: `${HEX_W}px`, height: `${HEX_H}px` }}
                                            onClick={() => onTileClick(i)}
                                        >
                                            {i === myPos ? (isImageAvatar(playerAvatar) ? "" : playerAvatar)
                                                : i === enemyPos ? (isImageAvatar(enemyAvatar) ? "" : enemyAvatar)
                                                    : (companion && i === companion.pos) ? (isImageAvatar(companionImage) ? "" : companion.name.slice(0, 2).toUpperCase())
                                                        : ""}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <BattleTabBar tab={tabs.tab} setTab={tabs.setTab} unread={tabs.unread} />

                    {reject && <div className="rookie-combat-tip" role="alert" style={{ borderColor: "var(--danger)" }}><strong>Can't do that</strong><span>{reject}</span></div>}
                    {myTurn && targetingHint && <div className="combat-targeting-hint">{targetingHint}</div>}

                    <div className="basic-action-bar shinobi-command-bar">
                        <button onClick={() => { if (enemyInMelee) void send({ type: "attack", targetId: enemy!.id }); else { setMode("attack"); setSelJutsu(null); setSelWeaponId(""); } }}
                            disabled={busy || !myTurn || outOfActions || myAp < ATTACK_AP || !enemy || enemy.hp <= 0}
                            title={!enemyInMelee ? `Move next to ${enemyName} first` : undefined}
                            className={mode === "attack" ? "selected-action" : ""}><span>Attack</span><small>{ATTACK_AP} AP | R1</small></button>
                        <button className={mode === "move" ? "selected-action" : ""}
                            disabled={busy || !myTurn || outOfActions || myAp < MOVE_AP}
                            onClick={() => { setSelJutsu(null); setSelWeaponId(""); setMode(m => m === "move" ? "idle" : "move"); }}><span>Move</span><small>{MOVE_AP} AP / tile</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "heal" }); }}
                            disabled={busy || !myTurn || outOfActions || healCd > 0 || myChakra < 10 || myAp < UTILITY_AP}><span>Heal</span><small>{UTILITY_AP} AP | CD {healCd}</small></button>
                        <button onClick={() => { resetTargeting(); if (enemy) void send({ type: "clear", targetId: enemy.id }); }}
                            disabled={busy || !myTurn || outOfActions || clearCd > 0 || myAp < UTILITY_AP || !enemy || enemy.hp <= 0}><span>Clear</span><small>{UTILITY_AP} AP | CD {clearCd}</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "cleanse" }); }}
                            disabled={busy || !myTurn || outOfActions || cleanseCd > 0 || myAp < UTILITY_AP}><span>Cleanse</span><small>{UTILITY_AP} AP | CD {cleanseCd}</small></button>
                        {(session.pendingCompanion || companion) && (
                            <button
                                onClick={() => { resetTargeting(); void send({ type: "summon" }); }}
                                disabled={busy || !myTurn || !session.pendingCompanion || !!companion}
                                title={companion ? `${companion.name} is already on the field` : session.pendingCompanion ? `Summon ${session.pendingCompanion.name}` : "No active pet"}
                            >
                                <span>Pet</span>
                                <small>{companion ? `${companion.name} · ${companionRoundsLeft}⟳` : session.pendingCompanion ? `Summon ${session.pendingCompanion.name}` : "No active pet"}</small>
                            </button>
                        )}
                        <button onClick={() => { void leaveFight(); }}><span>Flee</span><small>Leave fight</small></button>
                        <button onClick={() => { resetTargeting(); void send({ type: "wait" }); }} disabled={busy || !myTurn}><span>Wait</span><small>End turn</small></button>
                    </div>

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
                                                disabled={busy || !myTurn || outOfActions || onCd || myAp < Number(j.ap ?? 0)}
                                                title={`${j.name} | ${j.ap} AP | Range ${j.range}`}
                                                onClick={() => armJutsu(j)}
                                            >
                                                <span className="combat-jutsu-thumb">{art ? <img src={art} alt={j.name} /> : <strong><Icon size={22} aria-hidden="true" /></strong>}</span>
                                                <span className="combat-jutsu-name">{j.name}</span>
                                                <span className="combat-jutsu-info">{j.ap} AP | R{j.range} | CD {cd}</span>
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

                    <div className="combat-text-log combat-timeline" aria-live="polite" aria-label="Battle log">
                        <div className="combat-log-header">
                            <strong>Battle Log</strong>
                            <span>{turnLabel}</span>
                        </div>
                        {(session.log?.length ?? 0) === 0 ? (
                            <p>No entries yet.</p>
                        ) : (
                            [...(session.log ?? [])].slice(-40).reverse().map((line, i) => (
                                <p key={i} className="combat-log-line">{line}</p>
                            ))
                        )}
                    </div>
                </main>

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
            </div>

            {done && (
                <div className="battle-ended-overlay">
                    <div className="card battle-ended-card">
                        <h2>{won ? "Victory!" : session.winner === "draw" ? "Draw" : "Defeat"}</h2>
                        <p>
                            {won
                                ? `${missionName ?? "Mission"} cleared. Return to the Mission Hall to claim your reward.`
                                : "The mission failed. No reward was earned — you can try again from the Mission Hall."}
                        </p>
                        <button className="start-primary-btn" onClick={onExit}>Return to Mission Hall</button>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
}
