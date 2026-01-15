import {useState, useId} from "react"
import {twMerge} from "tailwind-merge"

export default function SineCircle({
    className,
    color = "#ffffff",
    size = 64,
    strokeWidthRatio = 0.05,
    ...rest
}) {
    const [isHovered, setIsHovered] = useState(false);
    const clipId = useId();
    const gradientId = useId();
    const animationId = useId().replace(/:/g, "");

    const strokeWidth = size * strokeWidthRatio;

    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const amplitude = radius * 0.5;
    const frequency = 1;
    const wavelength = (2.5 * radius) / frequency;

    const generateSinePath = () => {
        const points = [];
        const numPoints = 100;
        const startX = -radius - wavelength * 2;
        const endX = radius + wavelength * 2;
        const step = (endX - startX) / numPoints;

        for (let i = 0; i <= numPoints; i++) {
            const x = startX + i * step;
            const angle = (x / wavelength) * 2 * Math.PI;
            const y = -amplitude * Math.sin(angle);
            points.push(`${center + x},${center + y}`);
        }

        return `M ${points.join(" L ")}`;
    };

    const sinePath = generateSinePath();
    const sineAnimationDuration = "2s";
    const gradientAnimationDuration = "1.5s";

    return (
        <svg
            className={twMerge("overflow-visible", className)}
            viewBox={`0 0 ${size} ${size}`}
            {...rest}
        >
            <defs>
                <clipPath id={clipId}>
                    <circle cx={center} cy={center} r={radius} />
                </clipPath>
                <linearGradient
                    id={gradientId}
                    x1="0"
                    y1="0"
                    x2={wavelength}
                    y2="0"
                    gradientUnits="userSpaceOnUse"
                    spreadMethod="repeat"
                >
                    <animate
                        attributeName="x1"
                        from={-wavelength}
                        to="0"
                        dur={gradientAnimationDuration}
                        repeatCount="indefinite"
                    />
                    <animate
                        attributeName="x2"
                        from="0"
                        to={wavelength}
                        dur={gradientAnimationDuration}
                        repeatCount="indefinite"
                    />
                    <stop offset="0%" stopColor="#ff0000" />
                    <stop offset="16.67%" stopColor="#ff8800" />
                    <stop offset="33.33%" stopColor="#ffff00" />
                    <stop offset="50%" stopColor="#00ff00" />
                    <stop offset="66.67%" stopColor="#0088ff" />
                    <stop offset="83.33%" stopColor="#8800ff" />
                    <stop offset="100%" stopColor="#ff0000" />
                </linearGradient>
            </defs>

            <style>
                {`
                    @keyframes ${animationId} {
                        from { transform: translateX(0); }
                        to { transform: translateX(-${wavelength}px); }
                    }
                `}
            </style>

            <g clipPath={`url(#${clipId})`} className="pointer-events-none">
                <path
                    d={sinePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    className="transition-opacity duration-500 ease-in-out"
                    style={{
                        animation: `${animationId} ${sineAnimationDuration} linear infinite`,
                        opacity: isHovered ? 0 : 1
                    }}
                />
                <path
                    d={sinePath}
                    fill="none"
                    stroke={`url(#${gradientId})`}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    className="transition-opacity duration-500 ease-in-out"
                    style={{
                        animation: `${animationId} ${sineAnimationDuration} linear infinite`,
                        opacity: isHovered ? 1 : 0
                    }}
                />
            </g>

            <circle
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={color}
                strokeWidth={strokeWidth}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            />
        </svg>
    );
}
