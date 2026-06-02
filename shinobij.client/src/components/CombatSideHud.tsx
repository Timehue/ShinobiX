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
    const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
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
                {avatar.startsWith("data:image") || avatar.startsWith("blob:") ? (
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
                    <span style={{ width: `${Math.max(0, Math.min(100, (chakra / maxChakra) * 100))}%` }} />
                </div>
            </div>

            <div className="resource-line">
                <span className="resource-label">Stamina <small>{stamina} / {maxStamina}</small></span>
                <div className="hud-bar stamina-bar">
                    <span style={{ width: `${Math.max(0, Math.min(100, (stamina / maxStamina) * 100))}%` }} />
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

            <CombatEffectsPanel title="Buffs" statuses={statuses.filter((s) => s.kind === "positive")} />
            <CombatEffectsPanel title="Debuffs" statuses={statuses.filter((s) => s.kind === "negative")} />
        </aside>
    );
}

export function CombatEffectsPanel({
    title,
    statuses,
}: {
    title: string;
    statuses: { name: string; rounds: number; amount?: number; percent?: number }[];
}) {
    // Group duplicate stacking statuses (e.g. three "Increase Damage Given")
    // into one pill with a ×count, summing the raw percent. For soft-cap pool
    // tags we also show the approximate effective % in a tooltip so players see
    // that stacks diminish rather than add linearly.
    const grouped: { name: string; count: number; percent?: number; amount?: number; rounds: number }[] = [];
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
    return (
        <div className="combat-effect-panel">
            <h4>{title}</h4>
            {grouped.length === 0 ? (
                <p className="empty-effects">No active effects</p>
            ) : (
                grouped.map((s, i) => {
                    const pooled = s.percent != null && POOL_TAGS.has(s.name);
                    const tooltip = pooled
                        ? `${s.count} stack${s.count > 1 ? "s" : ""} · +${s.percent}% raw ≈ ${effectivePoolPercent(s.percent ?? 0)}% effective. Diminishing-returns pool shared with other damage modifiers.`
                        : undefined;
                    return (
                        <div key={i} className="effect-pill" title={tooltip}>
                            <span>{s.name}{s.count > 1 ? ` ×${s.count}` : ""}</span>
                            <small>
                                {s.percent != null
                                    ? (pooled ? `${s.percent}% → ~${effectivePoolPercent(s.percent)}%` : `${s.percent}%`)
                                    : s.amount != null ? `${s.amount}` : "active"} | {s.rounds}r
                            </small>
                        </div>
                    );
                })
            )}
        </div>
    );
}
