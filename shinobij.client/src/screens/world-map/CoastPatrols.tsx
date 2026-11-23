import { useState } from "react";
import { SectorModelFigure } from "../../components/SectorModelFigure";
import { restoreLandscapePose, roomModelDetail } from "./room-model-detail";
import { ROOM_MODEL_SCALE, useCoastFigure } from "./CoastModelScale";
import { requestAiFight } from "../../lib/ai-fight-request";
import bandit from "../../assets/wanderers/bandit-3.webp";
import fox from "../../assets/coliseum/demo-emberfox.webp";
import shade from "../../assets/wanderers/riftspawn.webp";
import { centre } from "./coast-grid";
import { useCoastRead, type Patrol, type Patrols } from "./coast-service";

const portraits: Record<string, string> = { "ambush-bandit-3": bandit, "ember-fox": fox, riftspawn: shade,
    "hollow-hound": "/hollow-gate/hollow-hound-idle.webp", "underground-patrol": "/underground/wanderer-patrol-v1.webp",
    "underground-bandit": "/underground/wanderer-bandit-v1.webp", "underground-night-ninja": "/underground/wanderer-night-ninja-v1.webp" };

/**
 * One figure on the board, drawn with a world model: a patrol to challenge, or
 * a keeper or boss the player's quests put there (`coast.figures` in the quest
 * list, api/quests/_coast-presence.ts). What choosing it does is the caller's.
 */
export function CoastFigure({ tile, feet, seatedArt, scale = 1, model, label, disabled, pick, image = portraits[model] }: { tile: number; feet?: [number, number]; seatedArt?: string; scale?: number; model: string; label: string; disabled: boolean; pick: () => void; image?: string }) {
    const { anchor: button, figure, base } = useCoastFigure<HTMLButtonElement>(scale);
    const detail = !seatedArt && feet && scale === ROOM_MODEL_SCALE ? roomModelDetail(model) : undefined;
    return <button type="button" ref={button} className={"coast-site coast-patrol" + (feet ? " stairs-person" : "") + (seatedArt ? " stairs-seated" : "")} style={feet ? { left: feet[0] + "%", top: feet[1] + "%" } : centre(tile)} disabled={disabled}
        title={label} aria-label={label} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); pick(); }}>
        {(seatedArt || image) && <img className="sector-avatar-sprite" src={seatedArt ?? detail?.src ?? image} alt=""
            onError={event => restoreLandscapePose(event.currentTarget, detail, image)} />}
        {base && !seatedArt && <SectorModelFigure ref={figure} kind={model} artBase={base} frontIdleDetail={detail} />}
    </button>;
}
function PatrolFigure({ patrol, sector, disabled, notify }: { patrol: Patrol; sector: number; disabled: boolean; notify: (s: string) => void }) {
    return <CoastFigure tile={patrol.tile} model={patrol.model} label={"Challenge " + patrol.name + " · Level " + patrol.level} disabled={disabled} pick={() => {
        if (!requestAiFight({ opponentId: patrol.id, opponentLevel: patrol.level, opponentName: patrol.name,
            enemyAvatar: portraits[patrol.model], battleKind: "world", returnScreen: "worldMap", sector,
            worldEncounter: { kind: "coast-patrol", sourceId: patrol.id, sector } })) notify("The fight could not start. Try again.");
    }} />;
}
export function CoastPatrols({ sector, disabled, notify }: { sector: number; disabled: boolean; notify: (s: string) => void }) {
    const [attempt, retry] = useState(0);
    const { data, error } = useCoastRead<Patrols>("patrols", attempt);
    if (error || (data && data.sector !== sector)) return <button type="button" className="coast-patrol-retry" onClick={event => {
        event.stopPropagation(); retry(value => value + 1);
    }}>{error || "Patrols are still checking this sector."} Retry</button>;
    return data?.patrols.filter(p => !p.beaten).map(p => <PatrolFigure key={p.id} patrol={p} sector={sector} disabled={disabled} notify={notify} />);
}

