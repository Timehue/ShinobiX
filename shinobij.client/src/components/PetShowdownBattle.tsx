/*
 * PetShowdownBattle — the cinematic playback layer for Pet Showdown.
 *
 * The battle is resolved ON THE SERVER (api/_pet-showdown/engine.ts): this
 * component only (1) collects one round of commands through the command deck, (2) POSTs them, and (3) plays back the returned turn script
 * beat by beat — camera cuts, lunges, projectiles, damage numbers, banners.
 * It never computes a combat number; every figure on screen arrived in an event.
 *
 * Presentation is the product here (the Stadium lesson): one action at a time,
 * each sold with a camera move, a windup→strike→recover clip, an impact flash,
 * a popped damage number and an effectiveness banner. The 3D layer is the
 * proven Coliseum stack — PetModel3D + PetModelBoundary + the projectile visual
 * spec — driven by per-fighter PetModelFrame refs.
 *
 * Fullscreen overlay contract (project rule): portals to document.body with the
 * .pet-combat-takeover class, locks body scroll via .pet-combat-active, and
 * reports the two SEPARATE lifted signals (fullscreen presentation vs
 * unresolved battle) through callbacks the host screen owns.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Sparkles } from "@react-three/drei";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SHOWDOWN_POST_SHADER } from "../lib/showdown-post";
import { petBloomEnabled } from "../lib/pet-coliseum-flag";
import * as THREE from "three";
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelFrame } from "./PetModel3D";
import { PetModelBoundary } from "./PetModelBoundary";
import { petCombatModel, showdownFighterIdentity, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { petHeroMoveStyle, type PetHeroMoveStyle } from "../lib/pet-hero-moves";
import {
    ScarLayer, ResidueFx, ClimateLayer, KindAccentFx, CastGlyphFx, ChargeOrbFx, StreakBurstFx, DebrisFx, kindAccentFamily,
    type BattleScar, type ResidueSpawn, type ClimateState, type KindAccentSpawn, type StreakBurstSpawn,
} from "./PetShowdownVfx3d";
import { petCardImage } from "../lib/pet-battle-anim";
import { startBattleMusic, stopBattleMusic, setBattleMusicIntensity, isAudioMuted, setAudioMuted } from "../lib/pet-music";
import { playPetSfx, primePetSfx, petHaptic } from "../lib/pet-sfx";
import { petDuelImpactStrength } from "../lib/pet-duel-presentation";
import { promptablePets } from "../lib/showdown-turn";
import { prefersReducedMotion } from "../lib/device-tier";
import {
    ShowdownVfxLayer,
    ShowdownSetPieceLayer,
    StatusAuraFx,
    BeatDrivenVfx,
    SuperPillar,
    impactFlipbookKey,
    vfxElementTint as elementVfxTint,
    type VfxSpawn,
    type SetPieceSpawn,
    type PillarDrive,
} from "./PetShowdownVfx";
import { ShowdownIcon, type ShowdownIconName } from "./icons/ShowdownIcon";
import { SceneAmbience } from "./SceneAmbience";
import type { Biome, WeatherType } from "../types/core";
import { ELEMENT_ICON } from "../lib/element-icons";
import { fitDistance, framedExtent, showdownFov, shotWeight, type ShotWeight } from "../lib/showdown-camera";
import { resolveOpponentFacing } from "../lib/pet-combat-performance";
import { pairedShowdownOpponentId, showdownLaneFacing, showdownSlotLane } from "../lib/pet-showdown-facing";
import {
    showdownBodyRadius,
    showdownCinematicImpulse,
    showdownDodgeOffset,
    showdownMeleeContact,
    showdownMeleeDrive,
    showdownPerformanceVariant,
    showdownReactionAge,
    showdownReactionRecoil,
} from "../lib/pet-showdown-choreography";
import { petSignaturePerformance, type PetSignaturePerformance } from "../lib/pet-signature-performance";
import { petVisualQuality } from "../lib/pet-visual-quality";
import {
    SHOWDOWN_ELEMENT_BEATS,
    SHOWDOWN_GUARD_COST,
    SHOWDOWN_REST_PCT,
    SHOWDOWN_METER_ON_GUARDED_HIT,
    SHOWDOWN_METER_ON_HIT_TAKEN,
} from "../../../shared/pet-showdown-contract";
import type { Pet } from "../types/pet";
import type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTurnResponse,
    ShowdownTurnResult,
} from "../lib/pet-showdown-api";

// ─── Staging constants ───────────────────────────────────────────────────────

// Staging (owner note: "give the pets a little space — they're just standing
// there really close together"): allies stand a full body apart, the lines a
// touch further from each other, and each slot staggers off the baseline so a
// team reads as individuals taking the field, not a queue.
const PLAYER_Z = 4.1;
const ENEMY_Z = -4.1;

const SLOT_SPACING = 3.6;
const FLOOR_Y = 0;
/** KO withdrawal: how long a fallen body may lie in its slot before it leaves
 *  regardless of the queue (the queue normally moves it on sooner), and how
 *  long the sink-out itself takes. */
const KO_MAX_HOLD_MS = 2400;
const KO_SINK_MS = 480;

// ── Arena roster: five painted stages, picked per session. ──────────────────
// Crowd-integrated backdrops were tried (round 34) and REVERTED by owner
// ruling (2026-08-13): the painted spectators read as blobs in close-ups.
// The stages keep the original scenery art; the crowd exists only as the
// confetti-eruption moments.
const STAGES = {
    coliseum: {
        floor: new URL("../assets/coliseum/coliseum-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/coliseum-bg.webp", import.meta.url).href,
        ember: "#ff7a35", ambient: "#8fc7ff",
    },
    grove: {
        floor: new URL("../assets/coliseum/grove-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/grove-bg.webp", import.meta.url).href,
        ember: "#9fe7a0", ambient: "#bfe9c9",
    },
    frost: {
        floor: new URL("../assets/coliseum/frost-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/frost-bg.webp", import.meta.url).href,
        ember: "#9fd8ff", ambient: "#cfe9ff",
    },
    storm: {
        floor: new URL("../assets/coliseum/storm-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/storm-bg.webp", import.meta.url).href,
        ember: "#ffe24a", ambient: "#9aa7d8",
    },
    volcano: {
        floor: new URL("../assets/coliseum/volcano-floor.webp", import.meta.url).href,
        bg: new URL("../assets/coliseum/volcano-bg.webp", import.meta.url).href,
        ember: "#ff5a2c", ambient: "#ffb08a",
    },
} as const;
type StageKey = keyof typeof STAGES;
const STAGE_KEYS = Object.keys(STAGES) as StageKey[];

function stageForSession(sessionId: string): StageKey {
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
    return STAGE_KEYS[Math.abs(hash) % STAGE_KEYS.length];
}

const ELEMENT_TINT: Record<string, string> = {
    Fire: "#ff7a35", Water: "#38bdf8", Wind: "#5eead4", Lightning: "#fde047", Earth: "#d6a76a", None: "#a5b4fc",
};

/** One authored crest per element. The painted WebP (ELEMENT_ICON) is used only
 *  at >=48px — 5-9 KB of paint turns to mud below ~32px, and only the vector
 *  tints with `color`. */
const ELEMENT_CREST: Record<string, ShowdownIconName> = {
    Fire: "elem-fire", Water: "elem-water", Wind: "elem-wind",
    Lightning: "elem-lightning", Earth: "elem-earth", None: "elem-none",
};

function elementCrest(element: string): ShowdownIconName {
    return ELEMENT_CREST[element] ?? "elem-none";
}

/** Move kinds collapse onto a smaller set of marks than there are kinds: the
 *  four directional control kinds share one glyph, and burn/dot are one idea.
 *  `aegis` (a held object, flat soak) and `veil` (a field over you) are
 *  deliberately NOT the same mark — that distinction is why the column exists. */
const KIND_GLYPH: Record<string, ShowdownIconName> = {
    damage: "strike", crush: "crush", lifesteal: "siphon", wound: "rend",
    burn: "pyre", dot: "pyre",
    stun: "bind", freeze: "frost", confuse: "daze",
    slow: "drag", movelock: "drag", push: "drag", pull: "drag",
    // These three fell through to the "strike" fallback, so the two headline
    // variety techniques and the new rotation all wore the plain-attack mark:
    // a weather-setter advertised itself as a hit. `pivot` takes the switch
    // mark because that is literally what it does; `protect` braces.
    pivot: "rotate", protect: "brace",
    mark: "mark", taunt: "provoke",
    heal: "mend", shield: "aegis", guard: "aegis", barrier: "veil", absorb: "veil",
    buff: "wax", debuff: "wane", haste: "haste", move: "haste", rest: "breath",
};

/** The mark a technique wears. Weather is the one kind whose identity IS its
 *  element — it turns the arena to that sky — so it wears the element crest
 *  instead of a fixed glyph. Everything else reads from the table, and an
 *  unmapped kind still falls back to the plain strike. */
function kindGlyph(kind: string, element?: string): ShowdownIconName {
    if (kind === "weather" && element) return elementCrest(element);
    return KIND_GLYPH[kind] ?? "strike";
}

/** Offense / control / support — the icon's own colour, never a background. */
const KIND_FAMILY: Record<string, "off" | "ctl" | "sup"> = {
    damage: "off", crush: "off", lifesteal: "off", wound: "off", burn: "off", dot: "off",
    stun: "ctl", freeze: "ctl", confuse: "ctl", slow: "ctl", movelock: "ctl",
    push: "ctl", pull: "ctl", mark: "ctl", taunt: "ctl", debuff: "ctl",
    pivot: "off", protect: "sup", weather: "sup",
    heal: "sup", shield: "sup", guard: "sup", barrier: "sup", absorb: "sup",
    buff: "sup", haste: "sup", move: "sup", rest: "sup",
};

/** A weather technique turns the arena's sky, and it uses the SAME weather the
 *  overworld already runs (SceneAmbience) rather than a second private system:
 *  a Water sage makes it rain on the field exactly like rain in a sector, and a
 *  Lightning sage brings the same thunderstorm with its procedural bolts.
 *
 *  The pairing is the element's real-world weather, which is also the one that
 *  reads as "this is boosting that element":
 *    Water     -> rain          Lightning -> thunderstorm
 *    Fire      -> desertHaze (drought shimmer)
 *    Wind      -> tornado       Earth     -> ashfall (driving dust)
 *  The in-scene tint and light stay with ClimateLayer; this is the sky. */
const ELEMENT_WEATHER: Record<string, { weather: WeatherType; biome: Biome }> = {
    // SceneAmbience always draws a BIOME particle underneath the weather, so
    // the biome is picked to suit the element rather than left on the default
    // (which sprinkled neutral motes through every sky). The pair is what sells
    // it: embers under drought haze read as a furnace, leaves under a gale read
    // as wind you can see.
    Water: { weather: "rain", biome: "central" },
    Lightning: { weather: "thunderstorm", biome: "central" },
    Fire: { weather: "desertHaze", biome: "volcano" },
    Wind: { weather: "tornado", biome: "forest" },
    Earth: { weather: "ashfall", biome: "central" },
};

const STATUS_GLYPH: Record<string, ShowdownIconName> = {
    burn: "pyre", wound: "rend", stun: "bind", freeze: "frost", confuse: "daze",
    debuff: "wane", buff: "wax", shield: "aegis", mark: "mark", slow: "drag",
    haste: "haste", crush: "crush", taunt: "provoke", steadfast: "steadfast",
    protect: "brace",
    // The bench is what a root denies, so the bench is what it wears.
    movelock: "bench",
};

/** Plain English for every status the view can actually carry. `tauntGuard` is
 *  unreachable (the engine renames it in 1v1). `movelock` USED to be unreachable
 *  too — the engine aliased it to `slow` — until it became a real trap. */
const STATUS_TITLE: Record<string, string> = {
    burn: "Burning — takes damage each round",
    wound: "Wounded — bleeds each round and heals for less",
    stun: "Stunned — loses its next action",
    freeze: "Frozen — may lose its next action",
    confuse: "Confused — may hit itself instead",
    debuff: "Weakened — deals less damage",
    buff: "Empowered — deals more damage",
    shield: "Shielded — absorbs incoming damage",
    mark: "Marked — the next hit lands harder",
    slow: "Slowed — acts later in the round",
    movelock: "Trapped — cannot switch out",
    protect: "Braced — blocks all damage this round",
    haste: "Hastened — acts earlier in the round",
    crush: "Crushed — defence lowered",
    taunt: "Taunting — draws single-target attacks",
    steadfast: "Steadfast — immune to stun and freeze",
};

function statusTitle(s: { kind: string; rounds: number; magnitude: number }): string {
    const base = STATUS_TITLE[s.kind] ?? s.kind;
    const pool = s.kind === "shield" && s.magnitude > 0 ? ` (${s.magnitude} left)` : "";
    return `${base}${pool} · ${s.rounds} round${s.rounds === 1 ? "" : "s"}`;
}

// Moves that never point at an enemy (mirror of the server's routing).
const SELF_MOVE_KINDS = new Set(["buff", "haste", "move", "shield", "barrier", "absorb", "taunt"]);
const ALLY_MOVE_KINDS = new Set(["heal"]);

type ActionEvent = Extract<ShowdownEvent, { t: "action" }>;

/** The word that pops over a pet when its battle consumable fires. */
const CONSUMABLE_CALLOUT: Record<Extract<ShowdownEvent, { t: "consumable" }>["effect"], string> = {
    dodge: "DODGED!",
    mitigate: "SOFTENED!",
    endure: "ENDURED!",
    thorns: "THORNS!",
    lifeline: "LIFELINE!",
    cleanse: "CLEANSED!",
};

/** mulberry32 — module-level so render-scope closures never reassign
 *  captured variables (react-compiler immutability rule). */
function sceneRand(seed: number): () => number {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function beatDurationMs(event: ShowdownEvent, speed: number): number {
    // Staged casts (signatures and heavies — the ones that earn a volumetric
    // set-piece) own their WHOLE choreography: the piece spawns at the strike
    // (STRIKE_FRAC) and runs 2100/1150ms, so the beat must hold the strike
    // point + the full piece + a settle breath of stillness before the next
    // actor winds up. 3300 used to end a super beat 600ms before the tsunami
    // finished landing — the next move attacked THROUGH the spectacle.
    //   super: 6400 → strike 3520 + piece 2100 (fade INCLUDED) + ~780ms of
    //          genuinely still arena before the next windup
    //   heavy: 4100 → strike 2255 + piece 1150 + ~700ms stillness
    //   normal: 2700 → burst done ~2100 + ~600ms breath
    // The first pass counted the piece's fade tail as "settle" — the wave was
    // still visibly dissolving when the next actor moved (owner: "the enemy
    // moves during the surf animation"). Stillness now means STILLNESS.
    // A killing blow buys the beat extra air on top of its class: the impact
    // frame, the fall, and a breath of silence before anything else moves.
    const koAir = event.t === "action" && event.targets.some((t) => t.ko && t.id !== event.actorId) ? 1100 : 0;
    const base = koAir + (event.t === "action" ? (
        event.super ? 6400
        : (event.moveKind === "guard" || event.moveKind === "rest") ? 1200
        : event.weight === "heavy" ? 4100
        : 2700)
        : event.t === "roundStart" ? 950
        : event.t === "skip" ? 900
        : event.t === "switch" ? 1500
        : event.t === "confused" ? 1200
        : event.t === "dot" ? 850
        : event.t === "consumable" ? 900
        // The verdict banner plus the settling camera hold — at speed 2 a
        // shorter beat cuts the KO fade off mid-fall.
        : event.t === "end" ? 1700
        : 350);
    return base / speed;
}

/** Fraction of an action beat at which the hit lands (damage pops, camera kicks). */
const STRIKE_FRAC = 0.55;

// ─── Shared mutable scene state (refs — read per frame inside the Canvas) ────

interface SceneBeat {
    event: ShowdownEvent | null;
    startedAt: number;
    durationMs: number;
    /** Queue position — the shot-variant seed. Deliberately NOT startedAt,
     *  which is a wall clock and would pick different framings on replay. */
    index: number;
}

interface SceneFx {
    /** petId → timestamp of the last landed hit (drives stagger + hit flash). */
    hitAt: Map<string, number>;
    /** petId → damage-scaled recoil weight for that hit. PetModel3D reads
     *  this as impactPower (0.45-1.25) to drive pitch, squash and weight —
     *  left unset it pinned every hit to the same restrained flinch. */
    hitPower: Map<string, number>;
    /** petId → normalized attacker-to-victim direction. The visible stagger
     *  travels away from the blow instead of folding in place. */
    hitDirection: Map<string, readonly [number, number]>;
    /** Reactive dodge items trigger a real one-shot body evade on every rig. */
    dodgeAt: Map<string, number>;
    shakeUntil: number;
    shakeAmp: number;
    /** Skeletal animation freezes until this timestamp — damage-scaled
     *  hit-stop (the fighting-game contact freeze). */
    hitStopUntil: number;
    /** Post-contact presentation time and lens response. Combat simulation and
     * command timing remain authoritative and are never slowed. */
    slowUntil: number;
    slowScale: number;
    lensStartedAt: number;
    lensUntil: number;
    lensAmp: number;
    superFocus: boolean;
    /** The stands erupt: set at a landed signature or the killing blow, read
     *  by the stage's confetti/roar layer. */
    crowdBurstAt: number;
    crowdBurstKind: "super" | "ko";
}

interface FighterSlotInfo {
    view: ShowdownPetView;
    side: "player" | "enemy";
    basePos: [number, number, number];
    model: PetCombatModelConfig | null;
    fallbackImage: string;
}

function slotPositions(count: number, side: "player" | "enemy"): [number, number, number][] {
    const z = side === "player" ? PLAYER_Z : ENEMY_Z;
    return Array.from({ length: count }, (_, i) => {
        const x = showdownSlotLane(i, count, side) * SLOT_SPACING;
        // Alternate slots step off the baseline: a staggered line has depth
        // and silhouette, a flat rank reads as a queue.
        const depth = (i % 2 === 0 ? 0 : 0.9) * (side === "player" ? 1 : -1);
        return [x, FLOOR_Y, z + depth] as [number, number, number];
    });
}

/** Who stands where. Fielded pets hold the front slots; the bench waits in a
 *  back row and pets physically RUN between rows on switches. */
interface Lineup {
    playerField: string[];
    playerBench: string[];
    enemyField: string[];
    enemyBench: string[];
}

function lineupFromState(state: ShowdownStateView): Lineup {
    return {
        playerField: state.player.filter((p) => !p.benched).map((p) => p.id),
        playerBench: state.player.filter((p) => p.benched).map((p) => p.id),
        enemyField: state.enemy.filter((p) => !p.benched).map((p) => p.id),
        enemyBench: state.enemy.filter((p) => p.benched).map((p) => p.id),
    };
}

function computeArrangement(lineup: Lineup): Map<string, [number, number, number]> {
    const out = new Map<string, [number, number, number]>();
    const place = (ids: string[], side: "player" | "enemy", bench: boolean) => {
        if (bench) {
            // The bench waits OFF-STAGE at the tunnel mouth (player left, enemy
            // right), past the arena rim and outside every camera the director
            // owns. Reserves used to stand in the wings on screen; now the
            // roster only exists on the field — a chosen reserve GALLOPS in
            // from the tunnel (the fighters' walk-home chase covers ~9 units
            // in about a second), and a pulled pet gallops off and vanishes.
            ids.forEach((id, i) => {
                const wing = side === "player" ? -1 : 1;
                out.set(id, [wing * (10.4 + i * 1.2), FLOOR_Y, side === "player" ? 6.2 : -6.2]);
            });
            return;
        }
        const positions = slotPositions(ids.length, side);
        ids.forEach((id, i) => out.set(id, positions[i]));
    };
    place(lineup.playerField, "player", false);
    place(lineup.playerBench, "player", true);
    place(lineup.enemyField, "enemy", false);
    place(lineup.enemyBench, "enemy", true);
    return out;
}

/** Moves a pet between the field and bench lists of its side. On a voluntary
 *  switch the outgoing pet walks to the bench row; on a reinforcement the
 *  fallen pet simply drops out of the arrangement (the body stays where it
 *  fell — fighters freeze when their id has no assigned position). */
function lineupAfterSwitch(lineup: Lineup, side: "player" | "enemy", outId: string, inId: string, reinforcement: boolean): Lineup {
    const fieldKey = side === "player" ? "playerField" : "enemyField";
    const benchKey = side === "player" ? "playerBench" : "enemyBench";
    const field = lineup[fieldKey].map((id) => (id === outId ? inId : id));
    if (!field.includes(inId)) field.push(inId);
    return {
        ...lineup,
        [fieldKey]: field,
        [benchKey]: lineup[benchKey]
            .filter((id) => id !== inId)
            .concat(!reinforcement && outId !== inId ? [outId] : []),
    };
}

// ─── Stage environment (lifted from the proven Coliseum recipe) ──────────────

/** The lightrig — four beams that snap on for a SIGNATURE and sweep onto the
 *  arena, tinted by the cast's element. The rig only exists in the super
 *  moment: house lights for the one beat per fight that is allowed to shout. */
function SuperLightRig({ beatRef }: { beatRef: React.MutableRefObject<SceneBeat> }) {
    const beams = useRef<Array<THREE.Mesh | null>>([]);
    useFrame((state) => {
        const beat = beatRef.current;
        const isSuper = beat.event?.t === "action" && beat.event.super;
        const frac = isSuper ? Math.min(1, (performance.now() - beat.startedAt) / beat.durationMs) : 0;
        const tint = isSuper && beat.event?.t === "action" ? (ELEMENT_TINT[beat.event.element] ?? "#fde9bd") : "#fde9bd";
        beams.current.forEach((b, i) => {
            if (!b) return;
            if (!isSuper) { b.visible = false; return; }
            b.visible = true;
            const mat = b.material as THREE.MeshBasicMaterial;
            // Rise fast, hold through the strike, die with the beat.
            mat.opacity = (frac < 0.12 ? frac / 0.12 : frac > 0.82 ? (1 - frac) / 0.18 : 1) * 0.16;
            mat.color.set(tint);
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            b.position.set(Math.cos(a) * 14.2, 12.8, Math.sin(a) * 14.2);
            b.lookAt(0, 0.5, 0);
            b.rotateX(Math.PI / 2);
            // A slow sweep sells "operated", not "painted on".
            b.rotation.z += Math.sin(state.clock.elapsedTime * 1.3 + i * 1.7) * 0.05;
        });
    });
    return (
        <group>
            {Array.from({ length: 4 }, (_, i) => (
                <mesh key={i} ref={(el) => { beams.current[i] = el; }} visible={false}>
                    <cylinderGeometry args={[0.1, 1.9, 21, 8, 1, true]} />
                    <meshBasicMaterial
                        transparent
                        opacity={0}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        toneMapped={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}
        </group>
    );
}

function StageEnvironment({ stage, beatRef, fxRef }: { stage: StageKey; beatRef: React.MutableRefObject<SceneBeat>; fxRef: React.MutableRefObject<SceneFx> }) {
    const art = STAGES[stage];
    const textures = useMemo(() => {
        const loader = new THREE.TextureLoader();
        const floor = loader.load(art.floor);
        floor.colorSpace = THREE.SRGBColorSpace;
        const backdrop = loader.load(art.bg);
        backdrop.colorSpace = THREE.SRGBColorSpace;
        backdrop.wrapS = THREE.MirroredRepeatWrapping;
        // 2.5 tiles over the now-FULL ring keeps the painted arches at the same
        // apparent width the old 1.6π arc had at 2 tiles.
        backdrop.repeat.set(2.5, 1);
        return { floor, backdrop };
    }, [art]);
    const ambient = useRef<THREE.AmbientLight>(null);
    const sun = useRef<THREE.DirectionalLight>(null);
    const ember = useRef<THREE.PointLight>(null);
    const dim = useRef(1);
    useFrame((state, delta) => {
        const t = state.clock.elapsedTime;
        // The arena reacts to contact: reuse the CAMERA's own shake envelope so
        // the light punch and the screen shake can never drift apart.
        const fx = fxRef.current;
        const now = performance.now();
        let punch = 0;
        if (now < fx.shakeUntil) {
            const k = (fx.shakeUntil - now) / 320;
            punch = Math.min(1, fx.shakeAmp * k * k * 4);
        }
        // The CHARGE DIM: while a signature (or heavy) channels, the stage
        // lights fall away so the charge orb and glyph carry the frame — the
        // reference grammar where the whole arena goes dark blue around the
        // caster's glow. Eases in and releases AT the strike.
        const beat = beatRef.current;
        let dimTarget = 1;
        if (beat.event?.t === "action" && (beat.event.super || beat.event.weight === "heavy")) {
            const frac = (now - beat.startedAt) / beat.durationMs;
            if (frac > 0.08 && frac < 0.53) dimTarget = beat.event.super ? 0.4 : 0.7;
        }
        dim.current = THREE.MathUtils.lerp(dim.current, dimTarget, Math.min(1, delta * (dimTarget < dim.current ? 3.2 : 9)));
        if (ambient.current) ambient.current.intensity = (0.5 + Math.sin(t * 7.3) * 0.02 + Math.sin(t * 12.7) * 0.014) * dim.current + punch * 0.9;
        if (sun.current) sun.current.intensity = (1.15 + Math.sin(t * 9.1) * 0.035) * dim.current;
        if (ember.current) {
            ember.current.intensity = 12 + punch * 26;
            // Tint the EMBER only — the key and hemi lights carry each painted
            // arena's identity and must not be recoloured by combat.
            const beat = beatRef.current;
            const el = beat.event?.t === "action" ? beat.event.element : "";
            ember.current.color.set(punch > 0.02 && el ? (ELEMENT_TINT[el] ?? art.ember) : art.ember);
        }
    });
    return (
        <group>
            <ambientLight ref={ambient} intensity={0.5} />
            <hemisphereLight args={[art.ambient, "#4a210d", 0.56]} />
            <directionalLight
                ref={sun}
                position={[5, 10, 6]}
                intensity={1.15}
                color="#ffe0b5"
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
                shadow-camera-near={1}
                shadow-camera-far={30}
                shadow-camera-left={-12}
                shadow-camera-right={12}
                shadow-camera-top={12}
                shadow-camera-bottom={-12}
            />
            <directionalLight position={[-7, 5, -7]} intensity={0.6} color="#79aaff" />
            <pointLight ref={ember} position={[0, 3.5, 2]} intensity={12} distance={15} decay={2} color={art.ember} />
            {/* FULL ring + a night cap. The wall used to cover 1.6π of arc with
                nothing behind the remaining 72° — the action camera's off-axis
                cuts looked straight through the gap into raw void, and a third
                of the frame went black mid-beat. MirroredRepeat makes the extra
                arc seamless; the cap closes the sky the low shots tilt into. */}
            <mesh position={[0, 6.0, 0]}>
                <cylinderGeometry args={[19, 19, 21, 60, 1, true]} />
                <meshBasicMaterial map={textures.backdrop} side={THREE.BackSide} toneMapped={false} fog={false} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 16.4, 0]}>
                <circleGeometry args={[19.2, 48]} />
                <meshBasicMaterial color="#0b0704" toneMapped={false} fog={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
                <circleGeometry args={[14, 64]} />
                <meshStandardMaterial map={textures.floor} roughness={0.95} />
            </mesh>
            {/* Stage-tinted drifting motes — living air (embers/spores/snow). */}
            <Sparkles count={38} scale={[16, 6, 14]} position={[0, 3, 0]} size={2.6} speed={0.28} color={art.ember} opacity={0.5} />
            <StageAmbient stage={stage} />
            <CrowdEruption fxRef={fxRef} ember={art.ember} />
            <SuperLightRig beatRef={beatRef} />
        </group>
    );
}

/** Each stage carries its own weather so the arena is alive between beats:
 *  snowfall over the frost bowl, leaves drifting through the grove, embers
 *  climbing off the volcano floor, and the storm sky flashing distant
 *  lightning through the arches. The coliseum keeps its lantern motes. */
function StageAmbient({ stage }: { stage: StageKey }) {
    const points = useRef<THREE.Points>(null);
    const flash = useRef<THREE.DirectionalLight>(null);
    const nextFlash = useRef(0);
    const COUNT = 44;
    const kind = stage === "frost" ? "snow" : stage === "grove" ? "leaves" : stage === "volcano" ? "embers" : stage === "storm" ? "storm" : "none";
    const params = useMemo(() => {
        let h = 0;
        for (const c of stage) h = (h * 31 + c.charCodeAt(0)) | 0;
        const rand = sceneRand(h);
        return Array.from({ length: COUNT }, () => ({
            x: (rand() - 0.5) * 26,
            z: (rand() - 0.5) * 22,
            speed: 0.3 + rand() * 0.7,
            phase: rand(),
            sway: 0.4 + rand() * 1.1,
        }));
    }, [stage]);
    useFrame((state) => {
        const t = state.clock.elapsedTime;
        if (points.current && kind !== "none" && kind !== "storm") {
            const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
            const pos = attr.array as Float32Array;
            for (let i = 0; i < params.length; i++) {
                const p = params[i];
                const cycle = (t * p.speed * 0.12 + p.phase) % 1;
                pos[i * 3] = p.x + Math.sin(t * 0.5 + p.phase * 9) * p.sway;
                // Snow/leaves sink; embers climb.
                pos[i * 3 + 1] = kind === "embers" ? 0.3 + cycle * 9 : 9.5 - cycle * 9;
                pos[i * 3 + 2] = p.z + Math.cos(t * 0.4 + p.phase * 7) * p.sway * 0.7;
            }
            attr.needsUpdate = true;
        }
        if (flash.current && kind === "storm") {
            const now = t;
            if (now >= nextFlash.current) {
                // Two-pulse strike, then quiet for 6-12 seconds.
                nextFlash.current = now + 6 + (Math.sin(now * 13.7) * 0.5 + 0.5) * 6;
            }
            const sinceScheduled = nextFlash.current - now;
            const active = sinceScheduled > 5.72 || (sinceScheduled < 5.5 && sinceScheduled > 5.38);
            flash.current.intensity = active ? 1.9 : 0;
        }
    });
    if (kind === "none") return null;
    if (kind === "storm") {
        return <directionalLight ref={flash} position={[6, 14, -8]} intensity={0} color="#cdd8ff" />;
    }
    const color = kind === "snow" ? "#e8f4ff" : kind === "leaves" ? "#9fd8a0" : "#ffb066";
    return (
        <points ref={points}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array(COUNT * 3), 3]} />
            </bufferGeometry>
            <pointsMaterial color={color} size={kind === "leaves" ? 0.22 : 0.16} transparent opacity={0.75} depthWrite={false} sizeAttenuation />
        </points>
    );
}

/** Compact native-Three lens stack. The charge orb and volumetric scene meshes
 * supply the directional rays; this pass lifts their HDR bloom, resolves edges,
 * and adds the contact-only chromatic/zoom punch without a second renderer
 * framework in the production bundle. */
function ShowdownPostStack({ fxRef }: { fxRef: React.MutableRefObject<SceneFx> }) {
    const gl = useThree((s) => s.gl);
    const scene = useThree((s) => s.scene);
    const camera = useThree((s) => s.camera);
    const size = useThree((s) => s.size);
    const stackRef = useRef<{ composer: EffectComposer; finish: ShaderPass } | null>(null);
    useEffect(() => {
        const composer = new EffectComposer(gl);
        // The depth-resolve crash came from an MSAA composer. Keep the native
        // canvas antialiased and the offscreen lens targets explicitly single-sample.
        composer.renderTarget1.samples = 0;
        composer.renderTarget2.samples = 0;
        const render = new RenderPass(scene, camera);
        const finish = new ShaderPass(SHOWDOWN_POST_SHADER);
        composer.addPass(render);
        composer.addPass(finish);
        stackRef.current = { composer, finish };
        return () => {
            stackRef.current = null;
            composer.dispose();
        };
    }, [camera, gl, scene]);
    useEffect(() => {
        const stack = stackRef.current;
        if (!stack) return;
        stack.composer.setPixelRatio(gl.getPixelRatio());
        stack.composer.setSize(size.width, size.height);
        stack.finish.uniforms.resolution.value.set(size.width * gl.getPixelRatio(), size.height * gl.getPixelRatio());
    }, [gl, size.height, size.width]);
    useFrame(() => {
        const stack = stackRef.current;
        if (!stack) return;
        const fx = fxRef.current;
        const now = performance.now();
        let punch = 0;
        if (now < fx.shakeUntil) {
            const k = (fx.shakeUntil - now) / 320;
            punch = Math.min(1, fx.shakeAmp * k * k * 4);
        }
        stack.finish.uniforms.offset.value.set(0.0003 + punch * 0.0034, 0.0002 + punch * 0.002);
        stack.finish.uniforms.strength.value = punch * 0.085;
        stack.composer.render();
    }, 1);
    return null;
}

/** The stands ERUPT: confetti bursting inward off the bowl rim on a landed
 *  signature or the killing blow, while the lighting punch (already wired to
 *  the same fx clock) surges the painted crowd. Deterministic per burst —
 *  particle params reseed from the burst timestamp. */
function CrowdEruption({ fxRef, ember }: { fxRef: React.MutableRefObject<SceneFx>; ember: string }) {
    const points = useRef<THREE.Points>(null);
    const mat = useRef<THREE.PointsMaterial>(null);
    const COUNT = 160;
    const seedAt = useRef(0);
    const params = useRef<Array<{ angle: number; drop: number; drift: number; phase: number; ring: number }>>([]);
    const dot = useMemo(() => {
        const cv = document.createElement("canvas");
        cv.width = 32; cv.height = 32;
        const ctx = cv.getContext("2d")!;
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.5, "rgba(255,255,255,0.9)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 32, 32);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }, []);
    useFrame(() => {
        if (!points.current || !mat.current) return;
        const fx = fxRef.current;
        const now = performance.now();
        const life = (now - fx.crowdBurstAt) / (fx.crowdBurstKind === "ko" ? 2600 : 1900);
        if (fx.crowdBurstAt === 0 || life < 0 || life >= 1) {
            points.current.visible = false;
            return;
        }
        if (seedAt.current !== fx.crowdBurstAt) {
            // Reseed the burst once — mulberry-style from the timestamp.
            seedAt.current = fx.crowdBurstAt;
            const rand = sceneRand(fx.crowdBurstAt);
            params.current = Array.from({ length: COUNT }, () => ({
                angle: rand() * Math.PI * 2,
                drop: 0.5 + rand() * 0.9,
                drift: (rand() - 0.5) * 2.4,
                phase: rand(),
                ring: 15.6 + rand() * 1.8,
            }));
        }
        points.current.visible = true;
        const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
        const pos = attr.array as Float32Array;
        for (let i = 0; i < params.current.length; i++) {
            const p = params.current[i];
            // Staggered launch off the rim, arcing inward and fluttering down.
            const k = Math.max(0, Math.min(1, life * 1.35 - p.phase * 0.35));
            const r = p.ring - k * (3.2 + p.drift);
            const x = Math.cos(p.angle) * r + Math.sin(k * 9 + p.phase * 7) * 0.4;
            const z = Math.sin(p.angle) * r + Math.cos(k * 8 + p.phase * 6) * 0.4;
            const y = 4.6 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 1.7 - k * k * 6.2 * p.drop;
            pos[i * 3] = x;
            pos[i * 3 + 1] = Math.max(0.12, y);
            pos[i * 3 + 2] = z;
        }
        attr.needsUpdate = true;
        mat.current.opacity = life < 0.1 ? life / 0.1 : life > 0.72 ? Math.max(0, (1 - life) / 0.28) : 1;
    });
    return (
        <points ref={points} visible={false}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[new Float32Array(COUNT * 3), 3]} />
            </bufferGeometry>
            <pointsMaterial ref={mat} map={dot} color={ember} size={0.22} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
        </points>
    );
}

// ─── Camera director ─────────────────────────────────────────────────────────

/** The resting broadcast shot, shared by the Canvas' initial camera and the
 *  director so the first frame is already the framing the fight settles into.
 *
 *  It sits OFF the centre line on purpose. A camera parked dead behind your own
 *  line shows four backs down the middle of frame — your pets are turned away
 *  (they face the enemy, which is correct) and the enemy is hidden behind them.
 *  Sliding it to the player's right turns the whole board three-quarter: your
 *  pets read in profile, the enemy line reads as faces, and the lanes between
 *  the slots open up instead of stacking front-to-back. */
const WIDE_POS: readonly [number, number, number] = [5.2, 7.8, 14.0];
const WIDE_LOOK: readonly [number, number, number] = [0, 1.0, -0.6];
/** What the resting shot has to keep on screen: the widest pair of slots plus a
 *  tall pet's half-height. Depth needs no allowance — it runs along the lens.
 *  This is what replaces the old flat "+3.4 on portrait" nudge: a narrow phone
 *  now pulls back by however much its horizontal FOV actually demands. */
const BOARD_RADIUS = SLOT_SPACING + 1.4;

function CameraDirector({ beatRef, fxRef, posRef, lineup, reduced }: {
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    posRef: React.MutableRefObject<Map<string, [number, number, number]>>;
    lineup: Lineup;
    reduced: boolean;
}) {
    const pos = useRef(new THREE.Vector3(WIDE_POS[0], WIDE_POS[1], WIDE_POS[2]));
    const look = useRef(new THREE.Vector3(0, 1.1, -0.4));
    /** Shot identity — when it changes, the camera CUTS (snaps) instead of
     *  lerping: the classic monster battler Colosseum grammar. */
    const shotKey = useRef("");
    // Camera + size come from the frame-callback state (not render-scope
    // useThree destructuring) so the mutation stays outside render.
    useFrame((frameState) => {
        const camera = frameState.camera;
        const size = frameState.size;
        const beat = beatRef.current;
        const fx = fxRef.current;
        const now = performance.now();
        // Default: the wide three-quarter broadcast shot (see WIDE_POS). Pulled
        // back again from (0, 6.2, 12.8) — that framing still put a big species
        // across half the frame height, so the board read as two creatures in a
        // close-up rather than a match in an arena.
        let targetPos = new THREE.Vector3(...WIDE_POS);
        let targetLook = new THREE.Vector3(...WIDE_LOOK);
        let nextShot = "wide";
        let cutOnChange = false;
        // Every body that is IN the shot, and how much room this beat's element
        // work needs around them — both feed the fit-to-frame dolly below.
        const bodies: THREE.Vector3[] = [];
        let weight: ShotWeight = "quiet";
        if (beat.event && beat.event.t === "action" && beat.event.moveKind !== "guard" && beat.event.moveKind !== "rest") {
            const actorPos = posRef.current.get(beat.event.actorId);
            const victimPos = beat.event.targets[0] ? posRef.current.get(beat.event.targets[0].id) : undefined;
            if (actorPos) {
                const a = new THREE.Vector3(...actorPos);
                const b = victimPos ? new THREE.Vector3(...victimPos) : a;
                bodies.push(a, b);
                const frac = Math.min(1, (now - beat.startedAt) / beat.durationMs);
                // Deterministic shot seed: the QUEUE INDEX, so a replay of the
                // same script picks the same framings every time.
                const v = (beat.index * 2654435761) >>> 0;
                // ORIENTATION RULE (owner note): the camera NEVER goes behind
                // the enemy line. Behind-the-shoulder framing is the player's
                // grammar — used on an enemy it reads as if their pet were
                // yours. Enemy actions are shot from the SIDE or high, with
                // the player's half of the arena kept toward the lens.
                const enemyActing = beat.event.actorSide === "enemy";
                if (beat.event.super) {
                    nextShot = `super:${beat.index}`;
                    weight = "super";
                    const swoop = reduced ? 1 : frac;
                    if (enemyActing) {
                        // Enemy signature: a high side dolly along the lane —
                        // dramatic, but unmistakably THEIR move coming at you.
                        const mid = a.clone().lerp(b, 0.5);
                        const dirS = b.clone().sub(a).setY(0).normalize();
                        const perpS = new THREE.Vector3(-dirS.z, 0, dirS.x);
                        targetPos = mid.clone()
                            .add(perpS.multiplyScalar(8.8 - swoop * 1.0))
                            .setY(4.6 + swoop * 0.6);
                        targetLook = (reduced || frac >= 0.45 ? b : a).clone().setY(1.1);
                    } else {
                        // Player signature: the shoulder swoop into the impact
                        // (kept as a continuous move — the letterbox moment).
                        const behind = a.clone().sub(b).normalize().multiplyScalar(8.2);
                        targetPos = a.clone().add(behind).add(new THREE.Vector3(2.8 - swoop * 1.1, 3.6 + swoop * 0.8, 0));
                        targetLook = reduced || frac >= 0.45 ? b.clone().setY(1.1) : a.clone().setY(1.2);
                    }
                } else {
                    // Colosseum cut sequence: a windup framing, then a HARD CUT
                    // to the impact. Ranged and melee are shot differently —
                    // a thrown attack needs both bodies in frame to read.
                    cutOnChange = true;
                    const dir = b.clone().sub(a);
                    dir.y = 0;
                    if (dir.lengthSq() < 0.05) dir.set(0, 0, -1);
                    dir.normalize();
                    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
                    const ranged = beat.event.delivery === "ranged";
                    const heavy = beat.event.targets.some((t) => t.ko || t.damage > 260);
                    if (frac < STRIKE_FRAC * 0.92) {
                        const variant = v % 3;
                        nextShot = `windup:${beat.index}:${variant}`;
                        weight = "windup";
                        if (ranged || enemyActing) {
                            // Slot line: sit off the axis so the action travels
                            // across frame rather than into the lens. ALSO the
                            // only windup an enemy gets — behind-the-shoulder
                            // is player grammar (orientation rule above). An
                            // enemy windup rides a touch higher: reading down
                            // the lane keeps YOUR pets' backs toward the lens.
                            const mid = a.clone().lerp(b, 0.5);
                            targetPos = mid.clone()
                                .add(perp.clone().multiplyScalar(variant === 1 ? -8.6 : 8.6))
                                .setY(enemyActing ? (variant === 2 ? 5.2 : 4.4) : variant === 2 ? 4.4 : 3.6);
                            targetLook = mid.clone().setY(1.2);
                        } else {
                            const lateral = perp.clone().multiplyScalar(variant === 1 ? -2.6 : 2.6);
                            targetPos = a.clone()
                                .sub(dir.clone().multiplyScalar(variant === 2 ? 7.6 : 6.8))
                                .add(lateral)
                                .setY(variant === 2 ? 3.7 : 3.0);
                            targetLook = b.clone().setY(1.2);
                        }
                    } else {
                        const variant = (v >> 3) % 3;
                        nextShot = `strike:${beat.index}:${variant}`;
                        weight = shotWeight({ superMove: false, heavy, ranged, windup: false });
                        // A heavy or lethal blow pushes the lens IN — but only
                        // relatively. The old close numbers (3.2 side / 1.7 high)
                        // were authored against a mid-sized pet; on a big species
                        // they buried the lens in the body and the hit read as a
                        // wall of texture. Heavy is now "closer than a normal
                        // strike", not "inside the creature" — and the whole pair
                        // has since been loosened again so even the tight beat
                        // keeps the victim's full silhouette inside the frame.
                        const sideDist = heavy ? 7.0 : 8.4;
                        const height = heavy ? 2.8 : 3.2;
                        targetPos = b.clone()
                            .add(perp.clone().multiplyScalar(variant === 1 ? -sideDist : sideDist))
                            .add(dir.clone().multiplyScalar(variant === 2 ? -4.0 : -2.8))
                            .setY(variant === 2 ? height + 0.7 : height);
                        targetLook = b.clone().setY(1.05);
                    }
                }
            }
        } else if (beat.event && beat.event.t === "switch") {
            // The rotation is a beat of its own — track the arriving pet.
            const inPos = posRef.current.get(beat.event.inId);
            if (inPos) {
                const p = new THREE.Vector3(...inPos);
                bodies.push(p);
                nextShot = `switch:${beat.index}`;
                cutOnChange = true;
                targetPos = p.clone().add(new THREE.Vector3(6.0, 3.7, 6.0));
                targetLook = p.clone().setY(1.1);
            }
        } else if (beat.event && beat.event.t === "end") {
            // Orbit the survivor under the result panel — beatRef is never
            // cleared, so this keeps turning behind the scrim.
            const winners = beat.event.outcome === "win" ? lineup.playerField : lineup.enemyField;
            const focusId = winners[0];
            const at = focusId ? posRef.current.get(focusId) : undefined;
            if (at) {
                const p = new THREE.Vector3(...at);
                bodies.push(p);
                nextShot = "end";
                const th = (now - beat.startedAt) * 0.00045;
                targetPos = p.clone().add(new THREE.Vector3(Math.sin(th) * 7.4, 3.6, Math.cos(th) * 7.4));
                targetLook = p.clone().setY(1.15);
            }
        }
        // The CUT: on a shot change, snap into the new framing instantly.
        if (nextShot !== shotKey.current) {
            shotKey.current = nextShot;
            if (cutOnChange || nextShot === "wide") {
                if (nextShot !== "wide") {
                    pos.current.copy(targetPos);
                    look.current.copy(targetLook);
                }
            }
        }
        // Idle drift: a slow broadcast-crane sway so the wide shot never sits
        // dead still between actions.
        if (!reduced && (!beat.event || beat.event.t === "roundStart" || beat.event.t === "roundEnd")) {
            targetPos.x += Math.sin(now * 0.00013) * 1.1;
            targetPos.y += Math.sin(now * 0.00009 + 1.7) * 0.35;
        }
        // FIT TO FRAME. Every shot above is authored as an ANGLE; how far back
        // that angle has to sit is not something the shot can know. The roster's
        // models are not one size, the element work around a blow throws several
        // units past the body that took it, and the viewport can be any shape.
        //
        // This used to be a pair of minimum distances, which is not framing at
        // all — it says where the lens may not go, not what ends up on screen.
        // A signature whose shock ring opens past five units still overflowed,
        // and it overflowed sooner on a narrow phone because a fixed distance
        // ignores horizontal FOV completely. Now the radius that HAS to be
        // visible (every body in the shot, plus that beat's effect budget) is
        // measured, and the lens dollies straight out along its own view vector
        // until that radius fits the tighter frame axis — so the authored angle
        // survives untouched and only the distance changes.
        const aspect = size.width / Math.max(1, size.height);
        const view = targetPos.clone().sub(targetLook);
        if (view.lengthSq() < 0.01) view.set(0, 2, 6);
        const viewDir = view.clone().normalize();
        const extent = framedExtent(
            [targetLook.x, targetLook.y, targetLook.z],
            bodies.map((b) => [b.x, b.y, b.z] as const),
            weight,
        );
        const horiz = Math.max(extent.horiz, nextShot === "wide" ? BOARD_RADIUS : 0);
        // The lens itself is responsive: a narrow viewport opens it rather than
        // trying to buy horizontal coverage with distance alone, which on a
        // phone would push the camera through the backdrop wall.
        const baseFov = showdownFov(aspect);
        const lensDuration = Math.max(1, fx.lensUntil - fx.lensStartedAt);
        const lensProgress = Math.max(0, Math.min(1, (now - fx.lensStartedAt) / lensDuration));
        const lensPunch = !reduced && now < fx.lensUntil
            ? Math.sin(Math.PI * lensProgress) * fx.lensAmp
            : 0;
        // Impact FOV breath: a fast optical expansion at contact, followed by
        // a clean settle. It is lensing—not another positional shake—so heavy
        // hits gain scale without making the target unreadable.
        const fov = baseFov + lensPunch;
        if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - fov) > 0.01) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
        const needed = fitDistance(horiz, extent.vert, fov, aspect);
        if (view.length() < needed) {
            targetPos.copy(targetLook).add(viewDir.clone().multiplyScalar(needed));
        }
        // Containment: never below the floor, never outside the arena shell
        // (floor radius 14, backdrop wall at 19, night cap at y 16.4). Raised
        // from 13, then 16.5, alongside the framing floors above — a pushed-back
        // shot has to be allowed to actually reach its new distance or the clamp
        // undoes the fix. 18 keeps the lens inside the backdrop cylinder even at
        // the wide shot's height.
        //
        // KNOWN LIMIT: with the responsive lens every shot fits inside 18 except
        // a SIGNATURE on a phone held upright, which wants ~22. There is nowhere
        // to put that camera — the backdrop wall is at 19 — so the ring is
        // cropped there. Widening the lens further is the only other lever and
        // it fisheyes the caster. Shrinking the ring for narrow viewports in
        // PetShowdownVfx3d is the real fix if it ever matters enough.
        targetPos.y = Math.max(FLOOR_Y + 1.0, targetPos.y);
        if (targetPos.length() > 18) targetPos.setLength(18);
        pos.current.lerp(targetPos, 0.055);
        look.current.lerp(targetLook, 0.075);
        camera.position.copy(pos.current);
        // Impact shake — decaying, deterministic-feel sin mix.
        if (now < fx.shakeUntil) {
            const t = (fx.shakeUntil - now) / 320;
            const amp = fx.shakeAmp * t * t;
            camera.position.x += Math.sin(now * 0.09) * amp;
            camera.position.y += Math.sin(now * 0.117 + 2.1) * amp * 0.7;
        }
        camera.lookAt(look.current);
    });
    return null;
}

// ─── One fighter ─────────────────────────────────────────────────────────────

interface PopupEntry { key: number; petId: string; text: string; cls: string }

function ShowdownFighter({ info, displayHp, ko, guarding, statuses, victorious, introActive, beatRef, fxRef, posRef, radii, benchedRef, restingTargetId, popups, highlight, targetable, onPick, onHover }: {
    info: FighterSlotInfo;
    displayHp: number;
    ko: boolean;
    guarding: boolean;
    statuses: readonly { kind: string }[];
    victorious: boolean;
    introActive: boolean;
    beatRef: React.MutableRefObject<SceneBeat>;
    fxRef: React.MutableRefObject<SceneFx>;
    /** petId → assigned home position (field slot or bench row). A pet with no
     *  entry (a fallen body after reinforcement) freezes where it stands. */
    posRef: React.MutableRefObject<Map<string, [number, number, number]>>;
    /** Profile-aware visible body radii shared with the dash VFX layer. */
    radii: ReadonlyMap<string, number>;
    /** ids currently on the bench — a reserve AT its off-stage park is not
     *  drawn at all; it pops in the moment a switch starts it walking. */
    benchedRef: React.MutableRefObject<ReadonlySet<string>>;
    /** Slot-paired live opponent. Resting fighters track this exact world point. */
    restingTargetId: string | null;
    popups: PopupEntry[];
    highlight: "none" | "commander" | "targeted";
    /** You pick your target by clicking the CREATURE, not a name card. */
    targetable: boolean;
    onPick: (petId: string) => void;
    onHover: (petId: string | null) => void;
}) {
    const group = useRef<THREE.Group>(null);
    const impactRing = useRef<THREE.Mesh>(null);
    const impactMat = useRef<THREE.MeshBasicMaterial>(null);
    const guardBubble = useRef<THREE.Mesh>(null);
    const guardMat = useRef<THREE.MeshBasicMaterial>(null);
    const reticle = useRef<THREE.Mesh>(null);
    const selRing = useRef<THREE.Mesh>(null);
    /** Where this fighter currently stands — walks toward its assigned home. */
    const standing = useRef<[number, number, number] | null>(null);
    /** Hit-stop-aware presentation clock fed to the skeletal mixer. */
    const timeline = useRef(0);
    /** Opening pet entrance begins once the VS card clears. */
    const entranceAt = useRef<number | null>(null);
    /** Per-beat clock for root travel. Wall-clock dash progress used to keep
     *  advancing while the skeleton froze, sliding pets inside each other. */
    const beatClock = useRef({ index: -1, elapsedMs: 0 });
    /** When this pet went down (0 = standing) and the beat it fell on, which
     *  together decide when the body withdraws from the field. */
    const koAt = useRef(0);
    const koBeat = useRef(-1);
    /** When the withdrawal itself started (0 = not yet). */
    const koSinkAt = useRef(0);
    /** False until the first frame, so a match resumed with a pet already down
     *  starts withdrawn instead of replaying an exit it never earned. */
    const mounted = useRef(false);
    const [modelFailed, setModelFailed] = useState(false);
    // Species performance identity (pet-hero-moves): the stalk idles, charger
    // drives and dragon looms authored for the coliseum were NEVER wired into
    // Showdown — every pet fell to the EMPTY_POSE generic. The base style
    // carries idle/dash personality; the per-beat style below reshapes it per
    // MOVE so a crush, a cast and a signature carry different bodies.
    const baseStyle = useMemo<PetHeroMoveStyle>(
        () => petHeroMoveStyle({ petId: info.view.templateId, petName: info.view.name, profile: info.model?.profile ?? null }),
        [info.view.templateId, info.view.name, info.model],
    );
    const actionStyle = useRef<{ index: number; style: PetHeroMoveStyle }>({ index: -1, style: "generic" });
    const performanceVariant = useMemo(
        () => showdownPerformanceVariant(`${info.view.templateId ?? info.view.id}:${info.view.name}`),
        [info.view.id, info.view.name, info.view.templateId],
    );
    const signature = useMemo<PetSignaturePerformance>(() => petSignaturePerformance({
        id: info.view.templateId ?? info.view.id,
        name: info.view.name,
        element: info.view.element,
        rarity: info.view.rarity,
        profile: info.model?.profile ?? "quadruped",
    }), [info.model?.profile, info.view.element, info.view.id, info.view.name, info.view.rarity, info.view.templateId]);
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        faceX: showdownLaneFacing(info.side)[0],
        faceZ: showdownLaneFacing(info.side)[1],
        lockTargetFacing: true,
        statuses: [],
        signature,
    });
    const fallbackTexture = useMemo(() => {
        if (info.model && !modelFailed) return null;
        const t = new THREE.TextureLoader().load(info.fallbackImage);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }, [info.model, modelFailed, info.fallbackImage]);

    useFrame((_, delta) => {
        const f = frame.current;
        const beat = beatRef.current;
        const fx = fxRef.current;
        const now = performance.now();
        // Home = assigned slot; standing = where the body actually is. Living
        // pets WALK home (switch-ins gallop across the arena); the fallen stay
        // where they dropped.
        const home = posRef.current.get(info.view.id) ?? standing.current ?? info.basePos;
        if (!standing.current) standing.current = [home[0], home[1], home[2]];
        const stand = standing.current;
        let walkX = 0, walkZ = 0, walking = false;
        if (!ko) {
            const dx = home[0] - stand[0];
            const dz = home[2] - stand[2];
            const dist = Math.hypot(dx, dz);
            if (dist > 0.06) {
                walking = true;
                const step = Math.min(dist, delta * 7.2);
                walkX = dx / dist; walkZ = dz / dist;
                stand[0] += walkX * step;
                stand[2] += walkZ * step;
            } else {
                stand[0] = home[0]; stand[2] = home[2];
            }
        }
        let px = stand[0], pz = stand[2];
        const py = home[1];
        const laneFacing = showdownLaneFacing(info.side);
        const restingTarget = restingTargetId ? posRef.current.get(restingTargetId) : undefined;
        let [faceX, faceZ] = restingTarget
            ? resolveOpponentFacing(stand[0], stand[2], restingTarget[0], restingTarget[2], laneFacing[0], laneFacing[1])
            : laneFacing;
        f.moving = false;
        f.speed = 0;
        f.casting = false;

        // KO WITHDRAWAL. The fallen body holds where it dropped through the
        // fall and the KO ritual — that beat is the point — and then LEAVES.
        // A corpse parked in its slot for the rest of the match reads as a bug,
        // clutters the lane the survivors fight in, and is the one thing both
        // other monster battlers clear the instant the ceremony is over. It sinks
        // and shrinks out rather than popping, so the exit is still a beat.
        if (ko) {
            if (!koAt.current) {
                koAt.current = now;
                koBeat.current = beat.index;
                // Already down when this fighter first mounted (a resumed
                // match): start withdrawn — there is no ritual to honour.
                if (!mounted.current) koSinkAt.current = now - KO_SINK_MS;
            }
            // The exit is keyed off the ARENA MOVING ON — the beat this pet
            // died on giving way to the next — so it lands on the same cadence
            // at every playback speed instead of a wall-clock guess. The
            // ceiling covers the case where the queue drains to a stop and
            // waits on your orders: the body still leaves before you command.
            if (!koSinkAt.current && (beat.index !== koBeat.current || now - koAt.current > KO_MAX_HOLD_MS)) {
                koSinkAt.current = now;
            }
        } else if (koAt.current) {
            koAt.current = 0;
            koSinkAt.current = 0;
            koBeat.current = -1;
        }
        mounted.current = true;
        const koSink = koSinkAt.current
            ? Math.max(0, Math.min(1, (now - koSinkAt.current) / KO_SINK_MS))
            : 0;
        const withdrawn = koSink >= 1;

        // A reserve parked at its off-stage tunnel is not drawn: the roster
        // lives on the field, and the bench exists only as the gallop that
        // brings one in. `walking` is the whole state machine — the pop-in
        // happens exactly when a switch hands the reserve a field slot and the
        // chase starts, and the pop-out when a pulled pet reaches the tunnel.
        if (group.current) {
            group.current.visible = !(benchedRef.current.has(info.view.id) && !walking && !ko) && !withdrawn;
        }

        // Hit-stop-aware presentation clock: skeletal time crawls during the
        // contact freeze, so impacts have fighting-game weight.
        const presentationScale = now < fx.hitStopUntil ? 0.06 : now < fx.slowUntil ? fx.slowScale : 1;
        timeline.current += delta * presentationScale;
        f.timeline = timeline.current;
        f.performanceVariant = performanceVariant;
        f.signature = signature;
        if (!introActive) {
            if (entranceAt.current === null) entranceAt.current = timeline.current;
            f.entranceProgress = Math.min(1, (timeline.current - entranceAt.current) / 0.92);
        } else {
            entranceAt.current = null;
            f.entranceProgress = undefined;
        }
        if (beatClock.current.index !== beat.index) {
            beatClock.current.index = beat.index;
            beatClock.current.elapsedMs = Math.max(0, now - beat.startedAt);
        } else {
            beatClock.current.elapsedMs += delta * 1000 * presentationScale;
        }
        const beatFraction = Math.min(1, beatClock.current.elapsedMs / Math.max(1, beat.durationMs));

        const lastHit = fx.hitAt.get(info.view.id) ?? 0;
        const wallSinceHit = now - lastHit;
        const reactionAge = showdownReactionAge(now, lastHit, fx.hitStopUntil);
        const lastDodge = fx.dodgeAt.get(info.view.id) ?? 0;
        const dodgeAge = now - lastDodge;

        if (ko) {
            f.motion = "dead";
            f.victorious = false;
            f.moveStyle = baseStyle;
        } else if (beat.event && beat.event.t === "action" && beat.event.actorId === info.view.id) {
            const ev = beat.event as ActionEvent;
            const frac = beatFraction;
            if (ev.moveKind === "guard") {
                // Guard and Rest used to leave every pet in its ordinary idle.
                // The model layer now gives both actions a rig-safe full-body
                // performance, so utility turns remain as alive as attacks.
                f.motion = frac < 0.88 ? "guard" : "idle";
                f.moveStyle = baseStyle;
                f.moveName = ev.moveName;
                f.attackPace = undefined;
            } else if (ev.moveKind === "rest") {
                f.motion = frac < 0.88 ? "rest" : "idle";
                f.moveStyle = baseStyle;
                f.moveName = ev.moveName;
                f.attackPace = undefined;
            } else {
                // The MOVE reshapes the species pose (a crush pounces, a cast
                // rears, a push slams) — recomputed once per beat, not per frame.
                if (actionStyle.current.index !== beat.index) {
                    actionStyle.current = {
                        index: beat.index,
                        style: petHeroMoveStyle({
                            petId: info.view.templateId, petName: info.view.name,
                            move: ev.moveName, kind: ev.moveKind, profile: info.model?.profile ?? null,
                        }),
                    };
                }
                f.moveStyle = actionStyle.current.style;
                f.moveName = ev.moveName;
                // Attack take pacing follows the move's WEIGHT: jabs snap,
                // heavies grind, and signatures crawl through their long beat.
                f.attackPace = ev.super ? 0.55 : ev.weight === "heavy" ? 0.75 : ev.weight === "light" ? 1.3 : 1;
                const targetPos = ev.targets[0] ? posRef.current.get(ev.targets[0].id) : undefined;
                if (targetPos && ev.targets[0].id !== info.view.id) {
                    const dx = targetPos[0] - stand[0];
                    const dz = targetPos[2] - stand[2];
                    const len = Math.hypot(dx, dz) || 1;
                    faceX = dx / len; faceZ = dz / len;
                    // The coil begins a fixed ~900ms before commitment; earlier
                    // time remains the species' living idle.
                    const windupLead = 900 / beat.durationMs;
                    if (ev.delivery === "melee") {
                        // Species-sized contact: compact pets close farther;
                        // legendary bodies stop earlier. The same radii place the
                        // VFX burst, so body and light agree on where impact is.
                        const contact = showdownMeleeContact(
                            stand[0], stand[2], targetPos[0], targetPos[2],
                            radii.get(info.view.id) ?? 0.82,
                            radii.get(ev.targets[0].id) ?? 0.82,
                            signature.strikeDrive,
                        );
                        const drive = showdownMeleeDrive(frac);
                        px = stand[0] + faceX * contact.travel * drive;
                        pz = stand[2] + faceZ * contact.travel * drive;
                        const coilAt = Math.max(0.06, 0.32 - windupLead);
                        f.motion = frac < coilAt ? "idle" : frac < 0.32 ? "windup" : frac < 0.54 ? "dash" : frac < 0.66 ? "strike" : frac < 0.84 ? "recover" : "idle";
                        if (f.motion === "dash") { f.moving = true; f.speed = 9; f.moveX = faceX; f.moveZ = faceZ; }
                    } else {
                        const coilAt = Math.max(0.05, 0.4 - windupLead);
                        f.motion = frac < coilAt ? "idle" : frac < 0.4 ? "windup" : frac < 0.62 ? "strike" : frac < 0.84 ? "recover" : "idle";
                        // Keep the dedicated cast take alive through release and
                        // recovery so it cannot snap back to the melee bank on
                        // the exact impact frame.
                        f.casting = frac < 0.84;
                    }
                } else {
                    const windupLead = 900 / beat.durationMs;
                    const coilAt = Math.max(0.05, 0.4 - windupLead);
                    f.motion = frac < coilAt ? "idle" : frac < 0.4 ? "windup" : frac < 0.62 ? "strike" : frac < 0.84 ? "recover" : "idle";
                    f.casting = ev.delivery !== "melee" && frac < 0.84;
                }
            }
        } else if (reactionAge >= 0 && reactionAge < 520 && lastHit > 0) {
            f.motion = "stagger";
            f.hit = Math.max(0, 1 - reactionAge / 520);
            f.impactPower = fx.hitPower.get(info.view.id) ?? 0.55;
            f.moveStyle = baseStyle;
            f.moveName = undefined;
            f.attackPace = undefined;
        } else if (dodgeAge >= 0 && dodgeAge < 520 && lastDodge > 0) {
            f.motion = "dodge";
            f.hit = 0;
            f.moveStyle = baseStyle;
            f.moveName = undefined;
            f.attackPace = undefined;
        } else if (walking) {
            f.motion = "run";
            f.moving = true;
            f.speed = 7.2;
            f.moveX = walkX; f.moveZ = walkZ;
            faceX = walkX; faceZ = walkZ;
            f.moveStyle = baseStyle;
            f.moveName = undefined;
            f.attackPace = undefined;
        } else {
            // Idle keeps the species personality alive — the pouncer stalks,
            // the pack hunter circles, the dragon looms — instead of the
            // generic empty pose the mode used to fall back to.
            f.motion = "idle";
            f.hit = 0;
            f.moveStyle = baseStyle;
            f.moveName = undefined;
            f.attackPace = undefined;
        }
        // The skeleton folds on impact; the group travels away from its source.
        // The separation remains visible through hit-stop and eases home after.
        const hitDirection = fx.hitDirection.get(info.view.id);
        if (!ko && hitDirection && lastHit > 0) {
            const recoil = showdownReactionRecoil(
                fx.hitPower.get(info.view.id) ?? 0.55,
                info.model?.profile ?? "quadruped",
                reactionAge,
            ) * signature.recoil;
            px += hitDirection[0] * recoil;
            pz += hitDirection[1] * recoil;
        }
        if (!ko && lastDodge > 0 && dodgeAge >= 0 && dodgeAge < 520) {
            const offset = showdownDodgeOffset(dodgeAge, info.model?.profile ?? "quadruped", performanceVariant)
                * THREE.MathUtils.clamp(signature.agility, 0.86, 1.18);
            px += -faceZ * offset;
            pz += faceX * offset;
        }
        f.faceX = faceX;
        f.faceZ = faceZ;
        f.statuses = statuses.map((status) => status.kind);
        f.victorious = victorious && !ko;
        f.desperate = !ko && displayHp / Math.max(1, info.view.maxHp) < 0.25;
        if (group.current) {
            // The withdrawal rides on the group transform, so it composes with
            // whatever pose the death clip left the rig in.
            const ease = koSink * koSink;
            group.current.position.set(px, py - ease * 1.7, pz);
            group.current.scale.setScalar(Math.max(0.02, 1 - ease * 0.55));
        }

        // Impact burst: an expanding, fading shockwave ring at the feet for
        // ~0.45s after a landed hit. Driven entirely off fx.hitAt — no re-render.
        if (impactRing.current && impactMat.current) {
            const t = wallSinceHit / 450;
            const active = lastHit > 0 && t >= 0 && t < 1;
            impactRing.current.visible = active;
            if (active) {
                const s = 0.5 + t * 1.9;
                impactRing.current.scale.set(s, s, s);
                impactMat.current.opacity = 0.85 * (1 - t) * (1 - t);
            }
        }
        // Reticle: spin + bob so a targetable creature reads as interactive.
        if (reticle.current) {
            reticle.current.rotation.z = now * 0.0022;
            const bob = 1 + Math.sin(now * 0.005) * 0.12;
            reticle.current.scale.setScalar(bob);
        }
        if (selRing.current) {
            const pulse = 1 + Math.sin(now * 0.006) * 0.05;
            selRing.current.scale.set(pulse, pulse, pulse);
        }
        // Guard bubble: a soft breathing shell while the pet holds Guard.
        if (guardBubble.current && guardMat.current) {
            guardBubble.current.visible = guarding && !ko;
            if (guarding && !ko) {
                const pulse = 1 + Math.sin(now * 0.006) * 0.03;
                guardBubble.current.scale.set(pulse, pulse, pulse);
                guardMat.current.opacity = 0.16 + Math.sin(now * 0.006) * 0.04;
            }
        }
    });

    const tint = ELEMENT_TINT[info.view.element] ?? ELEMENT_TINT.None;
    const myPopups = popups.filter((p) => p.petId === info.view.id);

    return (
        <group ref={group} position={info.basePos}>
            {/* Invisible hit volume — the creature itself is the target button.
                Sized generously so a tap lands on a phone, and only interactive
                while this pet is a legal pick (so it never steals a stray click
                during playback). Attached to the moving group, so it tracks the
                body through lunges and bench walks. */}
            <mesh
                position={[0, 1.05, 0]}
                visible={false}
                onPointerOver={targetable ? (e) => { e.stopPropagation(); onHover(info.view.id); } : undefined}
                onPointerOut={targetable ? (e) => { e.stopPropagation(); onHover(null); } : undefined}
                onClick={targetable ? (e) => { e.stopPropagation(); onPick(info.view.id); } : undefined}
            >
                <boxGeometry args={[2.1, 2.4, 2.1]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {info.model && !modelFailed ? (
                <PetModelBoundary onFail={() => setModelFailed(true)}>
                    <Suspense fallback={null}>
                        {/* Physical presence follows rarity — a mythic stands
                            visibly larger than a standard. Purely visual; the
                            reticle, rings and popups are siblings and keep
                            their shared scale. */}
                        <group scale={info.view.rarity === "mythic" ? 1.13 : info.view.rarity === "legendary" ? 1.07 : info.view.rarity === "rare" ? 1.02 : 1}>
                            <PetModel3D config={info.model} frame={frame} element={info.view.element} signature={signature} />
                        </group>
                    </Suspense>
                </PetModelBoundary>
            ) : (
                // No approved 3D model: full-body card art on a grounded billboard.
                <Billboard lockX lockZ>
                    <mesh position={[0, 1.05, 0]}>
                        <planeGeometry args={[2.0, 2.0]} />
                        <meshBasicMaterial map={fallbackTexture} transparent alphaTest={0.06} toneMapped={false} />
                    </mesh>
                </Billboard>
            )}
            {/* Contact blob shadow grounds the silhouette. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <circleGeometry args={[0.85, 24]} />
                <meshBasicMaterial color="#000" transparent opacity={ko ? 0.14 : 0.34} />
            </mesh>
            {/* Impact shockwave ring (visibility driven per-frame). */}
            <mesh ref={impactRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} visible={false}>
                <ringGeometry args={[0.7, 0.92, 40]} />
                <meshBasicMaterial ref={impactMat} color={tint} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            {/* Guard shell. */}
            <mesh ref={guardBubble} position={[0, 1.0, 0]} visible={false}>
                <sphereGeometry args={[1.35, 20, 14]} />
                <meshBasicMaterial ref={guardMat} color="#8ecdf7" transparent opacity={0.16} toneMapped={false} depthWrite={false} />
            </mesh>
            {/* Persistent painted status auras: burning pets burn, frozen pets frost. */}
            {!ko && <StatusAuraFx statuses={statuses} />}
            {highlight !== "none" && (
                <mesh ref={selRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
                    <ringGeometry args={[0.95, 1.12, 32]} />
                    <meshBasicMaterial color={highlight === "commander" ? "#fbbf24" : "#f87171"} transparent opacity={0.85} toneMapped={false} />
                </mesh>
            )}
            {/* Floating reticle: the "this is clickable" affordance. */}
            {targetable && !ko && (
                <Billboard position={[0, 2.75, 0]}>
                    <mesh ref={reticle}>
                        <ringGeometry args={[0.3, 0.4, 3]} />
                        <meshBasicMaterial color="#f87171" transparent opacity={0.95} toneMapped={false} side={THREE.DoubleSide} />
                    </mesh>
                </Billboard>
            )}
            {!ko && highlight === "none" && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
                    <ringGeometry args={[0.9, 0.97, 32]} />
                    <meshBasicMaterial color={tint} transparent opacity={0.35} toneMapped={false} />
                </mesh>
            )}
            {myPopups.map((p) => (
                <Html key={p.key} center position={[0, 2.5, 0]} zIndexRange={[30, 0]} wrapperClass="showdown-popup-anchor">
                    <div className={`showdown-popup ${p.cls}`}>{p.text}</div>
                </Html>
            ))}
        </group>
    );
}


// ─── Team panel (DOM) ────────────────────────────────────────────────────────

interface DisplayEntry { hp: number; stamina: number; meter: number; ko: boolean; guarding: boolean; statuses: { kind: string; rounds: number; magnitude: number }[] }

/** The one numeral treatment, reused for every ratio in the HUD.
 *
 *  Numerals NEVER tween — the value snaps to what the server sent the instant it
 *  arrives, and only the bar animates. A counting tween would put numbers on
 *  screen that no event ever carried.
 *
 *  Enemy readouts show a PERCENTAGE rather than absolutes: it is honest about
 *  what the client legitimately knows, and it separates the two plate stacks
 *  without spending a second colour. Both values are already server-sent, so
 *  this implies nothing new. */
function Num({ cur, max, pct }: { cur: number; max: number; pct?: boolean }) {
    const safeMax = Math.max(1, Math.round(max));
    const safeCur = Math.max(0, Math.round(cur));
    if (pct) {
        return <span className="sd-num pct">{Math.round((safeCur / safeMax) * 100)}<i>%</i></span>;
    }
    return <span className="sd-num">{safeCur}<i>/{safeMax}</i></span>;
}

/** A single ornate status plate: portrait, name/level/element, HP and Stamina
 *  read out as `cur / max`, then the signature meter. Bench members render the
 *  same plate at a reduced size so the team is always legible at a glance.
 *
 *  Plates are READOUTS, not the primary controls — you target by clicking the
 *  creature itself. The plate is still focusable while it is a legal target so
 *  keyboard players keep a path to the same choice. */
function StatusPlate({ pet, d, side, benched, clickable, onPick, commanding, hintElement, art, hovered }: {
    pet: ShowdownPetView;
    d: DisplayEntry;
    side: "player" | "enemy";
    benched: boolean;
    clickable: boolean;
    onPick?: (petId: string) => void;
    commanding: boolean;
    hintElement?: string;
    art?: string;
    hovered: boolean;
}) {
    const hpPct = Math.max(0, (d.hp / Math.max(1, pet.maxHp)) * 100);
    const stPct = Math.max(0, (d.stamina / Math.max(1, pet.maxStamina)) * 100);
    const showHint = !!hintElement && !d.ko && !benched;
    const strong = showHint && SHOWDOWN_ELEMENT_BEATS[hintElement!] === pet.element;
    const weak = showHint && SHOWDOWN_ELEMENT_BEATS[pet.element] === hintElement;
    const tint = ELEMENT_TINT[pet.element] ?? ELEMENT_TINT.None;
    const Tag = clickable ? "button" : "div";
    return (
        <Tag
            type={clickable ? "button" : undefined}
            onClick={clickable && onPick ? () => onPick(pet.id) : undefined}
            className={[
                "showdown-plate", side,
                d.ko ? "ko" : "",
                benched ? "benched" : "",
                clickable ? "targetable" : "",
                hovered ? "hovered" : "",
                commanding ? "commanding" : "",
                // Threshold recolours the FILL only; the channel and the gloss
                // ramp never change, so the bar keeps its character as it drains.
                d.ko ? "" : hpPct < 20 ? "hp-low" : hpPct <= 50 ? "hp-mid" : "",
            ].join(" ")}
            style={{ "--plate-tint": tint } as React.CSSProperties}
        >
            <span className="showdown-plate-portrait">
                {art
                    ? <img src={art} alt="" loading="lazy" />
                    : <ShowdownIcon name={elementCrest(pet.element)} size={20} />}
                {d.ko && <span className="showdown-plate-ko"><ShowdownIcon name="ko-stamp" size={26} title="Knocked out" /></span>}
            </span>
            <span className="showdown-plate-body">
                <span className="showdown-plate-title">
                    <span className="showdown-plate-name">{pet.name}</span>
                    <span className="showdown-plate-lv">Lv{pet.level}</span>
                    <span className="showdown-plate-elem" style={{ color: tint }}>
                        <ShowdownIcon name={elementCrest(pet.element)} size={14} title={pet.element} />
                    </span>
                </span>
                <span className="showdown-plate-bar hp">
                    <span className="showdown-plate-key"><ShowdownIcon name="hp" size={12} title="Health" /></span>
                    <span className="showdown-plate-track">
                        {/* The chip layer drains SLOWLY behind the instant fill —
                            the classic "damage you just took" read. */}
                        <span className="chip" style={{ width: `${hpPct}%` }} />
                        <span className="fill" style={{ width: `${hpPct}%` }} />
                    </span>
                    <Num cur={d.hp} max={pet.maxHp} pct={side === "enemy"} />
                </span>
                <span className="showdown-plate-bar en">
                    <span className="showdown-plate-key"><ShowdownIcon name="stamina" size={12} title="Stamina" /></span>
                    <span className="showdown-plate-track">
                        <span className="fill" style={{ width: `${stPct}%` }} />
                    </span>
                    <Num cur={d.stamina} max={pet.maxStamina} pct={side === "enemy"} />
                </span>
                <span className={`showdown-plate-meter ${d.meter >= 100 ? "full" : ""}`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, d.meter))}%` }} />
                </span>
                <span className="showdown-plate-tags">
                    {/* The matchup readout is gated on the ELEMENT being known,
                        never on the plate being a click target — it used to
                        require multi-target mode, so in 1v1 (the format whose
                        blurb sells the wheel) it could never render at all.
                        Word + crest, never colour alone. */}
                    {strong && (
                        <span className="showdown-matchup up" title={`Your ${hintElement} beats ${pet.element}`}>
                            <ShowdownIcon name={elementCrest(hintElement!)} size={11} />STRONG
                        </span>
                    )}
                    {weak && (
                        <span className="showdown-matchup down" title={`${pet.element} resists your ${hintElement}`}>
                            <ShowdownIcon name={elementCrest(pet.element)} size={11} />RESISTED
                        </span>
                    )}
                    {benched && !d.ko && (
                        <span className="showdown-bench-tag" title="Waiting on the bench">
                            <ShowdownIcon name="bench" size={11} />BENCH
                        </span>
                    )}
                    {pet.skipsNextAction && !d.ko && (
                        <span className="showdown-skip-tag" title="Loses its next action">
                            <ShowdownIcon name="action-lost" size={11} />SKIP
                        </span>
                    )}
                    {side === "player" && pet.trait && <span className="showdown-kit-chip trait" title="Trait">{pet.trait}</span>}
                    {side === "player" && pet.gearName && <span className="showdown-kit-chip gear" title="Equipped gear">{pet.gearName}</span>}
                    {/* Present only while the charge is live — the server stops
                        publishing it once spent, so no client bookkeeping. */}
                    {side === "player" && pet.consumableName && <span className="showdown-kit-chip consum" title="Battle item — one use">{pet.consumableName}</span>}
                    {d.statuses.map((s) => (
                        <span key={s.kind} className={`showdown-status-pip fam-${KIND_FAMILY[s.kind] ?? "ctl"}`} title={statusTitle(s)}>
                            <ShowdownIcon name={STATUS_GLYPH[s.kind] ?? "mark"} size={12} />
                            <b>{s.rounds}</b>
                        </span>
                    ))}
                </span>
            </span>
        </Tag>
    );
}

function TeamPanel({ side, pets, display, targeting, onPickTarget, commanderId, hintElement, art, benchedIds, benchPicking, onPickBench, hoveredId }: {
    side: "player" | "enemy";
    pets: ShowdownPetView[];
    display: Record<string, DisplayEntry>;
    targeting: boolean;
    onPickTarget?: (petId: string) => void;
    commanderId?: string | null;
    /** While targeting: the commander's element, for the STRONG/RESISTED badge. */
    hintElement?: string;
    /** petId → portrait/card art url. */
    art?: Record<string, string>;
    /** Which team members currently wait on the bench. */
    benchedIds?: ReadonlySet<string>;
    /** Switch flow: bench plates become the pick targets. */
    benchPicking?: boolean;
    onPickBench?: (petId: string) => void;
    /** Mirrors the creature the pointer is over in the 3D scene. */
    hoveredId?: string | null;
}) {
    // The bench stays OFF the field until the Switch flow asks for it. A
    // standing row of reserve plates was chrome the stage paid for every
    // round, to present a choice that exists only inside one action — and for
    // the ENEMY side it also leaked the full reserve roster, where a count is
    // all the opponent has earned. The count survives as pips.
    const benchHidden = pets.filter((pet) => (benchedIds?.has(pet.id) ?? false)
        && !(benchPicking && side === "player"));
    return (
        <div className={`showdown-team-panel ${side}`}>
            {pets.map((pet) => {
                const d = display[pet.id] ?? { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, guarding: pet.guarding, statuses: pet.statuses };
                const benched = benchedIds?.has(pet.id) ?? false;
                if (benched && !(benchPicking && side === "player")) return null;
                const clickable = !d.ko && (benchPicking ? benched : targeting && !benched);
                return (
                    <StatusPlate
                        key={pet.id}
                        pet={pet}
                        d={d}
                        side={side}
                        benched={benched}
                        clickable={clickable}
                        onPick={benchPicking ? onPickBench : onPickTarget}
                        commanding={commanderId === pet.id}
                        hintElement={hintElement}
                        art={art?.[pet.id]}
                        hovered={hoveredId === pet.id}
                    />
                );
            })}
            {benchHidden.length > 0 && (
                <span
                    className="showdown-reserve-pips"
                    title={side === "player" ? "Reserves — press Switch to send one in" : "Enemy reserves"}
                    aria-label={`${benchHidden.length} reserve${benchHidden.length > 1 ? "s" : ""} waiting`}
                >
                    {benchHidden.map((pet) => <i key={pet.id} className={(display[pet.id]?.ko ?? pet.ko) ? "down" : ""} aria-hidden="true" />)}
                </span>
            )}
        </div>
    );
}

// ─── Action menu + move inspector ────────────────────────────────────────────

type ShowdownMoveView = ShowdownPetView["moves"][number];

/** What the bottom-right panel reads out for the highlighted menu row. */
interface InspectorSpec {
    title: string;
    /** The kind mark drawn beside the title. */
    glyph?: ShowdownIconName;
    element?: string;
    category: string;
    description: string;
    stats?: { k: string; v: string }[];
    /** Red line under the description — overdraft, hold, empty bench. */
    warn?: string;
}

/** What a menu row DOES, as data. The rows are built by a pure function, so
 *  they cannot close over the command handlers (those reach refs, which the
 *  React compiler forbids touching during render) — the component dispatches. */
type MenuAction =
    | { t: "move"; moveIndex: number; super: boolean }
    | { t: "guard" }
    | { t: "rest" }
    | { t: "beginSwitch" };

interface MenuRowSpec {
    key: string;
    icon: ShowdownIconName;
    /** Offense/control/support tint for the icon socket. Techniques override it
     *  with the ELEMENT tint — the type colour is what a player scans for. */
    family?: "off" | "ctl" | "sup";
    /** Set on technique rows so the socket takes the element tint. */
    element?: string;
    label: string;
    /** Short right-aligned cost/state text. */
    note?: string;
    disabled?: boolean;
    tone?: "attack" | "utility" | "signature";
    /** Stance rows (Guard/Rest/Switch) render as icon chips BESIDE the
     *  technique grid, not as grid pills — the techniques are the decision,
     *  the stances are the standing options. */
    chip?: boolean;
    action: MenuAction;
    detail: InspectorSpec;
}

/** Builds the inspector readout for one technique. Every number here is a
 *  server-sent field on the move view — nothing is recomputed client-side. */
function moveInspector(move: ShowdownMoveView, fallbackElement: string, staminaNow: number, readiness: number): InspectorSpec {
    const deficit = Math.max(0, move.cost - staminaNow);
    const holding = move.hold > readiness;
    const pace = move.priority > 1 ? "Fast" : move.priority < 1 ? "Slow" : "Even";
    // The technique's OWN element — the neutral basic reads Neutral, never the
    // pet's colour, because dodging the wheel is its whole identity.
    const element = move.element ?? fallbackElement;
    const clsLabel = move.cls === "physical" ? "Physical" : move.cls === "special" ? "Special" : "Status";
    return {
        title: move.name,
        glyph: move.signature ? "signature" : kindGlyph(move.kind, move.element),
        element,
        category: move.signature
            ? `Signature · ${clsLabel}`
            : `${element === "None" ? "Neutral" : element} · ${clsLabel} · ${move.kind}`,
        description: move.synergyElement
            ? `${move.effect} Synergy: a fielded ${move.synergyElement} ally empowers it.`
            : move.effect,
        stats: [
            { k: "PWR", v: move.power > 0 ? String(move.power) : "—" },
            { k: "STA", v: move.signature ? "meter" : String(move.cost) },
            { k: "PACE", v: pace },
            { k: "HOLD", v: move.hold > 0 ? `R${move.hold + 1}` : "ready" },
        ],
        warn: holding
            ? `Still charging — unleashes from round ${move.hold + 1}.`
            : deficit > 0
                ? `Overdraft: costs ${deficit * 2} HP and skips the next round.`
                : undefined,
    };
}

/** Assembles the command list for the pet currently taking orders. Kept OUT of
 *  the component body so it is a plain pure builder — the row objects it makes
 *  are data, and the component just renders them.
 *
 *  reference-shaped: the TECHNIQUES are the root level, in a grid, with
 *  Guard/Rest/Switch as icon chips beside them. There used to be an
 *  Attack/Skill submenu in front of them, which cost a tap every single round
 *  to reach the only decision the round actually asks. */
function buildMenuRows({
    commander, mustSwitch, moves, signature, staminaNow, meterNow, benchCount, fieldCount,
}: {
    commander: ShowdownPetView | null;
    mustSwitch: boolean;
    /** Non-signature moves, each carrying its REAL index in `commander.moves`. */
    moves: { move: ShowdownMoveView; index: number }[];
    signature: ShowdownMoveView | null;
    staminaNow: number;
    meterNow: number;
    benchCount: number;
    /** Living pets on YOUR side of the field — switch redirection differs in 1v1. */
    fieldCount: number;
}): MenuRowSpec[] {
    if (!commander) return [];
    const element = commander.element;
    const switchRow: MenuRowSpec = {
        key: "switch",
        icon: "rotate",
        family: "sup",
        label: "Switch",
        note: benchCount ? `${benchCount}` : undefined,
        tone: "utility",
        chip: true,
        disabled: !benchCount,
        action: { t: "beginSwitch" },
        detail: {
            title: "Switch",
            element,
            category: "Rotation",
            // The engine has no slot inheritance: an attack aimed at a pet that
            // leaves the field falls through to the first pet still standing
            // (or the taunt holder), which in 2v2/3v3 is usually NOT the one
            // arriving. Only in 1v1 is the incoming pet guaranteed to eat it.
            description: fieldCount > 1
                ? "Rotate a reserve in before any attack lands. Anything aimed at the pet you pull out is redirected to whoever is still standing — not necessarily the pet coming in — and the one you pull out keeps regaining stamina on the bench."
                : "Rotate a reserve in before any attack lands, so the incoming pet eats the hit meant for the one you pull out — and the one you pull out keeps regaining stamina on the bench.",
            warn: benchCount ? undefined : "No reserves left to send in.",
        },
    };

    // A stunned pet cannot act, but it MAY rotate out — so it gets the switch
    // decision and nothing else, both presented as full pills: in this state
    // the stance IS the decision.
    if (mustSwitch) {
        return [{ ...switchRow, chip: false }, {
            key: "hold",
            icon: "brace",
            family: "sup",
            label: "Hold the line",
            tone: "utility",
            action: { t: "guard" },
            detail: {
                title: "Hold the line",
                element,
                category: "Forced",
                description: `${commander.name} loses this action either way. Staying in keeps the slot and the field position.`,
            },
        }];
    }

    // Every technique sits at the root, the basic strike included, each under
    // its own name — "Attack" as an alias hid what the button actually threw.
    // Overdraft is allowed (it just costs HP), so a move you cannot afford
    // stays selectable — only an unmet HOLD disables its pill.
    const rows: MenuRowSpec[] = moves.map((entry): MenuRowSpec => ({
        key: `move-${entry.index}`,
        icon: kindGlyph(entry.move.kind, entry.move.element),
        family: KIND_FAMILY[entry.move.kind],
        // The pill wears the TECHNIQUE's element, so the neutral basic reads
        // grey next to the pet's own colour — the wheel-dodge is visible
        // before the inspector says a word.
        element: entry.move.element ?? element,
        label: entry.move.name,
        note: entry.move.hold > commander.readiness ? "…" : `${entry.move.cost}`,
        tone: "attack",
        disabled: entry.move.hold > commander.readiness,
        action: { t: "move", moveIndex: entry.index, super: false },
        detail: moveInspector(entry.move, element, staminaNow, commander.readiness),
    }));
    if (signature) {
        const sigHolding = signature.hold > commander.readiness;
        const ready = meterNow >= 100 && !sigHolding;
        rows.push({
            key: "signature",
            icon: "signature",
            element,
            label: signature.name,
            note: ready ? "READY" : `${Math.round(meterNow)}%`,
            tone: "signature",
            disabled: !ready,
            action: { t: "move", moveIndex: -1, super: true },
            detail: {
                ...moveInspector(signature, element, staminaNow, commander.readiness),
                warn: sigHolding
                    ? `Still charging — unleashes from round ${signature.hold + 1}.`
                    : ready ? undefined : "The signature meter is not full yet.",
            },
        });
    }
    rows.push({
        key: "guard",
        icon: "aegis",
        family: "sup",
        label: "Guard",
        note: `${SHOWDOWN_GUARD_COST}`,
        tone: "utility",
        chip: true,
        action: { t: "guard" },
        detail: {
            title: "Guard",
            element,
            category: "Stance",
            // Guarding banks LESS meter per hit than eating one (the engine pays
            // SHOWDOWN_METER_ON_GUARDED_HIT, not _ON_HIT_TAKEN) — it is only ahead
            // per point of health, because the hit is halved. Both figures come
            // from the contract so the sentence cannot drift from the table.
            description: `Brace. Incoming damage is halved this round. A guarded hit banks ${SHOWDOWN_METER_ON_GUARDED_HIT} meter instead of the usual ${SHOWDOWN_METER_ON_HIT_TAKEN} — less per hit, but more per point of health spent. Guard resolves before almost everything else.`,
            stats: [
                { k: "METER", v: `+${SHOWDOWN_METER_ON_GUARDED_HIT}` },
                { k: "STA", v: String(SHOWDOWN_GUARD_COST) },
                { k: "PACE", v: "Fastest" },
                { k: "HOLD", v: "ready" },
            ],
        },
    });
    rows.push({
        key: "rest",
        icon: "breath",
        family: "sup",
        label: "Rest",
        note: "+EN",
        tone: "utility",
        chip: true,
        action: { t: "rest" },
        detail: {
            title: "Catch Breath",
            element,
            category: "Stance",
            description: "Give up your turn to buy stamina back. It heals nothing and it swings late, so expect to eat the round's attacks first — this is a tempo cost you pay to keep casting.",
            stats: [
                { k: "PWR", v: "—" },
                { k: "STA", v: `+${Math.round(SHOWDOWN_REST_PCT * 100)}%` },
                { k: "PACE", v: "Slow" },
                { k: "HOLD", v: "ready" },
            ],
        },
    });
    rows.push(switchRow);
    return rows;
}

/** Reclaims keyboard focus for a panel that has just REPLACED the control the
 *  player activated. The battle is portalled to the end of `document.body`, so
 *  focus falling back to `<body>` strands a keyboard player behind the whole
 *  background app. Never yanks focus off a live element, so a mouse player is
 *  unaffected. Mount-only on purpose: re-running would steal the caret the
 *  moment a mouse user hovered a row. */
function useReclaimFocus(container: React.RefObject<HTMLElement | null>, index = 0) {
    const wanted = useRef(index);
    useEffect(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const buttons = container.current?.querySelectorAll<HTMLButtonElement>("button");
        (buttons?.[wanted.current] ?? buttons?.[0])?.focus({ preventScroll: true });
    }, [container]);
}

function ActionMenu({ rows, focus, onFocusRow, onSelect }: {
    rows: MenuRowSpec[];
    focus: number;
    onFocusRow: (index: number) => void;
    onSelect: (action: MenuAction) => void;
}) {
    const rowsRef = useRef<HTMLDivElement>(null);
    useReclaimFocus(rowsRef, focus);
    // The techniques render as a two-column grid with the stance chips in a
    // row beneath, but the FOCUS ORDER stays the single flat `rows` array —
    // arrows move through one list (Up/Down by a grid row, Left/Right by one),
    // Tab and screen readers see plain buttons in reading order.
    const gridCount = rows.filter((r) => !r.chip).length;
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        if (!buttons.length) return;
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        // Inside the grid a vertical arrow jumps a full row (two pills); once
        // past the grid's edge it lands on the chips, and vice versa.
        const step = e.key === "ArrowRight" ? 1
            : e.key === "ArrowLeft" ? -1
                : e.key === "ArrowDown" ? (at < gridCount ? 2 : 1)
                    : (at <= gridCount ? -2 : -1);
        const next = at < 0 ? 0 : Math.max(0, Math.min(buttons.length - 1, at + step));
        buttons[next]?.focus();
    };
    const renderRow = (row: MenuRowSpec, i: number) => (
        // Unavailable rows are aria-disabled, NOT natively disabled: a disabled
        // button fires no hover and takes no focus, which made the inspector
        // line explaining WHY it is unavailable ("Still charging…", "No
        // reserves left…") unreachable.
        <button
            key={row.key}
            type="button"
            aria-disabled={row.disabled || undefined}
            className={[row.chip ? "showdown-stance-chip" : "showdown-tech-pill", row.tone ?? "", row.element ? "technique" : "", row.disabled ? "is-disabled" : "", i === focus ? "focused" : ""].join(" ")}
            style={row.element
                ? { "--elem-tint": ELEMENT_TINT[row.element] ?? ELEMENT_TINT.None } as React.CSSProperties
                : undefined}
            onMouseEnter={() => { if (i !== focus) playPetSfx("uiMove"); onFocusRow(i); }}
            onFocus={() => { if (i !== focus) playPetSfx("uiMove"); onFocusRow(i); }}
            onClick={() => {
                // An unavailable row must SOUND unavailable: silence is
                // indistinguishable from a dropped input, and the player just
                // presses again.
                if (row.disabled) { playPetSfx("uiDenied"); return; }
                playPetSfx("uiConfirm");
                petHaptic(12);
                onSelect(row.action);
            }}
        >
            <span className={`showdown-menu-icon fam-${row.family ?? "none"}`} aria-hidden="true">
                <ShowdownIcon name={row.icon} size={15} />
            </span>
            <span className="showdown-menu-label">{row.label}</span>
            {row.note && <span className="showdown-menu-note">{row.note}</span>}
        </button>
    );
    return (
        <div className="showdown-menu" ref={rowsRef} onKeyDown={onKeyDown}>
            <div className="showdown-tech-grid">
                {rows.map((row, i) => (row.chip ? null : renderRow(row, i)))}
            </div>
            <div className="showdown-stance-chips">
                {rows.map((row, i) => (row.chip ? renderRow(row, i) : null))}
            </div>
        </div>
    );
}

/** PvP command clock (the genre's command timers).
 *  Renders only when the server put a deadline on the state view — practice
 *  fights carry none, so this never appears there. At zero it locks the round
 *  in as drafted; the engine defaults every missing order to guard, so an
 *  undecided pet braces rather than stalling the opponent. */
function TurnTimer({ deadline, onLapse }: { deadline: number; onLapse: () => void }) {
    const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
    const lapsed = useRef(false);
    useEffect(() => {
        lapsed.current = false;
        // First paint via the interval, never synchronously in the effect —
        // the 250ms tick is well inside human reaction to a 45s clock.
        const tick = window.setInterval(() => {
            const ms = Math.max(0, deadline - Date.now());
            setLeft(ms);
            if (ms <= 0 && !lapsed.current) {
                lapsed.current = true;
                window.clearInterval(tick);
                onLapse();
            }
        }, 250);
        return () => window.clearInterval(tick);
        // onLapse is a fresh closure each render; the deadline is the identity
        // of the countdown, so it alone restarts the clock.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deadline]);
    const seconds = Math.ceil(left / 1000);
    return (
        <div className={`showdown-turn-timer ${seconds <= 10 ? "urgent" : ""}`} role="timer" aria-label={`${seconds} seconds to choose`}>
            <ShowdownIcon name="fast" size={12} />
            {seconds}s
        </div>
    );
}

/** The panel that replaces the command menu while a target is being picked.
 *  Its only control is the way back, so it must claim focus — the row the
 *  player just activated is gone. */
function TargetingPanel({ title, sub, onBack }: { title: string; sub: string; onBack: () => void }) {
    const rowsRef = useRef<HTMLDivElement>(null);
    useReclaimFocus(rowsRef);
    return (
        <div className="showdown-menu targeting" ref={rowsRef}>
            <div className="showdown-targeting-ask">
                <span className="showdown-targeting-title">{title}</span>
                <span className="showdown-targeting-sub">{sub}</span>
            </div>
            <div className="showdown-stance-chips">
                <button type="button" className="showdown-stance-chip focused" onClick={() => { playPetSfx("uiCancel"); onBack(); }}>
                    <span className="showdown-menu-icon fam-none" aria-hidden="true"><ShowdownIcon name="caret-back" size={15} /></span>
                    <span className="showdown-menu-label">Back</span>
                </button>
            </div>
        </div>
    );
}

function MoveInspector({ spec, targetName }: { spec: InspectorSpec | null; targetName?: string | null }) {
    if (!spec) return null;
    const element = spec.element ?? "None";
    const tint = ELEMENT_TINT[element] ?? ELEMENT_TINT.None;
    return (
        <div
            className="showdown-inspector"
            style={{
                "--insp-tint": tint,
                // The painted crest earns its 5-9 KB here and nowhere else: one
                // surface, shown large, where the vector would look thin.
                "--elem-art": ELEMENT_ICON[element] ? `url(${ELEMENT_ICON[element]})` : "none",
            } as React.CSSProperties}
        >
            <span className="showdown-inspector-glyph" aria-hidden="true" />
            <div className="showdown-inspector-head">
                {spec.glyph && (
                    <span className="showdown-inspector-mark" aria-hidden="true">
                        <ShowdownIcon name={spec.glyph} size={16} />
                    </span>
                )}
                <span className="showdown-inspector-title">{spec.title}</span>
                <span className="showdown-inspector-cat">{spec.category}</span>
            </div>
            <p className="showdown-inspector-desc">{spec.description}</p>
            {targetName && <p className="showdown-inspector-target">→ {targetName}</p>}
            {spec.warn && <p className="showdown-inspector-warn">{spec.warn}</p>}
            {spec.stats && (
                <div className="showdown-inspector-stats">
                    {spec.stats.map((s) => (
                        <span key={s.k}><i>{s.k}</i><b>{s.v}</b></span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

/** Everything the tab ring may legally land on inside the takeover. */
const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Spoken, never seen. The live region has no visual form at any breakpoint,
 *  so its clip rides inline rather than spending a class on nothing. */
const SR_ONLY: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    border: 0,
};

export function PetShowdownBattle({ initialState, playerPets, sharedImages, submitTurn, onForfeit, onFinished, onExit, onRematch, spectator = false }: {
    initialState: ShowdownStateView;
    /** The player's real roster Pets (for 3D model + art resolution). */
    playerPets: Pet[];
    sharedImages: Record<string, string>;
    submitTurn: (commands: ShowdownCommand[]) => Promise<ShowdownTurnResult>;
    onForfeit: () => void;
    /** WATCHING, not fighting: the command phase auto-submits empty orders and
     *  the whole command deck stays hidden, so a server-scripted match (a war
     *  duel, a stored replay) plays start to finish with no input. The driver
     *  behind submitTurn supplies each round's events — spectator mode is only
     *  the removal of the human from the loop, not a second playback path. */
    spectator?: boolean;
    /** Fired once when the end event has played; settlement may carry rewards. */
    onFinished: (outcome: "win" | "loss", settlement: ShowdownTurnResponse | null) => void;
    onExit: () => void;
    onRematch: () => void;
}) {
    const renderQuality = useMemo(() => petVisualQuality(), []);
    const [stateView, setStateView] = useState(initialState);
    const [phase, setPhase] = useState<"command" | "playing" | "finished">("command");
    const [display, setDisplay] = useState<Record<string, DisplayEntry>>(() => buildDisplay(initialState));
    const [queue, setQueue] = useState<ShowdownEvent[]>([]);
    const [queueIndex, setQueueIndex] = useState(0);
    const [banner, setBanner] = useState<{ key: number; text: string; cls: string } | null>(null);
    const [popups, setPopups] = useState<PopupEntry[]>([]);
    const [fast, setFast] = useState(false);
    const [confirmForfeit, setConfirmForfeit] = useState(false);
    /** The round of orders the server refused, held so a failed submit costs
     *  the player nothing but a second press. Null whenever the last submit
     *  was accepted (or none has been made). */
    const [failedOrders, setFailedOrders] = useState<ShowdownCommand[] | null>(null);
    const [expired, setExpired] = useState(false);
    const [letterbox, setLetterbox] = useState(false);
    const [flash, setFlash] = useState(0);
    /** Element tint for the super flash — the full-frame color takeover. */
    const [flashTint, setFlashTint] = useState("#ffffff");
    /** The killing blow's manga impact frame (radial lines + desaturation). */
    const [koImpact, setKoImpact] = useState(0);
    /** Premium finishing-blow title card. It is presentation-only and names
     * the authoritative action that produced the KO. */
    const [finisher, setFinisher] = useState<{ key: number; actor: string; move: string; element: string } | null>(null);
    /** Super-strike vignette breath — edges clamp and release. */
    const [vignette, setVignette] = useState(0);
    /** God-ray source (the charge orb's core) — the post stack mounts once
     *  the sun mesh exists. */
    const [godRaySun, setGodRaySun] = useState<THREE.Mesh | null>(null);
    const [endOutcome, setEndOutcome] = useState<"win" | "loss" | null>(null);
    /** Snapshotted from the tally when the battle ends (never read in render). */
    const [recap, setRecap] = useState<{ pet: ShowdownPetView; dmg: number; kos: number; supers: number; mvp: boolean }[]>([]);
    const [muted, setMuted] = useState(() => isAudioMuted());
    const toggleAudio = useCallback(() => {
        const next = !isAudioMuted();
        setAudioMuted(next);
        setMuted(next);
        // Unmuting must RESTART the loop: startBattleMusic early-returns while
        // muted, so the theme is null and clearing the flag alone resumes
        // nothing.
        if (!next) {
            primePetSfx();
            startBattleMusic("showdown");
            setBattleMusicIntensity("pressure");
        }
    }, []);
    const [vfx, setVfx] = useState<VfxSpawn[]>([]);
    const [setPieces, setSetPieces] = useState<SetPieceSpawn[]>([]);
    /** Persistent strike scars (capped; oldest evicted) + fading residues. */
    const [scars, setScars] = useState<BattleScar[]>([]);
    const [residues, setResidues] = useState<ResidueSpawn[]>([]);
    /** The arena's CLIMATE: the last landed signature's element holds the
     *  field (faint sheen + motes + tinted light) until another replaces it. */
    const [climate, setClimate] = useState<ClimateState | null>(null);
    // Standing WEATHER owns the arena's climate whenever it is up — setting
    // the sky is real board state and has to be visible without reading a
    // number. A signature's residue climate only shows when no weather stands.
    // Derived, never stored: the layer owns its own fade clock.
    const climateElement = stateView.weather?.element ?? climate?.element ?? null;
    /** Per-kind move accents + impact streak-throughs + debris chunks. */
    const [kindFx, setKindFx] = useState<KindAccentSpawn[]>([]);
    const [streakFx, setStreakFx] = useState<StreakBurstSpawn[]>([]);
    const [debrisFx, setDebrisFx] = useState<StreakBurstSpawn[]>([]);
    const [settlement, setSettlement] = useState<ShowdownTurnResponse | null>(null);

    // Command drafting.
    const [draft, setDraft] = useState<ShowdownCommand[]>([]);
    const [pendingMove, setPendingMove] = useState<{ moveIndex: number; super: boolean } | null>(null);
    const [pickingSwitch, setPickingSwitch] = useState(false);
    /** Console-style menu: the root list, or the technique sub-list. */
    /** Highlighted menu row — drives the cursor and the inspector readout. */
    const [focusRow, setFocusRow] = useState(0);
    /** The creature the pointer is over while targeting (drives the cursor and
     *  the inspector's "→ target" line). */
    const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
    /** What the live region currently says. Everything a sighted player reads
     *  off a damage popup or a 900ms banner has to reach a screen reader some
     *  other way, and this is it. */
    const [announcement, setAnnouncement] = useState("");
    const takeoverRef = useRef<HTMLDivElement>(null);
    // VS intro card over the opening seconds.
    const [intro, setIntro] = useState(true);
    useEffect(() => {
        const timer = window.setTimeout(() => setIntro(false), 2600);
        return () => window.clearTimeout(timer);
    }, []);

    const settlementRef = useRef<ShowdownTurnResponse | null>(null);
    /** True from the moment a round is submitted until its response has been
     *  ingested. The beat player's script-exhausted branch MUST idle while
     *  this is set: phase flips to "playing" before the server answers, so
     *  without the hold the exhausted branch fired instantly on the stale
     *  queue, reconciled, and handed control back to "command" — and the real
     *  script then arrived into the wrong phase and NEVER PLAYED. Every round
     *  either showed nothing or replayed the PREVIOUS round's script for the
     *  first round-trip's worth of beats. */
    const submitInFlight = useRef(false);
    const tallyRef = useRef<Map<string, { dmg: number; kos: number; supers: number }>>(new Map());
    const finishedNotified = useRef(false);
    const popupKey = useRef(1);
    const timeouts = useRef<number[]>([]);
    const speed = fast ? 2.1 : 1;

    const beatRef = useRef<SceneBeat>({ event: null, startedAt: 0, durationMs: 1, index: 0 });
    const fxRef = useRef<SceneFx>({
        hitAt: new Map(), hitPower: new Map(), hitDirection: new Map(), dodgeAt: new Map(),
        shakeUntil: 0, shakeAmp: 0, hitStopUntil: 0,
        slowUntil: 0, slowScale: 1,
        lensStartedAt: 0, lensUntil: 0, lensAmp: 0,
        superFocus: false,
        crowdBurstAt: 0, crowdBurstKind: "super",
    });
    const reducedMotion = prefersReducedMotion();
    const pillarDrive = useRef<PillarDrive>({ activeUntil: 0, startedAt: 0, x: 0, z: 0, color: "#fbbf24" });

    // Who stands where — switches and reinforcements move pets between the
    // front line and the bench row; fighters walk to their assigned spot.
    const [lineup, setLineup] = useState<Lineup>(() => lineupFromState(initialState));
    const posRef = useRef<Map<string, [number, number, number]>>(computeArrangement(lineupFromState(initialState)));
    /** Who is benched right now, for the fighters' visibility check — a ref
     *  because it is read per-frame inside useFrame, never during render. */
    const benchedRef = useRef<ReadonlySet<string>>(new Set([...lineupFromState(initialState).playerBench, ...lineupFromState(initialState).enemyBench]));
    useEffect(() => {
        posRef.current = computeArrangement(lineup);
        benchedRef.current = new Set([...lineup.playerBench, ...lineup.enemyBench]);
    }, [lineup]);

    const stage = useMemo(() => stageForSession(initialState.sessionId), [initialState.sessionId]);

    // ── Fullscreen overlay + body scroll lock + music ───────────────────────
    useEffect(() => {
        document.body.classList.add("pet-combat-active");
        startBattleMusic("showdown");
        primePetSfx();
        return () => {
            document.body.classList.remove("pet-combat-active");
            stopBattleMusic();
        };
    }, []);

    // ── Modal contract ──────────────────────────────────────────────────────
    // The takeover paints over the whole app but is a portal SIBLING of it, so
    // the tab ring runs off the last control and straight into the village
    // chrome underneath — a keyboard player walks out of a fight they cannot
    // see they have left. Keep Tab inside the overlay, and hand focus back to
    // whatever opened the battle when it unmounts.
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        // Rendered-but-hidden controls (a panel mid-transition) are not tab
        // stops; getClientRects is the only visibility test that survives the
        // takeover's fixed positioning, which nulls offsetParent.
        const stops = () => Array.from(
            takeoverRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const items = stops();
            if (!items.length) {
                e.preventDefault();
                takeoverRef.current?.focus({ preventScroll: true });
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (!takeoverRef.current?.contains(active)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            } else if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            // The portal teardown drops focus to <body>; restore on the next
            // frame, once React has removed the overlay node.
            requestAnimationFrame(() => {
                if (opener?.isConnected) opener.focus();
            });
        };
    }, []);

    // Escape peels ONE layer and stops. It closes the forfeit prompt, cancels
    // targeting, and walks the technique list back to the root — it never
    // concedes and never leaves the fight, because a fullscreen takeover is
    // exactly where a reflexive Escape gets pressed.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (confirmForfeit) {
                e.preventDefault();
                playPetSfx("uiCancel");
                setConfirmForfeit(false);
            } else if (pendingMove) {
                e.preventDefault();
                playPetSfx("uiCancel");
                setPendingMove(null);
                setHoveredTarget(null);
            } else if (pickingSwitch) {
                e.preventDefault();
                playPetSfx("uiCancel");
                setPickingSwitch(false);
                setHoveredTarget(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [confirmForfeit, pendingMove, pickingSwitch]);

    // ── Fighter slot map (positions + model configs, stable per roster) ─────
    const slots = useMemo(() => {
        const map = new Map<string, FighterSlotInfo>();
        const playerPos = slotPositions(stateView.player.length, "player");
        const enemyPos = slotPositions(stateView.enemy.length, "enemy");
        // Both sides resolve their art through the SHARED identity rule
        // (showdownFighterIdentity): your own fighters prefer their save record
        // so an evolved starter keeps its stage's body, and server-built
        // opponents key off their catalog species. The model warm-up in
        // lib/pet-model-preload runs the same rule — if these two ever disagree,
        // the warm-up fetches a model this map never asks for and the fighter
        // suspends into nothing.
        stateView.player.forEach((view, i) => {
            const petLike = showdownFighterIdentity(view, playerPets);
            map.set(view.id, {
                view, side: "player", basePos: playerPos[i],
                model: petCombatModel(petLike),
                fallbackImage: petCardImage(petLike, sharedImages),
            });
        });
        stateView.enemy.forEach((view, i) => {
            const petLike = showdownFighterIdentity(view);
            map.set(view.id, {
                view, side: "enemy", basePos: enemyPos[i],
                model: petCombatModel(petLike),
                fallbackImage: petCardImage(petLike, sharedImages),
            });
        });
        return map;
        // Rosters never change mid-session; art inputs are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stateView.player.length, stateView.enemy.length]);

    /** One collision footprint per visible fighter. This is intentionally
     * derived from the approved presentation config, not combat stats, and is
     * shared by body travel and BeatDrivenVfx so neither can cross the other. */
    const fighterRadii = useMemo<ReadonlyMap<string, number>>(() => {
        const map = new Map<string, number>();
        for (const [id, info] of slots) {
            map.set(id, showdownBodyRadius({
                targetHeight: info.model?.targetHeight,
                profile: info.model?.profile,
                rarity: info.view.rarity,
            }));
        }
        return map;
    }, [slots]);

    /** The same immutable identity sheets drive skeletal posing and travel FX.
     * Sharing this map prevents a pet's body language, trail hand and impact
     * punctuation from drifting into three unrelated procedural styles. */
    const fighterSignatures = useMemo<ReadonlyMap<string, PetSignaturePerformance>>(() => {
        const map = new Map<string, PetSignaturePerformance>();
        for (const [id, info] of slots) {
            map.set(id, petSignaturePerformance({
                id: info.view.templateId ?? info.view.id,
                name: info.view.name,
                element: info.view.element,
                rarity: info.view.rarity,
                profile: info.model?.profile ?? "quadruped",
            }));
        }
        return map;
    }, [slots]);

    /** Spawn a one-shot painted flipbook at a pet's current position. */
    /** Elemental set-piece (tsunami / tornado / fire wash…) for the casts that
     *  earned one. Anchored on both bodies so traveling pieces have a lane.
     *
     *  ?slowfx stretches every piece 3x — a REVIEW knob for tuning the
     *  spectacle frame-by-frame (the pieces live ~900ms, too brief to study).
     *  URL-gated, presentation-only, and inert unless someone types it. */
    const fxStretch = useMemo(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("slowfx") ? 3 : 1), []);
    /** ?capture — review knob: canvas capture WITHOUT the slow-mo stretch, so
     *  in-page frame grabs can verify REAL pacing (?slowfx distorts beats). */
    const captureFlag = useMemo(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("capture")), []);
    const spawnSetPiece = useCallback((element: string, casterId: string, victimId: string, baseDurationMs: number, superCast = false) => {
        const durationMs = baseDurationMs * fxStretch;
        const from = posRef.current.get(casterId);
        const to = posRef.current.get(victimId);
        if (!from || !to) return;
        const key = popupKey.current++;
        setSetPieces((list) => [...list.slice(-6), {
            key, element,
            from: [from[0], from[1], from[2]] as const,
            to: [to[0], to[1], to[2]] as const,
            startedAt: performance.now(), durationMs,
            ...(superCast ? { superCast: true } : {}),
        }]);
        window.setTimeout(() => setSetPieces((list) => list.filter((s) => s.key !== key)), durationMs + 400);
    }, [fxStretch]);

    const spawnFlipbook = useCallback((petId: string, frames: string, scale: number, durationMs: number, yLift = 1.0, aspect = 1, tint?: string, normalBlend = false) => {
        // An empty key means "this action detonates nothing" (Rest).
        if (!frames) return;
        const at = posRef.current.get(petId);
        if (!at) return;
        const key = popupKey.current++;
        setVfx((list) => [...list.slice(-14), {
            key, frames, scale, durationMs, aspect, tint, normalBlend,
            pos: [at[0], at[1] + yLift, at[2]] as [number, number, number],
            startedAt: performance.now(),
        }]);
        window.setTimeout(() => setVfx((list) => list.filter((s) => s.key !== key)), durationMs + 400);
    }, []);

    const clearTimers = useCallback(() => {
        for (const id of timeouts.current) window.clearTimeout(id);
        timeouts.current = [];
    }, []);
    useEffect(() => () => clearTimers(), [clearTimers]);

    const later = useCallback((fn: () => void, ms: number) => {
        timeouts.current.push(window.setTimeout(fn, ms));
    }, []);

    // Removal timers use RAW setTimeout, NOT later(): later()'s queue is
    // cleared by the beat effect's cleanup on every beat advance, which would
    // strand banners and leak spent popups in state. A removal firing after
    // unmount is a harmless no-op setState.
    const showBanner = useCallback((text: string, cls: string, holdMs = 1100) => {
        const key = popupKey.current++;
        setBanner({ key, text, cls });
        window.setTimeout(() => setBanner((b) => (b?.key === key ? null : b)), holdMs);
    }, []);

    const addPopup = useCallback((petId: string, text: string, cls: string) => {
        const key = popupKey.current++;
        setPopups((p) => [...p, { key, petId, text, cls }]);
        window.setTimeout(() => setPopups((p) => p.filter((e) => e.key !== key)), 1250);
    }, []);

    // ── Beat player ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== "playing") return;
        if (queueIndex >= queue.length) {
            // Response still in flight: this is the anticipation hold, not the
            // end of the script. Reconciling here fired on the emptied queue
            // the instant the phase flipped, handed control back to "command",
            // and stranded the arriving script in the wrong phase — the fight
            // played without a single beat, popup or effect. When the response
            // lands, setQueue/setQueueIndex re-run this effect and the script
            // plays from its first beat.
            if (submitInFlight.current) return;
            // Script exhausted: reconcile to the server state and hand control
            // back. Deferred via the timer queue so the effect body itself never
            // sets state synchronously (react-hooks/set-state-in-effect).
            later(() => {
                const response = settlementRef.current;
                if (response?.state) {
                    setStateView(response.state);
                    setDisplay(buildDisplay(response.state));
                    setLineup(lineupFromState(response.state));
                    if (response.state.finished) {
                        setPhase("finished");
                        setRecap(buildRecap(response.state, tallyRef.current));
                        if (!finishedNotified.current && response.state.outcome) {
                            finishedNotified.current = true;
                            onFinished(response.state.outcome, response);
                        }
                        return;
                    }
                }
                setPhase("command");
                setDraft([]);
                setPendingMove(null);
            }, 0);
            return clearTimers;
        }
        const event = queue[queueIndex];
        const durationMs = beatDurationMs(event, speed);
        beatRef.current = { event, startedAt: performance.now(), durationMs, index: queueIndex };

        // Speak the beat as it lands. The damage figures live in popups that
        // fade in 1.25s and the verdicts live in banners — neither reaches a
        // screen reader, so the same numbers go out on the live region at the
        // moment of contact rather than when the beat opens.
        const spoken = describeBeat(event, stateView);
        if (spoken) later(() => setAnnouncement(spoken), durationMs * (event.t === "action" ? STRIKE_FRAC : 0.1));

        if (event.t === "roundStart") {
            // The old cap's moment survives as the pressure cue: this is where
            // attrition starts biting, not where a timer ends the fight.
            const isFinal = event.round >= stateView.attritionAt;
            showBanner(
                event.round === 1 ? "BATTLE START" : isFinal ? "ATTRITION" : `ROUND ${event.round}`,
                isFinal ? "super" : "round",
                durationMs * 0.8,
            );
            if (isFinal) setBattleMusicIntensity("pressure");
        } else if (event.t === "skip") {
            const name = nameOf(stateView, event.actorId);
            showBanner(event.reason === "winded" ? `${name} is winded!` : event.reason === "stun" ? `${name} is stunned!` : `${name} is frozen solid!`, "status", durationMs * 0.85);
            // The lost turn gets a visual: sparks crackle on a stun, frost
            // flashes on a freeze (winded pets just pant — the banner carries it).
            later(() => {
                if (event.reason === "stun") spawnFlipbook(event.actorId, "spark", 2.2, 620, 1.6);
                else if (event.reason === "freeze") spawnFlipbook(event.actorId, "ice", 2.4, 620);
            }, durationMs * 0.25);
        } else if (event.t === "confused") {
            const name = nameOf(stateView, event.actorId);
            showBanner(`${name} hurt itself in confusion!`, "status", durationMs * 0.85);
            later(() => {
                addPopup(event.actorId, `-${event.selfDamage}`, "damage");
                applyToDisplay(setDisplay, event.actorId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.selfDamage), ko: event.ko }));
                fxRef.current.hitAt.set(event.actorId, performance.now());
                fxRef.current.hitDirection.delete(event.actorId);
            }, durationMs * 0.5);
        } else if (event.t === "switch") {
            later(() => {
                const inName = nameOf(stateView, event.inId);
                showBanner(
                    event.side === "player"
                        ? (event.reinforcement ? `${inName} joins the fight!` : `Go, ${inName}!`)
                        : (event.reinforcement ? `The enemy sends in ${inName}!` : `They swap to ${inName}!`),
                    "status",
                    durationMs * 0.8,
                );
                playPetSfx("move");
                // Reassign slots — the fighters physically run the exchange.
                setLineup((l) => lineupAfterSwitch(l, event.side, event.outId, event.inId, event.reinforcement));
            }, 0);
            // Entry theater: the gallop covers most of the beat — a dust pop
            // greets the ARRIVAL, so planting on the line reads as a landing
            // instead of a walk coming to a stop.
            later(() => spawnFlipbook(event.inId, "impact", 1.5, 380, 0.18, 1, "#d9ccb8"), durationMs * 0.86);
        } else if (event.t === "dot") {
            later(() => {
                addPopup(event.targetId, `-${event.damage}`, "dot");
                // Attrition, burn and wound all used to render one purple
                // numeral and nothing else — including the round-18 attrition
                // bleed, which is the mechanic that ENDS long fights.
                spawnFlipbook(
                    event.targetId,
                    event.kind === "attrition" ? "shadow" : event.kind === "wound" ? "poison" : "burn",
                    event.kind === "attrition" ? 2.0 : 1.7,
                    460 / speed,
                    0.95,
                    1,
                    event.kind === "attrition" ? "#e0556f" : undefined,
                );
                fxRef.current.hitAt.set(event.targetId, performance.now());
                fxRef.current.hitPower.set(event.targetId, 0.4);
                fxRef.current.hitDirection.delete(event.targetId);
                playPetSfx("dot");
                applyToDisplay(setDisplay, event.targetId, (d) => ({ ...d, hp: Math.max(0, d.hp - event.damage), ko: event.ko }));
            }, durationMs * 0.35);
        } else if (event.t === "consumable") {
            // A reactive item answered the last beat. The label is the verb the
            // player bought; the item name goes in the banner so the purchase
            // is the thing being credited.
            later(() => {
                addPopup(event.petId, CONSUMABLE_CALLOUT[event.effect], "proc");
                showBanner(`${nameOf(stateView, event.petId)}'s ${event.itemName}!`, "status", durationMs * 0.8);
                playPetSfx(event.effect === "thorns" ? "hit" : event.effect === "lifeline" ? "heal" : "buff");
                if (event.effect === "dodge") fxRef.current.dodgeAt.set(event.petId, performance.now());
                if (event.damage > 0) {
                    addPopup(event.targetId, `-${event.damage}`, "damage");
                    fxRef.current.hitAt.set(event.targetId, performance.now());
                    const from = posRef.current.get(event.petId);
                    const to = posRef.current.get(event.targetId);
                    if (from && to) {
                        const [dx, dz] = resolveOpponentFacing(from[0], from[2], to[0], to[2]);
                        fxRef.current.hitDirection.set(event.targetId, [dx, dz]);
                    } else {
                        fxRef.current.hitDirection.delete(event.targetId);
                    }
                    applyToDisplay(setDisplay, event.targetId, (d) => ({
                        ...d, hp: Math.max(0, d.hp - event.damage), ko: event.ko,
                    }));
                }
                if (event.heal > 0) {
                    addPopup(event.targetId, `+${event.heal}`, "heal");
                    spawnFlipbook(event.targetId, "heal", 2.2, 700);
                    applyToDisplay(setDisplay, event.targetId, (d) => ({
                        ...d, hp: Math.min(stateMaxHp(stateView, event.targetId), d.hp + event.heal),
                    }));
                }
            }, durationMs * 0.25);
        } else if (event.t === "end") {
            setEndOutcome(event.outcome);
            // A judged finish names itself BEFORE the verdict: the fight hit
            // the turn cap and went to the ladder, and the player deserves to
            // know which rung separated the sides.
            if (event.byJudge) {
                const rung = event.judgeReason === "pets" ? "more pets standing"
                    : event.judgeReason === "hp" ? "higher total health"
                        : event.judgeReason === "stamina" ? "higher total stamina"
                            : "the speed arrow";
                later(() => showBanner(`JUDGES' DECISION — ${rung}`, "status", 1400 / speed), 0);
            }
            later(() => {
                showBanner(event.outcome === "win" ? "VICTORY!" : "DEFEAT", event.outcome === "win" ? "victory" : "defeat", 2400 / speed);
                playPetSfx(event.outcome === "win" ? "victory" : "ko");
                if (event.outcome === "win") playPetSfx("crowd");
            }, durationMs * (event.byJudge ? 0.55 : 0.2));
        } else if (event.t === "action") {
            if (event.super) {
                later(() => {
                    setLetterbox(true);
                    showBanner(event.moveName, "super", durationMs * 0.6);
                    setBattleMusicIntensity("climax");
                    playPetSfx("finisher");
                }, 0);
                later(() => setLetterbox(false), durationMs * 0.94);
            }
            // The Colosseum declaration: "Red Fox used Flame Bolt!" opens every
            // non-super action (supers already banner their own name larger).
            if (!event.super && event.moveKind !== "guard" && event.moveKind !== "rest") {
                later(() => showBanner(`${nameOf(stateView, event.actorId)} used ${event.moveName}!`, "declare", durationMs * 0.42), 0);
            }
            // Windup: a charge-gather flipbook on the caster for real attacks.
            if (event.moveKind !== "guard" && event.moveKind !== "rest") {
                later(() => spawnFlipbook(event.actorId, event.super ? "charge" : event.delivery === "ranged" ? "charge" : "aura", event.super ? 2.6 : 1.7, durationMs * (event.delivery === "melee" ? 0.28 : 0.36), 1.05), durationMs * 0.04);
            }
            // Strike moment: damage numbers, HP drains, shake, effectiveness call.
            later(() => {
                let anyKo = false;
                let anyHeal = false;
                let anySynergy = false;
                let bestEffect: "super" | "weak" | null = null;
                for (const target of event.targets) {
                    // A hit the shield ate entirely arrives as damage 0, and the
                    // whole impact block used to be gated on damage > 0 — so the
                    // attacker lunged, and the victim reacted in no way at all.
                    // `applied` excludes deliberate zero-damage casts: a
                    // self-cast barrier lands as damage 0 + applied "shield",
                    // and popping ABSORBED over its own SHIELD read as the
                    // buff having failed.
                    if (target.damage <= 0 && !target.heal && !target.applied && event.moveKind !== "guard" && event.moveKind !== "rest") {
                        later(() => {
                            addPopup(target.id, "ABSORBED", "guarded");
                            spawnFlipbook(target.id, "eshield", 2.2, 520 / speed, 1.0, 1, "#8ecdf7");
                            playPetSfx("shield");
                        }, 0);
                    }
                    if (target.damage > 0) {
                        // Numbers carry the hit's WEIGHT: chips whisper, a hit
                        // over ~18% of the bar lands big, a signature shouts.
                        const dmgCls = target.guarded ? "guarded"
                            : event.super ? "super"
                            : target.damage >= stateMaxHp(stateView, target.id) * 0.18 ? "big"
                            : "damage";
                        addPopup(target.id, `-${target.damage}`, dmgCls);
                        fxRef.current.hitAt.set(target.id, performance.now());
                        // Damage-scaled recoil: a chip flinches, a haymaker folds
                        // the body. Uses the sibling mode's tuned curve — a raw
                        // damage fraction reads as almost no flinch at all.
                        fxRef.current.hitPower.set(
                            target.id,
                            petDuelImpactStrength(target.damage / Math.max(1, stateMaxHp(stateView, target.id)), event.super),
                        );
                        const impactFrom = posRef.current.get(event.actorId);
                        const impactTo = posRef.current.get(target.id);
                        if (impactFrom && impactTo) {
                            const [dx, dz] = resolveOpponentFacing(impactFrom[0], impactFrom[2], impactTo[0], impactTo[2]);
                            fxRef.current.hitDirection.set(target.id, [dx, dz]);
                        } else {
                            fxRef.current.hitDirection.delete(target.id);
                        }
                        // Painted impact: the element's flipbook detonates on the
                        // victim (splash hits get a smaller wash).
                        // Size the paint off the SAME damage fraction the body
                        // reaction already uses. Before this there were exactly
                        // two burst scales in the whole game (2.4 and 3.6) and
                        // neither read the hit — a 12-damage chip and a
                        // 600-damage haymaker painted the identical burst on a
                        // model that folded completely differently.
                        const frac = target.damage / Math.max(1, stateMaxHp(stateView, target.id));
                        const weightMul = event.super ? 1.5 : event.weight === "heavy" ? 1.25 : event.weight === "light" ? 0.78 : 1;
                        const burst = Math.min(4.2, (1.5 + Math.min(1, frac * 2.4) * 1.9) * weightMul) * (target.splash ? 0.7 : 1);
                        // Contact reads in two layers, anime grammar: a hard
                        // white flash the instant the hit lands, then the
                        // element's own burst blooming through it. One burst
                        // alone read as a decal; the flash is what sells the
                        // FRAME of contact (and it is why hit-stop exists).
                        spawnFlipbook(target.id, "spark", burst * 0.72, 200 / speed, 1.0, 1, "#ffffff");
                        // The casts that EARNED a spectacle stage their element
                        // as an arena event — a tsunami that travels the lane,
                        // a tornado that spins up, fire that catches the ground
                        // — on the primary victim only (splash keeps the burst).
                        // Reduced-motion keeps the readable burst and skips the
                        // traveling/spinning layer, same policy as the flash.
                        const staged = !reducedMotion && (event.super || event.weight === "heavy") && !target.splash && target.id !== event.actorId;
                        if (staged) {
                            // A signature stages its element's SUPER sequence —
                            // longer, layered, and choreographed down the lane.
                            // The painted hero art (floor takeover + multi-crest
                            // choreography) needs more air than the old flipbook
                            // pieces did to land its silhouettes.
                            spawnSetPiece(event.element, event.actorId, target.id, (event.super ? 2100 : 1150) / speed, event.super);
                        }
                        // The arena keeps the receipts: signatures and killing
                        // blows scar the boards where they land, and a
                        // signature's element LINGERS as ambient residue for a
                        // few beats after its set-piece clears.
                        if (!reducedMotion && (event.super || target.ko || event.weight === "heavy" || event.moveKind === "crush") && !target.splash) {
                            const at = posRef.current.get(target.id);
                            if (at) {
                                const [sx, , sz] = at;
                                const scarKey = popupKey.current++;
                                setScars((list) => [...list.slice(-9), { key: scarKey, x: sx, z: sz, element: event.element, bornAt: performance.now() }]);
                                if (event.super) {
                                    const residueKey = popupKey.current++;
                                    later(() => {
                                        setResidues((list) => [...list.slice(-3), { key: residueKey, element: event.element, x: sx, z: sz, startedAt: performance.now(), durationMs: 7000 }]);
                                        window.setTimeout(() => setResidues((list) => list.filter((r) => r.key !== residueKey)), 7400);
                                    }, (event.super ? 2100 : 1150) / speed);
                                }
                            }
                        }
                        // A landed signature CLAIMS the arena: its element holds
                        // the field as the standing climate until another does.
                        if (!reducedMotion && event.super && !target.splash && target.id !== event.actorId) {
                            setClimate({ element: event.element, since: performance.now() });
                        }
                        // ONE impact, not two systems: a staged cast fuses its
                        // on-pet detonation with the hero art — bigger, and
                        // timed to the moment the piece ARRIVES (the wave
                        // breaking, the eruption cresting) instead of popping
                        // its own small burst at contact beside the painting.
                        later(() => spawnFlipbook(
                            target.id,
                            impactFlipbookKey(event.element, event.moveKind, event.super),
                            staged ? burst * 1.5 : burst,
                            ((staged ? 620 : 440) + Math.min(1, frac * 2.4) * 380) / speed,
                            1.0,
                            1,
                            elementVfxTint(event.element),
                        ), (staged ? (event.super ? 840 : 460) : 60) / speed);
                        // A heavy or lethal blow gets a second, larger shell over
                        // the first — `explosion` and `bighit` ship in the bundle
                        // and nothing used to spawn them.
                        // The KO's SIMULATED body: a Blender-baked Mantaflow
                        // detonation (fireball into turbulent smoke) plays
                        // normal-blended under the flash and the kaboom, the
                        // same division of labour as the plume and the mist —
                        // the sim carries the mass, the procedural layers keep
                        // the crisp hot core.
                        if (target.ko && !target.splash && !reducedMotion) {
                            later(() => spawnFlipbook(target.id, "burst", burst * 2.1, 1150 / speed, 1.15, 1, undefined, true), 40 / speed);
                        }
                        if (target.ko || event.weight === "heavy" || event.super) {
                            later(() => spawnFlipbook(
                                target.id,
                                target.ko ? "explosion" : "bighit",
                                burst * 1.35,
                                460 / speed,
                                1.05,
                                1,
                                elementVfxTint(event.element),
                            ), 70 / speed);
                        }
                        // Lightning ranged attacks STRIKE FROM THE SKY — a tall
                        // bolt drops on the victim (there was no travel to
                        // watch). A STAGED cast already strikes with the painted
                        // stormbolt piece; doubling it with the chunky flipbook
                        // bolt was exactly the "two different vfx firing" read.
                        if (event.element === "Lightning" && event.delivery === "ranged" && !target.splash && !staged) {
                            spawnFlipbook(target.id, "lightning", 2.9, 520, 2.6, 2.2);
                        }
                        // A signature also detonates its ELEMENT large over the
                        // kaboom, so every super reads as its nature — but only
                        // when reduced-motion suppressed the staged hero piece
                        // that now owns that job.
                        if (event.super && !target.splash && !staged) {
                            const el = event.element.toLowerCase();
                            if (["fire", "water", "earth", "wind", "lightning"].includes(el)) {
                                spawnFlipbook(target.id, el, 4.4, 820);
                            }
                        }
                        if (target.effectiveness === "super") bestEffect = "super";
                        else if (target.effectiveness === "weak" && bestEffect !== "super") bestEffect = "weak";
                        anySynergy = anySynergy || !!target.synergy;
                    }
                    if (target.heal > 0) {
                        addPopup(target.id, `+${target.heal}`, "heal");
                        spawnFlipbook(target.id, "heal", 2.2, 700);
                        anyHeal = true;
                    }
                    if (target.applied && target.damage === 0 && target.heal === 0) {
                        addPopup(target.id, String(target.applied).toUpperCase(), "status");
                        spawnFlipbook(target.id, impactFlipbookKey(event.element, target.applied, false), 1.9, 620);
                    }
                    // The moveset reads — PER-TARGET scope, not inside the
                    // damage branch: a buff deals 0 damage, and gating the kind
                    // accent on damage meant the Swords Dance shaft cage could
                    // never fire for an actual stat-up. Accents fire for any
                    // landed effect; streaks and debris stay damage-gated.
                    if (!reducedMotion && !target.splash && (target.damage > 0 || target.heal > 0 || target.applied)) {
                        const at = posRef.current.get(target.id);
                        const from = posRef.current.get(event.actorId);
                        if (at) {
                            const [kx, , kz] = at;
                            const len = from ? Math.hypot(kx - from[0], kz - from[2]) || 1 : 1;
                            const dirX = from ? (kx - from[0]) / len : 0;
                            const dirZ = from ? (kz - from[2]) / len : 1;
                            if (kindAccentFamily(event.moveKind)) {
                                const kKey = popupKey.current++;
                                setKindFx((list) => [...list.slice(-7), { key: kKey, kind: event.moveKind, element: event.element, x: kx, z: kz, dirX, dirZ, startedAt: performance.now(), durationMs: 1000 / speed }]);
                                window.setTimeout(() => setKindFx((list) => list.filter((k) => k.key !== kKey)), 1400 / speed);
                            }
                            if (target.damage > 0 && (event.super || event.weight === "heavy" || target.ko)) {
                                const sKey = popupKey.current++;
                                setStreakFx((list) => [...list.slice(-5), { key: sKey, element: event.element, x: kx, z: kz, startedAt: performance.now(), durationMs: 750 / speed, heavy: event.super || target.ko }]);
                                window.setTimeout(() => setStreakFx((list) => list.filter((s) => s.key !== sKey)), 1100 / speed);
                            }
                            if (target.damage > 0 && (event.moveKind === "crush" || (event.element === "Earth" && (event.super || event.weight === "heavy")))) {
                                const dKey = popupKey.current++;
                                setDebrisFx((list) => [...list.slice(-4), { key: dKey, element: event.element, x: kx, z: kz, startedAt: performance.now(), durationMs: 1300 / speed, heavy: event.super || event.weight === "heavy" }]);
                                window.setTimeout(() => setDebrisFx((list) => list.filter((d) => d.key !== dKey)), 1700 / speed);
                            }
                        }
                    }
                    anyKo = anyKo || target.ko;
                    applyToDisplay(setDisplay, target.id, (d) => ({
                        ...d,
                        hp: Math.max(0, Math.min(stateMaxHp(stateView, target.id), d.hp - target.damage + target.heal)),
                        ko: target.ko,
                    }));
                }
                // Actor resource sync — and the guard shell tracks whoever is
                // actually holding Guard right now.
                applyToDisplay(setDisplay, event.actorId, (d) => ({
                    ...d, stamina: event.staminaAfter, meter: event.meterAfter,
                    guarding: event.moveKind === "guard",
                }));
                const totalDamage = event.targets.reduce((sum, t) => sum + t.damage, 0);
                // The killing blow is the fight's headline moment and gets the
                // full anime ceremony: a LONG contact freeze, the manga impact
                // frame (radial lines + desaturation), the hardest shake, and
                // the crowd erupting — before the extended beat lets the fall
                // and the silence land.
                const kill = event.targets.some((t) => t.ko && t.id !== event.actorId);
                if (totalDamage > 0) {
                    const impactNow = performance.now();
                    const peakDamageFraction = event.targets.reduce(
                        (peak, target) => Math.max(peak, target.damage / Math.max(1, stateMaxHp(stateView, target.id))),
                        0,
                    );
                    const cinematic = showdownCinematicImpulse({
                        damageFraction: peakDamageFraction,
                        superMove: event.super,
                        killingBlow: kill,
                        lightning: event.element === "Lightning",
                    });
                    fxRef.current.shakeUntil = performance.now() + (kill ? 620 : event.super ? 460 : 300);
                    // Screen shake is motion; hit-stop is a timing freeze and stays.
                    fxRef.current.shakeAmp = reducedMotion
                        ? 0
                        : kill ? 0.42 : event.super ? 0.34 : Math.min(0.24, 0.08 + totalDamage / 900);
                    playPetSfx(kill ? "ko" : event.super ? "crit" : "hit");
                    if (kill || event.super) later(() => playPetSfx("crowd"), kill ? 420 : 260);
                    // Damage-scaled hit-stop (fighting-game contact freeze),
                    // heavier for Lightning per the electric-hitlag convention.
                    fxRef.current.hitStopUntil = impactNow + cinematic.hitStopMs;
                    fxRef.current.slowScale = cinematic.slowScale;
                    fxRef.current.slowUntil = fxRef.current.hitStopUntil + cinematic.slowMotionMs;
                    fxRef.current.lensStartedAt = impactNow;
                    fxRef.current.lensUntil = impactNow + (kill ? 780 : event.super ? 620 : 380);
                    fxRef.current.lensAmp = reducedMotion ? 0 : cinematic.lensDegrees;
                    if (kill) {
                        petHaptic(60);
                        fxRef.current.crowdBurstAt = performance.now();
                        fxRef.current.crowdBurstKind = "ko";
                        if (!reducedMotion) {
                            setKoImpact(popupKey.current++);
                            later(() => setKoImpact(0), 520);
                        }
                        const finisherKey = popupKey.current++;
                        setFinisher({
                            key: finisherKey,
                            actor: nameOf(stateView, event.actorId),
                            move: event.moveName,
                            element: event.element,
                        });
                        if (!event.super) setLetterbox(true);
                        later(() => {
                            setFinisher((current) => current?.key === finisherKey ? null : current);
                            if (!event.super) setLetterbox(false);
                        }, 1320);
                    } else if (event.super) {
                        // A landed signature also brings the stands to their feet.
                        fxRef.current.crowdBurstAt = performance.now();
                        fxRef.current.crowdBurstKind = "super";
                    }
                    if (event.super) {
                        // Signature detonation: light pillar on the primary target
                        // + a full-screen white flash.
                        const primary = posRef.current.get(event.targets[0].id);
                        if (primary) {
                            pillarDrive.current = {
                                startedAt: performance.now(),
                                activeUntil: performance.now() + 750,
                                x: primary[0],
                                z: primary[2],
                                color: ELEMENT_TINT[event.element] ?? "#fbbf24",
                            };
                        }
                        if (!reducedMotion) {
                            setFlashTint(ELEMENT_TINT[event.element] ?? "#ffffff");
                            setFlash(popupKey.current++);
                            later(() => setFlash(0), 560);
                            // The frame BREATHES with the detonation: a dark
                            // vignette clamps the edges and releases.
                            setVignette(popupKey.current++);
                            later(() => setVignette(0), 760);
                        }
                    }
                } else if (event.moveKind === "guard") {
                    playPetSfx("shield");
                    spawnFlipbook(event.actorId, "eshield", 2.0, 600);
                } else if (anyHeal) {
                    playPetSfx("heal");
                } else if (event.targets.some((t) => t.applied)) {
                    playPetSfx("buff");
                }
                // Overdraft: the actor bleeds for the deficit (the reference model's chip).
                if (event.overexertDamage) {
                    addPopup(event.actorId, `-${event.overexertDamage}`, "damage");
                    fxRef.current.hitAt.set(event.actorId, performance.now());
                    applyToDisplay(setDisplay, event.actorId, (d) => ({
                        ...d,
                        hp: Math.max(0, d.hp - (event.overexertDamage ?? 0)),
                        ko: d.hp - (event.overexertDamage ?? 0) <= 0,
                    }));
                }
                // Name the trait/gear that bent the number — these used to
                // mutate damage with nothing on screen to attribute it to.
                const firedProcs = [...new Set(event.targets.flatMap((t) => t.procs ?? []))];
                if (firedProcs.length && event.actorSide === "player") {
                    later(() => addPopup(event.actorId, firedProcs[0], "proc"), 180);
                }
                if (anySynergy && event.actorSide === "player") showBanner("SYNERGY", "effective", 850 / speed);
                else if (bestEffect === "super") {
                    showBanner("Super effective!", "effective", 900 / speed);
                    playPetSfx("superEffective");
                    // "The screen practically vibrates with that classic
                    // super-effective energy" — the type win is a physical
                    // event, not a caption: a harder, longer shake on top of
                    // the contact one.
                    if (!reducedMotion) {
                        fxRef.current.shakeUntil = Math.max(fxRef.current.shakeUntil, performance.now() + 430);
                        fxRef.current.shakeAmp = Math.max(fxRef.current.shakeAmp, 0.3);
                    }
                }
                else if (bestEffect === "weak") showBanner("Not very effective…", "weak", 900 / speed);
                if (anyKo) later(() => { showBanner("KO!", "ko", 900 / speed); playPetSfx("ko"); }, 220);
                if (event.overexerted) later(() => addPopup(event.actorId, "OVEREXERTED!", "overexert"), 300);
            }, durationMs * STRIKE_FRAC);
        }

        later(() => setQueueIndex((i) => i + 1), durationMs);
        return clearTimers;
        // `speed` is deliberately NOT a dep: re-running this effect mid-beat
        // would re-apply the strike side effects (double damage numbers). A
        // fast-forward toggle takes effect from the next beat's fresh closure.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, queue, queueIndex]);

    // ── Command flow ────────────────────────────────────────────────────────
    // Only FIELD pets act and can be targeted; the bench waits its turn.
    const livingPlayer = lineup.playerField
        .map((id) => stateView.player.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    const livingEnemies = lineup.enemyField
        .map((id) => stateView.enemy.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    const livingBench = lineup.playerBench
        .map((id) => stateView.player.find((p) => p.id === id))
        .filter((p): p is ShowdownPetView => !!p && !(display[p.id]?.ko ?? p.ko));
    // Rules live in lib/showdown-turn.ts so the EMPTY case is testable — see
    // the soft-lock guard below.
    const promptable = promptablePets(livingPlayer, livingBench.length);
    const commander = phase === "command" && !spectator ? promptable[draft.length] ?? null : null;
    const commanderMustSwitch = !!commander && commander.skipsNextAction;
    const commanderDisplay = commander ? display[commander.id] : null;
    // SOFT-LOCK GUARD. `promptable` can legitimately come back EMPTY — every
    // living pet winded by overdraft (which bars switching) or stunned with no
    // bench to rotate to. The command deck is gated on `commander`, and the
    // only call to submitRound lives inside pushCommand, which the deck owns —
    // so an empty promptable rendered a blank bottom bar with no way to advance
    // the round, and the sole surviving control was Forfeit. The player threw
    // away fights they were winning to escape a UI state the Overdraft rule is
    // *designed* to produce.
    //
    // There is no decision to take here, so don't ask for one: resolve the
    // round on an empty draft. The engine already defaults every missing
    // command to a guard, and its winded/stun branch discards that anyway —
    // the same reasoning pushCommand relies on when it omits skipped pets.
    //
    // A refused submit takes precedence: the auto-resolve would otherwise sit
    // in a silent 900ms retry loop against a server that just said no, and the
    // retry panel is the surface that says so out loud.
    const roundStalled = phase === "command" && promptable.length === 0 && !expired && !failedOrders;

    // Fire the round: called from the LAST pushCommand (event handler, not an
    // effect — every setState here runs in handler/async context).
    const submitRound = useCallback(async (commands: ShowdownCommand[]) => {
        // Order matters. The stale queue from LAST round is dropped before the
        // phase flips, and the in-flight hold is raised before anything else:
        // the beat player wakes the moment phase changes, and what it must see
        // is "empty script, response pending" — not last round's beats (which
        // it would happily replay) and not "script exhausted, hand control
        // back" (which orphaned the incoming script in the wrong phase).
        submitInFlight.current = true;
        setQueue([]);
        setQueueIndex(0);
        setPhase("playing");
        setFailedOrders(null);
        const response = await submitTurn(commands);
        submitInFlight.current = false;
        if (response && "expired" in response) {
            // Session lapsed (45-min TTL) — a distinct dead end, not a retry.
            setExpired(true);
            return;
        }
        if (!response || !response.ok) {
            // HOLD THE ROUND. A 3v3 draft is six decisions, and throwing them
            // away turns the server's failure into the player's re-entry work.
            // The orders are kept verbatim so the retry sends exactly what was
            // chosen — the deck stands down and the failure takes its place.
            setFailedOrders(commands);
            setPhase("command");
            return;
        }
        settlementRef.current = response;
        setSettlement(response);
        // Tally at INGEST, not during playback — fast-forwarding or leaving
        // early must not change the recap. Every number here is server-sent.
        for (const ev of response.events) {
            if (ev.t !== "action") continue;
            const row = tallyRef.current.get(ev.actorId) ?? { dmg: 0, kos: 0, supers: 0 };
            for (const t of ev.targets) {
                if (t.id !== ev.actorId) row.dmg += t.damage;
                if (t.ko && t.id !== ev.actorId) row.kos += 1;
            }
            if (ev.super) row.supers += 1;
            tallyRef.current.set(ev.actorId, row);
        }
        setQueue(response.events);
        setQueueIndex(0);
        if (!response.events.length && response.state) {
            // Finished session replay (e.g. payout retry) — no script to play.
            setStateView(response.state);
            setDisplay(buildDisplay(response.state));
            setLineup(lineupFromState(response.state));
            if (response.state.finished) {
                setPhase("finished");
                setRecap(buildRecap(response.state, tallyRef.current));
                if (!finishedNotified.current && response.state.outcome) {
                    finishedNotified.current = true;
                    onFinished(response.state.outcome, response);
                }
            }
        }
    }, [submitTurn, onFinished]);

    // Spectator auto-advance: the moment the deck WOULD open, submit empty
    // orders instead. The replay driver ignores the commands and returns the
    // recorded script, so the match narrates itself.
    //
    // Deferred to a timeout rather than called inline: submitRound sets state,
    // and doing that synchronously inside an effect cascades renders. A frame's
    // delay is invisible here (the deck is hidden in spectator mode anyway) and
    // it lets the render that opened the phase finish first.
    useEffect(() => {
        if (!spectator || phase !== "command") return;
        const id = window.setTimeout(() => { void submitRound([]); }, 0);
        return () => window.clearTimeout(id);
    }, [spectator, phase, submitRound]);

    // Drive the soft-lock guard (see `roundStalled`). Deliberately on a short
    // delay rather than instantly: the player should SEE the "no orders" panel
    // register before the round resolves, otherwise a stunned round looks like
    // the game skipped their turn for no reason.
    useEffect(() => {
        if (!roundStalled) return;
        const t = setTimeout(() => { void submitRound([]); }, 900);
        return () => clearTimeout(t);
    }, [roundStalled, submitRound]);

    // Say whose turn it is. The deck is a list of buttons that names the move
    // but never the pet being asked, nor the shape it is in — both of which a
    // sighted player reads straight off the plate.
    useEffect(() => {
        if (phase !== "command" || !commander) return;
        const line = pickingSwitch
            ? `Choose a reserve to send in for ${commander.name}.`
            : pendingMove
                ? `Choose a target for ${commander.name}.`
                : `${commander.name}'s orders. ${commander.hp} of ${commander.maxHp} health, ${commander.stamina} stamina.${commanderMustSwitch ? " It loses this action — rotate out or hold the line." : ""}`;
        const t = window.setTimeout(() => setAnnouncement(line), 0);
        return () => window.clearTimeout(t);
    }, [phase, commander, commanderMustSwitch, pendingMove, pickingSwitch]);

    // Plain handlers (not useCallback): they close over render-derived values
    // (draft, livingPlayer) and only ever run from committed-event contexts.
    const pushCommand = (command: ShowdownCommand) => {
        setPendingMove(null);
        setPickingSwitch(false);
        setFocusRow(0);
        const nextDraft = [...draft, command];
        setDraft(nextDraft);
        // Omitting a skipped pet is safe: the engine defaults any missing
        // command to a guard, which its winded/stun branch discards anyway.
        if (nextDraft.length >= promptable.length) void submitRound(nextDraft);
    };

    const chooseMove = (moveIndex: number, superCast: boolean) => {
        if (!commander) return;
        const move = superCast ? commander.moves.find((m) => m.signature) : commander.moves[moveIndex];
        if (!move) return;
        const needsEnemy = !SELF_MOVE_KINDS.has(move.kind) && !ALLY_MOVE_KINDS.has(move.kind);
        const needsAlly = ALLY_MOVE_KINDS.has(move.kind);
        if (needsEnemy && livingEnemies.length > 1) {
            setPendingMove({ moveIndex, super: superCast });
            return;
        }
        if (needsAlly && livingPlayer.length > 1) {
            setPendingMove({ moveIndex, super: superCast });
            return;
        }
        const targetId = needsEnemy ? (livingEnemies[0]?.id ?? "") : needsAlly ? commander.id : commander.id;
        pushCommand(superCast
            ? { kind: "super", petId: commander.id, targetId }
            : { kind: "move", petId: commander.id, moveIndex, targetId });
    };


    /** One entry point for every "you clicked a creature" decision. */
    const pickTarget = (targetId: string) => {
        if (!commander) return;
        playPetSfx("uiConfirm");
        petHaptic(12);
        setHoveredTarget(null);
        if (pickingSwitch) {
            pushCommand({ kind: "switch", petId: commander.id, benchPetId: targetId });
            return;
        }
        if (!pendingMove) return;
        const wasSuper = pendingMove.super;
        const moveIndex = pendingMove.moveIndex;
        setPendingMove(null);
        pushCommand(wasSuper
            ? { kind: "super", petId: commander.id, targetId }
            : { kind: "move", petId: commander.id, moveIndex, targetId });
    };


    /** Hand the kept orders back to the deck, minus the last one — the deck
     *  reopens on the pet whose order the player is most likely rewriting, and
     *  everything before it survives. */
    const reviseOrders = () => {
        if (!failedOrders) return;
        playPetSfx("uiCancel");
        setDraft(failedOrders.slice(0, -1));
        setFailedOrders(null);
        setPendingMove(null);
        setPickingSwitch(false);
        setFocusRow(0);
    };

    const outcome = stateView.outcome;
    /** The fight is DECIDED the instant the server's end event opens: the
     *  result is already banked on the server, so from here a forfeit is a
     *  stale question about a fight that is over. */
    const battleDecided = phase === "finished" || !!endOutcome || stateView.finished;
    /** Exactly ONE full-screen panel, in this order. They used to be
     *  independent siblings, so a forfeit prompt opened during the last
     *  exchange stayed up over the victory screen and its scrim — and the
     *  concede button under it would then throw away a won fight. */
    const panel: "result" | "expired" | "forfeit" | null =
        phase === "finished" ? "result"
            : expired ? "expired"
                : confirmForfeit && !battleDecided ? "forfeit"
                    : null;
    const concede = () => {
        // Guard the action, not just its visibility: a click can still land on
        // the button in the frame where the fight resolves.
        if (battleDecided || expired) { setConfirmForfeit(false); return; }
        onForfeit();
    };
    const targetingAllies = !!pendingMove && !!commander && ALLY_MOVE_KINDS.has((pendingMove.super ? commander.moves.find((m) => m.signature) : commander.moves[pendingMove.moveIndex])?.kind ?? "");
    /** Which creatures may be clicked right now. Targeting an enemy for an
     *  attack, an ally for a heal, or a bench pet for a switch — all three are
     *  done by clicking the MODEL. */
    const isTargetable = (info: FighterSlotInfo): boolean => {
        if (display[info.view.id]?.ko ?? info.view.ko) return false;
        const benched = info.side === "player"
            ? lineup.playerBench.includes(info.view.id)
            : lineup.enemyBench.includes(info.view.id);
        if (pickingSwitch) return info.side === "player" && benched;
        if (!pendingMove) return false;
        if (benched) return false;
        return targetingAllies ? info.side === "player" : info.side === "enemy";
    };

    /** A hover only counts while targeting is actually open. r3f deletes a
     *  mesh's handlers the moment `targetable` goes false and its cancelPointer
     *  drops the hovered entry BEFORE the eventCount guard — so a pet that stops
     *  being a legal target under a STATIONARY pointer never fires pointerout,
     *  and the raw state would stay latched (stuck cursor, glowing plate, a
     *  stale "→ target" line). Deriving it closes every exit at once. */
    const activeHover = pendingMove || pickingSwitch ? hoveredTarget : null;

    // Pointer feedback: a targetable creature gets the pointer cursor.
    useEffect(() => {
        if (!activeHover || phase !== "command") return;
        document.body.style.cursor = "pointer";
        return () => { document.body.style.cursor = ""; };
    }, [activeHover, phase]);

    const panelArt = useMemo(
        () => Object.fromEntries([...slots.values()].map((i) => [i.view.id, i.fallbackImage])),
        [slots],
    );
    const playerBenchedIds = useMemo(() => new Set(lineup.playerBench), [lineup.playerBench]);
    const enemyBenchedIds = useMemo(() => new Set(lineup.enemyBench), [lineup.enemyBench]);

    // There is deliberately NO turn-order prediction (the old EST. ORDER
    // strip): who acts first is something you LEARN by watching a round —
    // reading the opponent's tempo is part of the game, and it is what makes
    // a speed-trained pet feel trained. Owner ruling, 2026-08-12.
    // Carry each move's REAL index in `pet.moves`. The engine reads
    // `command.moveIndex` against its OWN move list, which the view mirrors with
    // the signature appended last (engine.ts serializes `pet.moves` then
    // concats the signature) — so today the filtered position happens to match.
    // Addressing by real index does not depend on that ordering holding.
    const commanderMoves = (commander?.moves ?? [])
        .map((move, index) => ({ move, index }))
        .filter((entry) => !entry.move.signature);
    const commanderSignature = commander?.moves.find((m) => m.signature) ?? null;

    // ── Console-style command menu ──────────────────────────────────────────
    const staminaNow = commanderDisplay?.stamina ?? commander?.stamina ?? 0;
    const meterNow = commanderDisplay?.meter ?? commander?.meter ?? 0;
    const commanderElement = commander?.element ?? "None";
    const menuRows = buildMenuRows({
        commander,
        mustSwitch: commanderMustSwitch,
        moves: commanderMoves,
        signature: commanderSignature,
        staminaNow,
        meterNow,
        benchCount: livingBench.length,
        fieldCount: livingPlayer.length,
    });
    const runMenuAction = (action: MenuAction) => {
        if (!commander) return;
        switch (action.t) {
            case "move": return chooseMove(action.moveIndex, action.super);
            case "guard": return pushCommand({ kind: "guard", petId: commander.id });
            case "rest": return pushCommand({ kind: "rest", petId: commander.id });
            case "beginSwitch": setPickingSwitch(true); setFocusRow(0); return;
        }
    };
    const focusIndex = Math.min(focusRow, Math.max(0, menuRows.length - 1));
    const pendingMoveView = commander && pendingMove
        ? (pendingMove.super ? commanderSignature : commander.moves[pendingMove.moveIndex]) ?? null
        : null;
    const inspectorSpec: InspectorSpec | null = pendingMoveView && commander
        ? moveInspector(pendingMoveView, commanderElement, staminaNow, commander.readiness)
        : pickingSwitch
            ? { title: "Switch", element: commanderElement, category: "Rotation", description: "Click the reserve you want on the field." }
            : menuRows[focusIndex]?.detail ?? null;
    const hoveredName = activeHover
        ? [...stateView.player, ...stateView.enemy].find((p) => p.id === activeHover)?.name ?? null
        : null;

    const overlay = (
        <div
            ref={takeoverRef}
            className="pet-combat-takeover showdown-takeover"
            role="dialog"
            aria-modal="true"
            aria-label={`Pet Showdown — your team against ${stateView.enemyTeamName}`}
            tabIndex={-1}
        >
            {/* The whole fight, in words. Polite and atomic: a beat replaces the
                last one rather than queuing behind it, which is what keeps the
                readout with the battle instead of minutes behind it. */}
            <div style={SR_ONLY} role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
            {/* preserveDrawingBuffer rides the ?slowfx review flag: it lets the
                dev harness snapshot the WebGL canvas mid-beat (toDataURL reads
                blank without it). Off in normal play — it costs a buffer. */}
            {/* toneMappingExposure 1.12: the filmic curve at default exposure
                sat a hair flat next to the painted arenas — a slight push
                deepens the blacks and lets the VFX (toneMapped:false) pop
                against them without touching any material. */}
            <Canvas
                shadows={renderQuality.modelShadows ? "percentage" : false}
                dpr={renderQuality.dpr}
                gl={{ antialias: true, preserveDrawingBuffer: fxStretch > 1 || captureFlag, toneMappingExposure: 1.12 }}
                camera={{ fov: 48, position: [...WIDE_POS], near: 0.1, far: 80 }}
            >
                <StageEnvironment stage={stage} beatRef={beatRef} fxRef={fxRef} />
                <CameraDirector beatRef={beatRef} fxRef={fxRef} posRef={posRef} lineup={lineup} reduced={reducedMotion} />
                <BeatDrivenVfx beatRef={beatRef} posRef={posRef} radii={fighterRadii} signatures={fighterSignatures} />
                <SuperPillar drive={pillarDrive} />
                <ShowdownVfxLayer spawns={vfx} />
                <ShowdownSetPieceLayer spawns={setPieces} />
                {/* The arena remembers: persistent strike scars, the element
                    residue after each signature, and the CLIMATE the last
                    signature left holding the field. */}
                <ScarLayer scars={scars} />
                {residues.map((r) => <ResidueFx key={r.key} spawn={r} />)}
                <ClimateLayer element={climateElement} reduced={reducedMotion} />
                {/* The moveset READS: casting glyph + charge orb during ranged
                    channels, per-kind accents, streak-throughs and debris. */}
                <CastGlyphFx beatRef={beatRef} posRef={posRef} />
                <ChargeOrbFx beatRef={beatRef} posRef={posRef} onSun={setGodRaySun} />
                {kindFx.map((k) => <KindAccentFx key={k.key} spawn={k} />)}
                {streakFx.map((s) => <StreakBurstFx key={s.key} spawn={s} />)}
                {debrisFx.map((d) => <DebrisFx key={d.key} spawn={d} />)}
                {petBloomEnabled() && !reducedMotion && godRaySun && (
                    <ShowdownPostStack fxRef={fxRef} />
                )}
                {[...slots.values()].map((info) => (
                    <ShowdownFighter
                        key={info.view.id}
                        info={info}
                        displayHp={display[info.view.id]?.hp ?? info.view.hp}
                        ko={display[info.view.id]?.ko ?? info.view.ko}
                        guarding={display[info.view.id]?.guarding ?? false}
                        statuses={display[info.view.id]?.statuses ?? []}
                        // Latches off the END EVENT, not the finished phase: the phase
                        // flips a frame AFTER the result panel mounts, so the winner
                        // used to stand in a plain idle for the whole victory beat.
                        victorious={(endOutcome ?? (phase === "finished" ? outcome : null)) === (info.side === "player" ? "win" : "loss")}
                        introActive={intro}
                        beatRef={beatRef}
                        fxRef={fxRef}
                        posRef={posRef}
                        radii={fighterRadii}
                        benchedRef={benchedRef}
                        restingTargetId={pairedShowdownOpponentId(
                            info.view.id,
                            info.side === "player" ? lineup.playerField : lineup.enemyField,
                            info.side === "player" ? lineup.enemyField : lineup.playerField,
                            info.side,
                        )}
                        popups={popups}
                        highlight={commander?.id === info.view.id ? "commander"
                            : pendingMove && ((info.side === "enemy" && !targetingAllies) || (info.side === "player" && targetingAllies)) && !(display[info.view.id]?.ko) ? "targeted"
                            : "none"}
                        targetable={isTargetable(info)}
                        onPick={pickTarget}
                        onHover={setHoveredTarget}
                    />
                ))}
            </Canvas>

            {/* FIELD WEATHER. Driven by the server's standing weather, so it is
                on exactly while the technique's window is, and reduced-motion
                drops it entirely (SceneAmbience animates continuously). */}
            {!reducedMotion && climateElement && ELEMENT_WEATHER[climateElement] && (
                <SceneAmbience
                    biome={ELEMENT_WEATHER[climateElement].biome}
                    weather={ELEMENT_WEATHER[climateElement].weather}
                    intensity={1.25}
                    className="showdown-sky"
                />
            )}

            {/* Cinematic letterbox during signature casts. */}
            {letterbox && (
                <div className="showdown-letterbox">
                    <div className="bar top" />
                    <div className="bar bottom" />
                </div>
            )}
            {/* Full-frame ELEMENT flash on the signature detonation — the
                whole arena goes the move's color for a beat (the reference
                whiteout/orange-out), soft radial so the victim stays read. */}
            {flash !== 0 && (
                <div
                    key={flash}
                    className="showdown-flash element"
                    style={{ background: `radial-gradient(circle at 50% 45%, ${flashTint}e8 0%, ${flashTint}88 48%, ${flashTint}2e 100%)` }}
                />
            )}
            {/* The killing blow's impact frame: white core, manga radial
                lines bursting from the edges, the world briefly drained of
                color. Reduced-motion never mounts it. */}
            {koImpact !== 0 && <div key={koImpact} className="showdown-ko-impact" />}
            {vignette !== 0 && <div key={vignette} className="showdown-vignette" />}
            {finisher && (
                <div
                    key={finisher.key}
                    className="showdown-finisher"
                    style={{ "--finisher-tint": ELEMENT_TINT[finisher.element] ?? "#ffffff" } as React.CSSProperties}
                    aria-hidden="true"
                >
                    <span className="showdown-finisher-kicker">Finishing blow</span>
                    <strong>{finisher.move}</strong>
                    <span>{finisher.actor}</span>
                </div>
            )}

            {/* Opening VS card. */}
            {intro && (
                <div className="showdown-vs-intro">
                    <div className="showdown-vs-side mine">
                        {stateView.player.map((p) => panelArt[p.id] && <img key={p.id} src={panelArt[p.id]} alt={p.name} />)}
                        <span>Your team</span>
                    </div>
                    <div className="showdown-vs-burst">VS</div>
                    <div className="showdown-vs-side theirs">
                        {stateView.enemy.map((p) => panelArt[p.id] && <img key={p.id} src={panelArt[p.id]} alt={p.name} />)}
                        <span>{stateView.enemyTeamName}</span>
                    </div>
                </div>
            )}

            {/* ── HUD ── */}
            <div className="showdown-hud">
                <div className="showdown-topbar">
                    <TeamPanel
                        side="enemy"
                        pets={stateView.enemy}
                        display={display}
                        targeting={!!pendingMove && !targetingAllies}
                        onPickTarget={pickTarget}
                        hintElement={commander?.element}
                        art={panelArt}
                        benchedIds={enemyBenchedIds}
                        hoveredId={activeHover}
                    />
                    <div className="showdown-topbar-right">
                        {/* stateView.round reconciles at playback end, so the round
                            IN PROGRESS (command or playing) is always round + 1. */}
                        <div className="showdown-round">R{stateView.finished ? stateView.round : stateView.round + 1}/{stateView.turnCap}</div>
                        {stateView.weather && (
                            <div className={`showdown-weather ${stateView.weather.element.toLowerCase()}`}
                                title={`${stateView.weather.element} weather: ${stateView.weather.element} techniques hit harder, its counter is dampened`}>
                                <ShowdownIcon name={elementCrest(stateView.weather.element)} size={12} />
                                {stateView.weather.roundsLeft}
                            </div>
                        )}
                        {stateView.turnDeadline !== undefined && phase === "command" && !spectator && (
                            <TurnTimer deadline={stateView.turnDeadline} onLapse={() => { void submitRound(draft); }} />
                        )}
                        <div className="showdown-vs">{stateView.enemyTeamName}</div>
                        <button
                            type="button"
                            className={`showdown-chip icon ${fast ? "on" : ""}`}
                            onClick={() => setFast((f) => !f)}
                        >
                            <ShowdownIcon name="fast" size={15} title={fast ? "Fast playback" : "Normal playback"} />
                        </button>
                        {/* The takeover hides the global menu, so this is the
                            only reachable audio control during a fight. */}
                        <button type="button" className="showdown-chip icon" onClick={toggleAudio}>
                            <ShowdownIcon name={muted ? "sound-off" : "sound-on"} size={15} title={muted ? "Sound off" : "Sound on"} />
                        </button>
                        {!battleDecided && !expired && (
                            <button type="button" className="showdown-chip danger icon" aria-label="Forfeit the battle" onClick={() => setConfirmForfeit(true)}>
                                <ShowdownIcon name="flag" size={15} title="Forfeit" />
                            </button>
                        )}
                    </div>
                </div>

                {banner && <div key={banner.key} className={`showdown-banner ${banner.cls}`}>{banner.text}</div>}


                <div className="showdown-playerbar">
                    <TeamPanel
                        side="player"
                        pets={stateView.player}
                        display={display}
                        targeting={!!pendingMove && targetingAllies}
                        onPickTarget={pickTarget}
                        commanderId={commander?.id ?? null}
                        art={panelArt}
                        benchedIds={playerBenchedIds}
                        benchPicking={pickingSwitch}
                        onPickBench={(benchId) => {
                            if (!commander) return;
                            pushCommand({ kind: "switch", petId: commander.id, benchPetId: benchId });
                        }}
                        hoveredId={activeHover}
                    />
                </div>

                <div className="showdown-bottombar">
                    {/* No pet can be given an order this round. Name the reason
                        and show it resolving — the failure this replaces was a
                        silent empty bar. The button is a manual escape hatch in
                        case the auto-resolve above is ever prevented from
                        firing; it must never be the ONLY way out. */}
                    {roundStalled && (
                        <div className="showdown-stalled" role="status" aria-live="polite">
                            <div className="showdown-stalled-title">No orders possible</div>
                            <div className="showdown-stalled-body">
                                Every pet still standing is winded or stunned. The round resolves itself.
                            </div>
                            <button type="button" className="showdown-chip" onClick={() => { void submitRound([]); }}>
                                Resolve round
                            </button>
                        </div>
                    )}
                    {/* The submit was refused. This stands in the command deck's
                        own slot — the failure is the loudest thing on screen,
                        and the orders it lists are the ones still held, so the
                        panel is also the receipt that nothing was lost. */}
                    {failedOrders && phase === "command" && !spectator && (
                        <div className="showdown-stalled" role="alert">
                            <div className="showdown-stalled-title">Orders not sent</div>
                            <div className="showdown-stalled-body">
                                {failedOrders.length > 0
                                    ? <>The server refused this round. Your {failedOrders.length === 1 ? "order is" : `${failedOrders.length} orders are`} still here — send {failedOrders.length === 1 ? "it" : "them"} again.</>
                                    : <>The server refused this round. Nothing was lost — try resolving it again.</>}
                            </div>
                            {failedOrders.length > 0 && (
                                <ul className="showdown-stalled-body" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                                    {failedOrders.map((command, i) => (
                                        <li key={`${command.petId}-${i}`}>{describeCommand(stateView, command)}</li>
                                    ))}
                                </ul>
                            )}
                            <div className="showdown-result-buttons">
                                <button type="button" className="showdown-cta" autoFocus onClick={() => { void submitRound(failedOrders); }}>
                                    Send again
                                </button>
                                {failedOrders.length > 0 && (
                                    <button type="button" className="showdown-chip" onClick={reviseOrders}>
                                        Change the last order
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                    {phase === "command" && commander && !failedOrders && (
                        <>
                            {/* Targeting takes over the menu column: the choice is
                                made in the 3D scene, so the panel only says who
                                is asking and offers the way back. */}
                            {(pendingMove || pickingSwitch) ? (
                                <TargetingPanel
                                    title={pickingSwitch ? "Send in…" : "Choose a target"}
                                    /* Reserves wait in the side wings and can sit outside
                                       the standoff shot, so their PLATE is named as the
                                       reliable click target. */
                                    sub={pickingSwitch
                                        ? "Click a reserve — its plate or its model"
                                        : `Click a ${targetingAllies ? "team-mate" : "rival"} — its model or its plate`}
                                    onBack={() => {
                                        if (pickingSwitch) { setPickingSwitch(false); return; }
                                        setPendingMove(null);
                                    }}
                                />
                            ) : (
                                <ActionMenu
                                    key={commander.id}
                                    rows={menuRows}
                                    focus={focusIndex}
                                    onFocusRow={setFocusRow}
                                    onSelect={runMenuAction}
                                />
                            )}
                            <div className="showdown-bottombar-right">
                                {draft.length > 0 && !pendingMove && !pickingSwitch && (
                                    <button type="button" className="showdown-chip showdown-undo" onClick={() => {
                                        playPetSfx("uiCancel");
                                        setFocusRow(0);
                                        setDraft((d) => d.slice(0, -1));
                                    }}>
                                        <ShowdownIcon name="caret-back" size={13} /> Undo last order
                                    </button>
                                )}
                                <MoveInspector spec={inspectorSpec} targetName={hoveredName} />
                            </div>
                        </>
                    )}
                </div>

                {panel === "result" && (
                    <div className="showdown-result" role="dialog" aria-modal="true" aria-label={outcome === "win" ? "Victory" : "Defeat"}>
                        <div className={`showdown-result-title ${outcome === "win" ? "win" : "loss"}`}>
                            {outcome === "win" ? "VICTORY" : "DEFEAT"}
                        </div>
                        {outcome === "win" && (settlement?.reward ?? 0) > 0 && (
                            <div className="showdown-result-reward">+{settlement?.reward} ryo</div>
                        )}
                        {/* Say it outright. A win that pays nothing and SAYS
                            nothing reads as a bug or a robbery — the player
                            cannot tell "this mode is practice" apart from "the
                            payout failed", and the honest label is also what
                            stops them grinding a mode that will never pay. */}
                        {settlement?.practice && (
                            <div className="showdown-result-practice">
                                Practice match — no ryo, and no daily wins spent.
                            </div>
                        )}
                        {/* Squad recap — who actually carried the fight. */}
                        {recap.length > 0 && (
                            <div className="showdown-recap">
                                {recap.map((r) => (
                                    <div key={r.pet.id} className={`showdown-recap-row ${r.mvp ? "mvp" : ""}`}>
                                        {panelArt[r.pet.id] && <img src={panelArt[r.pet.id]} alt="" />}
                                        <span className="showdown-recap-name">
                                            {r.mvp && <b className="showdown-recap-mvp" title="Most damage dealt"><ShowdownIcon name="mvp" size={13} /></b>}{r.pet.name}
                                        </span>
                                        <span className="showdown-recap-stat"><ShowdownIcon name="strike" size={12} />{r.dmg}</span>
                                        {r.kos > 0 && <span className="showdown-recap-stat"><ShowdownIcon name="ko-stamp" size={12} />{r.kos}</span>}
                                        {r.supers > 0 && <span className="showdown-recap-stat"><ShowdownIcon name="signature" size={12} />{r.supers}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        {typeof settlement?.dailyPetWins === "number" && (
                            <div className="showdown-result-daily">
                                Daily arena wins {settlement.dailyPetWins}/100
                            </div>
                        )}
                        {outcome === "win" && settlement?.capped && (
                            <div className="showdown-result-reward capped">Daily arena reward cap reached</div>
                        )}
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta" autoFocus onClick={onRematch}>Battle Again</button>
                            <button type="button" className="showdown-chip" onClick={onExit}>Leave the Showdown</button>
                        </div>
                    </div>
                )}

                {panel === "expired" && (
                    <div className="showdown-result" role="dialog" aria-modal="true" aria-label="This Showdown expired">
                        <div className="showdown-result-title loss">This Showdown expired</div>
                        <div className="showdown-result-reward capped">The session timed out on the server — no result was recorded.</div>
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta" autoFocus onClick={onExit}>Back to the lobby</button>
                        </div>
                    </div>
                )}

                {panel === "forfeit" && (
                    <div className="showdown-result" role="alertdialog" aria-modal="true" aria-label="Forfeit the battle?">
                        <div className="showdown-result-title loss">Forfeit the battle?</div>
                        {/* The safe answer takes the focus: this prompt sits over
                            a live fight, and the destructive one is the reason
                            Escape closes the prompt instead of answering it. */}
                        <div className="showdown-result-buttons">
                            <button type="button" className="showdown-cta danger" onClick={concede}>Yes, concede</button>
                            <button type="button" className="showdown-chip" autoFocus onClick={() => setConfirmForfeit(false)}>Keep fighting</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

/** Squad recap rows, best damage first, MVP crowned. Pure — the caller passes
 *  the tally in, so this never reads a ref during render. */
function buildRecap(
    state: ShowdownStateView,
    tally: Map<string, { dmg: number; kos: number; supers: number }>,
): { pet: ShowdownPetView; dmg: number; kos: number; supers: number; mvp: boolean }[] {
    const rows = state.player
        .map((pet) => ({ pet, ...(tally.get(pet.id) ?? { dmg: 0, kos: 0, supers: 0 }), mvp: false }))
        .sort((a, b) => b.dmg - a.dmg);
    if (rows.length && rows[0].dmg > 0) rows[0].mvp = true;
    return rows;
}

function buildDisplay(state: ShowdownStateView): Record<string, DisplayEntry> {
    const out: Record<string, DisplayEntry> = {};
    for (const pet of [...state.player, ...state.enemy]) {
        out[pet.id] = { hp: pet.hp, stamina: pet.stamina, meter: pet.meter, ko: pet.ko, guarding: pet.guarding, statuses: pet.statuses };
    }
    return out;
}

function applyToDisplay(
    set: React.Dispatch<React.SetStateAction<Record<string, DisplayEntry>>>,
    petId: string,
    fn: (d: DisplayEntry) => DisplayEntry,
): void {
    set((all) => (all[petId] ? { ...all, [petId]: fn(all[petId]) } : all));
}

function nameOf(state: ShowdownStateView, petId: string): string {
    return [...state.player, ...state.enemy].find((p) => p.id === petId)?.name ?? "The pet";
}

function petViewOf(state: ShowdownStateView, petId: string): ShowdownPetView | undefined {
    return [...state.player, ...state.enemy].find((p) => p.id === petId);
}

/** One beat in plain speech, for the live region. Same figures the popups and
 *  banners paint — nothing here is computed, it is all read off the event. */
function describeBeat(event: ShowdownEvent, state: ShowdownStateView): string {
    switch (event.t) {
        case "roundStart":
            return `Round ${event.round}.`;
        case "action": {
            const actor = nameOf(state, event.actorId);
            if (event.moveKind === "guard") return `${actor} braces behind its guard.`;
            if (event.moveKind === "rest") return `${actor} catches its breath.`;
            const hits = event.targets.map((target) => {
                const who = nameOf(state, target.id);
                const parts: string[] = [];
                if (target.damage > 0) parts.push(`${who} takes ${target.damage}${target.guarded ? " through its guard" : ""}`);
                else if (target.heal > 0) parts.push(`${who} recovers ${target.heal}`);
                else if (target.applied) parts.push(`${who} is ${target.applied}`);
                else parts.push(`${who} takes nothing`);
                if (target.effectiveness === "super") parts.push("super effective");
                else if (target.effectiveness === "weak") parts.push("not very effective");
                if (target.ko) parts.push(`${who} is knocked out`);
                return parts.join(", ");
            });
            const overdraft = event.overexertDamage
                ? ` ${actor} overexerts for ${event.overexertDamage} and loses its next action.`
                : "";
            return `${actor} used ${event.moveName}. ${hits.join(". ")}.${overdraft}`;
        }
        case "skip": {
            const actor = nameOf(state, event.actorId);
            return event.reason === "winded" ? `${actor} is winded and loses its action.`
                : event.reason === "stun" ? `${actor} is stunned and loses its action.`
                    : event.reason === "freeze" ? `${actor} is frozen solid and loses its action.`
                        : `${actor} is down.`;
        }
        case "confused": {
            const actor = nameOf(state, event.actorId);
            return `${actor} hurt itself in confusion for ${event.selfDamage}.${event.ko ? ` ${actor} is knocked out.` : ""}`;
        }
        case "switch": {
            const arriving = nameOf(state, event.inId);
            return event.side === "player"
                ? `${arriving} takes the field.`
                : `The enemy sends in ${arriving}.`;
        }
        case "dot": {
            const who = nameOf(state, event.targetId);
            return `${who} takes ${event.damage} from ${event.kind}.${event.ko ? ` ${who} is knocked out.` : ""}`;
        }
        case "consumable": {
            const owner = nameOf(state, event.petId);
            const who = nameOf(state, event.targetId);
            const result = event.damage > 0 ? ` ${who} takes ${event.damage}.`
                : event.heal > 0 ? ` ${who} recovers ${event.heal}.`
                    : "";
            return `${owner}'s ${event.itemName} fires.${result}`;
        }
        case "end":
            return event.outcome === "win" ? "Victory. The battle is over." : "Defeat. The battle is over.";
        default:
            return "";
    }
}

/** One drafted order in words. Used where the orders have to be shown back to
 *  the player as proof they were kept. */
function describeCommand(state: ShowdownStateView, command: ShowdownCommand): string {
    const actor = nameOf(state, command.petId);
    switch (command.kind) {
        case "guard":
            return `${actor} — Guard`;
        case "rest":
            return `${actor} — Catch Breath`;
        case "switch":
            return `${actor} — switch to ${nameOf(state, command.benchPetId)}`;
        case "super": {
            const signature = petViewOf(state, command.petId)?.moves.find((m) => m.signature);
            return `${actor} — ${signature?.name ?? "signature"} → ${nameOf(state, command.targetId)}`;
        }
        case "move": {
            const move = petViewOf(state, command.petId)?.moves[command.moveIndex];
            const target = command.targetId === command.petId ? "itself" : nameOf(state, command.targetId);
            return `${actor} — ${move?.name ?? "attack"} → ${target}`;
        }
    }
}

function stateMaxHp(state: ShowdownStateView, petId: string): number {
    return [...state.player, ...state.enemy].find((p) => p.id === petId)?.maxHp ?? 9999;
}
