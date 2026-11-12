declare module 'virtual:sector-model-pins' {
    export const revisions: Readonly<Record<string,string>>;
    export const portraitModels: ReadonlyMap<string,string>;
    export function loadPins(): Promise<void>;
    export function subscribe(listener: () => void): () => void;
    export function snapshot(): number;
}
