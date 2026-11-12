/** Milliseconds from launch until the blow reaches the defending duelist. */
export const CHRONICLE_DIRECT_STRIKE_IMPACT_MS = 300;

/** The painted plates (art-source/chronicle-direct-strike). Fetched when a
 *  duel board opens so the first direct attack does not fly blank. */
const PLATES = ["/chronicle/fx/direct-strike-v1.webp", "/chronicle/fx/direct-impact-v1.webp"];
let primed = false;
export function primeChronicleDirectStrike(): void {
  if (primed || typeof Image === "undefined") return;
  primed = true;
  for (const src of PLATES) new Image().src = src;
}

// One pending removal per element and class, so a second strike that lands
// while the first still plays (AI steps replay back to back) gets its full run.
const removals = new WeakMap<Element, Map<string, number>>();
function restartClass(el: Element | null | undefined, cls: string, durationMs: number): void {
  if (!el) return;
  const pending = removals.get(el) ?? new Map<string, number>();
  removals.set(el, pending);
  window.clearTimeout(pending.get(cls));
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  pending.set(cls, window.setTimeout(() => el.classList.remove(cls), durationMs));
}

/**
 * A direct attack has no Monster to land on, so it is staged against the
 * defending duelist: the attacker's own art lunges at them, a painted strike
 * crosses the table, bursts on their portrait, and they and the mat recoil.
 *
 * Imperative like the rest of the card motion layer: it paints into the table
 * (which is positioned and clips its own overflow) and removes itself.
 *
 * Returns how long the caller should hold the damage number so it appears as
 * the blow lands. That is 0 when nothing travels: Reduce Motion, the lite
 * effects tier (`html.lite-fx`, weak devices), or a board that is not laid out.
 */
export function playChronicleDirectStrike(
  from: HTMLElement | null | undefined,
  combatant: Element | null | undefined,
): number {
  const table = from?.closest<HTMLElement>(".chronicle-table");
  if (!from || !combatant || !table || typeof window.matchMedia !== "function") return 0;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("lite-fx")) return 0;
  const bounds = table.getBoundingClientRect();
  const start = from.getBoundingClientRect();
  // Phones hide the player's own portrait; the blow then lands on the name
  // and Health Points strip that stands in for it.
  const portrait = combatant.querySelector(".chronicle-duelist-avatar")?.getBoundingClientRect();
  const end = portrait?.width ? portrait : combatant.getBoundingClientRect();
  if (!bounds.width || !start.width || !end.width) return 0;
  // A scaled ancestor reports scaled rects; the strike is laid out unscaled.
  const scale = bounds.width / table.offsetWidth || 1;
  const x = (start.left + start.width / 2 - bounds.left) / scale;
  const y = (start.top + start.height / 2 - bounds.top) / scale;
  // Sized to the board it crosses, so a phone gets the same picture, smaller.
  const burst = Math.round(Math.min(250, Math.max(150, table.offsetWidth * 0.17)));
  // A portrait sits in the table's corner, and the table clips: the burst
  // lands as near the portrait as keeps most of it on the table.
  const inset = burst * 0.36;
  const land = (centre: number, size: number) => Math.min(Math.max(centre, inset), Math.max(inset, size - inset));
  const dx = land((end.left + end.width / 2 - bounds.left) / scale, table.offsetWidth) - x;
  const dy = land((end.top + end.height / 2 - bounds.top) / scale, table.offsetHeight) - y;
  const distance = Math.hypot(dx, dy) || 1;
  const strike = document.createElement("span");
  strike.className = "chronicle-direct-strike";
  strike.setAttribute("aria-hidden", "true");
  strike.style.left = `${x}px`;
  strike.style.top = `${y}px`;
  strike.style.setProperty("--strike-dx", `${dx}px`);
  strike.style.setProperty("--strike-dy", `${dy}px`);
  strike.style.setProperty("--strike-angle", `${Math.atan2(dy, dx)}rad`);
  strike.style.setProperty("--strike-length", `${Math.round(Math.min(420, Math.max(190, distance * 0.62)))}px`);
  strike.style.setProperty("--strike-burst", `${burst}px`);
  strike.append(document.createElement("i"), document.createElement("b"));
  table.appendChild(strike);
  from.style.setProperty("--lunge-x", `${Math.round((dx / distance) * 34)}px`);
  from.style.setProperty("--lunge-y", `${Math.round((dy / distance) * 34)}px`);
  restartClass(from, "fx-direct-lunge", 480);
  window.setTimeout(() => {
    restartClass(combatant, "fx-direct-hit", 620);
    restartClass(table.querySelector(".chronicle-playmat"), "impact", 450);
  }, CHRONICLE_DIRECT_STRIKE_IMPACT_MS);
  window.setTimeout(() => strike.remove(), 950);
  return CHRONICLE_DIRECT_STRIKE_IMPACT_MS;
}
