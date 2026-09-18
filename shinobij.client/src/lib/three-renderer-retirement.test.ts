import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createRendererRetirement } from "./three-renderer-retirement";

type BuiltInUniforms = Record<string, { value: unknown }>;

function fakeRenderer(releases: string[], builtIns = new Map<object, BuiltInUniforms>()) {
    const minted: object[] = [];
    const renderer = {
        properties: {
            has: (object: object) => builtIns.has(object),
            get: (object: object) => {
                if (!builtIns.has(object)) minted.push(object);
                return { uniforms: builtIns.get(object) };
            },
        },
        dispose: () => releases.push("renderer"),
    } as unknown as THREE.WebGLRenderer;
    return { renderer, minted };
}

function watch(releases: string[], label: string, resource: THREE.EventDispatcher<{ dispose: object }>) {
    resource.addEventListener("dispose", () => releases.push(label));
}

test("retirement releases every shared binding, including the built-in DFG lookup, exactly once", () => {
    const sourceImage = { width: 512, height: 512 };
    const atlas = new THREE.Texture(sourceImage);
    const dfgLut = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas });
    const geometry = new THREE.PlaneGeometry();
    const sourcePositions = geometry.attributes.position.array;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    const releases: string[] = [];
    watch(releases, "atlas", atlas);
    watch(releases, "dfg-lut", dfgLut);
    watch(releases, "geometry", geometry);
    watch(releases, "material", material);
    const { renderer } = fakeRenderer(releases, new Map([[material, { dfgLUT: { value: dfgLut }, map: { value: atlas } }]]));

    const retirement = createRendererRetirement(renderer);
    retirement.capture(scene);
    retirement.capture(scene);
    scene.clear(); // R3F empties the scene before the passive unmount cleanup runs.
    retirement.dispose();
    retirement.dispose();

    assert.deepEqual([...releases].sort(), ["atlas", "dfg-lut", "geometry", "material", "renderer"]);
    assert.equal(releases.at(-1), "renderer", "bindings are released while the renderer can still service them");
    assert.equal(atlas.image, sourceImage, "the decoded image stays cached for the next canvas");
    assert.equal(geometry.attributes.position.array, sourcePositions, "CPU vertex data stays cached for the next canvas");
});

test("a material this renderer never drew gets no renderer property entry minted for it", () => {
    const releases: string[] = [];
    const { renderer, minted } = fakeRenderer(releases);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()));
    createRendererRetirement(renderer).capture(scene);
    assert.deepEqual(minted, []);
});

test("a resource its owner already disposed is forgotten and flags a fresh look", () => {
    const releases: string[] = [];
    const { renderer } = fakeRenderer(releases);
    const geometry = new THREE.PlaneGeometry();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
    const retirement = createRendererRetirement(renderer);
    retirement.capture(scene);
    assert.equal(retirement.consumeStale(), false);

    geometry.dispose(); // a per-action effect cleaning up after itself mid-battle
    assert.equal(retirement.tracks(geometry), false, "no strong reference outlives the owner's dispose");
    assert.equal(retirement.consumeStale(), true);
    assert.equal(retirement.consumeStale(), false, "the flag is consumed once");

    watch(releases, "geometry", geometry);
    retirement.dispose();
    assert.equal(releases.includes("geometry"), false, "retirement does not dispose what it no longer tracks");
});

test("a cached rig drawn without cloning has its bone texture released", () => {
    const releases: string[] = [];
    const { renderer } = fakeRenderer(releases);
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    skeleton.boneTexture = new THREE.DataTexture(new Float32Array(16), 4, 1);
    const mesh = new THREE.SkinnedMesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(skeleton);
    watch(releases, "bone-texture", skeleton.boneTexture);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const retirement = createRendererRetirement(renderer);
    retirement.capture(scene);
    retirement.dispose();
    assert.equal(releases.includes("bone-texture"), true);
});

test("a resource a live sibling canvas is drawing is left for that sibling's retirement", () => {
    const releases: string[] = [];
    const shared = new THREE.Texture({ width: 8, height: 8 });
    watch(releases, "shared", shared);
    const sceneFor = () => {
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: shared })));
        return scene;
    };
    const first = createRendererRetirement(fakeRenderer(releases).renderer);
    const second = createRendererRetirement(fakeRenderer(releases).renderer);
    first.capture(sceneFor());
    second.capture(sceneFor());

    first.dispose();
    assert.equal(releases.includes("shared"), false, "the survivor must not re-upload mid-scene");
    assert.equal(second.tracks(shared), true);

    second.dispose();
    assert.equal(releases.filter(entry => entry === "shared").length, 1, "the last canvas clears every renderer's listener in one dispose");
});

test("an instance that never captured cannot hold a sibling's resources hostage", () => {
    const releases: string[] = [];
    const shared = new THREE.Texture({ width: 8, height: 8 });
    watch(releases, "shared", shared);
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: shared })));
    createRendererRetirement(fakeRenderer(releases).renderer); // StrictMode's discarded render
    const real = createRendererRetirement(fakeRenderer(releases).renderer);
    real.capture(scene);
    real.dispose();
    assert.equal(releases.includes("shared"), true);
});
