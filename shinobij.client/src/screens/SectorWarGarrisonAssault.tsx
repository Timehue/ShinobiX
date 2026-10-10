/* eslint-disable react-hooks/set-state-in-effect */
/*
 * SectorWarGarrisonAssault — the Sector War garrison liveness-fallback screen.
 *
 * Two phases (no traverse minigame — this is a direct siege action off the War
 * Map, not a dungeon):
 *   1. fight — starts the server-auth assault (api/village/sector-war action
 *      'garrison-start') and REUSES the whole normal Solo PvE Arena shell
 *      (MissionArenaFight), same as Anbu Infiltration. The defender is a
 *      server-sealed snapshot of the defending village's real ANBU.
 *   2. result — the assault report: whether the garrison fell or held, and
 *      the sector-war contest's new score. The returned server character
 *      replaces local state; this screen does not reconstruct combat costs.
 *
 * Entry context (sector) is stashed to sessionStorage by VillageWarMap before
 * navigating here (mirrors SectorWarCardBattle / SectorWarPetBattle), and the
 * server independently re-derives the contest from the sector, so the client
 * can neither pick the contest nor influence the fight. The screen adds the run
 * it opened to that stash, and marks it `done` once its result is in, so a
 * refresh on the result shows the result again instead of starting a new
 * assault (garrisonMountPlan).
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { VersionedCharacterCommit } from "../types/character";
import {
    clearGarrisonStash,
    garrisonMountPlan,
    garrisonReportCopy,
    readGarrisonStash,
    resolveGarrisonAssault,
    startGarrisonAssault,
    writeGarrisonStash,
    GARRISON_IDLE_LAPSE_MINUTES,
    type GarrisonResolveResponse,
} from "../lib/sector-war-garrison-api";
import { MissionArenaFight } from "./MissionArenaFight";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import type { SoloPveSession } from "../lib/solo-pve-api";

type Phase = "starting" | "fight" | "result";

export function SectorWarGarrisonAssault({
    character,
    sharedImages,
    onVersionedCharacter,
    setScreen,
}: {
    character: Character;
    sharedImages: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit;
    setScreen: (s: Screen) => void;
}) {
    const stashed = useMemo(() => readGarrisonStash(), []);

    const [phase, setPhase] = useState<Phase>("starting");
    const [fight, setFight] = useState<{ runId: string; session: SoloPveSession | null; anbuName: string } | null>(null);
    const [report, setReport] = useState<GarrisonResolveResponse | null>(null);
    // The result on screen is an EARLIER assault's, settled on this visit.
    const [earlier, setEarlier] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const startedRef = useRef(false);

    function backToWarMap() {
        clearGarrisonStash();
        setScreen("villageWarMap");
    }

    /** Show a settled assault's result. Installs the server-settled character
     *  (item usage + surviving HP/hospital) first — and a `false` from the
     *  commit only means a NEWER save is already installed: keep it and still
     *  finish (AnbuVaultRaid's contract). This used to return early there and
     *  leave the player on "Reporting the outcome…" for good. */
    function adoptResult(runId: string, anbuName: string, r: GarrisonResolveResponse, fromEarlier = false) {
        if (r.ok && r.character) onVersionedCharacter(r.character, r._saveVersion);
        if (stashed) writeGarrisonStash({ sector: stashed.sector, runId, anbuName, done: true });
        setFight((current) => current ?? { runId, session: null, anbuName });
        setEarlier(fromEarlier);
        setReport(r);
        setPhase("result");
    }
    const adoptResultFromMount = useEffectEvent(adoptResult);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        const plan = garrisonMountPlan(stashed);
        if (plan.kind === "lost") { setError("The assault context was lost."); return; }
        (async () => {
            try {
                if (plan.kind === "show-result") {
                    // A finished assault's result, re-read (the server replays its
                    // cached settlement) — never a new assault behind the player's back.
                    const r = await resolveGarrisonAssault(plan.runId, character.name);
                    adoptResultFromMount(plan.runId, plan.anbuName, r);
                    return;
                }
                // garrison-start is itself the refresh-resume path: the server keys
                // an active run off (attacker, sector), so calling it again resumes
                // the live session rather than minting a second one — and settles
                // and returns one that finished unreported.
                const res = await startGarrisonAssault(character.name, plan.sector);
                if (res.settledPrevious) {
                    adoptResultFromMount(res.runId, res.anbu.name, res.result, true);
                    return;
                }
                writeGarrisonStash({ sector: plan.sector, runId: res.runId, anbuName: res.anbu.name });
                setFight({ runId: res.runId, session: res.session, anbuName: res.anbu.name });
                setPhase("fight");
            } catch (e) {
                setError(String((e as Error)?.message ?? e));
            }
        })();
    }, [character.name, stashed]);

    async function settleGarrison(runId: string, _playerName: string): Promise<unknown> {
        const r = await resolveGarrisonAssault(runId, character.name);
        adoptResult(runId, fight?.anbuName ?? "", r);
        return r;
    }

    if (error) {
        return (
            <div style={{ maxWidth: 480, margin: "0 auto", padding: "1.2rem", textAlign: "center" }}>
                <h2>Assault Failed</h2>
                <p style={{ opacity: 0.85 }}>{error}</p>
                <button className="spire-result-btn" onClick={backToWarMap}>Back to War Map</button>
            </div>
        );
    }

    if (phase === "fight" && fight?.session) {
        return (
            <MissionArenaFight
                character={character}
                sharedImages={sharedImages}
                runId={fight.runId}
                initialSession={soloPveSessionForArena(fight.session)}
                transport={soloPveArenaTransport}
                onExit={() => { if (report) setPhase("result"); else backToWarMap(); }}
                eventLabel={`Garrison Assault · lapses after ${GARRISON_IDLE_LAPSE_MINUTES} min idle`}
                recordMode="Sector Garrison"
                settleFn={settleGarrison}
                settleOnAnyDone
                renderResult={({ settleState, retry }) => (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            {settleState === "failed" ? (
                                <>
                                    <h2>Report Failed</h2>
                                    <p>The assault finished, but its result couldn&apos;t be loaded. Retry — or leave: the server records a finished assault on its own, and your next assault on this sector shows it.</p>
                                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                        <button className="start-primary-btn" onClick={retry}>Retry</button>
                                        <button onClick={backToWarMap}>Leave</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2>Assault Resolved</h2>
                                    <p>Reporting the outcome to the sector war…</p>
                                </>
                            )}
                        </div>
                    </div>
                )}
            />
        );
    }

    if (phase === "result") {
        const copy = garrisonReportCopy(report, fight?.anbuName ?? "", earlier);
        return (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.2rem", textAlign: "center" }}>
                <h2 style={{ margin: "0.4rem 0" }}>{copy.title}</h2>
                <p style={{ opacity: 0.85 }}>{copy.detail}</p>
                {copy.note && <p style={{ fontSize: 13, opacity: 0.75 }}>{copy.note}</p>}
                {report?.ok && (
                    <p style={{ fontSize: 14 }}>
                        War score now <b>{report.attackerPoints}</b> : <b>{report.defenderPoints}</b>
                    </p>
                )}
                <button className="spire-result-btn" onClick={backToWarMap}>Back to War Map</button>
            </div>
        );
    }

    return (
        <div style={{ display: "grid", placeItems: "center", minHeight: "40dvh", color: "#cbd5e1", textAlign: "center" }}>
            <p>Squaring off against the garrison…</p>
            <p style={{ fontSize: 13, opacity: 0.75 }}>An assault left idle for {GARRISON_IDLE_LAPSE_MINUTES} minutes counts as a retreat.</p>
        </div>
    );
}
