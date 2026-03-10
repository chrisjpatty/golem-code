import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

// In overlay mode, make the page background transparent so the OS desktop shows through
if (new URLSearchParams(window.location.search).get("mode") === "overlay") {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.getElementById("root")!.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
