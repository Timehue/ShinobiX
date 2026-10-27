import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import { CardClashDuel } from "../screens/CardClashDuel";
import {
    KEEPER_BOONS,
    KEEPER_PATH_ACTS,
    KEEPER_PATH_CHRONICLE_POINTS,
    KEEPER_PATH_RESOLVE,
    keeperNode,
    keeperReachableNodes,
    type KeeperBoonId,
    type KeeperNode,
    type KeeperPathRecord,
} from "../../../shared/keeper-path-contract";

type KeeperReply = { keeperPath?: KeeperPathRecord; character?: Character; _saveVersion?: number; error?: string };

/** Keeper's Path transport. The server owns the run; only ids travel. */
async function keeperRunRequest(playerName: string, action: string, extra: Record<string, unknown> = {}): Promise<KeeperReply> {
    try {
        const response = await fetch("/api/card-clash/keeper-run", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, action, ...extra }),
        });
        const body = await response.json().catch(() => ({})) as KeeperReply;
        return response.ok && body.keeperPath ? body : { error: body.error ?? "The path could not be reached." };
    } catch {
        return { error: "The path could not be reached." };
    }
}

const RESUME_KEY = "keeperPathMatch.v1";
function readResume(): string | null {
    try { return window.sessionStorage.getItem(RESUME_KEY); } catch { return null; }
}
function writeResume(matchId: string | null): void {
    try {
        if (matchId) window.sessionStorage.setItem(RESUME_KEY, matchId);
        else window.sessionStorage.removeItem(RESUME_KEY);
    } catch { /* Storage may be disabled; the server keeps the duel either way. */ }
}

const KIND_LABEL: Record<KeeperNode["kind"], string> = { fight: "Duel", elite: "Elite duel", shrine: "Shrine", boss: "Keeper" };

/**
 * Keeper's Path (Card Hall, Play): a seeded three-act run of Keeper duels with
 * boons between them. Every rule and reward is the server's; this view shows
 * the map, sends the chosen node or boon, and hosts the duel.
 */
export function KeeperPath({ character, creatorCards, deck, onVersionedCharacter, onClose }: {
    character: Character;
    creatorCards: TileCard[];
    deck: string[];
    onVersionedCharacter?: (character: Character, saveVersion: number) => boolean;
    onClose: () => void;
}) {
    const [record, setRecord] = useState<KeeperPathRecord | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [fighting, setFighting] = useState(false);

    const send = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
        setBusy(true);
        setError("");
        const reply = await keeperRunRequest(character.name, action, extra);
        setBusy(false);
        if (reply.error || !reply.keeperPath) { setError(reply.error ?? "The path could not be reached."); return null; }
        if (reply.character && reply._saveVersion) onVersionedCharacter?.(reply.character, reply._saveVersion);
        setRecord(reply.keeperPath);
        return reply.keeperPath;
    }, [character.name, onVersionedCharacter]);

    useEffect(() => {
        const timer = window.setTimeout(() => void send("state"), 0);
        return () => window.clearTimeout(timer);
    }, [send]);

    const run = record?.run ?? null;
    const current = run ? keeperNode(run, run.current) : null;
    if (fighting && current?.opponent) {
        const back = () => { writeResume(null); setFighting(false); void send("state"); };
        // A reload mid-duel rejoins that duel; starting a new one would forfeit it.
        const resumeMatchId = readResume() ?? undefined;
        return <CardClashDuel character={character} creatorCards={creatorCards}
            keeperRun={{ label: `Act ${current.act + 1} · ${KIND_LABEL[current.kind]} · ${current.opponent.name}`, opponentName: current.opponent.name, resumeMatchId }}
            onMatchStarted={(matchId) => writeResume(matchId)}
            onVersionedCharacter={onVersionedCharacter} onDungeonWin={back} onDungeonLose={back} onDungeonDraw={back} onDungeonLeave={() => { setFighting(false); void send("state"); }} />;
    }

    const reachable = new Set(run ? keeperReachableNodes(run).map((node) => node.id) : []);
    const live = run?.status === "active";
    const choose = async (node: KeeperNode) => {
        const next = await send("choose-node", { nodeId: node.id });
        if (next?.run?.current === node.id) setFighting(true);
    };

    return <section className="chronicle-panel" aria-label="Keeper's Path">
        <h2>Keeper's Path</h2>
        <p>Three acts of Keeper duels with your saved deck. Pick a route through each act: duels, harder Elites that restore Resolve, or Shrines that grant a boon for the rest of the run. Each loss costs one Resolve, and the run ends when the last one is gone.</p>
        <p>A full run pays {KEEPER_PATH_CHRONICLE_POINTS} Chronicle Points once a day. Runs completed: {record?.clears ?? 0} · most duels won in a run: {record?.best ?? 0}.</p>
        {error ? <div className="chronicle-error" role="alert">{error}</div> : null}
        {live && run ? <>
            <p role="status"><strong>Resolve {run.resolve} / {KEEPER_PATH_RESOLVE}</strong> · duels won {run.wins}
                {Object.entries(run.boons).filter(([, count]) => count).map(([id, count]) => ` · ${KEEPER_BOONS[id as KeeperBoonId].name}${count! > 1 ? ` x${count}` : ""}`).join("")}</p>
            {run.boonOffer ? <div className="chronicle-toolbar" role="group" aria-label="Choose a boon">
                {run.boonOffer.map((id) => <button key={id} type="button" disabled={busy} onClick={() => void send("choose-boon", { boonId: id })}>
                    <strong>{KEEPER_BOONS[id].name}</strong> {KEEPER_BOONS[id].text}</button>)}
            </div> : null}
            {current?.opponent ? <p><button type="button" disabled={busy} onClick={() => setFighting(true)}>Duel {current.opponent.name}, {current.opponent.title}</button></p> : null}
            {Array.from({ length: KEEPER_PATH_ACTS }, (_, act) => {
                const nodes = run.nodes.filter((node) => node.act === act);
                if (!nodes.some((node) => reachable.has(node.id) || node.id === run.current || node.id === run.position)) return null;
                const rows = [...new Set(nodes.map((node) => node.row))];
                return <div key={act}>
                    <h3>Act {act + 1}</h3>
                    {rows.map((row) => <div key={row} className="chronicle-toolbar">
                        {nodes.filter((node) => node.row === row).map((node) => <button key={node.id} type="button"
                            aria-pressed={node.id === run.position || node.id === run.current}
                            disabled={busy || !reachable.has(node.id)} onClick={() => void choose(node)}>
                            <strong>{KIND_LABEL[node.kind]}</strong>{node.opponent ? ` ${node.opponent.name} (${node.opponent.difficulty})` : " Choose a boon"}
                        </button>)}
                    </div>)}
                </div>;
            })}
            <button type="button" disabled={busy} onClick={() => void send("abandon")}>Abandon the run</button>
        </> : <>
            {run?.status === "won" ? <p role="status"><strong>The path is yours.</strong> Every Keeper fell in that run.</p> : null}
            {run?.status === "lost" ? <p role="status">The last run ended after {run.wins} duel{run.wins === 1 ? "" : "s"} won.</p> : null}
            <button type="button" disabled={busy || !record} onClick={() => void send("start", { deck })}>{busy ? "Drawing the path…" : "Begin a new run"}</button>
        </>}
        <button type="button" style={{ marginLeft: 8 }} onClick={onClose}>Back to the Hall</button>
    </section>;
}
