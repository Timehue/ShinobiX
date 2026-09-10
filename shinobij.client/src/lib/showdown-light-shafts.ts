import * as THREE from "three";

/** A translucent shaft fades at its ends and at grazing angles. Plain additive
 * cylinders expose hard polygon edges against the sky and resemble solid bars. */
export function createShowdownLightShaftMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
        transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                vUv = uv;
                vec4 view = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vView = -view.xyz;
                gl_Position = projectionMatrix * view;
            }`,
        fragmentShader: `
            uniform vec3 color;
            uniform float opacity;
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
                float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.5);
                float ends = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
                gl_FragColor = vec4(color, opacity * edge * ends);
            }`,
    });
}
