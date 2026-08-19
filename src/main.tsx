import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeAnalytics } from "./lib/analytics";
import "./styles/fonts.css";
import "./styles/app.css";

initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
