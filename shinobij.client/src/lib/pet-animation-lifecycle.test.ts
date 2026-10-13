import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { attackClipWindow } from "./pet-combat-performance";
import {
    createPetAnimationEpoch,
    retirePetAnimationMixer,
    samplePetAnimationPhase,
    synchronizePetAnimationEpoch,
    transitionPetAnimation,
    advancePetAnimationMixer,
    preparePetAnimationPhase,
    synchronizePetLocomotionPhase,
    petAnimationBlend,
} from "./pet-animation-lifecycle";

type Family = "idle" | "attack" | "hit";

test('secondary pose settling has the same response at 10 through 144 Hz and holds during hit-stop', () => {
    const endpoints = [10, 30, 60, 144].map(fps => {
        let value = 0;
        for (let frame = 0; frame < fps; frame++) value = THREE.MathUtils.lerp(value, 1, petAnimationBlend(1 / fps, 15));
        return value;
    });
    assert.ok(Math.max(...endpoints) - Math.min(...endpoints) < 1e-10);
    assert.equal(petAnimationBlend(0, 15), 0);
});

test("host-sampled takes preserve full poses at normal/fast speed and keep crossfades advancing", () => {
    for (const fps of [30, 60, 144]) for (const speed of [1, 1.7]) {
        const root = new THREE.Object3D();
        const mixer = new THREE.AnimationMixer(root);
        const clip = new THREE.AnimationClip('attack', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
        const action = mixer.clipAction(clip).fadeIn(0.08).play();
        for (let frame = 0; frame <= fps; frame++) {
            mixer.update(1 / fps / speed);
            samplePetAnimationPhase(action, 0.74, 0.995, frame / fps);
        }
        assert.ok(Math.abs(root.position.x - 0.995) < 1e-6, `${fps} Hz at ${speed}x must complete recovery`);
        assert.equal(action.getEffectiveWeight(), 1, 'seeking a phase must not freeze its fade-in');
        mixer.update(0.5);
        samplePetAnimationPhase(action, 0.54, 0.74, 0);
        assert.ok(Math.abs(root.position.x - 0.54) < 1e-6, 'contact can be held independently of wall time');
    }
});

test("dash-to-contact renders the strike pose even when hit-stop advances no mixer time", () => {
    for (const pass of ['surface', 'outline']) {
        const root = new THREE.Object3D();
        const mixer = new THREE.AnimationMixer(root);
        const runClip = new THREE.AnimationClip('run', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
        const strikeClip = new THREE.AnimationClip('strike', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 0.34, 0.54, 1], [0, 0, 1, 1])]);
        const run = mixer.clipAction(runClip).play();
        mixer.update(0.5);
        const strike = mixer.clipAction(strikeClip).reset();
        strike.time = attackClipWindow('strike', true)!.start;
        transitionPetAnimation(strike, run, 0.1, true);
        mixer.update(0);
        assert.ok(Math.abs(root.position.x - 1) < 1e-6, `${pass}: contact must not freeze the outgoing locomotion pose`);
        assert.equal(strike.getEffectiveWeight(), 1);
        assert.equal(run.isRunning(), false);
        // Re-cueing a shared take must also keep full weight and stay active.
        strike.reset();
        strike.time = attackClipWindow('strike', true)!.start;
        transitionPetAnimation(strike, strike, 0.1, true);
        mixer.update(0);
        assert.ok(Math.abs(root.position.x - 1) < 1e-6);
        assert.equal(strike.isRunning(), true);
    }
});

test("ordinary animation changes retain a smooth crossfade", () => {
    const root = new THREE.Object3D();
    const mixer = new THREE.AnimationMixer(root);
    const clip = (name: string, x: number) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [x, x])]);
    const previous = mixer.clipAction(clip('idle', 0)).play();
    const next = mixer.clipAction(clip('run', 1));
    transitionPetAnimation(next, previous, 0.2, false);
    advancePetAnimationMixer(mixer, 0.05);
    assert.ok(root.position.x > 0 && root.position.x < 1);
});

test('completed fades retire mixer actions across repeated 13-take combat cycles', () => {
    const mixer = new THREE.AnimationMixer(new THREE.Object3D());
    const actions = Array.from({length:13}, (_,i) => mixer.clipAction(new THREE.AnimationClip(`take-${i}`,1,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[i,i])])));
    let previous: THREE.AnimationAction | null = null;
    for (let cycle=0;cycle<10;cycle++) for (const next of actions) {
        next.reset(); transitionPetAnimation(next, previous, .1, false);
        advancePetAnimationMixer(mixer,.05);
        assert.ok(mixer.stats.actions.inUse <= 2, 'only the current and outgoing action should be active');
        advancePetAnimationMixer(mixer,.06);
        assert.equal(mixer.stats.actions.inUse,1);
        previous=next;
    }
});

test('fade retirement respects paused and scaled mixer clocks', () => {
    for (const rate of [0, .5, 2]) {
        const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
        const take = (name: string, x: number) => mixer.clipAction(new THREE.AnimationClip(name, 1,
            [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [x, x])]));
        const idle = take('idle', -2).play(), run = take('run', 2);
        mixer.update(0); mixer.timeScale = rate;
        transitionPetAnimation(run, idle, .2, false);
        advancePetAnimationMixer(mixer, rate === 2 ? .11 : .2);
        assert.equal(mixer.stats.actions.inUse, rate === 2 ? 1 : 2,
            'retirement must use the same clock as Three fade interpolation');
        if (rate === 0) assert.equal(root.position.x, -2, 'a paused fade retains its existing pose');
    }
});

test('a third rapid contact stops every outgoing fade before the host clock freezes', () => {
    const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
    const take = (name:string,x:number) => mixer.clipAction(new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[x,x])]));
    const idle=take('idle',-1), dash=take('dash',0), hit=take('hit',1);
    idle.play(); transitionPetAnimation(dash,idle,.22,false); advancePetAnimationMixer(mixer,.02);
    transitionPetAnimation(hit,dash,.1,true); advancePetAnimationMixer(mixer,0);
    assert.equal(root.position.x,1);
    assert.equal(mixer.stats.actions.inUse,1);
});

test('walk/gallop switches retain normalized stride and phase preparation evaluates once', () => {
    const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
    const walk=mixer.clipAction(new THREE.AnimationClip('walk',1,[])); walk.time=.6;
    const gallop=mixer.clipAction(new THREE.AnimationClip('gallop',.5,[])); synchronizePetLocomotionPhase(gallop,walk);
    assert.equal(gallop.time,.3);
    const attack=mixer.clipAction(new THREE.AnimationClip('attack',1,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[0,1])]));
    attack.play(); preparePetAnimationPhase(attack,.54,.74,0); advancePetAnimationMixer(mixer,0);
    assert.equal(root.position.x,.54);
    assert.equal(mixer.time,0);
});

test('a crossfade never pulls two offset poses toward the bind position', () => {
    const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
    const take = (name: string, x: number) => mixer.clipAction(new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [x, x])]));
    const a = take('a', 10).play(), b = take('b', 12);
    mixer.update(0);
    transitionPetAnimation(b, a, .2, false);
    for (let i = 0; i < 20; i++) {
        advancePetAnimationMixer(mixer, .01);
        assert.ok(root.position.x >= 10 && root.position.x <= 12, 'the blended surface must stay between the authored poses');
    }
});

test('rapid three-way fades and reversal preserve the displayed pose and unit total weight', () => {
    const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root);
    const actions = [10, 12, 14].map((x, i) => mixer.clipAction(new THREE.AnimationClip(`take-${i}`, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [x, x])])));
    let previous = actions[0].play(); mixer.update(0);
    for (const next of [actions[1], actions[2], actions[0], actions[2], actions[1]]) {
        const before = root.position.x;
        next.reset(); transitionPetAnimation(next, previous, .2, false); advancePetAnimationMixer(mixer, 0);
        assert.ok(Math.abs(root.position.x - before) < 1e-6, 'interrupting a transition cannot jump on the same presentation tick');
        advancePetAnimationMixer(mixer, .04);
        assert.ok(Math.abs(actions.reduce((sum, action) => sum + (action.isScheduled() ? action.getEffectiveWeight() : 0), 0) - 1) < 1e-6);
        previous = next;
    }
    advancePetAnimationMixer(mixer, .21); assert.equal(mixer.stats.actions.inUse, 1);
});

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
