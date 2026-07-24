import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { TileCard } from "../data/tile-cards";
import "../styles/chronicle-duel.css";
import {
  CHRONICLE_FOUNDING_FORMAT,
  CHRONICLE_ELEMENTS,
  CHRONICLE_ROOM_TITLE,
  CHRONICLE_RULES_VERSION,
  MAIN_DECK_SIZE,
  MAX_COPIES_PER_CARD,
  buildChronicleDeck,
  canAddChronicleCard,
  chronicleAiAction,
  deckLimitForCard,
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
import { ChronicleCardView } from "../components/ChronicleCardView";
import { ChronicleDuelBoard } from "../components/ChronicleDuelBoard";
import { CardClashTutorial } from "../components/CardClashTutorial";

type Tab = "collection" | "deck" | "play" | "pvp" | "rules";
type AiDuelState = NonNullable<ChronicleAiResult["session"]>;

// Pacing beats between the Chronicle Keeper's replayed moves: a full beat when
// the step landed a new log line, a quiet beat for silent phase bookkeeping.
const AI_STEP_BEAT_MS = 950;
const AI_STEP_QUIET_MS = 400;
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

type CardHallProps = {
  character: Character;
  updateCharacter: (character: Character) => void;
  creatorCards: TileCard[];
  onBack: () => void;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onStartFreePlay?: (matchId: string) => void;
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
  const [resumableMatchId, setResumableMatchId] = useState<string | null>(
    readResumableMatch,
  );
  const autoStarted = useRef(false);
  const replayToken = useRef(0);
  useEffect(() => {
    // Cancel any in-flight AI replay when the hall unmounts.
    return () => {
      replayToken.current += 1;
    };
  }, []);

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
  async function presentSession(result: ChronicleAiResult) {
    const final = result.session;
    if (!final) return;
    if (result.reward) setReward(result.reward);
    if (result.character) updateCharacter(result.character);
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
    setBusy(true);
    setError("");
    setReward(undefined);
    const result = await chronicleAiAction(resumableMatchId, {
      action: "state",
    });
    if (!result.ok || !result.session) {
      setBusy(false);
      syncResumableMatch(null);
      setError(result.error ?? "That showdown has expired.");
      return;
    }
    setMatchId(resumableMatchId);
    await presentSession(result);
    setBusy(false);
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
    setBusy(true);
    setError("");
    setReward(undefined);
    const result = await startChronicleAi(
      character.name,
      deckIds,
      difficulty,
    );
    if (!result.ok || !result.matchId || !result.session) {
      setBusy(false);
      setError(result.error ?? "Could not start the showdown.");
      return;
    }
    setMatchId(result.matchId);
    setTab("play");
    await presentSession(result);
    setBusy(false);
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
    setBusy(true);
    setError("");
    const result = await chronicleAiAction(matchId, intent);
    if (!result.ok || !result.session) {
      setBusy(false);
      setError(result.error ?? "That action was not legal.");
      return;
    }
    await presentSession(result);
    setBusy(false);
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

  return (
    <main className="chronicle-shell">
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
            key={item}
            aria-selected={tab === item}
            onClick={() => setTab(item)}
          >
            {item === "pvp"
              ? "Free-Play PvP"
              : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "collection" ? <Collection cards={ownedCards} /> : null}
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
                {reward ? (
                  <p>
                    {reward.ryo.toLocaleString()} ryo credited
                    {reward.dailyBonus
                      ? " including the daily victory bonus"
                      : ""}
                    .
                  </p>
                ) : (
                  <p>The authoritative result is final.</p>
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
              opponentAvatar={
                sharedImages[
                  `avatar:${duel[duel.viewerSide === "p1" ? "p2" : "p1"].name.toLowerCase()}`
                ]
              }
              busy={busy}
              aiActing={aiActing}
              error={error}
              onAction={(intent) => void act(intent)}
            />
          </div>
        ) : (
          <div className="chronicle-panel" style={{ textAlign: "center" }}>
            <h2>{CHRONICLE_ROOM_TITLE}</h2>
            <p>
              The founding Shinobi card format — the original card pool and its
              Limited Scroll, six declared turn phases and the opening-turn draw
              rule.
            </p>
            {!savedValid ? (
              <p>
                Your saved deck uses retired rules. The server can deal a fixed
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
        <FreePlayQueue character={character} onStart={onStartFreePlay} />
      ) : null}
      {tab === "rules" ? <Rules /> : null}
      {showTutorial ? <CardClashTutorial onClose={closeTutorial} /> : null}
    </main>
  );
}

function Collection({ cards }: { cards: ChronicleDisplayCard[] }) {
  const [cardClass, setCardClass] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [monsterTier, setMonsterTier] = useState("all");
  const [element, setElement] = useState("all");
  const [inspected, setInspected] = useState<ChronicleDisplayCard | null>(null);
  useEffect(() => {
    if (!inspected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspected]);
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
            aria-label={`Inspect ${card.name}`}
            onClick={() => setInspected(card)}
          >
            <ChronicleCardView card={card} />
          </button>
        ))}
      </div>
      {inspected ? (
        <div className="chronicle-card-inspector" role="presentation">
          <section
            className="chronicle-card-inspector__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${inspected.name} card details`}
          >
            <button
              className="chronicle-card-inspector__close"
              type="button"
              autoFocus
              onClick={() => setInspected(null)}
            >
              Close
            </button>
            <ChronicleCardView card={inspected} />
          </section>
        </div>
      ) : null}
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
  return (
    <section className="chronicle-panel chronicle-deck">
      <div>
        <div className="chronicle-toolbar">
          <strong>Your cards</strong>
          <span>
            Select up to {MAX_COPIES_PER_CARD} copies; iconic advanced cards
            show their lower limit on the frame.
          </span>
        </div>
        <div className="chronicle-collection">
          {cards.map((card) => (
            <ChronicleCardView
              key={card.id}
              card={card}
              compact
              disabled={
                deck.filter((id) => id === card.id).length >=
                  Math.min(
                    deckLimitForCard(card.id),
                    owned.get(card.id) ?? 0,
                  ) || deck.length >= MAIN_DECK_SIZE
              }
              onClick={() => {
                const error = canAddChronicleCard(deck, card.id, owned);
                if (!error) setDeck([...deck, card.id]);
              }}
            />
          ))}
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
    </section>
  );
}

function FreePlayQueue({
  character,
  onStart,
}: {
  character: Character;
  onStart?: (matchId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const syncVisibility = () =>
      setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", syncVisibility);
    return () =>
      document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  useEffect(() => {
    if (!searching || !pageVisible) return;
    let alive = true;
    const poll = async () => {
      const response = await fetch("/api/card-clash/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: character.name, action: "poll" }),
      });
      const body = await response.json().catch(() => ({}));
      if (alive && body.match?.matchId) {
        setSearching(false);
        onStart?.(body.match.matchId);
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [searching, pageVisible, character.name, onStart]);
  async function join() {
    setError("");
    const response = await fetch("/api/card-clash/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: character.name, action: "join" }),
    });
    if (!response.ok) {
      setError("Could not join the showdown queue.");
      return;
    }
    setSearching(true);
  }
  return (
    <section className="chronicle-panel">
      <h2>{CHRONICLE_ROOM_TITLE}</h2>
      <p>
        Unranked Free-Play PvP with the Founding Codex room rules. No rewards
        and no rating changes. Hidden hands, Deck order, face-down Monsters and
        set Snares remain server-private.
      </p>
      {error ? <div className="chronicle-error">{error}</div> : null}
      <button onClick={() => void join()} disabled={searching}>
        {searching ? "Searching…" : "Find a Showdown"}
      </button>
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
        <strong>Turn:</strong> Draw, Standby, Main 1, Battle, Main 2, End. The first player draws on
        turn one but cannot Battle; skipping Battle also skips Main 2. You get
        one Normal Summon or Set.
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
        exceptions and the number of copies you own are server-enforced. Lose
        at zero Health Points, on an empty Deck draw, or by forfeit.
      </p>
    </section>
  );
}
