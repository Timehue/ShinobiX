// Reproducible authored shrine props. Geometry is baked once; the game loads a
// small GLB rather than rebuilding bevels or merging meshes during a battle.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader ??= class {
    async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
};
const stone = '#e2e8e7', edge = '#bdcaca', bronze = '#edcc88', cut = '#849b9e';
function build(kind) {
    const pieces = [];
    function add(geometry, x, y, z, color, yaw = 0) {
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        g.rotateY(yaw); g.translate(x, y, z);
        const c = new T.Color(color), count = g.attributes.position.count;
        g.setAttribute('color', new T.Float32BufferAttribute(Array.from({ length: count }, () => [c.r, c.g, c.b]).flat(), 3));
        pieces.push(g);
    }
    function block(w, h, d, x, y, z, color, yaw = 0) {
        const shape = new T.Shape();
        shape.moveTo(-w / 2, -d / 2); shape.lineTo(w / 2, -d / 2);
        shape.lineTo(w / 2, d / 2); shape.lineTo(-w / 2, d / 2); shape.closePath();
        const g = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 1, steps: 1 });
        g.rotateX(-Math.PI / 2);
        add(g, x, y, z, color, yaw);
    }
    if (kind === 'pillar') {
        block(2.1, .14, 1.85, 0, .05, 0, cut);
        block(1.8, .16, 1.55, 0, .2, 0, stone);
        block(1.48, .12, 1.28, 0, .4, 0, edge);
        const shaft = new T.CylinderGeometry(.66, .72, 1.75, 8, 2);
        const p = shaft.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > .8) {
            p.setY(i, .77 + Math.sin(p.getX(i) * 7 + p.getZ(i) * 4) * .22 + p.getX(i) * .17);
        }
        shaft.computeVertexNormals();
        add(shaft, 0, 1.36, 0, stone, Math.PI / 8);
        for (const y of [.61, .78]) add(new T.CylinderGeometry(.75, .75, .065, 8), 0, y, 0, bronze, Math.PI / 8);
        // Recessed-looking vertical stone ribs and an aged bronze shrine seal.
        for (const x of [-.26, .26]) block(.055, .62, .035, x, .95, .65, cut);
        const seal = new T.TorusGeometry(.19, .025, 4, 16);
        add(seal, 0, 1.35, .68, bronze);
        block(.04, .27, .035, 0, 1.21, .69, bronze);
        block(.14, .055, .035, 0, 1.32, .7, bronze);
        block(.42, .25, .42, .7, .33, -.43, edge, .28);
        block(.36, .18, .32, -.65, .34, .48, stone, -.38);
    } else {
        // Corner buttresses leave both orthogonal paths through the firing cell
        // open: cover is walkable, unlike the full-height pillar cells.
        for (const x of [-.83, .83]) for (const z of [-.73, .73]) {
            const h = x * z > 0 ? .46 : .3;
            block(.47, .14, .52, x, .025, z, cut);
            block(.42, h, .48, x, .16, z, stone, x * z * .22);
            // A fractured cap, narrow bronze seam and fallen chip read as
            // remnants of the same shrine masonry as the central pillars.
            block(.46, .07, .52, x, .17 + h, z, edge, x * z * .22);
            block(.03, h * .6, .025, x, .23, z + .27, bronze);
            block(.23, .12, .21, x + Math.sign(x) * .32, .02, z - .1, stone, x * .5);
        }
    }
    const geometry = mergeGeometries(pieces);
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: .93 }));
    mesh.name = kind;
    return mesh;
}
const scene = new T.Group();
scene.add(build('pillar'), build('cover'));
const result = await new GLTFExporter().parseAsync(scene, { binary: true });
const out = fileURLToPath(new URL('../public/assets/warfront/shrine-terrain-v1.glb', import.meta.url));
writeFileSync(out, Buffer.from(result));
console.log(`Built shrine terrain: ${result.byteLength.toLocaleString()} bytes, two merged meshes.`);
