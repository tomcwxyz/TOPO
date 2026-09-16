import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CaptureExtractionQueue } from "./CaptureExtractionQueue";
import { SetupGate } from "./SetupGate";
import "./styles.css";
import "./memory-pages.css";
import "./topo-brand.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SetupGate>
      <>
        <App />
        <CaptureExtractionQueue />
      </>
    </SetupGate>
  </React.StrictMode>,
);
