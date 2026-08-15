/* Server-owned Shinobi Chronicle Showdown AI session. */
import {
  CHRONICLE_AI_DIFFICULTY_DETAILS,
  CHRONICLE_FIXED_FALLBACK_DECK,
  CHRONICLE_RULES_VERSION,
  applyAction,
  createMatch,
  elementBattleBonus,
  getChronicleCard,
  monsterAttack,
  monsterDefense,
  projectMatchForViewer,
  tributeCountForLevel,
  type ChronicleActionIntent,
  type ChronicleAiDifficulty,
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
}

export type AiMatchProjection = ChronicleProjection & {
  matchId: string;
  aiDifficulty: ChronicleAiDifficulty;
  aiDeckName: string;
  winnerResult?: AiMatchResult;
};

/** Called after each individual AI action so callers can capture the board
 *  between moves (the client replays these snapshots with pacing beats). */
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
  // Crimson Tempest: 19 no-Tribute Monsters, three one-Tribute threats and
  // two finishers. The Fire concentration supports Volcano and Fire Traps.
  "tc-28", "tc-28", "tc-28",
  "tc-74", "tc-74", "tc-74",
  "tc-83", "tc-83", "tc-83",
  "tc-92", "tc-92", "tc-92",
  "tc-08", "tc-08",
  "tc-13", "tc-13",
  "tc-54", "tc-54", "tc-54",
  "tc-50",
  "tc-42", "tc-42",
  "tc-124",
  "tc-137",
  "chronicle-field-volcano", "chronicle-field-volcano",
  "chronicle-stacked-scrolls",
  "chronicle-giant-felling-edict",
  "chronicle-hollow-breach", "chronicle-hollow-breach",
  "chronicle-hundredfold-tempest",
  "chronicle-sealbreak-verdict",
  "chronicle-storm-shear",
  "chronicle-ringed-detonation",
  "chronicle-mirror-shell-counter",
  "chronicle-returning-cylinder-seal",
  "chronicle-torrential-tag-field",
  "chronicle-pitfall-tag-array", "chronicle-pitfall-tag-array",
  "chronicle-cinder-minefield",
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
      "Chronicle Keeper",
      generateAiServerDeck(difficulty),
      random,
      now,
    ),
    status: "active",
    settlementMode,
  };
  advanceAi(session, now, onAiStep);
  return session;
}

function controlsFaceUpElement(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
  element: string,
): boolean {
  return state[sideKey].monsterZones.some((monster) => {
    if (!monster?.faceUp) return false;
    const card = getChronicleCard(monster.cardId);
    return card?.cardClass === "monster" && card.element === element;
  });
}

function canSupportTrapRequirement(
  state: ChronicleMatch,
  sideKey: ChronicleSideKey,
  element: string | undefined,
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
    const candidates = side.hand.flatMap((id, handIndex) => {
      const card = getChronicleCard(id);
      if (!card || card.cardClass !== "monster") return [];
      const tributes = tributeCountForLevel(card.level);
      if (tributes > side.monsterZones.filter(Boolean).length) return [];
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
      const av =
        a.card.attack +
        a.card.defense +
        effectValue(a.card) * (difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.35 : 1) -
        a.tributes * (difficulty === "hard" ? 1_850 : difficulty === "easy" ? 2_400 : 2_100);
      const bv =
        b.card.attack +
        b.card.defense +
        effectValue(b.card) * (difficulty === "hard" ? 1.3 : difficulty === "easy" ? 0.35 : 1) -
        b.tributes * (difficulty === "hard" ? 1_850 : difficulty === "easy" ? 2_400 : 2_100);
      return bv - av || a.card.level - b.card.level;
    });
    const choice = candidates[0];
    if (choice) {
      const tributeCandidates = side.monsterZones.flatMap((monster, index) =>
        monster ? [{ monster, index }] : [],
      );
      if (difficulty === "hard")
        tributeCandidates.sort(
          (a, b) =>
            visibleMonsterThreat(state, a.monster) -
            visibleMonsterThreat(state, b.monster),
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
  const attackerValue =
    monsterAttack(attacker, state.activeField, state) +
    elementBattleBonus(
      attackerCard.element,
      defenderCard.element,
      state.activeField,
    );
  const defenderValue =
    (defender.position === "attack"
      ? monsterAttack(defender, state.activeField, state)
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
    aiDeckName: CHRONICLE_AI_DIFFICULTY_DETAILS[session.difficulty].deckName,
    ...projectMatchForViewer(session.state, "p1"),
    winnerResult: resultFor(session.state),
  };
}
