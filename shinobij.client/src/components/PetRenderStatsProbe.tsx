import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PetVisualQuality } from "../lib/pet-visual-quality";

export type PetRenderStats = {
    quality: PetVisualQuality;
    samples: number;
    averageFrameMs: number;
    slowestFrameMs: number;
    drawCalls: number;
    triangles: number;
    points: number;
    geometries: number;
    textures: number;
    shaderPrograms: number;
};

declare global {
    interface Window {
        __petRenderStats?: PetRenderStats;
    }
}

/** Tiny opt-in QA probe. It reads renderer counters without forcing extra renders
 * and publishes one compact snapshot every 30 frames for the browser harness. */
export function PetRenderStatsProbe({ quality }: { quality: PetVisualQuality }) {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);
    const samples = useRef(0);
    const averageMs = useRef(0);
    const slowestMs = useRef(0);
    const measuredSamples = useRef(0);

    const publish = () => {
        const info = gl.info;
        let sceneCalls = 0;
        let sceneTriangles = 0;
        let scenePoints = 0;
        scene.traverse((object) => {
            if (!object.visible) return;
            if (object instanceof THREE.Mesh) {
                sceneCalls += Array.isArray(object.material) ? object.material.length : 1;
                const geometry = object.geometry;
                sceneTriangles += Math.floor((geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3);
            } else if (object instanceof THREE.Points) {
                sceneCalls += 1;
                scenePoints += object.geometry.getAttribute("position")?.count ?? 0;
            } else if (object instanceof THREE.Line) sceneCalls += 1;
        });
        const snapshot: PetRenderStats = {
            quality,
            samples: samples.current,
            averageFrameMs: Number(averageMs.current.toFixed(2)),
            slowestFrameMs: Number(slowestMs.current.toFixed(2)),
            drawCalls: sceneCalls,
            triangles: sceneTriangles,
            points: scenePoints,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            shaderPrograms: info.programs?.length ?? 0,
        };
        window.__petRenderStats = snapshot;
        document.documentElement.dataset.petRenderStats = JSON.stringify(snapshot);
    };

    useEffect(() => {
        publish();
        const timer = window.setInterval(publish, 500);
        return () => {
            window.clearInterval(timer);
            delete window.__petRenderStats;
            delete document.documentElement.dataset.petRenderStats;
        };
    // Renderer identity and the selected preset are stable for one Canvas mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gl, quality, scene]);

    useFrame((_state, delta) => {
        const frameMs = Math.min(250, delta * 1000);
        samples.current += 1;
        // Background tabs are intentionally throttled by the browser. Keep those
        // long idle gaps out of the active-render average while still recording
        // the slowest observed frame for diagnostic context.
        if (frameMs <= 50) {
            measuredSamples.current += 1;
            averageMs.current += (frameMs - averageMs.current) / Math.min(measuredSamples.current, 240);
        }
        slowestMs.current = Math.max(frameMs, slowestMs.current * 0.997);
        if (samples.current <= 5 || samples.current % 30 === 0) publish();
    });
    return null;
}
