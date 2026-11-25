import { Modal } from "../../components/ui/Modal";
import { coastRegionOf } from "../../../../shared/world-maps";
import { useMemo, useState } from "react";
import { WorldStandingFigure } from "../../components/WorldStandingFigure";
import { SectorModelFigure } from "../../components/SectorModelFigure";
import { restoreLandscapePose, roomModelDetail } from "./room-model-detail";
import { ROOM_MODEL_SCALE, useCoastFigure } from "./CoastModelScale";
import { requestAiFight } from "../../lib/ai-fight-request";
import { NpcQuestMarker } from "../../components/NpcQuestMarker";
import type { NpcMarker } from "../../lib/npc-quest-marker";
import bandit from "../../assets/wanderers/bandit-3.webp";
import fox from "../../assets/coliseum/demo-emberfox.webp";
import shade from "../../assets/wanderers/riftspawn.webp";
import { centre, coastRoutine } from "./coast-grid";
import { useCoastRead, type Patrol, type Patrols } from "./coast-service";

const portraits: Record<string, string> = { "ambush-bandit-3": bandit, "ember-fox": fox, riftspawn: shade,
    "hollow-hound": "/hollow-gate/hollow-hound-idle.webp", "underground-patrol": "/underground/wanderer-patrol-v1.webp",
    "underground-bandit": "/underground/wanderer-bandit-v1.webp", "underground-night-ninja": "/underground/wanderer-night-ninja-v1.webp" };

/**
 * One figure on the board, drawn with a world model: a patrol to challenge, or
 * a keeper or boss the player's quests put there (`coast.figures` in the quest
 * list, api/quests/_coast-presence.ts). What choosing it does is the caller's.
 */
export function CoastFigure({ tile, feet, seatedArt, mask, patrol = false, scale = 1, model, label, disabled, pick, image, speakingTile, marker, prop }: { prop?: { kind: string; done: boolean }; marker?: NpcMarker; tile: number; mask?: readonly string[]; patrol?: boolean; feet?: [number, number]; seatedArt?: string; scale?: number; model: string; label: string; disabled: boolean; pick: () => void; image?: string; speakingTile?: number }) {
    const motion = useMemo(() => mask && !seatedArt ? coastRoutine(mask, tile, patrol, speakingTile) : undefined, [mask, tile, patrol, seatedArt, speakingTile]);
    const { anchor: button, figure, base } = useCoastFigure<HTMLButtonElement>(scale, tile, motion);
    const detail = !seatedArt && feet && scale === ROOM_MODEL_SCALE ? roomModelDetail(model) : undefined;
    return <button type="button" ref={button} className={"coast-site coast-patrol" + (feet ? " stairs-person" : "") + (seatedArt ? " stairs-seated" : "")} style={feet ? { left: feet[0] + "%", top: feet[1] + "%" } : centre(tile)} disabled={disabled}
        aria-label={label} title={label} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); pick(); }}>
        {feet && (seatedArt || image) ? <img className="sector-avatar-sprite" src={seatedArt ?? detail?.src ?? image} alt=""
            onError={event => restoreLandscapePose(event.currentTarget, detail, image)} /> : <WorldStandingFigure kind={model} className="sector-avatar-sprite" />}
        {base && <SectorModelFigure ref={figure} kind={model} artBase={base} frontIdleDetail={detail} />}
        {prop && <span aria-hidden="true" className={"coast-work-prop prop-" + prop.kind + (prop.done ? " is-finished" : "")} />}
        {marker && <NpcQuestMarker marker={marker} />}
    </button>;
}
function PatrolFigure({ patrol, sector, mask, disabled, notify }: { mask: readonly string[]; patrol: Patrol; sector: number; disabled: boolean; notify: (s: string) => void }) {
    const [inspection, setInspection] = useState<"look" | "observed" | null>(null);
    const region = coastRegionOf(sector) - 1;
    const clue = (patrol.beast ? [
        "Salt-stiff pawprints lead inland from Needle Shoal (104).",
        "Wet prints follow the brackish pools near Sounding Ledge (117).",
        "Grit has settled in the older tracks at Antlerwash Ford (121).",
        "Look for tiny scales beside the open water at Tilted Tarn (135).",
        "A narrow runnel feeds the root pool in sector 145.",
    ] : [
        "The trail connects the fishing ground in 104 to the seam in 103.",
        "A lead line hangs at Sounding Ledge in 117. Skiffs use the quay in 116.",
        "Binding fibre grows in the thorn brake in 125.",
        "A courier sights along the dispatch cairn in 140.",
        "The field workshop in 144 keeps samples from the silver outcrop in 143.",
    ])[region];
    function challenge() {
        setInspection(null);
        const started = requestAiFight({
            opponentId: patrol.id, opponentLevel: patrol.level, opponentName: patrol.name,
            enemyAvatar: portraits[patrol.model], battleKind: "world", returnScreen: "worldMap", sector,
            worldEncounter: { kind: "coast-patrol", sourceId: patrol.id, sector },
        });
        if (!started) notify("The fight could not start. Try again.");
    }
    return <><CoastFigure patrol mask={mask} tile={patrol.tile} model={patrol.model} label={"Inspect " + patrol.name + " · Level " + patrol.level} disabled={disabled} pick={() => setInspection("look")} />
        <Modal open={inspection !== null} title={patrol.name} onClose={() => setInspection(null)}>
            <p>Level {patrol.level} · {patrol.beast ? "Following a scent along the trail." : patrol.name.startsWith("Masterless") ? "Waiting at a post with no orders." : patrol.name.startsWith("Holdout") ? "Watching the trail from cover." : "Checking the trail for travelers."}</p>
            {inspection === "observed" && <p role="status">{clue}</p>}
            <button type="button" onClick={() => setInspection("observed")}>Observe</button>
            <button type="button" onClick={challenge}>Challenge</button>
            <button type="button" onClick={() => setInspection(null)}>Leave</button>
        </Modal></>;
}
export function CoastPatrols({ sector, mask, disabled, notify }: { mask: readonly string[]; sector: number; disabled: boolean; notify: (s: string) => void }) {
    const [attempt, retry] = useState(0);
    const { data, error } = useCoastRead<Patrols>("patrols", attempt);
    if (error || (data && data.sector !== sector)) return <button type="button" className="coast-patrol-retry" onClick={event => {
        event.stopPropagation(); retry(value => value + 1);
    }}>{error || "Patrols are still checking this sector."} Retry</button>;
    return data?.patrols.filter(p => !p.beaten).map(p => <PatrolFigure mask={mask} key={p.id} patrol={p} sector={sector} disabled={disabled} notify={notify} />);
}

