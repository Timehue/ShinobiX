import type { TowerActor } from "../lib/towers-api";

/** A focused fighter dossier, with the same resource hierarchy as duel combat. */
export function TowerCombatantHud({ actor, avatar, label, active, onInspect, healthLabel = "Health" }: {
    actor: TowerActor;
    avatar: string;
    label: string;
    active: boolean;
    onInspect: () => void;
    healthLabel?: string;
}) {
    const resources = [
        { key: "hp", label: healthLabel, value: actor.hp, max: actor.maxHp },
        { key: "chakra", label: "Chakra", value: actor.chakra, max: actor.maxChakra },
        { key: "stamina", label: "Stamina", value: actor.stamina, max: actor.maxStamina },
    ];
    return (
        <section className="tower-combatant-hud" data-active={active || undefined} aria-label={`${actor.name} combat resources`}>
            <button type="button" className="tower-combatant-inspect" id={`tower-dossier-${actor.id}`}
                onClick={onInspect} aria-label={`Inspect ${actor.name}`} aria-controls="tower-fighter-details">
                <span className="tower-combatant-label">{label}{active && <b>Acting</b>}</span>
                <img className="tower-combatant-portrait" src={avatar} alt="" />
                <strong className="tower-combatant-name">{actor.name}</strong>
            </button>
            <div className="tower-combatant-resources">
                {resources.map(resource => (
                    <div className={`tower-combatant-resource tower-combatant-resource--${resource.key}`} key={resource.key}>
                        <span>{resource.label}<small>{Math.max(0, resource.value)} / {resource.max}</small></span>
                        <div className="tower-combatant-bar" role="progressbar" aria-label={`${actor.name} ${resource.label.toLowerCase()}`}
                            aria-valuemin={0} aria-valuemax={resource.max} aria-valuenow={Math.max(0, Math.min(resource.max, resource.value))}>
                            <i style={{ width: `${Math.max(0, Math.min(100, resource.value / Math.max(1, resource.max) * 100))}%` }} />
                        </div>
                    </div>
                ))}
                {actor.shield > 0 && <span className="tower-combatant-shield">Shield <b>{actor.shield}</b></span>}
            </div>
        </section>
    );
}
