import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { worldBossDefinition } from "../../../shared/world-boss-event";
import { isWalkableTile } from "../../../shared/sector-walk-mask";
import { useSectorObstacles } from "../lib/sector-obstacles";
import { worldBossServerNow } from "../lib/world-boss-event-api";
import { worldBossPatrol, worldBossPatrolElapsed, type WorldBossPatrolClock, type WorldBossPatrolPose } from "../lib/world-boss-patrol";
import "../styles/world-boss-map.css";

export type WorldSectorWorldBossMarker = Readonly<{
    bossId: string;
    name: string;
    /** A team is forming, so the boss holds this sector. */
    paused: boolean;
    /** The sector it walked in from (null on its spawn hop) and the one it
     *  leaves for next (its own once it reaches the village gate). */
    fromSector: number | null;
    toSector: number | null;
    /** The last event read: when the server answered and how long this hop has left. */
    readAt: number;
    nextHopInMs: number;
    onOpen: () => void;
}>;

const GRID = 12;
/** A read that finds this player's boss further than this from everyone
 *  else's puts it back in step; a poll's own jitter stays well under it. */
const RESYNC_MS = 1_000;
const tileOf = (pose: WorldBossPatrolPose) => Math.round(pose.row) * GRID + Math.round(pose.col);
// The track is one tile in size, so a percentage translate moves it in tiles.
const at = (col: number, row: number) => `translate(${col * 100}%, ${row * 100}%)`;

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The roaming world boss in its current sector. It is the way in to the
 * event's team queue: WorldMap mounts it only while the player stands in the
 * boss's sector and owns the queue dialog it opens. It patrols the road toward
 * the village it attacks (lib/world-boss-patrol) on its hop's clock, so while
 * it walks every player sees it in the same place. A forming team stops it
 * where this player sees it, up to one map poll after the team began to form,
 * and the first read after it walks on puts it back in step. Under Reduce
 * Motion it stands on its usual clear tile.
 */
export function SectorWorldBossStandee({ sector, bossId, name, paused, fromSector, toSector, readAt, nextHopInMs, onOpen }: WorldSectorWorldBossMarker & { sector: number }) {
    const boss = worldBossDefinition(bossId);
    const nativeFacing = boss.mapSpriteFacing === "right" ? 1 : -1;
    const obstacles = useSectorObstacles();
    const patrol = useMemo(
        () => worldBossPatrol(sector, fromSector, toSector, tile => isWalkableTile(sector, tile, obstacles)),
        [sector, fromSector, toSector, obstacles],
    );
    const track = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const figure = useRef<HTMLSpanElement>(null);
    const animation = useRef<Animation | null>(null);
    const resync = useRef<(() => void) | null>(null);
    const clock = useRef<WorldBossPatrolClock>({ serverNow: readAt, nextHopInMs, paused });

    // Layout effect: the walk starts on the frame it mounts, not a frame after
    // the boss has been painted on its rest tile.
    useLayoutEffect(() => {
        const node = track.current;
        let shown = "";
        const show = (pose: WorldBossPatrolPose) => {
            const footprint = patrol.footprint(tileOf(pose)).join(" ");
            const key = `${pose.facing}|${pose.walking}|${footprint}`;
            if (key === shown) return;
            shown = key;
            if (figure.current) figure.current.style.transform = pose.facing === nativeFacing ? "" : "scaleX(-1)";
            button.current?.classList.toggle("is-walking", pose.walking);
            if (button.current) button.current.dataset.footprint = footprint;
        };
        const rest = { col: patrol.restTile % GRID, row: Math.floor(patrol.restTile / GRID), walking: false, facing: patrol.restFacing } as const;
        if (!node || patrol.cycleMs <= 0 || typeof node.animate !== "function" || prefersReducedMotion()) {
            show(rest);
            return;
        }
        const walk = node.animate(
            patrol.frames.map(frame => ({ transform: at(frame.col, frame.row), offset: frame.offset })),
            { duration: patrol.cycleMs, iterations: Infinity },
        );
        walk.currentTime = worldBossPatrolElapsed(clock.current, worldBossServerNow()) % patrol.cycleMs;
        if (clock.current.paused) walk.pause();
        animation.current = walk;
        let timer = 0;
        const update = () => {
            window.clearTimeout(timer);
            const ms = Number(walk.currentTime) || 0;
            const moving = walk.playState === "running";
            const pose = patrol.poseAt(ms);
            show({ ...pose, walking: pose.walking && moving });
            // Wake for the next start, stop or turn, and at least every quarter
            // second so the tap footprint follows the figure.
            if (moving) timer = window.setTimeout(update, Math.min(250, patrol.untilChange(ms) + 16));
        };
        resync.current = update;
        update();
        return () => {
            window.clearTimeout(timer);
            walk.cancel();
            animation.current = null;
            resync.current = null;
        };
    }, [patrol, nativeFacing]);

    // Each event read. A forming team holds the boss where it stands; once it
    // walks again, a read that finds it out of step with the hop's clock puts
    // it back where every other player sees it.
    useEffect(() => {
        clock.current = { serverNow: readAt, nextHopInMs, paused };
        const walk = animation.current;
        if (!walk) return;
        if (paused) {
            walk.pause();
        } else {
            walk.play();
            const target = worldBossPatrolElapsed(clock.current, worldBossServerNow()) % patrol.cycleMs;
            const apart = Math.abs((Number(walk.currentTime) || 0) - target) % patrol.cycleMs;
            if (Math.min(apart, patrol.cycleMs - apart) > RESYNC_MS) walk.currentTime = target;
        }
        resync.current?.();
    }, [readAt, nextHopInMs, paused, patrol]);

    const restCol = patrol.restTile % GRID, restRow = Math.floor(patrol.restTile / GRID);
    const label = `${name}, world boss. ${paused ? "A team is forming. Open the team queue" : "Open the team queue"}`;
    return (
        <div ref={track} className="sector-world-boss-track" style={{ transform: at(restCol, restRow) }}>
            <button ref={button} type="button" className="sector-world-boss" data-footprint={patrol.footprint(patrol.restTile).join(" ")}
                onClick={onOpen} title={label} aria-label={label}>
                <span ref={figure} className="sector-world-boss-figure">
                    <span className={`sector-world-boss-sprite${boss.mapGlow === "white-red" ? " is-white-red-glow" : ""}`}
                        style={{ backgroundImage: `url("${boss.mapSprite}")` }} />
                </span>
                <span className="sector-world-boss-name">{name}<small>{paused ? "Team forming" : "Join the raid"}</small></span>
            </button>
        </div>
    );
}
