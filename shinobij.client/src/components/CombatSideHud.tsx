import { K_AMP_PVE } from "../lib/combat-math";

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
};

// Tiny labels for the compact mobile strip (full name lives in the chip tooltip).
const TINY_LABELS: Record<string, string> = {
    "Increase Damage Given": "DMG↑",
    "Decrease Damage Given": "DMG↓",
    "Increase Damage Taken": "TKN↑",
    "Decrease Damage Taken": "TKN↓",
    "Lifesteal": "Steal",
    "Absorb": "Absorb",
    "Reflect": "Reflect",
    "Ignition": "Burn",
};
function tinyStatusLabel(name: string): string {
    return TINY_LABELS[name] ?? (name.length > 8 ? name.slice(0, 8) : name);
}

type GroupedStatus = { name: string; count: number; percent?: number; amount?: number; rounds: number };

// Group duplicate stacking statuses into one entry with a ×count, summing raw
// percent/amount. Shared by the desktop panel and the mobile strip so both read
// identically.
function groupStatuses(statuses: { name: string; rounds: number; amount?: number; percent?: number }[]): GroupedStatus[] {
    const grouped: GroupedStatus[] = [];
    for (const s of statuses) {
        const g = grouped.find((x) => x.name === s.name);
        if (g) {
            g.count += 1;
            g.rounds = Math.max(g.rounds, s.rounds);
            if (s.percent != null) g.percent = (g.percent ?? 0) + s.percent;
            if (s.amount != null) g.amount = (g.amount ?? 0) + s.amount;
        } else {
            grouped.push({ name: s.name, count: 1, percent: s.percent, amount: s.amount, rounds: s.rounds });
        }
    }
    return grouped;
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
    statuses: { name: string; rounds: number; amount?: number; percent?: number; kind: "positive" | "negative" }[];
    isActive?: boolean;
}) {
    const hpPct = Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
    const hpColor = hpPct > 50 ? "#22c55e" : hpPct > 25 ? "#f59e0b" : "#ef4444";
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
                {avatar.startsWith("data:image") || avatar.startsWith("blob:") || avatar.startsWith("/api/img") ? (
                    <img src={avatar} alt={name} />
                ) : (
                    avatar
                )}
            </div>

            <div className="resource-line">
                <span className="resource-label">HP <small>{hp} / {maxHp}</small></span>
                <div className="hud-bar hp-bar">
                    <span style={{ width: `${hpPct}%`, background: hpColor }} />
                </div>
            </div>

            <div className="resource-line">
                <span className="resource-label">Chakra <small>{chakra} / {maxChakra}</small></span>
                <div className="hud-bar chakra-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, (chakra / Math.max(1, maxChakra)) * 100))}%` }} />
                </div>
            </div>

            <div className="resource-line">
                <span className="resource-label">Stamina <small>{stamina} / {maxStamina}</small></span>
                <div className="hud-bar stamina-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, (stamina / Math.max(1, maxStamina)) * 100))}%` }} />
                </div>
            </div>

            {shield > 0 && (
                <div className="resource-line">
                    <span className="resource-label">Shield <small>{shield}</small></span>
                    <div className="hud-bar shield-bar">
                        <span style={{ width: `${Math.min(100, (shield / 1500) * 100)}%` }} />
                    </div>
                </div>
            )}

            <div className="combat-hud-meta">
                <span>Round {turn}</span>
            </div>

            {/* Compact glanceable strip — the ONLY effects readout on mobile,
                where the verbose Buffs/Debuffs columns below are hidden (they
                overflow the clamped HUD). Hidden on desktop via CSS. */}
            <MobileEffectsStrip statuses={statuses} />

            <CombatEffectsPanel title="Buffs" tone="positive" statuses={statuses.filter((s) => s.kind === "positive")} />
            <CombatEffectsPanel title="Debuffs" tone="negative" statuses={statuses.filter((s) => s.kind === "negative")} />
        </aside>
    );
}

export function CombatEffectsPanel({
    title,
    statuses,
    tone = "positive",
}: {
    title: string;
    statuses: { name: string; rounds: number; amount?: number; percent?: number }[];
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
                    const title = pooled
                        ? `${s.name} — ${s.count} stack${s.count > 1 ? "s" : ""} · +${rawPct}% raw ≈ ${effPct}% effective. Diminishing-returns pool shared with other damage modifiers.`
                        : capped
                            ? `${s.name} — ${s.count} stack${s.count > 1 ? "s" : ""} · +${rawPct}% total${(rawPct ?? 0) > HARD_CAP_PCT ? `, capped at ${HARD_CAP_PCT}%` : ""}.`
                            : s.name;
                    return (
                        <div key={i} className="effect-pill" title={title}>
                            <span>{label}{s.count > 1 ? <span className="effect-stack"> ×{s.count}</span> : null}</span>
                            <small>{valueText} · {s.rounds}r</small>
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
    statuses: { name: string; rounds: number; amount?: number; percent?: number; kind: "positive" | "negative" }[];
    max?: number;
}) {
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
                const value = statusValueText(g);
                return (
                    <span
                        key={i}
                        className={`cme-chip ${tone === "negative" ? "cme-neg" : "cme-pos"}`}
                        title={`${g.name}${g.count > 1 ? ` ×${g.count}` : ""} · ${value} · ${g.rounds}r`}
                    >
                        {tinyStatusLabel(g.name)}{g.count > 1 ? <b>×{g.count}</b> : null}
                        <small>{value !== "active" ? `${value} ` : ""}{g.rounds}r</small>
                    </span>
                );
            })}
            {overflow > 0 && <span className="cme-chip cme-more" title={`${overflow} more active effect${overflow > 1 ? "s" : ""}`}>+{overflow}</span>}
        </div>
    );
}
