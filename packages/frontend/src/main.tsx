import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SnapshotApp } from "./SnapshotApp";
import { ErrorBoundary } from "./ErrorBoundary";

const urlMode = new URLSearchParams(window.location.search).get("mode");

// In overlay/snapshot mode, make the page background transparent
if (urlMode === "overlay" || urlMode === "snapshot") {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.getElementById("root")!.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {urlMode === "snapshot" ? <SnapshotApp /> : <App />}
  </ErrorBoundary>
);
