import { safeName } from './_utils.js';

/**
 * Territory guards are self-service. A member or appointed ANBU may add/remove
 * only their own name; a crafted full-row write cannot replace other guards.
 */
export function territoryGuardsAfterSelfUpdate(
    previous: unknown,
    requested: unknown,
    actor: string,
): string[] | null {
    const prior = Array.isArray(previous)
        ? previous.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];
    const incoming = Array.isArray(requested)
        ? requested.map((value) => String(value ?? '').trim()).filter(Boolean)
        : [];
    const actorSlug = safeName(actor);
    if (!actorSlug) return null;
    const priorSlugs = new Set(prior.map((name) => safeName(name)).filter(Boolean));
    const incomingSlugs = new Set(incoming.map((name) => safeName(name)).filter(Boolean));
    const all = new Set([...priorSlugs, ...incomingSlugs]);
    for (const name of all) {
        if (name !== actorSlug && priorSlugs.has(name) !== incomingSlugs.has(name)) return null;
    }
    const hadActor = priorSlugs.has(actorSlug);
    const wantsActor = incomingSlugs.has(actorSlug);
    if (hadActor === wantsActor) return prior;
    if (!wantsActor) return prior.filter((name) => safeName(name) !== actorSlug);
    const actorDisplay = incoming.find((name) => safeName(name) === actorSlug) ?? actor;
    return [...prior.filter((name) => safeName(name) !== actorSlug), actorDisplay].slice(0, 20);
}
