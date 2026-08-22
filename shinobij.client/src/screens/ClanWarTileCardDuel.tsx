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
import {
  acceptChronicleResponse,
  beginChronicleRequest,
  chronicleNextStateRefreshMs,
  createChronicleRequestOrder,
} from "../lib/chronicle-pvp-refresh";
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
  stashKey: "clanWarChallenge.v1",
  endpoint: "/api/clan/war/tilecards",
  title: "Clan War Chronicle Showdown",
  backScreen: "shinobiCouncil",
  backLabel: "Back to Council",
  emptyTitle: "No active clan-war showdown",
  emptyNote:
    "The duel context was lost. Return to the Shinobi Council Hall.",
  emptyBackLabel: "Back to Council Hall",
  awaitingNote: "Waiting for the opposing clan's challenger to join.",
  forfeitConfirm:
    "Forfeit the showdown? Your clan takes the authoritative loss.",
  doneNote: (_won, draw) =>
    draw
      ? "No war damage on a technical draw."
      : "Clan-war damage was applied once by the server.",
};

export function CardClashDuelScreen({
  character,
  setScreen,
  config,
  sharedImages = {},
}: {
  character: Character;
  setScreen: (screen: Screen) => void;
  config: CardClashDuelConfig;
  sharedImages?: Record<string, string>;
}) {
  const [view, setView] = useState<ChronicleProjection | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped by every poll tick so the poll effect re-arms itself. Without it
  // the effect armed exactly ONE timer per dep change — and a "still
  // waiting for the opponent" response (or a failed poll) changes no dep,
  // so polling died after a single tick and the first-arriving player sat
  // on the waiting panel forever while their opponent had already joined.
  const [pollNonce, setPollNonce] = useState(0);
  const [pageVisible, setPageVisible] = useState(
    () =>
      typeof document === "undefined" ||
      document.visibilityState === "visible",
  );
  const joined = useRef(false);
  const actionInFlight = useRef(false);
  const requestOrder = useRef(createChronicleRequestOrder());
  const stateRequestController = useRef<AbortController | null>(null);
  const cardsById = useMemo(
    () => displayCardsById(getAllTileCards([])),
    [],
  );
  const deck = useMemo(
    () =>
      buildChronicleDeck(
        character.cardClashDeck ?? [],
        character.tileCards ?? [],
      ),
    [character.cardClashDeck, character.tileCards],
  );
  const stash = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(config.stashKey);
      return raw ? (JSON.parse(raw) as Record<string, string>) : null;
    } catch {
      return null;
    }
  }, [config.stashKey]);

  const post = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!stash) return null;
      if (action === "state" && actionInFlight.current) return null;
      const requestId = beginChronicleRequest(requestOrder.current);
      let stateController: AbortController | null = null;
      if (action === "state") {
        stateRequestController.current?.abort();
        stateController = new AbortController();
        stateRequestController.current = stateController;
      } else {
        stateRequestController.current?.abort();
        stateRequestController.current = null;
      }
      try {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...stash, ...extra }),
          signal: stateController?.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            body.error ?? `Showdown request failed (${response.status}).`,
          );
        if (!acceptChronicleResponse(requestOrder.current, requestId))
          return body;
        setError("");
        if (body.session?.rulesVersion && body.session?.p1) {
          setView(body.session as ChronicleProjection);
          setWaiting(false);
        } else {
          setWaiting(true);
        }
        return body;
      } catch (reason) {
        if (stateController?.signal.aborted) return null;
        if (acceptChronicleResponse(requestOrder.current, requestId))
          setError(
            reason instanceof Error
              ? reason.message
              : "The showdown server could not be reached.",
          );
        throw reason;
      } finally {
        if (stateRequestController.current === stateController)
          stateRequestController.current = null;
      }
    },
    [config.endpoint, stash],
  );

  useEffect(
    () => () => {
      stateRequestController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!stash || joined.current) return;
    joined.current = true;
    void post("join", { deck }).catch(() => undefined);
  }, [deck, post, stash]);

  useEffect(() => {
    const syncVisibility = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible && !actionInFlight.current)
        void post("state").catch(() => undefined);
    };
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, [post]);

  useEffect(() => {
    if (!stash || !pageVisible || busy) return;
    const delay = chronicleNextStateRefreshMs(view, waiting);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      // Re-arm AFTER the request settles, not before it starts. `finally` still
      // runs on a no-op "awaiting-p2" response or a transient failure, so the
      // chain survives exactly as it was meant to — but the next tick can no
      // longer be scheduled while this one is still in flight. That mattered:
      // chronicleNextStateRefreshMs floors at 100ms once a turn deadline has
      // passed, so a bump-first re-arm let requests stack up on every client
      // sitting on an un-advanced turn.
      void post("state")
        .catch(() => undefined)
        .finally(() => setPollNonce((nonce) => nonce + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [busy, pageVisible, pollNonce, post, stash, view, waiting]);

  useEffect(() => {
    if (view?.status !== "complete") return;
    try {
      sessionStorage.removeItem(config.stashKey);
    } catch {
      /* storage disabled */
    }
  }, [config.stashKey, view?.status]);

  async function action(intent: ChronicleActionIntent) {
    if (actionInFlight.current) return;
    if (
      intent.action === "forfeit" &&
      !(await gameConfirm(config.forfeitConfirm))
    )
      return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await post(intent.action, intent as unknown as Record<string, unknown>);
    } catch {
      // post() surfaces only the newest request failure.
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function leaveTable() {
    if (
      view?.status === "active" &&
      !(await gameConfirm(
        "Leave this table? The authoritative turn clock will keep running, and you can return while the match remains active.",
      ))
    )
      return;
    setScreen(config.backScreen);
  }

  if (!stash)
    return (
      <main className="chronicle-shell">
        <section className="chronicle-panel">
          <h2>{config.emptyTitle}</h2>
          <p>{config.emptyNote}</p>
          <button onClick={() => setScreen(config.backScreen)}>
            {config.emptyBackLabel}
          </button>
        </section>
      </main>
    );

  const mySide = view?.viewerSide;
  const won = Boolean(view && mySide && view.winner === mySide);
  const draw = view?.winner === "draw";
  const opponentSide = view
    ? view.viewerSide === "p1"
      ? "p2"
      : "p1"
    : null;
  const opponentName = view && opponentSide ? view[opponentSide].name : "";
  const playerAvatar =
    character.avatarImage ||
    sharedImages[`avatar:${character.name.toLowerCase()}`];
  const opponentAvatar = chronicleDuelistAvatar(
    opponentName,
    sharedImages,
  );

  return (
    <main
      className={`chronicle-shell ${view?.status === "active" ? "chronicle-shell--duel-active" : ""}`}
    >
      <header className="chronicle-header">
        <button onClick={() => void leaveTable()}>{config.backLabel}</button>
        <h1>
          Shinobi Chronicle Showdown
          <small>{config.title}</small>
        </h1>
      </header>
      {error && (!view || waiting) ? (
        <div className="chronicle-error" role="alert">
          {error}
        </div>
      ) : null}
      {waiting || !view ? (
        <section className="chronicle-panel" aria-live="polite">
          <h2>Preparing the table</h2>
          <p>{config.awaitingNote}</p>
          <p>
            The server is validating both 40-card decks and will choose the
            first player.
          </p>
        </section>
      ) : (
        <>
          {view.status === "complete" ? (
            <section
              className="chronicle-panel"
              style={{ marginBottom: 12, textAlign: "center" }}
            >
              <h2>
                {draw ? "Technical Draw" : won ? "Victory" : "Defeat"}
              </h2>
              <p>{config.doneNote(won, draw)}</p>
            </section>
          ) : null}
          <ChronicleDuelBoard
            state={view}
            cardsById={cardsById}
            playerAvatar={playerAvatar}
            opponentAvatar={opponentAvatar}
            busy={busy}
            timedTurns
            error={error}
            onExit={() => void leaveTable()}
            exitLabel={config.backLabel}
            onAction={(intent) => void action(intent)}
          />
        </>
      )}
    </main>
  );
}

export function ClanWarTileCardDuel({
  character,
  setScreen,
  sharedImages = {},
}: {
  character: Character;
  setScreen: (screen: Screen) => void;
  sharedImages?: Record<string, string>;
}) {
  return (
    <CardClashDuelScreen
      character={character}
      setScreen={setScreen}
      config={CLAN_WAR_DUEL_CONFIG}
      sharedImages={sharedImages}
    />
  );
}
