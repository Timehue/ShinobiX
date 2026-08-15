import { Suspense } from "react";
import type { Achievement } from "../constants/achievements";
import { lazyWithRetry } from "../lib/lazyWithRetry";

export type MissionToast = { id: string; name: string; xp: number; profession?: string; label?: string; summary?: string };

export type ToastStacksProps = {
    achievementToasts: Achievement[];
    missionToasts: MissionToast[];
    onDismissAchievement: (achievement: Achievement) => void;
    onDismissMission: (id: string) => void;
};

const ToastStacksContent = lazyWithRetry(() =>
    import("./ToastStacksContent").then((module) => ({ default: module.ToastStacksContent })),
);

/**
 * Toast markup is informational and normally absent. Keep it off the startup
 * graph, but load it reliably as soon as the first toast actually exists.
 */
export function ToastStacks(props: ToastStacksProps) {
    if (props.achievementToasts.length === 0 && props.missionToasts.length === 0) return null;
    return (
        <Suspense fallback={null}>
            <ToastStacksContent {...props} />
        </Suspense>
    );
}
