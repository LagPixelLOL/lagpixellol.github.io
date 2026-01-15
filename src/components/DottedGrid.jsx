import {forwardRef} from "react"
import {twMerge} from "tailwind-merge"

const DottedGrid = forwardRef(({className, children, style, ...props}, ref) => {
    const baseClasses = "relative bg-zinc-950";

    const dotPattern = {
        backgroundImage: "radial-gradient(circle, rgb(63 63 70 / 0.15) 2px, transparent 2px)",
        backgroundSize: "32px 32px",
        maskImage: "radial-gradient(ellipse at center, black 50%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 50%, transparent 75%)",
    };

    return (
        <div
            ref={ref}
            className={twMerge(baseClasses, className)}
            style={style}
            {...props}
        >
            <div 
                className="absolute inset-0 pointer-events-none"
                style={dotPattern}
                aria-hidden="true"
            />
            {children}
        </div>
    );
});

DottedGrid.displayName = "DottedGrid";

export default DottedGrid
