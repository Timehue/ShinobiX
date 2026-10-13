/* eslint-disable react-refresh/only-export-components -- shared scene context */
import { createContext, createElement, useContext, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createPetSceneRecallController, type PetSceneRecallController } from '../lib/pet-scene-recall';

const Context = createContext<PetSceneRecallController | null>(null);
const noSubscription = () => () => {};
const inactive = () => false;
export function PetSceneRecall({ controller, children }: { controller: PetSceneRecallController; children: ReactNode }) {
    return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function usePetRecallController() { return useContext(Context); }
export function usePetSceneIsRecalling() {
    const controller = usePetRecallController();
    return useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.snapshot ?? inactive, inactive);
}
export function usePetSceneRecall() {
    const [controller] = useState(createPetSceneRecallController);
    const recalling = useSyncExternalStore(controller.subscribe, controller.snapshot, inactive);
    return { controller, recalling };
}

/** Route all public scene departure callbacks through the same mounted-pet gate. */
export function withPetSceneRecall<P extends object>(Scene: ComponentType<P>, departures: readonly (keyof P)[]): ComponentType<P> {
    function RecallScene(props: P) {
        const enclosing = usePetRecallController();
        const local = usePetSceneRecall();
        const controller = enclosing ?? local.controller;
        const routed = { ...props };
        for (const key of departures) {
            const callback = props[key];
            if (typeof callback !== 'function') continue;
            const invoke = callback as (...args: unknown[]) => void | Promise<void>;
            routed[key] = ((...args: unknown[]) => controller.run(() => invoke(...args))) as P[typeof key];
        }
        return <PetSceneRecall controller={controller}>{createElement(Scene, routed)}</PetSceneRecall>;
    }
    return RecallScene;
}
