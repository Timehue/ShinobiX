/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity -- polling a server-owned operation projection; Date.now drives display-only countdowns. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClanBossPartyEnvelope } from "../../../shared/clan-boss-operation";
import type { Character, BattleHistoryEntry, VersionedCharacterCommit } from "../types/character";
import { fetchMyRun, type TowerHostLoadout, type TowerSession } from "../lib/towers-api";
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

    const load = useCallback(async () => {
        const [nextView, nextParty] = await Promise.all([fetchClanBoss(character.name), fetchClanBossParty(character.name)]);
        if (!nextView) {
            setLoadState("error");
            return;
        }
        setView(nextView);
        if (nextParty) setPartyState(nextParty);
        setLoadState("ready");
    }, [character.name]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        const poll = () => fetchClanBossParty(character.name).then((next) => { if (next) setPartyState(next); });
        return visiblePoll(poll, 4_000);
    }, [character.name]);

    useEffect(() => {
        if (fight) return;
        let alive = true;
        const check = () => fetchMyRun(character.name)
            .then((run) => { if (alive) setPendingRun(run?.runId.startsWith("cboss-") ? run : null); })
            .catch(() => undefined);
        void check();
        const stop = visiblePoll(check, 4_000);
        return () => { alive = false; stop(); };
    }, [character.name, fight]);

    const act: ClanBossPartyAction = useCallback((action, extras = {}) => {
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
    }, [character.name, partyState]);

    const start = useCallback(() => {
        const party = partyState?.party;
        const soloCompatibility = partyState?.errorCode === "parties-disabled";
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
    }, [busy, character.name, hostLoadout, load, partyState?.errorCode, partyState?.party, playerSlug]);

    if (fight) {
        return (
            <div className="clan-boss-operation-fight">
                <ClanBossOperationComms party={partyState?.party ?? null} onAction={act} />
                <BattleTowerFight
                    character={character}
                    sharedImages={sharedImages}
                    hostLoadout={hostLoadout}
                    runId={fight.runId}
                    initialSession={fight.session}
                    onRecordBattle={onRecordBattle}
                    settleFn={settleClanBossAssault}
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
    const soloCompatibility = partyState?.errorCode === "parties-disabled";

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

            {!clan.killed && partyState && !soloCompatibility ? <ClanBossPartyLobby envelope={partyState} playerSlug={playerSlug} clanmates={clanmates} busy={busy} onAction={act} onStart={start} /> : null}
            {!clan.killed && soloCompatibility ? <section className="operation-lobby"><h4>Solo Compatibility</h4><p>Party operations are temporarily disabled. The weekly boss remains available through the server-owned solo path.</p><button type="button" className="operation-start" disabled={busy || clan.myAttemptsLeft <= 0} onClick={start}>{busy ? "Starting…" : clan.myAttemptsLeft > 0 ? `Start Solo Assault (${clan.myAttemptsLeft} left)` : "No assaults left this week"}</button></section> : null}
            {!partyState ? <div className="operation-error" role="status"><p>The party service is offline. Existing combat remains recoverable; party changes are paused.</p><button type="button" onClick={() => void load()}>Retry Party Service</button></div> : null}

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
