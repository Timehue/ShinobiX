import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { disposePetModelResources } from "./pet-model-resources";

test("retiring cloned fighters releases bone textures without disposing shared geometry or atlas maps", () => {
    const source = new THREE.Group();
    const bone = new THREE.Bone();
    const geometry = new THREE.BoxGeometry();
    const atlas = new THREE.Texture();
    const sourceMaterial = new THREE.MeshBasicMaterial({ map: atlas });
    const mesh = new THREE.SkinnedMesh(geometry, sourceMaterial);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    source.add(mesh);
    const sourceSkeleton = mesh.skeleton.computeBoneTexture();
    const sourceTexture = sourceSkeleton.boneTexture;
    let sharedDisposals = 0;
    for (const resource of [geometry, atlas, sourceMaterial, sourceTexture!]) resource.addEventListener("dispose", () => sharedDisposals++);

    for (let cycle = 0; cycle < 20; cycle++) {
        const surface = clone(source) as THREE.Group;
        const outline = clone(source) as THREE.Group;
        const materials: THREE.Material[] = [];
        const skeletons: THREE.Skeleton[] = [];
        let disposedTextures = 0, disposedMaterials = 0;
        for (const root of [surface, outline]) {
            root.traverse(object => {
                if (!(object instanceof THREE.SkinnedMesh)) return;
                assert.equal(object.geometry, geometry);
                assert.notEqual(object.skeleton, sourceSkeleton);
                const material = sourceMaterial.clone();
                object.material = material;
                materials.push(material);
                material.addEventListener("dispose", () => disposedMaterials++);
                object.skeleton.computeBoneTexture();
                object.skeleton.boneTexture!.addEventListener("dispose", () => disposedTextures++);
                skeletons.push(object.skeleton);
            });
        }
        disposePetModelResources({ surface, outline, materials });
        assert.equal(disposedTextures, 2, "both surface and outline must release their GPU bone texture");
        assert.equal(disposedMaterials, 2);
        assert.ok(skeletons.every(skeleton => skeleton.boneTexture === null));
        assert.equal(sourceSkeleton.boneTexture, sourceTexture);
        assert.equal(sharedDisposals, 0, "cached resources must remain valid for the next battle");
    }
});
