import {useState} from "react"
import SimpleBar from "simplebar-react"
import boykisserImg from "./assets/boykisser.avif"
import DottedGrid from "./components/DottedGrid.jsx"
import SineCircle from "./components/SineCircle.jsx"
import PerlinNoise from "./components/PerlinNoise.jsx"
import PSIconsOverlay from "./components/PSIconsOverlay.jsx"

export default function App() {
    const [isHoveredList, setIsHoveredList] = useState(Array(5).fill(false));
    const sidebarHoverColors = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#84cc16"];
    const sidebarTextNudges = [2, 2, 0, 2, 2];

    return (
        <DottedGrid className="w-dvw h-dvh">
            <PSIconsOverlay/>
            <div className={`
                flex flex-col justify-start items-center absolute z-69420 top-0 left-0 w-[40px] h-[50vh] ml-[20px] pt-[8px] overflow-hidden
                border rounded-b-full border-transparent outline outline-offset-2 outline-[rgba(255,_255,_255,_0.75)]
                bg-[rgba(255,_255,_255,_0.6)] hover:bg-[rgba(255,_255,_255,_0.7)] transition-colors duration-50
            `}>
                {"V2RAY".split("").map((c, i) => (
                    <div
                        key={i}
                        style={{color: isHoveredList[i] ? sidebarHoverColors[i] : "black"}}
                        className="flex justify-center items-center w-full duration-50"
                        onMouseEnter={() => setIsHoveredList(prev => prev.map((isHovered, index) => index === i ? true : isHovered))}
                        onMouseLeave={() => setIsHoveredList(prev => prev.map((isHovered, index) => index === i ? false : isHovered))}
                    >
                        <div
                            style={{transform: `translateX(${sidebarTextNudges[i]}px)`}}
                            className="flex justify-center items-center h-[45px] font-pixel text-[70px] [-webkit-text-stroke:0.7px_white] text-shadow-none select-none pointer-events-none"
                        >
                            {c}
                        </div>
                    </div>
                ))}
                <div className="flex mt-auto w-full justify-center items-center px-[3px] pb-[3.25px]">
                    <SineCircle color="#000000"/>
                </div>
            </div>
            <SimpleBar autoHide={false} className="w-full h-full overflow-x-hidden simplebar-thin-white">
                <div className="h-[300dvh] mx-[80px] mt-[40px]">
                    <PerlinNoise color="#00ff00" x={42} y={42} className="mx-[25%] mt-[20vh] w-[50%] h-[25vh] border rounded-[50px]" forceMode="webgpu">aaaaaaaaaaaaaasdf webgpu</PerlinNoise>
                    <PerlinNoise color="#00ffff" x={42} y={42} className="mx-[35%] mt-[3vh] w-[30%] h-[10vh] border rounded-[50px]" forceMode="webgl">aaaaaaaaaaaaaasdf webgl</PerlinNoise>
                </div>
            </SimpleBar>
        </DottedGrid>
    );
}
