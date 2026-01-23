import SimpleBar from "simplebar-react"
import {useState, useRef, useEffect} from "react"
import DottedGrid from "./components/DottedGrid.jsx"
import SineCircle from "./components/SineCircle.jsx"
import PerlinNoise from "./components/PerlinNoise.jsx"
import BigCharacter from "./components/BigCharacter.jsx"
import foxboyRainbowImg from "./assets/foxboy_rainbow.avif"
import PSIconsOverlay from "./components/PSIconsOverlay.jsx"

export default function App() {
    const [isHoveredList, setIsHoveredList] = useState(Array(5).fill(false));
    const [gridMarginTop, setGridMarginTop] = useState(0);
    const sidebarHoveredColors = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#84cc16"];

    const simpleBarRef = useRef(null);
    const gridRef = useRef(null);

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

    const textWrapperStyle = "flex items-center bg-white/8 backdrop-blur-[5px] px-[3cqw] py-[2cqw] outline outline-offset-3 outline-white/50 rounded-[8cqw]";
    const textStyle = "text-[4.5cqw]";

    return (
        <DottedGrid className="w-dvw h-dvh">
            <PSIconsOverlay/>
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
                                Discord: <a href="https://discord.gg/r4Wj97nZ" target="_blank"><span className="link-text">@v2ray</span></a>
                            </p>
                        </div>
                        <div className={textWrapperStyle}>
                            <p className={textStyle}>Lead of Project Looking Glass, operator of Straylight, searching for Rainbows in Starlights.</p>
                        </div>
                        <BigCharacter bgImageStyle={`linear-gradient(in oklab, ${sidebarHoveredColors[0]}, ${sidebarHoveredColors[4]})`}>睿</BigCharacter>
                    </div>
                    <div className="flex justify-center items-center h-[100px] mt-[70px]">
                        <PerlinNoise x={42} y={42} color="#f8f8f8" className="w-full max-w-[100cqh] h-full backdrop-blur-[5px] outline outline-offset-3 outline-white/50 rounded-full"/>
                    </div>
                    <div className="flex justify-center items-center h-[400px] mt-[70px]">
                        <img className="w-full max-w-[133cqh] h-full object-cover outline outline-offset-3 outline-white/50 rounded-[100px]" src={foxboyRainbowImg}/>
                    </div>
                    <div className="flex justify-center items-center h-[100px] mt-[70px]">
                        <PerlinNoise x={23} y={34} color="#f8f8f8" className="w-full max-w-[100cqh] h-full backdrop-blur-[5px] outline outline-offset-3 outline-white/50 rounded-full"/>
                    </div>
                    <footer className="text-center mt-auto pt-[50px] pb-[10px] font-mono">Made with GEX && React && Tailwind</footer>
                </div>
            </SimpleBar>
        </DottedGrid>
    );
}
