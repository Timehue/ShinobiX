import type { ShowdownEvent } from "../../../shared/pet-showdown-contract";

/** Describe resolved events without turning internal effect IDs into sentences. */
export function describeShowdownBeat(event: ShowdownEvent, nameOf: (id: string) => string): string {
    switch (event.t) {
        case "roundStart": return `Round ${event.round}.`;
        case "action": {
            const actor = nameOf(event.actorId);
            if (event.moveKind === "guard") return `${actor} uses Guard to reduce direct-hit damage this round.`;
            if (event.moveKind === "rest") return `${actor} uses Rest to recover stamina. Rest does not heal HP.`;
            const hits = event.targets.map(target => {
                const who = nameOf(target.id);
                const parts: string[] = [];
                if (target.damage > 0) parts.push(`${who} takes ${target.damage} damage${target.guarded ? " through its guard" : ""}`);
                else if (target.heal > 0 || target.applied === "heal") parts.push(`${who} restores ${target.heal} HP`);
                else {
                    // Offensive events can carry the attempted status even when
                    // immunity stopped it. Only narrate confirmed utility effects.
                    const utility: Record<string, string> = {
                        buff: `${who} gains attack power`,
                        haste: `${who} gains speed`,
                        shield: `${who} gains a shield`,
                        taunt: `${who} draws enemy attacks`,
                        tauntGuard: `${who} takes less damage`,
                        protect: event.moveKind === "protect" ? `${who} gains Protect` : `${who} blocks the hit with Protect`,
                        cleanse: `${who}'s harmful conditions are cleared`,
                        weather: `the field changes to ${event.element}`,
                        failed: `${who}'s Protect fails because it was used last round`,
                    };
                    parts.push(utility[target.applied ?? ""] ?? `${who} takes no damage`);
                }
                if (target.effectiveness === "super") parts.push("super effective");
                else if (target.effectiveness === "weak") parts.push("not very effective");
                if (target.ko) parts.push(`${who} is knocked out`);
                return parts.join(", ");
            });
            const overdraft = event.overexerted
                ? ` ${actor} overexerts${event.overexertDamage ? `, losing ${event.overexertDamage} HP,` : ""} and will miss its next action.`
                : "";
            return `${actor} uses ${event.moveName}.${hits.length ? ` ${hits.join(". ")}.` : ""}${overdraft}`;
        }
        case "skip": {
            const actor = nameOf(event.actorId);
            return event.reason === "winded" ? `${actor} is winded and misses its action.`
                : event.reason === "stun" ? `${actor} is stunned and misses its action.`
                    : event.reason === "freeze" ? `${actor} is frozen and misses its action.`
                        : `${actor} is knocked out and cannot act.`;
        }
        case "confused": {
            const actor = nameOf(event.actorId);
            return `${actor} loses ${event.selfDamage} HP by hurting itself in confusion.${event.ko ? ` ${actor} is knocked out.` : ""}`;
        }
        case "switch": return event.side === "player" ? `${nameOf(event.inId)} takes the field.` : `The enemy sends in ${nameOf(event.inId)}.`;
        case "dot": {
            const who = nameOf(event.targetId);
            const cause = ({ dot: "ongoing damage", burn: "Burn", wound: "Wound", attrition: "late-round attrition" } as Record<string, string>)[event.kind] ?? "an ongoing effect";
            return `${who} takes ${event.damage} damage from ${cause}.${event.ko ? ` ${who} is knocked out.` : ""}`;
        }
        case "consumable": {
            const owner = nameOf(event.petId);
            const who = nameOf(event.targetId);
            const result = event.damage > 0 ? `${who} takes ${event.damage} reflected damage.`
                : event.heal > 0 ? `${who} restores ${event.heal} HP.`
                    : ({ dodge: `${owner} dodges the hit.`, mitigate: `${owner} takes less damage from the hit.`, endure: `${owner} survives the hit.`, cleanse: `${owner} removes harmful conditions.` } as Record<string, string>)[event.effect];
            return `${owner}'s ${event.itemName} activates.${result ? ` ${result}` : ""}${event.ko ? ` ${who} is knocked out.` : ""}`;
        }
        case "end": return event.outcome === "win" ? "Victory. The battle is over." : "Defeat. The battle is over.";
        default: return "";
    }
}
