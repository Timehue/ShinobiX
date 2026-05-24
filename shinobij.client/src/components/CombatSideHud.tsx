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
    return (
        <div className="combat-effect-panel">
            <h4>{title}</h4>
            {statuses.length === 0 ? (
                <p className="empty-effects">No active effects</p>
            ) : (
                statuses.map((s, i) => (
                    <div key={i} className="effect-pill">
                        <span>{s.name}</span>
                        <small>{s.percent ? `${s.percent}%` : s.amount ? `${s.amount}` : "active"} | {s.rounds}r</small>
                    </div>
                ))
            )}
        </div>
    );
}
