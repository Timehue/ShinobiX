import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CHRONICLE_FOUNDING_FORMAT,
  CHRONICLE_ROOM_TITLE,
  getChronicleCard,
  STARTING_LIFE_POINTS,
  TURN_TIMEOUT_MS,
  tributeCountForLevel,
  type ChronicleActionIntent,
  type ChronicleDisplayCard,
  type ChronicleProjection,
} from "../lib/chronicle-duel";
import {
  chronicleSfxMuted,
  classifyChronicleLogLine,
  playChronicleSfx,
  setChronicleSfxMuted,
} from "../lib/chronicle-sfx";
import { isImageAvatar } from "../lib/avatar";
import { ChronicleCardView } from "./ChronicleCardView";

type SideKey = "p1" | "p2";

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
  onAction: (intent: ChronicleActionIntent) => void;
}) {
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
  const [forfeitArmed, setForfeitArmed] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(chronicleSfxMuted);
  // Opening splash: only a genuinely fresh duel (turn 1) gets the banner —
  // a resumed mid-duel board must not replay it.
  const [showIntro, setShowIntro] = useState(
    () => state.turnNumber === 1 && state.status === "active",
  );
  const [outcome, setOutcome] = useState<
    "victory" | "defeat" | "draw" | null
  >(null);
  const playmatRef = useRef<HTMLDivElement | null>(null);
  const foeMonsterRowRef = useRef<HTMLDivElement | null>(null);
  const meFloatRef = useRef<HTMLSpanElement | null>(null);
  const foeFloatRef = useRef<HTMLSpanElement | null>(null);
  const zoneEls = useRef(new Map<string, HTMLButtonElement>());
  const prevStateRef = useRef<ChronicleProjection | null>(null);
  const seenLogTail = useRef<string | undefined>(undefined);
  const seenStatus = useRef<string | undefined>(undefined);
  const zoneRef = (zoneKey: string) => (el: HTMLButtonElement | null) => {
    if (el) zoneEls.current.set(zoneKey, el);
    else zoneEls.current.delete(zoneKey);
  };
  const selectedId = handIndex === null ? undefined : me.hand?.[handIndex];
  const selected = selectedId
    ? (cardsById[selectedId] ?? getChronicleCard(selectedId))
    : undefined;
  const inspectedId =
    inspect?.cardId ??
    selectedId ??
    (fieldMonster === null
      ? undefined
      : me.monsterZones[fieldMonster]?.cardId) ??
    (attacker === null ? undefined : me.monsterZones[attacker]?.cardId) ??
    (target === null ? undefined : foe.monsterZones[target]?.cardId) ??
    state.activeField?.cardId;
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

  const logTail = state.log.at(-1);
  useEffect(() => {
    // First render of a board (or a resumed duel) just adopts the current
    // tail — cues only fire for lines that appear while the player watches.
    const primedTail = seenLogTail.current;
    seenLogTail.current = logTail;
    if (primedTail === undefined || logTail === undefined) return;
    if (logTail === primedTail) return;
    const cue = classifyChronicleLogLine(logTail);
    if (cue) playChronicleSfx(cue);
    if (cue === "destroy") {
      // Imperative class toggle (not state): restarts the CSS animation
      // cleanly on back-to-back destructions.
      const mat = playmatRef.current;
      if (!mat) return;
      mat.classList.remove("impact");
      void mat.offsetWidth;
      mat.classList.add("impact");
      const timer = window.setTimeout(
        () => mat.classList.remove("impact"),
        450,
      );
      return () => window.clearTimeout(timer);
    }
  }, [logTail]);

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
        else if (!monster && was) pulseFx(el, "fx-destroyed", 580);
      });
      now.magicTrapZones.forEach((zone, index) => {
        const was = before.magicTrapZones[index];
        const el = zoneEls.current.get(`${prefix}-backrow-${index}`);
        if (zone && (!was || was.instanceId !== zone.instanceId))
          pulseFx(el, "fx-arrive", 540);
        else if (zone && was && !was.faceUp && zone.faceUp)
          pulseFx(el, "fx-flip", 500);
        else if (!zone && was) pulseFx(el, "fx-destroyed", 580);
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
  }, [state, meKey, foeKey]);

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
  }

  /** The next-step intent a phase-rail chip triggers, or null when that chip
   *  is not a legal jump from the current phase. */
  function phaseJumpIntent(phaseId: string): ChronicleActionIntent | null {
    if (!myTurn || busy) return null;
    switch (state.phase) {
      case "draw":
        return phaseId === "standby" ? { action: "advance-phase" } : null;
      case "standby":
        return phaseId === "main1" ? { action: "advance-phase" } : null;
      case "main1":
        if (phaseId === "battle")
          return state.turnNumber === 1 &&
            state.activePlayer === state.firstPlayer
            ? null
            : { action: "start-battle" };
        return phaseId === "end" ? { action: "enter-end-phase" } : null;
      case "battle":
        return phaseId === "main2" ? { action: "enter-main-2" } : null;
      case "main2":
        return phaseId === "end" ? { action: "enter-end-phase" } : null;
      default:
        return null;
    }
  }

  const responseForMe = state.responseWindow?.responder === meKey;
  return (
    <section
      className={`chronicle-table ${state.activeField ? "has-field" : ""} ${aiActing ? "ai-acting" : ""}`}
      style={fieldStyle}
      aria-label="Shinobi Journey Chronicle Showdown board"
    >
      <div className="chronicle-room-banner">
        <span>CODEX HALL</span>
        <strong>{CHRONICLE_ROOM_TITLE}</strong>
        <small>
          Founding card pool · Sealed Limited Scroll
          <button
            type="button"
            className="chronicle-sfx-toggle"
            aria-pressed={!sfxMuted}
            aria-label={sfxMuted ? "Unmute duel sounds" : "Mute duel sounds"}
            title={sfxMuted ? "Unmute duel sounds" : "Mute duel sounds"}
            onClick={() => {
              const next = !sfxMuted;
              setChronicleSfxMuted(next);
              setSfxMuted(next);
              if (!next) playChronicleSfx("draw");
            }}
          >
            {sfxMuted ? "🔇" : "🔊"}
          </button>
        </small>
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
      <ol className="chronicle-phase-rail" aria-label="Turn phases">
        {CHRONICLE_FOUNDING_FORMAT.phases.map((phase, index) => {
          const jump = phaseJumpIntent(phase.id);
          return (
            <li
              key={phase.id}
              className={`${
                index === phaseIndex
                  ? "active"
                  : index < phaseIndex
                    ? "passed"
                    : ""
              } ${jump ? "jumpable" : ""}`}
              aria-current={index === phaseIndex ? "step" : undefined}
            >
              {jump ? (
                <button
                  type="button"
                  className="chronicle-phase-jump"
                  title={`Advance to ${phase.label}`}
                  onClick={() => act(jump)}
                >
                  <b>{phase.shortLabel}</b>
                  <span>{phase.label}</span>
                </button>
              ) : (
                <>
                  <b>{phase.shortLabel}</b>
                  <span>{phase.label}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="chronicle-duel-stage">
        <aside
          className="chronicle-card-detail-panel"
          aria-label="Card details"
        >
          <span className="eyebrow">CARD DETAILS</span>
          {inspected ? (
            <>
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
            </>
          ) : (
            <div className="chronicle-card-detail-panel__empty">
              Select a card or Monster to inspect it.
            </div>
          )}
        </aside>

        <div className="chronicle-playmat" ref={playmatRef}>
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
              // With an attacker armed, clicking an enemy Monster strikes it
              // immediately — no separate confirm button.
              const attackTarget =
                myTurn &&
                state.phase === "battle" &&
                attacker !== null &&
                Boolean(monster);
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
              <strong key={`${state.log.length}-${state.log.at(-1) ?? ""}`}>
                {state.log.at(-1) ?? "The duel begins."}
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
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone monster-zone ${monster?.position === "defense" ? "defense-position" : "attack-position"} ${targetsOwnedMonster && legalMagicTarget ? "legal-target" : ""} ${destination === index || attacker === index || fieldMonster === index || tributes.includes(index) || (target === index && legalMagicTarget) ? "selected" : ""} ${(!myTurn || blockedByMagicSelection) && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
                  key={index}
                  onClick={() => {
                    const interactive = myTurn && !blockedByMagicSelection;
                    if (
                      interactive &&
                      selected?.cardClass === "monster" &&
                      monster &&
                      requiredTributes > 0
                    ) {
                      setInspect(null);
                      toggleTribute(index);
                    } else if (
                      interactive &&
                      selected?.cardClass === "monster" &&
                      !monster
                    ) {
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
              const canPlace =
                myTurn && selected?.cardClass === "trap" && !zone;
              const canInspect = Boolean(zone?.cardId);
              return (
                <button
                  type="button"
                  ref={zoneRef(zoneKey)}
                  className={`chronicle-zone ${destination === index ? "selected" : ""} ${!canPlace && canInspect ? "inspectable" : ""} ${inspect?.zoneKey === zoneKey ? "inspected" : ""}`}
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
          <div className="chronicle-pile-zone">
            <span>OPPONENT GRAVEYARD</span>
            <div className="chronicle-pile-mark" aria-hidden="true">
              G
            </div>
            <b>{foe.graveyard.length}</b>
          </div>
          <div className="chronicle-pile-rail__spacer" />
          <div className="chronicle-pile-zone">
            <span>YOUR GRAVEYARD</span>
            <div className="chronicle-pile-mark" aria-hidden="true">
              G
            </div>
            <b>{me.graveyard.length}</b>
          </div>
          <div className="chronicle-pile-zone player">
            <span>YOUR DECK</span>
            <div className="chronicle-pile-card-back" aria-hidden="true" />
            <b>{me.deckCount}</b>
          </div>
        </aside>
      </div>

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

      {responseForMe ? (
        <div
          className="chronicle-actions response"
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
                key={zoneIndex}
                disabled={busy}
                onClick={() => act({ action: "activate-trap", zoneIndex })}
              >
                Activate {id ? cardsById[id]?.name : "Snare"}
              </button>
            );
          })}
          <button
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
          className="chronicle-actions"
          role="group"
          aria-label="Duel actions"
        >
          {state.phase === "draw" ? (
            <button
              disabled={busy}
              onClick={() => act({ action: "advance-phase" })}
            >
              Standby Phase
            </button>
          ) : null}
          {state.phase === "standby" ? (
            <button
              disabled={busy}
              onClick={() => act({ action: "advance-phase" })}
            >
              Main Phase 1
            </button>
          ) : null}
          {selected?.cardClass === "monster" && main ? (
            <>
              <span className="chronicle-placement-help">
                Choose an open Monster Zone, then play this Monster face-up in
                Attack Position or face-down in Defense Position. Tributes{" "}
                {tributes.length}/{requiredTributes}.
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
                className="summon-attack"
                disabled={
                  busy ||
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
                className="summon-defense"
                disabled={
                  busy ||
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
            <button
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
          ) : null}
          {selected?.cardClass === "trap" && main ? (
            <button
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
          ) : null}
          {handIndex === null &&
          main &&
          fieldMonster !== null &&
          me.monsterZones[fieldMonster] ? (
            <>
              {!me.monsterZones[fieldMonster]?.faceUp ? (
                <button
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
                disabled={
                  busy ||
                  (state.turnNumber === 1 &&
                    state.activePlayer === state.firstPlayer)
                }
                onClick={() => act({ action: "start-battle" })}
              >
                Battle Phase
              </button>
              <button
                disabled={busy}
                onClick={() => act({ action: "enter-end-phase" })}
              >
                End Phase
              </button>
            </>
          ) : null}
          {state.phase === "battle" ? (
            <>
              <span className="chronicle-placement-help">
                {attacker === null
                  ? "Choose one of your Monsters that can still strike."
                  : foe.monsterZones.some(Boolean)
                    ? "Now click an enemy Monster to strike it."
                    : "No defenders remain — strike directly."}
              </span>
              <button
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
                Direct Attack
              </button>
              <button
                disabled={busy}
                onClick={() => act({ action: "enter-main-2" })}
              >
                Main Phase 2
              </button>
            </>
          ) : null}
          {state.phase === "main2" ? (
            <button
              disabled={busy}
              onClick={() => act({ action: "enter-end-phase" })}
            >
              End Phase
            </button>
          ) : null}
          {state.phase === "end" ? (
            <button disabled={busy} onClick={() => act({ action: "end-turn" })}>
              Pass Turn
            </button>
          ) : null}
          <button
            className={`danger ${forfeitArmed ? "armed" : ""}`}
            disabled={busy}
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
      ) : null}

      <div className="chronicle-graveyards">
        <details>
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
        <summary>Battle log</summary>
        {state.log
          .slice()
          .reverse()
          .map((line, index) => (
            <p key={index}>{line}</p>
          ))}
      </details>

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

      {zoomedCard ? (
        <div className="chronicle-card-inspector" role="presentation">
          <section
            className="chronicle-card-inspector__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${zoomedCard.name} readable card details`}
          >
            <button
              className="chronicle-card-inspector__close"
              type="button"
              autoFocus
              onClick={() => setZoomedCardId(null)}
            >
              Close
            </button>
            <ChronicleCardView card={zoomedCard} />
            <p className="chronicle-card-inspector__hint">
              Full-size rules text · Press Escape to close
            </p>
          </section>
        </div>
      ) : null}
    </section>
  );
}
