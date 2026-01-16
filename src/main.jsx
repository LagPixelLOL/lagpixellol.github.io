import {StrictMode, Component} from "react"
import {createRoot} from "react-dom/client"
import "./index.css"

window.onerror = (message, source, lineno, colno, error) => {
    console.error("=== WINDOW ERROR ===");
    console.error("Message:", message);
    console.error("Source:", source);
    console.error("Line:", lineno, "Col:", colno);
    console.error("Error:", error);
    console.error("====================");
};

window.addEventListener("unhandledrejection", (event) => {
    console.error("=== UNHANDLED PROMISE ===");
    console.error("Reason:", event.reason);
    console.error("=========================");
});

class ErrorBoundary extends Component {
    state = {hasError: false};

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    componentDidCatch(error, errorInfo) {
        console.error("=== REACT ERROR ===");
        console.error("Error:", error);
        console.error("Stack:", error.stack);
        console.error("Component Stack:", errorInfo.componentStack);
        console.error("===================");
    }

    render() {
        return this.props.children;
    }
}

import("./App.jsx")
    .then(({default: App}) => {
        createRoot(document.getElementById("root")).render(
            <StrictMode>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
            </StrictMode>
        );
    })
    .catch((error) => {
        console.error("=== IMPORT ERROR ===");
        console.error("Error:", error);
        console.error("Stack:", error.stack);
        console.error("====================");
    });
