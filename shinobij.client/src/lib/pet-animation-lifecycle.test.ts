import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
    createPetAnimationEpoch,
    retirePetAnimationMixer,
    synchronizePetAnimationEpoch,
} from "./pet-animation-lifecycle";

type Family = "idle" | "attack" | "hit";

const clips = (["idle", "attack", "hit"] as const).map((family, index) => new THREE.AnimationClip(
    family,
    0.24,
    [new THREE.NumberKeyframeTrack(".position[x]", [0, 0.24], [0, (index + 1) * 0.1])],
));

test("eight mixer clones survive StrictMode reactivation and ten reload/action-family cycles", () => {
    for (let reload = 0; reload < 10; reload += 1) {
        for (let actor = 0; actor < 8; actor += 1) {
            const firstRoot = new THREE.Object3D();
            const firstMixer = new THREE.AnimationMixer(firstRoot);
            const firstOutlineMixer = new THREE.AnimationMixer(new THREE.Object3D());
            const epoch = createPetAnimationEpoch<Family>("idle");
            assert.equal(synchronizePetAnimationEpoch(epoch, firstMixer, firstOutlineMixer, "idle"), true);

            for (let familyIndex = 0; familyIndex < clips.length; familyIndex += 1) {
                const action = firstMixer.clipAction(clips[familyIndex]);
                action.reset().play();
                epoch.activeClip = clips[familyIndex];
                epoch.activeFamily = (["idle", "attack", "hit"] as const)[familyIndex];
                epoch.activeAction = action;
                epoch.activeOutlineAction = firstOutlineMixer.clipAction(clips[familyIndex]).reset().play();
                firstMixer.update(0.04);
                firstOutlineMixer.update(0.04);
            }

            // StrictMode setup -> cleanup -> setup retains memoized values and
            // refs. The old uncacheRoot cleanup made this exact replay throw in
            // AnimationMixer._lendBinding because its binding pool was empty.
            retirePetAnimationMixer(firstMixer);
            retirePetAnimationMixer(firstOutlineMixer);
            assert.equal(synchronizePetAnimationEpoch(epoch, firstMixer, firstOutlineMixer, "idle"), false);
            assert.doesNotThrow(() => {
                epoch.activeAction?.reset().play();
                epoch.activeOutlineAction?.reset().play();
                firstMixer.update(0.04);
                firstOutlineMixer.update(0.04);
            });

            // A prop/reload replacement gets a new clone and mixer while React
            // retains the component refs. Synchronization must discard every
            // action owned by the retired mixer before the next rendered frame.
            const replacementMixer = new THREE.AnimationMixer(new THREE.Object3D());
            const replacementOutlineMixer = new THREE.AnimationMixer(new THREE.Object3D());
            retirePetAnimationMixer(firstMixer);
            retirePetAnimationMixer(firstOutlineMixer);
            assert.equal(synchronizePetAnimationEpoch(epoch, replacementMixer, replacementOutlineMixer, "idle"), true);
            assert.equal(epoch.activeClip, null);
            assert.equal(epoch.activeAction, null);
            assert.equal(epoch.activeOutlineAction, null);
            for (const clip of clips) {
                const action = replacementMixer.clipAction(clip);
                action.reset().play();
                epoch.activeClip = clip;
                epoch.activeAction = action;
                epoch.activeOutlineAction = replacementOutlineMixer.clipAction(clip).reset().play();
                replacementMixer.update(0.04);
                replacementOutlineMixer.update(0.04);
            }
            retirePetAnimationMixer(replacementMixer);
            retirePetAnimationMixer(replacementOutlineMixer);
        }
    }
});
