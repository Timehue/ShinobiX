import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { getAllTileCards } from "../data/tile-cards";
import {
    buildChronicleDeck,
    displayCardsById,
    type ChronicleActionIntent,
    type ChronicleProjection,
} from "../lib/chronicle-duel";
import { chronicleDuelistAvatar } from "../lib/chronicle-duelist-art";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import { gameConfirm } from "../components/GameAlert";
import "../styles/chronicle-duel.css";

export interface CardClashDuelConfig {
    stashKey: string;
    endpoint: string;
    title: string;
    backScreen: Screen;
    backLabel: string;
    emptyTitle: string;
    emptyNote: string;
    emptyBackLabel: string;
    awaitingNote: string;
    forfeitConfirm: string;
    doneNote: (won: boolean, draw: boolean) => string;
    autoJoin?: boolean;
}

const CLAN_WAR_DUEL_CONFIG: CardClashDuelConfig = {
    stashKey: "clanWarChallenge.v1", endpoint: "/api/clan/war/tilecards", title: "Clan War Chronicle Showdown",
    backScreen: "shinobiCouncil", backLabel: "Back to Council", emptyTitle: "No active clan-war showdown",
    emptyNote: "The duel context was lost. Return to the Shinobi Council Hall.", emptyBackLabel: "Back to Council Hall",
    awaitingNote: "Waiting for the opposing clan's challenger to join.", forfeitConfirm: "Forfeit the showdown? Your clan takes the authoritative loss.",
    doneNote: (_won, draw) => draw ? "No war damage on a technical draw." : "Clan-war damage was applied once by the server.",
};

export function CardClashDuelScreen({ character, setScreen, config, sharedImages = {} }: { character: Character; setScreen: (screen: Screen) => void; config: CardClashDuelConfig; sharedImages?: Record<string, string> }) {
    const [view, setView] = useState<ChronicleProjection | null>(null);
    const [waiting, setWaiting] = useState(true);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [pageVisible, setPageVisible] = useState(
        () => typeof document === "undefined" || document.visibilityState === "visible",
    );
    const joined = useRef(false);
    const cardsById = useMemo(() => displayCardsById(getAllTileCards([])), []);
    const deck = useMemo(() => buildChronicleDeck(character.cardClashDeck ?? [], character.tileCards ?? []), [character.cardClashDeck, character.tileCards]);
    const stash = useMemo(() => {
        try { const raw = sessionStorage.getItem(config.stashKey); return raw ? JSON.parse(raw) as Record<string, string> : null; }
        catch { return null; }
    }, [config.stashKey]);

    const post = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
        if (!stash) return null;
        const response = await fetch(config.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...stash, ...extra }) });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `Showdown request failed (${response.status}).`);
        if (body.session?.rulesVersion && body.session?.p1) { setView(body.session as ChronicleProjection); setWaiting(false); }
        else { setWaiting(true); }
        return body;
    }, [config.endpoint, stash]);

    useEffect(() => {
        if (!stash || joined.current) return;
        joined.current = true;
        void post("join", { deck }).catch((reason) => setError(String((reason as Error).message)));
    }, [deck, post, stash]);

    useEffect(() => {
        const syncVisibility = () => setPageVisible(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", syncVisibility);
        return () => document.removeEventListener("visibilitychange", syncVisibility);
    }, []);

    useEffect(() => {
        if (!stash) return;
        const refresh = () => void post("state").catch((reason) => setError(String((reason as Error).message)));
        const shouldPoll = pageVisible && (waiting || !view || (view.status === "active" && (view.activePlayer !== view.viewerSide || Boolean(view.responseWindow))));
        if (!pageVisible) return;
        refresh();
        if (!shouldPoll) return;
        const timer = window.setInterval(refresh, 3000);
        return () => window.clearInterval(timer);
    }, [pageVisible, post, stash, waiting, view?.activePlayer, view?.responseWindow?.id, view?.status, view?.viewerSide]);

    useEffect(() => {
        if (view?.status === "complete") try { sessionStorage.removeItem(config.stashKey); } catch { /* storage disabled */ }
    }, [config.stashKey, view?.status]);

    async function action(intent: ChronicleActionIntent) {
        if (busy) return;
        if (intent.action === "forfeit" && !(await gameConfirm(config.forfeitConfirm))) return;
        setBusy(true); setError("");
        try { await post(intent.action, intent as unknown as Record<string, unknown>); }
        catch (reason) { setError(String((reason as Error).message)); }
        setBusy(false);
    }

    if (!stash) return <main className="chronicle-shell"><section className="chronicle-panel"><h2>{config.emptyTitle}</h2><p>{config.emptyNote}</p><button onClick={() => setScreen(config.backScreen)}>{config.emptyBackLabel}</button></section></main>;
    const mySide = view?.viewerSide;
    const won = Boolean(view && mySide && view.winner === mySide);
    const draw = view?.winner === "draw";
    const opponentSide = view ? (view.viewerSide === "p1" ? "p2" : "p1") : null;
    const opponentName = view && opponentSide ? view[opponentSide].name : "";
    const playerAvatar = character.avatarImage || sharedImages[`avatar:${character.name.toLowerCase()}`];
    const opponentAvatar = chronicleDuelistAvatar(opponentName, sharedImages);
    return <main className="chronicle-shell"><header className="chronicle-header"><button onClick={() => setScreen(config.backScreen)}>{config.backLabel}</button><h1>Shinobi Chronicle Showdown<small>{config.title}</small></h1></header>{error ? <div className="chronicle-error" role="alert">{error}</div> : null}{waiting || !view ? <section className="chronicle-panel"><h2>Preparing the table</h2><p>{config.awaitingNote}</p><p>The server is validating both 40-card decks and will choose the first player.</p></section> : <>{view.status === "complete" ? <section className="chronicle-panel" style={{ marginBottom: 12, textAlign: "center" }}><h2>{draw ? "Technical Draw" : won ? "Victory" : "Defeat"}</h2><p>{config.doneNote(won, draw)}</p></section> : null}<ChronicleDuelBoard state={view} cardsById={cardsById} playerAvatar={playerAvatar} opponentAvatar={opponentAvatar} busy={busy} timedTurns error={error} onAction={(intent) => void action(intent)} /></>}</main>;
}

export function ClanWarTileCardDuel({ character, setScreen, sharedImages = {} }: { character: Character; setScreen: (screen: Screen) => void; sharedImages?: Record<string, string> }) {
    return <CardClashDuelScreen character={character} setScreen={setScreen} config={CLAN_WAR_DUEL_CONFIG} sharedImages={sharedImages} />;
}
