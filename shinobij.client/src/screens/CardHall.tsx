import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import "../styles/chronicle-duel.css";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FOUNDING_FORMAT,
  CHRONICLE_ELEMENTS,
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  MAIN_DECK_SIZE,
  MAX_COPIES_PER_CARD,
  buildChronicleDeck,
  canAddChronicleCard,
  chronicleAiAction,
  displayCardsById,
  getChronicleCard,
  ownedChronicleCounts,
  startChronicleAi,
  validateOwnedChronicleDeck,
  type ChronicleAiResult,
  type ChronicleAiDifficulty,
  type ChronicleDisplayCard,
  type ChronicleProjection,
} from "../lib/chronicle-duel";
import { getAllTileCards } from "../data/tile-cards";
import { cardGameLockStatus } from "../lib/chronicle-lock";
import { chronicleDuelistAvatar } from "../lib/chronicle-duelist-art";
import { ChronicleCardView } from "../components/ChronicleCardView";
import { ChronicleCardInspector } from "../components/ChronicleCardInspector";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import { CardClashTutorial } from "../components/CardClashTutorial";
import {
  advanceFreePlayQueueAuthority,
  FreePlayQueueError,
  freePlayQueueAuthorityIsCurrent,
  freePlayPollOutcome,
  normalizeFreePlayQueueAccount,
  requestFreePlayQueue,
  type FreePlayQueueAuthority,
} from "../lib/free-play-queue-client";
import { syncChronicleProgression } from "../lib/chronicle-progression-sync";
import { chronicleResponseAuthority } from "../lib/chronicle-response-authority";

type Tab = "collection" | "deck" | "play" | "pvp" | "rules";
type AiDuelState = NonNullable<ChronicleAiResult["session"]>;

// Pacing beats between the Chronicle Keeper's replayed moves: a full beat when
// the step landed a new log line, a quiet beat for silent phase bookkeeping.
const AI_STEP_BEAT_MS = 1_250;
const AI_STEP_QUIET_MS = 650;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Per-tab pointer at the live AI duel so a refresh can offer "Resume" —
// the server keeps the session in KV and answers action:"state".
const CHRONICLE_AI_RESUME_KEY = "chronicleAiMatch.v1";
function readResumableMatch(): string | null {
  try {
    return window.sessionStorage.getItem(CHRONICLE_AI_RESUME_KEY);
  } catch {
    return null;
  }
}

function chronicleRecordSource(cardId: string): string {
  if (cardId.startsWith("legacy-")) return "Legacy awakening";
  if (cardId.startsWith("pet-witness-")) return "Companion witness";
  if (cardId === "story-wandering-sage") return "Wandering Sage encounter";
  if (cardId.startsWith("story-")) return "Story victory";
  return "Witnessed deed";
}

type CardHallProps = {
  character: Character;
  updateCharacter: (character: Character) => void;
  creatorCards: TileCard[];
  onBack: () => void;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onStartFreePlay?: (matchId: string) => void;
  /** Return false when a newer mutation version has already been adopted. */
  onServerVersion?: (version?: number) => boolean | void;
  onVersionedCharacter?: VersionedCharacterCommit;
  sharedImages?: Record<string, string>;
};

/** Gate: the hall is sealed until the Chronicle Scribe event hands over the
 *  traveler's codex. A separate outer component (zero hooks) so the inner
 *  hall mounts fresh on unlock and its autoStart/queue effects never run
 *  while locked. The server enforces the same lock on duels/queue/packs. */
export function CardHall(props: CardHallProps) {
  const lock = cardGameLockStatus(props.character);
  const { autoStart, onAutoStartConsumed } = props;
  // A deep-link autoStart that arrives while locked must not survive to fire
  // a surprise duel on the first unlocked visit — consume it here.
  useEffect(() => {
    if (lock.locked && autoStart) onAutoStartConsumed?.();
  }, [lock.locked, autoStart, onAutoStartConsumed]);
  if (!lock.locked) return <CardHallInner {...props} />;
  return (
    <div style={{ maxWidth: 560, margin: "48px auto 0", padding: "0 16px", textAlign: "center" }}>
      <div style={{ fontSize: "2.6rem", marginBottom: 8 }} aria-hidden="true">🎴</div>
      <h2 style={{ margin: "0 0 10px" }}>{lock.title}</h2>
      <p style={{ color: "#9aa3b2", lineHeight: 1.55, fontSize: ".95rem", margin: "0 0 20px" }}>{lock.body}</p>
      <button onClick={props.onBack}>Back</button>
    </div>
  );
}

function CardHallInner({
  character,
  updateCharacter,
  creatorCards,
  onBack,
  autoStart = false,
  onAutoStartConsumed,
  onStartFreePlay,
  onServerVersion,
  onVersionedCharacter,
  sharedImages = {},
}: CardHallProps) {
  const sourceCards = useMemo(
    () => getAllTileCards(creatorCards),
    [creatorCards],
  );
  const cardsById = useMemo(() => displayCardsById(sourceCards), [sourceCards]);
  const ownedCounts = useMemo(
    () => ownedChronicleCounts(character.tileCards ?? []),
    [character.tileCards],
  );
  const ownedIds = useMemo(() => [...ownedCounts.keys()], [ownedCounts]);
  const ownedCards = useMemo(
    () => ownedIds.flatMap((id) => (cardsById[id] ? [cardsById[id]] : [])),
    [ownedIds, cardsById],
  );
  const savedDeck = useMemo(
    () => character.cardClashDeck ?? [],
    [character.cardClashDeck],
  );
  const savedValid = useMemo(
    () => validateOwnedChronicleDeck(savedDeck, ownedCounts).valid,
    [savedDeck, ownedCounts],
  );
  const migratedDeck = useMemo(
    () => buildChronicleDeck(savedDeck, character.tileCards ?? []),
    [savedDeck, character.tileCards],
  );
  const [deck, setDeck] = useState<string[]>(() =>
    savedValid ? [...savedDeck] : migratedDeck,
  );
  const [tab, setTab] = useState<Tab>(autoStart ? "play" : "collection");
  const [showTutorial, setShowTutorial] = useState(
    () =>
      Number(character.cardClashTutorialVersion ?? 0) < CHRONICLE_RULES_VERSION,
  );
  const [matchId, setMatchId] = useState<string | null>(null);
  const [duel, setDuel] = useState<AiDuelState | null>(null);
  const [aiDifficulty, setAiDifficulty] =
    useState<ChronicleAiDifficulty>("medium");
  const [reward, setReward] = useState<ChronicleAiResult["reward"]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiActing, setAiActing] = useState(false);
  const [progressionReceipt, setProgressionReceipt] = useState<string[]>([]);
  const [progressionSyncError, setProgressionSyncError] = useState("");
  const [resumableMatchId, setResumableMatchId] = useState<string | null>(
    readResumableMatch,
  );
  const autoStarted = useRef(false);
  const progressionSyncedForRef = useRef("");
  const activeProgressionPlayerRef = useRef(character.name.trim().toLowerCase());
  const progressionVersionHandlerRef = useRef(onServerVersion);
  const progressionVersionedCharacterHandlerRef = useRef(onVersionedCharacter);
  const progressionCharacterHandlerRef = useRef(updateCharacter);
  const progressionReceiptRef = useRef<HTMLElement>(null);
  const collectionTabRef = useRef<HTMLButtonElement>(null);
  const replayToken = useRef(0);
  const cardHallMountedRef = useRef(false);
  useLayoutEffect(() => {
    cardHallMountedRef.current = true;
    return () => {
      cardHallMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    // Cancel any in-flight AI replay when the hall unmounts.
    return () => {
      replayToken.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    const nextPlayer = character.name.trim().toLowerCase();
    if (activeProgressionPlayerRef.current !== nextPlayer) replayToken.current += 1;
    activeProgressionPlayerRef.current = nextPlayer;
    progressionVersionHandlerRef.current = onServerVersion;
    progressionVersionedCharacterHandlerRef.current = onVersionedCharacter;
    progressionCharacterHandlerRef.current = updateCharacter;
  }, [character.name, onServerVersion, onVersionedCharacter, updateCharacter]);

  useEffect(() => {
    const playerName = character.name;
    const syncKey = playerName.trim().toLowerCase();
    if (!syncKey || progressionSyncedForRef.current === syncKey) return;
    progressionSyncedForRef.current = syncKey;
    let alive = true;
    void syncChronicleProgression(playerName)
      .then((result) => {
        // A Card Hall unmount, account switch, or superseding character render
        // invalidates this response before it can advance the account-scoped
        // save version or announce an authoritative grant.
        if (!alive || activeProgressionPlayerRef.current !== syncKey) return;
        // Adopt the server version before painting its full authoritative
        // character, matching other versioned mutation screens.
        const versionedHandler = progressionVersionedCharacterHandlerRef.current;
        const versionAccepted = versionedHandler
          ? versionedHandler(result.character, result._saveVersion)
          : progressionVersionHandlerRef.current?.(result._saveVersion) !== false;
        if (!versionAccepted) return;
        if (!versionedHandler) progressionCharacterHandlerRef.current(result.character);
        if (result.granted.length) setProgressionReceipt(result.granted);
      })
      .catch((syncError) => {
        if (alive) setProgressionSyncError(syncError instanceof Error ? syncError.message : "The Living Chronicle could not be refreshed.");
      });
    return () => { alive = false; };
  }, [character.name]);

  useEffect(() => {
    if (!progressionReceipt.length) return;
    const frame = window.requestAnimationFrame(() => progressionReceiptRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [progressionReceipt.length]);

  function syncResumableMatch(nextMatchId: string | null) {
    setResumableMatchId(nextMatchId);
    try {
      if (nextMatchId)
        window.sessionStorage.setItem(CHRONICLE_AI_RESUME_KEY, nextMatchId);
      else window.sessionStorage.removeItem(CHRONICLE_AI_RESUME_KEY);
    } catch {
      /* private mode — resume just won't survive a refresh */
    }
  }

  /** Sync the authoritative result immediately, then show the Keeper's moves
   *  one beat at a time. Settlement (ryo, W/L, save version) must never wait
   *  on — or be skipped by — an interrupted animation. */
  async function presentSession(result: ChronicleAiResult, originatingPlayerName: string) {
    const final = result.session;
    if (!final) return;
    const carriesAuthoritativeSnapshot = Boolean(
      result.character || result.reward || typeof result._saveVersion === "number",
    );
    const authority = chronicleResponseAuthority({
      mounted: cardHallMountedRef.current,
      activePlayerName: activeProgressionPlayerRef.current,
      originatingPlayerName,
      responsePlayerName: result.character?.name,
      carriesAuthoritativeSnapshot,
      saveVersion: result._saveVersion,
      onServerVersion: (version) => result.character && progressionVersionedCharacterHandlerRef.current
        ? progressionVersionedCharacterHandlerRef.current(result.character, version)
        : progressionVersionHandlerRef.current?.(version),
    });
    if (authority === "discard") return;
    if (authority === "authoritative") {
      if (result.reward) setReward(result.reward);
      if (result.character && !progressionVersionedCharacterHandlerRef.current) progressionCharacterHandlerRef.current(result.character);
    }
    syncResumableMatch(final.status === "complete" ? null : final.matchId);
    const steps = result.aiSteps ?? [];
    const token = ++replayToken.current;
    if (steps.length > 0) {
      setAiActing(true);
      let previous: Pick<ChronicleProjection, "log"> | null = duel;
      for (const step of steps) {
        setDuel({ ...final, ...step });
        const newLine = step.log.at(-1) !== previous?.log.at(-1);
        await sleep(newLine ? AI_STEP_BEAT_MS : AI_STEP_QUIET_MS);
        if (replayToken.current !== token) return;
        previous = step;
      }
      setAiActing(false);
    }
    setDuel(final);
  }

  /** Reload an interrupted duel from the server (action:"state"). */
  async function resumeShowdown() {
    if (!resumableMatchId || busy) return;
    const originatingPlayerName = character.name;
    setBusy(true);
    setError("");
    setReward(undefined);
    // busy belongs to this mounted component, not to one account: an in-place
    // account switch must still release "Preparing showdown…". The authority
    // check already discards the stale response's data.
    try {
      const result = await chronicleAiAction(resumableMatchId, {
        action: "state",
      });
      if (chronicleResponseAuthority({
        mounted: cardHallMountedRef.current,
        activePlayerName: activeProgressionPlayerRef.current,
        originatingPlayerName,
        responsePlayerName: result.character?.name,
        carriesAuthoritativeSnapshot: false,
      }) === "discard") return;
      if (!result.ok || !result.session) {
        syncResumableMatch(null);
        setError(result.error ?? "That showdown has expired.");
        return;
      }
      setMatchId(resumableMatchId);
      await presentSession(result, originatingPlayerName);
    } catch {
      if (cardHallMountedRef.current) setError("The showdown could not be resumed. Try again.");
    } finally {
      if (cardHallMountedRef.current) setBusy(false);
    }
  }
  const deckDirty = JSON.stringify(deck) !== JSON.stringify(savedDeck);
  const deckCheck = useMemo(
    () => validateOwnedChronicleDeck(deck, ownedCounts),
    [deck, ownedCounts],
  );

  async function begin(
    deckIds = savedValid ? savedDeck : migratedDeck,
    difficulty = aiDifficulty,
  ) {
    if (busy) return;
    const originatingPlayerName = character.name;
    setBusy(true);
    setError("");
    setReward(undefined);
    try {
      const result = await startChronicleAi(
        originatingPlayerName,
        deckIds,
        difficulty,
      );
      if (chronicleResponseAuthority({
        mounted: cardHallMountedRef.current,
        activePlayerName: activeProgressionPlayerRef.current,
        originatingPlayerName,
        responsePlayerName: result.character?.name,
        carriesAuthoritativeSnapshot: false,
      }) === "discard") return;
      if (!result.ok || !result.matchId || !result.session) {
        setError(result.error ?? "Could not start the showdown.");
        return;
      }
      setMatchId(result.matchId);
      setTab("play");
      await presentSession(result, originatingPlayerName);
    } catch {
      if (cardHallMountedRef.current) setError("Could not start the showdown.");
    } finally {
      if (cardHallMountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void begin(migratedDeck).finally(() => onAutoStartConsumed?.());
    // one-shot wanderer entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function act(intent: Parameters<typeof chronicleAiAction>[1]) {
    if (!matchId || busy) return;
    const originatingPlayerName = character.name;
    setBusy(true);
    setError("");
    try {
      const result = await chronicleAiAction(matchId, intent);
      if (chronicleResponseAuthority({
        mounted: cardHallMountedRef.current,
        activePlayerName: activeProgressionPlayerRef.current,
        originatingPlayerName,
        responsePlayerName: result.character?.name,
        carriesAuthoritativeSnapshot: false,
      }) === "discard") return;
      if (!result.ok || !result.session) {
        setError(result.error ?? "That action was not legal.");
        return;
      }
      await presentSession(result, originatingPlayerName);
    } catch {
      if (cardHallMountedRef.current) setError("That action could not be resolved. Try again.");
    } finally {
      if (cardHallMountedRef.current) setBusy(false);
    }
  }

  function closeTutorial() {
    setShowTutorial(false);
    if (
      Number(character.cardClashTutorialVersion ?? 0) < CHRONICLE_RULES_VERSION
    )
      updateCharacter({
        ...character,
        cardClashTutorialVersion: CHRONICLE_RULES_VERSION,
        cardClashTutorialSeen: true,
      });
  }

  function leaveActiveBoard() {
    replayToken.current += 1;
    setAiActing(false);
    setDuel(null);
    setMatchId(null);
    setReward(undefined);
  }

  return (
    <main
      className={`chronicle-shell ${duel?.status === "active" ? "chronicle-shell--duel-active" : ""}`}
    >
      <header className="chronicle-header">
        <button onClick={onBack}>Back</button>
        <h1>
          Shinobi Chronicle Showdown
          <small>
            {CHRONICLE_ROOM_TITLE} · Rules Version {CHRONICLE_RULES_VERSION}
          </small>
        </h1>
        <span className="chronicle-header__spacer" />
        <span>
          {character.cardClashWins ?? 0}W · {character.cardClashLosses ?? 0}L ·{" "}
          {character.cardClashDraws ?? 0}D
        </span>
        <button
          onClick={() => setShowTutorial(true)}
          aria-label="Open showdown tutorial"
        >
          How to play
        </button>
      </header>
      <p className="chronicle-scribe-note">
        The scribes will tell you straight: our archives kept burning. So we
        print the history on cards now — you can't burn ten thousand pockets.
      </p>
      {progressionReceipt.length ? (
        <section
          ref={progressionReceiptRef}
          className="chronicle-panel chronicle-scribe-note"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-labelledby="living-chronicle-update-title"
          aria-describedby="living-chronicle-update-copy"
          tabIndex={-1}
          style={{ borderColor: "rgba(196, 162, 90, .72)", boxShadow: "0 0 24px rgba(196, 162, 90, .16)" }}
        >
          <small>SCRIBE IHARA · WITNESS PRESS</small>
          <h2 id="living-chronicle-update-title">Living Chronicle updated</h2>
          <p id="living-chronicle-update-copy">
            You completed the deed. A living witness carried it beyond the moment. Ihara has pressed that truth into the Chronicle.
          </p>
          <ul aria-label="Newly recorded Chronicle cards" style={{ textAlign: "left", margin: "10px auto", maxWidth: 560 }}>
            {progressionReceipt.map((id) => (
              <li key={id}>
                <strong>{getChronicleCard(id)?.name ?? id}</strong>
                {" — "}{chronicleRecordSource(id)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setProgressionReceipt([]);
              window.requestAnimationFrame(() => collectionTabRef.current?.focus());
            }}
          >
            View new cards
          </button>
        </section>
      ) : null}
      {progressionSyncError ? <div className="chronicle-error" role="alert">{progressionSyncError} Reopen the Card Hall to retry.</div> : null}
      <nav className="chronicle-tabs" aria-label="Card Hall sections">
        {(
          [
            "collection",
            "deck",
            "play",
            ...(onStartFreePlay ? ["pvp" as const] : []),
            "rules",
          ] as Tab[]
        ).map((item) => (
          <button
            type="button"
            key={item}
            ref={item === "collection" ? collectionTabRef : undefined}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {item === "pvp"
              ? "Free-Play PvP"
              : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "collection" ? <Collection cards={ownedCards} owned={ownedCounts} catalogSize={CHRONICLE_CARD_CATALOG.length} /> : null}
      {tab === "deck" ? (
        <DeckBuilder
          cards={ownedCards}
          cardsById={cardsById}
          owned={ownedCounts}
          deck={deck}
          setDeck={setDeck}
          validation={deckCheck}
          dirty={deckDirty}
          onSave={() =>
            updateCharacter({ ...character, cardClashDeck: [...deck] })
          }
          onMigrate={() => setDeck([...migratedDeck])}
        />
      ) : null}
      {tab === "play" ? (
        duel ? (
          <div>
            {duel.status === "complete" ? (
              <div
                className="chronicle-panel"
                style={{ marginBottom: 12, textAlign: "center" }}
              >
                <h2>
                  {duel.winner === duel.viewerSide
                    ? "Victory"
                    : duel.winner === "draw"
                      ? "Showdown Cancelled"
                      : "Defeat"}
                </h2>
                {reward && reward.ryo > 0 ? (
                  <p>
                    {reward.ryo.toLocaleString()} ryo credited
                    {reward.dailyBonus
                      ? " including the daily victory bonus"
                      : ""}
                    .
                  </p>
                ) : reward ? (
                  <p>
                    Sparring the Chronicle AI pays no ryo — your record has
                    been entered in the Chronicle.
                  </p>
                ) : (
                  <p>The result has been entered in the Chronicle.</p>
                )}
                <button
                  onClick={() => {
                    setDuel(null);
                    setMatchId(null);
                    setReward(undefined);
                  }}
                >
                  Return to Hall
                </button>
                <button
                  onClick={() => void begin()}
                  disabled={busy}
                  style={{ marginLeft: 8 }}
                >
                  Play Again
                </button>
              </div>
            ) : null}
            <ChronicleDuelBoard
              key={matchId ?? "duel"}
              state={duel}
              cardsById={cardsById}
              playerAvatar={
                character.avatarImage ||
                sharedImages[`avatar:${character.name.toLowerCase()}`]
              }
              opponentAvatar={chronicleDuelistAvatar(
                duel[duel.viewerSide === "p1" ? "p2" : "p1"].name,
                sharedImages,
              )}
              busy={busy}
              aiActing={aiActing}
              error={error}
              onExit={leaveActiveBoard}
              exitLabel="Return to Hall"
              onAction={(intent) => void act(intent)}
            />
          </div>
        ) : (
          <div className="chronicle-panel" style={{ textAlign: "center" }}>
            <h2>{CHRONICLE_ROOM_TITLE}</h2>
            <p>
              The founding Shinobi card format — the original card pool and its
              Limited Scroll, six visible turn phases and the opening-turn draw
              rule.
            </p>
            {!savedValid ? (
              <p>
                Your saved deck uses retired rules. The Hall can deal a fixed
                starter deck, or you can review and save the migrated 40-card
                list in Deck Builder.
              </p>
            ) : null}
            <label className="chronicle-toolbar">
              <strong>AI difficulty</strong>
              <select
                value={aiDifficulty}
                onChange={(event) =>
                  setAiDifficulty(event.target.value as ChronicleAiDifficulty)
                }
                disabled={busy}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            {error ? <div className="chronicle-error">{error}</div> : null}
            {resumableMatchId ? (
              <p>
                <button
                  onClick={() => void resumeShowdown()}
                  disabled={busy}
                >
                  Resume Interrupted Showdown
                </button>
              </p>
            ) : null}
            <button onClick={() => void begin()} disabled={busy}>
              {busy ? "Preparing showdown…" : "Start Showdown vs AI"}
            </button>
            <button onClick={() => setTab("deck")} style={{ marginLeft: 8 }}>
              Review Deck
            </button>
          </div>
        )
      ) : null}
      {tab === "pvp" ? (
        <FreePlayQueue key={normalizeFreePlayQueueAccount(character.name)} character={character} onStart={onStartFreePlay} />
      ) : null}
      {tab === "rules" ? <Rules /> : null}
      {showTutorial ? <CardClashTutorial onClose={closeTutorial} /> : null}
    </main>
  );
}

function Collection({
  cards,
  owned,
  catalogSize,
}: {
  cards: ChronicleDisplayCard[];
  /** Copies owned per card id — the Collection is YOUR shelf, not the catalog. */
  owned: ReadonlyMap<string, number>;
  catalogSize: number;
}) {
  const [cardClass, setCardClass] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [monsterTier, setMonsterTier] = useState("all");
  const [element, setElement] = useState("all");
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  const shown = cards.filter(
    (card) =>
      (cardClass === "all" || card.cardClass === cardClass) &&
      (rarity === "all" || card.rarity === rarity) &&
      (monsterTier === "all" ||
        (card.cardClass === "monster" && card.powerTier === monsterTier)) &&
      (element === "all" ||
        (card.cardClass === "monster" && card.element === element)),
  );
  return (
    <section className="chronicle-panel">
      <div className="chronicle-toolbar">
        <strong>{shown.length} cards</strong>
        <span className="chronicle-collection-progress">
          {cards.length} of {catalogSize} in the set
        </span>
        <label>
          Class{" "}
          <select
            value={cardClass}
            onChange={(event) => setCardClass(event.target.value)}
          >
            <option value="all">All</option>
            <option value="monster">Monster</option>
            <option value="magic">Magic</option>
            <option value="trap">Trap</option>
          </select>
        </label>
        <label>
          Element{" "}
          <select
            value={element}
            onChange={(event) => setElement(event.target.value)}
          >
            <option value="all">All</option>
            {CHRONICLE_ELEMENTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Monster tier{" "}
          <select
            value={monsterTier}
            onChange={(event) => setMonsterTier(event.target.value)}
          >
            <option value="all">All</option>
            <option value="weak">Low</option>
            <option value="standard">Medium</option>
            <option value="elite">High / one Tribute</option>
            <option value="boss">Boss / two Tribute</option>
            <option value="mythic">Mythic</option>
          </select>
        </label>
        <label>
          Rarity{" "}
          <select
            value={rarity}
            onChange={(event) => setRarity(event.target.value)}
          >
            <option value="all">All</option>
            <option value="common">Common</option>
            <option value="rare">Rare</option>
            <option value="epic">Epic</option>
            <option value="legendary">Legendary</option>
            <option value="mythic">Mythic</option>
          </select>
        </label>
      </div>
      <div className="chronicle-collection">
        {shown.map((card) => (
          <button
            className="chronicle-card-inspect-trigger"
            key={card.id}
            type="button"
            aria-label={`Inspect ${card.name} — you own ${owned.get(card.id) ?? 0}`}
            onClick={() => setInspected(card)}
          >
            <ChronicleCardView card={card} />
            {/* Copies OWNED. The card foot already prints a number, but that is
                the deck-building limit ("MAX 3") — it reads like inventory and
                isn't, which left the collection with no signal of what you
                actually hold. */}
            <span className="chronicle-owned-badge">×{owned.get(card.id) ?? 0}</span>
          </button>
        ))}
      </div>
      <ChronicleCardInspector
        card={inspected}
        onClose={() => setInspected(null)}
        meta={
          inspected ? `Owned ×${owned.get(inspected.id) ?? 0}` : undefined
        }
      />
    </section>
  );
}

function DeckBuilder({
  cards,
  cardsById,
  owned,
  deck,
  setDeck,
  validation,
  dirty,
  onSave,
  onMigrate,
}: {
  cards: ChronicleDisplayCard[];
  cardsById: Record<string, ChronicleDisplayCard>;
  owned: ReadonlyMap<string, number>;
  deck: string[];
  setDeck: (deck: string[]) => void;
  validation: { valid: boolean; errors: string[] };
  dirty: boolean;
  onSave: () => void;
  onMigrate: () => void;
}) {
  const groups = Object.entries(
    Object.fromEntries(
      [...new Set(deck)].map((id) => [
        id,
        deck.filter((entry) => entry === id).length,
      ]),
    ),
  );
  const counts = {
    monster: deck.filter((id) => getChronicleCard(id)?.cardClass === "monster")
      .length,
    magic: deck.filter((id) => getChronicleCard(id)?.cardClass === "magic")
      .length,
    trap: deck.filter((id) => getChronicleCard(id)?.cardClass === "trap")
      .length,
  };
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  const addCard = (id: string) => {
    if (!canAddChronicleCard(deck, id, owned)) setDeck([...deck, id]);
  };
  return (
    <section className="chronicle-panel chronicle-deck">
      <div>
        <div className="chronicle-toolbar">
          <strong>Your cards</strong>
          <span>
            Tap a card to read it full size, or the + to add a copy. Up to{" "}
            {MAX_COPIES_PER_CARD} copies; iconic advanced cards show their lower
            limit on the frame.
          </span>
        </div>
        <div className="chronicle-collection">
          {cards.map((card) => {
            const inDeck = deck.filter((id) => id === card.id).length;
            const blocked = canAddChronicleCard(deck, card.id, owned);
            return (
              <div className="chronicle-deck-slot" key={card.id}>
                <button
                  className="chronicle-card-inspect-trigger"
                  type="button"
                  aria-label={`Read ${card.name}`}
                  onClick={() => setInspected(card)}
                >
                  <ChronicleCardView card={card} compact />
                </button>
                {inDeck > 0 ? (
                  <span className="chronicle-deck-slot__count">×{inDeck}</span>
                ) : null}
                <button
                  className="chronicle-deck-slot__add"
                  type="button"
                  aria-label={`Add ${card.name} to your deck`}
                  title={blocked ?? "Add to deck"}
                  disabled={Boolean(blocked)}
                  onClick={() => addCard(card.id)}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="chronicle-deck__list">
        <h2>
          {deck.length}/{MAIN_DECK_SIZE}
        </h2>
        <p>
          {counts.monster} Monsters · {counts.magic} Jutsu · {counts.trap} Snares
        </p>
        {groups.map(([id, count]) => (
          <div className="chronicle-deck__row" key={id}>
            <span>{cardsById[id]?.name ?? id}</span>
            <b>×{count}</b>
            <button
              aria-label={`Remove one ${cardsById[id]?.name ?? id}`}
              onClick={() => {
                const index = deck.indexOf(id);
                setDeck([...deck.slice(0, index), ...deck.slice(index + 1)]);
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {!validation.valid ? (
          <div className="chronicle-error">{validation.errors.join(" ")}</div>
        ) : null}
        <button onClick={onSave} disabled={!validation.valid || !dirty}>
          Save Deck
        </button>
        <button onClick={onMigrate}>Restore Migrated Deck</button>
        <button onClick={() => setDeck([])}>Clear</button>
      </aside>
      <ChronicleCardInspector
        card={inspected}
        onClose={() => setInspected(null)}
        meta={
          inspected
            ? `In deck ×${deck.filter((id) => id === inspected.id).length} · owned ×${owned.get(inspected.id) ?? 0}`
            : undefined
        }
        actions={
          inspected ? (
            <button
              className="primary"
              type="button"
              disabled={Boolean(canAddChronicleCard(deck, inspected.id, owned))}
              title={
                canAddChronicleCard(deck, inspected.id, owned) ?? "Add to deck"
              }
              onClick={() => addCard(inspected.id)}
            >
              Add to Deck
            </button>
          ) : null
        }
      />
    </section>
  );
}

type FreePlayQueueLease = {
  authority: FreePlayQueueAuthority;
  owned: boolean;
  matched: boolean;
  pollBusy: boolean;
  controllers: Set<AbortController>;
};

function FreePlayQueue({
  character,
  onStart,
}: {
  character: Character;
  onStart?: (matchId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const [activeAuthority] = useState<FreePlayQueueAuthority>(() =>
    advanceFreePlayQueueAuthority({ accountKey: "", generation: 0 }, character.name),
  );
  const leaseRef = useRef<FreePlayQueueLease | null>(null);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  const leaseIsCurrent = useCallback((lease: FreePlayQueueLease): boolean => mountedRef.current
    && leaseRef.current === lease
    && freePlayQueueAuthorityIsCurrent(activeAuthority, lease.authority), [activeAuthority]);
  const leaveLease = useCallback(async (lease: FreePlayQueueLease): Promise<boolean> => {
    if (!lease.owned || lease.matched) return true;
    try {
      await requestFreePlayQueue(lease.authority.accountKey, "leave", { keepalive: true });
      lease.owned = false;
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // A queue lease must never outlive the UI that owns it. `pagehide` covers a
  // browser navigation/close; the effect cleanup covers Card Hall tab changes
  // and ordinary React unmounts. keepalive lets the tiny signed POST finish
  // while the document is being discarded.
  useEffect(() => {
    const lease: FreePlayQueueLease = {
      authority: activeAuthority,
      owned: false,
      matched: false,
      pollBusy: false,
      controllers: new Set(),
    };
    leaseRef.current = lease;
    const leaveOwnedQueue = () => { void leaveLease(lease); };
    window.addEventListener("pagehide", leaveOwnedQueue);
    return () => {
      window.removeEventListener("pagehide", leaveOwnedQueue);
      for (const controller of lease.controllers) controller.abort();
      lease.controllers.clear();
      void leaveLease(lease);
    };
  }, [activeAuthority, leaveLease]);

  useEffect(() => {
    const syncVisibility = () =>
      setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  useEffect(() => {
    if (!searching || !pageVisible) return;
    const lease = leaseRef.current;
    if (!lease || !leaseIsCurrent(lease)) return;
    let alive = true;
    const controller = new AbortController();
    lease.controllers.add(controller);
    const poll = async () => {
      if (lease.pollBusy || !leaseIsCurrent(lease)) return;
      lease.pollBusy = true;
      try {
        const body = await requestFreePlayQueue(lease.authority.accountKey, "poll", { signal: controller.signal });
        if (!alive || !leaseIsCurrent(lease)) return;
        const outcome = freePlayPollOutcome(body);
        if (outcome.kind === "matched") {
          if (!onStart) {
            lease.owned = false;
            setSearching(false);
            await requestFreePlayQueue(lease.authority.accountKey, "leave", { keepalive: true }).catch(() => undefined);
            if (!leaseIsCurrent(lease)) return;
            setError("A match was found, but this screen could not open it. Please try again.");
            return;
          }
          lease.matched = true;
          lease.owned = false;
          setSearching(false);
          setError("");
          onStart(outcome.matchId);
          return;
        }
        if (outcome.kind === "expired") {
          lease.owned = false;
          setSearching(false);
          setError("Your queue search expired while you were away. Start a new search when you're ready.");
          return;
        }
        setError("");
      } catch (pollError) {
        if (!alive || !leaseIsCurrent(lease) || (pollError instanceof DOMException && pollError.name === "AbortError")) return;
        const message = pollError instanceof Error ? pollError.message : "The showdown queue could not be reached.";
        setError(`${message} Your search is still active; retrying automatically.`);
      } finally {
        lease.pollBusy = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      alive = false;
      controller.abort();
      lease.controllers.delete(controller);
      window.clearInterval(timer);
    };
  }, [searching, pageVisible, activeAuthority, onStart, leaseIsCurrent]);

  async function join() {
    if (joining || leaving || searching) return;
    const lease = leaseRef.current;
    if (!lease || !leaseIsCurrent(lease)) return;
    setError("");
    setJoining(true);
    lease.matched = false;
    // Treat the request as owning a possible lease before awaiting it. If the
    // response is lost after the server accepted it, cleanup still sends leave.
    lease.owned = true;
    const controller = new AbortController();
    lease.controllers.add(controller);
    try {
      const body = await requestFreePlayQueue(lease.authority.accountKey, "join", { signal: controller.signal });
      if (!leaseIsCurrent(lease)) {
        await leaveLease(lease);
        return;
      }
      if (body.inQueue !== true) {
        lease.owned = false;
        setError("The Hall did not confirm your queue search. Please try again.");
        return;
      }
      setSearching(true);
    } catch (joinError) {
      if (!leaseIsCurrent(lease)) {
        await leaveLease(lease);
        return;
      }
      // A failed response is ambiguous: the join may have committed before the
      // connection dropped. Compensate with leave so it cannot become a ghost.
      const leaveConfirmed = await leaveLease(lease);
      lease.owned = !leaveConfirmed;
      if (leaseIsCurrent(lease)) {
        if (!leaveConfirmed) setSearching(true);
        const message = joinError instanceof Error ? joinError.message : "Could not join the showdown queue.";
        setError(leaveConfirmed
          ? message
          : `${message} The join could not be canceled, so the search remains active. Use Cancel Search to retry.`);
      }
    } finally {
      lease.controllers.delete(controller);
      if (leaseIsCurrent(lease)) setJoining(false);
    }
  }

  async function cancel() {
    const lease = leaseRef.current;
    if (!lease || !leaseIsCurrent(lease) || !lease.owned || leaving) return;
    setLeaving(true);
    setSearching(false);
    try {
      if (!await leaveLease(lease)) throw new FreePlayQueueError("The queue cancellation could not be confirmed.");
      if (!leaseIsCurrent(lease)) return;
      setError("");
    } catch (leaveError) {
      const message = leaveError instanceof FreePlayQueueError
        ? leaveError.message
        : "The queue cancellation could not be confirmed.";
      // Do not pretend cancellation succeeded. Keep ownership + polling live so
      // the player can retry and cleanup will send another leave on navigation.
      if (leaseIsCurrent(lease)) {
        setSearching(true);
        setError(`${message} Your search remains active; retry Cancel Search.`);
      }
    } finally {
      if (leaseIsCurrent(lease)) setLeaving(false);
    }
  }

  return (
    <section className="chronicle-panel">
      <h2>{CHRONICLE_ROOM_TITLE}</h2>
      <p>
        Unranked Free-Play PvP with the Founding Codex room rules. No rewards
        and no rating changes. Hidden hands, Deck order, face-down Monsters and
        set Snares remain hidden until play reveals them.
      </p>
      {error ? <div className="chronicle-error" role="alert">{error}</div> : null}
      {searching ? <p role="status" aria-live="polite">Searching for an opponent…</p> : null}
      <button onClick={() => void join()} disabled={searching || joining || leaving}>
        {joining ? "Joining…" : searching ? "Searching…" : leaving ? "Canceling…" : "Find a Showdown"}
      </button>
      {searching ? (
        <button onClick={() => void cancel()} disabled={leaving} style={{ marginLeft: 8 }}>
          {leaving ? "Canceling…" : "Cancel Search"}
        </button>
      ) : null}
    </section>
  );
}

function Rules() {
  return (
    <section className="chronicle-panel chronicle-rules">
      <h2>{CHRONICLE_ROOM_TITLE}</h2>
      <p>
        The founding ruleset of the {CHRONICLE_FOUNDING_FORMAT.latestLegalSet}:
        a lean, mastery-first duel built on the original Shinobi card pool. Start
        with 8,000 Health, a 40-card Deck and a five-card opening hand.
      </p>
      <p>
        <strong>Turn:</strong> Draw, Standby, Main 1, Battle, Main 2, End. You
        advance Draw, Standby, End, and the turn handoff explicitly, so every
        phase remains readable. The first player draws on turn one but cannot
        Battle; skipping Battle also skips Main 2. You get one Normal Summon or
        Set.
      </p>
      <p>
        <strong>Monsters:</strong> Levels 1–4 need no Tribute, 5–6 need one and
        7–8 need two. Sets enter face-down Defense and may Flip Summon later.
        Attack uses ATK; Defense uses DEF; direct attacks require an empty field.
      </p>
      <p>
        <strong>Elements:</strong> Fire beats Wind, then Lightning, Earth, Water
        and Fire again. Advantage adds +200 to the used ATK or DEF. Neutral is
        the default table. Field Jutsu replaces that wheel with its printed
        +300/−200 modifier; replacing the Field card replaces the modifier, so
        field advantages never stack.
      </p>
      <p>
        <strong>Support:</strong> Set Snares wait one turn and allow one matching
        response—no chains. Most cards allow three copies; printed LIMIT 1/2
        exceptions and the number of copies in your collection are enforced when you save and play. Lose
        at zero Health Points, on an empty Deck draw, or by forfeit.
      </p>
    </section>
  );
}
