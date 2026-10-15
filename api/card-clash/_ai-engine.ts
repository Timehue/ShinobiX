/* Server-owned Shinobi Chronicle Showdown AI session. */
import {
  CHRONICLE_AI_DIFFICULTY_DETAILS,
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_RULES_VERSION,
  applyAction,
  createMatch,
  elementBattleBonus,
  getChronicleCard,
  isChronicleToken,
  meetsSnareElementRequirement,
  monsterAttack,
  monsterDefense,
  projectMatchForViewer,
  tributeCountForLevel,
  type ChronicleActionIntent,
  type ChronicleAiDifficulty,
  type ChronicleElement,
  type ChronicleMatch,
  type ChronicleProjection,
  type ChronicleSideKey,
} from "../../shared/chronicle-duel.js";

export type AiMatchResult = "player" | "opponent" | "draw";

export interface AiMatchSession {
  matchId: string;
  playerName: string;
  createdAt: number;
  rulesVersion: typeof CHRONICLE_RULES_VERSION;
  difficulty: ChronicleAiDifficulty;
  state: ChronicleMatch;
  status: "active" | "done";
  winner?: AiMatchResult;
  settledAt?: number;
  settlementMode?: "standard" | "external";
  /** Present only for a Chronicle match admitted from the exact active
   * Dungeon run. A generic external-stakes duel never receives this binding. */
  dungeonRunToken?: string;
  dungeonAuthorityVersion?: number;
  /** Present only for an Echoes of War campaign duel: sealed at ai-start
   * (after the floor-unlock check) and read by the settle path, so the client
   * can never pick its encounter, opponent deck or reward after the fact. */
  echoes?: { encounterId: string };
  /** Server-sealed Hollow Gate rift ambush. Only the matching run may redeem it.
   * `loanerDeck` marks a match fought with the lent starter deck (card-start.ts). */
  hollowGateCard?: { tokenDigest: string; nodeId: string; loanerDeck?: boolean };
  /** Display-only override for the AI deck's board name (campaign decks). */
  opponentDeckName?: string;
}

export type AiMatchProjection = ChronicleProjection & {
  matchId: string;
  aiDifficulty: ChronicleAiDifficulty;
  aiDeckName: string;
  winnerResult?: AiMatchResult;
};

/** Captures the committed player action and each individual AI reply so the
 *  client can present the board between moves with readable pacing. */
export type AiStepListener = (state: ChronicleMatch) => void;

/** Trim intermediate replay snapshots: the client ticker only needs the log
 *  tail per beat; the final session still carries the full projected log. */
const AI_STEP_LOG_LINES = 8;
export function captureAiStep(
  steps: ChronicleProjection[],
  state: ChronicleMatch,
): void {
  const projected = projectMatchForViewer(state, "p1");
  steps.push({ ...projected, log: projected.log.slice(-AI_STEP_LOG_LINES) });
}

function resultFor(state: ChronicleMatch): AiMatchResult | undefined {
  if (state.status !== "complete") return undefined;
  return state.winner === "p1"
    ? "player"
    : state.winner === "p2"
      ? "opponent"
      : "draw";
}

function syncTerminal(session: AiMatchSession): void {
  const winner = resultFor(session.state);
  if (!winner) return;
  session.status = "done";
  session.winner = winner;
}

function mediumAiDeck(): string[] {
  const deck = [...CHRONICLE_FIXED_FALLBACK_DECK];
  const replacements = ["tc-21", "tc-22", "tc-23", "tc-24"];
  for (let i = 0; i < replacements.length; i++) deck[i * 3] = replacements[i];
  deck[24] = "chronicle-hollow-breach";
  deck[32] = "chronicle-pitfall-tag-array";
  return deck;
}

const HARD_AI_DECK = Object.freeze([
  // Crimson Tempest: 16 no-Tribute Monsters, five one-Tribute threats and
  // three finishers. The Fire concentration supports Volcano and Fire Snares.
  //
  // Rebuilt 2026-10-14 (docs/chronicle-balance-pass-2026-10.md). When power
  // tier stopped following rarity (08-17), most of the old list moved to
  // Tribute Levels, and the deck quietly became 5 free bodies against 19
  // Tribute Monsters. It could rarely summon, and the starter deck beat "Hard"
  // 45% of the time. Restoring the old 19/3/2 curve overshot to 98%: a clean
  // curve alone crushes the starter, whose eight two-Tribute Monsters rarely
  // reach the field. Tuned against the Medium pilot, this list beats the
  // starter deck 85% of the time and a Shop-upgraded starter 49%. The curve is
  // pinned by _ai-engine.test.ts, so a future re-tier fails a test.
  "tc-92", "tc-92", "tc-92", // L4 Rare
  "tc-67", "tc-67", "tc-67", // L4 Common
  "tc-42", "tc-42", // L2 Epic, piercing
  "tc-08", "tc-08", // L2 FLIP: destroy their strongest
  "tc-13", "tc-13", // L4 FLIP: heal
  "tc-61", "tc-61", "tc-61", // L2 Common
  "tc-01", // L1 Training Dummy, Tribute fodder
  "tc-137", // L5 Legendary
  "tc-28", "tc-28", "tc-28", // L5 Rare, piercing
  "tc-83", // L5 Rare
  "tc-124", // L8 Legendary finisher
  "tc-50", // L7 Epic finisher, seals all Snares
  "tc-54", // L7 Common
  "chronicle-field-volcano", "chronicle-field-volcano",
  "chronicle-stacked-scrolls",
  "chronicle-soldier-pill",
  "chronicle-hollow-breach", "chronicle-hollow-breach",
  "chronicle-hundredfold-tempest",
  "chronicle-sealbreak-verdict",
  "chronicle-storm-shear",
  "chronicle-ringed-detonation",
  // Mirror-Shell Counter needs a face-up Water Monster since the balance pass,
  // so an all-Fire deck runs a Fire Snare in its slot.
  "chronicle-ashen-veil",
  "chronicle-returning-cylinder-seal",
  "chronicle-soldier-pill",
  "chronicle-smoke-bomb", "chronicle-smoke-bomb", "chronicle-smoke-bomb",
] as const);

export const CHRONICLE_AI_DECKS: Readonly<
  Record<ChronicleAiDifficulty, readonly string[]>
> = Object.freeze({
  easy: Object.freeze([...CHRONICLE_FIXED_FALLBACK_DECK]),
  medium: Object.freeze(mediumAiDeck()),
  hard: HARD_AI_DECK,
});

/** Return a copy so a live match can shuffle without mutating a template. */
export function generateAiServerDeck(
  difficulty: ChronicleAiDifficulty = "medium",
): string[] {
  return [...CHRONICLE_AI_DECKS[difficulty]];
}

export function createAiMatch(
  matchId: string,
  playerName: string,
  playerDeck: string[],
  difficulty: ChronicleAiDifficulty,
  now: number,
  random: () => number = Math.random,
  settlementMode: "standard" | "external" = "standard",
  onAiStep?: AiStepListener,
  opponent?: { name?: string; deck?: readonly string[]; deckName?: string },
): AiMatchSession {
  const session: AiMatchSession = {
    matchId,
    playerName,
    createdAt: now,
    rulesVersion: CHRONICLE_RULES_VERSION,
    difficulty,
    state: createMatch(
      playerName,
      playerDeck,
      opponent?.name ?? "Chronicle Keeper",
      opponent?.deck ? [...opponent.deck] : generateAiServerDeck(difficulty),
      random,
      now,
    ),
    status: "active",
    settlementMode,
    ...(opponent?.deckName ? { opponentDeckName: opponent.deckName } : {}),
  };
  advanceAi(session, now, onAiStep);
  return session;
}

function controlsFaceUpElement(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
  element: ChronicleElement,
): boolean {
  return state[sideKey].monsterZones.some((monster) =>
    meetsSnareElementRequirement(monster, element),
  );
}

function canSupportTrapRequirement(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
  element: ChronicleElement | undefined,
): boolean {
  if (!element || controlsFaceUpElement(state, sideKey, element)) return true;
  return state[sideKey].hand.some((id) => {
    const card = getChronicleCard(id);
    return card?.cardClass === "monster" && card.element === element;
  });
}

function trapResponsePriority(
  state: ChronicleMatch,
  responder: ChronicleSideKey,
  zoneIndex: number,
): number {
  const cardId = state[responder].magicTrapZones[zoneIndex]?.cardId ?? "";
  const card = getChronicleCard(cardId);
  if (card?.cardClass !== "trap") return 0;
  const window = state.responseWindow;
  const attacker =
    window?.trigger === "onAttackDeclared"
      ? state[window.pendingAction.actor].monsterZones[
          Number(window.pendingAction.attackerZoneIndex)
        ]
      : null;
  const incomingAttack = attacker
    ? monsterAttack(attacker, state.activeField, state)
    : 0;
  if (card.effect.kind === "destroyAttackerAndDamageBoth") {
    if (incomingAttack >= state[responder].lifePoints)
      return incomingAttack >= state[window?.pendingAction.actor ?? "p1"].lifePoints
        ? 2
        : -10;
    return 6;
  }
  if (card.effect.kind === "negateAttackAndInflictDamage") return 7;
  if (card.effect.kind === "endBattlePhase") return 9;
  if (card.effect.kind === "summonDefenderFromHand") return 8;
  if (card.effect.kind === "destroyAllAttackPositionMonsters")
    return (
      6 +
      state[window?.pendingAction.actor ?? "p1"].monsterZones.filter(
        (monster) => monster?.faceUp && monster.position === "attack",
      ).length
    );
  if (card.effect.kind === "destroyAllMonsters") {
    const actor = window?.pendingAction.actor ?? otherSide(responder);
    const opposingCount = state[actor].monsterZones.filter(Boolean).length + 1;
    const ownCount = state[responder].monsterZones.filter(Boolean).length;
    return opposingCount >= ownCount ? 6 : 1;
  }
  if (
    card.effect.kind === "destroyOneMonster"
  )
    return 5;
  if (card.effect.kind === "destroyLowestAttackWhenOutnumbered") return 6;
  if (card.effect.kind === "destroyAttackerIfTargetDestroyed") return 5;
  if (
    card.effect.kind === "weakenSummonedMonster" ||
    card.effect.kind === "sealSummonedMonsterFaceDown"
  )
    return 5;
  if (
    card.effect.kind === "borrowAttackerDefense" ||
    card.effect.kind === "redirectAttackToHighestDefense" ||
    card.effect.kind === "defensiveFeint"
  )
    return 4;
  if (
    card.effect.kind === "modifyAttackUntilEndTurn" &&
    (card.effect.amount ?? 0) < 0
  )
    return incomingAttack >= state[responder].lifePoints ? 6 : 3;
  if (card.effect.kind === "returnOneMonsterToHand") return 2;
  if (card.effect.kind === "negateOneAttack") return 1;
  return 2;
}

/** Field Monsters that can pay a Tribute now: a Shadow Double cannot on the
 *  turn it appears. */
function tributableIndexes(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
): number[] {
  return state[sideKey].monsterZones.flatMap((monster, index) =>
    monster &&
    !(isChronicleToken(monster.cardId) && monster.summonedOnTurn === state.turnNumber)
      ? [index]
      : [],
  );
}

function otherSide(side: ChronicleSideKey): ChronicleSideKey {
  return side === "p1" ? "p2" : "p1";
}

function visibleMonsterThreat(
  state: ChronicleMatch,
  monster: NonNullable<ChronicleMatch["p1"]["monsterZones"][number]>,
): number {
  if (!monster.faceUp) return 0;
  return monster.position === "attack"
    ? monsterAttack(monster, state.activeField, state)
    : monsterDefense(monster);
}

function trapSetPriority(cardId: string): number {
  const card = getChronicleCard(cardId);
  if (card?.cardClass !== "trap") return 0;
  switch (card.effect.kind) {
    case "destroyAllAttackPositionMonsters":
    case "negateAttackAndInflictDamage":
    case "destroyAllMonsters":
    case "endBattlePhase":
      return 8;
    case "summonDefenderFromHand":
      return 7;
    case "destroyAttackerAndDamageBoth":
      return 7;
    case "destroyOneMonster":
    case "destroyLowestAttackWhenOutnumbered":
      return 6;
    case "destroyAttackerIfTargetDestroyed":
    case "weakenSummonedMonster":
    case "sealSummonedMonsterFaceDown":
      return 5;
    case "redirectAttackToHighestDefense":
    case "borrowAttackerDefense":
    case "defensiveFeint":
      return 5;
    case "returnOneMonsterToHand":
      return 5;
    case "destroyOneMagicTrap":
      return 4;
    case "negateOneAttack":
      return 3;
    default:
      return 1;
  }
}

function chooseMainAction(
  state: ChronicleMatch,
  difficulty: ChronicleAiDifficulty,
): ChronicleActionIntent {
  const side = state.p2;
  const usefulFlip = side.monsterZones.findIndex((monster) => {
    if (
      !monster ||
      monster.faceUp ||
      monster.summonedOnTurn === state.turnNumber
    )
      return false;
    const card = getChronicleCard(monster.cardId);
    return (
      card?.cardClass === "monster" &&
      (card.monsterEffect?.kind === "drawOnFlip" ||
        card.monsterEffect?.kind === "cycleHandsOnFlip" ||
        card.monsterEffect?.kind === "healOnFlip" ||
        (card.monsterEffect?.kind ===
          "changeStrongestOpponentPositionOnFlip" &&
          state.p1.monsterZones.some((target) => target?.faceUp)) ||
        (card.monsterEffect?.kind === "destroyStrongestOpponentOnFlip" &&
          state.p1.monsterZones.some(Boolean)) ||
        (card.monsterEffect?.kind === "recoverMagicOnFlip" &&
          side.graveyard.some(
            (id) => getChronicleCard(id)?.cardClass === "magic",
          )))
    );
  });
  if (usefulFlip >= 0) return { action: "flip-summon", zoneIndex: usefulFlip };
  // Use the closed Magic vocabulary with server-selected legal targets.
  const openMagicTrap = side.magicTrapZones.findIndex((zone) => zone === null);
  const fieldMagicIndex = side.hand
    .map((id, handIndex) => ({ card: getChronicleCard(id), handIndex }))
    .find(
      ({ card }) =>
        card?.cardClass === "magic" &&
        card.magicType === "field" &&
        state.activeField?.cardId !== card.id &&
        side.hand.some((heldId) => {
          const held = getChronicleCard(heldId);
          return (
            held?.cardClass === "monster" &&
            held.element === card.effect.boostElement
          );
        }),
    )?.handIndex ?? -1;
  if (fieldMagicIndex >= 0)
    return { action: "activate-magic", handIndex: fieldMagicIndex };
  if (openMagicTrap >= 0) {
    for (let handIndex = 0; handIndex < side.hand.length; handIndex++) {
      const card = getChronicleCard(side.hand[handIndex]);
      if (!card || card.cardClass !== "magic") continue;
      if (card.magicType === "field") continue;
      const scope = card.effect.targetScope;
      if (card.effect.kind === "callSummon") {
        // The Call spends the Normal Summon on a Level 8 body, which beats any
        // free summon, so it goes first whenever the pair is in hand. The
        // Keeper keeps a margin rather than paying its last Health.
        if (
          !state.normalSummonUsed &&
          side.hand.includes(card.effect.calledMonsterId ?? "") &&
          side.monsterZones.some((zone) => zone === null) &&
          side.lifePoints > (card.effect.healthCost ?? 0) + 1_000
        )
          return { action: "activate-magic", handIndex };
        continue;
      }
      if (card.effect.kind === "summonShadowDoubles") {
        // Worth casting when a Tribute Monster in hand is waiting for bodies.
        const bodies = tributableIndexes(state, "p2").length;
        const waiting = side.hand.some((id) => {
          const held = getChronicleCard(id);
          return (
            held?.cardClass === "monster" &&
            held.monsterEffect?.kind !== "callSummonOnly" &&
            tributeCountForLevel(held.level) > bodies
          );
        });
        if (
          waiting &&
          side.monsterZones.filter((zone) => zone === null).length >=
            (card.effect.amount ?? 2)
        )
          return { action: "activate-magic", handIndex };
        continue;
      }
      if (
        card.effect.kind === "destroyAllOpponentMonsters" ||
        card.effect.kind === "destroyAllMonsters"
      ) {
        const ownCount = side.monsterZones.filter(Boolean).length;
        const opponentCount = state.p1.monsterZones.filter(Boolean).length;
        if (
          opponentCount > 0 &&
          (card.effect.kind === "destroyAllOpponentMonsters" ||
            opponentCount > ownCount)
        )
          return { action: "activate-magic", handIndex };
        continue;
      }
      if (
        card.effect.kind === "destroyAllOpponentMagicTraps" ||
        card.effect.kind === "destroyAllMagicTraps"
      ) {
        const ownCount =
          side.magicTrapZones.filter(Boolean).length +
          (state.activeField?.owner === "p2" ? 1 : 0);
        const opponentCount =
          state.p1.magicTrapZones.filter(Boolean).length +
          (state.activeField?.owner === "p1" ? 1 : 0);
        if (
          opponentCount > 0 &&
          (card.effect.kind === "destroyAllOpponentMagicTraps" ||
            opponentCount > ownCount)
        )
          return { action: "activate-magic", handIndex };
        continue;
      }
      if (card.effect.kind === "destroyActiveField") {
        if (state.activeField?.owner === "p1")
          return { action: "activate-magic", handIndex };
        continue;
      }
      if (
        (card.effect.kind === "drawCards" ||
          card.effect.kind === "drawThenDiscardRandom") &&
        side.deck.length >= (card.effect.amount ?? 1)
      )
        return { action: "activate-magic", handIndex };
      if (card.effect.kind === "healLifePoints" && side.lifePoints <= 6_800)
        return { action: "activate-magic", handIndex };
      if (scope === "ownedFaceUpMonster") {
        const legalOwnedTargets = side.monsterZones.flatMap(
          (monster, targetZoneIndex) =>
            monster?.faceUp &&
            (card.magicType !== "equip" || !monster.attachedEquipId)
              ? [{ monster, targetZoneIndex }]
              : [],
        );
        if (difficulty === "hard")
          legalOwnedTargets.sort(
            (a, b) =>
              visibleMonsterThreat(state, b.monster) -
              visibleMonsterThreat(state, a.monster),
          );
        const targetZoneIndex = legalOwnedTargets[0]?.targetZoneIndex ?? -1;
        if (targetZoneIndex >= 0)
          return {
            action: "activate-magic",
            handIndex,
            targetZoneIndex,
            targetSide: "p2",
          };
      } else if (
        scope === "opponentMonster" ||
        scope === "opponentLevel4OrLowerMonster" ||
        scope === "anyFaceUpMonster"
      ) {
        const legalOpponentTargets = state.p1.monsterZones.flatMap(
          (monster, targetZoneIndex) => {
            if (!monster) return [];
            const targetCard = getChronicleCard(monster.cardId);
            const legal =
              scope === "anyFaceUpMonster" ||
              card.effect.kind === "changeOneMonsterPosition"
                ? monster.faceUp
                : (scope !== "opponentLevel4OrLowerMonster" ||
                    (monster.faceUp &&
                      targetCard?.cardClass === "monster" &&
                      targetCard.level <= 4)) &&
                  (card.effect.kind !== "destroyLowDefenseMonster" ||
                    (monster.faceUp &&
                      monsterDefense(monster) <= (card.effect.cap ?? 1_000)));
            return legal ? [{ monster, targetZoneIndex }] : [];
          },
        );
        if (difficulty === "hard")
          legalOpponentTargets.sort(
            (a, b) =>
              visibleMonsterThreat(state, b.monster) -
              visibleMonsterThreat(state, a.monster),
          );
        const targetZoneIndex =
          legalOpponentTargets[0]?.targetZoneIndex ?? -1;
        if (targetZoneIndex >= 0)
          return {
            action: "activate-magic",
            handIndex,
            targetZoneIndex,
            targetSide: "p1",
          };
      } else if (scope === "opponentMagicTrap") {
        const targetZoneIndex = state.p1.magicTrapZones.findIndex(Boolean);
        if (targetZoneIndex >= 0)
          return {
            action: "activate-magic",
            handIndex,
            targetZoneIndex,
            targetSide: "p1",
          };
      } else if (scope === "ownGraveyardLevel4OrLowerMonster") {
        const graveyardIndex = side.graveyard.findIndex((id) => {
          const target = getChronicleCard(id);
          return (
            target?.cardClass === "monster" &&
            target.level <= 4 &&
            (card.effect.kind !== "reviveLevel4OrLowerNormalMonster" ||
              target.monsterType === "normal")
          );
        });
        const needsOpenMonsterZone =
          card.effect.kind === "reviveLevel4OrLowerMonster" ||
          card.effect.kind === "reviveLevel4OrLowerNormalMonster";
        if (
          graveyardIndex >= 0 &&
          (!needsOpenMonsterZone ||
            side.monsterZones.some((zone) => zone === null))
        )
          return { action: "activate-magic", handIndex, graveyardIndex };
      } else if (scope === "ownGraveyardMagic") {
        const graveyardIndex = side.graveyard.findIndex(
          (id) => getChronicleCard(id)?.cardClass === "magic",
        );
        if (graveyardIndex >= 0)
          return { action: "activate-magic", handIndex, graveyardIndex };
      } else if (scope === "ownGraveyardFieldMagic") {
        const graveyardIndex = side.graveyard.findIndex((id) => {
          const target = getChronicleCard(id);
          return target?.cardClass === "magic" && target.magicType === "field";
        });
        if (graveyardIndex >= 0)
          return { action: "activate-magic", handIndex, graveyardIndex };
      } else if (scope === "none" && card.effect.kind !== "healLifePoints")
        return { action: "activate-magic", handIndex };
    }
  }
  if (!state.normalSummonUsed) {
    const openZone = side.monsterZones.findIndex((zone) => zone === null);
    const tributable = tributableIndexes(state, "p2");
    const spareDoubles = tributable.filter((index) =>
      isChronicleToken(side.monsterZones[index]!.cardId),
    ).length;
    const candidates = side.hand.flatMap((id, handIndex) => {
      const card = getChronicleCard(id);
      if (!card || card.cardClass !== "monster") return [];
      // Only its Call can bring a called Monster out.
      if (card.monsterEffect?.kind === "callSummonOnly") return [];
      const tributes = tributeCountForLevel(card.level);
      if (tributes > tributable.length) return [];
      return [{ handIndex, card, tributes }];
    });
    candidates.sort((a, b) => {
      // Prefer a playable low-Level body, but take a Tribute line only when
      // its canonical board value clearly exceeds the expendable bodies.
      const effectValue = (card: (typeof a)["card"]): number => {
        switch (card.monsterEffect?.kind) {
          case "sealAllTraps":
          case "destroyStrongestOpponentOnFlip":
          case "recoverMagicOnFlip":
          case "recoverFieldMagicWhenDestroyedByBattle":
          case "setStrongestOpponentFaceDownOnSummon":
          case "destroySetMagicTrapOnTributeSummon":
          case "phaseOutBattlePairAfterDamage":
          case "destroyAttackerOnFlip":
          case "reviveNormalWhenDestroyedByBattle":
          case "sealAttackTraps":
            return 700;
          case "drawOnFlip":
          case "cycleHandsOnFlip":
          case "drawOnBattleDamage":
          case "discardOpponentCardOnBattleDamage":
          case "searchNormalWhenDestroyedByBattle":
          case "drawOnTributeSummon":
          case "surviveBattleOncePerTurn":
          case "alliedElementAttackBoost":
          case "gainAttackOnMagicActivated":
          case "guardOtherMonsters":
            return 500;
          case "healOnFlip":
          case "returnBattleOpponentWhenDestroyed":
          case "destroyAttackerWhenDefenseHolds":
          case "reflectDamageWhenAttacked":
          case "piercingBattleDamage":
          case "changeStrongestOpponentPositionOnFlip":
          case "changeToDefenseWhenAttacked":
          case "gainAttackWhenBattlingStronger":
          case "gainAttackWhileOnlyMonster":
            return 350;
          default:
            return 150;
        }
      };
      // A Tribute paid with a Shadow Double costs nothing on the board, so only
      // the real bodies a Summon would spend count against it.
      const realTributes = (tributes: number) => Math.max(0, tributes - spareDoubles);
      const av =
        a.card.attack +
        a.card.defense +
        effectValue(a.card) * (difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.35 : 1) -
        realTributes(a.tributes) * (difficulty === "hard" ? 1_850 : difficulty === "easy" ? 2_400 : 2_100);
      const bv =
        b.card.attack +
        b.card.defense +
        effectValue(b.card) * (difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.35 : 1) -
        realTributes(b.tributes) * (difficulty === "hard" ? 1_850 : difficulty === "easy" ? 2_400 : 2_100);
      return bv - av || a.card.level - b.card.level;
    });
    const choice = candidates[0];
    if (choice) {
      const tributeCandidates = tributable.map((index) => ({
        monster: side.monsterZones[index]!,
        index,
      }));
      if (difficulty === "hard")
        tributeCandidates.sort(
          (a, b) =>
            visibleMonsterThreat(state, a.monster) -
            visibleMonsterThreat(state, b.monster),
        );
      // Shadow Doubles exist to be spent: every difficulty pays with them first.
      tributeCandidates.sort(
        (a, b) =>
          Number(isChronicleToken(b.monster.cardId)) -
          Number(isChronicleToken(a.monster.cardId)),
      );
      const tributeZoneIndexes = tributeCandidates
        .map(({ index }) => index)
        .slice(0, choice.tributes);
      const zoneIndex = openZone >= 0 ? openZone : tributeZoneIndexes[0];
      return {
        action:
          choice.card.monsterEffect?.trigger === "onFlip"
            ? "set-monster"
            : "normal-summon",
        handIndex: choice.handIndex,
        zoneIndex,
        tributeZoneIndexes,
      };
    }
  }
  if (openMagicTrap >= 0) {
    const trapChoices = side.hand.flatMap((id, handIndex) => {
      const card = getChronicleCard(id);
      return card?.cardClass === "trap" &&
        canSupportTrapRequirement(state, "p2", card.effect.requiresFaceUpElement)
        ? [{ handIndex, priority: trapSetPriority(id) }]
        : [];
    });
    if (difficulty === "hard")
      trapChoices.sort((a, b) => b.priority - a.priority);
    const trapIndex = trapChoices[0]?.handIndex ?? -1;
    if (trapIndex >= 0)
      return {
        action: "set-trap",
        handIndex: trapIndex,
        zoneIndex: openMagicTrap,
      };
  }
  if (state.phase === "main1") {
    if (state.turnNumber === 1 && state.firstPlayer === "p2")
      return { action: "enter-end-phase" };
    return { action: "start-battle" };
  }
  return { action: "enter-end-phase" };
}

function knownBattleMargin(
  state: ChronicleMatch,
  attacker: NonNullable<ChronicleMatch["p2"]["monsterZones"][number]>,
  defender: NonNullable<ChronicleMatch["p1"]["monsterZones"][number]>,
): number | null {
  if (!defender.faceUp) return null;
  const attackerCard = getChronicleCard(attacker.cardId);
  const defenderCard = getChronicleCard(defender.cardId);
  if (
    attackerCard?.cardClass !== "monster" ||
    defenderCard?.cardClass !== "monster"
  )
    return null;
  const attackerAttack = monsterAttack(attacker, state.activeField, state);
  const defenderAttack = monsterAttack(defender, state.activeField, state);
  // A face-up "gains X ATK vs a stronger Monster" is public, and resolveAttack
  // and the player's battle preview both apply it. The Keeper used to ignore
  // it and kept attacking into those cards and losing the battle.
  const strongerBonus = (
    card: typeof attackerCard,
    own: number,
    opposing: number,
  ): number =>
    defender.position === "attack" &&
    card.monsterEffect?.kind === "gainAttackWhenBattlingStronger" &&
    opposing > own
      ? (card.monsterEffect.amount ?? 0)
      : 0;
  const attackerValue =
    attackerAttack +
    strongerBonus(attackerCard, attackerAttack, defenderAttack) +
    elementBattleBonus(
      attackerCard.element,
      defenderCard.element,
      state.activeField,
    );
  const defenderValue =
    (defender.position === "attack"
      ? defenderAttack + strongerBonus(defenderCard, defenderAttack, attackerAttack)
      : monsterDefense(defender)) +
    elementBattleBonus(
      defenderCard.element,
      attackerCard.element,
      state.activeField,
    );
  return attackerValue - defenderValue;
}

function chooseBattleAction(
  state: ChronicleMatch,
  difficulty: ChronicleAiDifficulty,
): ChronicleActionIntent {
  const attackers = state.p2.monsterZones.flatMap((monster, index) =>
    monster?.faceUp &&
    monster.position === "attack" &&
    monster.lastAttackTurn !== state.turnNumber
      ? [{ monster, index }]
      : [],
  );
  if (attackers.length === 0) return { action: "enter-main-2" };
  const targets = state.p1.monsterZones.flatMap((monster, index) =>
    monster ? [{ monster, index }] : [],
  );
  if (targets.length === 0) {
    if (difficulty === "hard")
      attackers.sort(
        (a, b) =>
          monsterAttack(b.monster, state.activeField, state) -
          monsterAttack(a.monster, state.activeField, state),
      );
    return {
      action: "attack",
      attackerZoneIndex: attackers[0].index,
      targetZoneIndex: null,
    };
  }

  if (difficulty === "hard") {
    const favorable = attackers.flatMap((attacker) =>
      targets.flatMap((target) => {
        const margin = knownBattleMargin(
          state,
          attacker.monster,
          target.monster,
        );
        return margin !== null && margin >= 0
          ? [
              {
                attackerIndex: attacker.index,
                targetIndex: target.index,
                score:
                  margin +
                  visibleMonsterThreat(state, target.monster) * 0.15,
              },
            ]
          : [];
      }),
    );
    favorable.sort((a, b) => b.score - a.score);
    if (favorable[0])
      return {
        action: "attack",
        attackerZoneIndex: favorable[0].attackerIndex,
        targetZoneIndex: favorable[0].targetIndex,
      };

    // A face-down Monster is intentionally treated as unknown. Hard AI uses
    // its strongest available attacker, but never reads the hidden card.
    const hiddenTarget = targets.find(({ monster }) => !monster.faceUp);
    if (hiddenTarget) {
      attackers.sort(
        (a, b) =>
          monsterAttack(b.monster, state.activeField, state) -
          monsterAttack(a.monster, state.activeField, state),
      );
      return {
        action: "attack",
        attackerZoneIndex: attackers[0].index,
        targetZoneIndex: hiddenTarget.index,
      };
    }
    return { action: "enter-main-2" };
  }

  const attacker = attackers[0];
  const knownFavorable = targets.find(({ monster }) => {
    const margin = knownBattleMargin(state, attacker.monster, monster);
    return margin === null || margin >= 0;
  });
  if (!knownFavorable) return { action: "enter-main-2" };
  return {
    action: "attack",
    attackerZoneIndex: attacker.index,
    targetZoneIndex: knownFavorable.index,
  };
}

/** Continue server AI decisions until the human must act or answer a response. */
export function advanceAi(
  session: AiMatchSession,
  now = Date.now(),
  onAiStep?: AiStepListener,
): void {
  let safety = 0;
  while (session.state.status === "active" && safety++ < 100) {
    const state = session.state;
    if (state.responseWindow) {
      if (state.responseWindow.responder !== "p2") break;
      const zoneIndex = state.responseWindow.eligibleZoneIndexes
        .slice()
        .sort(
          (a, b) =>
            trapResponsePriority(state, "p2", b) -
            trapResponsePriority(state, "p2", a),
        )
        .find((index) => trapResponsePriority(state, "p2", index) > 0);
      const intent: ChronicleActionIntent =
        zoneIndex === undefined
          ? { action: "pass-response" }
          : { action: "activate-trap", zoneIndex };
      const out = applyAction(state, "p2", intent, now);
      if (!out.ok) {
        const passed = applyAction(
          state,
          "p2",
          { action: "pass-response" },
          now,
        );
        if (!passed.ok) break;
        session.state = passed.state;
      } else session.state = out.state;
      onAiStep?.(session.state);
      continue;
    }
    if (state.activePlayer !== "p2") break;
    const intent: ChronicleActionIntent =
      state.phase === "draw" || state.phase === "standby"
        ? { action: "advance-phase" }
        : state.phase === "battle"
          ? chooseBattleAction(state, session.difficulty)
          : state.phase === "end"
            ? { action: "end-turn" }
            : chooseMainAction(state, session.difficulty);
    const out = applyAction(state, "p2", intent, now);
    if (!out.ok) {
      const fallback: ChronicleActionIntent =
        state.phase === "draw" || state.phase === "standby"
          ? { action: "advance-phase" }
          : state.phase === "battle"
            ? { action: "enter-main-2" }
            : state.phase === "end"
              ? { action: "end-turn" }
              : { action: "enter-end-phase" };
      const recovered = applyAction(state, "p2", fallback, now);
      if (!recovered.ok) break;
      session.state = recovered.state;
    } else session.state = out.state;
    onAiStep?.(session.state);
  }
  syncTerminal(session);
}

export function applyPlayerAction(
  session: AiMatchSession,
  intent: ChronicleActionIntent,
  now = Date.now(),
  onAiStep?: AiStepListener,
): { ok: true } | { ok: false; error: string } {
  if (
    session.rulesVersion !== CHRONICLE_RULES_VERSION ||
    session.state.rulesVersion !== CHRONICLE_RULES_VERSION
  )
    return {
      ok: false,
      error: "This duel used retired rules; start a new duel.",
    };
  if (session.status !== "active")
    return { ok: false, error: "The duel is over." };
  const out = applyAction(session.state, "p1", intent, now);
  if (!out.ok) return { ok: false, error: out.error };
  session.state = out.state;
  // Preserve the player's committed board before an automatic response can
  // remove its cards. Replay must show the cause before the Keeper's answer.
  onAiStep?.(session.state);
  advanceAi(session, now, onAiStep);
  syncTerminal(session);
  return { ok: true };
}

export function isDone(session: AiMatchSession): boolean {
  syncTerminal(session);
  return session.status === "done";
}

export function forfeit(session: AiMatchSession): void {
  if (session.status !== "active") return;
  const out = applyAction(session.state, "p1", { action: "forfeit" });
  if (out.ok) session.state = out.state;
  syncTerminal(session);
}

export function projectAiMatch(session: AiMatchSession): AiMatchProjection {
  return {
    matchId: session.matchId,
    aiDifficulty: session.difficulty,
    aiDeckName:
      session.opponentDeckName ??
      CHRONICLE_AI_DIFFICULTY_DETAILS[session.difficulty].deckName,
    ...projectMatchForViewer(session.state, "p1"),
    winnerResult: resultFor(session.state),
  };
}
