import {useState} from "react"
import {twMerge} from "tailwind-merge"

export default function BigCharacter({className, children, bgImageStyle, ...props}) {
    const [isHovered, setIsHovered] = useState(false);

    const wrapperCommonClassName = "absolute inset-0 flex justify-center items-center overflow-hidden";
    const textCommonClassName = "text-[85cqw] font-pixel-l text-shadow-none text-transparent bg-transparent select-none pointer-events-none translate-x-[3.5cqw] -translate-y-[4cqw]";

    return (
        <div
            className={twMerge("relative @container", className)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            {...props}
        >
            <div className={wrapperCommonClassName}>
                <p style={{backgroundImage: bgImageStyle, opacity: isHovered ? 1 : 0}} className={`${textCommonClassName} [-webkit-background-clip:text] transition-opacity duration-150`}>{children}</p>
            </div>
            <div className={wrapperCommonClassName}>
                <p className={`${textCommonClassName} [-webkit-text-stroke:3cqw_rgb(248,_248,_248)]`}>{children}</p>
            </div>
        </div>
    );
}
