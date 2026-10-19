import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance, readAppearance } from "./lib/appearance";
import { applyZoom, readZoom } from "./lib/zoom";
import { HomePage } from "./pages/Home.page";
import "./index.css";

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
