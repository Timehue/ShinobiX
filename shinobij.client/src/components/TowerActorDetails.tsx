import type { TowerActor } from "../lib/towers-api";
import { partitionCombatDisplayStatuses } from "../lib/combat-action-display";
import { CombatDetailPortal } from "./CombatDetailPortal";
import { CombatEffectsPanel, PendingEffectsStrip } from "./CombatSideHud";

/** Same stacking, potency, duration, and delayed-effect display as PvE/PvP. */
export function TowerActorEffects({ actor, round }: { actor: TowerActor; round: number }) {
    const { active, pending } = partitionCombatDisplayStatuses(actor.statuses, round);
    const other = active.filter(status => status.kind !== "positive" && status.kind !== "negative");
    return <div className="tower-actor-effects">
        <CombatEffectsPanel title="Buffs" tone="positive" statuses={active.filter(status => status.kind === "positive")} />
        <CombatEffectsPanel title="Debuffs" tone="negative" statuses={active.filter(status => status.kind === "negative")} />
        {other.length > 0 && <CombatEffectsPanel title="Other effects" statuses={other} />}
        <PendingEffectsStrip statuses={pending} />
    </div>;
}

/** Read-only inspection of the current server snapshot. Opening this never submits a move. */
export function TowerActorDetails({ actor, round, avatar, triggerId, onClose, active, owned, intent, boss, barrier, nextPhase, signature, coordinated = false, inline = false }: {
    actor: TowerActor; round: number; avatar: string | null; triggerId: string; onClose: () => void;
    active: boolean; owned: boolean; intent?: string; boss: boolean; barrier: boolean; nextPhase?: number;
    inline?: boolean;
    coordinated?: boolean;
    signature?: { name: string; counter: string };
}) {
    const techniques = (Array.isArray(actor.character.jutsu) ? actor.character.jutsu : []) as Array<{ id?: string; name?: string; range?: number }>;
    const role = owned ? "Your shinobi" : actor.side === "npc" ? "Protected ally" : actor.side === "squad" ? "Squad ally" : boss ? "Floor commander" : "Opponent";
    const healthPercent = Math.max(0, Math.min(100, actor.hp / Math.max(1, actor.maxHp) * 100));
    const content = <>
            <div className={inline ? "tower-fighter-inline-heading" : "combat-jutsu-detail-header"}>
                {avatar && <img className="tower-fighter-portrait" src={avatar} alt="" />}
                <div><small>{role}{!inline && ` · ${actor.ai ? "AI controlled" : "Player controlled"}`}</small><strong id="tower-fighter-details-title" aria-live="polite">{actor.name}</strong></div>
                <button type="button" data-combat-detail-close aria-label="Close fighter details" onClick={onClose}>×</button>
            </div>
            <p className="tower-fighter-state">{actor.hp <= 0 ? "Defeated" : active ? "Acting now" : "Waiting for their turn"}{barrier ? " · Barrier active" : ""}</p>
            <div className="tower-fighter-health" data-side={actor.side} aria-label={`Health: ${Math.max(0, actor.hp)} of ${actor.maxHp}`}>
                <div><span>Health</span><strong>{Math.max(0, actor.hp)} / {actor.maxHp}</strong></div>
                <div className="tower-fighter-health-track"><span style={{ width: `${healthPercent}%` }} /></div>
            </div>
            <dl className="tower-fighter-vitals">
                <div><dt>Chakra</dt><dd>{Math.max(0, actor.chakra)} / {actor.maxChakra}</dd></div>
                <div><dt>Stamina</dt><dd>{Math.max(0, actor.stamina)} / {actor.maxStamina}</dd></div>
                <div><dt>Shield</dt><dd>{Math.max(0, actor.shield)}</dd></div>
            </dl>
            {boss && <p>{barrier ? "Defeat the remaining guards to remove the barrier." : nextPhase != null ? `Next phase at ${nextPhase}% health.` : "Final phase."}</p>}
            {signature && <p className="tower-signature-detail"><strong>{signature.name}</strong><br />{signature.counter}</p>}
            {coordinated && actor.side === "enemy" && actor.character.combatRole === "vanguard" && <p>Protects adjacent enemies from 20% of incoming damage.</p>}
            {coordinated && actor.side === "enemy" && actor.character.combatRole === "controller" && <p>Can restore a wounded ally every three rounds.</p>}
            <TowerActorEffects actor={actor} round={round} />
            {(techniques.length > 0 || (actor.ai && intent)) && <details className="tower-fighter-more"><summary>Combat details</summary>
                {actor.ai && intent && <p><strong>Combat tendency</strong><br />{intent}</p>}
                {techniques.length > 0 && <section aria-label="Fighter techniques"><h3>Techniques</h3><ul>{techniques.map((technique, index) => <li key={technique.id ?? index}>{technique.name ?? "Technique"}{technique.range != null ? ` · range ${technique.range}` : ""}{technique.id && (actor.cooldowns?.[technique.id] ?? 0) > 0 ? ` · cooldown ${actor.cooldowns![technique.id]}` : ""}</li>)}</ul></section>}
            </details>}
            {!inline && <button type="button" className="tower-fighter-return" onClick={onClose}>Back to battlefield</button>}
        </>;
    return inline ? (
        <section id="tower-fighter-details" className="tower-fighter-details tower-fighter-details--inline" aria-labelledby="tower-fighter-details-title">
            <h3 className="tower-sidebar-heading">Selected fighter</h3>{content}
        </section>
    ) : (
        <CombatDetailPortal id="tower-fighter-details" labelId="tower-fighter-details-title" triggerId={triggerId} onClose={onClose} className="tower-fighter-details">{content}</CombatDetailPortal>
    );
}
