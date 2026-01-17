import {useState} from "react"
import {twMerge} from "tailwind-merge"

export default function BigCharacter({className, children, bgImageStyle, ...props}) {
    const [isHovered, setIsHovered] = useState(false);

    const wrapperCommonClassName = "absolute inset-0 flex justify-center items-center overflow-hidden";
    const spanCommonClassName = "translate-x-[3.5cqw] -translate-y-[4cqw] before:content-[attr(data-text)] before:font-pixel-l before:text-[85cqw] before:text-transparent before:text-shadow-none";

    return (
        <div
            className={twMerge("relative @container", className)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            {...props}
        >
            <div className={wrapperCommonClassName}>
                <span 
                    data-text={children}
                    style={{'--bg-image': bgImageStyle, opacity: isHovered ? 1 : 0}} 
                    className={`${spanCommonClassName} before:[background-image:var(--bg-image)] before:[-webkit-background-clip:text] transition-opacity duration-150`}
                />
            </div>
            <div className={wrapperCommonClassName}>
                <span 
                    data-text={children}
                    className={`${spanCommonClassName} before:[-webkit-text-stroke:3cqw_rgb(248,_248,_248)]`}
                />
            </div>
        </div>
    );
}
