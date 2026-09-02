// DEV-ONLY Chronicle Showdown harness. It renders the shipping board with a
// dense deterministic match so visual reviews do not need an account, save, or
// live duel. This HTML entry is intentionally absent from production inputs.
import { createRoot } from "react-dom/client";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIXED_FALLBACK_DECK,
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
import { chronicleDuelistAvatar } from "./lib/chronicle-duelist-art";
import "./styles/chronicle-duel.css";

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
  state.p2.monsterZones[0] = fieldMonster("p2", 0, monsters[15]!.id);
  state.p2.monsterZones[2] = fieldMonster(
    "p2",
    2,
    monsters[18]!.id,
    "defense",
    false,
  );
  state.p2.monsterZones[4] = fieldMonster("p2", 4, monsters[24]!.id);
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
  return (
    <main className="chronicle-shell chronicle-shell--duel-active">
      <ChronicleDuelBoard
        state={previewState}
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
previewRoot.render(<Harness />);

if (import.meta.hot) {
  import.meta.hot.dispose(() => previewRoot.unmount());
}
