/** Load roster metadata separately from executable game code. */
export function createSectorModelPinStore(portraits: readonly (string | null)[], read: () => Promise<unknown>) {
    const revisions: Record<string,string> = Object.create(null);
    const portraitModels = new Map<string,string>();
    const listeners = new Set<() => void>();
    let pending: Promise<void> | undefined;
    let ready = 0;
    function loadPins(): Promise<void> {
        if (ready) return Promise.resolve();
        if (pending) return pending;
        pending = read().then(value => {
            if (!Array.isArray(value) || value.length !== portraits.length) throw new Error("Invalid model registry");
            const rows = value as unknown[];
            const seen = new Set<string>();
            for (const row of rows) {
                if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string" ||
                    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row[0]) || typeof row[1] !== "string" ||
                    !/^[a-f0-9]{64}$/.test(row[1]) || seen.has(row[0])) throw new Error("Invalid model registry");
                seen.add(row[0]);
            }
            rows.forEach((value, index) => {
                const [slug, revision] = value as [string,string];
                revisions[slug] = revision;
                if (portraits[index]) portraitModels.set(portraits[index]!, slug);
            });
            ready = 1;
            listeners.forEach(listener => listener());
        }).catch(error => { pending = undefined; throw error; });
        return pending;
    }
    function subscribe(listener: () => void) {
        listeners.add(listener);
        let active = true;
        let retry: ReturnType<typeof setTimeout> | undefined;
        function attempt() {
            void loadPins().catch(() => { if(active) retry = setTimeout(attempt, 3000); });
        }
        attempt();
        return () => { active = false; clearTimeout(retry); listeners.delete(listener); };
    }
    return {revisions, portraitModels, loadPins, subscribe, snapshot:() => ready};
}
