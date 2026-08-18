import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/recursive/full.css";
import App from "./App";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
