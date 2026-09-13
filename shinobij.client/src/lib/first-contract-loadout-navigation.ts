// Ephemeral UI intent, never persisted as player progression. Each tab level
// consumes independently so a lazily mounted Jutsu panel cannot miss a request.
type Consumer = 'profile' | 'workspace';
const requests = new Map<string, number>();
const handled = new Map<string, number>();
const listeners = new Set<() => void>();
export function firstContractLoadoutRequest(name: string): number {
    return requests.get(name.toLowerCase()) ?? 0;
}
export function subscribeFirstContractLoadout(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function requestFirstContractLoadout(name: string): void {
    requests.set(name.toLowerCase(), firstContractLoadoutRequest(name) + 1);
    listeners.forEach((listener) => listener());
}
export function hasFirstContractLoadoutRequest(name: string, consumer: Consumer): boolean {
    return firstContractLoadoutRequest(name) > (handled.get(`${name.toLowerCase()}:${consumer}`) ?? 0);
}
export function acknowledgeFirstContractLoadoutRequest(name: string, consumer: Consumer, request: number): void {
    const key = `${name.toLowerCase()}:${consumer}`;
    handled.set(key, Math.max(handled.get(key) ?? 0, request));
}
