import { useId } from "react";
import { K_AMP_PVE } from "../lib/combat-math";
import { isImageAvatar } from "../lib/avatar";
import { combatStatusDuration, combatStatusSemantics, type CombatStatusTone } from "../lib/combat-status-semantics";

// Tags that feed the diminishing-returns soft-cap pools in combat (see
// combat-math.ts). For these, stacking is NOT linear — the HUD surfaces the
// approximate effective % so players can read their build instead of assuming
// e.g. 3×35% = +105%.
const POOL_TAGS = new Set([
    "Increase Damage Given", "Increase Damage Taken", "Ignition",
    "Decrease Damage Given", "Decrease Damage Taken",
]);
function effectivePoolPercent(rawPct: number): number {
    const raw = Math.max(0, rawPct) / 100;
    return Math.round((raw / (raw + K_AMP_PVE)) * 100); // K_AMP == K_DR == 0.5
}

// Post-damage defensive tags that stack additively and are hard-capped in combat
// (cappedPostDamage in move.ts / combat-math.ts caps the applied % at 60). The
// panel shows the capped total so a stacked Absorb/Reflect/Lifesteal can't read
// as e.g. "90%".
const CAP_SUM_TAGS = new Set(["Absorb", "Reflect", "Lifesteal"]);
const HARD_CAP_PCT = 60;

// Short, single-line labels for the verbose damage-modifier tags. The full
// canonical name stays in the hover tooltip; this just keeps "Decrease Damage
// Taken" from wrapping into a tall, hard-to-read column in the side panel.
const SHORT_LABELS: Record<string, string> = {
    "Increase Damage Given": "Damage dealt ↑",
    "Decrease Damage Given": "Damage dealt ↓",
    "Increase Damage Taken": "Damage taken ↑",
    "Decrease Damage Taken": "Damage taken ↓",
    "Increase Generals": "General stats ↑",
    "Increase Discipline": "Style offense ↑",
};

// Tiny labels for the compact mobile strip (full name lives in the chip tooltip).
const TINY_LABELS: Record<string, string> = {
    "Increase Damage Given": "DMG↑",
    "Decrease Damage Given": "DMG↓",
    "Increase Damage Taken": "TKN↑",
    "Decrease Damage Taken": "TKN↓",
    "Increase Generals": "GEN↑",
    "Increase Discipline": "STY↑",
    "Lifesteal": "Steal",
    "Absorb": "Absorb",
    "Reflect": "Reflect",
    "Ignition": "Burn",
};
function tinyStatusLabel(name: string): string {
    return TINY_LABELS[name] ?? (name.length > 8 ? name.slice(0, 8) : name);
}

export type CombatHudStatus = {
    name: string;
    rounds: number;
    amount?: number;
    percent?: number;
    kind: CombatStatusTone;
    /** Authoritative origin when known (jutsu, weapon, zone, or system). */
    source?: string;
};

type GroupedStatus = {
    name: string;
    count: number;
    percent?: number;
    amount?: number;
    minRounds: number;
    maxRounds: number;
    sources: string[];
};

// Group duplicate stacking statuses into one entry with a ×count, summing raw
// percent/amount. Shared by the desktop panel and the mobile strip so both read
// identically.
function groupStatuses(statuses: Array<Omit<CombatHudStatus, "kind">>): GroupedStatus[] {
    const grouped: GroupedStatus[] = [];
    for (const s of statuses) {
        const g = grouped.find((x) => x.name === s.name);
        if (g) {
            g.count += 1;
            g.minRounds = Math.min(g.minRounds, s.rounds);
            g.maxRounds = Math.max(g.maxRounds, s.rounds);
            if (s.percent != null) g.percent = (g.percent ?? 0) + s.percent;
            if (s.amount != null) g.amount = (g.amount ?? 0) + s.amount;
            if (s.source && !g.sources.includes(s.source)) g.sources.push(s.source);
        } else {
            grouped.push({ name: s.name, count: 1, percent: s.percent, amount: s.amount, minRounds: s.rounds, maxRounds: s.rounds, sources: s.source ? [s.source] : [] });
        }
    }
    return grouped;
}

function statusDurationText(s: GroupedStatus, compact = false): string {
    return combatStatusDuration(s.minRounds, s.maxRounds, compact);
}

function statusPresentation(s: GroupedStatus, tone: CombatStatusTone) {
    const semantics = combatStatusSemantics({ name: s.name, kind: tone, source: s.sources.join(", ") });
    const value = statusValueText(s);
    const duration = statusDurationText(s);
    const stacks = `${s.count} stack${s.count === 1 ? "" : "s"}`;
    const readable = `${s.name}${s.count > 1 ? ` ×${s.count}` : ""}: ${value}, ${duration}; ${semantics.category}. ${semantics.effect}. Source: ${semantics.source}. ${semantics.removal}.`;
    return { semantics, value, duration, stacks, readable };
}

function StatusPopover({ id, status, tone }: { id: string; status: GroupedStatus; tone: CombatStatusTone }) {
    const { semantics, value, duration, stacks } = statusPresentation(status, tone);
    const titleId = `${id}-title`;
    return (
        <div id={id} popover="auto" className="cme-status-popover" role="dialog" aria-labelledby={titleId}>
            <header>
                <strong id={titleId}><span aria-hidden="true">{semantics.icon}</span> {status.name}</strong>
                <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={`Close ${status.name} details`}>×</button>
            </header>
            <dl>
                <div><dt>Category</dt><dd>{semantics.category}</dd></div>
                <div><dt>Effect</dt><dd>{semantics.effect}</dd></div>
                <div><dt>Value</dt><dd>{value}</dd></div>
                <div><dt>Stacks</dt><dd>{stacks}</dd></div>
                <div><dt>Duration</dt><dd>{duration}</dd></div>
                <div><dt>Source</dt><dd>{semantics.source}</dd></div>
                <div><dt>Removal</dt><dd>{semantics.removal}</dd></div>
            </dl>
        </div>
    );
}

// The value that actually fires for a grouped status: effective % for soft-cap
// pool tags once stacked, the 60%-capped total for Absorb/Reflect/Lifesteal,
// else the raw rounded %/amount. Shared by panel + strip.
function statusValueText(s: GroupedStatus): string {
    const pooled = s.percent != null && POOL_TAGS.has(s.name);
    const capped = s.percent != null && CAP_SUM_TAGS.has(s.name);
    const rawPct = s.percent != null ? Math.round(s.percent) : null;
    const effPct = pooled ? effectivePoolPercent(s.percent ?? 0) : null;
    const cappedPct = capped ? Math.min(rawPct ?? 0, HARD_CAP_PCT) : null;
    return s.percent != null
        ? (pooled && s.count > 1 ? `~${effPct}%` : capped ? `${cappedPct}%` : `${rawPct}%`)
        : s.amount != null ? `${Math.round(s.amount)}` : "active";
}

export function CombatSideHud({
    name,
    avatar,
    hp,
    maxHp,
    chakra,
    maxChakra,
    stamina,
    maxStamina,
    shield,
    village,
    turn,
    statuses,
    isActive,
    level,
    power,
}: {
    name: string;
    avatar: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    village: string;
    turn: number;
    statuses: CombatHudStatus[];
    isActive?: boolean;
    /** Optional dossier footer stats (level star + power). Omitted callers render no footer. */
    level?: number;
    power?: number;
}) {
    const hpPct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    const hpColor = hpPct > 50 ? "var(--success)" : hpPct > 25 ? "var(--gold-2)" : "var(--danger)";
    return (
        <aside className={`combat-side-hud${isActive ? " combat-side-hud--active" : ""}`}>
            <div className="combat-hud-header">
                <h3>{name}</h3>
                {village && <span className="combat-hud-village">{village}</span>}
                <span className={`combat-hud-turn-badge${isActive ? " turn-badge-active" : " turn-badge-waiting"}`}>
                    {isActive ? "Acting" : "Waiting"}
                </span>
            </div>

            <div className="combat-avatar">
                {isImageAvatar(avatar) ? (
                    <>
                        <span className="combat-avatar-fallback" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>
                        <img src={avatar} alt={name} fetchPriority="high" />
                    </>
                ) : (
                    avatar
                )}
            </div>

            {/* `resource-line--hp` lets the mobile combat CSS hide JUST the HP row
                (chakra/stamina share `.resource-line`) once HP is shown on the
                board via FighterHpBadge — chakra/stamina/shield stay visible. */}
            <div className="resource-line resource-line--hp">
                <span className="resource-label">HP <small>{hp} / {maxHp}</small></span>
                <div className="hud-bar hp-bar">
                    <span style={{ width: `${hpPct}%`, background: hpColor }} />
                </div>
            </div>

            <div className="resource-line resource-line--chakra">
                <span className="resource-label">Chakra <small>{chakra} / {maxChakra}</small></span>
                <div className="hud-bar chakra-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, (chakra / Math.max(1, maxChakra)) * 100))}%` }} />
                </div>
            </div>

            <div className="resource-line resource-line--stamina">
                <span className="resource-label">Stamina <small>{stamina} / {maxStamina}</small></span>
                <div className="hud-bar stamina-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, (stamina / Math.max(1, maxStamina)) * 100))}%` }} />
                </div>
            </div>

            {shield > 0 && (
                <div className="resource-line resource-line--shield">
                    <span className="resource-label">Shield <small>{shield}</small></span>
                    <div className="hud-bar shield-bar">
                        <span style={{ width: `${Math.min(100, (shield / 1500) * 100)}%` }} />
                    </div>
                </div>
            )}

            {/* Compact glanceable buff/debuff strip — sits BELOW the resource bars
                (HP/Chakra/Stamina/Shield) on mobile so the stat block reads as one
                unit with its effects underneath. The ONLY effects readout on mobile
                (the verbose Buffs/Debuffs columns below are hidden there); desktop
                hides this strip and shows the columns instead. */}
            <MobileEffectsStrip statuses={statuses} />

            <div className="combat-hud-meta">
                <span>Round {turn}</span>
            </div>

            <CombatEffectsPanel title="Buffs" tone="positive" statuses={statuses.filter((s) => s.kind === "positive")} />
            <CombatEffectsPanel title="Debuffs" tone="negative" statuses={statuses.filter((s) => s.kind === "negative")} />

            {/* Dossier footer — level + accumulated power, the two numbers that
                frame "how big is this fighter" at a glance. Rendered only when a
                caller supplies them so Towers/legacy consumers are unchanged. */}
            {(level != null || power != null) && (
                <div className="combat-hud-stats">
                    {level != null && (
                        <span className="chs-stat" title="Level">
                            <i className="chs-icon chs-icon--level" aria-hidden="true" />
                            {level}
                        </span>
                    )}
                    {power != null && (
                        <span className="chs-stat" title="Power">
                            <i className="chs-icon chs-icon--power" aria-hidden="true" />
                            {power.toLocaleString()}
                        </span>
                    )}
                </div>
            )}
        </aside>
    );
}

export function CombatEffectsPanel({
    title,
    statuses,
    tone = "positive",
}: {
    title: string;
    statuses: Array<Omit<CombatHudStatus, "kind">>;
    tone?: "positive" | "negative";
}) {
    // Group duplicate stacking statuses (e.g. three "Increase Damage Given")
    // into one pill with a ×count, summing the raw percent. For soft-cap pool
    // tags we also show the approximate effective % in a tooltip so players see
    // that stacks diminish rather than add linearly.
    const grouped = groupStatuses(statuses);
    return (
        <div className={`combat-effect-panel ${tone === "negative" ? "effects-debuff" : "effects-buff"}`}>
            <h4>{title}</h4>
            {grouped.length === 0 ? (
                <p className="empty-effects">No active effects</p>
            ) : (
                grouped.map((s, i) => {
                    // Pool tags stack into a diminishing-returns curve, so a raw
                    // sum (e.g. "63%") overstates the real effect. Show the rounded
                    // effective % once stacked; a single instance reads its own
                    // face value. Always round — the raw percents carry mastery
                    // scaling that would otherwise print as "21.799999999999997%".
                    const pooled = s.percent != null && POOL_TAGS.has(s.name);
                    const capped = s.percent != null && CAP_SUM_TAGS.has(s.name);
                    const rawPct = s.percent != null ? Math.round(s.percent) : null;
                    const effPct = pooled ? effectivePoolPercent(s.percent ?? 0) : null;
                    const valueText = statusValueText(s);
                    const label = SHORT_LABELS[s.name] ?? s.name;
                    const semantics = combatStatusSemantics({ name: s.name, kind: tone, source: s.sources.join(", ") });
                    const mechanics = pooled
                        ? `${s.name} — ${s.count} stack${s.count > 1 ? "s" : ""} · +${rawPct}% raw ≈ ${effPct}% effective. Diminishing-returns pool shared with other damage modifiers.`
                        : capped
                            ? `${s.name} — ${s.count} stack${s.count > 1 ? "s" : ""} · +${rawPct}% total${(rawPct ?? 0) > HARD_CAP_PCT ? `, capped at ${HARD_CAP_PCT}%` : ""}.`
                            : s.name;
                    const duration = statusDurationText(s);
                    const tooltip = `${mechanics} ${semantics.effect}. Source: ${semantics.source}. ${semantics.removal}. ${duration} remaining.`;
                    return (
                        <div key={i} className="effect-pill" title={tooltip} aria-label={tooltip}>
                            <span className="effect-pill-name"><span className="effect-status-icon" aria-hidden="true">{semantics.icon}</span>{label}{s.count > 1 ? <span className="effect-stack"> ×{s.count}</span> : null}</span>
                            <span className="effect-pill-readout">
                                <small>{valueText} · {duration} · {semantics.category}</small>
                                <small className="effect-pill-context">{semantics.source} · {semantics.removal}</small>
                            </span>
                        </div>
                    );
                })
            )}
        </div>
    );
}

// Compact one-row status strip for mobile combat. Both PvP + PvE hide the
// verbose CombatEffectsPanel columns on phones (they overflow the clamped side
// HUD), so this keeps active buffs/debuffs — name, ×stacks, the value that
// actually fires, and rounds left — glanceable where turns are decided. Capped
// with a "+N" chip so a heavily-affected fighter can't overflow the strip.
// Hidden on desktop via CSS (.combat-mobile-effects { display:none }).
export function MobileEffectsStrip({
    statuses,
    max = 6,
}: {
    statuses: CombatHudStatus[];
    max?: number;
}) {
    const idPrefix = `combat-effect-${useId().replace(/:/g, "")}`;
    const entries = [
        ...groupStatuses(statuses.filter((s) => s.kind === "positive")).map((g) => ({ g, tone: "positive" as const })),
        ...groupStatuses(statuses.filter((s) => s.kind === "negative")).map((g) => ({ g, tone: "negative" as const })),
    ];
    if (entries.length === 0) return null;
    const shown = entries.slice(0, max);
    const overflow = entries.length - shown.length;
    return (
        <div className="combat-mobile-effects" aria-label="Active effects">
            {shown.map(({ g, tone }, i) => {
                const id = `${idPrefix}-${i}`;
                const { semantics, value, readable } = statusPresentation(g, tone);
                return (
                    <div className="cme-entry" key={`${tone}-${g.name}-${i}`}>
                        <button
                            type="button"
                            className={`cme-chip ${tone === "negative" ? "cme-neg" : "cme-pos"}`}
                            popoverTarget={id}
                            aria-haspopup="dialog"
                            aria-controls={id}
                            aria-label={`Inspect ${readable}`}
                        >
                            <span className="effect-status-icon" aria-hidden="true">{semantics.icon}</span>{tinyStatusLabel(g.name)}{g.count > 1 ? <b>×{g.count}</b> : null}
                            <small>{value !== "active" ? `${value} ` : ""}{statusDurationText(g, true)}</small>
                        </button>
                        <StatusPopover id={id} status={g} tone={tone} />
                    </div>
                );
            })}
            {overflow > 0 && (() => {
                const id = `${idPrefix}-more`;
                return (
                    <div className="cme-entry">
                        <button type="button" className="cme-chip cme-more" popoverTarget={id} aria-haspopup="dialog" aria-controls={id} aria-label={`${overflow} more active effects`}>+{overflow}</button>
                        <div id={id} popover="auto" className="cme-status-popover cme-overflow-popover" role="dialog" aria-labelledby={`${id}-title`}>
                            <header>
                                <strong id={`${id}-title`}>More active effects</strong>
                                <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close active effect details">×</button>
                            </header>
                            <ul>
                                {entries.slice(max).map(({ g, tone: hiddenTone }, hiddenIndex) => {
                                    const { semantics, value, duration } = statusPresentation(g, hiddenTone);
                                    return <li key={`${hiddenTone}-${g.name}-${hiddenIndex}`}><strong><span aria-hidden="true">{semantics.icon}</span> {g.name}{g.count > 1 ? ` ×${g.count}` : ""}</strong><span>{value} · {duration} · {semantics.category}</span><span>{semantics.effect}</span><span>Source: {semantics.source} · {semantics.removal}</span></li>;
                                })}
                            </ul>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
