export type PetRecallParticipant = () => Promise<void>;

/** A scene owns departure; only pets that actually mounted join its recall. */
export function createPetSceneRecallController() {
    const participants = new Set<PetRecallParticipant>();
    const listeners = new Set<() => void>();
    const started = new Set<PetRecallParticipant>();
    const flights = new Set<Promise<void>>();
    let active = false;
    let pending: Promise<void> | undefined;
    let gateComplete = false;
    const emit = () => { for (const listener of listeners) listener(); };
    const recall = (participant: PetRecallParticipant) => {
        if (started.has(participant)) return;
        started.add(participant);
        let flight: Promise<void>;
        try { flight = Promise.resolve(participant()); }
        catch (error) { flight = Promise.reject(error); }
        flights.add(flight);
        void flight.then(() => { flights.delete(flight); }, () => {});
    };
    return {
        snapshot: () => active,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        register: (participant: PetRecallParticipant) => {
            participants.add(participant);
            // A delayed model or incoming swap may commit while another pet's
            // card is still leaving. It joins the same departure before unmount.
            if (active && !gateComplete) recall(participant);
            return () => { participants.delete(participant); };
        },
        run(after: () => void | Promise<void>): Promise<void> {
            // A routed child callback can invoke its routed parent callback
            // after the cards have finished. Execute it without awaiting itself.
            if (pending) return gateComplete ? Promise.resolve().then(after) : pending;
            active = true;
            pending = Promise.resolve().then(async () => {
                while (flights.size) await Promise.all([...flights]);
                gateComplete = true;
                await after();
            }).finally(() => {
                active = false;
                pending = undefined;
                gateComplete = false;
                flights.clear();
                started.clear();
                emit();
            });
            emit();
            for (const participant of participants) recall(participant);
            return pending;
        },
    };
}
export type PetSceneRecallController = ReturnType<typeof createPetSceneRecallController>;
