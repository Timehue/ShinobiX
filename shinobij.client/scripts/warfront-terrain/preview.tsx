import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import { WarfrontTerrainProp } from '../../src/components/WarfrontGardenAuthoring';
const kind = new URLSearchParams(location.search).get('kind') === 'cover' ? 'cover' : 'pillar';
function Ready() {
    useFrame(({ camera, gl }) => {
        const foot = new Vector3(0, 0, 0).project(camera);
        gl.domElement.dataset.anchorY = String((1 - foot.y) / 2);
        gl.domElement.dataset.ready = 'true';
    });
    return null;
}
createRoot(document.getElementById('root')!).render(<Canvas orthographic camera={{ position: [0, 6, 7.14], zoom: 150, near: .1, far: 50 }}
    gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} dpr={1}
    onCreated={({ camera, gl }) => { camera.lookAt(0, 1, 0); gl.setClearColor(0, 0); }}>
    <ambientLight intensity={1.4} /><directionalLight position={[-4, 8, 5]} intensity={3.2} color="#c4e7ef" />
    <directionalLight position={[4, 3, -2]} intensity={1.6} color="#d7b786" />
    <Suspense fallback={null}><WarfrontTerrainProp kind={kind} /><Ready /></Suspense>
</Canvas>);
