import {twMerge} from "tailwind-merge"
import SimpleBar from "simplebar-react"
import {useState, useRef, useEffect} from "react"
import Marquee3D from "./components/Marquee3D.jsx"
import SineCircle from "./components/SineCircle.jsx"
import PerlinNoise from "./components/PerlinNoise.jsx"
import BigCharacter from "./components/BigCharacter.jsx"
import quicksandBoldFont from "./assets/fonts/Quicksand-Bold.ttf"
import foxboyRainbowImg from "./assets/images/foxboy_rainbow.avif"

export default function App() {
    const [isHoveredList, setIsHoveredList] = useState(Array(5).fill(false));
    const [isPortrait, setIsPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);
    const [gridMarginTop, setGridMarginTop] = useState(0);
    const sidebarHoveredColors = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#84cc16"];

    const simpleBarRef = useRef(null);
    const gridRef = useRef(null);

    useEffect(() => {
        const mql = window.matchMedia("(orientation: portrait)");
        const onChange = (event) => setIsPortrait(event.matches);
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, []);

    useEffect(() => {
        const calculateMarginTop = () => {
            const simpleBarEl = simpleBarRef.current?.el;
            const gridEl = gridRef.current;

            if (!simpleBarEl || !gridEl) return;

            const containerHeight = simpleBarEl.clientHeight;
            const gridHeight = gridEl.offsetHeight;

            const marginTop = Math.max(0, (containerHeight - gridHeight) / 2);
            setGridMarginTop(marginTop);
        };

        calculateMarginTop();

        const resizeObserver = new ResizeObserver(calculateMarginTop);

        if (simpleBarRef.current?.el) {
            resizeObserver.observe(simpleBarRef.current.el);
        }
        if (gridRef.current) {
            resizeObserver.observe(gridRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    const textWrapperStyle = "flex items-center bg-[#2a2a2a]/50 backdrop-blur-[5px] px-[3cqw] py-[2cqw] outline outline-offset-3 outline-white/50 rounded-[8cqw]";
    const textStyle = "text-[4.5cqw] font-content";

    const blockWrapperCommonStyle = "flex justify-center items-center mt-[70px]";
    const blockCommonProps = {
        scale: 1.5,
        color: "#f8f8f8",
        className: "w-full max-w-[100cqh] h-full backdrop-blur-[5px] outline outline-offset-3 outline-white/50 rounded-full",
    };

    return (
        <Marquee3D
            className="w-dvw h-dvh"
            text="v2ray"
            fontUrl={quicksandBoldFont}
            columns={isPortrait}
            count={6}
            textSpacing={0.5}
            lineSpacing={0.25}
            speed={0.003}
            stagger={0.33}
            outlineWidth={0.01}
            outlineColor="#505050"
            filled={0.1}
            depth={0.075}
            angle={0}
            faceColor="#f8f8f8"
            sideColor="#000000"
            shadow={false}
            gradient={true}
            gradientColor="#f81414"
            gradientRepeat={0.33}
            gradientSpeed={0.5}
            gradientInvert={false}
            background="#0e0e0e"
        >
            <div className={`
                flex flex-col justify-start items-center absolute z-69420 top-0 left-0 w-[40px] h-[50vh] ml-[20px] pt-[8px]
                border rounded-b-full border-transparent outline outline-offset-2 outline-white/75
                bg-white/16 backdrop-blur-[5px]
            `}>
                {"V2RAY".split("").map((c, i) => (
                    <div
                        key={i}
                        style={{color: isHoveredList[i] ? sidebarHoveredColors[i] : "transparent"}}
                        className="flex justify-center items-center w-full transition-colors duration-50"
                        onMouseEnter={() => setIsHoveredList(prev => prev.map((isHovered, index) => index === i ? true : isHovered))}
                        onMouseLeave={() => setIsHoveredList(prev => prev.map((isHovered, index) => index === i ? false : isHovered))}
                    >
                        <div className="flex justify-center items-center h-[45px] font-pixel-s text-[50px] [-webkit-text-stroke:0.7px_white] text-shadow-none select-none pointer-events-none translate-x-[3px]">
                            {c}
                        </div>
                    </div>
                ))}
                <div className="flex mt-auto w-full justify-center items-center px-[3px] pb-[3.25px]">
                    <SineCircle color="#eaeaea"/>
                </div>
            </div>
            <SimpleBar ref={simpleBarRef} autoHide={false} className="w-full h-full overflow-x-hidden simplebar-thin-white @container">
                <div className="ml-[80px] mr-[20px] @3xl:mr-[80px]">
                    <div
                        ref={gridRef}
                        style={{marginTop: gridMarginTop}}
                        className="grid grid-cols-2 w-full max-w-[50cqh] mx-auto [&>*]:aspect-square [&>*]:break-words @container"
                    >
                        <div className={textWrapperStyle}>
                            <p className={textStyle}>My username is typically v2ray, also known as LagPixelLOL.</p>
                        </div>
                        <BigCharacter bgImageStyle={`linear-gradient(in oklab, ${sidebarHoveredColors[1]}, ${sidebarHoveredColors[2]})`}>魏</BigCharacter>
                        <BigCharacter bgImageStyle={`linear-gradient(in oklab, ${sidebarHoveredColors[2]}, ${sidebarHoveredColors[0]})`}>爾</BigCharacter>
                        <div className={textWrapperStyle}>
                            <p className={textStyle}>
                                GitHub: <a href="https://github.com/LagPixelLOL" target="_blank"><span className="link-text">LagPixelLOL</span></a><br/><br/>
                                HuggingFace: <a href="https://huggingface.co/v2ray" target="_blank"><span className="link-text">v2ray</span></a><br/><br/>
                                Discord: <span className="link-text">@v2rayn</span>
                            </p>
                        </div>
                        <div className={textWrapperStyle}>
                            <p className={textStyle}>Lead of Project Looking Glass, operator of Straylight, searching for Rainbows in Starlights.</p>
                        </div>
                        <BigCharacter bgImageStyle={`linear-gradient(in oklab, ${sidebarHoveredColors[0]}, ${sidebarHoveredColors[4]})`}>睿</BigCharacter>
                    </div>
                    <div className={twMerge(blockWrapperCommonStyle, "h-[100px]")}>
                        <PerlinNoise x={42} y={42} {...blockCommonProps}/>
                    </div>
                    <div className={twMerge(blockWrapperCommonStyle, "h-[400px]")}>
                        <img className="w-full max-w-[133cqh] h-full object-cover outline outline-offset-3 outline-white/50 rounded-[100px]" src={foxboyRainbowImg}/>
                    </div>
                    <div className={twMerge(blockWrapperCommonStyle, "h-[100px]")}>
                        <PerlinNoise x={23} y={34} {...blockCommonProps}/>
                    </div>
                    <footer className="text-center mt-auto pt-[50px] pb-[10px] font-mono">Made with GEX && React && Tailwind</footer>
                </div>
            </SimpleBar>
        </Marquee3D>
    );
}
