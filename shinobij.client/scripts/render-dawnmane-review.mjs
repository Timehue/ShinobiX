// Four-angle visual review for the original fal GLB and its production rig.
// Usage: node scripts/render-dawnmane-review.mjs <input.glb> <output.png> [clip] [progress]
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, process.argv[2] ?? "art-source/dawnmane-seraph/fal-source.glb");
const output = resolve(root, process.argv[3] ?? "art-source/dawnmane-seraph/candidate-review.png");
const clipName = process.argv[4] ?? "";
const clipProgress = Number(process.argv[5] ?? 0.5);
if (![source, output].every((path) => path.startsWith(root + sep))) throw new Error("Review paths must stay in the client workspace");
if (!source.endsWith(".glb") || !output.endsWith(".png")) throw new Error("Expected GLB input and PNG output");
if (!Number.isFinite(clipProgress) || clipProgress < 0 || clipProgress > 1) throw new Error("Clip progress must be 0–1");
const modelBytes = await readFile(source);
if (modelBytes.toString("ascii", 0, 4) !== "glTF") throw new Error("Review input is not a GLB");

const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body style="margin:0;background:#141b23"><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
try {
  const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(720,720);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#202934");
  scene.add(new THREE.HemisphereLight("#f7f6ed","#798796",2.8));
  const key = new THREE.DirectionalLight("#fff3dc",3.1); key.position.set(3,5,4); scene.add(key);
  const fill = new THREE.DirectionalLight("#b9d2f5",1.4); fill.position.set(-4,2,-3); scene.add(fill);
  const glb = await (await fetch("/model.glb")).arrayBuffer();
  await MeshoptDecoder.ready;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb,"");
  scene.add(gltf.scene);
  const clipName = ${JSON.stringify(clipName)}, clipProgress = ${JSON.stringify(clipProgress)};
  if (clipName) {
    const take = THREE.AnimationClip.findByName(gltf.animations, clipName);
    if (!take) throw new Error("Missing animation clip " + clipName);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(take);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.time = take.duration * clipProgress;
    mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
  }
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x,size.y,size.z) * 0.74;
  const camera = new THREE.OrthographicCamera(-extent,extent,extent,-extent,0.01,100);
  window.renderReviewAngle = (angle) => {
    const radius = Math.max(size.x,size.y,size.z) * 3;
    camera.position.set(center.x + Math.sin(angle)*radius,center.y + size.y*.08,center.z + Math.cos(angle)*radius);
    camera.lookAt(center); camera.updateProjectionMatrix();
    renderer.render(scene,camera);
  };
  window.renderReviewAngle(0);
  window.reviewReady = true;
} catch (error) { window.reviewError = String(error?.stack ?? error); }
</script></body></html>`;

const server = createServer(async (req, res) => {
    try {
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        if (pathname === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); return; }
        if (pathname === "/model.glb") { res.writeHead(200, { "Content-Type": "model/gltf-binary" }); res.end(modelBytes); return; }
        if (pathname.startsWith("/node_modules/three/")) {
            const file = resolve(root, pathname.slice(1));
            if (!file.startsWith(resolve(root, "node_modules", "three") + sep)) throw new Error("Invalid module path");
            res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(await readFile(file)); return;
        }
        res.writeHead(404); res.end();
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
    browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-webgl"] });
    const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    await page.waitForFunction(() => window.reviewReady || window.reviewError, null, { timeout: 90000 });
    const reviewError = await page.evaluate(() => window.reviewError);
    if (reviewError || errors.length) throw new Error([reviewError, ...errors].filter(Boolean).join("\n"));
    const shots = [];
    for (const [label, angle] of [["front", 0], ["left", -Math.PI / 2], ["back", Math.PI], ["right", Math.PI / 2]]) {
        await page.evaluate((value) => window.renderReviewAngle(value), angle);
        shots.push({ label, png: await page.locator("canvas").screenshot() });
    }
    const title = Buffer.from(`<svg width="1440" height="1512"><rect width="1440" height="36" fill="#101820"/><rect y="756" width="1440" height="36" fill="#101820"/>${shots.map((item, index) => `<text x="${index % 2 * 720 + 18}" y="${Math.floor(index / 2) * 756 + 26}" fill="#fff2d0" font-family="Arial" font-size="20">${item.label}</text>`).join("")}</svg>`);
    const composites = shots.map((item, index) => ({ input: item.png, left: index % 2 * 720, top: Math.floor(index / 2) * 756 + 36 }));
    await mkdir(dirname(output), { recursive: true });
    await sharp({ create: { width: 1440, height: 1512, channels: 3, background: "#101820" } })
        .composite([...composites, { input: title, left: 0, top: 0 }]).png().toFile(output);
    console.log(JSON.stringify({ source, output, bytes: modelBytes.length, clip: clipName || null, progress: clipName ? clipProgress : null, angles: shots.map((item) => item.label) }));
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
