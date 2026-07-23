import { useEffect, useState, type CSSProperties } from "react";
import {
  CHRONICLE_DECEMBER_2003_FORMAT,
  CHRONICLE_ROOM_TITLE,
  getChronicleCard,
  STARTING_LIFE_POINTS,
  TURN_TIMEOUT_MS,
  tributeCountForLevel,
  type ChronicleActionIntent,
  type ChronicleDisplayCard,
  type ChronicleProjection,
} from "../lib/chronicle-duel";
import { isImageAvatar } from "../lib/avatar";
import { ChronicleCardView } from "./ChronicleCardView";

type SideKey = "p1" | "p2";

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
  error,
  onAction,
}: {
  state: ChronicleProjection;
  cardsById: Record<string, ChronicleDisplayCard>;
  playerAvatar?: string;
  opponentAvatar?: string;
  busy?: boolean;
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
  const [clock, setClock] = useState(() => Date.now());
  const [zoomedCardId, setZoomedCardId] = useState<string | null>(null);
  const selectedId = handIndex === null ? undefined : me.hand?.[handIndex];
  const selected = selectedId
    ? (cardsById[selectedId] ?? getChronicleCard(selectedId))
    : undefined;
  const inspectedId =
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
  const phaseIndex = CHRONICLE_DECEMBER_2003_FORMAT.phases.findIndex(
    (phase) => phase.id === state.phase,
  );
  const phaseMeta = CHRONICLE_DECEMBER_2003_FORMAT.phases[phaseIndex];

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
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

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
  }

  const responseForMe = state.responseWindow?.responder === meKey;
  return (
    <section
      className={`chronicle-table ${state.activeField ? "has-field" : ""}`}
      style={fieldStyle}
      aria-label="Shinobi Journey Chronicle Duel board"
    >
      <div className="chronicle-room-banner">
        <span>TIME WIZARD ROOM</span>
        <strong>{CHRONICLE_ROOM_TITLE}</strong>
        <small>Dark Crisis pool | November 17, 2003 Limited List</small>
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
                {foe.lifePoints.toLocaleString()} <small>HP</small>
              </b>
              <span
                className="chronicle-health-meter"
                style={healthStyle(foe.lifePoints)}
                aria-label={`${foe.lifePoints.toLocaleString()} Health Points`}
              />
            </div>
          </div>
        </div>
        <div className="chronicle-turn">
          <b>TURN {state.turnNumber}</b>
          <span>
            {phaseMeta?.label.toUpperCase() ?? state.phase.toUpperCase()} |{" "}
            {secondsRemaining}s
          </span>
          {state.responseWindow ? <em>TRAP RESPONSE</em> : null}
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
        {CHRONICLE_DECEMBER_2003_FORMAT.phases.map((phase, index) => (
          <li
            key={phase.id}
            className={
              index === phaseIndex
                ? "active"
                : index < phaseIndex
                  ? "passed"
                  : ""
            }
            aria-current={index === phaseIndex ? "step" : undefined}
          >
            <b>{phase.shortLabel}</b>
            <span>{phase.label}</span>
          </li>
        ))}
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

        <div className="chronicle-playmat">
          <span className="chronicle-side-label opponent">OPPONENT FIELD</span>
          <div
            className="chronicle-zone-row opponent backrow"
            aria-label="Opponent Magic and Trap Zones"
          >
            {foe.magicTrapZones.map((zone, index) => (
              <button
                type="button"
                className={`chronicle-zone ${targetsOpponentBackrow && zone ? "legal-target" : ""} ${targetsOpponentBackrow && target === index ? "selected" : ""}`}
                key={index}
                onClick={() => setTarget(index)}
                disabled={!myTurn || !targetsOpponentBackrow || !zone}
              >
                {zone ? (
                  <ChronicleCardView
                    card={zone.cardId ? cardsById[zone.cardId] : undefined}
                    hidden={!zone.cardId}
                    compact
                  />
                ) : (
                  <span>MAGIC/TRAP {index + 1}</span>
                )}
              </button>
            ))}
          </div>
          <div
            className="chronicle-zone-row opponent"
            aria-label="Opponent Monster Zones"
          >
            {foe.monsterZones.map((monster, index) => {
              const legalMagicTarget = legalOpponentMagicTarget(monster);
              const selectable =
                Boolean(monster) &&
                (state.phase === "battle" ||
                  (targetsOpponentMonster && legalMagicTarget));
              return (
                <button
                  type="button"
                  className={`chronicle-zone monster-zone ${monster?.position === "defense" ? "defense-position" : "attack-position"} ${targetsOpponentMonster && legalMagicTarget ? "legal-target" : ""} ${target === index && selectable ? "selected" : ""}`}
                  key={index}
                  onClick={() => setTarget(index)}
                  disabled={!myTurn || !selectable}
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
              <strong>{state.log.at(-1) ?? "The duel begins."}</strong>
            </div>
          </div>

          <div
            className="chronicle-zone-row player"
            aria-label="Your Monster Zones"
          >
            {me.monsterZones.map((monster, index) => {
              const legalMagicTarget = legalOwnedMagicTarget(monster);
              const blockedByMagicSelection =
                selected?.cardClass === "magic" &&
                (!targetsOwnedMonster || !legalMagicTarget);
              return (
                <button
                  type="button"
                  className={`chronicle-zone monster-zone ${monster?.position === "defense" ? "defense-position" : "attack-position"} ${targetsOwnedMonster && legalMagicTarget ? "legal-target" : ""} ${destination === index || attacker === index || fieldMonster === index || tributes.includes(index) || (target === index && legalMagicTarget) ? "selected" : ""}`}
                  key={index}
                  onClick={() => {
                    if (
                      selected?.cardClass === "monster" &&
                      monster &&
                      requiredTributes > 0
                    )
                      toggleTribute(index);
                    else if (selected?.cardClass === "monster" && !monster)
                      setDestination(index);
                    else if (
                      selected?.cardClass === "magic" &&
                      targetsOwnedMonster &&
                      legalMagicTarget
                    )
                      setTarget(index);
                    else if (state.phase === "battle" && monster?.canAttack)
                      setAttacker(index);
                    else if (main && monster) setFieldMonster(index);
                  }}
                  disabled={!myTurn || blockedByMagicSelection}
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
            aria-label="Your Magic and Trap Zones"
          >
            {me.magicTrapZones.map((zone, index) => (
              <button
                type="button"
                className={`chronicle-zone ${destination === index ? "selected" : ""}`}
                key={index}
                onClick={() => setDestination(index)}
                disabled={
                  !myTurn || selected?.cardClass !== "trap" || Boolean(zone)
                }
              >
                {zone ? (
                  <ChronicleCardView
                    card={zone.cardId ? cardsById[zone.cardId] : undefined}
                    hidden={!zone.cardId}
                    compact
                  />
                ) : (
                  <span>MAGIC/TRAP {index + 1}</span>
                )}
              </button>
            ))}
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
            <span className="eyebrow">DUELIST</span>
            <strong>{me.name}</strong>
            <div className="chronicle-combatant__health">
              <b>
                {me.lifePoints.toLocaleString()} <small>HP</small>
              </b>
              <span
                className="chronicle-health-meter"
                style={healthStyle(me.lifePoints)}
                aria-label={`${me.lifePoints.toLocaleString()} Health Points`}
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
          aria-label="Trap response"
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
                Activate {id ? cardsById[id]?.name : "Trap"}
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
              {selectedIsFieldCard ? "Activate Field Card" : "Activate Magic"}
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
              Set Trap
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
              <button
                disabled={
                  busy || attacker === null || foe.monsterZones.some(Boolean)
                }
                onClick={() =>
                  act({
                    action: "attack",
                    attackerZoneIndex: attacker!,
                    targetZoneIndex: null,
                  })
                }
              >
                Direct Attack
              </button>
              <button
                disabled={
                  busy ||
                  attacker === null ||
                  target === null ||
                  !foe.monsterZones[target]
                }
                onClick={() =>
                  act({
                    action: "attack",
                    attackerZoneIndex: attacker!,
                    targetZoneIndex: target,
                  })
                }
              >
                Attack Monster
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
            className="danger"
            disabled={busy}
            onClick={() => act({ action: "forfeit" })}
          >
            Forfeit
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
                disabled={
                  !myTurn || !targetsGraveyard || !legalGraveyardTarget(id)
                }
                onClick={
                  targetsGraveyard && legalGraveyardTarget(id)
                    ? () => setGraveyardIndex(index)
                    : undefined
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
                disabled
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
