import React from "react";
import ReactDOM from "react-dom/client";
import { CalmApp } from "./CalmApp";
import { SetupGate } from "./SetupGate";
import { TopoTerrainBridge } from "./TopoVisuals";
import "./styles.css";
import "./memory-pages.css";
import "./topo-brand.css";
import "./topo-primitives.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <SetupGate>
        <CalmApp />
      </SetupGate>
      <TopoTerrainBridge />
    </>
  </React.StrictMode>,
);
