// Local QA entry. Raw clips, exact terminal poses, and fixed camera views.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(320, 320); renderer.setPixelRatio(1); renderer.setClearColor('#101726');
document.getElementById('root')!.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight('white', 1.4));
const key = new THREE.DirectionalLight('white', 2.2); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight('#8bc5ff', 1.2); rim.position.set(-3, 2, -3); scene.add(rim);
const camera = new THREE.PerspectiveCamera(35, 1, .001, 1000);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let root: THREE.Group | null = null, mixer: THREE.AnimationMixer | null = null, clips: THREE.AnimationClip[] = [];
let restore = () => {}, focus = new THREE.Vector3(), radius = 1;
let envelopeMatrix = new THREE.Matrix4(), regionVertices: { mesh: THREE.SkinnedMesh; vertices: number[] }[] = [], headRadius = 1;
let bindPoints = new WeakMap<THREE.Mesh, THREE.Vector3[]>();
const update = () => {
    scene.updateMatrixWorld(true);
    root?.traverse(node => { if (node instanceof THREE.SkinnedMesh) node.skeleton.update(); });
};
const api = {
    async load(url: string, yaw = 0) {
        if (root) {
            mixer?.stopAllAction(); mixer?.uncacheRoot(root); scene.remove(root);
            const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
            root.traverse(node => { if (node instanceof THREE.Mesh) {
                node.geometry.dispose(); for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
                    for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
                    m.dispose();
                }
                if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
            } });
            textures.forEach(texture => texture.dispose()); skeletons.forEach(skeleton => skeleton.dispose()); renderer.renderLists.dispose();
        }
        const response=await fetch(url);if(!response.ok)throw Error(`Model fetch failed: ${response.status}`);
        const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
        const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
        const gltf = await loader.parseAsync(bytes,new URL('.',new URL(url,location.href)).href); root = gltf.scene; scene.add(root); root.rotation.y += yaw; update();
        const poses: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
        root.traverse(node => poses.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
        restore = () => poses.forEach(([node, p, q, s]) => { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); });
        const points: THREE.Vector3[] = [];
        root.traverse(node => { if (node instanceof THREE.Mesh) {
            for (let i = 0; i < node.geometry.attributes.position.count; i++) points.push(node.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(node.matrixWorld));
        } });
        const bounds = new THREE.Box3().setFromPoints(points), size = bounds.getSize(new THREE.Vector3());
        focus = bounds.getCenter(new THREE.Vector3()); radius = Math.max(size.x, size.y, size.z) * .6;
        envelopeMatrix = new THREE.Matrix4().makeScale(2 / Math.max(size.x,size.y,size.z),2 / Math.max(size.x,size.y,size.z),2 / Math.max(size.x,size.y,size.z))
            .multiply(new THREE.Matrix4().makeTranslation(-focus.x,-focus.y,-focus.z));
        bindPoints = new WeakMap();
        root.traverse(node => { if (node instanceof THREE.Mesh) {
            const vertices: THREE.Vector3[] = [];
            for (let v = 0; v < node.geometry.attributes.position.count; v++) vertices.push(node.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(node.matrixWorld).applyMatrix4(envelopeMatrix));
            bindPoints.set(node, vertices);
        } });
        regionVertices = [];
        mixer = new THREE.AnimationMixer(root); clips = gltf.animations;
        // Fit the whole animation bank so upward strikes/jumps are not cropped
        // by a camera measured only from the resting model. The complete bind
        // bounds plus a padded sparse pose sweep retain consistent framing.
        const swept=bounds.clone(),point=new THREE.Vector3();
        for(const clip of clips)for(const progress of [0,.25,.5,.75,1]) {
            mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true;action.play();action.time=clip.duration*progress;mixer.update(0);update();
            root.traverse(node=>{if(node instanceof THREE.Mesh){const stride=Math.max(1,Math.ceil(node.geometry.attributes.position.count/500));
                for(let v=0;v<node.geometry.attributes.position.count;v+=stride)swept.expandByPoint(node.getVertexPosition(v,point).applyMatrix4(node.matrixWorld));
            }});
        }
        mixer.stopAllAction();restore();update();
        focus=swept.getCenter(new THREE.Vector3());radius=Math.max(...swept.getSize(new THREE.Vector3()).toArray())*.66;
        return { clips: clips.map(c => ({ name: c.name, duration: c.duration })), vertices: points.length, sha256,normalizedSize:size.clone().multiplyScalar(2 / Math.max(size.x,size.y,size.z)).toArray() };
    },
    region(config: { y: number[]; z?: number[]; x?: number[]; cameraPadding?: number; union?: {y:number[];z?:number[];x?:number[]}[]; exclude?:number[][] }) {
        mixer?.stopAllAction(); restore(); update();
        const selected: THREE.Vector3[] = [];
        regionVertices = [];
        root?.traverse(node => { if (node instanceof THREE.SkinnedMesh) {
            const vertices: number[] = [], point = new THREE.Vector3();
            for(let v=0;v<node.geometry.attributes.position.count;v++) {
                node.getVertexPosition(v,point).applyMatrix4(node.matrixWorld).applyMatrix4(envelopeMatrix);
                const core=(region:{y:number[];z?:number[];x?:number[]})=>point.y>=region.y[1]&&(!region.z||point.z>=region.z[1])&&(!region.x||Math.abs(point.x)<=region.x[0]);
                if(![config,...(config.union??[])].some(core)||config.exclude?.some(box=>point.x>=box[0]&&point.x<=box[1]&&point.y>=box[2]&&point.y<=box[3]&&point.z>=box[4]&&point.z<=box[5]))continue;
                vertices.push(v); selected.push(point.clone().applyMatrix4(envelopeMatrix.clone().invert()));
            }
            regionVertices.push({mesh:node,vertices});
        } });
        if(selected.length<20)throw Error('Skull region selected too few vertices');
        headRadius=new THREE.Box3().setFromPoints(selected).getSize(new THREE.Vector3()).length()*.52*(config.cameraPadding??1);
        return { vertices:selected.length, normalizedBounds:new THREE.Box3().setFromPoints(selected.map(p=>p.applyMatrix4(envelopeMatrix))).getSize(new THREE.Vector3()).toArray() };
    },
    pick(x:number,y:number) {
        const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/320*2-1,1-y/320*2),camera);
        const hits=ray.intersectObject(root!,true);if(!hits.length)return null;
        return hits[0].point.applyMatrix4(envelopeMatrix).toArray();
    },
    // A point clicked in an animated pose must be mapped back to its original
    // anatomical position before it can define a fixed repair region.
    pickBind(x:number,y:number) {
        const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(x/320*2-1,1-y/320*2),camera);
        const hit=ray.intersectObject(root!,true)[0];if(!hit?.face||!(hit.object instanceof THREE.Mesh))return null;
        const mesh=hit.object,face=hit.face,vertices=bindPoints.get(mesh);if(!vertices)return null;
        const a=mesh.getVertexPosition(face.a,new THREE.Vector3()),b=mesh.getVertexPosition(face.b,new THREE.Vector3()),c=mesh.getVertexPosition(face.c,new THREE.Vector3());
        const local=mesh.worldToLocal(hit.point.clone()),weights=THREE.Triangle.getBarycoord(local,a,b,c,new THREE.Vector3());if(!weights)return null;
        return vertices[face.a].clone().multiplyScalar(weights.x).addScaledVector(vertices[face.b],weights.y).addScaledVector(vertices[face.c],weights.z).toArray();
    },
    render(clipName: string, progress: number, view = 'front') {
        const clip = clips.find(c => c.name === clipName); if (!clip || !mixer) throw Error(`Missing clip ${clipName}`);
        mixer.stopAllAction(); restore();
        const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true; action.play(); action.time = clip.duration * progress; mixer.update(0); update();
        let target=focus, extent=radius;
        if(view.startsWith('head-')) {
            const points:THREE.Vector3[]=[];
            for(const {mesh,vertices} of regionVertices)for(const v of vertices)points.push(mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
            if(!points.length)throw Error('Configure a skull region before requesting a close-up');
            target=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());extent=headRadius;
        }
        const distance = extent / Math.tan(THREE.MathUtils.degToRad(17.5)) * 1.15;
        const direction = view === 'back' ? new THREE.Vector3(0, extent * .2, -distance)
            : view === 'other-side' ? new THREE.Vector3(-distance, extent * .2, 0)
                : view === 'three-quarter' ? new THREE.Vector3(distance * .707, extent * .2, distance * .707)
                    : view.endsWith('side') ? new THREE.Vector3(distance, extent * .2, 0) : new THREE.Vector3(0, extent * .2, distance);
        camera.position.copy(target).add(direction);
        camera.near = Math.max(.001, distance / 1000); camera.far = distance * 20; camera.updateProjectionMatrix(); camera.lookAt(target);
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
    },
};
(window as unknown as { petShapeAudit: typeof api }).petShapeAudit = api;
