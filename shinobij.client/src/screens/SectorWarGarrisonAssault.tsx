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
 * can neither pick the contest nor influence the fight.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { VersionedCharacterCommit } from "../types/character";
import {
    startGarrisonAssault,
    resolveGarrisonAssault,
    type GarrisonResolveResponse,
} from "../lib/sector-war-garrison-api";
import { MissionArenaFight } from "./MissionArenaFight";
import { soloPveArenaTransport, soloPveSessionForArena } from "../lib/solo-pve-arena-adapter";
import type { SoloPveSession } from "../lib/solo-pve-api";

const GARRISON_STASH_KEY = "sectorWarGarrison.v1";
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
    const stashed = useMemo<{ sector: number } | null>(() => {
        try {
            const raw = sessionStorage.getItem(GARRISON_STASH_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as { sector?: number };
            return Number.isFinite(parsed.sector) ? { sector: Math.floor(Number(parsed.sector)) } : null;
        } catch {
            return null;
        }
    }, []);

    const [phase, setPhase] = useState<Phase>("starting");
    const [fight, setFight] = useState<{ runId: string; session: SoloPveSession; anbuName: string } | null>(null);
    const [report, setReport] = useState<GarrisonResolveResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const startedRef = useRef(false);

    function backToWarMap() {
        try { sessionStorage.removeItem(GARRISON_STASH_KEY); } catch { /* storage disabled */ }
        setScreen("villageWarMap");
    }

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        if (!stashed) { setError("The assault context was lost."); return; }
        (async () => {
            try {
                // garrison-start is itself the refresh-resume path: the server keys
                // an active run off (attacker, sector), so calling it again for the
                // same contest replays the existing live session rather than
                // minting a second one.
                const res = await startGarrisonAssault(character.name, stashed.sector);
                setFight({ runId: res.runId, session: res.session, anbuName: res.anbu.name });
                setPhase("fight");
            } catch (e) {
                setError(String((e as Error)?.message ?? e));
            }
        })();
    }, [character.name, stashed]);

    async function settleGarrison(runId: string, _playerName: string): Promise<unknown> {
        const r = await resolveGarrisonAssault(runId, character.name);
        // Install the server-settled character (item usage + surviving HP/hospital
        // from the fight) before showing the result — same contract as every
        // other AI-fight settlement (AnbuVaultRaid, MissionArenaFight itself).
        if (r.ok && r.character && !onVersionedCharacter(r.character, r._saveVersion)) return r;
        setReport(r);
        setPhase("result");
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

    if (phase === "fight" && fight) {
        return (
            <MissionArenaFight
                character={character}
                sharedImages={sharedImages}
                runId={fight.runId}
                initialSession={soloPveSessionForArena(fight.session)}
                transport={soloPveArenaTransport}
                onExit={() => { if (report) setPhase("result"); else backToWarMap(); }}
                recordMode="Sector Garrison"
                settleFn={settleGarrison}
                settleOnAnyDone
                renderResult={({ settleState, retry }) => (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            {settleState === "failed" ? (
                                <>
                                    <h2>Report Failed</h2>
                                    <p>The assault finished, but the outcome couldn&apos;t be reported to the server. Retry — the sector war score will not move until it lands.</p>
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
        const won = report?.ok && "attackerWon" in report ? report.attackerWon : null;
        return (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.2rem", textAlign: "center" }}>
                <h2 style={{ margin: "0.4rem 0" }}>{won ? "Garrison Fallen" : won === false ? "The Garrison Held" : "Assault Over"}</h2>
                <p style={{ opacity: 0.85 }}>
                    {won
                        ? `${fight?.anbuName ?? "The garrison"} fell — your side scores this sector war.`
                        : won === false
                            ? `${fight?.anbuName ?? "The defending Anbu"} repelled your assault. The garrison scores for the defence.`
                            : "The clash ended without a decision — no points changed hands."}
                </p>
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
        <div style={{ display: "grid", placeItems: "center", minHeight: "40dvh", color: "#cbd5e1" }}>
            <p>Squaring off against the garrison…</p>
        </div>
    );
}
