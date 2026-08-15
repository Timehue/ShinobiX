import type { ReactNode } from "react";
import type { Character } from "../types/character";
import {
    QUEST_BOSSES,
    epicForWanderer,
    metricLabel,
    questbookEntry,
    questbookStage,
    timeLeftLabel,
} from "../lib/questbook";
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

type ActionResult = void | Promise<unknown>;
type WandererAction = (wanderer: Wanderer) => ActionResult;

export type WorldWandererDialogState = Readonly<{
    w: Wanderer;
    msg?: string;
    busy?: boolean;
    nemesis?: boolean;
    standingLine?: string;
    peace?: boolean;
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
    startBountyHunterFight: WandererAction;
    tradeWithWanderer: WandererAction;
    askRoadRumor: WandererAction;
    visitWandererMedic: WandererAction;
    startPatrolFight: WandererAction;
    followTracker: WandererAction;
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
    if (met >= 1) return "Their eyes linger - this is not your first meeting with their kind.";
    return null;
}

/**
 * Presentation-only body of the WorldMap wanderer interaction.
 *
 * WorldMap owns the portal, backdrop policy, cooldowns, async services,
 * authority checks, combat launches, and character mutations.
 */
export function WorldWandererDialog({
    wandererDialog,
    character,
    now,
    emissaryDayBucket,
    atWar,
    legacyTrial,
    closeWandererDialog,
    dismissWandererDialog,
    startWandererAttack,
    startBountyHunterFight,
    tradeWithWanderer,
    askRoadRumor,
    visitWandererMedic,
    startPatrolFight,
    followTracker,
    startWandererFavor,
    claimWandererFavor,
    claimWandererGift,
    startWandererPetDuel,
    startWandererCardDuel,
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
}: WorldWandererDialogProps) {
    const remembered = memoryLine(character, wandererDialog.w);

    return (
        <div className="card" style={{ maxWidth: 360, width: "88%", maxHeight: "88dvh", overflowY: "auto", textAlign: "center", padding: 16 }} onClick={(event) => event.stopPropagation()}>
            <img
                src={wandererDialog.w.avatarImage || wandererAvatar(wandererDialog.w.avatarKey)}
                alt={wandererDialog.w.name}
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: "50%", border: `2px solid ${wandererDialog.w.tellTint}`, margin: "0 auto 8px" }}
            />
            <h3 style={{ margin: "0 0 2px" }}>{wandererDialog.nemesis && character.wandererNemesis ? character.wandererNemesis.name : wandererDialog.w.name}</h3>
            <p style={{ fontSize: ".75rem", color: "#9aa3b2", margin: "0 0 10px" }}>{wandererDialog.nemesis ? `⚔ Your rival · Lv ${Math.min(100, character.level + (character.wandererNemesis?.tier ?? 1))}` : `${wandererDialog.w.verb === "petDuel" ? "Wild beast" : "Wandering shinobi"} · Lv ${wandererDialog.w.level}`}</p>
            <p style={{ fontStyle: "italic", margin: "0 0 14px" }}>{wandererDialog.msg ?? (wandererDialog.nemesis ? `"You again, ${character.name}. You walked away last time — you won't this time."` : wandererDialog.w.greeting)}</p>
            {!wandererDialog.msg && remembered && <p style={{ fontSize: ".72rem", color: "#a7f3d0", margin: "-8px 0 12px", fontStyle: "italic" }}>{remembered}</p>}
            {!wandererDialog.msg && wandererDialog.standingLine && <p style={{ fontStyle: "italic", fontSize: ".8rem", color: wandererDialog.peace ? "var(--green-300)" : "var(--slate-300)", margin: "-6px 0 14px" }}>{wandererDialog.standingLine}</p>}
            {!wandererDialog.msg && wandererDialog.w.verb === "attack" ? (
                wandererDialog.peace ? (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button onClick={dismissWandererDialog}>Pass in peace</button>
                        <button onClick={() => startWandererAttack(wandererDialog.w, false)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Fight anyway</button>
                    </div>
                ) : (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button onClick={() => startWandererAttack(wandererDialog.w, !!wandererDialog.nemesis)}>Fight</button>
                        <button onClick={dismissWandererDialog}>Flee</button>
                    </div>
                )
            ) : !wandererDialog.msg && wandererDialog.w.verb === "bountyHunter" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => startBountyHunterFight(wandererDialog.w)} style={{ background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "var(--red-400)", fontWeight: 700 }}>{wandererDialog.busy ? "..." : "Stand & Fight"}</button>
                    <button onClick={dismissWandererDialog}>Flee</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "merchant" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => tradeWithWanderer(wandererDialog.w)}>{wandererDialog.busy ? "..." : "Trade"}</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "medic" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => visitWandererMedic(wandererDialog.w)}>{wandererDialog.busy ? "..." : "Treat wounds"}</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "patrol" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => startPatrolFight(wandererDialog.w)}>Stand your ground</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Move along</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "tracker" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    {/* Follow tracks leads into a pet duel — hide it, rather than
                        locking the whole tracker, when there's no pet to send. */}
                    {character.pets.length > 0 && <button onClick={() => followTracker(wandererDialog.w)}>Follow tracks</button>}
                    <button disabled={wandererDialog.busy} onClick={() => startWandererFavor(wandererDialog.w)}>{wandererDialog.busy ? "..." : "Take a favor"}</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "courier" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => claimWandererFavor(wandererDialog.w)}>{wandererDialog.busy ? "..." : "Deliver favor"}</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "gift" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => claimWandererGift(wandererDialog.w)}>{wandererDialog.busy ? "…" : "Take it"}</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "petDuel" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => startWandererPetDuel(wandererDialog.w)}>Send out your pet</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "gamble" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => startWandererCardDuel(wandererDialog.w)}>Deal me in</button>
                    <button onClick={() => askRoadRumor(wandererDialog.w)}>Ask about the road</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : !wandererDialog.msg && wandererDialog.w.verb === "quest" ? (() => {
                const epic = character.activeQuestbook;
                if (epic) {
                    const entry = questbookEntry(epic.id);
                    const stage = questbookStage(epic.id, epic.stage);
                    if (entry && stage) {
                        const got = Math.max(0, ((character[stage.metric] as number | undefined) ?? 0) - epic.baseline);
                        const done = !stage.choice && got >= stage.count;
                        const isFinal = epic.stage >= entry.stages.length - 1;
                        const bossArena = !!stage.bossId && stage.metric === "totalAiKills";
                        const bossName = stage.bossId ? (QUEST_BOSSES[stage.bossId]?.name ?? "the foe") : "the foe";
                        const rivalTier = character.wandererNemesis?.tier ?? 0;
                        const scalesRivalry = !!(stage.bossId && QUEST_BOSSES[stage.bossId]?.scalesWithRivalry && rivalTier > 0);
                        const left = stage.timer && epic.deadline ? timeLeftLabel(epic.deadline, now) : null;
                        const expired = left === "0:00";
                        return (
                            <>
                                <p style={{ fontSize: ".82rem", margin: "0 0 2px", fontWeight: 700, color: "#c4b5fd" }}>📖 {entry.title}</p>
                                <p style={{ fontSize: ".7rem", color: "#9aa3b2", margin: "0 0 6px" }}>Stage {epic.stage + 1} of {entry.stages.length}</p>
                                <p style={{ fontSize: ".8rem", margin: "0 0 8px" }}>{stage.text}</p>
                                {left && <p style={{ fontSize: ".78rem", margin: "0 0 8px", fontWeight: 700, color: expired ? "var(--red-400)" : "#fbbf24" }}>{expired ? "⏳ The bell rang — your next attempt resets this stage." : `⏳ ${left} before the bell rings`}</p>}
                                {stage.choice ? (
                                    <>
                                        <p style={{ fontSize: ".76rem", fontStyle: "italic", color: "var(--slate-300)", margin: "0 0 10px" }}>{stage.choice.prompt}</p>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {stage.choice.options.map(opt => (
                                                <button key={opt.key} disabled={wandererDialog.busy} onClick={() => chooseEpicOption(wandererDialog.w, opt.key)} style={{ textAlign: "left", lineHeight: 1.3 }}>
                                                    <strong>{opt.label}</strong><br /><span style={{ fontSize: ".72rem", opacity: 0.85 }}>{opt.blurb}</span>
                                                </button>
                                            ))}
                                            <button onClick={() => abandonEpic(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Abandon</button>
                                            <button onClick={closeWandererDialog}>Leave</button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {scalesRivalry && <p style={{ fontSize: ".75rem", color: "var(--red-300)", margin: "0 0 8px", fontWeight: 600 }}>⚔ He has bested you {rivalTier}× — his promoted form is that much stronger{rivalTier >= 4 ? ", and risen" : ""}.</p>}
                                        <p style={{ fontSize: ".74rem", color: "#9aa3b2", margin: "0 0 10px" }}>Progress: {Math.min(got, stage.count)} / {stage.count} {metricLabel(stage.metric)}</p>
                                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                                            {done && isFinal ? (
                                                <button disabled={wandererDialog.busy} onClick={() => claimEpic(wandererDialog.w)}>{wandererDialog.busy ? "…" : "Claim reward"}</button>
                                            ) : done ? (
                                                <button disabled={wandererDialog.busy} onClick={() => advanceEpic(false)}>{wandererDialog.busy ? "…" : "Continue"}</button>
                                            ) : bossArena ? (
                                                <button onClick={() => fightEpicBoss(wandererDialog.w)}>⚔ Fight {bossName}</button>
                                            ) : null}
                                            <button onClick={() => abandonEpic(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Abandon</button>
                                            <button onClick={closeWandererDialog}>Leave</button>
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
                    const got = Math.max(0, ((character[metric] as number | undefined) ?? 0) - active.baseline);
                    const done = got >= active.target;
                    return done ? (
                        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                            <button disabled={wandererDialog.busy} onClick={() => claimWandererQuest(wandererDialog.w)}>{wandererDialog.busy ? "…" : "Claim reward"}</button>
                            <button disabled={wandererDialog.busy} onClick={() => abandonWandererQuest(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Abandon</button>
                            <button onClick={closeWandererDialog}>Leave</button>
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: ".8rem", margin: "0 0 10px" }}>Progress: {Math.min(got, active.target)} / {active.target} {EMISSARY_METRIC_LABELS[metric]}</p>
                            <button disabled={wandererDialog.busy} onClick={() => abandonWandererQuest(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2", marginRight: 8 }}>Abandon</button>
                            <button onClick={closeWandererDialog}>Leave</button>
                        </>
                    );
                }
                const def = questForWanderer(wandererDialog.w, lockedQuestMetrics(character));
                const offer = epicForWanderer(wandererDialog.w.id, character.level, { atWar, hasRivalry: !!character.wandererNemesis });
                return (
                    <>
                        <p style={{ fontSize: ".8rem", margin: "0 0 10px" }}>Task: {def.label}</p>
                        {offer && <p style={{ fontSize: ".74rem", color: "#c4b5fd", margin: "0 0 10px" }}>📖 Epic available: “{offer.title}” — a long, hard tale in stages.</p>}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                            <button disabled={wandererDialog.busy} onClick={() => acceptWandererQuest(wandererDialog.w)}>{wandererDialog.busy ? "…" : "Accept task"}</button>
                            {offer && <button disabled={wandererDialog.busy} onClick={() => acceptEpic(wandererDialog.w, offer.id)} style={{ background: "linear-gradient(#3b2f6b,#1e1b3a)", borderColor: "#a78bfa" }}>{wandererDialog.busy ? "…" : "Begin epic"}</button>}
                            <button onClick={closeWandererDialog}>Leave</button>
                        </div>
                    </>
                );
            })() : !wandererDialog.msg && wandererDialog.w.verb === "legacyQuest" ? (() => {
                const em = EMISSARY_BY_SLUG.get(wandererDialog.w.archetype as EmissarySlug);
                if (!em) return <button onClick={closeWandererDialog}>Leave</button>;
                const active = character.activeWandererQuest;
                const activeDef = active ? emissaryQuestById(active.id) : null;
                const got = active ? Math.max(0, ((character[(activeDef?.metric ?? questMetricForId(active.id))] as number | undefined) ?? 0) - active.baseline) : 0;
                return (
                    <>
                        <p style={{ fontSize: ".76rem", fontStyle: "italic", color: "var(--slate-300)", margin: "0 0 10px" }}>{emissaryLoreLine(em, emissaryDayBucket)}</p>
                        {active ? (
                            got >= active.target ? (
                                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                    <button disabled={wandererDialog.busy} onClick={() => claimWandererQuest(wandererDialog.w)}>{wandererDialog.busy ? "…" : "Claim reward"}</button>
                                    <button disabled={wandererDialog.busy} onClick={() => abandonWandererQuest(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Abandon</button>
                                </div>
                            ) : (
                                <>
                                    <p style={{ fontSize: ".78rem", margin: "0 0 8px" }}>Your errand: {Math.min(got, active.target)} / {active.target} {EMISSARY_METRIC_LABELS[activeDef?.metric ?? questMetricForId(active.id)]}</p>
                                    <button disabled={wandererDialog.busy} onClick={() => abandonWandererQuest(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>Abandon errand</button>
                                </>
                            )
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {/* Emissary errands share the wanderer-quest metric union, so they
                                    need the same locked-objective filter. */}
                                {(em.quests.filter(q => !lockedQuestMetrics(character).includes(q.metric)) as typeof em.quests).map(q => (
                                    <button key={q.id} disabled={wandererDialog.busy} onClick={() => acceptWandererQuest(wandererDialog.w, q)} style={{ textAlign: "left", fontSize: ".78rem" }}>
                                        {q.label}
                                    </button>
                                ))}
                                {em.quests.every(q => lockedQuestMetrics(character).includes(q.metric)) && (
                                    <p style={{ fontSize: ".78rem", color: "#9aa3b2", margin: 0 }}>They have nothing for you on this road yet. Walk a while longer and come back.</p>
                                )}
                            </div>
                        )}
                        {legacyTrial}
                        {!character.legacy && character.level >= 50 && (
                            <p style={{ fontSize: ".72rem", color: "#9aa3b2", margin: "8px 0 0", fontStyle: "italic" }}>
                                “The Sage carries what I cannot give. When he finds you — and he will — listen carefully.”
                            </p>
                        )}
                        <div style={{ marginTop: 10 }}>
                            <button onClick={closeWandererDialog}>Leave</button>
                        </div>
                    </>
                );
            })() : wandererDialog.msg && isStoryReckoningId(wandererDialog.w.id) && character.activeStoryReckoning?.id === wandererDialog.w.id ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <button disabled={wandererDialog.busy} onClick={() => handleStoryReckoningAbandon(wandererDialog.w)} style={{ background: "transparent", borderColor: "#6b7280", color: "#9aa3b2" }}>{wandererDialog.busy ? "…" : "Abandon reckoning"}</button>
                    <button onClick={closeWandererDialog}>Leave</button>
                </div>
            ) : (
                <button onClick={closeWandererDialog}>{wandererDialog.msg ? "Close" : "Leave"}</button>
            )}
        </div>
    );
}
