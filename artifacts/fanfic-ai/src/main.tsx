import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { registerSW } from "virtual:pwa-register";
import { initSentry } from "./lib/sentry";

initSentry();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById("root")!).render(<App />);
