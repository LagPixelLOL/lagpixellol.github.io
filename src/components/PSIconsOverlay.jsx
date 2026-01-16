import {twMerge} from "tailwind-merge"
import React, {useRef, useEffect, useImperativeHandle, forwardRef, useState, useCallback} from "react"

const TYPE_POOL = ["square", "triangle", "cross", "circle"];
const COLOR_POOL = [
    "#e4e4e7",
    "#a1a1aa",
    "#f4f4f5",
    "#c7d2fe",
    "#99f6e4",
    "#fde68a",
    "#fecaca",
    "#d9f99d",
];

function createRNG(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6d2b79f5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function randomSeed32() {
    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
        const a = new Uint32Array(1);
        crypto.getRandomValues(a);
        return a[0] >>> 0;
    }
    return (Math.random() * 2 ** 32) >>> 0;
}

function rand(rng, min, max) {
    return rng() * (max - min) + min;
}

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function randNormal(rng, mean, std) {
    const u1 = rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
}

function PSShape({type, color, size, filterId}) {
    const renderShape = () => {
        switch (type) {
            case "square":
                return (
                    <rect
                        x="22"
                        y="22"
                        width="56"
                        height="56"
                        rx="12"
                        ry="12"></rect>
                );
            case "triangle":
                return <polygon points="50,18 84,76 16,76"></polygon>;
            case "cross":
                return (
                    <g>
                        <path d="M50 24 L50 76"></path>
                        <path d="M24 50 L76 50"></path>
                    </g>
                );
            case "circle":
            default:
                return <circle cx="50" cy="50" r="30"></circle>;
        }
    };

    return (
        <svg
            viewBox="0 0 100 100"
            width="100"
            height="100"
            aria-hidden="true"
            style={{
                width: size || "48px",
                height: size || "48px",
                display: "block",
                pointerEvents: "none",
                userSelect: "none",
            }}>
            <g
                fill="none"
                stroke={color || "#e4e4e7"}
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={filterId ? `url(#${filterId})` : undefined}>
                {renderShape()}
            </g>
        </svg>
    );
}

const PSIconsOverlay = forwardRef(function PSIconsOverlay(
    {
        className,
        children,
        seed = 42,
        shapeCount,
        meanSize = 64,
        stdSize = 16,
        meanSpeed = 10,
        stdSpeed = 5,
        opacity = 0.16,
        colors = COLOR_POOL,
        types = TYPE_POOL,
        ...props
    },
    ref
) {
    const containerRef = useRef(null);
    const shapeRefsMap = useRef(new Map());
    const shapesDataRef = useRef([]);
    const rafIdRef = useRef(null);
    const runningRef = useRef(true);
    const lastTRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);
    const currentSeedRef = useRef(seed);
    const filterIdRef = useRef(`ps-glow-${Math.random().toString(36).slice(2, 9)}`);

    const [shapeConfigs, setShapeConfigs] = useState([]);

    const generateShapeData = useCallback(
        (useSeed) => {
            currentSeedRef.current = useSeed >>> 0;
            const rng = createRNG(currentSeedRef.current);

            const container = containerRef.current;
            const w = container?.offsetWidth || (typeof window !== "undefined" ? window.innerWidth : 1000);
            const h = container?.offsetHeight || (typeof window !== "undefined" ? window.innerHeight : 800);

            const count = shapeCount ?? Math.max(25, Math.min(75, Math.round((w * h) / 16000)));

            const configs = [];
            const data = [];

            for (let i = 0; i < count; i++) {
                const type = pick(rng, types);
                const color = pick(rng, colors);

                let sizePx = Math.round(randNormal(rng, meanSize, stdSize));
                sizePx = Math.max(16, Math.min(120, sizePx));

                let speed = randNormal(rng, meanSpeed, stdSpeed);
                speed = Math.max(1, Math.min(50, speed));

                const ang = rand(rng, 0, Math.PI * 2);
                const vx = Math.cos(ang) * speed;
                const vy = Math.sin(ang) * speed;

                const omega = rand(rng, -0.35, 0.35);
                const rot = rand(rng, -Math.PI, Math.PI);
                const depth = rand(rng, 0.7, 1.35);

                const x = rand(rng, -sizePx, w + sizePx);
                const y = rand(rng, -sizePx, h + sizePx);

                const id = `shape-${i}-${useSeed}`;

                configs.push({
                    id,
                    type,
                    color,
                    sizePx,
                    opacity,
                    depth,
                });

                data.push({
                    id,
                    x,
                    y,
                    vx,
                    vy,
                    rot,
                    omega,
                    sizePx,
                    depth,
                });
            }

            return {configs, data};
        },
        [shapeCount, meanSize, stdSize, meanSpeed, stdSpeed, opacity, colors, types]
    );

    const createField = useCallback(
        (useSeed) => {
            const {configs, data} = generateShapeData(useSeed);
            shapesDataRef.current = data;
            shapeRefsMap.current.clear();
            setShapeConfigs(configs);
        },
        [generateShapeData]
    );

    const applyTransform = useCallback((el, s) => {
        el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}rad) scale(${s.depth})`;
    }, []);

    const tick = useCallback(
        (t) => {
            rafIdRef.current = requestAnimationFrame(tick);

            if (!runningRef.current) return;

            const prefersReducedMotion =
                typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (prefersReducedMotion) return;

            const dt = Math.min(0.05, (t - lastTRef.current) / 1000);
            lastTRef.current = t;

            const container = containerRef.current;
            if (!container) return;

            const w = container.offsetWidth;
            const h = container.offsetHeight;

            for (const s of shapesDataRef.current) {
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.rot += s.omega * dt;

                const pad = s.sizePx * 1.8;
                if (s.x < -pad) s.x = w + pad;
                else if (s.x > w + pad) s.x = -pad;
                if (s.y < -pad) s.y = h + pad;
                else if (s.y > h + pad) s.y = -pad;

                const el = shapeRefsMap.current.get(s.id);
                if (el) {
                    applyTransform(el, s);
                }
            }
        },
        [applyTransform]
    );

    const start = useCallback(() => {
        if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
        lastTRef.current = performance.now();
        rafIdRef.current = requestAnimationFrame(tick);
    }, [tick]);

    const pause = useCallback(() => {
        runningRef.current = false;
    }, []);

    const resume = useCallback(() => {
        runningRef.current = true;
        lastTRef.current = performance.now();
    }, []);

    const regenerate = useCallback(
        (newSeed) => {
            createField(newSeed ?? randomSeed32());
        },
        [createField]
    );

    useImperativeHandle(
        ref,
        () => ({
            pause,
            resume,
            regenerate,
            isRunning: () => runningRef.current,
        }),
        [pause, resume, regenerate]
    );

    useEffect(() => {
        createField(seed);
        start();

        return () => {
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        for (const s of shapesDataRef.current) {
            const el = shapeRefsMap.current.get(s.id);
            if (el) {
                applyTransform(el, s);
            }
        }
    }, [shapeConfigs, applyTransform]);

    useEffect(() => {
        let resizeTimer = null;
        const handleResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                createField(currentSeedRef.current);
            }, 120);
        };

        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
            clearTimeout(resizeTimer);
        };
    }, [createField]);

    useEffect(() => {
        let wasRunning = true;

        const handleVisibility = () => {
            if (document.hidden) {
                wasRunning = runningRef.current;
                runningRef.current = false;
            } else {
                const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                if (!prefersReducedMotion && wasRunning) {
                    runningRef.current = true;
                    lastTRef.current = performance.now();
                }
            }
        };

        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, []);

    const setShapeRef = useCallback(
        (id) => (el) => {
            if (el) {
                shapeRefsMap.current.set(id, el);
            } else {
                shapeRefsMap.current.delete(id);
            }
        },
        []
    );

    return (
        <div
            ref={containerRef}
            className={twMerge("absolute inset-0 overflow-hidden pointer-events-none -z-69420", className)}
            {...props}>
            <svg width="0" height="0" style={{position: "absolute"}}>
                <defs>
                    <filter
                        id={filterIdRef.current}
                        x="-30%"
                        y="-30%"
                        width="160%"
                        height="160%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" result="blur"></feGaussianBlur>
                        <feMerge>
                            <feMergeNode in="blur"></feMergeNode>
                            <feMergeNode in="SourceGraphic"></feMergeNode>
                        </feMerge>
                    </filter>
                </defs>
            </svg>

            {shapeConfigs.map((config) => (
                <div
                    key={config.id}
                    ref={setShapeRef(config.id)}
                    style={{
                        position: "absolute",
                        opacity: config.opacity,
                        filter: "contrast(1.02)",
                        willChange: "transform",
                        mixBlendMode: "screen",
                    }}
                >
                    <PSShape
                        type={config.type}
                        color={config.color}
                        size={`${config.sizePx}px`}
                        filterId={filterIdRef.current}
                    />
                </div>
            ))}
            {children}
        </div>
    );
});

export default PSIconsOverlay
