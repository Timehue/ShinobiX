import { coastPost } from "./coast-service";

// Keep field entry behind any town entry still in flight during quick navigation.
let pending = Promise.resolve();
export function changeTownPresence(action: "town-enter" | "town-leave") {
    const request = pending.then(() => coastPost<{ sector?: number }>("landing", { action }));
    pending = request.then(() => {}, () => {});
    return request;
}

export async function readTownPresence(signal: AbortSignal) {
    await pending;
    if (signal.aborted) return;
    const state = await coastPost<{ inTown: boolean }>("landing", { action: "status" }, signal);
    return state.inTown;
}
