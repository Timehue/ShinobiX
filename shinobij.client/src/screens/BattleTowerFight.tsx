import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import {
    submitTowerAction, settleTowerRun, fetchTowerState, TOWER_TURN_AFK_MS,
    type TowerSession, type TowerActor, type TowerStatus, type TowerSettleResponse, type TowerFeature,
} from "../lib/towers-api";
import gameBg from "../assets/background-image.webp";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, HEX_W, HEX_H,
} from "../lib/tower-grid";
import { useBoardScale } from "../lib/use-board-scale";
import arenaFloorForest from "../assets/towers/arena-floor-forest.webp";
import arenaFloorSnow from "../assets/towers/arena-floor-snow.webp";
import arenaFloorVolcano from "../assets/towers/arena-floor-volcano.webp";
import arenaFloorCentral from "../assets/towers/arena-floor-central.webp";
import arenaFloorShadow from "../assets/towers/arena-floor-shadow.webp";
import banditSprite from "../assets/towers/enemies/bandit.webp";
import archerSprite from "../assets/towers/enemies/archer.webp";
import blockerSprite from "../assets/towers/enemies/blocker.webp";
import bruteSprite from "../assets/towers/enemies/brute.webp";
import acolyteSprite from "../assets/towers/enemies/acolyte.webp";
import wardenSprite from "../assets/towers/enemies/warden.webp";
import ravagerSprite from "../assets/towers/enemies/ravager.webp";
import geninSprite from "../assets/towers/enemies/genin.webp";
import revenantSprite from "../assets/towers/enemies/revenant.webp";
import sovereignSprite from "../assets/towers/enemies/sovereign.webp";
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

type Mode = "idle" | "move" | "attack" | "jutsu" | "weapon";
type JutsuLike = { id?: string; name?: string; type?: string; element?: string; target?: string; ap?: number; range?: number; effectPower?: number; chakraCost?: number; staminaCost?: number; cooldown?: number };
type ItemLike = { id?: string; name?: string; slot?: string; weaponEp?: number; weaponRange?: number; apCost?: number; restoreChakra?: number; restoreStamina?: number };

const ORB = 50;          // squad/enemy orb diameter (scales with the board)
const BOSS_ORB = 78;     // bosses render larger

// Enemy sprite-key → painted portrait (keyed by character.visual), with an emoji
// fallback for anything unmapped. Players/allies use their actual avatarImage.
const ENEMY_SPRITE: Record<string, string> = {
    bandit: banditSprite, archer: archerSprite, blocker: blockerSprite, brute: bruteSprite,
    acolyte: acolyteSprite, warden: wardenSprite, ravager: ravagerSprite, genin: geninSprite,
    revenant: revenantSprite, sovereign: sovereignSprite,
};
// Painted elemental-pylon sprites, by element (drawn on the flower centre).
const PYLON_SPRITE: Record<string, string> = {
    Fire: pylonFire, Water: pylonWater, Earth: pylonEarth, Lightning: pylonLightning, Wind: pylonWind,
};
// Ward / hazard flower sprites.
const FEATURE_SPRITE: Record<string, string> = { ward: wardSprite, hazard: hazardSprite };
const ENEMY_EMOJI: Record<string, string> = {
    bandit: "🥷", archer: "🏹", blocker: "🛡️", brute: "👹", acolyte: "🔮",
    warden: "🐲", ravager: "😈", genin: "🧑",
};
const ELEMENT_ICON: Record<string, string> = { Fire: "🔥", Water: "🌊", Earth: "🪨", Wind: "🌪️", Lightning: "⚡" };

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
    runId,
    initialSession,
    onExit,
}: {
    character: Character;
    runId: string;
    initialSession: TowerSession;
    onExit: () => void;
}) {
    const [session, setSession] = useState<TowerSession>(initialSession);
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [busy, setBusy] = useState(false);
    const [reject, setReject] = useState<string | null>(null);
    const [settle, setSettle] = useState<TowerSettleResponse | null>(null);
    const settledRef = useRef(false);

    const me = character.name;
    // Server slugs are lowercased (safeName), so a squad actor's ownerSlug is the
    // lowercase name — compare case-insensitively or it's NEVER our turn (the bug that
    // froze the board on "enemies acting"). The API still takes the display name; the
    // server lowercases it.
    const meSlug = me.toLowerCase();
    const ownedByMe = (slug: string | null) => !!slug && slug.toLowerCase() === meSlug;
    const w = session.map.width, h = session.map.height;
    const layer = useMemo(() => towerLayerSize(w, h), [w, h]);
    const { battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale } = useBoardScale(layer.width, layer.height);

    const activeId = session.turnQueue[session.activeIndex];
    const activeActor = session.actors.find(a => a.id === activeId);
    const myTurn = session.status === "active" && !!activeActor && activeActor.ai === false && ownedByMe(activeActor.ownerSlug) && activeActor.hp > 0;
    const myActor = activeActor && ownedByMe(activeActor.ownerSlug) ? activeActor : null;
    const bossId = session.phaseState?.bossId;

    // Live clock for the co-op turn countdown.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (session.status !== "active") return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [session.status]);

    // Whose turn is it? + the AFK countdown for a live player's turn.
    const activeIsLiveHuman = !!activeActor && activeActor.ai === false && activeActor.side !== "enemy" && activeActor.hp > 0;
    const afkRemaining = activeIsLiveHuman && session.turnStartedAt
        ? Math.max(0, Math.ceil((TOWER_TURN_AFK_MS - (nowTick - session.turnStartedAt)) / 1000))
        : null;
    const turnLabel = session.status !== "active" || !activeActor ? ""
        : myTurn ? "🟢 Your turn"
        : activeActor.side === "enemy" ? "⚔️ Enemies acting…"
        : activeActor.ai === false ? `⏳ ${activeActor.name}'s turn`
        : `${activeActor.name} acting…`;

    // Reconnect: if mounted without a fresh session (or to recover), pull the latest once.
    useEffect(() => {
        if (initialSession.status === "active") return;
        fetchTowerState(runId, me).then(setSession).catch(() => {});
    }, [runId, me, initialSession.status]);

    // Live co-op: while it's NOT our turn, poll the server so we see allies'/enemies'
    // moves and get notified the instant it's our turn. Our own actions update directly,
    // and a poll also nudges the server's AFK auto-pass so an absent player never stalls
    // the run. Solo runs poll between our turns too, which is cheap + harmless.
    useEffect(() => {
        if (session.status !== "active" || myTurn) return;
        let alive = true;
        const id = setInterval(() => {
            fetchTowerState(runId, me).then(s => { if (alive) setSession(s); }).catch(() => {});
        }, 2500);
        return () => { alive = false; clearInterval(id); };
    }, [session.status, myTurn, runId, me]);

    // Auto-settle once on a squad clear.
    useEffect(() => {
        if (session.status === "done" && session.winner === "squad" && !settledRef.current) {
            settledRef.current = true;
            settleTowerRun(runId, me).then(setSettle).catch(() => {});
        }
    }, [session.status, session.winner, runId, me]);

    // Equipped weapon + restore-potion from the sealed loadout (drive the weapon/item buttons).
    const loadout = useMemo(() => {
        const normSlot = (s?: string) => s === "weapon" ? "hand" : s === "armor" ? "body" : s === "accessory" ? "aura" : (s ?? "");
        const items = (Array.isArray(myActor?.character?.pvpItems) ? myActor!.character.pvpItems : []) as ItemLike[];
        const equippedIds = new Set(Object.values((myActor?.character?.equipment ?? {}) as Record<string, string | undefined>).filter(Boolean) as string[]);
        const charges = (myActor?.itemCharges ?? {}) as Record<string, number>;
        const weapon = items.find(it => it.id && equippedIds.has(it.id) && ["hand", "thrown"].includes(normSlot(it.slot))) ?? null;
        const thrown = !!weapon && normSlot(weapon.slot) === "thrown";
        const range = Math.max(1, Number(weapon?.weaponRange ?? (thrown ? 4 : 1)));
        const weaponLeft = thrown && weapon?.id ? (charges[weapon.id] ?? 0) : Infinity;
        const potion = items.find(it => it.id && equippedIds.has(it.id) && !["hand", "thrown"].includes(normSlot(it.slot)) && ((Number(it.restoreChakra) || 0) > 0 || (Number(it.restoreStamina) || 0) > 0)) ?? null;
        const potionLeft = potion?.id ? (charges[potion.id] ?? 0) : 0;
        return { weapon, thrown, range, weaponLeft, potion, potionLeft };
    }, [myActor]);
    const { weapon: myWeapon, thrown: weaponThrown, range: weaponRange, weaponLeft, potion: myPotion, potionLeft } = loadout;
    const myChakra = myActor?.chakra ?? 0;
    const myStamina = myActor?.stamina ?? 0;

    // Valid target/move sets for the current mode.
    const myPos = myActor?.pos ?? -1;
    const enemiesInRange = useMemo(() => {
        if (!myActor) return new Set<string>();
        const out = new Set<string>();
        const range = mode === "jutsu" ? Math.max(1, Number(selJutsu?.range ?? 1)) : mode === "weapon" ? weaponRange : 1;
        for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== "enemy") continue;
            if (towerHexDistance(myPos, a.pos, w) <= range) out.add(a.id);
        }
        return out;
    }, [myActor, mode, selJutsu, weaponRange, session.actors, myPos, w]);

    const moveTiles = useMemo(() => {
        if (mode !== "move" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        const blocked = new Set(session.map.blockedTiles);
        return new Set(towerNeighbors(myPos, w, h).filter(t => !occupied.has(t) && !blocked.has(t)));
    }, [mode, myActor, session.actors, session.map.blockedTiles, myPos, w, h]);

    // Reach highlight for a ranged action: jutsu range, or the equipped weapon's range.
    const jutsuRangeTiles = useMemo(() => {
        if (!myActor) return new Set<number>();
        if (mode === "jutsu") return towerTilesInRange(myPos, Math.max(1, Number(selJutsu?.range ?? 1)), w, h);
        if (mode === "weapon") return towerTilesInRange(myPos, weaponRange, w, h);
        return new Set<number>();
    }, [mode, myActor, selJutsu, weaponRange, myPos, w, h]);

    // First feature occupying each tile (for tinting + markers).
    const featureByTile = useMemo(() => {
        const m = new Map<number, TowerFeature>();
        for (const f of session.map.features ?? []) for (const t of f.tiles) if (!m.has(t)) m.set(t, f);
        return m;
    }, [session.map.features]);

    async function send(action: Parameters<typeof submitTowerAction>[2]) {
        if (busy) return;
        setBusy(true); setReject(null);
        try {
            const res = await submitTowerAction(runId, me, action);
            setSession(res.session);
            if (!res.applied) setReject(res.reason ?? "Invalid action");
        } catch (e) {
            setReject(String((e as Error)?.message ?? e));
        } finally {
            setBusy(false);
            setMode("idle"); setSelJutsu(null);
        }
    }

    function onTileClick(tile: number) {
        if (!myTurn || busy) return;
        if (mode === "move" && moveTiles.has(tile)) { void send({ type: "move", tile }); return; }
        const occ = session.actors.find(a => a.hp > 0 && a.pos === tile);
        if (occ && occ.side === "enemy" && enemiesInRange.has(occ.id)) {
            if (mode === "attack") void send({ type: "attack", targetId: occ.id });
            else if (mode === "weapon" && myWeapon?.id) void send({ type: "weapon", targetId: occ.id, itemId: myWeapon.id });
            else if (mode === "jutsu" && selJutsu?.id) void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: occ.id });
        }
    }

    function avatarFor(a: TowerActor): string | null {
        // Player's own actor → the live avatar prop; allies → their sealed avatar if present;
        // enemies/npc → their painted portrait by sprite key.
        if (ownedByMe(a.ownerSlug) && character.avatarImage) return character.avatarImage;
        const sealed = a.character?.avatarImage;
        if (typeof sealed === "string" && sealed) return sealed;
        const visual = String(a.character?.visual ?? "");
        return ENEMY_SPRITE[visual] ?? null;
    }
    function emojiFor(a: TowerActor): string {
        if (a.side === "squad") return "🥷";
        const visual = String(a.character?.visual ?? "");
        return ENEMY_EMOJI[visual] ?? (a.side === "npc" ? "🧑" : "✦");
    }

    const myJutsu: JutsuLike[] = Array.isArray(myActor?.character?.jutsu) ? (myActor!.character.jutsu as JutsuLike[]) : [];
    const objective = session.objectiveState.kind;
    // The squad rail also lists protect-target npcs (allies) so the player can watch
    // the genin's HP on a protect floor.
    const allies = session.actors.filter(a => a.side === "squad" || a.side === "npc");
    const enemies = session.actors.filter(a => a.side === "enemy");
    const biomeFloor = TOWER_FLOOR[String(session.map.biome)] ?? arenaFloorForest;

    return (
        <div className="arena-fullscreen screen-battleTowerFight" style={{ position: "relative", minHeight: "100dvh", color: "#e2e8f0", background: `linear-gradient(rgba(6,10,20,0.82), rgba(6,10,20,0.9)), url(${gameBg}) center/cover fixed` }}>
            <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "168px minmax(0,1fr) 196px", gap: 10, padding: 10, minHeight: "100dvh" }}>

                {/* Squad rail (+ protect-target allies) */}
                <aside style={{ minWidth: 0 }}>
                    <RailHeader icon="🛡" label="Squad" accent="#4ade80" />
                    {allies.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} ally={a.side === "npc"} />)}
                </aside>

                {/* Board */}
                <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                        <strong>Floor {session.floor} · {objective.replace(/-/g, " ")}</strong>
                        <span style={{ color: "#94a3b8", flex: 1, textAlign: "right" }}>Round {session.round}</span>
                        {turnLabel && (
                            <span style={{
                                display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 16, fontWeight: 700, fontSize: "0.82rem", whiteSpace: "nowrap",
                                background: myTurn ? "linear-gradient(180deg,#16803a,#0c5226)" : "rgba(15,23,42,0.85)",
                                border: `1px solid ${myTurn ? "#4ade80" : activeActor?.side === "enemy" ? "#f87171" : "#60a5fa"}`,
                                color: myTurn ? "#dcfce7" : "#e2e8f0",
                            }}>
                                {turnLabel}{afkRemaining != null ? ` · ${afkRemaining}s` : ""}
                            </span>
                        )}
                        <input type="range" min={-0.4} max={1} step={0.05} value={userScaleOffset} title="Zoom"
                            onChange={e => setUserScaleOffset(Number(e.target.value))} style={{ width: 90 }} />
                        {session.status === "active" && (
                            // Free, penalty-free abandon — floors have unlimited retries.
                            <button
                                style={{ padding: "4px 10px", fontSize: "0.8rem", borderColor: "#475569", color: "#cbd5e1" }}
                                onClick={() => { if (window.confirm("Leave this floor? Your run won't be saved — floors have unlimited retries.")) onExit(); }}
                            >Leave</button>
                        )}
                    </div>

                    <div ref={battlefieldCallbackRef}
                        style={{ flex: 1, minHeight: 420, position: "relative", overflow: "hidden", borderRadius: 10, border: "2px solid #1f2937", background: `radial-gradient(ellipse at center, rgba(5,12,8,0.05), rgba(4,9,6,0.4)), url(${biomeFloor}) center/cover no-repeat` }}>
                        <div style={{
                            position: "absolute",
                            left: `${Math.max(0, (boardContainerSize.w - layer.width * effectiveScale) / 2)}px`,
                            top: `${Math.max(0, (boardContainerSize.h - layer.height * effectiveScale) / 2)}px`,
                            width: `${layer.width * effectiveScale}px`, height: `${layer.height * effectiveScale}px`,
                        }}>
                            <div className="hex-grid-layer" style={{ position: "absolute", left: 0, top: 0, width: layer.width, height: layer.height, transform: `scale(${effectiveScale})`, transformOrigin: "top left" }}>
                                {/* hex tiles */}
                                {Array.from({ length: w * h }, (_, pos) => {
                                    const { left, top } = towerHexPixel(pos, w);
                                    const isMove = moveTiles.has(pos);
                                    const inJ = (mode === "jutsu" || mode === "weapon") && jutsuRangeTiles.has(pos);
                                    const isGoal = session.map.objectiveTiles.includes(pos);
                                    const isBlocked = session.map.blockedTiles.includes(pos);
                                    const feat = featureByTile.get(pos);
                                    return (
                                        <button key={pos} onClick={() => onTileClick(pos)} title={feat ? featureLabel(feat) : undefined}
                                            className="tower-hex-tile"
                                            style={{
                                                left, top, width: HEX_W, height: HEX_H,
                                                cursor: (isMove || (mode !== "idle")) && myTurn ? "pointer" : "default",
                                                ...tileFill(feat, { isMove, inJ, isGoal, isBlocked }),
                                            }} />
                                    );
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
                                        return <img key={`f-${fi}`} src={sprite} alt={feat.label ?? feat.kind} title={featureLabel(feat)}
                                            style={{ position: "absolute", left: cx - S / 2, top: cy - S + 9, width: S, height: S, objectFit: "contain", zIndex: 5, pointerEvents: "none", filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.75))" }} />;
                                    }
                                    return (
                                        <div key={`f-${fi}`} title={featureLabel(feat)} aria-hidden
                                            style={{ position: "absolute", left: cx - 11, top: cy - 13, fontSize: 18, lineHeight: 1, zIndex: 4, pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>
                                            {featureIcon(feat)}
                                        </div>
                                    );
                                })}

                                {/* actor orbs */}
                                {session.actors.filter(a => a.hp > 0).map(a => {
                                    const { left, top } = towerHexPixel(a.pos, w);
                                    const isBoss = a.id === bossId;
                                    const size = isBoss ? BOSS_ORB : ORB;
                                    const ox = left + HEX_W / 2 - size / 2;
                                    const oy = top + HEX_H * 0.85 - size;
                                    const row = Math.floor(a.pos / w);
                                    const targetable = enemiesInRange.has(a.id) && (mode === "attack" || mode === "weapon" || (mode === "jutsu" && !!selJutsu));
                                    const isActive = a.id === activeId;
                                    const img = avatarFor(a);
                                    const ringColor = a.side === "squad" ? "#67e8f9" : a.side === "npc" ? "#facc15" : "#fb7185";
                                    const pct = Math.max(0, Math.min(100, (a.hp / Math.max(1, a.maxHp)) * 100));
                                    return (
                                        <div key={a.id} onClick={() => onTileClick(a.pos)} title={`${a.name} ${a.hp}/${a.maxHp}`}
                                            style={{ position: "absolute", left: ox, top: oy, width: size, zIndex: 10 + row, cursor: targetable ? "pointer" : "default" }}>
                                            <div className={`avatar-orb${a.side === "enemy" ? " enemy-orb" : ""}`}
                                                style={{
                                                    width: size, height: size,
                                                    outline: isActive ? "3px solid #fde047" : targetable ? "3px solid #fca5a5" : "none",
                                                    outlineOffset: 2,
                                                    boxShadow: targetable ? "0 0 16px 4px rgba(248,113,113,0.9)" : undefined,
                                                }}>
                                                {img
                                                    ? <img className="tiny-map-avatar" src={img} alt={a.name} />
                                                    : <span style={{ fontSize: size * 0.52, lineHeight: 1 }} role="img" aria-label={a.name}>{emojiFor(a)}</span>}
                                                {isBoss && <span style={{ position: "absolute", top: -2, right: -2, fontSize: 16, filter: "drop-shadow(0 1px 2px #000)" }}>👑</span>}
                                            </div>
                                            {/* name + hp bar */}
                                            <div style={{ marginTop: 3, textAlign: "center", pointerEvents: "none" }}>
                                                <div style={{ height: 4, width: size, borderRadius: 2, background: "rgba(2,6,18,0.85)", border: "1px solid rgba(0,0,0,0.5)" }}>
                                                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: ringColor }} />
                                                </div>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: "#e2e8f0", textShadow: "0 1px 3px #000", whiteSpace: "nowrap", marginTop: 1 }}>
                                                    {a.name}{isBoss ? "" : ""}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Action bar */}
                    <div style={{ marginTop: 8, minHeight: 62 }}>
                        {myTurn ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 10, background: "linear-gradient(180deg, rgba(15,23,42,0.88), rgba(10,16,30,0.92))", border: "1px solid #334155" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 8, background: "#0b1220", border: "1px solid #334155" }}>
                                    <strong style={{ color: "#facc15", fontSize: "1.05rem", lineHeight: 1 }}>{session.activeAp}</strong>
                                    <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>AP</span>
                                    <span style={{ color: "#475569" }}>·</span>
                                    <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>{session.actionsThisTurn}/5 acts</span>
                                    <span style={{ color: "#475569" }}>·</span>
                                    <span title="Chakra" style={{ color: "#38bdf8", fontSize: "0.72rem", fontWeight: 700 }}>◆ {myChakra}</span>
                                    <span title="Stamina" style={{ color: "#a3e635", fontSize: "0.72rem", fontWeight: 700 }}>⬢ {myStamina}</span>
                                </span>
                                <ActBtn label="🏃 Move" sub="30 AP" on={mode === "move"} onClick={() => setMode(m => m === "move" ? "idle" : "move")} disabled={busy} />
                                <ActBtn label="⚔️ Attack" sub="40 AP" on={mode === "attack"} onClick={() => setMode(m => m === "attack" ? "idle" : "attack")} disabled={busy} />
                                {myWeapon && (
                                    <ActBtn label={`🗡 ${myWeapon.name ?? "Weapon"}`} sub={`${myWeapon.apCost ?? 40} AP${weaponThrown ? ` ·×${weaponLeft}` : ""}`}
                                        on={mode === "weapon"} onClick={() => setMode(m => m === "weapon" ? "idle" : "weapon")}
                                        disabled={busy || (weaponThrown && weaponLeft <= 0)} />
                                )}
                                {myPotion && (
                                    <ActBtn label={`🧪 ${myPotion.name ?? "Potion"}`} sub={`${myPotion.apCost ?? 35} AP ·×${potionLeft}`}
                                        on={false} onClick={() => void send({ type: "item", itemId: myPotion.id })}
                                        disabled={busy || potionLeft <= 0} />
                                )}
                                {myJutsu.length > 0 && (
                                    <select value={selJutsu?.id ?? ""} disabled={busy}
                                        onChange={e => {
                                            const j = myJutsu.find(x => x.id === e.target.value) ?? null;
                                            // Self-target jutsu (heals/buffs) cast on the caster immediately — no foe to pick.
                                            if (j && j.target === "SELF" && myActor) { void send({ type: "jutsu", jutsuId: j.id!, targetId: myActor.id }); return; }
                                            setSelJutsu(j); setMode(j ? "jutsu" : "idle");
                                        }}
                                        style={{ padding: "0.5rem", borderRadius: 8, background: mode === "jutsu" ? "#15233b" : "#0b1220", color: "#e2e8f0", border: `1px solid ${mode === "jutsu" ? "#60a5fa" : "#334155"}`, fontWeight: 700 }}>
                                        <option value="">✨ Jutsu…</option>
                                        {myJutsu.map(j => {
                                            const ck = Number(j.chakraCost ?? 0), st = Number(j.staminaCost ?? 0);
                                            const cd = Number(myActor?.cooldowns?.[j.id ?? ""] ?? 0);
                                            const afford = myChakra >= ck && myStamina >= st && cd <= 0;
                                            return <option key={j.id} value={j.id} disabled={!afford}>
                                                {j.name ?? j.id} · {j.ap ?? 40}AP{ck ? ` · ${ck}◆` : ""}{cd > 0 ? ` · CD${cd}` : ""}
                                            </option>;
                                        })}
                                    </select>
                                )}
                                <span style={{ flex: 1, minWidth: 4 }} />
                                {reject && <span style={{ color: "#f87171", fontSize: "0.78rem" }}>⚠ {reject}</span>}
                                <button onClick={() => void send({ type: "wait" })} disabled={busy}
                                    style={{ padding: "0.55rem 1.1rem", borderRadius: 8, fontWeight: 800, cursor: busy ? "default" : "pointer", color: "#dbeafe", background: "linear-gradient(180deg,#1e3a8a,#172554)", border: "1px solid #60a5fa", opacity: busy ? 0.6 : 1 }}>
                                    End turn ▶
                                </button>
                            </div>
                        ) : (
                            <p className="hint" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "rgba(15,23,42,0.7)", border: "1px solid #1e293b" }}>{session.status === "active" ? `${turnLabel || "Allies & enemies are acting…"}${afkRemaining != null ? ` · auto-passes in ${afkRemaining}s` : ""}` : ""}</p>
                        )}
                    </div>
                </main>

                {/* Enemy + log rail */}
                <aside style={{ minWidth: 0 }}>
                    <RailHeader icon="👹" label="Enemies" accent="#f87171" />
                    {enemies.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} boss={a.id === bossId} />)}
                    <RailHeader icon="📜" label="Battle Log" accent="#94a3b8" mt={12} />
                    <div style={{ maxHeight: 220, overflow: "auto", fontSize: "0.74rem", lineHeight: 1.45, color: "#cbd5e1", background: "rgba(2,6,18,0.55)", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 8px" }}>
                        {session.log.slice(-30).map((line, i) => <div key={i} style={{ padding: "1px 0", borderBottom: i < Math.min(29, session.log.length - 1) ? "1px solid rgba(30,41,59,0.5)" : undefined }}>{line}</div>)}
                    </div>
                </aside>
            </div>

            {/* Result overlay */}
            {session.status === "done" && (
                <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,14,0.82)" }}>
                    <div className="card" style={{ textAlign: "center", padding: "1.6rem", maxWidth: 420 }}>
                        <h1 style={{ marginTop: 0, color: session.winner === "squad" ? "#4ade80" : "#f87171" }}>
                            {session.winner === "squad" ? "🏆 Floor Cleared!" : "💀 Floor Failed"}
                        </h1>
                        {session.winner === "squad" && (
                            settle ? <p>Rewards settled. {settle.results[me]?.score ? `Score +${settle.results[me]!.score}` : ""}</p> : <p className="hint">Settling rewards…</p>
                        )}
                        <button style={{ marginTop: 12, padding: "0.7rem 1.4rem" }} onClick={onExit}>Return to the Tower</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tile fill (feature tint + state highlight) ───────────────────────────────
function tileFill(
    feat: TowerFeature | undefined,
    s: { isMove: boolean; inJ: boolean; isGoal: boolean; isBlocked: boolean },
): { background: string; borderColor: string; boxShadow?: string } {
    // Top-lit → dark-bottom gradient gives each hex a raised, beveled 3D look.
    const g = (top: string, bot: string) => `linear-gradient(180deg, ${top} 0%, ${bot} 100%)`;
    if (s.isMove) return { background: g("rgba(196,255,150,0.8)", "rgba(45,120,28,0.62)"), borderColor: "#bef264" };
    if (s.inJ) return { background: g("rgba(147,197,253,0.62)", "rgba(29,78,216,0.55)"), borderColor: "#60a5fa" };
    if (s.isBlocked) return { background: g("rgba(120,130,150,0.62)", "rgba(30,38,56,0.72)"), borderColor: "rgba(148,163,184,0.5)" };
    if (feat) {
        if (feat.kind === "pylon") {
            const c = PYLON_COLOR[feat.element] ?? PYLON_COLOR.Water!;
            return { background: g(c.top, c.bot), borderColor: c.border };
        }
        if (feat.kind === "ward") return { background: g("rgba(226,232,240,0.6)", "rgba(71,85,105,0.64)"), borderColor: "rgba(226,232,240,0.9)" };
        if (feat.kind === "hazard") return { background: g("rgba(254,160,120,0.68)", "rgba(127,29,29,0.68)"), borderColor: "rgba(248,113,113,0.95)" };
    }
    if (s.isGoal) return { background: g("rgba(253,224,71,0.62)", "rgba(133,77,14,0.62)"), borderColor: "#facc15" };
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

function ActorCard({ actor, highlight, avatar, emoji, boss, ally }: { actor: TowerActor; highlight: boolean; avatar: string | null; emoji: string; boss?: boolean; ally?: boolean }) {
    const pct = Math.max(0, Math.min(100, (actor.hp / Math.max(1, actor.maxHp)) * 100));
    const dead = actor.hp <= 0;
    const accent = actor.side === "squad" ? "#4ade80" : actor.side === "npc" ? "#facc15" : "#f87171";
    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 7px", marginBottom: 5, borderRadius: 6, background: highlight ? "#15233b" : "rgba(11,18,32,0.7)", border: `1px solid ${highlight ? "#60a5fa" : "#1e293b"}`, opacity: dead ? 0.4 : 1 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220" }}>
                {avatar ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 15 }}>{emoji}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", gap: 4 }}>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boss ? "👑 " : ally ? "🛡️ " : ""}{actor.name}{ally ? " (protect)" : ""}</strong>
                    <span style={{ color: "#94a3b8", flexShrink: 0 }}>{Math.max(0, actor.hp)}/{actor.maxHp}</span>
                </div>
                <div style={{ height: 5, background: "#0b1220", borderRadius: 3, marginTop: 3 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: dead ? "#475569" : accent }} />
                </div>
                {actor.side === "squad" && (
                    <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        <MiniBar val={actor.chakra} max={actor.maxChakra} color="#38bdf8" />
                        <MiniBar val={actor.stamina} max={actor.maxStamina} color="#a3e635" />
                    </div>
                )}
                {actor.statuses.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 3 }}>
                        {actor.statuses.slice(0, 8).map((st, i) => <StatusChip key={i} status={st} />)}
                    </div>
                )}
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

function ActBtn({ label, sub, on, onClick, disabled }: { label: string; sub?: string; on: boolean; onClick: () => void; disabled: boolean }) {
    return (
        <button onClick={onClick} disabled={disabled}
            style={{
                display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 70,
                padding: "0.4rem 0.8rem", borderRadius: 8, fontWeight: 700, cursor: disabled ? "default" : "pointer",
                border: `1px solid ${on ? "#60a5fa" : "#334155"}`, color: "#e2e8f0", opacity: disabled ? 0.6 : 1,
                background: on ? "linear-gradient(180deg,#1d3a6b,#15233b)" : "linear-gradient(180deg,#131c2e,#0b1220)",
                boxShadow: on ? "0 0 10px rgba(96,165,250,0.4)" : undefined,
            }}>
            <span>{label}</span>
            {sub && <small style={{ color: "#94a3b8", fontSize: "0.64rem", fontWeight: 600 }}>{sub}</small>}
        </button>
    );
}

function RailHeader({ icon, label, accent, mt }: { icon: string; label: string; accent: string; mt?: number }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 7, margin: `${mt ?? 0}px 0 8px`, padding: "5px 8px", borderRadius: 7, background: "rgba(15,23,42,0.65)", borderLeft: `3px solid ${accent}` }}>
            <span style={{ fontSize: 15 }}>{icon}</span>
            <strong style={{ fontSize: "0.88rem", letterSpacing: 0.3 }}>{label}</strong>
        </div>
    );
}
