import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { JutsuSpriteFx } from "./JutsuSpriteFx";
import { PetBattleAvatar } from "./PetBattleAvatar";
import { PET_GRID_COLS, PET_GRID_SIZE, PET_SPAWN_1V1 } from "../constants/pet-arena";
import type { Pet } from "../types/pet";
import type { PetArenaFrame, PetBattleRecord, PetFrameStatus } from "../types/pet-arena";
import { isPetSfxMuted, setPetSfxMuted } from "../lib/pet-sfx";
import { buildPetAnimationEvents, elementVfxKey, petPoseForAvatar } from "../lib/pet-battle-anim";
import { petBattleCamera, petCameraHoldMs } from "../lib/pet-battle-camera";
import { usePetBattleFrameSfx } from "../lib/use-pet-battle-sfx";
import { PetParticleField, vfxBurstForEvent } from "../lib/pet-vfx-particles";
import { petFxSpriteKey } from "../lib/jutsu-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { petArchetypeFor, petTacticalZone, type ArenaTile } from "../lib/pet-tactics";
import { BATTLE_STATUS_DEFS, collectActorStatuses } from "../lib/pet-moves";
import { petFramePace, tileDistance } from "../lib/pet-battle-sim";

export function PetArenaBattlefield({ playerPet, enemyPet, enemyOwner, playerReservePet, enemyReservePet, frame, recentFrames, result, obstacles, tiles, onReplay, onFightAgain, onExit, sharedImages = {}, playerRecord, enemyRecord }: { playerPet: Pet; enemyPet: Pet; enemyOwner: string; playerReservePet?: Pet; enemyReservePet?: Pet; frame?: PetArenaFrame; recentFrames?: PetArenaFrame[]; result: string; obstacles?: number[]; tiles?: ArenaTile[]; onReplay: () => void; onFightAgain: () => void; onExit: () => void; sharedImages?: Record<string, string>; playerRecord?: PetBattleRecord; enemyRecord?: PetBattleRecord }) {
    // Tactical tile-type lookup (Phases 5-6). Built once per tiles change so the
    // grid renderer can tint cover / hazard / healing / slow tiles.
    const tileTypeByIndex = useMemo(() => {
        const m = new Map<number, ArenaTile["type"]>();
        for (const t of tiles ?? []) m.set(t.row * PET_GRID_COLS + t.col, t.type);
        return m;
    }, [tiles]);
    const playerHp = frame?.playerHp ?? playerPet.hp;
    const enemyHp  = frame?.enemyHp  ?? enemyPet.hp;
    const playerPercent = Math.max(0, Math.min(100, (playerHp / Math.max(1, playerPet.hp)) * 100));
    const enemyPercent  = Math.max(0, Math.min(100, (enemyHp  / Math.max(1, enemyPet.hp))  * 100));
    const [playerShake, setPlayerShake] = useState(false);
    const [enemyShake,  setEnemyShake]  = useState(false);
    // Pre-fight 5-second countdown for the face-off overlay. Starts at 5 when an
    // isPrefight frame is current and ticks 5→4→3→2→1→"FIGHT!"; the overlay's
    // own 5s fade then dismisses it. Cosmetic only — drives no battle logic.
    const [prefightCount, setPrefightCount] = useState<number | null>(null);
    useEffect(() => {
        if (!frame?.isPrefight) { setPrefightCount(null); return; }
        setPrefightCount(5);
        const id = window.setInterval(() => {
            setPrefightCount((c) => (c === null || c <= 0 ? c : c - 1));
        }, 1000);
        return () => window.clearInterval(id);
    }, [frame?.isPrefight, frame?.message]);

    // ── Movement glide (FLIP) ───────────────────────────────────────────────
    // The simulator already relocates pets between grid tiles on "move" frames
    // (BFS pathfinding around obstacles), but the renderer mounts each avatar
    // fresh in its new tile cell — so without this the pet teleports. After
    // every frame we compare each pet's tile to its previous tile; if it moved
    // we measure the old + new cell centres and play a FLIP: snap the mover to
    // where it came from, then transition to zero so the pet visibly walks
    // across the board. The tile is lifted in z during transit so the gliding
    // pet passes OVER intervening tiles. Prefight frames just record positions
    // (no glide) so a replay doesn't slingshot from the previous fight's end.
    const petArenaGridRef = useRef<HTMLDivElement>(null);
    const moverPrevTile = useRef<Map<string, number>>(new Map());
    // Canvas particle layer (Phase A "juice") — sits over the stage and sprays
    // sparks/embers/shards on impact/KO/charge. Cosmetic-only; it never reads or
    // affects the sim, so its particle RNG can't desync a ranked replay.
    const vfxCanvasRef = useRef<HTMLCanvasElement>(null);
    const vfxFieldRef = useRef<PetParticleField | null>(null);
    useEffect(() => {
        const canvas = vfxCanvasRef.current;
        if (!canvas) return;
        let field: PetParticleField | null = null;
        try { field = new PetParticleField(canvas); } catch { return; }
        vfxFieldRef.current = field;
        const onResize = () => field?.resize();
        window.addEventListener("resize", onResize);
        return () => { window.removeEventListener("resize", onResize); field?.dispose(); vfxFieldRef.current = null; };
    }, []);
    // Elemental sprite-effect overlay (CC0 frames) played on the focal tile for
    // elemental hit/beam/status beats — layered OVER the particle burst. Purely
    // cosmetic; resolved from the active beat's vfxKey, never the pet art (pets
    // keep their existing portraits/sprites). Falls back to particles when the
    // element has no bundled sprite (poison/shadow/chakra/blood/none).
    const petSpriteFxSeq = useRef(0);
    const [petSpriteFx, setPetSpriteFx] = useState<{ id: number; frames: string[]; x: number; y: number; variant?: string } | null>(null);
    useLayoutEffect(() => {
        const grid = petArenaGridRef.current;
        if (!grid) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        grid.querySelectorAll<HTMLElement>(".pet-avatar-mover[data-petid]").forEach((mover) => {
            const petId = mover.dataset.petid;
            if (!petId) return;
            const tileEl = mover.closest<HTMLElement>(".pet-park-tile");
            const curIdx = tileEl?.dataset.tile != null ? Number(tileEl.dataset.tile) : NaN;
            if (Number.isNaN(curIdx)) return;
            const prevIdx = moverPrevTile.current.get(petId);
            moverPrevTile.current.set(petId, curIdx);
            if (reduce || frame?.isPrefight || prevIdx === undefined || prevIdx === curIdx || !tileEl) return;
            const oldTile = grid.querySelector<HTMLElement>(`.pet-park-tile[data-tile="${prevIdx}"]`);
            if (!oldTile) return;
            const o = oldTile.getBoundingClientRect();
            const n = tileEl.getBoundingClientRect();
            const dx = (o.left + o.right - n.left - n.right) / 2;
            const dy = (o.top + o.bottom - n.top - n.bottom) / 2;
            if (!dx && !dy) return;
            tileEl.style.zIndex = "8";
            mover.style.transition = "none";
            mover.style.transform = `translate(${dx}px, ${dy}px)`;
            void mover.offsetWidth; // force reflow so the start transform applies before the glide
            mover.style.transition = "transform 520ms cubic-bezier(.34, .1, .2, 1)";
            mover.style.transform = "translate(0px, 0px)";
            const done = () => { tileEl.style.zIndex = ""; mover.removeEventListener("transitionend", done); };
            mover.addEventListener("transitionend", done);
        });
    }, [frame?.message]);

    useEffect(() => {
        if (!frame?.damage) return;
        const hitPlayer = frame.actor === "enemy";
        if (hitPlayer) { setPlayerShake(true); const t = window.setTimeout(() => setPlayerShake(false), 420); return () => window.clearTimeout(t); }
        else           { setEnemyShake(true);  const t = window.setTimeout(() => setEnemyShake(false),  420); return () => window.clearTimeout(t); }
    }, [frame?.message]);

    // ── Battle sound — one synthesized SFX per frame. Extracted to a shared hook
    // (lib/use-pet-battle-sfx) so the HD-2D PetColiseum renderer reuses the exact
    // same picker. Covers every caller of this component (Pet Arena, Hollow Gate
    // beast duels, PvP). Behaviour unchanged from the old inline effect.
    const [sfxMuted, setSfxMuted] = useState(isPetSfxMuted());
    usePetBattleFrameSfx(frame, sfxMuted);

    const playerPos = frame?.playerPos ?? PET_SPAWN_1V1.player;
    const enemyPos  = frame?.enemyPos  ?? PET_SPAWN_1V1.enemy;

    const selfTile   = frame?.actor === "enemy" ? enemyPos : playerPos;
    const targetTile = frame?.actor === "enemy" ? playerPos : enemyPos;
    const effectTile =
        frame?.actionKind === "buff"      ? selfTile   :
        frame?.actionKind === "heal"      ? selfTile   :
        frame?.actionKind === "barrier"   ? selfTile   :
        frame?.actionKind === "shield"    ? selfTile   :
        frame?.actionKind === "absorb"    ? selfTile   :
        frame?.actionKind === "damage"    ? targetTile :
        frame?.actionKind === "basic"     ? targetTile :
        frame?.actionKind === "lifesteal" ? targetTile :
        frame?.actionKind === "debuff"    ? targetTile :
        frame?.actionKind === "dot"       ? targetTile :
        frame?.actionKind === "movelock"  ? targetTile :
        frame?.actionKind === "result"    ? selfTile   : -1;
    const effectLabel =
        frame?.actionKind === "buff"      ? "⬆️ Boost!"    :
        frame?.actionKind === "basic"     ? (frame.damage ? `-${frame.damage}` : "👊 Hit!") :
        frame?.actionKind === "damage"    ? (frame.crit ? `💥 ${frame.damage}!` : frame.damage ? `-${frame.damage}` : "💥 Strike!") :
        frame?.actionKind === "lifesteal" ? (frame.damage ? `-${frame.damage}` : "🩸 Drain!") :
        frame?.actionKind === "heal"      ? "💚 Heal!"    :
        frame?.actionKind === "dot"       ? "☠️ Poison!"   :
        frame?.actionKind === "move"      ? "💨 Dash!"    :
        frame?.actionKind === "barrier"   ? "🛡️ Barrier!" :
        frame?.actionKind === "shield"    ? "🛡️ Shield!"  :
        frame?.actionKind === "absorb"    ? "🌀 Absorb!"  :
        frame?.actionKind === "movelock"  ? "⛓️ Root!"    :
        frame?.actionKind === "debuff"    ? "⬇️ Weaken!"  :
        frame?.actionKind === "result"    ? result        : "";
    // User-facing floating-number / text-pop class for the per-tile label, so
    // damage / heal / shield / status numbers read in their own color near the
    // target sprite (not only in the log). Crit damage also gets the crit-text
    // class for the gold punch styling.
    const effectNumberClass =
        (frame?.actionKind === "damage" || frame?.actionKind === "basic" || frame?.actionKind === "lifesteal")
            ? (frame?.crit ? "damage-number crit-text" : "damage-number")
        : frame?.actionKind === "heal" ? "heal-number"
        : (frame?.actionKind === "shield" || frame?.actionKind === "barrier" || frame?.actionKind === "absorb") ? "shield-number"
        : (frame?.actionKind === "dot" || frame?.actionKind === "debuff" || frame?.actionKind === "movelock") ? "status-pop"
        : "";

    const winnerPet   = result === "Victory" ? playerPet : result === "Defeat" ? enemyPet : null;
    const winnerSide: "player" | "enemy" = result === "Victory" ? "player" : "enemy";
    const winnerOwner = result === "Victory" ? "You" : enemyOwner;
    // Element-typed impact VFX: tint the impact flash to the acting pet's chakra
    // nature, and surface the sim's already-applied "Super effective!" matchup
    // (read from the frame message) as a slam banner. Visual only.
    const actingElement = frame?.actor === "player" ? playerPet.element : frame?.actor === "enemy" ? enemyPet.element : undefined;
    const elName = actingElement ? String(actingElement).toLowerCase() : "";
    const elClass = elName && elName !== "none" && elName !== "neutral" ? ` pet-el-${elName}` : "";
    const superEffective = !!frame && !winnerPet && /super effective/i.test(frame.message ?? "") && (frame.actionKind === "damage" || frame.actionKind === "basic" || frame.actionKind === "lifesteal");

    // Trait flash label (also carries reactive battle-consumable flashes).
    const traitLabel =
        frame?.traitFlash?.trait === "Lucky"      ? "🍀 LUCKY DODGE!"      :
        frame?.traitFlash?.trait === "Aggressive" ? "🔥 AGGRESSIVE CRIT!"  :
        frame?.traitFlash?.trait === "Guardian"   ? "🛡️ GUARDIAN BLOCK!"  :
        frame?.traitFlash?.trait === "guardBlock" ? "🛡️ BLOCK!"           :
        frame?.traitFlash?.trait === "Battleborn" ? "⚔️ BATTLEBORN BONUS!" :
        frame?.traitFlash?.trait === "Swift"      ? "⚡ SWIFT STRIKE!"     :
        frame?.traitFlash?.trait === "petEvade"       ? "⚡ EVADED!"        :
        frame?.traitFlash?.trait === "consumDodge"    ? "💨 DODGED!"        :
        frame?.traitFlash?.trait === "consumBlock"    ? "🛡️ SMOKE SCREEN!"  :
        frame?.traitFlash?.trait === "consumReflect"  ? "🌵 THORNS!"        :
        frame?.traitFlash?.trait === "consumEndure"   ? "💪 SECOND WIND!"   :
        frame?.traitFlash?.trait === "consumLifeline" ? "✨ LIFELINE!"      :
        frame?.traitFlash?.trait === "consumCleanse"  ? "🧹 CLEANSED!"      : "";

    // Float color class — lifesteal shows a green +drain on the attacker's bar
    const playerFloatClass =
        frame?.actor === "enemy" && frame.damage && frame.actionKind !== "lifesteal"
            ? ` pet-damage-float${frame.crit ? " crit" : ""}${frame.actionKind === "dot" ? " dot" : ""}`
        : frame?.actor === "player" && frame.actionKind === "heal" ? " pet-damage-float heal"
        : frame?.actor === "player" && frame.actionKind === "lifesteal" ? " pet-damage-float lifesteal"
        : "";
    const enemyFloatClass =
        frame?.actor === "player" && frame.damage && frame.actionKind !== "lifesteal"
            ? ` pet-damage-float${frame.crit ? " crit" : ""}${frame.actionKind === "dot" ? " dot" : ""}`
        : frame?.actor === "enemy" && frame.actionKind === "heal" ? " pet-damage-float heal"
        : frame?.actor === "enemy" && frame.actionKind === "lifesteal" ? " pet-damage-float lifesteal"
        : "";

    // ── Commentator — a reactive hype caller for the dramatic beats. Empty on
    // routine frames so it only shouts when something worth shouting happens. ──
    const commentary: string = (() => {
        if (!frame || frame.isPrefight || frame.actionKind === "result") return "";
        if (frame.isKO) return "DOWN IT GOES!";
        if (frame.signatureMove) return "SIGNATURE MOVE!";
        if (/endures at 1 HP/.test(frame.message)) return "IT REFUSES TO FALL!";
        if (/Lifeline heals/.test(frame.message)) return "CLUTCH RECOVERY!";
        if (/dodges|evades/.test(frame.message)) return "NOTHING BUT AIR!";
        if (frame.crit) return "CRITICAL HIT!";
        if ((frame.combo ?? 0) >= 3) return `COMBO ×${frame.combo}!`;
        const low = Math.min(playerPercent, enemyPercent);
        if (low <= 12) return "ONE HIT FROM DEFEAT!";
        if (low <= 30) return "ON THE ROPES!";
        if (Math.abs(playerPercent - enemyPercent) <= 8 && (frame.round ?? 0) >= 3) return "NECK AND NECK!";
        return "";
    })();

    // ── Tension flags + momentum (HP tug-of-war) ──
    // In 2v2 the legacy playerHp/enemyHp track the PRIMARY fighter, which
    // stays pinned at 0 after it's KO'd — so the brink warning would stick
    // forever once one pet falls. Base the warning on LIVING fighters only:
    // a knocked-out slot (already dead) must not keep "ONE HIT LEFT" lit.
    const lowestPct = (() => {
        if (frame?.party4v4) {
            const p = frame.party4v4;
            const living = [p.playerLead, p.playerReserve, p.enemyLead, p.enemyReserve]
                .filter(s => s && !s.ko)
                .map(s => (s.hp / Math.max(1, s.maxHp)) * 100);
            return living.length ? Math.min(...living) : 100;
        }
        return Math.min(playerPercent, enemyPercent);
    })();
    const dangerZone = lowestPct <= 25 && !winnerPet;   // red vignette + heartbeat
    const oneHitWarn = lowestPct <= 12 && !winnerPet;   // "1 HIT LEFT" pulse
    const momentumPlayer = (playerPercent / Math.max(1, playerPercent + enemyPercent)) * 100;

    // ── Phase 2: animation event queue ──────────────────────────────────────
    // Combat is no longer shown by sliding one avatar into the other. Each
    // resolved frame is turned into an ordered queue of presentation events
    // (windup → lunge / rangedCast → projectile → impact → recoil; guard,
    // dodge, charge, KO, victory). A lightweight scheduler walks the queue
    // within the frame's pacing budget, and every pet sprite holds the pose of
    // whichever event is currently playing. Purely derived from the (already
    // deterministic) frame, so ranked replays animate identically and no
    // balance/RNG/clock is touched.
    const battleDist = tileDistance(playerPos, enemyPos);
    const animVfxKey = elementVfxKey(actingElement);
    const slotPetId = (slot?: string): string =>
        slot === "playerLead" ? playerPet.id
        : slot === "playerReserve" ? (playerReservePet?.id ?? "")
        : slot === "enemyLead" ? enemyPet.id
        : slot === "enemyReserve" ? (enemyReservePet?.id ?? "")
        : "";
    const animActorId = frame?.party4v4?.actorSlot
        ? slotPetId(frame.party4v4.actorSlot)
        : frame?.actor === "enemy" ? enemyPet.id : playerPet.id;
    const animTargetId = frame?.party4v4?.targetSlot
        ? slotPetId(frame.party4v4.targetSlot)
        : frame?.actor === "enemy" ? playerPet.id : enemyPet.id;
    const resolvedWinnerId = winnerPet ? (winnerSide === "player" ? playerPet.id : enemyPet.id) : null;
    const animEvents = useMemo(() => {
        if (!frame) return [];
        return buildPetAnimationEvents({
            frame: {
                actor: frame.actor,
                actionKind: frame.actionKind,
                damage: frame.damage,
                crit: frame.crit,
                isKO: frame.isKO,
                isPrefight: frame.isPrefight,
                message: frame.message,
                signatureMove: frame.signatureMove ?? null,
            },
            dist: battleDist,
            actorId: animActorId,
            targetId: animTargetId,
            vfxKey: animVfxKey,
            isResultFrame: frame.actionKind === "result" && !frame.isKO,
            winnerId: resolvedWinnerId,
            loserId: animTargetId,
        });
    }, [frame?.message]);

    const [animIdx, setAnimIdx] = useState(0);
    useEffect(() => {
        setAnimIdx(0);
        if (animEvents.length <= 1) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) { setAnimIdx(animEvents.length - 1); return; }
        const pace = petFramePace(frame);
        const total = animEvents.reduce((sum, e) => sum + e.durationMs, 0) || 1;
        // Hit-stop: freeze the timeline a beat on the heaviest blows. We RESERVE
        // budget for the holds out of the per-frame pace so the base beats just
        // compress to fit the remainder — the whole queue still finishes within
        // pace*0.9, keeping the outer frame cadence (and ranked sync) untouched.
        const hVictimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
        const holdOpts = { crit: !!frame?.crit, signature: !!frame?.signatureMove, isKO: !!frame?.isKO, heavyHit: !!frame?.damage && frame.damage >= hVictimMaxHp * 0.18 };
        const rawHolds = animEvents.map((e) => petCameraHoldMs(e.type, holdOpts));
        const rawHoldTotal = rawHolds.reduce((sum, h) => sum + h, 0);
        const holdBudget = Math.min(pace * 0.35, rawHoldTotal);
        const holdScale = rawHoldTotal > 0 ? holdBudget / rawHoldTotal : 0;
        const scale = Math.min(1, Math.max(0, pace * 0.9 - holdBudget) / total);
        const timers: number[] = [];
        let acc = 0;
        for (let i = 1; i < animEvents.length; i++) {
            acc += animEvents[i - 1].durationMs * scale + rawHolds[i - 1] * holdScale;
            timers.push(window.setTimeout(() => setAnimIdx(i), acc));
        }
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [animEvents]);
    const activeAnimEvent = animEvents[animIdx];

    // ── Camera + background (stage-level) ───────────────────────────────────
    // Screen shake is reserved for crits / heavy hits / KO (never routine
    // hits). A signature charge dims + zooms the stage while the wind-up glow
    // plays, then releases with a heavy shake on impact.
    const victimMaxHp = Math.max(1, frame?.actor === "enemy" ? playerPet.hp : enemyPet.hp);
    const heavyHit = !!frame?.damage && frame.damage >= victimMaxHp * 0.18;
    // Stage camera treatment (shake / focus+dim) for this beat — centralized in
    // the pure, tested pet-battle-camera director (which also drives hit-stop).
    const camera = petBattleCamera({
        resolved: !!winnerPet,
        isKO: !!frame?.isKO,
        crit: !!frame?.crit,
        signature: !!frame?.signatureMove,
        heavyHit,
        activeType: activeAnimEvent?.type,
        sigCharge: !!frame?.signatureMove && activeAnimEvent?.type === "charge",
    });
    const cameraClass = camera.className ? ` ${camera.className}` : "";

    // Fire a particle burst at the active beat's focal tile (target for a hit,
    // self for a charge). Positions read from the live tile DOM rect — same
    // approach the FLIP glide uses. Skipped under reduced-motion + once resolved.
    useEffect(() => {
        if (winnerPet || !activeAnimEvent) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const grid = petArenaGridRef.current;
        const canvas = vfxCanvasRef.current;
        if (!grid || !canvas) return;
        const focusTile = activeAnimEvent.type === "charge" ? selfTile : (effectTile >= 0 ? effectTile : selfTile);
        if (focusTile < 0) return;
        const tileEl = grid.querySelector<HTMLElement>(`.pet-park-tile[data-tile="${focusTile}"]`);
        if (!tileEl) return;
        const t = tileEl.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        const cx = (t.left + t.right) / 2 - c.left;
        const cy = (t.top + t.bottom) / 2 - c.top;
        // Particle burst (Phase A).
        const field = vfxFieldRef.current;
        if (field) {
            const spec = vfxBurstForEvent(activeAnimEvent, { crit: !!frame?.crit, isKO: !!frame?.isKO, signature: !!frame?.signatureMove, flagship: !!frame?.signatureMove?.flagship });
            if (spec.kind !== "none") field.burst(cx, cy, spec);
        }
        // Sprite overlay (CC0 frames), chosen by beat × ability-kind × element via
        // the shared petFxSpriteKey picker so each ability reads distinctly: basics
        // slash; elemental/DoT hits use their own sheet (blood/shadow/poison now
        // have folders); heals/buffs/shields their support sheets; and KOs +
        // signature unleashes get the cinematic kaboom/charge tier. Beats with no
        // bundled sheet fall back to the particle burst above.
        const beat = activeAnimEvent.type;
        const sigSide = frame?.signatureMove?.side;
        const actorElement = (sigSide ?? frame?.actor) === "enemy" ? enemyPet.element : playerPet.element;
        const pick = petFxSpriteKey({
            beat,
            actionKind: frame?.actionKind,
            vfxKey: activeAnimEvent.vfxKey,
            signature: !!frame?.signatureMove,
            flagship: !!frame?.signatureMove?.flagship,
            element: actorElement,
            isKO: !!frame?.isKO,
        });
        if (pick.key) {
            const frames = bundledJutsuFxFrames(pick.key);
            if (frames) setPetSpriteFx({ id: petSpriteFxSeq.current++, frames, x: cx, y: cy, variant: pick.variant });
        }
    }, [animIdx, frame?.message]);

    // Status badges near the HP bar (Phases 7-9): the BattleStatusId set via the
    // shared registry (icon + remaining rounds), plus the value/flag badges
    // (ATK/DEF buff, shield amount, absorb, brace) that fall outside that set.
    const statusBadges = (st?: PetFrameStatus) => (
        <>
            {collectActorStatuses({ ...(st ?? {}), shield: undefined }).map((s) => {
                const def = BATTLE_STATUS_DEFS[s.id];
                return (
                    <span key={s.id} className={`pet-status-badge pet-status-${def.kind}`} title={`${def.label} — ${def.description}`}>
                        {def.icon}{s.rounds > 1 ? `×${s.rounds}` : ""}
                    </span>
                );
            })}
            {st?.atkBuff   && <span className="pet-status-badge atk" title="Attack up">⚔️ATK↑</span>}
            {st?.defBuff   && <span className="pet-status-badge def" title="Defense up">🛡️DEF↑</span>}
            {st?.shield    && <span className="pet-status-badge shield" title="Shield — absorbs damage before HP">🔰{st.shield}</span>}
            {st?.absorbing && <span className="pet-status-badge absorb" title="Absorb stance">✨ABSORB</span>}
            {st?.bracing   && <span className="pet-status-badge" title="Bracing — resists knockback and crits">🧱</span>}
        </>
    );

    return (
        <section className="pet-arena-battlefield">
            {/* Pre-fight face-off overlay — sprites flank the VS badge for a
                cinematic intro instead of a bare text "Pet A VS Pet B" line.
                Sliding-in avatars + a tagline make the start of a fight feel
                like an actual event. The overlay's existing 1.4s fade keeps
                it from blocking the battle. */}
            {frame?.isPrefight && (
                <div className="pet-prefight-overlay">
                    <div className="pet-prefight-vs">
                        <div className="pet-prefight-side player">
                            <div className="pet-prefight-portrait">
                                <PetBattleAvatar pet={playerPet} side="player" active sharedImages={sharedImages} />
                            </div>
                            <div className="pet-prefight-name player">{playerPet.name}</div>
                            <div className="pet-prefight-sub">Lv {playerPet.level} · {playerPet.rarity}{playerPet.element && playerPet.element !== "None" ? ` · ${playerPet.element}` : ""}</div>
                            <div className="pet-prefight-archetype">{petArchetypeFor(playerPet)}</div>
                            <div className="pet-prefight-stats">
                                <span>❤ {playerPet.hp}</span><span>⚔ {playerPet.attack}</span><span>🛡 {playerPet.defense}</span><span>⚡ {playerPet.speed}</span>
                            </div>
                            {playerRecord && (
                                <div className="pet-prefight-record">
                                    {playerRecord.wins !== undefined && <><span className="rec-w">{playerRecord.wins}W</span> <span className="rec-l">{playerRecord.losses ?? 0}L</span></>}
                                    {playerRecord.rating !== undefined && <span className="rec-elo">{playerRecord.wins !== undefined ? " · " : ""}{playerRecord.rating} Elo</span>}
                                </div>
                            )}
                        </div>
                        <span className="pet-prefight-vs-label">VS</span>
                        <div className="pet-prefight-side enemy">
                            <div className="pet-prefight-portrait">
                                <PetBattleAvatar pet={enemyPet} side="enemy" active sharedImages={sharedImages} />
                            </div>
                            <div className="pet-prefight-name enemy">{enemyPet.name}</div>
                            <div className="pet-prefight-sub">Lv {enemyPet.level} · {enemyPet.rarity}{enemyPet.element && enemyPet.element !== "None" ? ` · ${enemyPet.element}` : ""}</div>
                            <div className="pet-prefight-archetype">{petArchetypeFor(enemyPet)}</div>
                            <div className="pet-prefight-stats">
                                <span>❤ {enemyPet.hp}</span><span>⚔ {enemyPet.attack}</span><span>🛡 {enemyPet.defense}</span><span>⚡ {enemyPet.speed}</span>
                            </div>
                            {enemyRecord && (
                                <div className="pet-prefight-record">
                                    {enemyRecord.wins !== undefined && <><span className="rec-w">{enemyRecord.wins}W</span> <span className="rec-l">{enemyRecord.losses ?? 0}L</span></>}
                                    {enemyRecord.rating !== undefined && <span className="rec-elo">{enemyRecord.wins !== undefined ? " · " : ""}{enemyRecord.rating} Elo</span>}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="pet-prefight-tagline">
                        {prefightCount !== null && prefightCount > 0
                            ? <span className="pet-prefight-count" key={prefightCount}>{prefightCount}</span>
                            : <span className="pet-prefight-go">FIGHT!</span>}
                    </div>
                </div>
            )}

            {/* Trait flash banner */}
            {frame?.traitFlash && traitLabel && (
                <div key={frame.message} className={`pet-trait-flash ${frame.traitFlash.actor}`}>{traitLabel}</div>
            )}

            {/* Combo counter */}
            {frame?.combo && frame.combo >= 3 && (
                <div key={`combo-${frame.message}`} className={`pet-combo-counter ${frame.actor}`}>COMBO ×{frame.combo}</div>
            )}

            {/* Momentum tug-of-war — who's winning at a glance (player HP share). */}
            {!frame?.isPrefight && (
                <div className="pet-momentum-bar" aria-label="Momentum">
                    <div className="pet-momentum-fill-player" style={{ width: `${momentumPlayer}%` }} />
                    <div className="pet-momentum-fill-enemy" style={{ width: `${100 - momentumPlayer}%` }} />
                    <span className="pet-momentum-label player">{playerPet.name}</span>
                    <span className="pet-momentum-label enemy">{enemyPet.name}</span>
                </div>
            )}

            {/* Commentator — hype caller for the dramatic beats. */}
            {commentary && (
                <div key={`comm-${frame?.round}-${frame?.message}`} className="pet-commentary">{commentary}</div>
            )}

            {/* "1 HIT LEFT" — flashes when a fighter is on the brink. */}
            {oneHitWarn && <div className="pet-onehit-warn">⚠ ONE HIT LEFT ⚠</div>}

            {/* HP bars with status badges. 4-pet mode (simultaneous 2v2)
                renders four compact bars (lead + reserve per side). 1v1
                mode keeps the original two big bars below. */}
            {frame?.party4v4 ? (
                <div className="pet-arena-bars" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div style={{ display: "grid", gap: "0.3rem" }}>
                        {([
                            { slot: "playerLead",    pet: playerPet,        snap: frame.party4v4.playerLead },
                            { slot: "playerReserve", pet: playerReservePet, snap: frame.party4v4.playerReserve },
                        ] as const).map(({ slot, pet, snap }) => pet && (
                            <div key={slot} className={`pet-arena-fighter-bar${snap.ko ? " pet-arena-fighter-bar-ko" : ""}`} style={snap.ko ? { opacity: 0.45 } : undefined}>
                                <strong>{pet.name}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}{snap.ko ? " 💀" : ""}</strong>
                                <div className="pet-status-badges">
                                    {snap.status.poisoned && <span className="pet-status-badge poison">☠️×{snap.status.poisoned}</span>}
                                    {snap.status.burn     && <span className="pet-status-badge poison">🔥×{snap.status.burn}</span>}
                                    {snap.status.freeze   && <span className="pet-status-badge movelock">🧊×{snap.status.freeze}</span>}
                                    {snap.status.confuse  && <span className="pet-status-badge movelock">🌀×{snap.status.confuse}</span>}
                                    {snap.status.stun     && <span className="pet-status-badge movelock">💤×{snap.status.stun}</span>}
                                    {snap.status.shield   && <span className="pet-status-badge shield">🔰{snap.status.shield}</span>}
                                    {snap.status.absorbing && <span className="pet-status-badge absorb">✨ABSORB</span>}
                                </div>
                                <span>{snap.hp}/{snap.maxHp} HP</span>
                                <div className={`pet-arena-hpbar${!winnerPet && (snap.hp / snap.maxHp * 100) <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                                    <i style={{ width: `${Math.max(0, Math.min(100, (snap.hp / snap.maxHp) * 100))}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: "grid", gap: "0.3rem" }}>
                        {([
                            { slot: "enemyLead",    pet: enemyPet,        snap: frame.party4v4.enemyLead },
                            { slot: "enemyReserve", pet: enemyReservePet, snap: frame.party4v4.enemyReserve },
                        ] as const).map(({ slot, pet, snap }) => pet && (
                            <div key={slot} className={`pet-arena-fighter-bar enemy${snap.ko ? " pet-arena-fighter-bar-ko" : ""}`} style={snap.ko ? { opacity: 0.45 } : undefined}>
                                <strong>{enemyOwner}: {pet.name}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}{snap.ko ? " 💀" : ""}</strong>
                                <div className="pet-status-badges">
                                    {snap.status.poisoned && <span className="pet-status-badge poison">☠️×{snap.status.poisoned}</span>}
                                    {snap.status.burn     && <span className="pet-status-badge poison">🔥×{snap.status.burn}</span>}
                                    {snap.status.freeze   && <span className="pet-status-badge movelock">🧊×{snap.status.freeze}</span>}
                                    {snap.status.confuse  && <span className="pet-status-badge movelock">🌀×{snap.status.confuse}</span>}
                                    {snap.status.stun     && <span className="pet-status-badge movelock">💤×{snap.status.stun}</span>}
                                    {snap.status.shield   && <span className="pet-status-badge shield">🔰{snap.status.shield}</span>}
                                    {snap.status.absorbing && <span className="pet-status-badge absorb">✨ABSORB</span>}
                                </div>
                                <span>{snap.hp}/{snap.maxHp} HP</span>
                                <div className={`pet-arena-hpbar${!winnerPet && (snap.hp / snap.maxHp * 100) <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                                    <i style={{ width: `${Math.max(0, Math.min(100, (snap.hp / snap.maxHp) * 100))}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
            <div className="pet-arena-bars">
                <div className={`pet-arena-fighter-bar${playerShake ? " pet-hp-shaking" : ""}`}>
                    <strong>{playerPet.name}</strong>
                    <div className="pet-status-badges">{statusBadges(frame?.playerStatus)}</div>
                    <span>{playerHp}/{playerPet.hp} HP</span>
                    <div className={`pet-arena-hpbar${!winnerPet && playerPercent <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                        <i style={{ width: `${playerPercent}%` }} />
                        {playerFloatClass && frame && (
                            <span key={frame.message} className={playerFloatClass}>
                                {frame.actionKind === "lifesteal" ? `🩸 +${frame.damage}` : frame.crit ? `💥 CRIT -${frame.damage}` : frame.actionKind === "dot" ? `☠️ -${frame.damage}` : frame.actionKind === "heal" ? `💚 +${frame.damage ?? "heal"}` : `-${frame.damage}`}
                            </span>
                        )}
                    </div>
                </div>

                <div className={`pet-arena-fighter-bar enemy${enemyShake ? " pet-hp-shaking" : ""}`}>
                    <strong>{enemyOwner}: {enemyPet.name}</strong>
                    <div className="pet-status-badges">{statusBadges(frame?.enemyStatus)}</div>
                    <span>{enemyHp}/{enemyPet.hp} HP</span>
                    <div className={`pet-arena-hpbar${!winnerPet && enemyPercent <= 30 ? " pet-arena-hpbar-low" : ""}`}>
                        <i style={{ width: `${enemyPercent}%` }} />
                        {enemyFloatClass && frame && (
                            <span key={frame.message} className={enemyFloatClass}>
                                {frame.actionKind === "lifesteal" ? `🩸 +${frame.damage}` : frame.crit ? `💥 CRIT -${frame.damage}` : frame.actionKind === "dot" ? `☠️ -${frame.damage}` : frame.actionKind === "heal" ? `💚 +${frame.damage ?? "heal"}` : `-${frame.damage}`}
                            </span>
                        )}
                    </div>
                </div>
            </div>
            )}

            <div className={`pet-park-stage${cameraClass}${dangerZone ? " pet-stage-danger" : ""}`}>
                {/* Particle VFX layer (Phase A) — overlays the stage; driven by
                    the animation-event queue via vfxFieldRef. Cosmetic only. */}
                <canvas ref={vfxCanvasRef} className="pet-vfx-canvas" aria-hidden="true" />
                {/* Elemental sprite effect (CC0 frames) over the struck tile, above
                    the particle canvas. Re-keyed per beat so it restarts cleanly.
                    Pets themselves are untouched — this is an effect overlay only. */}
                {petSpriteFx && (
                    <JutsuSpriteFx
                        key={petSpriteFx.id}
                        frames={petSpriteFx.frames}
                        single={false}
                        x={petSpriteFx.x}
                        y={petSpriteFx.y}
                        variant={petSpriteFx.variant}
                        onDone={() => setPetSpriteFx((s) => (s && s.id === petSpriteFx.id ? null : s))}
                    />
                )}
                {/* Mute toggle for the synthesized battle SFX. */}
                <button
                    type="button"
                    className="pet-sfx-toggle"
                    onClick={() => { const next = !sfxMuted; setSfxMuted(next); setPetSfxMuted(next); }}
                    title={sfxMuted ? "Unmute battle sounds" : "Mute battle sounds"}
                    aria-label={sfxMuted ? "Unmute battle sounds" : "Mute battle sounds"}
                >{sfxMuted ? "🔇" : "🔊"}</button>
                {/* Impact flash — a brief full-stage colour pop at the moment of
                    contact. Keyed per frame so it restarts on every blow even
                    when two hits of the same kind land back-to-back. */}
                {frame && !winnerPet && (frame.actionKind === "damage" || frame.actionKind === "basic" || frame.actionKind === "lifesteal" || frame.isKO) && (
                    <div
                        key={`flash-${frame.message}`}
                        className={`pet-impact-flash${frame.isKO ? " ko" : frame.crit ? " crit" : ""}${frame.isKO ? "" : elClass}`}
                        aria-hidden="true"
                    />
                )}
                {/* Super-effective slam — surfaces the element matchup the sim already applied. */}
                {superEffective && (
                    <div key={`se-${frame!.message}`} className="pet-super-effective" aria-hidden="true">Super Effective!</div>
                )}
                {/* Low-HP danger vignette — red pulse closes in as a fighter nears death. */}
                {dangerZone && <div className="pet-danger-vignette" aria-hidden="true" />}
                {/* Signature jutsu cut-in — anime-style portrait + move-name slam. */}
                {frame?.signatureMove && (
                    <div className={`pet-cutin ${frame.signatureMove.side}`} key={`cutin-${frame.round}-${frame.message}`}>
                        <div className="pet-cutin-portrait">
                            <PetBattleAvatar pet={frame.signatureMove.side === "player" ? playerPet : enemyPet} side={frame.signatureMove.side} active sharedImages={sharedImages} />
                        </div>
                        <div className="pet-cutin-text">
                            <span className="pet-cutin-pet">{frame.signatureMove.petName}</span>
                            <span className="pet-cutin-move">{frame.signatureMove.name}!</span>
                        </div>
                    </div>
                )}
                {/* Move-name callout — brief banner as a (non-signature) move
                    fires; the signature cut-in above announces its own name. */}
                {!winnerPet && activeAnimEvent?.type === "moveCallout" && activeAnimEvent.text && (
                    <div className="move-callout" key={`callout-${frame?.message}-${animIdx}`}>{activeAnimEvent.text}</div>
                )}
                {/* KO freeze overlay */}
                {frame?.isKO && !winnerPet && (
                    <div className="pet-ko-overlay">K.O. ??</div>
                )}

                <div ref={petArenaGridRef} className={`pet-park-grid pet-vfx-${winnerPet ? "idle" : (frame?.actionKind ?? "idle")} pet-vfx-actor-${frame?.actor ?? "system"}`} aria-label="Pet arena park battlefield">
                    {(() => {
                        // 4-pet mode: build a position→pet map covering all
                        // living party members. 1v1 mode keeps the old 2-pet
                        // layout via playerPos / enemyPos.
                        // isTarget flags the pet receiving an incoming hit
                        // so PetBattleAvatar can play the recoil/flash. For
                        // 2v2 the simulator names a slot via party4v4.targetSlot;
                        // for 1v1 the target is just the opposite side of the
                        // actor on damage-class actions.
                        const HIT_ACTIONS = new Set(["damage", "basic", "dot", "lifesteal"] as const);
                        const isHitFrame = !!frame?.actionKind && (HIT_ACTIONS as Set<string>).has(frame.actionKind);
                        type GridPet = { pet: Pet; side: "player" | "enemy"; ko: boolean; isActor: boolean; isTarget: boolean };
                        const positionMap = new Map<number, GridPet>();
                        if (frame?.party4v4) {
                            const p4 = frame.party4v4;
                            // Place ALL fielded party pets — including KO'd ones,
                            // which stay on the grid toppled/greyed (see `faint`
                            // below) instead of vanishing. This is what 1v1
                            // already does for the loser, and it means a 2v2
                            // always shows both pets per side, not just the
                            // survivor. Each entry carries its OWN ko flag so a
                            // downed ally never drags its still-standing partner
                            // into the faint pose.
                            const partySlots = [
                                { pet: playerPet,        side: "player" as const, slot: "playerLead"    as const, snap: p4.playerLead },
                                { pet: playerReservePet, side: "player" as const, slot: "playerReserve" as const, snap: p4.playerReserve },
                                { pet: enemyPet,         side: "enemy"  as const, slot: "enemyLead"     as const, snap: p4.enemyLead },
                                { pet: enemyReservePet,  side: "enemy"  as const, slot: "enemyReserve"  as const, snap: p4.enemyReserve },
                            ];
                            // Two passes: add KO'd pets first, living pets second,
                            // so a living pet that has stepped onto a freed square
                            // wins the cell instead of being hidden under a corpse.
                            for (const koPass of [true, false]) {
                                for (const s of partySlots) {
                                    if (!s.pet || s.snap.ko !== koPass) continue;
                                    positionMap.set(s.snap.pos, { pet: s.pet, side: s.side, ko: s.snap.ko, isActor: p4.actorSlot === s.slot, isTarget: isHitFrame && p4.targetSlot === s.slot });
                                }
                            }
                        } else {
                            positionMap.set(playerPos, { pet: playerPet, side: "player", ko: false, isActor: frame?.actor === "player", isTarget: isHitFrame && frame?.actor === "enemy" });
                            positionMap.set(enemyPos,  { pet: enemyPet,  side: "enemy",  ko: false, isActor: frame?.actor === "enemy",  isTarget: isHitFrame && frame?.actor === "player" });
                        }
                        return Array.from({ length: PET_GRID_SIZE }, (_, index) => {
                            const here = positionMap.get(index);
                            // Tactical tile type (Phases 5-6). Blocked + cover are both
                            // impassable obstacles (pets path around them); cover renders
                            // as a lower wall. Hazard / healing / slow are passable but
                            // tinted. Falls back to the legacy obstacles list (all blocked).
                            const tileType = tileTypeByIndex.get(index);
                            const isCover     = tileType === "cover";
                            const isObstacle  = isCover || tileType === "blocked" || (tileTypeByIndex.size === 0 && (obstacles ?? []).includes(index));
                            const tileFxClass = tileType === "hazard" ? " pet-tile-hazard" : tileType === "healing" ? " pet-tile-healing" : tileType === "slow" ? " pet-tile-slow" : "";
                            // Tactical zone (Phase 10-14) — a faint highlight on the
                            // contested centre columns focuses the eye on where pets
                            // actually fight, without using the whole oversized grid.
                            const zoneClass = !isObstacle && petTacticalZone(index % PET_GRID_COLS, tileType) === "frontline" ? " pet-zone-frontline" : "";
                            // Target-tile highlight during an offensive beat.
                            const isTargetTile = !winnerPet && index === targetTile && (frame?.actionKind === "damage" || frame?.actionKind === "basic" || frame?.actionKind === "lifesteal" || frame?.actionKind === "dot" || frame?.actionKind === "debuff" || frame?.actionKind === "movelock");
                            const isTrail     = index >= 42 && index <= 55; // row 3 of 14-col, 7-row grid (centre lane)
                            // Once a winner is decided, stop firing per-tile glows and
                            // the centre-tile vfx burst. Otherwise the result frame's
                            // tile pulse + victory ring + sparks fire UNDER the winner
                            // card, which reads as a broken end-of-fight flicker.
                            const isActionTile = !winnerPet && frame?.actionKind && !!here;
                            const hasEffect   = !winnerPet && index === effectTile && frame?.actionKind;
                            // Pseudo-3D depth + loser faint ride a wrapper BETWEEN the
                            // glide-mover and the avatar, so neither collides with the
                            // FLIP translate (mover) nor the lunge/walk (avatar). Depth:
                            // scale/brighten by grid row so up-field reads as farther
                            // (row 3 = centre lane = neutral 1.0). Faint: the pet that
                            // just hit 0 HP topples, sinks, and desaturates in place.
                            const depthRow = Math.floor(index / PET_GRID_COLS);
                            const depthScale = 1 + (depthRow - 3) * 0.04;
                            // In 2v2 the side-wide playerHp/enemyHp track only the
                            // lead pet, so they can't decide faint per pet — a downed
                            // lead would otherwise topple its living reserve too
                            // (the "2nd pet glitches after a KO" bug). Use the slot's
                            // own KO flag in party mode; in 1v1 there's a single pet
                            // per side, so the side HP is the right signal.
                            const faint = !!here && (frame?.party4v4 ? here.ko : (here.side === "player" ? (frame?.playerHp ?? 1) <= 0 : (frame?.enemyHp ?? 1) <= 0));
                            const depthStyle: React.CSSProperties = {
                                transform: faint
                                    ? `scale(${depthScale}) translateY(15px) rotate(${here!.side === "player" ? -68 : 68}deg)`
                                    : `scale(${depthScale})`,
                                filter: faint ? "grayscale(0.85) brightness(0.5)" : `brightness(${(1 + (depthRow - 3) * 0.03).toFixed(3)})`,
                                opacity: faint ? 0.62 : 1,
                            };
                            return (
                                <div
                                    key={index}
                                    data-tile={index}
                                    className={`pet-park-tile${isObstacle ? " pet-obstacle" : ""}${isCover ? " pet-tile-cover" : ""}${tileFxClass}${zoneClass}${isTargetTile && !isObstacle ? " pet-target-tile" : ""}${isTrail && !isObstacle ? " pet-path" : ""}${isActionTile && !isObstacle ? " pet-action-tile" : ""}${hasEffect && !isObstacle ? ` pet-vfx-tile pet-vfx-tile-${frame?.actionKind}` : ""}${here && !isObstacle ? " pet-occupied" : ""}`}
                                >
                                    {isObstacle && (
                                        <div className={`pet-obstacle-block${isCover ? " pet-obstacle-cover" : ""}`}>
                                            <div className="pet-obstacle-top" />
                                            <div className="pet-obstacle-face" />
                                            <div className="pet-obstacle-side" />
                                        </div>
                                    )}
                                    {hasEffect && (
                                        <span className={`pet-battle-vfx${frame?.crit ? " crit" : ""}${frame?.isKO ? " ko" : ""}${frame?.isKO ? "" : elClass}`} key={`${frame?.message}-${index}`}>
                                            <i />
                                            <b className={effectNumberClass}>{effectLabel}</b>
                                            <em />
                                        </span>
                                    )}
                                    {/* Grounding — an impact ring expands on the floor at the
                                        moment of contact (Phase A increment 2). Fires on the
                                        impact beat at the struck tile; element-tinted, brighter
                                        on a crit. Sits on the ground plane (tile-local). */}
                                    {!winnerPet && activeAnimEvent?.type === "impact" && index === effectTile && !isObstacle && (
                                        <span className={`pet-impact-ring${frame?.crit ? " crit" : ""}${elClass}`} key={`ring-${frame?.message}-${animIdx}`} aria-hidden="true" />
                                    )}
                                    {/* Per-frame key forces a fresh mount each tick so the
                                        CSS lunge / hit animations restart cleanly on every
                                        successive blow — without this, two back-to-back
                                        damage frames against the same target would only
                                        animate once (CSS quirk: animation-name doesn't
                                        restart when the same class persists). */}
                                    {here && (
                                        <div className="pet-avatar-mover" data-petid={here.pet.id}>
                                            <div className={`pet-avatar-depth${faint ? " pet-fainted" : ""}`} style={depthStyle}>
                                                <PetBattleAvatar key={`${here.pet.id}-${frame?.message ?? "idle"}`} pet={here.pet} side={here.side} active={here.isActor} hit={here.isTarget && !faint} status={here.side === "player" ? frame?.playerStatus : frame?.enemyStatus} sharedImages={sharedImages} visualState={petPoseForAvatar(activeAnimEvent, here.pet.id, !!winnerPet && here.side === winnerSide, faint)} />
                                            </div>
                                        </div>
                                    )}
                                    {/* Ranged projectile — fired from the acting pet's tile
                                        toward its target across `--pdist` tile-widths. Keyed
                                        per event so it restarts; player fires right (+1),
                                        enemy fires left (−1). Element drives the VFX look. */}
                                    {here && !winnerPet && activeAnimEvent && (activeAnimEvent.type === "projectile" || activeAnimEvent.type === "beam") && activeAnimEvent.actorId === here.pet.id && (
                                        <span
                                            key={`proj-${frame?.message ?? ""}-${animIdx}`}
                                            className={`pet-projectile pet-proj-${activeAnimEvent.type} ${
                                                activeAnimEvent.vfxKey === "fire"      ? "vfx-fire-projectile" :
                                                activeAnimEvent.vfxKey === "shadow"    ? "vfx-shadow-slash" :
                                                activeAnimEvent.vfxKey === "lightning" ? "vfx-lightning-bolt" :
                                                activeAnimEvent.vfxKey === "poison"    ? "vfx-poison-cloud" :
                                                `pet-pvfx-${activeAnimEvent.vfxKey ?? "none"}`
                                            }`}
                                            style={{ ["--face" as string]: here.side === "player" ? 1 : -1, ["--pdist" as string]: Math.max(1, Math.min(11, battleDist)) }}
                                            aria-hidden="true"
                                        />
                                    )}
                                    {/* Localized VFX layer — impact flash + dust on the target,
                                        shield aura / heal glow on the actor, status pop on the
                                        afflicted pet, DODGE text on the dodger. Event-driven, so
                                        each beat fires at its moment in the timeline. */}
                                    {here && !winnerPet && activeAnimEvent && (() => {
                                        const ae = activeAnimEvent;
                                        const evtActor = ae.actorId === here.pet.id;
                                        const evtTarget = ae.targetId === here.pet.id;
                                        const k = `${frame?.message ?? ""}-${animIdx}`;
                                        return (
                                            <>
                                                {ae.type === "impact" && evtTarget && <span key={`imp-${k}`} className="vfx-impact-flash" aria-hidden="true" />}
                                                {ae.type === "impact" && evtTarget && <span key={`dust-${k}`} className="vfx-dust-burst" aria-hidden="true" />}
                                                {ae.type === "guard" && evtActor && <span key={`shld-${k}`} className="vfx-shield-aura" aria-hidden="true" />}
                                                {ae.type === "charge" && evtActor && ae.vfxKey === "chakra" && <span key={`heal-${k}`} className="vfx-heal-glow" aria-hidden="true" />}
                                                {ae.type === "statusApply" && evtTarget && <span key={`stat-${k}`} className="vfx-status-pop" aria-hidden="true" />}
                                                {ae.type === "dodge" && evtActor && <span key={`dodge-${k}`} className="dodge-text">DODGE</span>}
                                            </>
                                        );
                                    })()}
                                </div>
                            );
                        });
                    })()}
                </div>

                {winnerPet && (
                    <div className={`pet-victory-screen ${winnerSide}`}>
                        {/* Removed the rotating <pet-victory-burst /> sparkle ring —
                            its 1.8s infinite spin read as a broken-looking flicker
                            against the static winner card. The card now sits calm. */}
                        <PetBattleAvatar pet={winnerPet} side={winnerSide} active sharedImages={sharedImages} visualState="victory" />
                        <div>
                            <span>Arena Winner</span>
                            <strong>{winnerPet.name}</strong>
                            <p>{winnerOwner} wins the match.</p>
                        </div>
                        <div className="pet-victory-actions">
                            <button type="button" onClick={onFightAgain}>Fight Again</button>
                            <button type="button" className="danger-button" onClick={onExit}>Exit</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Round event ticker — last 3 non-system events */}
            {recentFrames && recentFrames.length > 0 && (
                <div className="pet-event-ticker">
                    {[...recentFrames].reverse().map((f, i) => (
                        <span key={`${f.message}-${i}`} className={`pet-event-chip ${f.actor} ${f.actionKind ?? ""} ${i === 0 ? "latest" : ""}`}>
                            {f.actionKind === "dot" ? "☠" : f.actionKind === "buff" ? "⬆" : f.actionKind === "heal" ? "✚" : f.actionKind === "move" ? "➡" : f.actionKind === "debuff" ? "⬇" : f.actionKind === "lifesteal" ? "🧛" : f.actionKind === "shield" ? "🛡" : f.actionKind === "absorb" ? "🌀" : f.actionKind === "barrier" ? "◇" : f.actionKind === "movelock" ? "⛓" : f.crit ? "💥" : "⚔"}
                            {" "}{f.message.replace(/^Round \d+: /, "").slice(0, 42)}
                        </span>
                    ))}
                </div>
            )}

            <div className={`pet-arena-current-action ${frame?.actor ?? "system"}`}>
                <span>{frame?.round ? `Round ${frame.round}` : "Ready"}</span>
                <strong>{frame?.message ?? "Pick two pets and start the match."}</strong>
                {result && frame?.actionKind === "result" && <button onClick={onReplay}>Replay</button>}
            </div>
        </section>
    );
}
