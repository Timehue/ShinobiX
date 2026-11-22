import { useLayoutEffect, useRef } from "react";
import { SectorModelFigure, type SectorModelHandle } from "../../components/SectorModelFigure";
import { useWorldModelArtBase } from "../../lib/sector-obstacles";
import { isPlayerModel, starterModel } from "../../lib/player-model";
import type { Character } from "../../types/character";
import { restoreLandscapePose, roomModelDetail } from "./room-model-detail";
import { centre } from "./coast-grid";

// Sector models are authored for a 1080-unit landscape. A room shows a much shorter span of ground.
export const COURTYARD_MODEL_SCALE = 1.34;
export const ROOM_MODEL_SCALE = 3.25;
export function useCoastFigure<T extends HTMLElement>(scale: number) {
    const anchor = useRef<T>(null), figure = useRef<SectorModelHandle>(null);
    const base = useWorldModelArtBase();
    useLayoutEffect(() => {
        const floor = anchor.current?.parentElement;
        if (!base || !floor) return;
        const resize = () => figure.current?.snap(0, 0, floor.clientWidth * scale);
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(floor);
        return () => observer.disconnect();
    }, [base, scale]);
    return { anchor, figure, base };
}
export function SettlementPlayer({ character, avatar, tile, scale }: { character: Character; avatar?: string | null; tile: number; scale: number }) {
    const { anchor, figure, base } = useCoastFigure<HTMLSpanElement>(scale);
    const kind = starterModel(avatar ?? "", character.starterWorldModel);
    const fallback = "/coast-map/residents/" + kind + ".webp";
    const equipped = isPlayerModel(character.playerModel) ? character.playerModel : undefined;
    const detail = !equipped && scale === ROOM_MODEL_SCALE ? roomModelDetail(kind) : undefined;
    return <span ref={anchor} className="stairs-player" style={centre(tile)} aria-hidden="true">
        <img className="sector-avatar-sprite" src={detail?.src ?? fallback} alt=""
            onError={event => restoreLandscapePose(event.currentTarget, detail, fallback)} />
        {base && <SectorModelFigure ref={figure} kind={kind} equipped={equipped} artBase={base} frontIdleDetail={detail} self />}
    </span>;
}

