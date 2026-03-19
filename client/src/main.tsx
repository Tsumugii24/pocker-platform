import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const initAnalytics = () => {
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim().replace(/\/+$/, "");
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim();

  if (!endpoint || !websiteId) {
    return;
  }

  if (document.querySelector('script[data-analytics="umami"]')) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = `${endpoint}/umami`;
  script.dataset.websiteId = websiteId;
  script.dataset.analytics = "umami";
  document.head.appendChild(script);
};

initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
