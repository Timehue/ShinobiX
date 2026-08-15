/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity -- polling a server-owned operation projection; Date.now drives display-only countdowns. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClanBossPartyEnvelope } from "../../../shared/clan-boss-operation";
import type { Character, BattleHistoryEntry, VersionedCharacterCommit } from "../types/character";
import {
    fetchMyRun,
    fetchTowerState,
    submitTowerActionWithLostResponseRetry,
    type TowerActionInput,
    type TowerHostLoadout,
    type TowerSession,
} from "../lib/towers-api";
import { visiblePoll } from "../lib/poll";
import {
    fetchClanBoss,
    fetchClanBossParty,
    mutateClanBossParty,
    settleClanBossAssault,
    startClanBossAssault,
    type ClanBossView,
} from "../lib/clan-boss-api";
import { ClanBossPartyLobby, type ClanBossPartyAction } from "../components/ClanBossPartyLobby";
import { ClanBossOperationComms } from "../components/ClanBossOperationComms";
import { BattleTowerFight } from "./BattleTowerFight";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
    useLiveCapabilities,
} from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";
import oniPortrait from "../assets/clan-boss/clan-boss-oni.webp";
import leviathanPortrait from "../assets/clan-boss/clan-boss-leviathan.webp";
import kagePortrait from "../assets/clan-boss/clan-boss-kage.webp";
import golemPortrait from "../assets/clan-boss/clan-boss-golem.webp";

const BOSS_PORTRAITS: Record<string, string> = {
    "oni-warlord": oniPortrait,
    "abyss-leviathan": leviathanPortrait,
    "fallen-kage": kagePortrait,
    "stone-golem": golemPortrait,
};

function requestId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
    return `cb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function ClanBoss({ character, clanmates, hostLoadout, sharedImages, onRecordBattle, onVersionedCharacter }: {
    character: Character;
    clanmates: string[];
    hostLoadout?: TowerHostLoadout;
    sharedImages?: Record<string, string>;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onVersionedCharacter: VersionedCharacterCommit;
}) {
    const clanBossViewAvailability = useCapabilityViewAvailability("clanBoss");
    const partiesViewAvailability = useCapabilityViewAvailability("clanBossParties");
    const clanBossMutationAvailability = useCapabilityMutationAvailability("clanBoss");
    const partiesMutationAvailability = useCapabilityMutationAvailability("clanBossParties");
    const { mutationAvailability, viewAvailability } = useLiveCapabilities();
    const clanBossAvailable = capabilityAdmissionAllowed(clanBossViewAvailability);
    const partiesAvailable = capabilityAdmissionAllowed(partiesViewAvailability);
    const clanBossActionsAvailable = capabilityAdmissionAllowed(clanBossMutationAvailability);
    const partyActionsAvailable = capabilityAdmissionAllowed(partiesMutationAvailability);
    const [view, setView] = useState<ClanBossView | null>(null);
    const [partyState, setPartyState] = useState<ClanBossPartyEnvelope | null>(null);
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
    const [fight, setFight] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [pendingRun, setPendingRun] = useState<{ runId: string; session: TowerSession } | null>(null);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState("");
    const actionBusyRef = useRef(false);
    const startRequestRef = useRef<{ partyVersion: number; id: string } | null>(null);
    const playerSlug = slug(character.name);
    const partyServerDisabled = partyState?.errorCode === "parties-disabled";
    const partiesUsable = partiesAvailable && !partyServerDisabled;
    const partyActionsUsable = partiesUsable && partyActionsAvailable;

    const load = useCallback(async () => {
        if (!clanBossAvailable) return;
        const [nextView, nextParty] = await Promise.all([
            fetchClanBoss(character.name),
            partiesAvailable ? fetchClanBossParty(character.name) : Promise.resolve(null),
        ]);
        if (!nextView) {
            setLoadState("error");
            return;
        }
        setView(nextView);
        setPartyState(partiesAvailable ? nextParty : null);
        setLoadState("ready");
    }, [character.name, clanBossAvailable, partiesAvailable]);

    useEffect(() => {
        if (!clanBossAvailable) return;
        void load();
    }, [clanBossAvailable, load]);
    useEffect(() => {
        if (!clanBossAvailable || !partiesUsable) return;
        const poll = () => fetchClanBossParty(character.name).then((next) => { if (next) setPartyState(next); });
        return visiblePoll(poll, 4_000);
    }, [character.name, clanBossAvailable, partiesUsable]);

    useEffect(() => {
        if (!clanBossAvailable || fight) return;
        let alive = true;
        const check = () => fetchMyRun(character.name)
            .then((run) => { if (alive) setPendingRun(run?.runId.startsWith("cboss-") ? run : null); })
            .catch(() => undefined);
        void check();
        const stop = visiblePoll(check, 4_000);
        return () => { alive = false; stop(); };
    }, [character.name, clanBossAvailable, fight]);

    const act: ClanBossPartyAction = useCallback((action, extras = {}) => {
        if (!clanBossActionsAvailable || !partyActionsUsable
            || !capabilityAdmissionAllowed(mutationAvailability("clanBoss"))
            || !capabilityAdmissionAllowed(mutationAvailability("clanBossParties"))) {
            setFlash("Clan Boss party changes are paused. Existing party and operation state remain recoverable.");
            return;
        }
        if (actionBusyRef.current || !partyState) return;
        const candidateId = (action === "join" || action === "decline") && !partyState.party ? extras.target : undefined;
        const candidate = candidateId
            ? [...partyState.invitations, ...partyState.publicParties].find((entry) => entry.id === candidateId)
            : undefined;
        const party = partyState.party ?? candidate;
        if (action !== "create" && !party) return;
        actionBusyRef.current = true;
        setBusy(true);
        setFlash("");
        void mutateClanBossParty({
            playerName: character.name,
            action,
            partyId: party?.id,
            expectedVersion: party?.version,
            target: candidateId ? undefined : extras.target,
            visibility: extras.visibility,
            ping: extras.ping,
            requestId: requestId(),
        }).then((next) => {
            if (!next.ok) {
                setFlash(next.error ?? "The party changed. Refresh and try again.");
                if (next.party) setPartyState((current) => current ? { ...current, party: next.party } : current);
                return;
            }
            setPartyState(next);
        }).finally(() => {
            actionBusyRef.current = false;
            setBusy(false);
        });
    }, [character.name, clanBossActionsAvailable, mutationAvailability, partyActionsUsable, partyState]);

    const start = useCallback(() => {
        if (!clanBossActionsAvailable || !capabilityAdmissionAllowed(mutationAvailability("clanBoss"))) {
            setFlash("New Clan Boss assaults are paused. Any accepted operation remains recoverable.");
            return;
        }
        const party = partiesUsable ? partyState?.party : undefined;
        const soloCompatibility = !partiesUsable;
        if (party && (!partyActionsUsable || !capabilityAdmissionAllowed(mutationAvailability("clanBossParties")))) {
            setFlash("Party assault admission is paused. Your party remains intact.");
            return;
        }
        if (busy || (!party && !soloCompatibility) || (party && (party.leaderSlug !== playerSlug || !party.canStart))) return;
        setBusy(true);
        setFlash("");
        const partyVersion = party?.version ?? -1;
        if (!startRequestRef.current || startRequestRef.current.partyVersion !== partyVersion) {
            startRequestRef.current = { partyVersion, id: requestId() };
        }
        void startClanBossAssault(character.name, party?.id, party?.version, startRequestRef.current.id, hostLoadout)
            .then((result) => {
                if ("error" in result) {
                    setFlash(result.error);
                    if (result.status && result.status < 500) startRequestRef.current = null;
                    void load();
                    return;
                }
                startRequestRef.current = null;
                setFight({ runId: result.runId, session: result.session });
            })
            .finally(() => setBusy(false));
    }, [busy, character.name, clanBossActionsAvailable, hostLoadout, load, mutationAvailability, partiesUsable, partyActionsUsable, partyState?.party, playerSlug]);

    const fetchAcceptedOperationState = useCallback((runId: string, playerName: string, signal?: AbortSignal) => {
        if (!capabilityAdmissionAllowed(viewAvailability("clanBoss"))) {
            return Promise.reject(new Error("Clan Boss recovery status is temporarily unavailable."));
        }
        return fetchTowerState(runId, playerName, signal);
    }, [viewAvailability]);
    const submitAcceptedOperationAction = useCallback((runId: string, playerName: string, action: TowerActionInput, expectedVersion?: number) => {
        if (!capabilityAdmissionAllowed(mutationAvailability("clanBoss"))) {
            return Promise.reject(new Error("Clan Boss combat actions are temporarily paused."));
        }
        return submitTowerActionWithLostResponseRetry(runId, playerName, action, expectedVersion);
    }, [mutationAvailability]);
    const settleAcceptedOperation = useCallback((runId: string, playerName: string) => {
        if (!capabilityAdmissionAllowed(mutationAvailability("clanBoss"))) {
            return Promise.reject(new Error("Clan Boss settlement is paused. Keep this operation open and retry when live actions return."));
        }
        return settleClanBossAssault(runId, playerName);
    }, [mutationAvailability]);

    if (!clanBossAvailable) return null;

    if (fight && !clanBossActionsAvailable) {
        return (
            <div className="summary-box clan-boss-operation-fight" role="status">
                <h3>Clan Boss operation paused</h3>
                <p>Live operation admission is temporarily unavailable. Your accepted run remains server-owned and will resume here when progress-changing actions reopen.</p>
                <button type="button" onClick={() => setFight(null)}>Return to operation status</button>
            </div>
        );
    }

    if (fight) {
        return (
            <div className="clan-boss-operation-fight">
                <ClanBossOperationComms party={partiesUsable ? partyState?.party ?? null : null} onAction={act} />
                <BattleTowerFight
                    character={character}
                    sharedImages={sharedImages}
                    hostLoadout={hostLoadout}
                    runId={fight.runId}
                    initialSession={fight.session}
                    stateFn={fetchAcceptedOperationState}
                    actionRetryFn={submitAcceptedOperationAction}
                    onRecordBattle={onRecordBattle}
                    settleFn={settleAcceptedOperation}
                    onVersionedCharacter={onVersionedCharacter}
                    settleOnAnyDone
                    onExit={() => {
                        setFight(null);
                        setFlash("Assault resolved. Contribution, profession, clan, and sector results are sealed below.");
                        void load();
                    }}
                />
            </div>
        );
    }

    if (loadState === "loading") return <div className="summary-box operation-loading" aria-busy="true"><p className="hint">Scouting the weekly threat and party service…</p></div>;
    if (loadState === "error" || !view) return <div className="summary-box operation-error" role="status"><h3>Weekly Clan Boss</h3><p>The live operation state could not be reached. Your save and any active party remain server-side.</p><button type="button" onClick={() => void load()}>Retry</button></div>;
    if (!view.active) return <div className="summary-box"><h3>Weekly Clan Boss</h3><p className="hint">No Clan Boss operation is active right now. A fresh threat appears at the weekly reset.</p></div>;
    if (!view.inClan || !view.myClan) return <div className="summary-box"><h3>Weekly Clan Boss</h3><p className="hint">Join a clan to form a real 1–4 player operation party.</p></div>;

    const clan = view.myClan;
    const boss = view.boss;
    const portrait = boss ? BOSS_PORTRAITS[boss.id] : undefined;
    const hpPct = Math.max(0, Math.min(100, (clan.pool / clan.poolMax) * 100));
    const daysLeft = view.endsAt ? Math.max(0, Math.ceil((view.endsAt - Date.now()) / 86_400_000)) : 0;
    const soloCompatibility = !partiesUsable;

    return (
        <div className="summary-box clan-raid clan-boss-operation">
            <div className="clan-raid-boss">
                {portrait ? <img className="clan-boss-portrait" src={portrait} alt={boss?.name ?? "Clan boss"} /> : <span className="clan-raid-boss-icon">{boss?.icon ?? "Boss"}</span>}
                <div>
                    <h3>{boss?.name ?? "Weekly Clan Boss"}</h3>
                    <p className="hint">{boss?.flavor}</p>
                    <p className="hint">Week ends in ~{daysLeft} day{daysLeft === 1 ? "" : "s"} · clan rank {clan.rank ?? "—"}</p>
                </div>
            </div>

            <div className="operation-world-context">
                <div><span>Operation Sector</span><strong>{view.sectorState?.sectorName ?? `Sector ${boss?.sectorId ?? "—"}`}</strong><small>{view.sectorState?.regionName}</small></div>
                <div><span>World Pressure</span><strong>{view.sectorState?.pressure ?? 100}%</strong><small>Bounded shared context · no territory ownership change</small></div>
            </div>

            <div className="clan-raid-hp" aria-label={`Clan boss health ${clan.pool} of ${clan.poolMax}`}>
                <div className="bar enemy-bar"><span className={clan.killed ? "is-defeated" : ""} style={{ width: `${hpPct}%` }} /></div>
                <div className="clan-raid-hp-label"><span>{clan.killed ? "Boss defeated" : "Boss HP · your clan"}</span><span>{clan.pool.toLocaleString()} / {clan.poolMax.toLocaleString()}</span></div>
            </div>

            {flash ? <p className="clan-raid-flash" role="status">{flash}</p> : null}
            {pendingRun ? <button type="button" className="operation-rejoin" onClick={() => { setFight(pendingRun); setPendingRun(null); }}>Rejoin your accepted operation</button> : null}
            {!clanBossActionsAvailable ? <p className="clan-raid-flash" role="status">New assaults and party changes are paused. Status and accepted-operation recovery remain available.</p> : null}

            {!clan.killed && partyState && partiesUsable ? <ClanBossPartyLobby envelope={partyState} playerSlug={playerSlug} clanmates={clanmates} busy={busy || !clanBossActionsAvailable || !partyActionsAvailable} onAction={act} onStart={start} /> : null}
            {!clan.killed && soloCompatibility ? <section className="operation-lobby"><h4>Solo Compatibility</h4><p>Party operations are temporarily disabled. The weekly boss remains available through the server-owned solo path.</p><button type="button" className="operation-start" disabled={busy || !clanBossActionsAvailable || clan.myAttemptsLeft <= 0} onClick={start}>{busy ? "Starting…" : !clanBossActionsAvailable ? "Assaults paused" : clan.myAttemptsLeft > 0 ? `Start Solo Assault (${clan.myAttemptsLeft} left)` : "No assaults left this week"}</button></section> : null}
            {!partyState && partiesUsable ? <div className="operation-error" role="status"><p>The party service is offline. Existing combat remains recoverable; party changes are paused.</p><button type="button" onClick={() => void load()}>Retry Party Service</button></div> : null}

            <div className="operation-preparation">
                <h4>Preparation Loop</h4>
                <p>Hunts supply materials → the existing Crafter makes pills, smoke bombs, and potions → the Tower engine seals and consumes equipped supplies → server contribution credits damage, healing, shielding, cleanses, objectives, and survival.</p>
            </div>

            <p className="hint operation-score-note">Your clan has removed <strong>{clan.damageDealt.toLocaleString()}</strong> HP with <strong>{clan.participants}</strong> participating member{clan.participants === 1 ? "" : "s"}. This authored boss uses <strong>{boss?.mechanic}</strong> mechanics. Most assaults are expected to chip the persistent pool; active support and objective play qualify for threshold rewards without competing against damage dealers.</p>
            <p className="hint operation-score-note">Operation settlement applies profession XP, clan points, and sector pressure immediately. Qualified personal Ryo and Fate Shards are paid once by the existing weekly settlement after the campaign ends.</p>

            <h4>Clan Standings</h4>
            {!view.standings?.length ? <p className="hint">No clan has struck yet.</p> : <div className="operation-standings">{view.standings.map((standing) => <div key={standing.clanName} className={standing.clanName === clan.clanName ? "is-mine" : ""}><span>#{standing.rank}</span><strong>{standing.clanName}{standing.killed ? " · cleared" : ""}</strong><span>{standing.score.toLocaleString()} pts</span></div>)}</div>}
        </div>
    );
}
