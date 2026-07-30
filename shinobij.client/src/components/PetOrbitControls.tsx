import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

interface PetOrbitControlsProps {
    target?: readonly [number, number, number];
    minDistance?: number;
    maxDistance?: number;
}

/**
 * Small pointer-orbit controller for pet preview cameras. The full examples
 * OrbitControls implementation carries touch/pan/key machinery these fixed
 * game cameras never enable.
 */
export function PetOrbitControls({
    target = [0, 0, 0],
    minDistance = 0.5,
    maxDistance = 100,
}: PetOrbitControlsProps) {
    const { camera, gl } = useThree();
    const [targetX, targetY, targetZ] = target;

    useEffect(() => {
        const element = gl.domElement;
        const pivot = new THREE.Vector3(targetX, targetY, targetZ);
        const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(pivot));
        spherical.radius = THREE.MathUtils.clamp(spherical.radius, minDistance, maxDistance);
        let pointerId = -1;
        let lastX = 0;
        let lastY = 0;

        const apply = () => {
            spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.08, Math.PI - 0.08);
            spherical.radius = THREE.MathUtils.clamp(spherical.radius, minDistance, maxDistance);
            camera.position.setFromSpherical(spherical).add(pivot);
            camera.lookAt(pivot);
            camera.updateMatrixWorld();
        };
        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            pointerId = event.pointerId;
            lastX = event.clientX;
            lastY = event.clientY;
            element.setPointerCapture?.(pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            spherical.theta -= (event.clientX - lastX) * 0.006;
            spherical.phi -= (event.clientY - lastY) * 0.006;
            lastX = event.clientX;
            lastY = event.clientY;
            apply();
        };
        const onPointerUp = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;
            element.releasePointerCapture?.(pointerId);
            pointerId = -1;
        };
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            spherical.radius *= Math.exp(event.deltaY * 0.001);
            apply();
        };

        apply();
        element.addEventListener("pointerdown", onPointerDown);
        element.addEventListener("pointermove", onPointerMove);
        element.addEventListener("pointerup", onPointerUp);
        element.addEventListener("pointercancel", onPointerUp);
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            element.removeEventListener("pointerdown", onPointerDown);
            element.removeEventListener("pointermove", onPointerMove);
            element.removeEventListener("pointerup", onPointerUp);
            element.removeEventListener("pointercancel", onPointerUp);
            element.removeEventListener("wheel", onWheel);
        };
    }, [camera, gl, maxDistance, minDistance, targetX, targetY, targetZ]);

    return null;
}
