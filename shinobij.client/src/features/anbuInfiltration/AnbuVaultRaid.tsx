/* Sector stronghold: shared exploration, movement patrols, and the final Anbu raid. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StrongholdExplore } from "./StrongholdExplore";
import { strongholdRequest } from "./stronghold-api";
import { StrongholdDialog } from "./StrongholdDialog";
import { isDeathsGateStronghold } from '../../../../shared/sector-stronghold';
import {
    startInfiltration,
    reportInfiltration,
    fetchInfiltrationState,
    anbuInfiltrationAdmissionEnabled,
    anbuAvatarForVillage,
    anbuDisplayName,
    InfiltrationRequestError,
    type InfilReportResponse,
} from "../../lib/anbu-infiltration-api";
import { MissionArenaFight } from "../../screens/MissionArenaFight";
import { soloPveArenaTransport, soloPveSessionForArena } from "../../lib/solo-pve-arena-adapter";
import type { SoloPveSession } from "../../lib/solo-pve-api";
import type { BattleHistoryEntry, Character, PlayerRecord, VersionedCharacterCommit } from "../../types/character";
import { useCapabilityMutationAvailability, useLiveCapabilities } from "../../lib/live-capabilities-context";

// Refresh-resume: the live runId persists here while a fight is up, so a
// mid-fight reload can rejoin the server run. Cleared on clean exits and on
// resolution.
const INFIL_RUN_KEY = "anbuInfiltration.activeRun";
const accountKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
type Phase = "traverse" | "fight" | "result" | "patrol-result";

export function AnbuVaultRaid({
    character,
    sharedImages,
    sector,
    targetVillage,
    onVersionedCharacter,
    onRecordBattle,
    onAttackPlayer,
    onExit,
}: {
    character: Character;
    sharedImages: Record<string, string>;
    sector: number;
    targetVillage: string;
    onVersionedCharacter: VersionedCharacterCommit;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onAttackPlayer: (player: PlayerRecord) => void | Promise<void>;
    onExit: () => void;
}) {
    const anbuMutationAvailability = useCapabilityMutationAvailability("anbuInfiltration");
    const { mutationAvailability, viewAvailability } = useLiveCapabilities();
    const actionsAvailable = anbuInfiltrationAdmissionEnabled(anbuMutationAvailability);
    const recoveryAvailable = viewAvailability('anbuInfiltration') === 'available';
    const [phase, setPhase] = useState<Phase>("traverse");
    const [fight, setFight] = useState<{ runId: string; session: SoloPveSession; anbuName: string; patrol?: boolean; sector?: number; targetVillage?: string } | null>(null);
    const [report, setReport] = useState<InfilReportResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    const [startUncertain, setStartUncertain] = useState(false);
    const [resumeError, setResumeError] = useState('');
    const [resumeAttempt, setResumeAttempt] = useState(0);
    const runKey = `${INFIL_RUN_KEY}:${accountKey(character.name)}`;
    const mounted = useRef(false);
    const lifetime = useRef<object | null>(null);
    useLayoutEffect(() => {
        const owner = {};
        lifetime.current = owner;
        mounted.current = true;
        return () => { mounted.current = false; lifetime.current = null; };
    }, [runKey, sector]);
    // Boss room: true once the player reaches the Anbu at the vault, opening the
    // Challenge / Retreat confrontation (the fight no longer auto-starts on step).
    const [challenge, setChallenge] = useState(false);
    // The masked, anonymous face of this village's vault defender.
    const anbuAvatar = anbuAvatarForVillage(fight?.targetVillage ?? targetVillage);
    const anbuName = anbuDisplayName(targetVillage);
    // Refresh-resume: a stored runId from an interrupted fight is probed once on
    // mount; success jumps straight back into the live fight (the server run
    // lives 45 min). Failure (expired/settled) clears the key and the vault is
    // entered fresh. Note: the run stays bound to ITS sector server-side even if
    // the player reopened a different sector's vault to get here.
    const [resumeRunId, setResumeRunId] = useState<string | null>(() => {
        if (isDeathsGateStronghold(sector)) return null;
        try { return localStorage.getItem(runKey) ?? localStorage.getItem(INFIL_RUN_KEY); } catch { return null; }
    });
    useEffect(() => {
        if (!resumeRunId) return;
        if (!recoveryAvailable) return;
        let alive = true;
        const controller = new AbortController();
        fetchInfiltrationState(resumeRunId, character.name, controller.signal)
            .then(res => {
                if (!alive) return;
                setFight({ runId: resumeRunId, session: res.session, anbuName: res.anbu.name, sector: res.sector, targetVillage: res.targetVillage });
                try { localStorage.setItem(runKey, resumeRunId); localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
                setPhase("fight");
                setResumeRunId(null);
            })
            .catch((e: unknown) => {
                if (!alive) return;
                if (e instanceof InfiltrationRequestError && ((e.status === 404 && e.message === 'Run not found or expired.') || e.status === 403)) {
                    try { localStorage.removeItem(runKey); localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
                    setResumeRunId(null);
                } else setResumeError('Your fight is saved. We could not reconnect yet. Retry when your connection returns.');
            });
        return () => { alive = false; controller.abort(); };
    }, [resumeRunId, recoveryAvailable, resumeAttempt, runKey, character.name]);

    const startingRef = useRef(false);
    function leaveResolvedRaid() {
        // Retire interior presence immediately when leaving a completed fight/report.
        if (startingRef.current) return;
        startingRef.current = true;
        setStarting(true);
        const owner = lifetime.current;
        const ownsAction = () => mounted.current && lifetime.current === owner;
        void strongholdRequest(character.name, fight?.sector ?? sector, 'leave')
            .then(() => { if (ownsAction()) onExit(); })
            .catch(e => { if (ownsAction()) setError((e as Error).message); })
            .finally(() => { if (ownsAction()) { startingRef.current = false; setStarting(false); } });
    }
    // ── the vault: start the server-auth Anbu fight (fired from the boss-room
    //    Challenge confirm, not on step) ────────────────────────────────────────
    async function enterVault() {
        if (isDeathsGateStronghold(sector)) return;
        if (startingRef.current || phase !== "traverse") return;
        if (!anbuInfiltrationAdmissionEnabled(mutationAvailability("anbuInfiltration"))) {
            setError("ANBU infiltration actions are paused. No raid attempt was started.");
            return;
        }
        startingRef.current = true;
        setStarting(true); setError(null);
        const owner = lifetime.current;
        const ownsAction = () => mounted.current && lifetime.current === owner;
        try {
            const res = await startInfiltration(character.name, sector);
            // An acknowledged server run remains recoverable for its original
            // account even if this view was replaced while the request ran.
            try { localStorage.setItem(runKey, res.runId); } catch { /* storage disabled */ }
            if (!ownsAction()) return;
            setStartUncertain(false);
            setChallenge(false);
            setFight({ runId: res.runId, session: res.session, anbuName: res.anbu.name });
            setPhase("fight");
        } catch (e) {
            if (!ownsAction()) return;
            const uncertain = !(e instanceof InfiltrationRequestError) || e.status >= 500;
            setStartUncertain(uncertain);
            setError(uncertain
                ? 'The challenge could not be confirmed. Reconnect to recover it before continuing.'
                : String((e as Error)?.message ?? e));
        } finally {
            if (ownsAction()) { startingRef.current = false; setStarting(false); }
        }
    }

    // Report the terminal Solo PvE evidence through the vault economy route and
    // install the authoritative settled character it returns.
    function adoptSettledCharacter(next: Character, version: unknown) {
        if (accountKey(next.name) !== accountKey(character.name) || typeof version !== 'number' || !Number.isFinite(version)) {
            throw new Error('The settlement returned an invalid character snapshot. Retry to reconnect.');
        }
        // False also means a newer save is already installed. Keep that newer
        // snapshot and still complete this server-confirmed encounter.
        onVersionedCharacter(next, version);
    }
    async function settleInfiltration(runId: string, _playerName: string, signal?: AbortSignal): Promise<unknown> {
        if (!anbuInfiltrationAdmissionEnabled(mutationAvailability("anbuInfiltration"))) {
            throw new Error("ANBU settlement is paused. Keep this run open and retry when live admission returns.");
        }
        const owner = lifetime.current;
        const r = await reportInfiltration(runId, character.name, signal);
        if (!mounted.current || lifetime.current !== owner || signal?.aborted) return r;
        if (r.ok && "character" in r && r.character) adoptSettledCharacter(r.character, r._saveVersion);
        try { localStorage.removeItem(runKey); localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
        setReport(r);
        setPhase("result");
        return r;
    }

    async function settlePatrol(runId: string, _playerName: string, signal?: AbortSignal): Promise<unknown> {
        if (!anbuInfiltrationAdmissionEnabled(mutationAvailability("anbuInfiltration"))) {
            throw new Error('Stronghold settlement is paused. Retry when live admission returns.');
        }
        const owner = lifetime.current;
        const result = await strongholdRequest(character.name, sector, 'patrol-report', { runId }, signal);
        if (!mounted.current || lifetime.current !== owner || signal?.aborted) return result;
        if (result.character) adoptSettledCharacter(result.character, result._saveVersion);
        if (result.won) { setFight(null); setPhase('traverse'); }
        else setPhase('patrol-result');
        return result;
    }

    const guardedArenaTransport = useMemo(() => ({
        ...soloPveArenaTransport,
        fetchState: (sessionId: string, playerName: string) => {
            if (viewAvailability("anbuInfiltration") !== "available") {
                return Promise.reject(new Error("ANBU recovery status is temporarily unavailable."));
            }
            return soloPveArenaTransport.fetchState(sessionId, playerName);
        },
        submitAction: (...args: Parameters<typeof soloPveArenaTransport.submitAction>) => {
            if (!anbuInfiltrationAdmissionEnabled(mutationAvailability("anbuInfiltration"))) {
                return Promise.reject(new Error("ANBU combat actions are temporarily paused."));
            }
            return soloPveArenaTransport.submitAction(...args);
        },
    }), [mutationAvailability, viewAvailability]);

    // ── phases ─────────────────────────────────────────────────────────────────
    if (resumeRunId) {
        return (
            <div className="stronghold-recovery" role="status">
                <h2>Rejoining your infiltration</h2>
                <p>{resumeError || (viewAvailability('anbuInfiltration') !== 'available' ? 'Fight recovery is temporarily paused. Your fight remains saved.' : 'Reconnecting to your saved fight…')}</p>
                {resumeError && <button onClick={() => { setResumeError(''); setResumeAttempt(value => value + 1); }}>Retry connection</button>}
                <button onClick={onExit}>Back to sector</button>
            </div>
        );
    }

    if (phase === "fight" && fight) {
        // Reuse the normal Arena shell (MissionArenaFight) — the same server-authoritative
        // 1v1 board PvE/missions/story use — instead of the tower rail. The vault fight is
        // a plain server-owned 1v1 Solo PvE session using the shared action/state routes.
        // The raider's loadout is already sealed at startInfiltration. On resolve,
        // settleInfiltration flips
        // this screen to its own `phase === "result"` spoils panel, so the in-fight result
        // card only shows transiently (while the report is in flight) or on report failure.
        return (
            <MissionArenaFight
                character={character}
                sharedImages={sharedImages}
                runId={fight.runId}
                initialSession={soloPveSessionForArena(fight.session)}
                transport={guardedArenaTransport}
                onExit={() => {
                    // Leaving pre-report abandons the run (the attempt stays
                    // burned — the raid-start mint-cap rule); post-report just
                    // returns to the spoils panel.
                    if (report) setPhase("result"); else leaveResolvedRaid();
                }}
                onRecordBattle={onRecordBattle}
                recordMode={fight.patrol ? (isDeathsGateStronghold(sector) ? "Obsidian Patrol" : "Stronghold Patrol") : "Anbu Vault"}
                enemyAvatarOverride={fight.patrol ? undefined : anbuAvatar ?? undefined}
                settleFn={fight.patrol ? settlePatrol : settleInfiltration}
                settleOnAnyDone
                renderResult={({ settleState, retry }) => (
                    <div className="battle-ended-overlay">
                        <div className="card battle-ended-card">
                            {settleState === "failed" ? (
                                <>
                                    <h2>Report Failed</h2>
                                    <p>The fight finished, but its outcome could not be synchronized. Retry to finish reporting it.</p>
                                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                                        <button className="start-primary-btn" onClick={retry}>Retry</button>
                                        <button disabled={starting} onClick={leaveResolvedRaid}>{starting ? 'Leaving…' : 'Leave'}</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h2>{fight.patrol ? 'Patrol resolved' : 'Raid resolved'}</h2>
                                    <p>Saving the outcome…</p>
                                </>
                            )}
                            {error && <p role="alert">{error}</p>}
                        </div>
                    </div>
                )}
            />
        );
    }

    if (phase === 'patrol-result') return <div className="stronghold-recovery">
        <h2>Patrol encounter ended</h2>
        <p>Your fight is saved. Recover in the sector before returning to the stronghold entrance.</p>
        {error && <p className="stronghold-error" role="alert">{error}</p>}
        <button disabled={starting} onClick={leaveResolvedRaid}>{starting ? 'Leaving…' : 'Return to sector'}</button>
    </div>;

    if (phase === "result") {
        const won = report?.ok && report.won ? report : null;
        const fresh = won && !("alreadySettled" in won && won.alreadySettled)
            ? (won as Extract<InfilReportResponse, { won: true; alreadySettled: false }>)
            : null;
        return (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.2rem", textAlign: "center" }}>
                <h2 style={{ margin: "0.4rem 0" }}>{won ? "Vault Breached" : "The Anbu Held"}</h2>
                <p style={{ opacity: 0.85 }}>
                    {won
                        ? `You slipped past ${fight?.targetVillage ?? targetVillage}'s defenses and cracked the war vault in Sector ${fight?.sector ?? sector}.`
                        : `${fight?.anbuName ?? "The defending Anbu"} repelled your raid on Sector ${fight?.sector ?? sector}. No spoils — the vault stands.`}
                </p>
                {fresh && (
                    <div style={{ display: "grid", gap: 8, margin: "1rem auto", maxWidth: 380, textAlign: "left" }}>
                        {fresh.supplyCaches > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(58,65,80,0.35)", border: "1px solid rgba(120,130,150,0.35)", borderRadius: 10, padding: "8px 12px" }}>
                                <img src="/items/war-supply-cache.webp" alt="" style={{ width: 40, height: 40 }} />
                                <div><b>{fresh.supplyCaches}× War Supply Cache</b><div style={{ fontSize: 12, opacity: 0.75 }}>Turn in to your CLAN (2 : 1 clan points)</div></div>
                            </div>
                        )}
                        {fresh.wrCaches > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(58,65,80,0.35)", border: "1px solid rgba(120,130,150,0.35)", borderRadius: 10, padding: "8px 12px" }}>
                                <img src="/items/war-resource-cache.webp" alt="" style={{ width: 40, height: 40 }} />
                                <div><b>{fresh.wrCaches}× War Resource Cache</b><div style={{ fontSize: 12, opacity: 0.75 }}>Turn in to your VILLAGE (1 : 1 merit)</div></div>
                            </div>
                        )}
                        {fresh.supplyCaches === 0 && fresh.wrCaches === 0 && (
                            <div style={{ opacity: 0.8, fontSize: 13 }}>The vault's reserves were already bled dry today — its daily loss limit is spent.</div>
                        )}
                        <div style={{ fontSize: 14 }}>+{fresh.ryo.toLocaleString()} ryo</div>
                    </div>
                )}
                {error && <p role="alert">{error}</p>}
                <button className="spire-result-btn" disabled={starting} onClick={leaveResolvedRaid}>{starting ? 'Leaving…' : 'Slip Away'}</button>
            </div>
        );
    }

    // traverse
    return (
        <>
            <StrongholdExplore
                character={character} sector={sector} targetVillage={targetVillage} sharedImages={sharedImages}
                anbuAvatar={anbuAvatar} anbuName={anbuName} blocked={challenge || starting || startUncertain || !actionsAvailable}
                admissionPending={starting || startUncertain} admissionError={error}
                onRetryAdmission={startUncertain && !starting ? () => void enterVault() : undefined}
                onChallenge={() => { if (!isDeathsGateStronghold(sector)) setChallenge(true); }}
                onPatrol={session => {
                    if (startingRef.current || startUncertain) return;
                    setFight({ runId: session.sessionId, session, anbuName: session.enemy.name, patrol: true });
                    setPhase('fight');
                }}
                onAttackPlayer={onAttackPlayer}
                onExit={onExit}
            />
            {/* Boss room — the Challenge / Retreat confrontation at the vault. */}
            {challenge && <StrongholdDialog title="Challenge the Anbu" busy={starting} onClose={() => setChallenge(false)}>
                {anbuAvatar && <img className="stronghold-boss-portrait" src={anbuAvatar} alt={anbuName} />}
                <h3>{anbuName}</h3>
                <p>The masked operative guards the vault at full strength. Defeat them to raid this sector’s war reserves. Your current health and supplies carry into the fight.</p>
                {error && <p className="stronghold-error" role="alert">{error}</p>}
                <div className="stronghold-dialog-actions">
                    <button className="stronghold-attack" onClick={() => void enterVault()} disabled={starting || !actionsAvailable}>{starting ? 'Engaging…' : 'Challenge'}</button>
                    <button onClick={() => setChallenge(false)}>Retreat</button>
                </div>
            </StrongholdDialog>}
        </>
    );
}
