import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Missing root element with id='app'.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
