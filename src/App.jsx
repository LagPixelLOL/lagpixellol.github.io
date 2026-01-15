import SimpleBar from "simplebar-react"
import {useState, useEffect} from "react"
import boykisserImg from "./assets/boykisser.avif"
import DottedGrid from "./components/DottedGrid.jsx"
import SineCircle from "./components/SineCircle.jsx"
import PSIconsOverlay from "./components/PSIconsOverlay.jsx"

export default function App() {
    return (
        <DottedGrid className="w-dvw h-dvh">
            <PSIconsOverlay/>
            <div className={`
                flex flex-col justify-start items-center absolute z-69420 top-0 left-0 w-10 h-[50vh] ml-5
                border rounded-b-full border-transparent outline outline-offset-2 outline-[rgba(255,_255,_255,_0.75)]
                bg-[rgba(255,_255,_255,_0.5)] hover:bg-[rgba(255,_255,_255,_0.6)] transition-colors duration-50
            `}>
                <div className="flex mt-auto w-full justify-center items-center px-[3px] pb-[3.25px]">
                    <SineCircle color="#000000" className="overflow-visible"/>
                </div>
            </div>
            <SimpleBar autoHide={false} className="w-full h-full overflow-x-hidden simplebar-thin-white">
                <div className="h-[300dvh]"></div>
            </SimpleBar>
        </DottedGrid>
    );
}
