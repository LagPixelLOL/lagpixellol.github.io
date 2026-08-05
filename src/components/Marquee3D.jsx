import earcut from "earcut"
import {parse} from "opentype.js"
import {twMerge} from "tailwind-merge"
import * as polyclip from "polyclip-ts"
import {useEffect, useRef, forwardRef} from "react"

// ---------------------------------------------------------------------------
// <Marquee3D/> - N scrolling lines (or columns) of repeated 3D text "blocks",
// rendered with raw WebGL2.
//
// The font size is derived from the canvas so the lines/columns fill it
// exactly: N * fontSize + (N - 1) * gap = canvas extent. Adjacent lines
// scroll in opposite directions at a speed measured in canvas-widths (or
// -heights) per second. Most blocks are flat outlined strokes; a configurable
// fraction of them render filled with the full 3D extrusion treatment.
//
// Geometry pipeline (text -> extrudable mesh):
//   1. Flatten each glyph's outline into polylines (smooth bezier sampling).
//   2. Classify outer contours vs holes per glyph (containment parity).
//   3. Boolean-union all glyphs (polyclip-ts) so overlapping glyphs - e.g.
//      connected script fonts - merge into clean polygons with correct holes
//      and no internal walls.
//   4. Triangulate caps with earcut, extrude walls with smooth normals.
//
// Render pipeline per frame: scene pass into a supersampled multisampled sRGB
// FBO (gamma-correct blending), MSAA resolve, then a final trilinear-
// downsample + linear->sRGB encode pass onto the canvas.
//
// Oblique projection: no perspective, the extrusion is a pure screen-space
// shear (uDir * uDepth) applied in the vertex shader.
// ---------------------------------------------------------------------------

// Clipper (WASM) is only needed for outline mode; load it lazily so it stays
// out of the main bundle.
let clipperPromise = null;
function getClipper() {
    clipperPromise ??= import("js-angusj-clipper/universal").then((lib) =>
        lib
            .loadNativeClipperLibInstanceAsync(lib.NativeClipperLibRequestedFormat.WasmOnly)
            .then((instance) => ({lib, instance})),
    );
    return clipperPromise;
}

// --- Geometry ----------------------------------------------------------------
// Coordinate space: font pixels, y-down (canvas style), baseline at y = 0.
// Each vertex is (x, y, zFlag) where zFlag is 0 on the front face and 1 on
// the back face. Actual depth displacement happens in the vertex shader, so
// depth/angle changes never require a geometry rebuild.

const CURVE_TOLERANCE = 0.15; // px - max deviation when flattening beziers
const CREASE_COS = Math.cos((38 * Math.PI) / 180); // smooth-normal threshold

function quadPoint(p0, c, p1, t) {
    const u = 1 - t;
    return {
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    };
}

function cubicPoint(p0, c1, c2, p1, t) {
    const u = 1 - t;
    return {
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    };
}

// Number of segments needed so the flattened curve stays within tolerance.
function segmentsFor(...pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return Math.max(4, Math.ceil(Math.sqrt(len / CURVE_TOLERANCE)));
}

// Flatten opentype path commands into closed polylines (contours).
function pathToContours(commands) {
    const contours = [];
    let current = null;
    let cursor = {x: 0, y: 0};

    const push = (p) => {
        const last = current[current.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) current.push(p);
    };

    for (const cmd of commands) {
        switch (cmd.type) {
            case "M":
                current = [{x: cmd.x, y: cmd.y}];
                contours.push(current);
                cursor = {x: cmd.x, y: cmd.y};
                break;
            case "L":
                push({x: cmd.x, y: cmd.y});
                cursor = {x: cmd.x, y: cmd.y};
                break;
            case "Q": {
                const p1 = {x: cmd.x, y: cmd.y};
                const c = {x: cmd.x1, y: cmd.y1};
                const n = segmentsFor(cursor, c, p1);
                for (let i = 1; i <= n; i++) push(quadPoint(cursor, c, p1, i / n));
                cursor = p1;
                break;
            }
            case "C": {
                const p1 = {x: cmd.x, y: cmd.y};
                const c1 = {x: cmd.x1, y: cmd.y1};
                const c2 = {x: cmd.x2, y: cmd.y2};
                const n = segmentsFor(cursor, c1, c2, p1);
                for (let i = 1; i <= n; i++) push(cubicPoint(cursor, c1, c2, p1, i / n));
                cursor = p1;
                break;
            }
            case "Z":
            default:
                break;
        }
    }

    // Drop closing duplicate point and degenerate contours.
    return contours
        .map((c) => {
            const first = c[0];
            const last = c[c.length - 1];
            if (c.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) c.pop();
            return c;
        })
        .filter((c) => c.length >= 3);
}

// Shoelace area. In y-down coords, area > 0 means visually clockwise.
function signedArea(contour) {
    let a = 0;
    for (let i = 0; i < contour.length; i++) {
        const p = contour[i];
        const q = contour[(i + 1) % contour.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

function pointInContour(pt, contour) {
    let inside = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
        const a = contour[i];
        const b = contour[j];
        if (
            a.y > pt.y !== b.y > pt.y &&
            pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
        ) {
            inside = !inside;
        }
    }
    return inside;
}

// Group contours into outer/hole sets using containment parity. Only valid
// when contours don't partially overlap (single glyph, or boolean output).
// Returns [{outer: index, holes: [indices]}].
function classifyContours(contours) {
    const n = contours.length;
    const absAreas = contours.map((c) => Math.abs(signedArea(c)));
    const depth = new Array(n).fill(0);
    const parent = new Array(n).fill(-1);

    for (let i = 0; i < n; i++) {
        let bestParent = -1;
        let bestArea = Infinity;
        for (let j = 0; j < n; j++) {
            if (i === j || absAreas[j] <= absAreas[i]) continue;
            if (pointInContour(contours[i][0], contours[j])) {
                depth[i]++;
                if (absAreas[j] < bestArea) {
                    bestArea = absAreas[j];
                    bestParent = j;
                }
            }
        }
        parent[i] = bestParent;
    }

    const groups = [];
    const groupByContour = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
        if (depth[i] % 2 === 0) {
            groupByContour[i] = groups.length;
            groups.push({outer: i, holes: []});
        }
    }
    for (let i = 0; i < n; i++) {
        if (depth[i] % 2 === 1 && parent[i] !== -1) {
            const g = groupByContour[parent[i]];
            if (g !== -1) groups[g].holes.push(i);
        }
    }
    return groups;
}

// One glyph's contours -> polyclip polygons [outerRing, ...holeRings].
function glyphToPolygons(contours) {
    const toRing = (c) => c.map((p) => [p.x, p.y]);
    return classifyContours(contours).map((g) => [
        toRing(contours[g.outer]),
        ...g.holes.map((h) => toRing(contours[h])),
    ]);
}

// Arbitrary rings (point objects) -> [{outer, holes}] with enforced
// winding: outers visually CW in y-down (area > 0), holes CCW.
function groupRings(contours) {
    return classifyContours(contours).map((g) => {
        const outer = contours[g.outer];
        const holes = g.holes.map((h) => contours[h]);
        if (signedArea(outer) < 0) outer.reverse();
        for (const h of holes) if (signedArea(h) > 0) h.reverse();
        return {outer, holes};
    });
}

// polyclip MultiPolygon -> [{outer, holes[]}] as point-object contours with
// enforced winding: outers visually CW in y-down (area > 0), holes CCW.
function normalizeMultiPolygon(multi) {
    const result = [];
    for (const polygon of multi) {
        const rings = polygon
            .map((ring) => {
                const pts = ring.map(([x, y]) => ({x, y}));
                const first = pts[0];
                const last = pts[pts.length - 1];
                if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop();
                return pts;
            })
            .filter((pts) => pts.length >= 3);
        if (rings.length === 0) continue;

        const [outer, ...holes] = rings;
        if (signedArea(outer) < 0) outer.reverse();
        for (const h of holes) if (signedArea(h) > 0) h.reverse();
        result.push({outer, holes});
    }
    return result;
}

// Convert filled polygons into a centered stroke of `width` px: inflate and
// deflate by width/2 with Clipper (MITER joins - corners stay sharp, never
// rounded or softened) and subtract the two.
const CLIPPER_SCALE = 100; // Clipper is integer-based; keep 0.01 px precision

async function strokePolygons(polygons, width) {
    const {lib: clipperLib, instance: clipper} = await getClipper();

    const toClipper = (ring) =>
        ring.map((p) => ({
            x: Math.round(p.x * CLIPPER_SCALE),
            y: Math.round(p.y * CLIPPER_SCALE),
        }));

    const paths = [];
    for (const {outer, holes} of polygons) {
        paths.push(toClipper(outer));
        for (const h of holes) paths.push(toClipper(h));
    }

    const offset = (delta) =>
        clipper.offsetToPaths({
            delta,
            miterLimit: 64, // keep acute corners spiked instead of squaring them off
            offsetInputs: [
                {
                    data: paths,
                    joinType: clipperLib.JoinType.Miter,
                    endType: clipperLib.EndType.ClosedPolygon,
                },
            ],
        }) ?? [];

    const delta = (width / 2) * CLIPPER_SCALE;
    const expanded = offset(delta);
    const shrunk = offset(-delta);

    const rings =
        shrunk.length === 0
            ? expanded // stroke swallowed the whole shape: keep the outer offset
            : clipper.clipToPaths({
                clipType: clipperLib.ClipType.Difference,
                subjectFillType: clipperLib.PolyFillType.NonZero,
                subjectInputs: [{data: expanded, closed: true}],
                clipInputs: [{data: shrunk}],
            }) ?? [];

    const contours = rings
        .map((ring) => ring.map((p) => ({x: p.x / CLIPPER_SCALE, y: p.y / CLIPPER_SCALE})))
        .filter((c) => c.length >= 3);
    return groupRings(contours);
}

// Glyph paths for the requested layout. Horizontal uses the font's own
// kerning/advance layout. Vertical stacks characters top-to-bottom centered
// on the column axis; spacing is based on each glyph's ink bounding box with
// a constant gap, so short glyphs ('e') and descender glyphs ('y') read as
// evenly spaced - a fixed per-em step would make the gaps look uneven.
function collectGlyphPaths(font, text, fontSize, vertical) {
    if (!vertical) return font.getPaths(text, 0, 0, fontSize);
    const scale = fontSize / font.unitsPerEm;
    const gap = 0.18 * fontSize;
    const paths = [];
    let cursor = 0;
    for (const ch of Array.from(text)) {
        const glyph = font.charToGlyph(ch);
        const probe = glyph.getPath(0, 0, fontSize);
        if (probe.commands.length === 0) {
            // Whitespace and other inkless glyphs: leave half an em.
            cursor += fontSize * 0.5;
            continue;
        }
        const bb = probe.getBoundingBox(); // y-down px, relative to baseline 0
        const baseline = cursor - bb.y1;   // glyph top lands exactly on the cursor
        const advance = (glyph.advanceWidth ?? font.unitsPerEm) * scale;
        paths.push(glyph.getPath(-advance / 2, baseline, fontSize));
        cursor += bb.y2 - bb.y1 + gap;
    }
    return paths;
}

/**
 * Build an extruded mesh for `text`. Async: outline mode boots Clipper WASM.
 *
 * options: {outline = false, outlineWidth = 4, vertical = false}
 *   outline: extrude a centered stroke of the glyph contours instead of the
 *   filled shape; corners are kept sharp (miter joins, no rounding).
 *   vertical: stack characters top-to-bottom instead of left-to-right.
 *
 * Returns {
 *   positions: Float32Array (x, y, zFlag),
 *   normals:   Float32Array (unit, y-down screen space, z toward viewer),
 *   kinds:     Float32Array (0 = front face, 1 = side/back),
 *   indices:   Uint32Array,
 *   bbox:      {x0, y0, x1, y1},
 * }
 */
async function buildTextGeometry(font, text, fontSize, options = {}) {
    const {outline = false, outlineWidth = 4, vertical = false} = options;
    const empty = {
        positions: new Float32Array(0),
        normals: new Float32Array(0),
        kinds: new Float32Array(0),
        indices: new Uint32Array(0),
        bbox: {x0: 0, y0: 0, x1: 0, y1: 0},
    };

    // Per-glyph polygons, then union so overlapping glyphs merge cleanly.
    const glyphPolygons = [];
    for (const path of collectGlyphPaths(font, text, fontSize, vertical)) {
        const contours = pathToContours(path.commands);
        if (contours.length) glyphPolygons.push(...glyphToPolygons(contours));
    }
    if (glyphPolygons.length === 0) return empty;

    let merged;
    try {
        merged = polyclip.union(glyphPolygons[0], ...glyphPolygons.slice(1));
    } catch {
        // Extremely rare numeric failures: fall back to un-merged polygons.
        merged = glyphPolygons;
    }

    let polygons = normalizeMultiPolygon(merged);
    if (polygons.length === 0) return empty;

    if (outline) {
        polygons = await strokePolygons(polygons, Math.max(outlineWidth, 0.1));
        if (polygons.length === 0) return empty;
    }

    const positions = [];
    const normals = [];
    const kinds = [];
    const indices = [];
    const bbox = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};

    const addVertex = (x, y, zFlag, nx, ny, nz, kind) => {
        positions.push(x, y, zFlag);
        normals.push(nx, ny, nz);
        kinds.push(kind);
        if (x < bbox.x0) bbox.x0 = x;
        if (y < bbox.y0) bbox.y0 = y;
        if (x > bbox.x1) bbox.x1 = x;
        if (y > bbox.y1) bbox.y1 = y;
        return positions.length / 3 - 1;
    };

    // --- Front + back caps -------------------------------------------------
    for (const {outer, holes} of polygons) {
        const flat = [];
        const holeIndices = [];
        for (const p of outer) flat.push(p.x, p.y);
        for (const h of holes) {
            holeIndices.push(flat.length / 2);
            for (const p of h) flat.push(p.x, p.y);
        }

        const tris = earcut(flat, holeIndices.length ? holeIndices : null);

        const frontBase = positions.length / 3;
        for (let i = 0; i < flat.length; i += 2) {
            addVertex(flat[i], flat[i + 1], 0, 0, 0, 1, 0);
        }
        const backBase = positions.length / 3;
        for (let i = 0; i < flat.length; i += 2) {
            addVertex(flat[i], flat[i + 1], 1, 0, 0, -1, 1);
        }
        for (let i = 0; i < tris.length; i += 3) {
            indices.push(frontBase + tris[i], frontBase + tris[i + 1], frontBase + tris[i + 2]);
            indices.push(backBase + tris[i], backBase + tris[i + 2], backBase + tris[i + 1]);
        }
    }

    // --- Side walls (smooth-shaded) ------------------------------------------
    for (const {outer, holes} of polygons) {
        for (const contour of [outer, ...holes]) {
            const m = contour.length;

            // Outward normal per edge. With our winding convention, (dy, -dx)
            // points away from the glyph material for outers and into holes.
            const edgeNormals = [];
            for (let i = 0; i < m; i++) {
                const p = contour[i];
                const q = contour[(i + 1) % m];
                const dx = q.x - p.x;
                const dy = q.y - p.y;
                const len = Math.hypot(dx, dy) || 1;
                edgeNormals.push({x: dy / len, y: -dx / len});
            }

            // Per-vertex normals: average adjacent edge normals when the corner is
            // shallow (smooth curve), keep them split at hard creases.
            const inNormal = new Array(m);
            const outNormal = new Array(m);
            for (let i = 0; i < m; i++) {
                const nPrev = edgeNormals[(i - 1 + m) % m];
                const nNext = edgeNormals[i];
                const dot = nPrev.x * nNext.x + nPrev.y * nNext.y;
                if (dot >= CREASE_COS) {
                    const sx = nPrev.x + nNext.x;
                    const sy = nPrev.y + nNext.y;
                    const len = Math.hypot(sx, sy) || 1;
                    const smooth = {x: sx / len, y: sy / len};
                    inNormal[i] = smooth;
                    outNormal[i] = smooth;
                } else {
                    inNormal[i] = nPrev;
                    outNormal[i] = nNext;
                }
            }

            for (let i = 0; i < m; i++) {
                const j = (i + 1) % m;
                const p = contour[i];
                const q = contour[j];
                const n0 = outNormal[i];
                const n1 = inNormal[j];
                const f0 = addVertex(p.x, p.y, 0, n0.x, n0.y, 0, 1);
                const b0 = addVertex(p.x, p.y, 1, n0.x, n0.y, 0, 1);
                const f1 = addVertex(q.x, q.y, 0, n1.x, n1.y, 0, 1);
                const b1 = addVertex(q.x, q.y, 1, n1.x, n1.y, 0, 1);
                indices.push(f0, b0, f1, f1, b0, b1);
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        kinds: new Float32Array(kinds),
        indices: new Uint32Array(indices),
        bbox,
    };
}

// --- Shaders -------------------------------------------------------------------

const VERT = `#version 300 es
    in vec3 aPos;     // x, y in font px (y-down); z is 0 (front) or 1 (back)
    in vec3 aNormal;  // y-down screen space, z toward viewer
    in float aKind;   // 0 = front face, 1 = side/back

    uniform float uDepth;   // extrusion length, css px
    uniform vec2  uDir;     // screen-space extrusion direction (unit)
    uniform vec2  uOffset;  // css px translation
    uniform vec2  uViewport;

    out vec3 vNormal;
    out float vKind;
    out float vZ;

    void main() {
        vec2 p = aPos.xy + uOffset + aPos.z * uDepth * uDir;
        vec2 ndc = vec2(p.x / uViewport.x * 2.0 - 1.0, 1.0 - p.y / uViewport.y * 2.0);
        // Front face sits closer to the camera than the back face.
        gl_Position = vec4(ndc, aPos.z * 1.8 - 0.9, 1.0);
        vNormal = aNormal;
        vKind = aKind;
        vZ = aPos.z;
    }
`;

const FRAG = `#version 300 es
    precision highp float;

    in vec3 vNormal;
    in float vKind;
    in float vZ;

    uniform vec3 uFaceColor;
    uniform vec3 uSideColor;
    uniform vec3 uLightDir;      // y-down screen space, unit
    uniform float uShading;      // 1 = lit sides, 0 = flat side color
    uniform float uGradient;     // 1 = OKLCH hue-cycle gradient along the depth
    uniform vec3 uGradientColor; // sRGB base color of the gradient
    uniform float uRepeat;       // hue rotations across the full depth (signed; negative mirrors)
    uniform float uPhase;        // animation phase in rotations

    out vec4 outColor;

    const float TAU = 6.283185307179586;

    // --- sRGB transfer (IEC 61966-2-1) --------------------------------------
    vec3 srgbToLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
    }
    vec3 linearToSrgb(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }

    // --- Oklab <-> linear sRGB -----------------------------------------------
    // Matrices from Björn Ottosson, https://bottosson.github.io/posts/oklab/
    // (2021-01-25 revision, public domain).
    vec3 linearSrgbToOklab(vec3 c) {
        float l = dot(vec3(0.4122214708, 0.5363325363, 0.0514459929), c);
        float m = dot(vec3(0.2119034982, 0.6806995451, 0.1073969566), c);
        float s = dot(vec3(0.0883024619, 0.2817188376, 0.6299787005), c);
        float l_ = pow(max(l, 0.0), 1.0 / 3.0);
        float m_ = pow(max(m, 0.0), 1.0 / 3.0);
        float s_ = pow(max(s, 0.0), 1.0 / 3.0);
        return vec3(
            0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
        );
    }
    vec3 oklabToLinearSrgb(vec3 lab) {
        float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
        float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
        float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
        float l = l_ * l_ * l_;
        float m = m_ * m_ * m_;
        float s = s_ * s_ * s_;
        return vec3(
             4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        );
    }

    bool inGamut(vec3 rgb) {
        return all(greaterThanEqual(rgb, vec3(-1e-4))) && all(lessThanEqual(rgb, vec3(1.0 + 1e-4)));
    }

    // CSS-4-style gamut mapping: hold L and h, bisect chroma down until the
    // color fits in sRGB, then clamp the residual error.
    vec3 oklchToSrgb(float L, float C, float h) {
        vec2 ab = vec2(cos(h), sin(h));
        vec3 rgb = oklabToLinearSrgb(vec3(L, C * ab));
        if (!inGamut(rgb)) {
            float lo = 0.0;
            float hi = C;
            for (int i = 0; i < 12; i++) {
                float mid = 0.5 * (lo + hi);
                if (inGamut(oklabToLinearSrgb(vec3(L, mid * ab)))) lo = mid;
                else hi = mid;
            }
            rgb = oklabToLinearSrgb(vec3(L, lo * ab));
        }
        return linearToSrgb(clamp(rgb, 0.0, 1.0));
    }

    void main() {
        vec3 n = normalize(vNormal);
        float diffuse = max(dot(n, uLightDir), 0.0);

        vec3 sideBase = uSideColor;
        if (uGradient > 0.5) {
            // One color in: walk the full hue circle (the long route) along
            // the depth so z = depth/uRepeat lands back on the input color.
            vec3 lab = linearSrgbToOklab(srgbToLinear(uGradientColor));
            float C = length(lab.yz);
            float h = atan(lab.z, lab.y) + TAU * (vZ * uRepeat + uPhase);
            sideBase = oklchToSrgb(lab.x, C, h);
        }

        vec3 side = sideBase * mix(1.0, 0.30 + 0.70 * diffuse, uShading);
        vec3 color = vKind < 0.5 ? uFaceColor : side;
        // Output linear light: render targets are SRGB8_ALPHA8, so the
        // hardware encodes on write and every AA average (MSAA resolve, mip
        // downsample) blends in linear space. Gamma-space blending makes thin
        // features ropey.
        outColor = vec4(srgbToLinear(color), 1.0);
    }
`;

// Fullscreen triangle, no vertex buffers needed.
const FINAL_VERT = `#version 300 es
    void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }
`;

// Final pass: sample the resolved scene (trilinear when supersampled) and
// encode linear light to sRGB for the canvas.
const FINAL_FRAG = `#version 300 es
    precision highp float;

    uniform sampler2D uTexture;
    uniform vec2 uResolution; // destination size

    out vec4 outColor;

    vec3 linearToSrgbOut(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }

    void main() {
        vec4 t = texture(uTexture, gl_FragCoord.xy / uResolution);
        outColor = vec4(linearToSrgbOut(clamp(t.rgb, 0.0, 1.0)), t.a);
    }
`;

// --- Font loading ----------------------------------------------------------------

const fontCache = new Map();
function loadFont(url) {
    if (!fontCache.has(url)) {
        fontCache.set(
            url,
            fetch(url)
                .then((r) => {
                    if (!r.ok) throw new Error(`Failed to fetch font: ${r.status}`);
                    return r.arrayBuffer();
                })
                .then((buf) => parse(buf)),
        );
    }
    return fontCache.get(url);
}

// --- Colors ----------------------------------------------------------------------

const colorCache = new Map();
function parseColor(css) {
    let cached = colorCache.get(css);
    if (!cached) {
        let hex = css.trim().replace(/^#/, "");
        if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
        const int = parseInt(hex, 16);
        cached = [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
        colorCache.set(css, cached);
    }
    return cached;
}

function srgbChannelToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// --- Renderer ----------------------------------------------------------------------

function compileShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

const LIGHT = (() => {
    // From the upper-left, in front of the scene (y-down coords).
    const v = [-0.45, -0.6, 0.66];
    const len = Math.hypot(...v);
    return v.map((c) => c / len);
})();

function createRenderer(canvas) {
    // AA happens in our own framebuffer (supersampling + MSAA at the max
    // sample count the driver offers), so the canvas itself does not need to
    // be antialiased.
    const gl = canvas.getContext("webgl2", {antialias: false, alpha: true});
    if (!gl) throw new Error("WebGL2 is not supported");

    const link = (vsSrc, fsSrc) => {
        const prog = gl.createProgram();
        gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
        gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(prog));
        }
        return prog;
    };

    const program = link(VERT, FRAG);
    const finalProgram = link(FINAL_VERT, FINAL_FRAG);

    const uniforms = {};
    for (const name of ["uDepth", "uDir", "uOffset", "uViewport", "uFaceColor", "uSideColor", "uLightDir", "uShading", "uGradient", "uGradientColor", "uRepeat", "uPhase"]) {
        uniforms[name] = gl.getUniformLocation(program, name);
    }
    const finalUniforms = {
        uTexture: gl.getUniformLocation(finalProgram, "uTexture"),
        uResolution: gl.getUniformLocation(finalProgram, "uResolution"),
    };

    // Render targets: multisampled scene FBO + single-sample resolve texture.
    const samples = gl.getParameter(gl.MAX_SAMPLES);
    const maxDim = Math.min(
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    );
    const emptyVao = gl.createVertexArray(); // fullscreen triangle uses gl_VertexID
    const msaa = {fbo: gl.createFramebuffer(), color: gl.createRenderbuffer(), depth: gl.createRenderbuffer()};
    const resolve = {fbo: gl.createFramebuffer(), tex: gl.createTexture()};
    let targetW = 0;
    let targetH = 0;

    const ensureTargets = (w, h) => {
        if (targetW === w && targetH === h) return;
        targetW = w;
        targetH = h;

        gl.bindRenderbuffer(gl.RENDERBUFFER, msaa.color);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.SRGB8_ALPHA8, w, h);
        gl.bindRenderbuffer(gl.RENDERBUFFER, msaa.depth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaa.color);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaa.depth);

        gl.bindTexture(gl.TEXTURE_2D, resolve.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, resolve.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolve.tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const renderer = {gl, canvas, maxDim};

    // A mesh owns its VAO + buffers; upload() fills it from a geometry object.
    renderer.createMesh = () => {
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const buffers = {pos: gl.createBuffer(), normal: gl.createBuffer(), kind: gl.createBuffer(), index: gl.createBuffer()};
        const bind = (buffer, name, size) => {
            const loc = gl.getAttribLocation(program, name);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        };
        bind(buffers.pos, "aPos", 3);
        bind(buffers.normal, "aNormal", 3);
        bind(buffers.kind, "aKind", 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bindVertexArray(null);

        const mesh = {vao, indexCount: 0, bbox: {x0: 0, y0: 0, x1: 0, y1: 0}};
        mesh.upload = (geo) => {
            gl.bindVertexArray(vao); // ELEMENT_ARRAY_BUFFER binding is VAO state
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos);
            gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
            gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffers.kind);
            gl.bufferData(gl.ARRAY_BUFFER, geo.kinds, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            mesh.indexCount = geo.indices.length;
            mesh.bbox = geo.bbox;
        };
        return mesh;
    };

    // Supersampled MSAA is the only AA: power-of-two factors so the trilinear
    // downsample hits an exact mip level (a clean box filter). Minimum 2x
    // always, scaling up to 16x for tiny fonts, clamped by the GPU's limits
    // plus a pixel budget.
    const computeRenderScale = (fontSize, dpr, pw, ph, maxScale) => {
        const TARGET_DEVICE_PX = 256;
        const PIXEL_BUDGET = 16 * 1024 * 1024;
        const need = TARGET_DEVICE_PX / (fontSize * dpr);
        let ss = need <= 1 ? 1 : 2 ** Math.ceil(Math.log2(need));
        ss = Math.min(Math.max(ss, 2), maxScale);
        while (ss > 1 && (pw * ss > maxDim || ph * ss > maxDim || pw * ss * ph * ss > PIXEL_BUDGET)) {
            ss /= 2;
        }
        return ss;
    };

    // Sizes the canvas backing store, binds + clears the scene FBO.
    // Returns a frame handle for endFrame(), or null when the canvas is empty.
    // maxScale caps supersampling; heavy always-animating scenes can lower it.
    renderer.beginFrame = ({background = "transparent", fontSize = 100, maxScale = 16}) => {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) return null;
        const pw = Math.round(w * dpr);
        const ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
            canvas.width = pw;
            canvas.height = ph;
        }
        const ss = computeRenderScale(fontSize, dpr, pw, ph, maxScale);
        const rw = pw * ss;
        const rh = ph * ss;
        ensureTargets(rw, rh);

        gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fbo);
        gl.useProgram(program);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.viewport(0, 0, rw, rh);

        if (background === "transparent") {
            gl.clearColor(0, 0, 0, 0);
        } else {
            // Clear values are linear; the sRGB attachment encodes on write.
            const [r, g, b] = parseColor(background).map(srgbChannelToLinear);
            gl.clearColor(r, g, b, 1);
        }
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        gl.uniform2f(uniforms.uViewport, w, h);
        gl.uniform3f(uniforms.uLightDir, LIGHT[0], LIGHT[1], LIGHT[2]);

        return {w, h, pw, ph, rw, rh, ss};
    };

    // Draws a mesh instance with its own transform/material uniforms.
    // gradient: null | {color, repeat (signed), phase}
    renderer.drawMesh = (mesh, {
        depthPx = 0,
        angle = 40,
        offsetX = 0,
        offsetY = 0,
        faceColor = "#ffffff",
        sideColor = "#e8590c",
        shadow = true,
        gradient = null,
    }) => {
        if (mesh.indexCount === 0) return;
        const rad = (angle * Math.PI) / 180;
        gl.bindVertexArray(mesh.vao);
        gl.uniform1f(uniforms.uDepth, depthPx);
        gl.uniform2f(uniforms.uDir, Math.cos(rad), -Math.sin(rad));
        gl.uniform2f(uniforms.uOffset, offsetX, offsetY);
        gl.uniform3fv(uniforms.uFaceColor, parseColor(faceColor));
        gl.uniform3fv(uniforms.uSideColor, parseColor(sideColor));
        gl.uniform1f(uniforms.uShading, shadow ? 1 : 0);
        gl.uniform1f(uniforms.uGradient, gradient ? 1 : 0);
        if (gradient) {
            gl.uniform3fv(uniforms.uGradientColor, parseColor(gradient.color));
            gl.uniform1f(uniforms.uRepeat, gradient.repeat);
            gl.uniform1f(uniforms.uPhase, gradient.phase);
        }
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
    };

    // Resolve MSAA and downsample/encode onto the canvas.
    renderer.endFrame = (frame) => {
        const {pw, ph, rw, rh, ss} = frame;

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve.fbo);
        gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.NEAREST);

        gl.bindVertexArray(emptyVao);
        gl.disable(gl.DEPTH_TEST);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, resolve.tex);
        if (ss > 1) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, pw, ph);
        gl.useProgram(finalProgram);
        gl.uniform1i(finalUniforms.uTexture, 0);
        gl.uniform2f(finalUniforms.uResolution, pw, ph);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    return renderer;
}

// Gradient phase for a given elapsed time, wrapped mod 1 for float precision.
// speed is in depth-lengths per second; sign of `repeatSigned` preserves the
// motion direction when the gradient is inverted.
function gradientPhase(elapsedSec, speed, repeatSigned) {
    return (((-elapsedSec * speed * repeatSigned) % 1) + 1) % 1;
}

// Re-runs the latest draw closure (kept in a ref) when the canvas element
// resizes or when devicePixelRatio changes (e.g. the window moves to a
// monitor with a different scale - ResizeObserver won't fire for that).
function useCanvasRedraw(canvasRef, drawRef) {
    useEffect(() => {
        const ro = new ResizeObserver(() => drawRef.current?.());
        ro.observe(canvasRef.current);

        let mql = null;
        const onDprChange = () => {
            drawRef.current?.();
            listen();
        };
        const listen = () => {
            mql?.removeEventListener("change", onDprChange);
            mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            mql.addEventListener("change", onDprChange);
        };
        listen();

        return () => {
            ro.disconnect();
            mql?.removeEventListener("change", onDprChange);
        };
    }, [canvasRef, drawRef]);
}

// Deterministic per-block hash in [0, 1): decides which blocks are filled.
// Stable across frames so blocks keep their identity while scrolling.
function blockHash(line, m) {
    let h = Math.imul(line + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(m + 0x165667b1, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const Marquee3D = forwardRef(function Marquee3D(
    {
        className,
        children,
        text = "HELLO",
        fontUrl,
        columns = false,          // false = N horizontal lines, true = N vertical columns
        count = 5,                // N
        textSpacing = 0.5,        // gap between repeated blocks, ratio of font size
        lineSpacing = 0.35,       // gap between lines/columns, ratio of font size
        speed = 0.08,             // canvas-widths (or -heights) per second; sign flips, 0 = static
        stagger = 0,              // 0..1: phase offset between same-direction lines, in periods
        outlineWidth = 0.03,      // stroke thickness of outlined blocks, ratio of font size
        outlineColor = "#ffffff", // color of the outlined (stroke) blocks
        filled = 0.2,             // 0..1 fraction of blocks drawn filled + extruded
        // Filled-block (3D) settings:
        depth = 0.25,             // extrusion length, ratio of font size
        angle = 40,               // extrusion direction, degrees
        faceColor = "#ffffff",
        sideColor = "#e8590c",
        shadow = true,            // directional shading on the extruded sides
        gradient = false,         // OKLCH hue-cycle gradient along the depth
        gradientColor = "#e8590c",
        gradientRepeat = 1,       // hue rotations across the depth
        gradientSpeed = 0.5,      // depth-lengths per second
        gradientInvert = false,
        background = "transparent",
        ...props
    },
    ref,
) {
    const canvasRef = useRef(null);
    const glRef = useRef(null);   // {renderer, fill, outline, key, fontSize, building}
    const drawRef = useRef(null);
    const rafRef = useRef(0);
    const epochRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;

        if (!fontUrl) {
            console.warn("Marquee3D: a fontUrl is required");
            return undefined;
        }

        loadFont(fontUrl)
            .then((font) => {
                if (cancelled) return;

                if (!glRef.current) {
                    const renderer = createRenderer(canvas);
                    glRef.current = {
                        renderer,
                        fill: renderer.createMesh(),
                        outline: renderer.createMesh(),
                        key: null,
                        buildingKey: null,
                        fontSize: 0, // font size the current meshes were built at
                    };
                }
                const state = glRef.current;
                const {renderer} = state;

                // Font size so N lines/columns fill the canvas extent exactly,
                // using a slot model: each line is centered in an extent/N
                // slot, so the top/bottom edges get half a line-gap of
                // breathing room instead of the outer lines hugging the
                // border.
                //
                // Slots are sized by the text's INK extent on the cross axis,
                // not the em box: glyphs are much narrower than an em (columns
                // would never pack tightly), and script fonts like Pacifico
                // overflow the em (lines would clip at the canvas edge). The
                // ink/em ratio is scale-invariant and comes from the last
                // built geometry (defaults to 1, then one rebuild converges on
                // the exact fit).
                const crossRatio = () => state.crossRatio || 1;
                const fontSizeFor = (extent) =>
                    Math.max(4, extent / (count * (crossRatio() + lineSpacing)));

                const ensureGeometry = (fs) => {
                    const key = `${fontUrl}\u0000${text}\u0000${fs}\u0000${outlineWidth}\u0000${columns ? "v" : "h"}`;
                    if (state.key === key || state.buildingKey === key) return;
                    state.buildingKey = key;
                    Promise.all([
                        buildTextGeometry(font, text, fs, {vertical: columns}),
                        buildTextGeometry(font, text, fs, {
                            vertical: columns,
                            outline: true,
                            outlineWidth: Math.max(outlineWidth * fs, 0.05),
                        }),
                    ])
                        .then(([geoFill, geoOutline]) => {
                            if (cancelled || glRef.current !== state || state.buildingKey !== key) return;
                            state.fill.upload(geoFill);
                            state.outline.upload(geoOutline);
                            state.key = key;
                            state.buildingKey = null;
                            state.fontSize = fs;
                            const b = geoFill.bbox;
                            state.crossRatio = Math.max((columns ? b.x1 - b.x0 : b.y1 - b.y0) / fs, 1e-3);
                            if (!rafRef.current) drawRef.current?.();
                        })
                        .catch((err) => {
                            if (!cancelled) console.error("Marquee3D:", err);
                        });
                };

                const draw = () => {
                    const w = canvas.clientWidth;
                    const h = canvas.clientHeight;
                    if (w === 0 || h === 0) return;

                    // Target font size from the cross axis; rebuild async when
                    // it drifts. Rounded to whole px so resize drags don't
                    // rebuild for every sub-pixel change.
                    const targetFs = Math.round(fontSizeFor(columns ? w : h));
                    ensureGeometry(targetFs);

                    const fs = state.fontSize; // draw with what is actually built
                    // Cap supersampling at 2x: this scene animates every frame
                    // across the full canvas, 2x SS + MSAA is the perf/quality
                    // sweet spot.
                    const frame = renderer.beginFrame({background, fontSize: fs || targetFs, maxScale: 2});
                    if (!frame) return;
                    if (!fs || state.fill.indexCount === 0) {
                        renderer.endFrame(frame);
                        return;
                    }

                    const bbox = state.fill.bbox; // shared layout for both variants
                    const gap = lineSpacing * fs;
                    const elapsed = (performance.now() - epochRef.current) / 1000;

                    // Main axis = scroll direction; cross axis = line stacking.
                    const mainExtent = columns ? h : w;
                    const crossExtent = columns ? w : h;
                    const blockMain = columns ? bbox.y1 - bbox.y0 : bbox.x1 - bbox.x0;
                    const blockCross = columns ? bbox.x1 - bbox.x0 : bbox.y1 - bbox.y0;
                    const period = blockMain + textSpacing * fs;
                    const speedPx = speed * mainExtent;

                    // Cross-axis slot = the block's ink extent on the cross axis.
                    const slotSize = blockCross;
                    const totalCross = count * slotSize + (count - 1) * gap;
                    const crossPad = (crossExtent - totalCross) / 2;

                    const depthPx = depth * fs;
                    const margin = blockMain + Math.abs(depthPx) + 4;

                    const repeat = Math.max(gradientRepeat, 1e-6);
                    const sign = gradientInvert ? -1 : 1;
                    const grad = gradient
                        ? {
                            color: gradientColor,
                            repeat: repeat * sign,
                            phase: gradientPhase(elapsed, gradientSpeed, repeat * sign),
                        }
                        : null;

                    // Direction the stagger shifts toward follows each line's
                    // travel direction (including the speed sign); +1 when
                    // speed is 0.
                    const speedSign = speed < 0 ? -1 : 1;

                    for (let i = 0; i < count; i++) {
                        // Alternate direction per line; the speed sign flips the pattern.
                        const dir = i % 2 === 0 ? 1 : -1;
                        // Stagger de-aligns lines that travel in the same
                        // direction: each successive same-direction line is
                        // shifted by an extra `stagger` periods (1 wraps back
                        // to aligned), along its own direction of travel.
                        const staggerPx = Math.floor(i / 2) * stagger * period;
                        const scroll = dir * (speedPx * elapsed + speedSign * staggerPx);

                        // Cross-axis placement: the block's ink starts at its slot edge.
                        const slot = crossPad + i * (slotSize + gap);
                        const crossOffset = slot - (columns ? bbox.x0 : bbox.y0);

                        // Visible block indices along the main axis.
                        const m0 = Math.floor((-margin - scroll) / period);
                        const m1 = Math.ceil((mainExtent + margin - scroll) / period);
                        for (let m = m0; m <= m1; m++) {
                            const mainOffset = m * period + scroll - (columns ? bbox.y0 : bbox.x0);
                            const offsetX = columns ? crossOffset : mainOffset;
                            const offsetY = columns ? mainOffset : crossOffset;

                            if (blockHash(i, m) < filled) {
                                renderer.drawMesh(state.fill, {
                                    depthPx,
                                    angle,
                                    offsetX,
                                    offsetY,
                                    faceColor,
                                    sideColor,
                                    shadow,
                                    gradient: grad,
                                });
                            } else {
                                renderer.drawMesh(state.outline, {
                                    depthPx: 0,
                                    offsetX,
                                    offsetY,
                                    faceColor: outlineColor,
                                });
                            }
                        }
                    }

                    renderer.endFrame(frame);
                };

                drawRef.current = draw;
                draw();

                cancelAnimationFrame(rafRef.current);
                rafRef.current = 0;
                const animates = speed !== 0 || (gradient && gradientSpeed !== 0 && filled > 0);
                if (animates) {
                    const loop = () => {
                        drawRef.current?.();
                        rafRef.current = requestAnimationFrame(loop);
                    };
                    rafRef.current = requestAnimationFrame(loop);
                }
            })
            .catch((err) => {
                if (!cancelled) console.error("Marquee3D:", err);
            });

        return () => {
            cancelled = true;
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        };
    }, [text, fontUrl, columns, count, textSpacing, lineSpacing, speed, stagger, outlineWidth, outlineColor, filled, depth, angle, faceColor, sideColor, shadow, gradient, gradientColor, gradientRepeat, gradientSpeed, gradientInvert, background]);

    useEffect(() => {
        epochRef.current = performance.now();
    }, []);
    useCanvasRedraw(canvasRef, drawRef);

    return (
        <div
            ref={ref}
            className={twMerge("relative overflow-hidden z-0", className)}
            {...props}
        >
            <canvas
                ref={canvasRef}
                className="absolute w-full h-full pointer-events-none -z-69420"
            />
            {children}
        </div>
    );
});

Marquee3D.displayName = "Marquee3D";

export default Marquee3D
