/* eslint-disable react-hooks/immutability -- The authoring camera is a mutable Three.js scene object; layout effects configure its projection before the capture. */
import React, { Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import { PetWarfrontTerrain3D } from '../../src/components/WarfrontGardenAuthoring';
import { warfrontCameraFrame, warfrontCanvasFrame } from '../../src/lib/pet-warfront-camera';

function Camera() {
    const {camera,size}=useThree();
    useLayoutEffect(()=>{
        const frame=warfrontCameraFrame(size.width,size.height,11.4*.7,7.2*.7);
        const c=camera as PerspectiveCamera;c.fov=frame.fov;c.position.set(...frame.position);c.lookAt(...frame.target);
        c.updateProjectionMatrix();c.projectionMatrix.elements[9]-=frame.shiftY;c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
        if (size.height > size.width) {
            const board=warfrontCanvasFrame(size.width,size.height,11.4,7.2);
            const sin=2/Math.sqrt(5);
            c.position.set(0,28,14);c.lookAt(0,0,0);
            const halfW=size.width*.7/(2*board.xScale),halfH=size.height*.7*sin/(2*board.zScale);
            c.projectionMatrix.makeOrthographic(-halfW,halfW,halfH,-halfH,.1,100);
            c.projectionMatrix.elements[13]=-.11;c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
        }
    },[camera,size]);
    useFrame(({gl})=>{gl.domElement.dataset.ready='true';});
    return null;
}
createRoot(document.getElementById('root')!).render(<Canvas shadows="percentage" dpr={1} gl={{antialias:true,preserveDrawingBuffer:true}} camera={{near:.1,far:100}}>
    <color attach="background" args={['#101e24']} />
    <ambientLight intensity={.74} color="#bfd0d2" />
    <hemisphereLight intensity={.54} color="#8eb9d0" groundColor="#20150f" />
    <directionalLight position={[3.5,11,5]} intensity={2.35} color="#e7edf0" castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={11} shadow-camera-bottom={-11} shadow-normalBias={.04} />
    <directionalLight position={[0,6,-8]} intensity={1.05} color="#afc5db" />
    <Suspense fallback={null}><PetWarfrontTerrain3D floorOnly={new URLSearchParams(location.search).has('floor')} /><Camera /></Suspense>
</Canvas>);
