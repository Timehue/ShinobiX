import type { EventManager } from "@react-three/fiber";

// Decorative canvases animate from time and player position, never pointer input.
// Omitting connect also avoids a late R3F mount binding a detached DOM container.
export function decorativeCanvasEvents(): EventManager<HTMLElement> {
    return { enabled: false, priority: 0 };
}
