import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function App() {
  const [contractVersion, setContractVersion] = useState<string>("local");

  useEffect(() => {
    void invoke<string>("domain_contract_version")
      .then(setContractVersion)
      .catch(() => setContractVersion("browser-preview"));
  }, []);

  return (
    <main className="shell">
      <p className="eyebrow">TOPO</p>
      <h1>Portable, user-owned context for AI.</h1>
      <p className="lede">
        TOPO keeps durable context local, inspectable and under your control.
        The desktop app will become the canonical local manager; browser,
        CLI and MCP clients connect through the same domain contract.
      </p>
      <section className="status" aria-label="Foundation status">
        <div>
          <span>Domain contract</span>
          <strong>v{contractVersion}</strong>
        </div>
        <div>
          <span>Desktop runtime</span>
          <strong>Tauri + Rust</strong>
        </div>
        <div>
          <span>Canonical store</span>
          <strong>Local SQLite</strong>
        </div>
      </section>
    </main>
  );
}
