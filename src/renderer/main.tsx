import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, readStoredTheme } from "../shared/theme";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
// Bundled so Windows/Linux render the same Latin text as macOS instead of thin Segoe UI.
import "@fontsource-variable/inter/wght.css";
import "./styles.css";

applyTheme(readStoredTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
