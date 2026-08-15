import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Bundled so Windows/Linux render the same Latin text as macOS instead of thin Segoe UI.
import "@fontsource-variable/inter/wght.css";
import "./styles.css";

if (window.harness.platform === "darwin") {
  document.documentElement.classList.add("platform-darwin");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
