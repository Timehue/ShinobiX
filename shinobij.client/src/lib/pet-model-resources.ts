import type { Group, Material, Skeleton, SkinnedMesh } from "three";

/** SkeletonUtils clones own their bone textures, while geometry and atlas maps
 * still belong to the shared GLTF cache. Release only the fighter's resources. */
export function disposePetModelResources(model: {
    surface: Group;
    outline: Group | null;
    materials: readonly Material[];
}): void {
    const skeletons = new Set<Skeleton>();
    for (const root of [model.surface, model.outline]) {
        root?.traverse(object => {
            const mesh = object as SkinnedMesh;
            if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
        });
    }
    for (const skeleton of skeletons) skeleton.dispose();
    for (const material of model.materials) material.dispose();
}
