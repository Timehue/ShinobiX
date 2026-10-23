/** The same moving shoal and projectile collision are replayed on the server. */
export type KunaiThrow = { kind: 'throw'; at: number; x: number; y: number };
export const KUNAI_READY_MS = 650;
export const KUNAI_LIMIT_MS = 18_000;
export const KUNAI_RETURN_MS = 850;
export const KUNAI_HAUL_MS = 1250;
export const kunaiFlightMs = (shot: KunaiThrow) => 230 + Math.hypot(shot.x - 50, (shot.y - 94) * .65) * 5;
export const kunaiSeed = (attempt: { hookAt: number; template: number }) => attempt.hookAt + attempt.template * 997;
export const KUNAI_SPECIES = [
    { id: 'dace', name: 'Silver Dace', label: 'Dace', level: 1, art: 0, size: .85 },
    { id: 'carp', name: 'Bronze Carp', label: 'Carp', level: 4, art: 1, size: 1 },
    { id: 'trout', name: 'Speckled Trout', label: 'Trout', level: 7, art: 2, size: 1.1 },
    { id: 'sturgeon', name: 'River Sturgeon', label: 'Sturgeon', level: 10, art: 3, size: 1.3 },
] as const;
/** Always leaves an attainable fish while introducing the next skill tier. */
export const kunaiShoal = (level: number) => KUNAI_SPECIES.slice(level >= 7 ? 1 : 0, level >= 7 ? 4 : 3);
export type KunaiCatch = { name: string; requiredLevel: number; fisherLevel: number; tooStrong: boolean };

export function kunaiFish(seed: number, index: number, at: number, misses: readonly KunaiThrow[] = []) {
    const phase = seed * .013 + index * 2.1, t = at / 1000;
    const speed = [.48, .36, .63][index];
    let x = 50 + Math.sin(t * speed + phase) * 32;
    let y = 43 + Math.sin(t * .51 + phase * 1.7) * 19;
    for (const shot of misses) {
        const age = at - shot.at - kunaiFlightMs(shot);
        if (age < 0 || age > 1800) continue;
        const strength = Math.sin(Math.min(1, age / 180) * Math.PI / 2) * Math.exp(-age / 650);
        x += Math.sign(x - shot.x || 1) * strength * 14;
        y += Math.sign(y - shot.y || 1) * strength * 8;
    }
    return { x: Math.max(9, Math.min(91, x)), y: Math.max(17, Math.min(73, y)),
        angle: Math.cos(t * speed + phase) > 0 ? 0 : Math.PI,
        rx: [6.2, 5.8, 5.4][index], ry: [4, 4.6, 3.8][index] };
}

export function scoreKunaiFishing(seed: number, events: unknown, elapsed: number, preview = false, skillLevel?: number) {
    if (!Array.isArray(events) || events.length > 3 || !Number.isFinite(elapsed) || elapsed < 0) return null;
    const shots = events as KunaiThrow[];
    const misses: KunaiThrow[] = [];
    let availableAt = KUNAI_READY_MS, hit = -1, impactAt = 0, endAt = KUNAI_LIMIT_MS, accuracy = 0;
    for (let index = 0; index < shots.length; index++) {
        const shot = shots[index];
        if (!shot || shot.kind !== 'throw' || !Number.isFinite(shot.at) || !Number.isFinite(shot.x) || !Number.isFinite(shot.y)
            || shot.x < 6 || shot.x > 94 || shot.y < 12 || shot.y > 78 || shot.at < availableAt
            || shot.at > KUNAI_LIMIT_MS - 1000 || shot.at > elapsed + 100 || hit !== -1) return null;
        const impact = shot.at + kunaiFlightMs(shot);
        // Collisions use where the fish will be when the blade reaches the water.
        let distance = Infinity;
        for (let fish = 0; fish < 3; fish++) {
            const point = kunaiFish(seed, fish, impact, misses);
            const d = ((shot.x - point.x) / point.rx) ** 2 + ((shot.y - point.y) / point.ry) ** 2;
            if (d <= 1 && d < distance) { hit = fish; distance = d; }
        }
        if (hit !== -1) {
            impactAt = impact; endAt = impact + KUNAI_HAUL_MS;
            accuracy = Math.max(1, 10 - index * 2 - Math.floor(Math.sqrt(distance) * 2));
        } else { misses.push(shot); availableAt = impact + KUNAI_RETURN_MS; }
    }
    if (hit === -1 && shots.length === 3) endAt = availableAt;
    const species = hit !== -1 && skillLevel != null ? kunaiShoal(skillLevel)[hit] : undefined;
    const blocked = species != null && species.level > skillLevel!;
    const catchInfo: KunaiCatch | undefined = species ? { name: species.name, requiredLevel: species.level, fisherLevel: skillLevel!, tooStrong: blocked } : undefined;
    const done = elapsed >= endAt;
    if (!preview && !done) return null;
    const last = shots.at(-1), impact = last ? last.at + kunaiFlightMs(last) : 0;
    const phase = done ? hit === -1 ? 'escaped' : blocked ? 'outmatched' : 'landed'
        : last && elapsed < impact ? 'flight'
        : hit !== -1 ? blocked ? 'resisting' : 'hauling'
        : last && elapsed < availableAt ? 'returning' : 'aiming';
    return { done, phase, failed: hit === -1 || blocked, performance: hit === -1 || blocked ? 0 : accuracy,
        blocked, catchInfo, hit, impactAt, endAt, availableAt, misses, shots, remaining: 3 - shots.length };
}
