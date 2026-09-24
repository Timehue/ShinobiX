/* eslint-disable react-refresh/only-export-components -- This dev-only entry mounts independent QA scenarios. */
// DEV-ONLY Chronicle Showdown harness. It renders the shipping board with a
// dense deterministic match so visual reviews do not need an account, save, or
// live duel. This HTML entry is intentionally absent from production inputs.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_RULES_VERSION,
  createMatch,
  displayCardsById,
  projectMatchForViewer,
} from "./lib/chronicle-duel";
import { getAllTileCards } from "./data/tile-cards";
import type {
  ChronicleFieldMonster,
  ChronicleMagicTrapZone,
  ChronicleSideKey,
} from "../../shared/chronicle-duel";
import { ChronicleDuelBoard } from "./components/ChronicleDuelBoard";
import { applyAction } from "../../shared/chronicle-duel";
import { Collection, DeckBuilder } from "./components/ChronicleCardLibrary";
import { validateOwnedChronicleDeck } from "./lib/chronicle-duel";
import { CardClashTutorial } from "./components/CardClashTutorial";
import { ClanWarTileCardDuel } from "./screens/ClanWarTileCardDuel";
import { SectorWarCardBattle } from "./screens/SectorWarCardBattle";
import { CardClashFreePlay } from "./screens/CardClashFreePlay";
import { CardHall } from "./screens/CardHall";
import { CardClashDuel } from "./screens/CardClashDuel";
import type { Character } from "./types/character";
import { chronicleDuelistAvatar } from "./lib/chronicle-duelist-art";
import "./styles/tokens.css";
import "./styles/ui.css";
import "./styles/chronicle-duel.css";
import "./styles/layout/adaptive-shell.css";
import "./styles/layout/adaptive-stages.css";

// Resolve card art exactly the way the live duel screen does
// (native per-card images: bespoke /chronicle/cards art for monsters,
// emblem/field/scene art for support) so visual reviews here match
// what players actually see.
const cardsById = displayCardsById(getAllTileCards([]));

const monsters = CHRONICLE_CARD_CATALOG.filter(
  (card) => card.cardClass === "monster",
);
const support = CHRONICLE_CARD_CATALOG.filter(
  (card) => card.cardClass === "magic" || card.cardClass === "trap",
);

function fieldMonster(
  owner: ChronicleSideKey,
  zoneIndex: number,
  cardId: string,
  position: "attack" | "defense" = "attack",
  faceUp = true,
): ChronicleFieldMonster {
  return {
    instanceId: `${owner}-preview-monster-${zoneIndex}`,
    cardId,
    owner,
    zoneIndex,
    position,
    faceUp,
    summonedOnTurn: 3,
    lastPositionChangeTurn: 3,
    lastAttackTurn: 0,
    temporaryAttack: 0,
    temporaryDefense: 0,
  };
}

function supportZone(
  owner: ChronicleSideKey,
  zoneIndex: number,
  cardId: string,
  faceUp: boolean,
): ChronicleMagicTrapZone {
  return {
    instanceId: `${owner}-preview-support-${zoneIndex}`,
    cardId,
    owner,
    zoneIndex,
    faceUp,
    setOnTurn: 3,
  };
}

function previewMatch() {
  let seed = 0x5f3759df;
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const state = createMatch(
    "Akari of Ember",
    CHRONICLE_FIXED_FALLBACK_DECK,
    "The Veiled Keeper",
    CHRONICLE_FIXED_FALLBACK_DECK,
    random,
    Date.now(),
  );

  state.turnNumber = 4;
  state.activePlayer = "p1";
  state.phase = "main1";
  state.p1.lifePoints = 6_450;
  state.p2.lifePoints = 4_800;
  state.p1.hand = [
    monsters[6]?.id,
    support.find((card) => card.cardClass === "magic")?.id,
    monsters[12]?.id,
    support.find((card) => card.cardClass === "trap")?.id,
    monsters[20]?.id,
  ].filter((id): id is string => Boolean(id));
  state.p2.hand = state.p2.hand.slice(0, 4);
  state.p1.monsterZones[1] = fieldMonster("p1", 1, monsters[3]!.id);
  state.p1.monsterZones[3] = fieldMonster(
    "p1",
    3,
    monsters[9]!.id,
    "defense",
  );
  state.p2.monsterZones[0] = fieldMonster("p2", 0, "tc-36");
  state.p2.monsterZones[2] = fieldMonster(
    "p2",
    2,
    monsters[18]!.id,
    "defense",
    false,
  );
  state.p2.monsterZones[4] = fieldMonster("p2", 4, "tc-42");
  state.p1.magicTrapZones[0] = supportZone("p1", 0, support[1]!.id, false);
  state.p1.magicTrapZones[4] = supportZone("p1", 4, support[4]!.id, true);
  state.p2.magicTrapZones[1] = supportZone("p2", 1, support[5]!.id, false);
  state.p2.magicTrapZones[3] = supportZone("p2", 3, support[8]!.id, false);
  state.p1.graveyard = [monsters[1]!.id, support[2]!.id];
  state.p2.graveyard = [monsters[2]!.id, monsters[5]!.id, support[3]!.id];
  state.activeField = {
    cardId: "chronicle-field-volcano",
    fieldId: "volcano",
    owner: "p1",
  };
  state.log = [
    "The Veiled Keeper set a card in the Snare Zone.",
    "Akari of Ember summoned a shinobi in attack position.",
    "Akari of Ember entered Main Phase 1.",
  ];
  return projectMatchForViewer(state, "p1");
}

const previewState = previewMatch();

function Harness() {
  // Demo controls for visual review of the transient moments (summon
  // entrance, outcome slam) that a static projection can never show.
  const [state, setState] = useState(previewState);
  const demoSummon = () => {
    const next = structuredClone(state);
    next.p1.monsterZones[2] = {
      ...fieldMonster("p1", 2, "tc-31"),
      instanceId: `demo-${Date.now()}`,
      attack: 1850,
      defense: 1200,
    } as (typeof next.p1.monsterZones)[number];
    setState(next);
  };
  const demoEnd = (winner: "p1" | "p2") => {
    const next = structuredClone(state);
    next.status = "complete";
    next.winner = winner;
    setState(next);
  };
  return (
    <main className="chronicle-shell chronicle-shell--duel-active">
      <div
        id="demo-controls"
        style={{
          position: "fixed",
          top: 6,
          right: 6,
          zIndex: 5000,
          display: "flex",
          gap: 6,
        }}
      >
        <button style={{ font: "11px system-ui", padding: "3px 8px" }} onClick={demoSummon}>Demo summon</button>
        <button style={{ font: "11px system-ui", padding: "3px 8px" }} onClick={() => demoEnd("p1")}>Demo victory</button>
        <button style={{ font: "11px system-ui", padding: "3px 8px" }} onClick={() => demoEnd("p2")}>Demo defeat</button>
      </div>
      <ChronicleDuelBoard
        state={state}
        cardsById={cardsById}
        playerAvatar={chronicleDuelistAvatar("Akari of Ember") ?? "/portraits/aya.webp"}
        opponentAvatar={chronicleDuelistAvatar("The Veiled Keeper") ?? "/chronicle/keeper.webp"}
        onAction={() => undefined}
        onExit={() => window.location.reload()}
        exitLabel="Reset preview"
      />
    </main>
  );
}

const previewRoot = createRoot(document.getElementById("root")!);
function gameplayMatch(scenario: string) {
    const state = createMatch("Akari", CHRONICLE_FIXED_FALLBACK_DECK, "Keeper", CHRONICLE_FIXED_FALLBACK_DECK, () => 0, Date.now());
    state.turnNumber = 4; state.activePlayer = "p1"; state.phase = scenario.includes("attack") ? "battle" : "main1";
    const low = monsters.find(card => card.cardClass === "monster" && card.level <= 4)!;
    const high = monsters.find(card => card.cardClass === "monster" && card.level >= 5 && card.level <= 6)!;
    const magic = support.find(card => card.cardClass === "magic" && card.effect.targetScope === "none" && card.magicType === "normal")!;
    const trap = support.find(card => card.cardClass === "trap")!;
    const chosen = scenario === "tribute" ? high : scenario === "jutsu" ? magic : scenario === "target-jutsu" ? cardsById["chronicle-soldier-pill"] : scenario === "grave-jutsu" ? support.find(card=>card.cardClass === "magic" && card.effect.kind === "reviveLevel4OrLowerMonster")! : scenario === "snare" ? trap : low;
    state.p1.hand = Array.from({length:Number(params.get("hand") ?? 6)}, () => chosen.id);
    state.p1.graveyard = [low.id, magic.id];
    if (scenario.startsWith("effect-")) {
      state.activePlayer = "p2";
      const effectKind = scenario === "effect-block" ? "negateOneAttack" : scenario === "effect-return" ? "returnOneMonsterToHand" : scenario === "effect-stat" ? "weakenSummonedMonster" : scenario === "effect-sweep" ? "destroyAllMonsters" : "destroyOneMonster";
      const snare = support.find(card => card.cardClass === "trap" && card.effect.kind === effectKind && card.effect.trigger === (scenario === "effect-block" ? "onAttackDeclared" : "onMonsterSummoned"))!;
      if (snare.cardClass === "trap" && snare.effect.requiresFaceUpElement) {
        const ally = monsters.find(card => card.cardClass === "monster" && card.element === snare.effect.requiresFaceUpElement)!;
        state.p1.monsterZones[4] = fieldMonster("p1", 4, ally.id, "defense");
      }
      state.p1.magicTrapZones[1] = supportZone("p1", 1, snare.id, false);
      state.p2.hand = [low.id];
      if (scenario === "effect-sweep") {
        state.p1.monsterZones[2] = fieldMonster("p1", 2, low.id);
        state.p2.monsterZones[3] = fieldMonster("p2", 3, low.id);
      }
      if (scenario === "effect-block") {
        state.phase = "battle";
        state.p2.monsterZones[0] = fieldMonster("p2", 0, low.id);
      }
      const result = applyAction(state, "p2", scenario === "effect-block" ? { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null } : { action: "normal-summon", handIndex: 0, zoneIndex: 0 });
      if (!result.ok) throw new Error(result.error);
      return result.state;
    }
    if (scenario === "tribute" || scenario === "target-jutsu" || scenario.includes("attack")) state.p1.monsterZones[0] = fieldMonster("p1",0,low.id);
    if (scenario === "attack") state.p2.monsterZones[0] = fieldMonster("p2",0,low.id);
    if (scenario.startsWith("response")) {
      const actor = scenario === "response-other" ? "p1" : "p2";
      const responder = actor === "p1" ? "p2" : "p1";
      state.activePlayer = actor;
      state[actor].monsterZones[0] = fieldMonster(actor,0,low.id);
      state[actor].hand = ["chronicle-soldier-pill"];
      state[responder].magicTrapZones[0] = supportZone(responder,0,"chronicle-counter-script-cache",false);
      const result = applyAction(state,actor,{action:"activate-magic",handIndex:0,targetSide:actor,targetZoneIndex:0});
      if (result.ok === true) return result.state;
      throw new Error(result.error);
    }
    if (scenario === "finishing-attack") state.p2.lifePoints = 100;
    return state;
}
function GameplayHarness() {
  const params = new URLSearchParams(location.search);
  const scenario = params.get("scenario") ?? "summon";
  const [match, setMatch] = useState(() => gameplayMatch(scenario));
  const [error, setError] = useState("");
  const [lastAction, setLastAction] = useState("");
  return <main className="chronicle-shell chronicle-shell--duel-active">
    <output hidden data-testid="last-action">{lastAction}</output>
    <ChronicleDuelBoard state={projectMatchForViewer(match,"p1")} cardsById={cardsById} busy={scenario === "busy"} timedTurns={scenario.startsWith("response")} error={scenario === "error" ? "The duel server could not be reached. Try again." : error} onExit={() => location.reload()} onAction={intent => {
      setLastAction(JSON.stringify(intent));
      const result=applyAction(match,"p1",intent);
      if(result.ok === true) {
        setMatch(result.state);setError("");
        if (params.has("refresh") && !result.state.responseWindow) window.setTimeout(() => {
          setMatch(current => structuredClone(current));
        }, 150);
      } else setError(result.error);
    }}/>
  </main>;
}
function LibraryHarness() {
  const [deck,setDeck] = useState<string[]>([]);
  const [saved,setSaved] = useState<string[]>([]);
  const owned = new Map(CHRONICLE_CARD_CATALOG.map(card=>[card.id,card.id === "tc-03" ? 1 : 3]));
  return <main className="chronicle-shell">
    {new URLSearchParams(location.search).get("library") === "collection"
      ? <Collection cards={Object.values(cardsById)} owned={owned} catalogSize={CHRONICLE_CARD_CATALOG.length}/>
      : <DeckBuilder cards={Object.values(cardsById)} cardsById={cardsById} owned={owned} deck={deck} setDeck={setDeck} validation={validateOwnedChronicleDeck(deck,owned)} dirty={JSON.stringify(deck)!==JSON.stringify(saved)} onSave={()=>setSaved([...deck])} onMigrate={()=>setDeck([...CHRONICLE_FIXED_FALLBACK_DECK])}/>}
    <output hidden data-testid="saved-deck">{saved.length}</output>
  </main>;
}
const params = new URLSearchParams(location.search);
function HostHarness() {
  const character = { name: "Akari", level: 30, starterCardsClaimed: true, cardClashTutorialVersion: CHRONICLE_RULES_VERSION, tileCards: [], cardClashDeck: [...CHRONICLE_FIXED_FALLBACK_DECK] } as unknown as Character;
  const host = params.get("host");
  if (host === "hall") return <CardHall character={character} updateCharacter={()=>undefined} creatorCards={[]} onBack={()=>undefined} autoStart/>;
  if (host === "clan") return <ClanWarTileCardDuel character={character} setScreen={()=>undefined}/>;
  if (host === "sector") return <SectorWarCardBattle character={character} setScreen={()=>undefined}/>;
  if (host === "pvp") return <CardClashFreePlay character={character} setScreen={()=>undefined}/>;
  return <CardClashDuel character={character} creatorCards={[]} onDungeonWin={()=>undefined} onDungeonLeave={()=>undefined}
    echoes={host === "echoes" ? {encounterId:"qa-encounter",floor:1,opponentName:"Keeper",opponentTitle:"QA"} : undefined}/>;
}
function effectFixture() {
  const before = gameplayMatch("effect-pitfall");
  const next = applyAction(before, "p1", { action: "activate-trap", zoneIndex: 1 });
  if (!next.ok) throw new Error(next.error);
  const finisher = gameplayMatch("finishing-attack");
  const finished = applyAction(finisher, "p1", { action: "attack", attackerZoneIndex: 0, targetZoneIndex: null });
  if (!finished.ok) throw new Error(finished.error);
  return { before: projectMatchForViewer(before, "p1"), after: projectMatchForViewer(next.state, "p1"), finisher: projectMatchForViewer(finisher, "p1"), finished: projectMatchForViewer(finished.state, "p1") };
}
previewRoot.render(params.has("effect-fixture") ? <output data-testid="fixture">{JSON.stringify(effectFixture())}</output> : params.has("fixture") ? <output data-testid="fixture">{JSON.stringify(previewState)}</output> : params.has("tutorial") ? <CardClashTutorial onClose={()=>location.assign("?library=collection")}/> : <div className="app-shell" data-shell="adaptive"><div className="center-game">{params.has("host") ? <HostHarness /> : params.has("library") ? <LibraryHarness /> : params.has("scenario") ? <GameplayHarness /> : <Harness />}</div></div>);

if (import.meta.hot) {
  import.meta.hot.dispose(() => previewRoot.unmount());
}
