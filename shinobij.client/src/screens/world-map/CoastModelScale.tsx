import { useLayoutEffect, useRef } from "react";
import { SectorModelFigure, type SectorModelHandle } from "../../components/SectorModelFigure";
import { useWorldModelArtBase } from "../../lib/sector-obstacles";
import { isPlayerModel, starterModel } from "../../lib/player-model";
import type { Character } from "../../types/character";
import { restoreLandscapePose, roomModelDetail } from "./room-model-detail";
import { lifeActorPosition, type LifeMotion } from '../../../../shared/sector-life-motion';
import { playerGaitTilesPerSecond } from "../../../../shared/sector-gait-rates";
import { serverClockOffsetMs } from '../../lib/server-clock';
import { useSprintStyle } from "../../lib/player-model";
import { centre, col, row } from "./coast-grid";

// Sector models are authored for a 1080-unit landscape. A room shows a much shorter span of ground.
export const COURTYARD_MODEL_SCALE = 1.34;
export const ROOM_MODEL_SCALE = 3.25;
export function useCoastFigure<T extends HTMLElement>(scale: number, tile: number, motion?: LifeMotion, gait: 'walk' | 'run' = 'walk') {
    const anchor = useRef<T>(null), figure = useRef<SectorModelHandle>(null);
    const base = useWorldModelArtBase();
    const last = useRef<{ x: number; y: number } | null>(null);
    useLayoutEffect(() => {
        const floor = anchor.current?.parentElement;
        const element = anchor.current;
        if (!element || !floor) return;
        const street = scale === COURTYARD_MODEL_SCALE;
        let width = floor.clientWidth, frame = 0;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const start = performance.now();
        const from = last.current ?? { x: col(tile), y: row(tile) };
        const distance = Math.hypot(col(tile) - from.x, row(tile) - from.y);
        const duration = distance / playerGaitTilesPerSecond[gait];
        const draw = (now: number) => {
            const seconds = (now - start) / 1000;
            let x = col(tile), y = row(tile), moving = false;
            if (motion) {
                const pose = lifeActorPosition(0, { restTile: tile, motion }, Date.now() + serverClockOffsetMs());
                x = pose.col; y = pose.row; moving = pose.walking;
            } else if (seconds < duration && distance <= 1.5 && !reduced.matches) {
                x = from.x + (x - from.x) * seconds / duration;
                y = from.y + (y - from.y) * seconds / duration;
                moving = true;
            }
            if (moving || motion || distance) {
                element.style.left = (x + .5) / 12 * 100 + '%';
                element.style.top = (y + .5) / 12 * 100 + '%';
            }
            last.current = { x, y };
            if (street) {
                const depth = (y + .5) / 12;
                element.style.zIndex = String(Math.round(depth * 100));
                element.style.scale = String(.84 + depth * .3);
            }
            figure.current?.place(x * width / 12, y * width / 12, width * scale, moving && !reduced.matches, gait, true);
            if (motion || moving || figure.current?.stop()) frame = requestAnimationFrame(draw);
        };
        draw(start);
        const observer = new ResizeObserver(() => {
            width = floor.clientWidth;
            cancelAnimationFrame(frame);
            draw(performance.now());
        });
        observer.observe(floor);
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [base, scale, tile, motion, gait]);
    return { anchor, figure, base };
}
export function SettlementPlayer({ character, avatar, tile, scale, gait }: { character: Character; avatar?: string | null; tile: number; scale: number; gait: 'walk' | 'run' }) {
    const { anchor, figure, base } = useCoastFigure<HTMLSpanElement>(scale, tile, undefined, gait);
    const style = useSprintStyle();
    const kind = starterModel(avatar ?? "", character.starterWorldModel);
    const fallback = "/coast-map/residents/" + kind + ".webp";
    const equipped = isPlayerModel(character.playerModel) ? character.playerModel : undefined;
    const detail = !equipped && scale === ROOM_MODEL_SCALE ? roomModelDetail(kind) : undefined;
    return <span ref={anchor} className="stairs-player" style={centre(tile)} aria-hidden="true">
        <img className="sector-avatar-sprite" src={detail?.src ?? fallback} alt=""
            onError={event => restoreLandscapePose(event.currentTarget, detail, fallback)} />
        {base && <SectorModelFigure ref={figure} kind={kind} style={style} equipped={equipped} artBase={base} frontIdleDetail={detail} self />}
    </span>;
}

