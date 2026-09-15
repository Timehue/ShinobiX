/** Stable unsigned integer hash shared by browser and host. No wall-clock or Math.random in simulations. */
export function sunscarHash(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
}
export function sunscarRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let n = Math.imul(state ^ (state >>> 15), state | 1);
        n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}
export function sunscarShuffle<T>(values: readonly T[], seed: number): T[] {
    const copy = [...values];
    const rand = sunscarRandom(seed);
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
