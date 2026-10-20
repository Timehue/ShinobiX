import type { CSSProperties, ReactNode } from "react";
import { GameArtIcon } from "./GameArtIcon";
import type { Character } from "../types/character";
import {
    QUEST_BOSSES,
    epicForWanderer,
    metricLabel,
    questbookEntry,
    questbookStage,
    questbookStageText,
} from "../lib/questbook";
import { EpicBellCountdown } from "./EpicBellCountdown";
import {
    lockedQuestMetrics,
    questForWanderer,
    questMetricForId,
    type Wanderer,
} from "../lib/wanderers";
import { wandererAvatar } from "../lib/wanderer-art";
import {
    EMISSARY_BY_SLUG,
    EMISSARY_METRIC_LABELS,
    emissaryLoreLine,
    emissaryQuestById,
    type EmissaryQuestDef,
    type EmissarySlug,
} from "../lib/legacy-emissaries";
import { isStoryReckoningId } from "../lib/story-reckonings";
import { roadFleePriceLine } from "../lib/road-flee-api";
import { wandererForcesChoice, wandererKindLabel } from "../lib/road-cast";
import { EncounterDifficultyBadge } from './EncounterDifficultyBadge';
import type { OrdinaryPveEncounter } from '../../../shared/ordinary-pve-encounter';

import { ordinaryWandererActions } from '../lib/ordinary-wanderer-actions';

type ActionResult = void | Promise<unknown>;
type WandererAction = (wanderer: Wanderer) => ActionResult;
const mutedTextColor="#9aa3b2";
const smallTextSize=".74rem";
const noteMargin="0 0 10px";
const compactTextSize=".78rem";
const choiceRow: CSSProperties = { display: "flex", gap: 8, justifyContent: "center" };
const wrappingChoiceRow: CSSProperties = { ...choiceRow, flexWrap: "wrap" };
const mutedAction: CSSProperties = { background: "transparent", borderColor: "#6b7280", color: mutedTextColor };
const questHint: CSSProperties = { fontSize: ".76rem", fontStyle: "italic", color: "var(--slate-300)", margin: noteMargin };
const shortNote: CSSProperties = { fontSize: ".8rem", margin: noteMargin };

export type WorldWandererDialogState = Readonly<{
    w: Wanderer;
    msg?: string;
    busy?: boolean;
    nemesis?: boolean;
    standingLine?: string;
    peace?: boolean;
    /** The exploration battle this hostile stands for (it is not a road wanderer). */
    ambush?: Readonly<{ sector: number; requestId: string }>;
    /** Minted on the first Flee, so a retry is never charged twice. */
    fleeId?: string;
    /** Why the last Fight or Flee did not go through; the choice stays open. */
    choiceError?: string;
    encounter?: OrdinaryPveEncounter;
}>;

export type WorldWandererDialogProps = Readonly<{
    wandererDialog: WorldWandererDialogState;
    character: Character;
    now: number;
    emissaryDayBucket: number;
    atWar: boolean;
    legacyTrial: ReactNode;
    closeWandererDialog: () => void;
    dismissWandererDialog: () => void;
    startWandererAttack: (wanderer: Wanderer, nemesis?: boolean) => ActionResult;
    fleeWanderer: WandererAction;
    tradeWithWanderer: WandererAction;
    askRoadRumor: WandererAction;
    askAngler: WandererAction;
    visitWandererMedic: WandererAction;
    startPatrolFight: WandererAction;
    followTracker: WandererAction;
    followTrackerTrail: WandererAction;
    abandonTrackerTrail: WandererAction;
    startWandererFavor: WandererAction;
    claimWandererFavor: WandererAction;
    claimWandererGift: WandererAction;
    startWandererPetDuel: WandererAction;
    startWandererCardDuel: WandererAction;
    chooseEpicOption: (wanderer: Wanderer, optionKey: string) => ActionResult;
    abandonEpic: WandererAction;
    claimEpic: WandererAction;
    advanceEpic: (auto?: boolean) => ActionResult;
    fightEpicBoss: WandererAction;
    claimWandererQuest: WandererAction;
    abandonWandererQuest: WandererAction;
    acceptWandererQuest: (wanderer: Wanderer, definition?: EmissaryQuestDef) => ActionResult;
    acceptEpic: (wanderer: Wanderer, questId: string) => ActionResult;
    handleStoryReckoningAbandon: WandererAction;
}>;

function memoryLine(character: Character, wanderer: Wanderer): string | null {
    const met = character.wandererMemories?.[wanderer.archetype] ?? 0;
    if (met >= 3) return "They recognize your stance before you speak.";
    if (met >= 1) return "Their eyes linger. You have met their kind before.";
    return null;
}

/**
 * Presentation-only body of the WorldMap wanderer interaction.
 *
 * WorldMap owns the portal, backdrop policy, cooldowns, async services,
 * authority checks, combat launches, and character mutations.
 */
export function WorldWandererDialog(props:WorldWandererDialogProps) {
    const {
        wandererDialog,
        character,
        now,
        emissaryDayBucket,
        atWar,
        legacyTrial,
        closeWandererDialog,
        dismissWandererDialog,
        startWandererAttack,
        fleeWanderer,
        startPatrolFight,
        chooseEpicOption,
        abandonEpic,
        claimEpic,
        advanceEpic,
        fightEpicBoss,
        claimWandererQuest,
        abandonWandererQuest,
        acceptWandererQuest,
        acceptEpic,
        handleStoryReckoningAbandon,
    }=props;
    const {w,busy,msg,nemesis,standingLine,peace}=wandererDialog;
    const actionButton=(label:string,run:WandererAction,style?:CSSProperties,waitLabel=true)=><button disabled={busy} onClick={()=>run(w)} style={style}>{busy&&waitLabel?'…':label}</button>;
    const leaveButton=<button onClick={closeWandererDialog}>Leave</button>;
    const abandonEpicButton=<button onClick={() => abandonEpic(w)} style={mutedAction}>Abandon</button>;
    const abandonQuestButton=actionButton('Abandon',abandonWandererQuest,mutedAction,false);
    const claimQuestButton=actionButton('Claim reward',claimWandererQuest);
    const gained=(metric:keyof Character,baseline:number)=>Math.max(0,((character[metric] as number|undefined)??0)-baseline);
    const ordinary=ordinaryWandererActions(props);
    const remembered = memoryLine(character, w);

    return (
        <div className="card" style={{ maxWidth: 360, width: "88%", maxHeight: "88dvh", overflowY: "auto", textAlign: "center", padding: 16 }} onClick={(event) => event.stopPropagation()}>
            <img
                src={w.avatarImage || wandererAvatar(w.avatarKey)}
                alt={w.name}
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%", border: `2px solid ${w.tellTint}`, margin: "0 auto 8px" }}
            />
            <h3 style={{ margin: "0 0 2px" }}>{w.name}</h3>
            {wandererDialog.encounter && <EncounterDifficultyBadge encounter={wandererDialog.encounter} showTell />}
            <p style={{ fontSize: ".75rem", color: mutedTextColor, margin: noteMargin }}>{nemesis ? <><GameArtIcon kind="attack" size={15} /> Your rival · Lv {Math.min(100, character.level + (character.wandererNemesis?.tier ?? 1))}</> : w.verb === "trackerTrail" ? "On the trail" : `${wandererKindLabel(w)} · Lv ${w.level}`}</p>
            <p style={{ fontStyle: "italic", margin: "0 0 14px" }}>{msg ?? w.greeting}</p>
            {!msg && remembered && <p style={{ fontSize: ".72rem", color: "#a7f3d0", margin: "-8px 0 12px", fontStyle: "italic" }}>{remembered}</p>}
            {!msg && standingLine && <p style={{ fontStyle: "italic", fontSize: ".8rem", color: peace ? "var(--green-300)" : "var(--slate-300)", margin: "-6px 0 14px" }}>{standingLine}</p>}
            {!msg && wandererForcesChoice(w) ? (
                peace ? (
                    <div style={choiceRow}>
                        <button onClick={dismissWandererDialog}>Pass in peace</button>
                        <button onClick={() => startWandererAttack(w, false)} style={mutedAction}>Fight anyway</button>
                    </div>
                ) : (
                    <>
                        {/* A hostile that has caught you is fought or fled, and the
                            flee price is shown before the choice, never after. */}
                        <p style={{ fontSize: smallTextSize, color: mutedTextColor, margin: "-6px 0 12px" }}>{roadFleePriceLine(character)}</p>
                        {wandererDialog.choiceError && <p role="alert" style={{ fontSize: ".76rem", color: "var(--red-300)", margin: "-6px 0 12px" }}>{wandererDialog.choiceError}</p>}
                        <div style={choiceRow}>
                            <button disabled={busy} onClick={() => w.verb === "patrol" ? startPatrolFight(w) : startWandererAttack(w, !!nemesis)}>Fight</button>
                            <button disabled={busy} onClick={() => fleeWanderer(w)}>Flee</button>
                        </div>
                    </>
                )
            ) : !msg && ordinary ? (
                <div style={wrappingChoiceRow}>
                    {ordinary.map((item,index)=><button key={index} disabled={item.disabled} onClick={item.run} style={item.muted?mutedAction:undefined}>{item.label}</button>)}
                </div>
            ) : !msg && w.verb === "quest" ? (() => {
                const epic = character.activeQuestbook;
                if (epic) {
                    const entry = questbookEntry(epic.id);
                    const stage = questbookStage(epic.id, epic.stage);
                    if (entry && stage) {
                        const got = gained(stage.metric,epic.baseline);
                        const done = !stage.choice && got >= stage.count;
                        const isFinal = epic.stage >= entry.stages.length - 1;
                        const bossArena = !!stage.bossId && stage.metric === "totalAiKills";
                        const bossName = stage.bossId ? (QUEST_BOSSES[stage.bossId]?.name ?? "the foe") : "the foe";
                        const rivalTier = character.wandererNemesis?.tier ?? 0;
                        const scalesRivalry = !!(stage.bossId && QUEST_BOSSES[stage.bossId]?.scalesWithRivalry && rivalTier > 0);
                        return (
                            <>
                                <p style={{ fontSize: ".82rem", margin: "0 0 2px", fontWeight: 700, color: "#c4b5fd" }}><GameArtIcon kind="scroll" size={16} /> {entry.title}</p>
                                <p style={{ fontSize: ".7rem", color: mutedTextColor, margin: "0 0 6px" }}>Stage {epic.stage + 1} of {entry.stages.length}</p>
                                <p style={{ fontSize: ".8rem", margin: "0 0 8px" }}>{questbookStageText(stage, epic.choices)}</p>
                                {stage.timer && epic.deadline ? <EpicBellCountdown deadline={epic.deadline} now={now} /> : null}
                                {stage.choice ? (
                                    <>
                                        <p style={questHint}>{stage.choice.prompt}</p>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {stage.choice.options.map(opt => (
                                                <button key={opt.key} disabled={busy} onClick={() => chooseEpicOption(w, opt.key)} style={{ textAlign: "left", lineHeight: 1.3 }}>
                                                    <strong>{opt.label}</strong><br /><span style={{ fontSize: ".72rem", opacity: 0.85 }}>{opt.blurb}</span>
                                                </button>
                                            ))}
                                            {abandonEpicButton}
                                            {leaveButton}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {scalesRivalry && <p style={{ fontSize: ".75rem", color: "var(--red-300)", margin: "0 0 8px", fontWeight: 600 }}><GameArtIcon kind="attack" size={15} /> He has beaten you {rivalTier}×, and each win has made him stronger{rivalTier >= 4 ? ". He has risen in rank" : ""}.</p>}
                                        <p style={{ fontSize: smallTextSize, color: mutedTextColor, margin: noteMargin }}>Progress: {Math.min(got, stage.count)} / {stage.count} {metricLabel(stage.metric)}</p>
                                        <div style={wrappingChoiceRow}>
                                            {done && isFinal ? (
                                                actionButton('Claim reward',claimEpic)
                                            ) : done ? (
                                                actionButton('Continue',()=>advanceEpic(false))
                                            ) : bossArena ? (
                                                <button onClick={() => fightEpicBoss(w)}><GameArtIcon kind="attack" size={17} /> Fight {bossName}</button>
                                            ) : null}
                                            {abandonEpicButton}
                                            {leaveButton}
                                        </div>
                                    </>
                                )}
                            </>
                        );
                    }
                }
                const active = character.activeWandererQuest;
                if (active) {
                    const metric = emissaryQuestById(active.id)?.metric ?? questMetricForId(active.id);
                    const got = gained(metric,active.baseline);
                    const done = got >= active.target;
                    return done ? (
                        <div style={choiceRow}>
                            {claimQuestButton}
                            {abandonQuestButton}
                            {leaveButton}
                        </div>
                    ) : (
                        <>
                            <p style={shortNote}>Progress: {Math.min(got, active.target)} / {active.target} {EMISSARY_METRIC_LABELS[metric]}</p>
                            {actionButton('Abandon',abandonWandererQuest,{...mutedAction,marginRight:8},false)}
                            {leaveButton}
                        </>
                    );
                }
                const def = questForWanderer(w, lockedQuestMetrics(character));
                const offer = epicForWanderer(w.id, character.level, { atWar, hasRivalry: !!character.wandererNemesis });
                return (
                    <>
                        <p style={shortNote}>Task: {def.label}</p>
                        {offer && <p style={{ fontSize: smallTextSize, color: "#c4b5fd", margin: noteMargin }}><GameArtIcon kind="scroll" size={15} /> {w.name} carries {offer.giver}'s sealed request: “{offer.title}”. It is a long, hard quest in several stages.</p>}
                        <div style={wrappingChoiceRow}>
                            {actionButton('Accept task',acceptWandererQuest)}
                            {offer && actionButton('Begin epic',w=>acceptEpic(w,offer.id),{background:'linear-gradient(#3b2f6b,#1e1b3a)',borderColor:'#a78bfa'})}
                            {leaveButton}
                        </div>
                    </>
                );
            })() : !msg && w.verb === "legacyQuest" ? (() => {
                const em = EMISSARY_BY_SLUG.get(w.archetype as EmissarySlug);
                if (!em) return leaveButton;
                const active = character.activeWandererQuest;
                const activeDef = active ? emissaryQuestById(active.id) : null;
                const got = active ? gained(activeDef?.metric??questMetricForId(active.id),active.baseline) : 0;
                return (
                    <>
                        <p style={questHint}>{emissaryLoreLine(em, emissaryDayBucket)}</p>
                        {active ? (
                            got >= active.target ? (
                                <div style={choiceRow}>
                                    {claimQuestButton}
                                    {abandonQuestButton}
                                </div>
                            ) : (
                                <>
                                    <p style={{ fontSize: compactTextSize, margin: "0 0 8px" }}>Your errand: {Math.min(got, active.target)} / {active.target} {EMISSARY_METRIC_LABELS[activeDef?.metric ?? questMetricForId(active.id)]}</p>
                                    {actionButton('Abandon errand',abandonWandererQuest,mutedAction,false)}
                                </>
                            )
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {/* Emissary errands share the wanderer-quest metric union, so they
                                    need the same locked-objective filter. */}
                                {(em.quests.filter(q => !lockedQuestMetrics(character).includes(q.metric)) as typeof em.quests).map(q => (
                                    <button key={q.id} disabled={busy} onClick={() => acceptWandererQuest(w, q)} style={{ textAlign: "left", fontSize: compactTextSize }}>
                                        {q.label}
                                    </button>
                                ))}
                                {em.quests.every(q => lockedQuestMetrics(character).includes(q.metric)) && (
                                    <p style={{ fontSize: compactTextSize, color: mutedTextColor, margin: 0 }}>They have nothing for you on this road yet. Walk a while longer and come back.</p>
                                )}
                            </div>
                        )}
                        {legacyTrial}
                        {!character.legacy && character.level >= 50 && (
                            <p style={{ fontSize: ".72rem", color: mutedTextColor, margin: "8px 0 0", fontStyle: "italic" }}>
                                “The Sage can offer what I cannot. He will find you. When he does, listen carefully.”
                            </p>
                        )}
                        <div style={{ marginTop: 10 }}>
                            {leaveButton}
                        </div>
                    </>
                );
            })() : msg && isStoryReckoningId(w.id) && character.activeStoryReckoning?.id === w.id ? (
                <div style={wrappingChoiceRow}>
                    {actionButton('Abandon reckoning',handleStoryReckoningAbandon,mutedAction)}
                    {leaveButton}
                </div>
            ) : (
                <button onClick={closeWandererDialog}>{msg ? "Close" : "Leave"}</button>
            )}
        </div>
    );
}
