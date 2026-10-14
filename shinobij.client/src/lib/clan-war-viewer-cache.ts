/** Private projections must follow the viewer, including direct cache readers. */
export function createClanWarViewerCache<T extends { id: string; updatedAt: number }>(viewer: () => string | null) {
    const rows: Record<string, T> = {};
    let owner: string | null | undefined;
    let generation = 0;
    function scope() {
        const current = viewer()?.trim().toLowerCase() ?? null;
        if (owner !== current) {
            for (const id of Object.keys(rows)) delete rows[id];
            owner = current;
            generation++;
        }
        return generation;
    }
    const cache = new Proxy(rows, {
        get(target, key) { scope(); return Reflect.get(target, key); },
        ownKeys(target) { scope(); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) { scope(); return Reflect.getOwnPropertyDescriptor(target, key); },
        has(target, key) { scope(); return Reflect.has(target, key); },
    });
    function current(captured: number) { return scope() === captured; }
    function accept(row: T, captured: number): T | undefined {
        if (!current(captured)) return undefined;
        const previous = rows[row.id];
        if (previous && previous.updatedAt > row.updatedAt) return previous;
        rows[row.id] = row;
        return row;
    }
    return { cache, scope, current, accept };
}
