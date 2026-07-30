import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CHRONICLE_FOUNDING_FORMAT,
  CHRONICLE_ROOM_TITLE,
  getChronicleCard,
  STARTING_LIFE_POINTS,
  TURN_TIMEOUT_MS,
  previewChronicleBattle,
  tributeCountForLevel,
  type ChronicleActionIntent,
  type ChronicleDisplayCard,
  type ChroniclePresentationEvent,
  type ChronicleProjection,
} from "../lib/chronicle-duel";
import {
  chronicleSfxMuted,
  classifyChronicleLogLine,
  playChronicleSfx,
  primeChronicleSfx,
  setChronicleSfxMuted,
  type ChronicleSfx,
} from "../lib/chronicle-sfx";
import { chronicleLegalPlacements } from "../lib/chronicle-placements";
import { isImageAvatar } from "../lib/avatar";
import { ChronicleCardView } from "./ChronicleCardView";
import { ChronicleCardInspector } from "./ChronicleCardInspector";
import { Modal } from "./ui/Modal";

type SideKey = "p1" | "p2";
type DuelReaction = {
  side: "me" | "foe";
  kind: "damage" | "heal";
  name: string;
  amount: number;
};
type ResolutionFx = {
  kind: "summon" | "set" | "activate" | "attack" | "destroy";
  label: string;
};

/** A response window reaches the client in the same update as the action that
 *  opened it, so the Summon lands on the board and the "answer this?" prompt
 *  would otherwise appear in the very same frame. One short beat lets the board
 *  and the log read first. Small next to RESPONSE_TIMEOUT_MS (15s), so it never
 *  meaningfully eats the responder's clock. */
const RESPONSE_PROMPT_BEAT_MS = 700;
const SMART_ASSIST_KEY = "chronicleSmartAssist.v1";
const EMPTY_PRESENTATION_EVENTS: ChroniclePresentationEvent[] = [];

function readSmartAssist(): boolean {
  try {
    return window.localStorage.getItem(SMART_ASSIST_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSmartAssist(enabled: boolean): void {
  try {
    window.localStorage.setItem(SMART_ASSIST_KEY, enabled ? "on" : "off");
  } catch {
    /* Private browsing keeps the preference session-local. */
  }
}

/** Restartable one-shot animation class on a live DOM node. Imperative on
 *  purpose: motion is presentation-only and must never re-enter React state
 *  (the compiler lint forbids setState inside effect bodies). */
function pulseFx(
  el: Element | null | undefined,
  cls: string,
  durationMs: number,
): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), durationMs);
}

/** Floating "−N"/"+N" popup anchored at a duelist's health readout. */
function spawnLifeFloat(anchor: HTMLElement | null, delta: number): void {
  if (!anchor || delta === 0) return;
  const float = document.createElement("span");
  float.className = `chronicle-float ${delta < 0 ? "damage" : "heal"}`;
  float.textContent = `${delta < 0 ? "−" : "+"}${Math.abs(delta).toLocaleString()}`;
  anchor.appendChild(float);
  window.setTimeout(() => float.remove(), 1_400);
}

/** A destroyed card leaves a readable visual trail toward its owner's
 * Graveyard instead of disappearing between server projections. */
function spawnCardGhost(
  zone: HTMLElement | null | undefined,
  image: string | undefined,
  side: "me" | "foe",
): void {
  if (!zone || !image) return;
  const ghost = document.createElement("span");
  ghost.className = `chronicle-card-ghost ${side}`;
  ghost.style.backgroundImage = `url(${JSON.stringify(image)})`;
  ghost.setAttribute("aria-hidden", "true");
  zone.appendChild(ghost);
  window.setTimeout(() => ghost.remove(), 820);
}

function resolutionCopy(
  cue: ChronicleSfx,
  line: string,
): ResolutionFx | null {
  if (cue === "summon")
    return {
      kind: "summon",
      label: /sets a monster/i.test(line) ? "SHADOW SET" : "SHINOBI SUMMON",
    };
  if (cue === "set") return { kind: "set", label: "SNARE PREPARED" };
  if (cue === "activate")
    return { kind: "activate", label: "JUTSU RELEASE" };
  if (cue === "attack") return { kind: "attack", label: "STRIKE" };
  if (cue === "destroy") return { kind: "destroy", label: "BREAK" };
  return null;
}

function presentationForEvent(
  event: ChroniclePresentationEvent,
): { cue: ChronicleSfx; fx: ResolutionFx } | null {
  if (event.kind === "monster-summoned" || event.kind === "monster-flipped")
    return {
      cue: "summon",
      fx: { kind: "summon", label: "SHINOBI SUMMON" },
    };
  if (event.kind === "monster-set" || event.kind === "trap-set")
    return {
      cue: "set",
      fx: {
        kind: "set",
        label: event.kind === "monster-set" ? "SHADOW SET" : "SNARE PREPARED",
      },
    };
  if (event.kind === "magic-activated" || event.kind === "trap-activated")
    return {
      cue: "activate",
      fx: {
        kind: "activate",
        label:
          event.kind === "trap-activated" ? "SNARE RELEASE" : "JUTSU RELEASE",
      },
    };
  if (event.kind === "attack-declared")
    return { cue: "attack", fx: { kind: "attack", label: "STRIKE" } };
  if (event.kind === "card-destroyed")
    return { cue: "destroy", fx: { kind: "destroy", label: "BREAK" } };
  return null;
}

function eventTimelineCopy(
  event: ChroniclePresentationEvent,
  cardsById: Record<string, ChronicleDisplayCard>,
  names: Record<SideKey, string>,
): string {
  const actorName = event.actor ? names[event.actor] : undefined;
  const sideName = event.side ? names[event.side] : undefined;
  const cardName = event.cardId
    ? (cardsById[event.cardId] ?? getChronicleCard(event.cardId))?.name
    : undefined;
  switch (event.kind) {
    case "monster-summoned":
      return `${actorName} summoned ${cardName ?? "a Monster"}.`;
    case "monster-set":
      return `${actorName} set ${cardName ?? "a hidden Monster"}.`;
    case "monster-flipped":
      return `${actorName} Flip Summoned ${cardName ?? "a Monster"}.`;
    case "position-changed":
      return `${actorName} changed ${cardName ?? "a Monster"}'s battle position.`;
    case "magic-activated":
      return `${actorName} activated ${cardName ?? "a Jutsu"}.`;
    case "trap-set":
      return `${actorName} set ${cardName ?? "a hidden Snare"}.`;
    case "trap-activated":
      return `${actorName} activated ${cardName ?? "a Snare"}.`;
    case "attack-declared":
      return `${actorName} declared an attack with ${cardName ?? "a Monster"}.`;
    case "response-opened":
      return `${actorName} received a Snare response window.`;
    case "response-passed":
      return `${actorName} passed the Snare response.`;
    case "card-destroyed":
      return `${cardName ?? "A card"} controlled by ${sideName} was destroyed.`;
    case "damage":
      return `${sideName} took ${(event.amount ?? 0).toLocaleString()} damage.`;
    case "healing":
      return `${sideName} recovered ${(event.amount ?? 0).toLocaleString()} Health Points.`;
    case "phase-changed":
      return `${actorName} entered ${(event.phase ?? "the next phase").replace(/(\d)/, " $1")}.`;
    case "turn-started":
      return `Turn ${event.turnNumber} began for ${actorName}.`;
    case "duel-ended":
      return event.winner === "draw"
        ? "The duel ended in a draw."
        : `${names[event.winner ?? "p1"]} won the duel.`;
  }
}

/** Health Points readout that ticks toward its target instead of jumping.
 *  Interval-driven rather than rAF so it still advances when the tab is not
 *  compositing frames (backgrounded tab, embedded pane). */
function AnimatedNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const startedAt = performance.now();
    const duration = 600;
    const interval = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (t >= 1) window.clearInterval(interval);
    }, 40);
    return () => window.clearInterval(interval);
  }, [value]);
  return <>{shown.toLocaleString()}</>;
}

function avatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1)
    return `${parts[0][0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "SJ").toUpperCase();
}

function ChronicleDuelistAvatar({
  name,
  avatar,
  opponent = false,
}: {
  name: string;
  avatar?: string;
  opponent?: boolean;
}) {
  return (
    <div
      className={`chronicle-duelist-avatar ${opponent ? "opponent" : "player"}`}
      aria-label={`${name} avatar`}
    >
      <span aria-hidden="true">{avatarInitials(name)}</span>
      {isImageAvatar(avatar) ? (
        <img
          src={avatar}
          alt={`${name} portrait`}
          onError={(event) => event.currentTarget.remove()}
        />
      ) : null}
    </div>
  );
}

export function ChronicleDuelBoard({
  state,
  cardsById,
  playerAvatar,
  opponentAvatar,
  busy,
  aiActing,
  timedTurns,
  error,
  onExit,
  exitLabel = "Leave table",
  onAction,
}: {
  state: ChronicleProjection;
  cardsById: Record<string, ChronicleDisplayCard>;
  playerAvatar?: string;
  opponentAvatar?: string;
  busy?: boolean;
  aiActing?: boolean;
  /** Show the turn countdown only where the server actually enforces it
   *  (live PvP). AI duels have no deadline, so no fake pressure clock. */
  timedTurns?: boolean;
  error?: string;
  onExit?: () => void;
  exitLabel?: string;
  onAction: (intent: ChronicleActionIntent) => void;
}) {
  useEffect(() => {
    primeChronicleSfx();
  }, []);
  const meKey = state.viewerSide;
  const foeKey: SideKey = meKey === "p1" ? "p2" : "p1";
  const me = state[meKey];
  const foe = state[foeKey];
  const [handIndex, setHandIndex] = useState<number | null>(null);
  const [destination, setDestination] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [tributes, setTributes] = useState<number[]>([]);
  const [attacker, setAttacker] = useState<number | null>(null);
  const [fieldMonster, setFieldMonster] = useState<number | null>(null);
  const [graveyardIndex, setGraveyardIndex] = useState<number | null>(null);
  // A card the duelist is reading (any face-up card on the table, either
  // side, any phase) — feeds the CARD DETAILS panel without touching the
  // targeting/selection state machine.
  const [inspect, setInspect] = useState<{
    cardId: string;
    zoneKey: string;
  } | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [zoomedCardId, setZoomedCardId] = useState<string | null>(null);
  // Which graveyard pile is open for browsing. Piles are face-up public
  // information in this format, so either side's is readable at any time.
  const [graveyardView, setGraveyardView] = useState<"me" | "foe" | null>(null);
  const [forfeitArmed, setForfeitArmed] = useState(false);
  const [duelMenuOpen, setDuelMenuOpen] = useState(false);
  const [smartAssist, setSmartAssist] = useState(readSmartAssist);
  const [readyResponseId, setReadyResponseId] = useState<string | null>(null);
  const [sfxMuted, setSfxMuted] = useState(chronicleSfxMuted);
  const [resolutionFx, setResolutionFx] = useState<ResolutionFx | null>(null);
  const [reaction, setReaction] = useState<DuelReaction | null>(null);
  // Opening splash: only a genuinely fresh duel (turn 1) gets the banner —
  // a resumed mid-duel board must not replay it.
  const [showIntro, setShowIntro] = useState(
    () => state.turnNumber === 1 && state.status === "active",
  );
  const [outcome, setOutcome] = useState<
    "victory" | "defeat" | "draw" | null
  >(null);
  const playmatRef = useRef<HTMLDivElement | null>(null);
  const duelMenuRef = useRef<HTMLDivElement | null>(null);
  const duelMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const foeMonsterRowRef = useRef<HTMLDivElement | null>(null);
  const meFloatRef = useRef<HTMLSpanElement | null>(null);
  const foeFloatRef = useRef<HTMLSpanElement | null>(null);
  const zoneEls = useRef(new Map<string, HTMLButtonElement>());
  const prevStateRef = useRef<ChronicleProjection | null>(null);
  const reactionStateRef = useRef<ChronicleProjection | null>(null);
  const seenLogTail = useRef<string | undefined>(undefined);
  const seenEventIds = useRef<Set<string> | null>(null);
  const seenStatus = useRef<string | undefined>(undefined);
  const smartAdvanceKey = useRef<string | null>(null);
  const zoneRef = (zoneKey: string) => (el: HTMLButtonElement | null) => {
    if (el) zoneEls.current.set(zoneKey, el);
    else zoneEls.current.delete(zoneKey);
  };
  const selectedId = handIndex === null ? undefined : me.hand?.[handIndex];
  const selected = selectedId
    ? (cardsById[selectedId] ?? getChronicleCard(selectedId))
    : undefined;
  const inspectedId = inspect?.cardId ?? selectedId;
  const inspected = inspectedId
    ? (cardsById[inspectedId] ?? getChronicleCard(inspectedId))
    : undefined;
  const zoomedCard = zoomedCardId
    ? (cardsById[zoomedCardId] ?? getChronicleCard(zoomedCardId))
    : undefined;
  const selectedIsFieldCard =
    selected?.cardClass === "magic" && selected.magicType === "field";
  const opponentHandBacks = Array.from({
    length: Math.min(foe.handCount, 8),
  });
  const myTurn =
    state.activePlayer === meKey &&
    !state.responseWindow &&
    state.status === "active";
  const main = state.phase === "main1" || state.phase === "main2";
  const phaseIndex = CHRONICLE_FOUNDING_FORMAT.phases.findIndex(
    (phase) => phase.id === state.phase,
  );
  const phaseMeta = CHRONICLE_FOUNDING_FORMAT.phases[phaseIndex];

  const requiredTributes =
    selected?.cardClass === "monster"
      ? tributeCountForLevel(selected.level)
      : 0;
  // Card-first placement: lifting a card out of hand lights up every zone it
  // could legally enter, so the board answers "where does this go?" before a
  // slot is committed.
  const placements = chronicleLegalPlacements(state, selected);
  const placingMonster = placements.mode === "monster";
  const placingTrap = placements.mode === "trap";
  const magicTargetScope =
    selected?.cardClass === "magic" ? selected.effect.targetScope : "none";
  const targetsOwnedMonster = magicTargetScope === "ownedFaceUpMonster";
  const targetsOpponentMonster =
    magicTargetScope === "opponentMonster" ||
    magicTargetScope === "opponentLevel4OrLowerMonster" ||
    magicTargetScope === "anyFaceUpMonster";
  const targetsOpponentBackrow = magicTargetScope === "opponentMagicTrap";
  const targetsGraveyard =
    magicTargetScope === "ownGraveyardLevel4OrLowerMonster" ||
    magicTargetScope === "ownGraveyardMagic" ||
    magicTargetScope === "ownGraveyardFieldMagic";
  const legalOpponentMagicTarget = (
    monster: (typeof foe.monsterZones)[number],
  ) => {
    if (!monster || selected?.cardClass !== "magic") return false;
    if (
      magicTargetScope === "anyFaceUpMonster" ||
      selected.effect.kind === "changeOneMonsterPosition"
    )
      return monster.faceUp;
    if (magicTargetScope === "opponentLevel4OrLowerMonster")
      return (
        monster.faceUp &&
        typeof monster.level === "number" &&
        monster.level <= 4
      );
    if (selected.effect.kind === "destroyLowDefenseMonster")
      return (
        monster.faceUp &&
        typeof monster.defense === "number" &&
        monster.defense <= (selected.effect.cap ?? 1_000)
      );
    return magicTargetScope === "opponentMonster";
  };
  const legalOwnedMagicTarget = (
    monster: (typeof me.monsterZones)[number],
  ) =>
    Boolean(
      monster?.faceUp &&
        selected?.cardClass === "magic" &&
        magicTargetScope === "ownedFaceUpMonster" &&
        (selected.magicType !== "equip" || !monster.attachedEquipId),
    );
  const legalGraveyardTarget = (id: string) => {
    if (selected?.cardClass !== "magic") return false;
    const candidate = cardsById[id] ?? getChronicleCard(id);
    if (magicTargetScope === "ownGraveyardMagic")
      return candidate?.cardClass === "magic";
    if (magicTargetScope === "ownGraveyardFieldMagic")
      return candidate?.cardClass === "magic" && candidate.magicType === "field";
    if (magicTargetScope === "ownGraveyardLevel4OrLowerMonster")
      return (
        candidate?.cardClass === "monster" &&
        candidate.level <= 4 &&
        (selected.effect.kind !== "reviveLevel4OrLowerNormalMonster" ||
          candidate.monsterType === "normal")
      );
    return false;
  };
  const selectedMagicNeedsOpenMonsterZone =
    selected?.cardClass === "magic" &&
    (selected.effect.kind === "reviveLevel4OrLowerMonster" ||
      selected.effect.kind === "reviveLevel4OrLowerNormalMonster");
  const selectedMagicTargetReady =
    selected?.cardClass === "magic" &&
    (magicTargetScope === "none" ||
      (targetsOwnedMonster &&
        target !== null &&
        legalOwnedMagicTarget(me.monsterZones[target])) ||
      (targetsOpponentMonster &&
        target !== null &&
        legalOpponentMagicTarget(foe.monsterZones[target])) ||
      (targetsOpponentBackrow &&
        target !== null &&
        Boolean(foe.magicTrapZones[target])) ||
      (targetsGraveyard &&
        graveyardIndex !== null &&
        Boolean(me.graveyard[graveyardIndex]) &&
        legalGraveyardTarget(me.graveyard[graveyardIndex])));
  const deadline =
    state.responseWindow?.expiresAt ?? state.turnStartedAt + TURN_TIMEOUT_MS;
  const secondsRemaining = Math.max(0, Math.ceil((deadline - clock) / 1_000));
  const fieldStyle = state.activeField
    ? ({
        "--chronicle-field-art": `url("${state.activeField.image}")`,
      } as CSSProperties)
    : undefined;
  const healthStyle = (points: number) =>
    ({
      "--chronicle-health": `${Math.max(0, Math.min(100, (points / STARTING_LIFE_POINTS) * 100))}%`,
    }) as CSSProperties;
  const arenaStyle = { ...fieldStyle } as CSSProperties;
  const attackingMonster =
    attacker === null ? null : me.monsterZones[attacker];
  const directAttackPower =
    attackingMonster?.faceUp && attackingMonster.attack !== undefined
      ? attackingMonster.attack
      : null;
  const availableAttackers = me.monsterZones.filter(
    (monster) => monster?.canAttack,
  ).length;
  const smartAssistPending =
    smartAssist &&
    myTurn &&
    !busy &&
    state.phase === "battle" &&
    availableAttackers === 0;
  const presentationEvents = state.events ?? EMPTY_PRESENTATION_EVENTS;
  const duelistNames: Record<SideKey, string> = {
    [meKey]: me.name,
    [foeKey]: foe.name,
  } as Record<SideKey, string>;

  useEffect(() => {
    if (!timedTurns) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [timedTurns]);

  useEffect(() => {
    if (!forfeitArmed) return;
    const timer = window.setTimeout(() => setForfeitArmed(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [forfeitArmed]);

  useEffect(() => {
    if (!duelMenuOpen) return;
    const focusTimer = window.setTimeout(
      () => duelMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      0,
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDuelMenuOpen(false);
      duelMenuTriggerRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (
        targetNode &&
        !duelMenuRef.current?.contains(targetNode) &&
        !duelMenuTriggerRef.current?.contains(targetNode)
      )
        setDuelMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [duelMenuOpen]);

  // Arms the response prompt one beat after its window opens. The id is only
  // written from the timer callback — never in the effect body — and a closed
  // window stops matching on its own, so no reset write is needed.
  const responseWindowId = state.responseWindow?.id;
  useEffect(() => {
    if (!responseWindowId) return;
    const timer = window.setTimeout(
      () => setReadyResponseId(responseWindowId),
      RESPONSE_PROMPT_BEAT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [responseWindowId]);

  const logTail = state.log.at(-1);
  const logBeforeTail = state.log.at(-2);
  useEffect(() => {
    const seen = seenEventIds.current;
    if (!seen) {
      seenEventIds.current = new Set(
        presentationEvents.map((event) => event.id),
      );
      return;
    }
    const freshEvents = presentationEvents.filter(
      (event) => !seen.has(event.id),
    );
    for (const event of freshEvents) seen.add(event.id);
    const beats = freshEvents
      .map(presentationForEvent)
      .filter(
        (
          beat,
        ): beat is {
          cue: ChronicleSfx;
          fx: ResolutionFx;
        } => Boolean(beat),
      )
      .slice(-3);
    if (beats.length === 0) return;
    const timers: number[] = [];
    beats.forEach((beat, index) => {
      timers.push(
        window.setTimeout(() => {
          playChronicleSfx(beat.cue);
          setResolutionFx(beat.fx);
          if (beat.cue === "destroy") {
            const mat = playmatRef.current;
            if (mat) pulseFx(mat, "impact", 450);
          }
        }, index * 420),
      );
    });
    timers.push(
      window.setTimeout(
        () => setResolutionFx(null),
        beats.length * 420 + 560,
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [presentationEvents]);

  useEffect(() => {
    // Persisted pre-event sessions retain the log classifier as a fallback.
    // New matches use the typed event stream above.
    if (state.events !== undefined) {
      seenLogTail.current = logTail;
      return;
    }
    // First render of a board (or a resumed duel) just adopts the current
    // tail — cues only fire for lines that appear while the player watches.
    const primedTail = seenLogTail.current;
    seenLogTail.current = logTail;
    if (primedTail === undefined || logTail === undefined) return;
    if (logTail === primedTail) return;
    // A response prompt always lands directly behind the Summon or attack that
    // opened its window, so cue on that event instead: the prompt is an
    // invitation, not a beat, and it must not mute what it is asking about.
    const resolvedLine = /may respond/i.test(logTail)
      ? (logBeforeTail ?? logTail)
      : logTail;
    const cue = classifyChronicleLogLine(resolvedLine);
    if (cue) playChronicleSfx(cue);
    const cinematic = cue ? resolutionCopy(cue, resolvedLine) : null;
    const showCinematic = cinematic
      ? window.setTimeout(() => setResolutionFx(cinematic), 0)
      : undefined;
    const hideCinematic = cinematic
      ? window.setTimeout(
          () => setResolutionFx(null),
          cinematic.kind === "attack" || cinematic.kind === "destroy"
            ? 920
            : 760,
        )
      : undefined;
    let impactTimer: number | undefined;
    if (cue === "destroy") {
      // Imperative class toggle (not state): restarts the CSS animation
      // cleanly on back-to-back destructions.
      const mat = playmatRef.current;
      if (mat) {
        mat.classList.remove("impact");
        void mat.offsetWidth;
        mat.classList.add("impact");
        impactTimer = window.setTimeout(() => mat.classList.remove("impact"), 450);
      }
    }
    return () => {
      if (showCinematic !== undefined) window.clearTimeout(showCinematic);
      if (hideCinematic !== undefined) window.clearTimeout(hideCinematic);
      if (impactTimer !== undefined) window.clearTimeout(impactTimer);
    };
  }, [state.events, logTail, logBeforeTail]);

  useEffect(() => {
    const previous = seenStatus.current;
    seenStatus.current = state.status;
    if (previous !== "active" || state.status !== "complete") return;
    playChronicleSfx(state.winner === meKey ? "victory" : "defeat");
    const kind =
      state.winner === meKey
        ? "victory"
        : state.winner === "draw"
          ? "draw"
          : "defeat";
    const show = window.setTimeout(() => setOutcome(kind), 30);
    const hide = window.setTimeout(() => setOutcome(null), 2_650);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [state.status, state.winner, meKey]);

  useEffect(() => {
    if (!showIntro) return;
    const timer = window.setTimeout(() => setShowIntro(false), 2_100);
    return () => window.clearTimeout(timer);
  }, [showIntro]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHandIndex(null);
      setDestination(null);
      setTarget(null);
      setTributes([]);
      setAttacker(null);
      setFieldMonster(null);
      setGraveyardIndex(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state.turnNumber, state.activePlayer]);

  useEffect(() => {
    if (!smartAssistPending) return;
    const key = `${state.turnNumber}:${state.activePlayer}:battle-complete`;
    if (smartAdvanceKey.current === key) return;
    const timer = window.setTimeout(() => {
      smartAdvanceKey.current = key;
      setAttacker(null);
      setTarget(null);
      onAction({ action: "enter-main-2" });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [
    smartAssistPending,
    state.turnNumber,
    state.activePlayer,
    onAction,
  ]);

  // Card motion layer: diff successive projections (player actions and each
  // replayed AI step arrive as separate states) and pulse zone-level
  // animations for what changed. Purely presentational, all imperative.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev || prev === state) return;
    if (state.turnNumber < prev.turnNumber) return; // different duel
    const sides = [
      { sideKey: meKey, prefix: "me", floatAnchor: meFloatRef.current },
      { sideKey: foeKey, prefix: "foe", floatAnchor: foeFloatRef.current },
    ] as const;
    for (const { sideKey, prefix, floatAnchor } of sides) {
      const now = state[sideKey];
      const before = prev[sideKey];
      now.monsterZones.forEach((monster, index) => {
        const was = before.monsterZones[index];
        const el = zoneEls.current.get(`${prefix}-monster-${index}`);
        if (monster && (!was || was.instanceId !== monster.instanceId))
          pulseFx(el, "fx-arrive", 540);
        else if (monster && was && !was.faceUp && monster.faceUp)
          pulseFx(el, "fx-flip", 500);
        else if (!monster && was) {
          const card = was.cardId
            ? (cardsById[was.cardId] ?? getChronicleCard(was.cardId))
            : undefined;
          spawnCardGhost(el, card?.image, prefix);
          pulseFx(el, "fx-destroyed", 580);
        }
      });
      now.magicTrapZones.forEach((zone, index) => {
        const was = before.magicTrapZones[index];
        const el = zoneEls.current.get(`${prefix}-backrow-${index}`);
        if (zone && (!was || was.instanceId !== zone.instanceId))
          pulseFx(el, "fx-arrive", 540);
        else if (zone && was && !was.faceUp && zone.faceUp)
          pulseFx(el, "fx-flip", 500);
        else if (!zone && was) {
          const card = was.cardId
            ? (cardsById[was.cardId] ?? getChronicleCard(was.cardId))
            : undefined;
          spawnCardGhost(el, card?.image, prefix);
          pulseFx(el, "fx-destroyed", 580);
        }
      });
      spawnLifeFloat(floatAnchor, now.lifePoints - before.lifePoints);
    }
    // The Keeper's strikes name no attacker zone in the log, so its whole
    // Monster row presses toward the player for the beat instead. One action
    // can log several lines (Damage Step + destruction), so scan the recent
    // tail rather than only the very last line.
    const tail = state.log.at(-1) ?? "";
    if (
      tail !== (prev.log.at(-1) ?? "") &&
      /damage step/i.test(state.log.slice(-3).join(" ")) &&
      state.activePlayer === foeKey
    )
      pulseFx(foeMonsterRowRef.current, "fx-row-strike", 440);
  }, [state, meKey, foeKey, cardsById]);

  useEffect(() => {
    const previous = reactionStateRef.current;
    reactionStateRef.current = state;
    if (!previous || previous === state) return;
    const meDelta = me.lifePoints - previous[meKey].lifePoints;
    const foeDelta = foe.lifePoints - previous[foeKey].lifePoints;
    const changed =
      meDelta !== 0
        ? {
            side: "me" as const,
            kind: meDelta < 0 ? ("damage" as const) : ("heal" as const),
            name: me.name,
            amount: Math.abs(meDelta),
          }
        : foeDelta !== 0
          ? {
              side: "foe" as const,
              kind: foeDelta < 0 ? ("damage" as const) : ("heal" as const),
              name: foe.name,
              amount: Math.abs(foeDelta),
            }
          : null;
    if (!changed) return;
    const show = window.setTimeout(() => setReaction(changed), 0);
    const hide = window.setTimeout(() => setReaction(null), 1_450);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [state, me, foe, meKey, foeKey]);

  useEffect(() => {
    if (!zoomedCard) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedCardId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [zoomedCard]);

  function chooseHand(index: number) {
    setHandIndex(handIndex === index ? null : index);
    setDestination(null);
    setTarget(null);
    setTributes([]);
    setAttacker(null);
    setFieldMonster(null);
    setGraveyardIndex(null);
    setInspect(null);
  }
  function toggleTribute(index: number) {
    setTributes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].slice(-requiredTributes),
    );
  }
  function act(intent: ChronicleActionIntent) {
    onAction(intent);
    setHandIndex(null);
    setDestination(null);
    setTarget(null);
    setTributes([]);
    setAttacker(null);
    setFieldMonster(null);
    setGraveyardIndex(null);
    setInspect(null);
    setForfeitArmed(false);
    setDuelMenuOpen(false);
  }

  const responseForMe =
    state.responseWindow?.responder === meKey &&
    readyResponseId === responseWindowId;
  const responseOwner = state.responseWindow
    ? state[state.responseWindow.responder].name
    : null;
  return (
    <section
      className={`chronicle-table ${state.activeField ? "has-field" : ""} ${aiActing ? "ai-acting" : ""} ${attacker !== null ? "targeting-attack" : ""} ${resolutionFx ? `resolving-${resolutionFx.kind}` : ""} ${inspected ? "inspector-open" : ""}`}
      style={arenaStyle}
      data-field={state.activeField?.fieldId ?? "neutral"}
      data-attacker={attacker ?? undefined}
      aria-label="Shinobi Journey Chronicle Showdown board"
    >
      <div className="chronicle-room-banner">
        <span>CODEX HALL</span>
        <strong>{CHRONICLE_ROOM_TITLE}</strong>
        <div className="chronicle-room-banner__actions">
          <small>Founding card pool · Sealed Limited Scroll</small>
          {onExit ? (
            <button type="button" onClick={onExit}>
              {exitLabel}
            </button>
          ) : null}
        </div>
      </div>
      <div className="chronicle-sr-only" aria-live="polite">
        {attacker !== null && attackingMonster?.cardId
          ? `${(cardsById[attackingMonster.cardId] ?? getChronicleCard(attackingMonster.cardId))?.name ?? "Monster"} selected to attack. Focus an opponent Monster to hear its projected visible-stat outcome.`
          : smartAssistPending
            ? "All legal attacks are complete. Smart Phase Assist is moving to Main Phase 2."
            : state.responseWindow
              ? `${responseOwner} has Snare priority.`
              : ""}
      </div>
      <header className="chronicle-duel-status">
        <div className="chronicle-combatant">
          <ChronicleDuelistAvatar
            name={foe.name}
            avatar={opponentAvatar}
            opponent
          />
          <div className="chronicle-combatant__identity">
            <span className="eyebrow">OPPONENT</span>
            <strong>{foe.name}</strong>
            <div className="chronicle-combatant__health">
              <b>
                <AnimatedNumber value={foe.lifePoints} /> <small>HP</small>
              </b>
              <span
                className="chronicle-health-meter"
                style={healthStyle(foe.lifePoints)}
                aria-label={`${foe.lifePoints.toLocaleString()} Health Points`}
              />
              <span
                className="chronicle-float-anchor"
                ref={foeFloatRef}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
        <div className="chronicle-turn">
          <b>TURN {state.turnNumber}</b>
          <span>
            {phaseMeta?.label.toUpperCase() ?? state.phase.toUpperCase()}
            {timedTurns ? ` | ${secondsRemaining}s` : ""}
          </span>
          {state.responseWindow ? <em>SNARE RESPONSE</em> : null}
          {aiActing ? (
            <em className="chronicle-ai-acting" aria-live="polite">
              {foe.name} is acting
              <i />
              <i />
              <i />
            </em>
          ) : null}
        </div>
        <div>
          <span>Hand {foe.handCount}</span>
          <span>Deck {foe.deckCount}</span>
          <span>Grave {foe.graveyard.length}</span>
        </div>
      </header>
      <div className="chronicle-opponent-hand" aria-label="Opponent hand">
        {opponentHandBacks.map((_, index) => (
          <div className="chronicle-opponent-hand__card" key={index}>
            <ChronicleCardView hidden compact />
          </div>
        ))}
        {foe.handCount > opponentHandBacks.length ? (
          <b>+{foe.handCount - opponentHandBacks.length}</b>
        ) : null}
      </div>
      <ol
        className="chronicle-phase-rail"
        aria-label="Turn phases"
        style={
          {
            "--chronicle-phase-progress": `${((Math.max(0, phaseIndex) + 0.5) / CHRONICLE_FOUNDING_FORMAT.phases.length) * 100}%`,
          } as CSSProperties
        }
      >
        {CHRONICLE_FOUNDING_FORMAT.phases.map((phase, index) => {
          return (
            <li
              key={phase.id}
              className={`${
                index === phaseIndex
                  ? "active"
                  : index < phaseIndex
                    ? "passed"
                    : ""
              }`}
              aria-current={index === phaseIndex ? "step" : undefined}
            >
              <b>{phase.shortLabel}</b>
              <span>{phase.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="chronicle-duel-stage">
        {inspected ? (
          <aside
            className="chronicle-card-detail-panel open"
            aria-label="Card details"
          >
            <div className="chronicle-card-detail-panel__header">
              <span className="eyebrow">CARD DETAILS</span>
              <button
                type="button"
                aria-label="Close card details"
                onClick={() => {
                  setInspect(null);
                  setHandIndex(null);
                  setFieldMonster(null);
                  setAttacker(null);
                  setTarget(null);
                }}
              >
                Close
              </button>
            </div>
            <button
              type="button"
              className="chronicle-card-detail-panel__zoom"
              onClick={() => setZoomedCardId(inspected.id)}
              aria-label={`Enlarge ${inspected.name}`}
            >
              <ChronicleCardView card={inspected} />
              <span>Open readable card</span>
            </button>
            <strong>{inspected.name}</strong>
            <small>
              {inspected.cardClass === "monster"
                ? `Level ${inspected.level} ${inspected.element} ${inspected.monsterType} Monster`
                : `${inspected.cardClass === "magic" ? inspected.magicType : inspected.trapType} ${inspected.cardClass}`}
            </small>
          </aside>
        ) : null}

        <div
          className={`chronicle-playmat ${attacker !== null ? "targeting" : ""}`}
          ref={playmatRef}
        >
          <div className="chronicle-atmosphere" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <i key={index} style={{ "--particle": index } as CSSProperties} />
            ))}
          </div>
          {attacker !== null ? (
            <span className="chronicle-targeting-lane" aria-hidden="true" />
          ) : null}
          {resolutionFx ? (
            <div
              className={`chronicle-resolution-fx ${resolutionFx.kind}`}
              aria-hidden="true"
            >
              <i />
              <b>{resolutionFx.label}</b>
            </div>
          ) : null}
          <span className="chronicle-side-label opponent">OPPONENT FIELD</span>
          <div
            className="chronicle-zone-row opponent backrow"
            aria-label="Opponent Jutsu and Snare Zones"
          >
            {foe.magicTrapZones.map((zone, index) => {
              const zoneKey = `foe-backrow-${index}`;
              const canTarget = myTurn && targetsOpponentBackrow && Boolean(zone);
              const canInspect = Boolean(zone?.cardId);
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone ${targetsOpponentBackrow && zone ? "legal-target" : ""} ${targetsOpponentBackrow && target === index ? "selected" : ""} ${!canTarget && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
                  key={index}
                  onClick={() => {
                    if (canTarget) {
                      setInspect(null);
                      setTarget(index);
                    } else if (zone?.cardId)
                      setInspect({ cardId: zone.cardId, zoneKey });
                  }}
                  disabled={!canTarget && !canInspect}
                >
                  {zone ? (
                    <ChronicleCardView
                      card={zone.cardId ? cardsById[zone.cardId] : undefined}
                      hidden={!zone.cardId}
                      compact
                    />
                  ) : (
                    <span>JUTSU/SNARE {index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="chronicle-zone-row opponent"
            aria-label="Opponent Monster Zones"
            ref={foeMonsterRowRef}
          >
            {foe.monsterZones.map((monster, index) => {
              const zoneKey = `foe-monster-${index}`;
              const legalMagicTarget = legalOpponentMagicTarget(monster);
              const preview =
                attacker !== null
                  ? previewChronicleBattle(state, attacker, index)
                  : null;
              const previewId = `chronicle-target-preview-${index}`;
              // With an attacker armed, clicking an enemy Monster strikes it
              // immediately — no separate confirm button.
              const attackTarget =
                myTurn &&
                state.phase === "battle" &&
                attacker !== null &&
                Boolean(monster) &&
                preview?.legal !== false;
              const magicTarget =
                myTurn &&
                targetsOpponentMonster &&
                legalMagicTarget &&
                Boolean(monster);
              const canInspect = Boolean(monster?.cardId);
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone monster-zone ${monster?.position === "defense" ? "defense-position" : "attack-position"} ${magicTarget || attackTarget ? "legal-target" : ""} ${target === index && magicTarget ? "selected" : ""} ${!attackTarget && !magicTarget && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
                  key={index}
                  aria-describedby={
                    attacker !== null && monster && preview
                      ? previewId
                      : undefined
                  }
                  onClick={() => {
                    if (attackTarget) {
                      pulseFx(
                        zoneEls.current.get(`me-monster-${attacker!}`),
                        "fx-strike-up",
                        420,
                      );
                      act({
                        action: "attack",
                        attackerZoneIndex: attacker!,
                        targetZoneIndex: index,
                      });
                    } else if (magicTarget) {
                      setInspect(null);
                      setTarget(index);
                    } else if (monster?.cardId)
                      setInspect({ cardId: monster.cardId, zoneKey });
                  }}
                  disabled={!attackTarget && !magicTarget && !canInspect}
                >
                  {monster ? (
                    <>
                      <ChronicleCardView
                        card={
                          monster.cardId ? cardsById[monster.cardId] : undefined
                        }
                        hidden={!monster.cardId}
                        compact
                      />
                      <small>
                        {monster.position === "attack" ? "ATK" : "DEF"}
                        {monster.faceUp && monster.attack !== undefined
                          ? ` | ${monster.position === "attack" ? monster.attack : monster.defense}`
                          : " | HIDDEN"}
                      </small>
                      {attacker !== null && preview ? (
                        <span
                          id={previewId}
                          className={`chronicle-target-preview ${preview.kind}`}
                          title={preview.note}
                        >
                          {preview.label}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span>MONSTER {index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="chronicle-field-divider">
            <div
              className={`chronicle-field-zone ${state.activeField ? "active" : ""} ${selectedIsFieldCard ? "ready" : ""}`}
              aria-label="Field Card Zone"
            >
              <div className="chronicle-field-zone__label">
                <span>FIELD ZONE</span>
                <small>Shared environment</small>
              </div>
              {state.activeField ? (
                <div className="chronicle-active-field">
                  <ChronicleCardView
                    card={cardsById[state.activeField.cardId]}
                    compact
                    selected={inspect?.zoneKey === "field"}
                    onClick={() =>
                      setInspect({
                        cardId: state.activeField!.cardId,
                        zoneKey: "field",
                      })
                    }
                  />
                  <span>
                    <strong>{state.activeField.name}</strong>
                    <small>
                      {state.activeField.boostElement} +
                      {state.activeField.attackBonus} ATK |{" "}
                      {state.activeField.penaltyElement}{" "}
                      {state.activeField.attackPenalty} ATK
                    </small>
                  </span>
                </div>
              ) : (
                <div className="chronicle-field-zone__empty">
                  {selectedIsFieldCard
                    ? "Ready to activate"
                    : "Neutral Field • +200 elemental advantage wheel"}
                </div>
              )}
            </div>
            <div className="chronicle-battle-message" aria-live="polite">
              <span className="eyebrow">LATEST ACTION</span>
              <strong
                key={
                  presentationEvents.at(-1)?.id ??
                  `${state.log.length}-${state.log.at(-1) ?? ""}`
                }
              >
                {presentationEvents.length
                  ? eventTimelineCopy(
                      presentationEvents.at(-1)!,
                      cardsById,
                      duelistNames,
                    )
                  : (state.log.at(-1) ?? "The duel begins.")}
              </strong>
            </div>
          </div>

          <div
            className="chronicle-zone-row player"
            aria-label="Your Monster Zones"
          >
            {me.monsterZones.map((monster, index) => {
              const zoneKey = `me-monster-${index}`;
              const legalMagicTarget = legalOwnedMagicTarget(monster);
              const blockedByMagicSelection =
                selected?.cardClass === "magic" &&
                (!targetsOwnedMonster || !legalMagicTarget);
              const canInspect = Boolean(monster?.cardId);
              const attackCandidate =
                myTurn &&
                state.phase === "battle" &&
                attacker === null &&
                Boolean(monster?.canAttack);
              // An open zone is somewhere the picked Monster can land; an
              // occupied one is a Tribute candidate when its Level demands one.
              const placementTarget = placements.monsterZones.includes(index);
              const tributeTarget = placements.tributeZones.includes(index);
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone monster-zone ${monster?.position === "defense" ? "defense-position" : "attack-position"} ${placementTarget || tributeTarget || (targetsOwnedMonster && legalMagicTarget) || attackCandidate ? "legal-target" : ""} ${attackCandidate ? "attack-candidate" : ""} ${placementTarget ? "placement-open" : ""} ${(placingMonster && destination === index) || attacker === index || fieldMonster === index || tributes.includes(index) || (target === index && legalMagicTarget) ? "selected" : ""} ${(!myTurn || blockedByMagicSelection) && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
                  key={index}
                  onClick={() => {
                    const interactive = myTurn && !blockedByMagicSelection;
                    if (tributeTarget) {
                      setInspect(null);
                      toggleTribute(index);
                    } else if (placementTarget) {
                      setInspect(null);
                      setDestination(index);
                    } else if (
                      interactive &&
                      selected?.cardClass === "magic" &&
                      targetsOwnedMonster &&
                      legalMagicTarget
                    ) {
                      setInspect(null);
                      setTarget(index);
                    } else if (
                      interactive &&
                      state.phase === "battle" &&
                      monster?.canAttack
                    ) {
                      setInspect(null);
                      setAttacker(index);
                    } else if (interactive && main && monster) {
                      setInspect(null);
                      setFieldMonster(index);
                    } else if (monster?.cardId)
                      setInspect({ cardId: monster.cardId, zoneKey });
                  }}
                  disabled={(!myTurn || blockedByMagicSelection) && !canInspect}
                >
                  {monster ? (
                    <>
                      <ChronicleCardView
                        card={
                          monster.cardId ? cardsById[monster.cardId] : undefined
                        }
                        hidden={!monster.cardId}
                        compact
                      />
                      <small>
                        {monster.position === "attack"
                          ? `ATK ${monster.attack}`
                          : `DEF ${monster.defense}${monster.faceUp ? "" : " | FACE-DOWN"}`}
                      </small>
                    </>
                  ) : (
                    <span>MONSTER {index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            className="chronicle-zone-row player backrow"
            aria-label="Your Jutsu and Snare Zones"
          >
            {me.magicTrapZones.map((zone, index) => {
              const zoneKey = `me-backrow-${index}`;
              const canPlace = placements.trapZones.includes(index);
              const canInspect = Boolean(zone?.cardId);
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone ${canPlace ? "legal-target placement-open" : ""} ${placingTrap && destination === index ? "selected" : ""} ${!canPlace && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
                  key={index}
                  onClick={() => {
                    if (canPlace) {
                      setInspect(null);
                      setDestination(index);
                    } else if (zone?.cardId)
                      setInspect({ cardId: zone.cardId, zoneKey });
                  }}
                  disabled={!canPlace && !canInspect}
                >
                  {zone ? (
                    <ChronicleCardView
                      card={zone.cardId ? cardsById[zone.cardId] : undefined}
                      hidden={!zone.cardId}
                      compact
                    />
                  ) : (
                    <span>JUTSU/SNARE {index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
          <span className="chronicle-side-label player">YOUR FIELD</span>
        </div>

        <aside
          className="chronicle-pile-rail"
          aria-label="Deck and Graveyard zones"
        >
          <div className="chronicle-pile-zone opponent">
            <span>OPPONENT DECK</span>
            <div className="chronicle-pile-card-back" aria-hidden="true" />
            <b>{foe.deckCount}</b>
          </div>
          <button
            className="chronicle-pile-zone chronicle-pile-zone--open"
            type="button"
            aria-label={`Open the opponent Graveyard, ${foe.graveyard.length} ${foe.graveyard.length === 1 ? "card" : "cards"}`}
            onClick={() => setGraveyardView("foe")}
          >
            <span>OPPONENT GRAVEYARD</span>
            <div className="chronicle-pile-mark" aria-hidden="true">
              G
            </div>
            <b>{foe.graveyard.length}</b>
          </button>
          <div className="chronicle-pile-rail__spacer" />
          <button
            className="chronicle-pile-zone chronicle-pile-zone--open"
            type="button"
            aria-label={`Open your Graveyard, ${me.graveyard.length} ${me.graveyard.length === 1 ? "card" : "cards"}`}
            onClick={() => setGraveyardView("me")}
          >
            <span>YOUR GRAVEYARD</span>
            <div className="chronicle-pile-mark" aria-hidden="true">
              G
            </div>
            <b>{me.graveyard.length}</b>
          </button>
          <div className="chronicle-pile-zone player">
            <span>YOUR DECK</span>
            <div className="chronicle-pile-card-back" aria-hidden="true" />
            <b>{me.deckCount}</b>
          </div>
        </aside>
      </div>

      <div className="chronicle-player-console">
        <div className="chronicle-player-bar">
          <div className="chronicle-combatant">
          <ChronicleDuelistAvatar name={me.name} avatar={playerAvatar} />
          <div className="chronicle-combatant__identity">
            <span className="eyebrow">CHALLENGER</span>
            <strong>{me.name}</strong>
            <div className="chronicle-combatant__health">
              <b>
                <AnimatedNumber value={me.lifePoints} /> <small>HP</small>
              </b>
              <span
                className="chronicle-health-meter"
                style={healthStyle(me.lifePoints)}
                aria-label={`${me.lifePoints.toLocaleString()} Health Points`}
              />
              <span
                className="chronicle-float-anchor"
                ref={meFloatRef}
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
          <div>
            <span>Deck {me.deckCount}</span>
            <span>Grave {me.graveyard.length}</span>
          </div>
        </div>
        {error ? (
          <div className="chronicle-error" role="alert">
            {error}
          </div>
        ) : null}

      {state.responseWindow && !responseForMe ? (
        <div className="chronicle-response-waiting" role="status" aria-live="polite">
          <span>SNARE PRIORITY</span>
          <strong>
            {state.responseWindow.responder === meKey
              ? "Opening your response options"
              : `${responseOwner} is deciding`}
          </strong>
          {timedTurns ? <b>{secondsRemaining}s</b> : <i />}
        </div>
      ) : null}

      {responseForMe ? (
        <div
          className="chronicle-actions chronicle-command-dock response"
          role="group"
          aria-label="Snare response"
        >
          <strong>
            Respond to{" "}
            {state.responseWindow?.trigger
              .replace(/([A-Z])/g, " $1")
              .toLowerCase()}
          </strong>
          {state.responseWindow?.eligibleZoneIndexes?.map((zoneIndex) => {
            const id = me.magicTrapZones[zoneIndex]?.cardId;
            return (
              <button
                className="primary"
                key={zoneIndex}
                disabled={busy}
                onClick={() => act({ action: "activate-trap", zoneIndex })}
              >
                Activate {id ? cardsById[id]?.name : "Snare"}
              </button>
            );
          })}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => act({ action: "pass-response" })}
          >
            Pass
          </button>
        </div>
      ) : null}

      <div className="chronicle-hand" aria-label="Your hand">
        {(me.hand ?? []).map((id, index) => (
          <ChronicleCardView
            key={`${id}-${index}`}
            card={cardsById[id]}
            compact
            selected={handIndex === index}
            disabled={!myTurn || !main}
            onClick={() => chooseHand(index)}
          />
        ))}
      </div>

      {inspected ? (
        <button
          type="button"
          className="chronicle-mobile-card-zoom"
          onClick={() => setZoomedCardId(inspected.id)}
        >
          Read {inspected.name}
        </button>
      ) : null}

      {myTurn ? (
        <div
          className="chronicle-actions chronicle-command-dock"
          role="group"
          aria-label="Duel actions"
        >
          <div className="chronicle-command-context">
            <span>{phaseMeta?.label ?? state.phase}</span>
            <strong>
              {selected
                ? selected.name
                : attacker !== null
                  ? "Choose a target"
                  : state.phase === "battle"
                    ? "Select an attacker"
                    : "Your move"}
            </strong>
          </div>
          {/* The server settles Draw, Standby and End inside the same action, so
              a live duel never stops here. These stay as the one-click recovery
              for a duel persisted mid-bookkeeping before that change shipped. */}
          {state.phase === "draw" || state.phase === "standby" ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => act({ action: "advance-phase" })}
            >
              Continue
            </button>
          ) : null}
          {selected?.cardClass === "monster" && main ? (
            <>
              <span className="chronicle-placement-help">
                {state.normalSummonUsed
                  ? "You already used your Normal Summon or Set this turn."
                  : requiredTributes > 0 && tributes.length < requiredTributes
                    ? `Level ${selected.level} needs ${requiredTributes} Tribute${requiredTributes === 1 ? "" : "s"} — click your own Monsters to offer them (${tributes.length}/${requiredTributes}).`
                    : destination === null
                      ? "Click a glowing Monster Zone to place this Monster."
                      : `Monster Zone ${destination + 1} chosen — play it face-up in Attack Position or face-down in Defense Position.`}
              </span>
              {tributes.map((zoneIndex) => (
                <button
                  key={`destination-${zoneIndex}`}
                  disabled={busy}
                  onClick={() => setDestination(zoneIndex)}
                >
                  Place in Tribute Zone {zoneIndex + 1}
                </button>
              ))}
              <button
                className="summon-attack primary"
                disabled={
                  busy ||
                  state.normalSummonUsed ||
                  destination === null ||
                  tributes.length !== requiredTributes
                }
                onClick={() =>
                  act({
                    action: "normal-summon",
                    handIndex: handIndex!,
                    zoneIndex: destination!,
                    tributeZoneIndexes: tributes,
                  })
                }
              >
                Play Face-Up Attack
              </button>
              <button
                className="summon-defense secondary"
                disabled={
                  busy ||
                  state.normalSummonUsed ||
                  destination === null ||
                  tributes.length !== requiredTributes
                }
                onClick={() =>
                  act({
                    action: "set-monster",
                    handIndex: handIndex!,
                    zoneIndex: destination!,
                    tributeZoneIndexes: tributes,
                  })
                }
              >
                Set Face-Down Defense
              </button>
            </>
          ) : null}
          {selected?.cardClass === "magic" && main ? (
            <>
              <span className="chronicle-placement-help">
                {selectedIsFieldCard
                  ? "Activate this Field Card to take over the shared Field Zone."
                  : magicTargetScope === "none"
                    ? "This Jutsu needs no target — activate it."
                    : selectedMagicTargetReady
                      ? "Target locked — activate the Jutsu."
                      : targetsGraveyard
                        ? "Choose a legal card in your Graveyard below."
                        : targetsOwnedMonster
                          ? "Click one of your glowing Monsters to target it."
                          : targetsOpponentBackrow
                            ? "Click a glowing opponent Jutsu/Snare Zone to target it."
                            : "Click a glowing opponent Monster to target it."}
              </span>
              <button
                className="primary"
                disabled={
                  busy ||
                  !selectedMagicTargetReady ||
                  (selectedMagicNeedsOpenMonsterZone &&
                    !me.monsterZones.some((zone) => zone === null))
                }
                onClick={() =>
                  act({
                    action: "activate-magic",
                    handIndex: handIndex!,
                    targetZoneIndex: target,
                    targetSide: targetsOwnedMonster ? meKey : foeKey,
                    graveyardIndex: graveyardIndex ?? undefined,
                  })
                }
              >
                {selectedIsFieldCard ? "Activate Field Card" : "Activate Jutsu"}
              </button>
            </>
          ) : null}
          {selected?.cardClass === "trap" && main ? (
            <>
              <span className="chronicle-placement-help">
                {destination === null
                  ? "Click a glowing Jutsu/Snare Zone to set this Snare face-down."
                  : `Jutsu/Snare Zone ${destination + 1} chosen — set the Snare face-down.`}
              </span>
              <button
                className="primary"
                disabled={busy || destination === null}
                onClick={() =>
                  act({
                    action: "set-trap",
                    handIndex: handIndex!,
                    zoneIndex: destination!,
                  })
                }
              >
                Set Snare
              </button>
            </>
          ) : null}
          {handIndex === null &&
          main &&
          fieldMonster !== null &&
          me.monsterZones[fieldMonster] ? (
            <>
              {!me.monsterZones[fieldMonster]?.faceUp ? (
                <button
                  className="primary"
                  disabled={
                    busy || !me.monsterZones[fieldMonster]?.canFlipSummon
                  }
                  onClick={() =>
                    act({ action: "flip-summon", zoneIndex: fieldMonster })
                  }
                >
                  Flip Summon
                </button>
              ) : null}
              {me.monsterZones[fieldMonster]?.faceUp ? (
                <button
                  className="secondary"
                  disabled={
                    busy || !me.monsterZones[fieldMonster]?.canChangePosition
                  }
                  onClick={() =>
                    act({
                      action: "change-position",
                      zoneIndex: fieldMonster,
                      position:
                        me.monsterZones[fieldMonster]?.position === "attack"
                          ? "defense"
                          : "attack",
                    })
                  }
                >
                  Change to{" "}
                  {me.monsterZones[fieldMonster]?.position === "attack"
                    ? "Defense"
                    : "Attack"}
                </button>
              ) : null}
            </>
          ) : null}
          {state.phase === "main1" ? (
            <>
              <button
                className="primary"
                disabled={
                  busy ||
                  (state.turnNumber === 1 &&
                    state.activePlayer === state.firstPlayer)
                }
                onClick={() => act({ action: "start-battle" })}
              >
                Start Attacking
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => act({ action: "enter-end-phase" })}
              >
                End Turn
              </button>
            </>
          ) : null}
          {state.phase === "battle" ? (
            <>
              <span className="chronicle-placement-help">
                {smartAssistPending
                  ? "All legal strikes are complete — Smart Phase Assist is opening Main Phase 2."
                  : attacker === null
                  ? "Choose one of your Monsters that can still strike."
                  : foe.monsterZones.some(Boolean)
                    ? "Now click an enemy Monster to strike it."
                    : "No defenders remain — strike directly."}
              </span>
              <button
                className="primary"
                disabled={
                  busy || attacker === null || foe.monsterZones.some(Boolean)
                }
                onClick={() => {
                  pulseFx(
                    zoneEls.current.get(`me-monster-${attacker!}`),
                    "fx-strike-up",
                    420,
                  );
                  act({
                    action: "attack",
                    attackerZoneIndex: attacker!,
                    targetZoneIndex: null,
                  });
                }}
              >
                {directAttackPower === null
                  ? "Direct Attack"
                  : `Direct Attack · ${directAttackPower.toLocaleString()}`}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => act({ action: "enter-main-2" })}
              >
                Finish Attacking
              </button>
            </>
          ) : null}
          {state.phase === "main2" ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => act({ action: "enter-end-phase" })}
            >
              End Turn
            </button>
          ) : null}
          {/* Same recovery path as Continue above: End Turn already hands the
              turn over, so a live duel never presents this. */}
          {state.phase === "end" ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => act({ action: "end-turn" })}
            >
              Finish Turn
            </button>
          ) : null}
        </div>
      ) : null}
        <div className="chronicle-duel-utility">
          <button
            ref={duelMenuTriggerRef}
            type="button"
            className="chronicle-utility-trigger"
            aria-label="Match options"
            aria-expanded={duelMenuOpen}
            aria-controls="chronicle-match-options"
            onClick={() => setDuelMenuOpen((open) => !open)}
          >
            Match options
          </button>
          <div
            ref={duelMenuRef}
            id="chronicle-match-options"
            className="chronicle-utility-menu"
            hidden={!duelMenuOpen}
          >
            <strong>Match options</strong>
            <button
              type="button"
              aria-pressed={sfxMuted}
              onClick={() => {
                const next = !sfxMuted;
                setChronicleSfxMuted(next);
                setSfxMuted(next);
                if (!next) playChronicleSfx("draw");
              }}
            >
              {sfxMuted ? "Turn sound on" : "Mute duel sounds"}
            </button>
            <button
              type="button"
              aria-pressed={smartAssist}
              onClick={() => {
                const next = !smartAssist;
                setSmartAssist(next);
                writeSmartAssist(next);
              }}
            >
              Smart Phase Assist: {smartAssist ? "On" : "Off"}
            </button>
            <button
              className={`danger ${forfeitArmed ? "armed" : ""}`}
              disabled={busy || state.status !== "active"}
              onClick={() => {
                if (!forfeitArmed) {
                  setForfeitArmed(true);
                  return;
                }
                act({ action: "forfeit" });
              }}
            >
              {forfeitArmed ? "Confirm forfeit?" : "Forfeit"}
            </button>
          </div>
        </div>
      </div>

      <div className="chronicle-graveyards">
        <details open={targetsGraveyard || undefined}>
          <summary>Your Graveyard ({me.graveyard.length})</summary>
          <div>
            {me.graveyard.map((id, index) => (
              <ChronicleCardView
                key={`${id}-${index}`}
                card={cardsById[id]}
                compact
                selected={targetsGraveyard && graveyardIndex === index}
                onClick={
                  myTurn && targetsGraveyard && legalGraveyardTarget(id)
                    ? () => {
                        setInspect(null);
                        setGraveyardIndex(index);
                      }
                    : () =>
                        setInspect({
                          cardId: id,
                          zoneKey: `me-grave-${index}`,
                        })
                }
              />
            ))}
          </div>
        </details>
        <details>
          <summary>Opponent Graveyard ({foe.graveyard.length})</summary>
          <div>
            {foe.graveyard.map((id, index) => (
              <ChronicleCardView
                key={`${id}-${index}`}
                card={cardsById[id]}
                compact
                onClick={() =>
                  setInspect({ cardId: id, zoneKey: `foe-grave-${index}` })
                }
              />
            ))}
          </div>
        </details>
      </div>

      <details className="chronicle-log">
        <summary>
          {presentationEvents.length ? "Match timeline" : "Battle log"}
        </summary>
        {presentationEvents.length
          ? presentationEvents
              .slice()
              .reverse()
              .map((event) => (
                <p key={event.id} data-event={event.kind}>
                  <b>T{event.turnNumber}</b>{" "}
                  {eventTimelineCopy(event, cardsById, duelistNames)}
                </p>
              ))
          : state.log
              .slice()
              .reverse()
              .map((line, index) => <p key={index}>{line}</p>)}
        {presentationEvents.length ? (
          <details className="chronicle-log__transcript">
            <summary>Rules transcript</summary>
            {state.log
              .slice()
              .reverse()
              .map((line, index) => (
                <p key={index}>{line}</p>
              ))}
          </details>
        ) : null}
      </details>

      {reaction ? (
        <div
          className={`chronicle-duelist-cut-in ${reaction.side} ${reaction.kind}`}
          role="status"
          aria-live="polite"
        >
          <ChronicleDuelistAvatar
            name={reaction.name}
            avatar={reaction.side === "me" ? playerAvatar : opponentAvatar}
            opponent={reaction.side === "foe"}
          />
          <span>
            <small>{reaction.kind === "damage" ? "DIRECT HIT" : "RECOVERY"}</small>
            <strong>{reaction.name}</strong>
            <b>
              {reaction.kind === "damage" ? "-" : "+"}
              {reaction.amount.toLocaleString()} HP
            </b>
          </span>
        </div>
      ) : null}

      {showIntro ? (
        <div className="chronicle-splash intro" aria-hidden="true">
          <b>SHOWDOWN</b>
          <span>{state[state.firstPlayer].name} takes the first turn</span>
        </div>
      ) : null}
      {outcome ? (
        <div className={`chronicle-splash outcome ${outcome}`} role="status">
          <b>
            {outcome === "victory"
              ? "VICTORY"
              : outcome === "defeat"
                ? "DEFEAT"
                : "DRAW"}
          </b>
          <span>
            {outcome === "victory"
              ? `${me.name} takes the duel`
              : outcome === "defeat"
                ? `${foe.name} takes the duel`
                : "The Chronicle records a stalemate"}
          </span>
        </div>
      ) : null}

      {graveyardView
        ? (() => {
            const pile =
              graveyardView === "me" ? me.graveyard : foe.graveyard;
            // Reviving from your own Graveyard is a real targeting step, so
            // while a jutsu is asking for one the pile doubles as the picker.
            const picking = graveyardView === "me" && myTurn && targetsGraveyard;
            return (
              <Modal
                open
                onClose={() => setGraveyardView(null)}
                size="lg"
                className="chronicle-graveyard-modal"
                title={`${graveyardView === "me" ? "Your" : `${foe.name}'s`} Graveyard (${pile.length})`}
              >
                <p className="chronicle-graveyard-modal__hint">
                  {picking
                    ? "Choose a legal card to bring back."
                    : "Every card sent here, in the order it fell. Select one to read it full size."}
                </p>
                {pile.length ? (
                  <div className="chronicle-collection chronicle-graveyard-modal__grid">
                    {pile.map((id, index) => {
                      const card = cardsById[id] ?? getChronicleCard(id);
                      const legal = picking && legalGraveyardTarget(id);
                      return (
                        <button
                          className={`chronicle-card-inspect-trigger ${legal ? "legal-target" : ""}`}
                          key={`${id}-${index}`}
                          type="button"
                          aria-label={
                            legal
                              ? `Choose ${card?.name ?? id}`
                              : `Read ${card?.name ?? id}`
                          }
                          onClick={() => {
                            if (legal) {
                              setInspect(null);
                              setGraveyardIndex(index);
                              setGraveyardView(null);
                              return;
                            }
                            setZoomedCardId(id);
                          }}
                        >
                          <ChronicleCardView card={card} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="chronicle-graveyard-modal__empty">
                    Nothing has been sent here yet.
                  </p>
                )}
              </Modal>
            );
          })()
        : null}

      <ChronicleCardInspector
        card={zoomedCard ?? null}
        onClose={() => setZoomedCardId(null)}
      />
    </section>
  );
}
