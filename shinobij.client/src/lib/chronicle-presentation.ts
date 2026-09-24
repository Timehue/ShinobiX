import { getChronicleCard, type ChronicleDisplayCard, type ChroniclePresentationEvent, type ChronicleProjection } from "./chronicle-duel";
import type { ChronicleSfx } from "./chronicle-sfx";

type Side = "p1" | "p2";
export type ChronicleBeat = {
  id: string;
  event: ChroniclePresentationEvent;
  events: ChroniclePresentationEvent[];
  title: string;
  actor: string;
  card?: ChronicleDisplayCard;
  explanation?: string;
  results: string[];
  tone: "snare" | "jutsu" | "strike" | "summon" | "break";
  motif: "seal" | "shatter" | "recall" | "surge" | "impact";
  cue: ChronicleSfx;
  winner?: Side | "draw";
  terminalOnly?: boolean;
};

export const CHRONICLE_EFFECT_IMPACT_MS = 360;
export function chronicleBeatDuration(event: ChroniclePresentationEvent): number {
  if (event.kind === "duel-ended") return 0;
  if (event.kind === "trap-activated" || event.kind === "magic-activated") return 2_200;
  return event.kind === "attack-declared" || event.kind === "response-passed" ? 1_500 : 1_100;
}

/** Both AI hosts wait for exactly the same beats the board will present. */
export function chronicleReplayDelay(previous: ChronicleProjection | null, next: ChronicleProjection): number {
  if (!next.events) return next.log.at(-1) !== previous?.log.at(-1) ? 1_250 : 350;
  const seen = new Set(previous?.events?.map(event => event.id) ?? []);
  const actions = new Set<string>();
  let duration = 0;
  for (const event of next.events) {
    if (seen.has(event.id) || ["response-opened", "phase-changed", "turn-started", "duel-ended"].includes(event.kind)) continue;
    const id = event.actionId ?? event.id;
    if (actions.has(id)) continue;
    actions.add(id);
    duration += chronicleBeatDuration(event);
  }
  return duration ? duration + 120 : 350;
}

export type ChronicleEffectTarget = {
  side: Side;
  row: "monster" | "backrow" | "health";
  index?: number;
  label: string;
  motif: ChronicleBeat["motif"];
};

/** Target labels describe confirmed results, never just the printed intent. */
export function chronicleEffectTargets(beat: ChronicleBeat): ChronicleEffectTarget[] {
  const targets = new Map<string, ChronicleEffectTarget>();
  const add = (target: ChronicleEffectTarget) => targets.set(`${target.side}:${target.row}:${target.index}`, target);
  for (const zone of beat.event.affectedZones ?? []) {
    const delta = (value: number) => `${value > 0 ? "+" : "−"}${Math.abs(value).toLocaleString()}`;
    const stats = [zone.attackDelta ? `ATK ${delta(zone.attackDelta)}` : "", zone.defenseDelta ? `DEF ${delta(zone.defenseDelta)}` : ""].filter(Boolean).join(" · ");
    add({ side: zone.side, row: zone.row, index: zone.zoneIndex,
      label: zone.change === "returned" ? "RETURNED" : stats || (zone.change === "position" ? "POSITION CHANGED" : "LEFT FIELD"),
      motif: zone.change === "returned" ? "recall" : zone.change === "stats" ? "surge" : "seal" });
  }
  for (const event of beat.events) {
    if (event.kind === "card-destroyed" && event.side) {
      const card = event.cardId ? getChronicleCard(event.cardId) : undefined;
      add({ side: event.side, row: card?.cardClass === "monster" ? "monster" : "backrow", index: event.sourceZoneIndex, label: "DESTROYED", motif: "shatter" });
    }
    if ((event.kind === "damage" || event.kind === "healing") && event.side)
      add({ side: event.side, row: "health", label: `${event.kind === "damage" ? "−" : "+"}${(event.amount ?? 0).toLocaleString()} HP`, motif: event.kind === "damage" ? "impact" : "surge" });
  }
  if (!targets.size && beat.event.targetSide && beat.event.targetZoneIndex != null) {
    const blocked = beat.card?.cardClass === "trap" && /negate|endBattlePhase/.test(beat.card.effect.kind);
    add({ side: beat.event.targetSide, row: beat.card?.cardClass === "magic" && beat.card.effect.targetScope === "opponentMagicTrap" ? "backrow" : "monster",
      index: beat.event.targetZoneIndex, label: blocked ? "ATTACK STOPPED" : beat.tone === "strike" ? "ATTACK" : "TARGET", motif: blocked ? "seal" : beat.motif });
  }
  return [...targets.values()];
}

export function chronicleEventCopy(event: ChroniclePresentationEvent, cards: Record<string, ChronicleDisplayCard>, names: Record<Side, string>): string {
  const actor = event.actor ? names[event.actor] : "A duelist";
  const side = event.side ? names[event.side] : actor;
  const card = event.cardId ? (cards[event.cardId] ?? getChronicleCard(event.cardId))?.name : undefined;
  switch (event.kind) {
    case "monster-summoned": return `${actor} summoned ${card ?? "a Monster"}.`;
    case "monster-set": return `${actor} set ${card ?? "a hidden Monster"}.`;
    case "monster-flipped": return `${actor} Flip Summoned ${card ?? "a Monster"}.`;
    case "position-changed": return `${actor} changed ${card ?? "a Monster"}'s battle position.`;
    case "magic-activated": return `${actor} activated ${card ?? "a Jutsu"}.`;
    case "trap-set": return `${actor} set ${card ?? "a hidden Snare"}.`;
    case "trap-activated": return `${actor} activated ${card ?? "a Snare"}.`;
    case "attack-declared": return `${actor} declared an attack with ${card ?? "a Monster"}.`;
    case "response-opened": return `${actor} can activate a Snare before play continues.`;
    case "response-passed": return `${actor} passed. The pending action continues.`;
    case "card-destroyed": return `${card ?? "A card"} controlled by ${side} was destroyed.`;
    case "damage": return `${side} took ${(event.amount ?? 0).toLocaleString()} damage.`;
    case "healing": return `${side} recovered ${(event.amount ?? 0).toLocaleString()} Health Points.`;
    case "phase-changed": return `${actor} entered ${(event.phase ?? "the next phase").replace(/(\d)/, " $1")}.`;
    case "turn-started": return `Turn ${event.turnNumber} began for ${actor}.`;
    case "duel-ended": return event.winner === "draw" ? "The duel ended in a draw." : `${names[event.winner ?? "p1"]} won the duel.`;
  }
}

/** One committed action is one readable cause → result beat. Older persisted
 * events still work, but never combine separate activations just by timestamp. */
export function chronicleBeats(events: readonly ChroniclePresentationEvent[], cards: Record<string, ChronicleDisplayCard>, names: Record<Side, string>): ChronicleBeat[] {
  const groups: ChroniclePresentationEvent[][] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (event.actionId && previous?.[0].actionId === event.actionId) previous.push(event);
    else groups.push([event]);
  }
  return groups.flatMap((group) => {
    const event = group.find(item => !["response-opened", "phase-changed", "turn-started"].includes(item.kind));
    if (!event) return [];
    const card = event.cardId ? cards[event.cardId] ?? getChronicleCard(event.cardId) : undefined;
    const tone = event.kind === "trap-activated" || event.kind === "trap-set" ? "snare"
      : event.kind === "magic-activated" ? "jutsu"
      : event.kind === "attack-declared" || event.kind === "response-passed" ? "strike"
      : event.kind === "card-destroyed" || event.kind === "damage" ? "break" : "summon";
    const title = event.kind === "trap-activated" ? "Snare revealed" : event.kind === "magic-activated" ? "Jutsu activated"
      : event.kind === "attack-declared" ? "Attack declared" : event.kind === "response-passed" ? "Response passed"
      : event.kind === "trap-set" ? "Snare prepared" : event.kind === "monster-set" ? "Monster set"
      : event.kind === "card-destroyed" ? "Card destroyed" : event.kind === "damage" ? "Damage dealt"
      : event.kind === "healing" ? "Health restored" : event.kind === "duel-ended" ? "Duel complete" : event.kind === "position-changed" ? "Position changed" : "Monster summoned";
    const effectKind = card && card.cardClass !== "monster" ? card.effect.kind : "";
    const motif = /destroy/i.test(effectKind) || tone === "break" ? "shatter"
      : /return|exile/i.test(effectKind) ? "recall"
      : /modify|heal|draw|borrow|weaken/i.test(effectKind) || tone === "jutsu" ? "surge" : tone === "strike" ? "impact" : "seal";
    const outcomes = group.filter((item) => ["card-destroyed", "damage", "healing"].includes(item.kind));
    const destroyed = outcomes.filter(item => item.kind === "card-destroyed").length;
    const results = [
      ...(destroyed > 1 ? [`${destroyed} cards destroyed.`] : []),
      ...outcomes.map((item) => chronicleEventCopy(item, cards, names)),
      ...new Set(group.flatMap(item => item.details ?? [])),
      ...group.filter((item) => item.kind === "response-opened").map((item) => chronicleEventCopy(item, cards, names)),
    ];
    return [{
      id: event.actionId ?? event.id, event, events: group, title, card,
      actor: names[event.actor ?? event.side ?? "p1"], tone, motif,
      winner: group.find(item => item.kind === "duel-ended")?.winner,
      terminalOnly: event.kind === "duel-ended",
      explanation: event.kind === "trap-activated" || event.kind === "magic-activated" ? card?.effectText : undefined,
      results: results.length ? [...new Set(results)] : [chronicleEventCopy(event, cards, names)],
      cue: event.kind === "healing" ? "heal" : event.kind === "trap-activated" ? "snare" : tone === "jutsu" ? "activate"
        : event.kind.endsWith("-set") ? "set" : tone === "strike" ? "attack" : tone === "break" ? "destroy" : "summon",
    } satisfies ChronicleBeat];
  });
}

/** The queue survives projection refreshes. A refresh must not cancel timers
 * or mark an unplayed beat as played. Initial/reconnected history is adopted. */
export class ChronicleBeatQueue {
  private seen: Set<string> | null = null;
  private pending: ChronicleBeat[] = [];
  observe(events: readonly ChroniclePresentationEvent[], cards: Record<string, ChronicleDisplayCard>, names: Record<Side, string>) {
    const fresh = this.seen ? events.filter((event) => !this.seen!.has(event.id)) : [];
    this.seen ??= new Set();
    for (const event of events) this.seen.add(event.id);
    // More than six projected history windows, bounded for very long matches.
    while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.pending.push(...chronicleBeats(fresh, cards, names));
  }
  get length() { return this.pending.length; }
  take() { return this.pending.shift(); }
  clear() {
    const winner = this.pending.findLast(beat => beat.winner)?.winner;
    this.pending = [];
    return winner;
  }
}
