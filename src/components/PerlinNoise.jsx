import {twMerge} from "tailwind-merge"
import React, {forwardRef, useRef, useEffect, useCallback} from "react"

const BASE_SCALE = 8.0;

const parseHexColor = (hex) => {
    let h = hex.replace("#", "");
    if (h.length === 3) {
        h = h.split("").map(c => c + c).join("");
    }
    const num = parseInt(h, 16);
    return [
        ((num >> 16) & 255) / 255,
        ((num >> 8) & 255) / 255,
        (num & 255) / 255,
    ];
};

const normalizeCASamples = (value) => {
    let samples = Math.round(value);
    samples = Math.max(2, samples);
    if (samples % 2 !== 0) samples = samples + 1;
    return samples;
};

const PerlinNoise = forwardRef(function PerlinNoise({
    className,
    children,
    color = "#ffffff",
    opacity = 1,
    scale = 1,
    x = 0,
    y = 0,
    caContrast = 1,
    caSamples = 32,
    caSpread = 0.025,
    caCenterX = 0.5,
    caCenterY = 0.5,
    forceMode = null,
    ...props
}, forwardedRef) {
    const internalRef = useRef(null);
    const canvasRef = useRef(null);
    const colorRgbRef = useRef(parseHexColor(color));
    const opacityRef = useRef(opacity);
    const scaleRef = useRef(scale);
    const xRef = useRef(x);
    const yRef = useRef(y);
    const caContrastRef = useRef(caContrast);
    const caSamplesRef = useRef(caSamples);
    const caSpreadRef = useRef(caSpread);
    const caCenterXRef = useRef(caCenterX);
    const caCenterYRef = useRef(caCenterY);
    const forceModeRef = useRef(forceMode);

    useEffect(() => {
        colorRgbRef.current = parseHexColor(color);
    }, [color]);

    useEffect(() => {
        opacityRef.current = opacity;
    }, [opacity]);

    useEffect(() => {
        scaleRef.current = scale;
    }, [scale]);

    useEffect(() => {
        xRef.current = x;
    }, [x]);

    useEffect(() => {
        yRef.current = y;
    }, [y]);

    useEffect(() => {
        caContrastRef.current = caContrast;
    }, [caContrast]);

    useEffect(() => {
        caSamplesRef.current = caSamples;
    }, [caSamples]);

    useEffect(() => {
        caSpreadRef.current = caSpread;
    }, [caSpread]);

    useEffect(() => {
        caCenterXRef.current = caCenterX;
    }, [caCenterX]);

    useEffect(() => {
        caCenterYRef.current = caCenterY;
    }, [caCenterY]);

    useEffect(() => {
        forceModeRef.current = forceMode;
    }, [forceMode]);

    const setRef = useCallback((node) => {
        internalRef.current = node;
        if (typeof forwardedRef === "function") {
            forwardedRef(node);
        } else if (forwardedRef) {
            forwardedRef.current = node;
        }
    }, [forwardedRef]);

    useEffect(() => {
        const container = internalRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        let destroyed = false;
        let rafId = 0;
        let activeConfigure = null;
        let activeFrame = null;
        let isVisible = true;

        const speedZ = 0.25;
        const initialForceMode = forceModeRef.current;

        const stopActive = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            activeConfigure = null;
            activeFrame = null;
        };

        const startLoop = () => {
            if (!rafId && activeFrame && !destroyed && isVisible) {
                rafId = requestAnimationFrame(activeFrame);
            }
        };

        const getSize = () => {
            const rect = container.getBoundingClientRect();
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            return {
                w: Math.max(1, Math.floor(rect.width * dpr)),
                h: Math.max(1, Math.floor(rect.height * dpr))
            };
        };

        const getCAParams = () => {
            return {
                contrast: caContrastRef.current,
                samples: normalizeCASamples(caSamplesRef.current),
                spread: caSpreadRef.current,
                centerX: caCenterXRef.current,
                centerY: caCenterYRef.current,
            };
        };

        const startWebGPU = async () => {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error("No GPU adapter found");
            const device = await adapter.requestDevice();

            const context = canvas.getContext("webgpu");
            if (!context) throw new Error("Failed to acquire WebGPU canvas context");

            const format = navigator.gpu.getPreferredCanvasFormat();

            const uniformBuffer = device.createBuffer({
                size: 64,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            const shaderCode = /* wgsl */`
                struct Uniforms {
                    params0 : vec4<f32>,
                    params1 : vec4<f32>,
                    params2 : vec4<f32>,
                    params3 : vec4<f32>,
                };
                @group(0) @binding(0) var<uniform> U : Uniforms;

                fn fade(t: f32) -> f32 {
                    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
                }

                fn lerp1(a: f32, b: f32, t: f32) -> f32 {
                    return a + t * (b - a);
                }

                fn fadePrime(t: f32) -> f32 {
                    return 30.0 * t * t * (t - 1.0) * (t - 1.0);
                }

                fn hash3(p: vec3<i32>) -> u32 {
                    let x = u32(p.x);
                    let y = u32(p.y);
                    let z = u32(p.z);
                    var h = x * 374761393u + y * 668265263u + z * 2246822519u;
                    h = (h ^ (h >> 13u)) * 1274126177u;
                    h = h ^ (h >> 16u);
                    return h;
                }

                fn grad3(h: u32) -> vec3<f32> {
                    let idx = i32(h % 12u);
                    switch idx {
                        case 0:  { return vec3<f32>( 1.0,  1.0,  0.0); }
                        case 1:  { return vec3<f32>(-1.0,  1.0,  0.0); }
                        case 2:  { return vec3<f32>( 1.0, -1.0,  0.0); }
                        case 3:  { return vec3<f32>(-1.0, -1.0,  0.0); }
                        case 4:  { return vec3<f32>( 1.0,  0.0,  1.0); }
                        case 5:  { return vec3<f32>(-1.0,  0.0,  1.0); }
                        case 6:  { return vec3<f32>( 1.0,  0.0, -1.0); }
                        case 7:  { return vec3<f32>(-1.0,  0.0, -1.0); }
                        case 8:  { return vec3<f32>( 0.0,  1.0,  1.0); }
                        case 9:  { return vec3<f32>( 0.0, -1.0,  1.0); }
                        case 10: { return vec3<f32>( 0.0,  1.0, -1.0); }
                        default: { return vec3<f32>( 0.0, -1.0, -1.0); }
                    }
                }

                fn perlin3(p: vec3<f32>) -> f32 {
                    let pi = vec3<i32>(floor(p));
                    let pf = fract(p);

                    let u = fade(pf.x);
                    let v = fade(pf.y);
                    let w = fade(pf.z);

                    let g000 = grad3(hash3(pi + vec3<i32>(0,0,0)));
                    let g100 = grad3(hash3(pi + vec3<i32>(1,0,0)));
                    let g010 = grad3(hash3(pi + vec3<i32>(0,1,0)));
                    let g110 = grad3(hash3(pi + vec3<i32>(1,1,0)));
                    let g001 = grad3(hash3(pi + vec3<i32>(0,0,1)));
                    let g101 = grad3(hash3(pi + vec3<i32>(1,0,1)));
                    let g011 = grad3(hash3(pi + vec3<i32>(0,1,1)));
                    let g111 = grad3(hash3(pi + vec3<i32>(1,1,1)));

                    let d000 = pf - vec3<f32>(0.0, 0.0, 0.0);
                    let d100 = pf - vec3<f32>(1.0, 0.0, 0.0);
                    let d010 = pf - vec3<f32>(0.0, 1.0, 0.0);
                    let d110 = pf - vec3<f32>(1.0, 1.0, 0.0);
                    let d001 = pf - vec3<f32>(0.0, 0.0, 1.0);
                    let d101 = pf - vec3<f32>(1.0, 0.0, 1.0);
                    let d011 = pf - vec3<f32>(0.0, 1.0, 1.0);
                    let d111 = pf - vec3<f32>(1.0, 1.0, 1.0);

                    let n000 = dot(g000, d000);
                    let n100 = dot(g100, d100);
                    let n010 = dot(g010, d010);
                    let n110 = dot(g110, d110);
                    let n001 = dot(g001, d001);
                    let n101 = dot(g101, d101);
                    let n011 = dot(g011, d011);
                    let n111 = dot(g111, d111);

                    let nx00 = lerp1(n000, n100, u);
                    let nx10 = lerp1(n010, n110, u);
                    let nx01 = lerp1(n001, n101, u);
                    let nx11 = lerp1(n011, n111, u);

                    let nxy0 = lerp1(nx00, nx10, v);
                    let nxy1 = lerp1(nx01, nx11, v);

                    let nxyz = lerp1(nxy0, nxy1, w);

                    let scaled = nxyz * 1.2;
                    return clamp(scaled, -1.0, 1.0);
                }

                fn perlinAlphaAtUV(uv: vec2<f32>) -> f32 {
                    let width = U.params0.x;
                    let height = U.params0.y;
                    let time = U.params0.z;
                    let scale = U.params0.w;

                    let speedZ = U.params1.x;
                    let offsetX = U.params1.z;
                    let offsetY = U.params1.w;

                    let minDim = min(width, height);
                    let fragXY = uv * vec2<f32>(width, height);
                    let xy = (fragXY - 0.5 * vec2<f32>(width, height)) / minDim + vec2<f32>(offsetX, offsetY);

                    let phase = perlin3(vec3<f32>(xy * (scale * 0.15) + vec2<f32>(5.2, -3.7), 0.0));
                    let z = time * speedZ + phase * 3.5;
                    let p = vec3<f32>(xy * scale + vec2<f32>(17.3, -9.1), z);

                    let eps = 0.02;
                    let nPlus = perlin3(p + vec3<f32>(0.0, 0.0, eps));
                    let nMinus = perlin3(p - vec3<f32>(0.0, 0.0, eps));
                    let dndz = (nPlus - nMinus) / (2.0 * eps);

                    let env = max(fadePrime(fract(p.z)), 1e-3);
                    return clamp(abs(dndz) / env * 0.1, 0.0, 1.0);
                }

                fn chromaticPerlin(uv: vec2<f32>) -> vec4<f32> {
                    let caContrast = U.params2.x;
                    let caSamplesF = U.params2.y;
                    let caSpread = U.params2.z;
                    let caCenter = vec2<f32>(U.params2.w, U.params3.x);

                    let sampleCount = max(2, i32(floor(caSamplesF + 0.5)));
                    let denom = max(f32(sampleCount - 1), 1.0);

                    var colorSum = vec3<f32>(0.0, 0.0, 0.0);
                    var weightSum = vec3<f32>(0.0, 0.0, 0.0);
                    var alphaSum = 0.0;
                    var alphaWeightSum = 0.0;

                    for (var si: i32 = 0; si < sampleCount; si = si + 1) {
                        let i = f32(si) / denom;
                        let offset = (i - 0.5) * caSpread;
                        let coord = clamp(
                            uv + (caCenter - uv) * offset,
                            vec2<f32>(0.0, 0.0),
                            vec2<f32>(1.0, 1.0)
                        );

                        let a = perlinAlphaAtUV(coord);

                        var weight = vec4<f32>(i, 1.0 - abs(i + i - 1.0), 1.0 - i, 0.5);
                        weight = vec4<f32>(0.5, 0.5, 0.5, 0.5) + (weight - vec4<f32>(0.5, 0.5, 0.5, 0.5)) * caContrast;

                        colorSum += vec3<f32>(a * a, a * a, a * a) * weight.rgb;
                        weightSum += weight.rgb;
                        alphaSum += a * a * weight.a;
                        alphaWeightSum += weight.a;
                    }

                    let colorAvg = clamp(
                        colorSum / max(weightSum, vec3<f32>(1e-4, 1e-4, 1e-4)),
                        vec3<f32>(0.0, 0.0, 0.0),
                        vec3<f32>(1.0, 1.0, 1.0)
                    );
                    let alphaAvg = clamp(alphaSum / max(alphaWeightSum, 1e-4), 0.0, 1.0);

                    let color = sqrt(colorAvg);
                    let alpha = sqrt(alphaAvg);
                    let premul = min(color, vec3<f32>(alpha, alpha, alpha));

                    return vec4<f32>(premul, alpha);
                }

                struct VSOut {
                    @builtin(position) pos : vec4<f32>,
                };

                @vertex
                fn vsMain(@builtin(vertex_index) vid: u32) -> VSOut {
                    var p = array<vec2<f32>, 3>(
                        vec2<f32>(-1.0, -1.0),
                        vec2<f32>( 3.0, -1.0),
                        vec2<f32>(-1.0,  3.0)
                    );
                    var out: VSOut;
                    out.pos = vec4<f32>(p[vid], 0.0, 1.0);
                    return out;
                }

                @fragment
                fn fsMain(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
                    let width = U.params0.x;
                    let height = U.params0.y;
                    let opacity = U.params1.y;
                    let baseColor = U.params3.yzw;

                    let uv = fragPos.xy / vec2<f32>(width, height);
                    let chroma = chromaticPerlin(uv);

                    let finalAlpha = chroma.a * opacity;
                    let finalRgb = chroma.rgb * baseColor * opacity;

                    return vec4<f32>(finalRgb, finalAlpha);
                }
            `;

            const module = device.createShaderModule({code: shaderCode});

            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {type: "uniform"}},
                ],
            });

            const pipeline = device.createRenderPipeline({
                layout: device.createPipelineLayout({bindGroupLayouts: [bindGroupLayout]}),
                vertex: {module, entryPoint: "vsMain"},
                fragment: {module, entryPoint: "fsMain", targets: [{format}]},
                primitive: {topology: "triangle-list"},
            });

            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{binding: 0, resource: {buffer: uniformBuffer}}],
            });

            const configure = () => {
                const {w, h} = getSize();
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w;
                    canvas.height = h;
                }
                context.configure({device, format, alphaMode: "premultiplied"});
            };

            activeConfigure = configure;
            configure();

            const frame = (tMs) => {
                if (destroyed) return;
                if (!isVisible) {
                    rafId = 0;
                    return;
                }

                configure();

                const t = tMs * 0.001;
                const w = canvas.width;
                const h = canvas.height;
                const [r, g, b] = colorRgbRef.current;
                const userScale = Math.max(scaleRef.current, 0.001);
                const finalScale = BASE_SCALE / userScale;
                const adjustedX = xRef.current * userScale;
                const adjustedY = yRef.current * userScale;
                const ca = getCAParams();

                device.queue.writeBuffer(
                    uniformBuffer, 0,
                    new Float32Array([
                        w, h, t, finalScale,
                        speedZ, opacityRef.current, adjustedX, adjustedY,
                        ca.contrast, ca.samples, ca.spread, ca.centerX,
                        ca.centerY, r, g, b
                    ])
                );

                const encoder = device.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: context.getCurrentTexture().createView(),
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: {r: 0, g: 0, b: 0, a: 0},
                    }],
                });

                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();

                device.queue.submit([encoder.finish()]);
                rafId = requestAnimationFrame(frame);
            };

            activeFrame = frame;
            rafId = requestAnimationFrame(frame);
        };

        const startWebGL = async () => {
            const gl = canvas.getContext("webgl2", {
                antialias: false,
                alpha: true,
                premultipliedAlpha: true,
            });
            if (!gl) {
                console.error("WebGL2 is not supported in this browser.");
                return;
            }

            const configure = () => {
                const {w, h} = getSize();
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w;
                    canvas.height = h;
                }
                gl.viewport(0, 0, canvas.width, canvas.height);
            };

            activeConfigure = configure;
            configure();

            const compileShader = (type, src) => {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                    const info = gl.getShaderInfoLog(sh) || "";
                    gl.deleteShader(sh);
                    throw new Error(info);
                }
                return sh;
            };

            const createProgram = (vsSrc, fsSrc) => {
                const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
                const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
                const prog = gl.createProgram();
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.linkProgram(prog);
                gl.deleteShader(vs);
                gl.deleteShader(fs);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
                    const info = gl.getProgramInfoLog(prog) || "";
                    gl.deleteProgram(prog);
                    throw new Error(info);
                }
                return prog;
            };

            const vsSrc = `#version 300 es
                precision highp float;
                const vec2 P[3] = vec2[3](
                    vec2(-1.0, -1.0),
                    vec2( 3.0, -1.0),
                    vec2(-1.0,  3.0)
                );
                void main(){
                    gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
                }
            `;

            const fsSrc = `#version 300 es
                precision highp float;
                precision highp int;

                uniform vec2 u_resolution;
                uniform float u_time;
                uniform float u_scale;
                uniform float u_speedZ;
                uniform vec3 u_color;
                uniform float u_opacity;
                uniform vec2 u_offset;

                uniform float u_caContrast;
                uniform float u_caSamples;
                uniform float u_caSpread;
                uniform vec2 u_caCenter;

                out vec4 outColor;

                float fade(float t){
                    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
                }

                float lerp1(float a, float b, float t){
                    return a + t * (b - a);
                }

                float fadePrime(float t){
                    return 30.0 * t * t * (t - 1.0) * (t - 1.0);
                }

                uint hash3(ivec3 p){
                    uvec3 q = uvec3(p);
                    uint h = q.x * 374761393u + q.y * 668265263u + q.z * 2246822519u;
                    h = (h ^ (h >> 13u)) * 1274126177u;
                    h = (h ^ (h >> 16u));
                    return h;
                }

                vec3 grad3(uint h){
                    int idx = int(h % 12u);
                    if (idx == 0)  return vec3( 1.0,  1.0,  0.0);
                    if (idx == 1)  return vec3(-1.0,  1.0,  0.0);
                    if (idx == 2)  return vec3( 1.0, -1.0,  0.0);
                    if (idx == 3)  return vec3(-1.0, -1.0,  0.0);
                    if (idx == 4)  return vec3( 1.0,  0.0,  1.0);
                    if (idx == 5)  return vec3(-1.0,  0.0,  1.0);
                    if (idx == 6)  return vec3( 1.0,  0.0, -1.0);
                    if (idx == 7)  return vec3(-1.0,  0.0, -1.0);
                    if (idx == 8)  return vec3( 0.0,  1.0,  1.0);
                    if (idx == 9)  return vec3( 0.0, -1.0,  1.0);
                    if (idx == 10) return vec3( 0.0,  1.0, -1.0);
                    return vec3( 0.0, -1.0, -1.0);
                }

                float perlin3(vec3 p){
                    ivec3 pi = ivec3(floor(p));
                    vec3 pf = fract(p);

                    float u = fade(pf.x);
                    float v = fade(pf.y);
                    float w = fade(pf.z);

                    vec3 g000 = grad3(hash3(pi + ivec3(0,0,0)));
                    vec3 g100 = grad3(hash3(pi + ivec3(1,0,0)));
                    vec3 g010 = grad3(hash3(pi + ivec3(0,1,0)));
                    vec3 g110 = grad3(hash3(pi + ivec3(1,1,0)));
                    vec3 g001 = grad3(hash3(pi + ivec3(0,0,1)));
                    vec3 g101 = grad3(hash3(pi + ivec3(1,0,1)));
                    vec3 g011 = grad3(hash3(pi + ivec3(0,1,1)));
                    vec3 g111 = grad3(hash3(pi + ivec3(1,1,1)));

                    float n000 = dot(g000, pf - vec3(0.0,0.0,0.0));
                    float n100 = dot(g100, pf - vec3(1.0,0.0,0.0));
                    float n010 = dot(g010, pf - vec3(0.0,1.0,0.0));
                    float n110 = dot(g110, pf - vec3(1.0,1.0,0.0));
                    float n001 = dot(g001, pf - vec3(0.0,0.0,1.0));
                    float n101 = dot(g101, pf - vec3(1.0,0.0,1.0));
                    float n011 = dot(g011, pf - vec3(0.0,1.0,1.0));
                    float n111 = dot(g111, pf - vec3(1.0,1.0,1.0));

                    float nx00 = lerp1(n000, n100, u);
                    float nx10 = lerp1(n010, n110, u);
                    float nx01 = lerp1(n001, n101, u);
                    float nx11 = lerp1(n011, n111, u);

                    float nxy0 = lerp1(nx00, nx10, v);
                    float nxy1 = lerp1(nx01, nx11, v);

                    float nxyz = lerp1(nxy0, nxy1, w);

                    float scaled = nxyz * 1.2;
                    return clamp(scaled, -1.0, 1.0);
                }

                float perlinAlphaAtUV(vec2 uv){
                    float width = u_resolution.x;
                    float height = u_resolution.y;

                    float minDim = min(width, height);
                    vec2 fragXY = uv * vec2(width, height);
                    vec2 xy = (fragXY - 0.5 * vec2(width, height)) / minDim + u_offset;

                    float phase = perlin3(vec3(xy * (u_scale * 0.15) + vec2(5.2, -3.7), 0.0));
                    float z = u_time * u_speedZ + phase * 3.5;
                    vec3 p = vec3(xy * u_scale + vec2(17.3, -9.1), z);

                    float eps = 0.02;
                    float nPlus  = perlin3(p + vec3(0.0, 0.0, eps));
                    float nMinus = perlin3(p - vec3(0.0, 0.0, eps));
                    float dndz = (nPlus - nMinus) / (2.0 * eps);

                    float env = max(fadePrime(fract(p.z)), 1e-3);
                    return clamp(abs(dndz) / env * 0.1, 0.0, 1.0);
                }

                vec4 chromaticPerlin(vec2 uv){
                    int sampleCount = max(2, int(floor(u_caSamples + 0.5)));
                    float denom = max(float(sampleCount - 1), 1.0);

                    vec3 colorSum = vec3(0.0);
                    vec3 weightSum = vec3(0.0);
                    float alphaSum = 0.0;
                    float alphaWeightSum = 0.0;

                    for (int si = 0; si < sampleCount; ++si) {
                        float i = float(si) / denom;
                        float offset = (i - 0.5) * u_caSpread;
                        vec2 coord = clamp(uv + (u_caCenter - uv) * offset, 0.0, 1.0);

                        float a = perlinAlphaAtUV(coord);

                        vec4 weight = vec4(i, 1.0 - abs(i + i - 1.0), 1.0 - i, 0.5);
                        weight = vec4(0.5) + (weight - vec4(0.5)) * u_caContrast;

                        colorSum += vec3(a * a) * weight.rgb;
                        weightSum += weight.rgb;
                        alphaSum += a * a * weight.a;
                        alphaWeightSum += weight.a;
                    }

                    vec3 colorAvg = clamp(colorSum / max(weightSum, vec3(1e-4)), 0.0, 1.0);
                    float alphaAvg = clamp(alphaSum / max(alphaWeightSum, 1e-4), 0.0, 1.0);

                    vec3 color = sqrt(colorAvg);
                    float alpha = sqrt(alphaAvg);
                    vec3 premul = min(color, vec3(alpha));

                    return vec4(premul, alpha);
                }

                void main(){
                    float width = u_resolution.x;
                    float height = u_resolution.y;
                    vec2 uv = vec2(gl_FragCoord.x, height - gl_FragCoord.y) / vec2(width, height);

                    vec4 chroma = chromaticPerlin(uv);

                    float finalAlpha = chroma.a * u_opacity;
                    vec3 finalRgb = chroma.rgb * u_color * u_opacity;

                    outColor = vec4(finalRgb, finalAlpha);
                }
            `;

            const program = createProgram(vsSrc, fsSrc);
            const vao = gl.createVertexArray();

            const uRes = gl.getUniformLocation(program, "u_resolution");
            const uTime = gl.getUniformLocation(program, "u_time");
            const uScale = gl.getUniformLocation(program, "u_scale");
            const uSpeed = gl.getUniformLocation(program, "u_speedZ");
            const uColor = gl.getUniformLocation(program, "u_color");
            const uOpacity = gl.getUniformLocation(program, "u_opacity");
            const uOffset = gl.getUniformLocation(program, "u_offset");
            const uCAContrast = gl.getUniformLocation(program, "u_caContrast");
            const uCASamples = gl.getUniformLocation(program, "u_caSamples");
            const uCASpread = gl.getUniformLocation(program, "u_caSpread");
            const uCACenter = gl.getUniformLocation(program, "u_caCenter");

            gl.clearColor(0, 0, 0, 0);

            const frame = (tMs) => {
                if (destroyed) return;
                if (!isVisible) {
                    rafId = 0;
                    return;
                }

                configure();

                const t = tMs * 0.001;
                const userScale = Math.max(scaleRef.current, 0.001);
                const finalScale = BASE_SCALE / userScale;
                const adjustedX = xRef.current * userScale;
                const adjustedY = yRef.current * userScale;
                const ca = getCAParams();

                gl.useProgram(program);
                gl.uniform2f(uRes, canvas.width, canvas.height);
                gl.uniform1f(uTime, t);
                gl.uniform1f(uScale, finalScale);
                gl.uniform1f(uSpeed, speedZ);
                gl.uniform3fv(uColor, colorRgbRef.current);
                gl.uniform1f(uOpacity, opacityRef.current);
                gl.uniform2f(uOffset, adjustedX, adjustedY);
                gl.uniform1f(uCAContrast, ca.contrast);
                gl.uniform1f(uCASamples, ca.samples);
                gl.uniform1f(uCASpread, ca.spread);
                gl.uniform2f(uCACenter, ca.centerX, ca.centerY);

                gl.clear(gl.COLOR_BUFFER_BIT);

                gl.bindVertexArray(vao);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.bindVertexArray(null);

                rafId = requestAnimationFrame(frame);
            };

            activeFrame = frame;
            rafId = requestAnimationFrame(frame);
        };

        const start = async () => {
            if (initialForceMode === "webgpu") {
                await startWebGPU();
                return;
            }
            if (initialForceMode === "webgl") {
                await startWebGL();
                return;
            }
            if (navigator.gpu) {
                try {
                    await startWebGPU();
                } catch (e) {
                    console.error("WebGPU init failed, falling back to WebGL2:", e);
                    await startWebGL();
                }
            } else {
                await startWebGL();
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            if (activeConfigure) activeConfigure();
        });
        resizeObserver.observe(container);

        const intersectionObserver = new IntersectionObserver((entries) => {
            const entry = entries[0];
            const wasVisible = isVisible;
            isVisible = entry.isIntersecting;

            if (isVisible && !wasVisible && !destroyed) {
                startLoop();
            }
        }, {
            threshold: 0
        });
        intersectionObserver.observe(container);

        start().catch((e) => console.error("PerlinNoise initialization error:", e));

        return () => {
            destroyed = true;
            stopActive();
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
        };
    }, []);

    return (
        <div
            ref={setRef}
            className={twMerge("relative overflow-hidden z-0", className)}
            {...props}
        >
            <canvas
                ref={canvasRef}
                className="absolute w-full h-full pointer-events-none -z-69420"
                style={{background: "transparent"}}
            />
            {children}
        </div>
    );
});

PerlinNoise.displayName = "PerlinNoise";

export default PerlinNoise
