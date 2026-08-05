import {useId, useState} from "react"
import {twMerge} from "tailwind-merge"

export default function BigCharacter({className, children, bgImageStyle, ...props}) {
    const [isHovered, setIsHovered] = useState(false);
    const clipId = useId();

    // 85cqw glyph, visually centered with a (3.5cqw, -4cqw) nudge like the old
    // span layout. Positioned via start anchor + alphabetic baseline with
    // pre-measured constants instead of textAnchor="middle" +
    // dominantBaseline="central": those adjustments are resolved from font
    // metrics, and Chromium resolves them differently (fallback/quantized
    // metrics) for text inside a <clipPath>, which shifted the clipped layers
    // off the visible glyph. A bare (x, y) start point involves no metrics at
    // all, so both copies land identically.
    const x = 11;
    const y = 81.25;
    const fontSize = 85;

    return (
        <div
            className={twMerge("relative @container", className)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            {...props}
        >
            <div
                className="absolute inset-0 backdrop-blur-[5px]"
                style={{clipPath: `url("#${clipId}")`}}
            />
            <div
                className="absolute inset-0 transition-opacity duration-150"
                style={{backgroundImage: bgImageStyle, clipPath: `url("#${clipId}")`, opacity: isHovered ? 1 : 0}}
            />
            <svg
                className="absolute inset-0 w-full h-full text-shadow-none select-none pointer-events-none"
                viewBox="0 0 100 100"
                aria-hidden="true"
            >
                <defs>
                    <clipPath id={clipId} clipPathUnits="objectBoundingBox">
                        {/* One objectBoundingBox unit = 100cqw (the container
                            is square), hence the /100 copies. */}
                        <text
                            className="font-pixel-l"
                            x={x / 100}
                            y={y / 100}
                            fontSize={fontSize / 100}
                        >
                            {children}
                        </text>
                    </clipPath>
                </defs>
                <text
                    className="font-pixel-l"
                    x={x}
                    y={y}
                    fontSize={fontSize}
                    fill="none"
                    stroke="rgb(248, 248, 248)"
                    strokeWidth="3.33"
                >
                    {children}
                </text>
            </svg>
        </div>
    );
}
