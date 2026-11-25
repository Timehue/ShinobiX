import type { ChronicleEffect, ChronicleMagicCard, ChronicleTrapCard } from "./chronicle-duel.js";

function jutsu(
  id: string, name: string, lore: string, effectText: string,
  kind: ChronicleEffect["kind"], targetScope: ChronicleEffect["targetScope"],
  duration: ChronicleEffect["duration"], amount: number, penaltyAmount?: number,
): ChronicleMagicCard {
  return {
    id, name, lore, effectText, rarity: "common", cardClass: "magic", effectTier: "starter",
    magicType: duration === "whileEquipped" ? "equip" : "normal",
    effect: { kind, targetScope, duration, amount, legalController: "owner", order: 10,
      originatingActionContinues: true, ...(penaltyAmount !== undefined ? { penaltyAmount } : {}) },
  };
}

function snare(
  id: string, name: string, lore: string, effectText: string,
  effect: Pick<ChronicleEffect, "kind" | "targetScope" | "duration"> & Partial<Pick<ChronicleEffect, "amount" | "cap" | "trigger">>,
): ChronicleTrapCard {
  return {
    id, name, lore, effectText, rarity: "common", cardClass: "trap", trapType: "normal", effectTier: "starter",
    effect: { legalController: "owner", originatingActionContinues: true, trigger: "onAttackDeclared",
      order: effect.trigger === "onMonsterSummoned" ? 20 : 5, ...effect },
  };
}

export const CHRONICLE_VILLAGE_SUPPORT: readonly (ChronicleMagicCard | ChronicleTrapCard)[] = [
  jutsu("chronicle-bandage-knot", "Bandage Knot", "Two turns of clean linen steady a shaking hand.",
    "Gain 350 Health Points.", "healLifePoints", "none", "instant", 350),
  jutsu("chronicle-borrowed-footing", "Borrowed Footing", "A single firm foothold lends force to a hurried strike.",
    "One of your face-up Monsters gains 250 ATK until the end of this turn.",
    "modifyAttackUntilEndTurn", "ownedFaceUpMonster", "untilEndTurn", 250),
  jutsu("chronicle-reedwall-stitch", "Reedwall Stitch", "A quick stitch binds the reeds tightly enough to turn a blow.",
    "One of your face-up Monsters gains 300 DEF through the end of your opponent's next turn.",
    "modifyDefenseUntilEndTurn", "ownedFaceUpMonster", "untilOpponentEndTurn", 300),
  jutsu("chronicle-errand-ledger", "Errand Ledger", "A fresh assignment pushes an unfinished errand off the page.",
    "Draw 1 card, then discard 1 random card.", "drawThenDiscardRandom", "none", "instant", 1, 1),
  jutsu("chronicle-mended-armguard", "Mended Armguard", "The old hinge has held through three owners.",
    "The equipped Monster gains 250 DEF.", "modifyDefenseUntilEndTurn", "ownedFaceUpMonster", "whileEquipped", 250),
  snare("chronicle-rattle-cord", "Rattle Cord", "A tiny brass rattle spoils the rhythm of a charge.",
    "When an opponent attacks, the attacker loses 200 ATK until the end of the turn.",
    { kind: "modifyAttackUntilEndTurn", targetScope: "triggerAttacker", amount: -200, duration: "untilEndTurn" }),
  snare("chronicle-soft-earth-catch", "Soft Earth Catch", "A harmless patch of tilled soil takes a boot and refuses to let go.",
    "When a Level 2 or lower Monster is Normal Summoned, it loses 200 ATK this turn and cannot change position through its controller's next turn.",
    { kind: "weakenSummonedMonster", targetScope: "triggerMonster", trigger: "onMonsterSummoned", cap: 2, amount: 200, duration: "instant" }),
  snare("chronicle-rebound-tassel", "Rebound Tassel", "One tug warns the sentry to drop behind cover.",
    "When your face-up Attack Position Monster is attacked, change it to Defense Position. The attacker loses 100 ATK this turn.",
    { kind: "defensiveFeint", targetScope: "triggerBattleTarget", amount: -100, duration: "untilEndTurn" }),
  snare("chronicle-clattering-shutters", "Clattering Shutters", "The old shutters close just in time.",
    "When your Monster is attacked, it gains 300 DEF until the end of the turn.",
    { kind: "modifyDefenseUntilEndTurn", targetScope: "triggerBattleTarget", amount: 300, duration: "untilEndTurn" }),
  snare("chronicle-lantern-feint", "Lantern Feint", "The moving light leads a pursuer straight to the waiting guard.",
    "When your Monster is attacked, redirect the attack to your other Monster with the highest DEF.",
    { kind: "redirectAttackToHighestDefense", targetScope: "triggerBattleTarget", duration: "instant" }),
];
