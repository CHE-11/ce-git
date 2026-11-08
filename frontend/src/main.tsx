import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance, readAppearance } from "./lib/appearance";
import { installDevConsole } from "./lib/dev-feedback";
import { applyZoom, readZoom } from "./lib/zoom";
import { HomePage } from "./pages/Home.page";
import "./index.css";

if (import.meta.env.DEV) {
  installDevConsole();
}

const appearance = readAppearance();
applyAppearance(appearance.theme, appearance.colorMode);
applyZoom(readZoom());

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
);
