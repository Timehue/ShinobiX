import { useState } from "react";
import type { BossFormAura, BossFormView } from "../../../shared/boss-transformations";
import { bossFormClosingLine } from "../lib/boss-form-view";
import type { ResolvedVnPresentation } from "../lib/vn-presentation";
import type { VnAtmosphere, VnTone } from "../types/vn";
import { CinematicVisualNovelStage } from "./CinematicVisualNovelStage";

/**
 * The short visual-novel scene that plays when a boss transforms mid-fight.
 * The boss speaks its authored lines, then one closing line explains what
 * changed. Loaded lazily by BossFormCutsceneGate, so it costs nothing until a
 * boss actually transforms. Reduced Motion is honoured by the stage itself.
 */
const TONE: Record<BossFormAura, VnTone> = {
    storm: "cold", tempest: "cold", flame: "warm", steam: "danger", obsidian: "danger", moon: "hollow", eclipse: "hollow",
};
const ATMOSPHERE: Record<BossFormAura, Exclude<VnAtmosphere, "auto">> = {
    storm: "rain", tempest: "rain", flame: "embers", obsidian: "embers", steam: "mist", eclipse: "mist", moon: "motes",
};

export default function BossFormCutscene({
    view, bossName, bossImage, playerName, playerImage, backdrop, onDone,
}: {
    view: BossFormView;
    bossName: string;
    bossImage: string;
    playerName: string;
    playerImage: string;
    backdrop?: string;
    onDone: () => void;
}) {
    const [line, setLine] = useState(0);
    const aura = view.aura ?? "storm";
    const speaker = view.cutscene?.speaker ?? bossName;
    const script = [
        ...(view.cutscene?.lines ?? []).map((text) => ({ speaker, text, boss: true })),
        { speaker: `Phase ${view.phase + 1} of ${view.phaseCount + 1}`, text: bossFormClosingLine(view, bossName), boss: false },
    ];
    const current = script[Math.min(line, script.length - 1)]!;
    const last = line >= script.length - 1;
    const presentation: ResolvedVnPresentation = {
        mode: "cinematic", shot: "close", focus: "right", backgroundMotion: "push",
        backgroundPosition: "center", backgroundImage: backdrop ?? "", transition: "whiteout",
        tone: TONE[aura], atmosphere: ATMOSPHERE[aura], actorEntrance: "rise",
        leftActorPose: "resolute", rightActorPose: "defiant", impact: "heavy",
        titleCard: true, ambience: "none", cue: "battle", premium: false,
    };
    const next = () => (last ? onDone() : setLine((value) => value + 1));
    const initials = (name: string) => name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
    return (
        <CinematicVisualNovelStage
            eventId={`boss-form-${view.seq}-${aura}`}
            eventLabel={`${bossName} transforms`}
            pageTitle={view.formName ?? bossName}
            scene={`Phase ${view.phase + 1}: ${view.formName ?? ""}`}
            speaker={current.speaker}
            spoken={current.text}
            pageIndex={0}
            pageCount={1}
            progressLabel="Phase"
            lineIndex={line}
            lineCount={script.length}
            left={{ name: playerName, image: playerImage, initials: initials(playerName), player: true, speaking: false, hidden: !playerImage.startsWith("/") && !playerImage.startsWith("data:") && !playerImage.startsWith("http") }}
            right={{ name: bossName, image: bossImage, initials: initials(bossName), speaking: current.boss }}
            presentation={presentation}
            allowStageAdvance={!last}
            onAdvance={next}
            onCancel={onDone}
            cancelLabel="Skip"
            renderFooter={(typingDone) => typingDone ? (
                <div className="vn-controls">
                    <button type="button" className={last ? "boss-form-resume" : undefined} onClick={next}>{last ? "Resume battle" : "Next"}</button>
                </div>
            ) : null}
        />
    );
}
