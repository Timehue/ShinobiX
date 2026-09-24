import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChronicleDisplayCard, ChroniclePresentationEvent } from "../lib/chronicle-duel";
import { CHRONICLE_EFFECT_IMPACT_MS, ChronicleBeatQueue, chronicleBeatDuration, chronicleEffectTargets, type ChronicleBeat, type ChronicleEffectTarget } from "../lib/chronicle-presentation";
import { playChronicleSfx } from "../lib/chronicle-sfx";
import { ChronicleCardView } from "./ChronicleCardView";

type Point = { x: number; y: number; width: number; height: number };
type Target = Point & ChronicleEffectTarget;
type Playing = { beat: ChronicleBeat; source?: Point; targets: Target[]; remaining: number; calloutRight: boolean; phase: "reveal" | "impact" | "settle" };
type Active = { beat: ChronicleBeat; start: number; until: number; impacted: boolean; settled: boolean };

export function ChronicleResolutionDirector({ events, cards, viewer, names, zones, mat, onComplete }: {
  events: ChroniclePresentationEvent[];
  cards: Record<string, ChronicleDisplayCard>;
  viewer: "p1" | "p2";
  names: Record<"p1" | "p2", string>;
  zones: RefObject<Map<string, HTMLButtonElement>>;
  mat: RefObject<HTMLDivElement | null>;
  onComplete: (winner: "p1" | "p2" | "draw") => void;
}) {
  const [queue] = useState(() => new ChronicleBeatQueue());
  const [playing, setPlaying] = useState<Playing | null>(null);
  const active = useRef<Active | null>(null);
  useEffect(() => {
    queue.observe(events, cards, names);
    if (document.hidden) {
      const winner = queue.clear();
      if (winner) onComplete(winner);
    }
  }, [queue, events, cards, names, onComplete]);
  useEffect(() => {
    const geometry = (beat: ChronicleBeat) => {
      // Mat perspective changes screen coordinates. Paint in its untransformed
      // parent and remeasure on resize/scroll, including portrait rotations.
      const bounds = mat.current?.parentElement?.getBoundingClientRect();
      const point = (side: "p1" | "p2" | undefined, row: string, index?: number | null): Point | undefined => {
        if (!bounds || !side || index == null) return;
        const rect = zones.current.get(`${side === viewer ? "me" : "foe"}-${row}-${index}`)?.getBoundingClientRect();
        if (!rect) return;
        return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top, width: rect.width, height: rect.height };
      };
      const event = beat.event;
      const source = point(event.actor ?? event.side, event.kind.startsWith("trap-") || (event.kind === "card-destroyed" && beat.card?.cardClass !== "monster") ? "backrow" : "monster", event.sourceZoneIndex);
      // HP already has its own synchronized meter and floating-number layer.
      const targets = chronicleEffectTargets(beat).flatMap(target => {
        const location = point(target.side, target.row, target.index);
        return location ? [{ ...location, ...target }] : [];
      });
      return { source, targets, calloutRight: Boolean(bounds && targets[0] && targets[0].x < bounds.width / 2) };
    };
    let geometryFrame = 0;
    const refreshGeometry = () => {
      geometryFrame = 0;
      const current = active.current;
      if (current) setPlaying(value => value ? { ...value, ...geometry(current.beat) } : value);
    };
    const scheduleGeometry = () => {
      if (!geometryFrame) geometryFrame = window.requestAnimationFrame(refreshGeometry);
    };
    const hide = () => {
      if (!document.hidden) return;
      const winner = queue.clear() ?? active.current?.beat.winner;
      if (winner) onComplete(winner);
      active.current = null;
      setPlaying(null);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleGeometry);
    if (mat.current) observer?.observe(mat.current);
    window.addEventListener("resize", scheduleGeometry);
    window.addEventListener("scroll", scheduleGeometry, true);
    document.addEventListener("visibilitychange", hide);
    const timer = window.setInterval(() => {
      const now = performance.now();
      const current = active.current;
      if (current && now < current.until) {
        if (!current.impacted && now >= current.start + CHRONICLE_EFFECT_IMPACT_MS) {
          current.impacted = true;
          const targets = chronicleEffectTargets(current.beat);
          if (current.beat.cue !== "destroy" && targets.some(target => target.motif === "shatter")) playChronicleSfx("destroy");
          else if (targets.some(target => target.motif === "recall")) playChronicleSfx("recall");
          else if (targets.some(target => target.label === "ATTACK STOPPED")) playChronicleSfx("guard");
          else if (current.beat.cue !== "heal" && targets.some(target => target.row === "health" && target.motif === "surge")) playChronicleSfx("heal");
          setPlaying(value => value ? { ...value, phase: "impact" } : value);
        }
        if (!current.settled && now >= current.start + 950) {
          current.settled = true;
          setPlaying(value => value ? { ...value, phase: "settle" } : value);
        }
        return;
      }
      if (current?.beat.winner) onComplete(current.beat.winner);
      active.current = null;
      const beat = queue.take();
      if (!beat) { if (current) setPlaying(null); return; }
      if (beat.terminalOnly) {
        if (beat.winner) onComplete(beat.winner);
        setPlaying(null);
        return;
      }
      active.current = { beat, start: now, until: now + (queue.length > 3 ? 1_100 : chronicleBeatDuration(beat.event)), impacted: false, settled: false };
      playChronicleSfx(beat.cue);
      setPlaying({ beat, ...geometry(beat), remaining: queue.length, phase: "reveal" });
    }, 40);
    return () => {
      window.clearInterval(timer);
      observer?.disconnect();
      window.cancelAnimationFrame(geometryFrame);
      window.removeEventListener("resize", scheduleGeometry);
      window.removeEventListener("scroll", scheduleGeometry, true);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [queue, mat, zones, viewer, onComplete]);

  if (!playing || !mat.current?.parentElement) return null;
  const { beat, source, targets, phase } = playing;
  const pointStyle = (point: Point) => ({ left: point.x, top: point.y, "--target-w": `${point.width}px`, "--target-h": `${point.height}px` } as CSSProperties);
  return createPortal(<div className={`chronicle-effect-stage ${beat.tone} ${beat.motif}${playing.calloutRight ? " callout-right" : ""}`} key={beat.id} data-beat={beat.id} data-phase={phase}>
    <div className="chronicle-effect-paths" aria-hidden="true">
      {source ? <span className="chronicle-effect-source" style={pointStyle(source)}><i /></span> : null}
      {phase !== "reveal" ? targets.map((target, index) => <span key={index} className={`chronicle-effect-target ${target.motif}`} style={pointStyle(target)}>
        <svg className="chronicle-effect-sigil" viewBox="0 0 120 120">
          <circle className="sigil-outer" cx="60" cy="60" r="55" />
          <circle className="sigil-inner" cx="60" cy="60" r="44" />
          <path d="M60 7 L106 33 L106 87 L60 113 L14 87 L14 33 Z M60 16 L98 82 L22 82 Z" />
        </svg>
        <i /><i /><i />
        {target.motif === "shatter" ? Array.from({ length: 8 }, (_, shard) => <em key={shard} style={{ "--shard": shard } as CSSProperties} />) : null}
        <b>{target.label}</b>
      </span>) : null}
      {source && targets.length ? <svg className="chronicle-effect-links" width="100%" height="100%">
        {targets.map((target, index) => {
          const path = `M ${source.x} ${source.y} Q ${(source.x + target.x) / 2 + 45} ${(source.y + target.y) / 2} ${target.x} ${target.y}`;
          return <g key={index}><path className="effect-link-halo" pathLength="1" d={path} /><path className="effect-link-core" pathLength="1" d={path} /></g>;
        })}
      </svg> : null}
    </div>
    <div className="chronicle-effect-callout" role="status" aria-live="polite" aria-atomic="true">
      {beat.card ? <div className="chronicle-effect-card" aria-hidden="true"><ChronicleCardView card={beat.card} compact /></div> : null}
      <div className="chronicle-effect-copy">
        <span className="chronicle-effect-kicker">{beat.title} <i>· {beat.actor}</i></span>
        <strong>{beat.card?.name ?? beat.title}</strong>
        {beat.explanation ? <p>{beat.explanation}</p> : null}
        <div className="chronicle-effect-result"><b>{beat.events.some(event => event.kind === "response-opened") ? "RESPONSE OPEN" : "RESULT"}</b><span>{beat.results[0]}</span></div>
        {playing.remaining ? <small>{playing.remaining} more action{playing.remaining === 1 ? "" : "s"} · Full recap in Last effect</small> : null}
      </div>
    </div>
  </div>, mat.current.parentElement);
}
