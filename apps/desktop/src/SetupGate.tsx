import { ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./setup.css";

type OllamaStatus = {
  available: boolean;
  models: string[];
  recommendedModel: string;
  error?: string;
};

type BrowserCaptureSetupStatus = {
  supported: boolean;
  prepared: boolean;
  extensionId: string;
  extensionDirectory?: string;
  hostPath?: string;
  bundledResourcesAvailable: boolean;
  message: string;
};

type SetupGateProps = {
  children: ReactNode;
};

const SETUP_COMPLETE_KEY = "topo.desktopSetupComplete";

export function SetupGate({ children }: SetupGateProps) {
  const [complete, setComplete] = useState(
    () => window.localStorage.getItem(SETUP_COMPLETE_KEY) === "true",
  );
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [browser, setBrowser] = useState<BrowserCaptureSetupStatus | null>(null);
  const [browserLoaded, setBrowserLoaded] = useState(false);
  const [busy, setBusy] = useState<"model" | "browser" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      const [nextOllama, nextBrowser] = await Promise.all([
        invoke<OllamaStatus>("ollama_extractor_status"),
        invoke<BrowserCaptureSetupStatus>("browser_capture_setup_status"),
      ]);
      setOllama(nextOllama);
      setBrowser(nextBrowser);
    } catch (cause) {
      setError(String(cause));
    }
  };

  useEffect(() => {
    if (!complete) void refresh();
  }, [complete]);

  const modelReady = Boolean(ollama?.available && ollama.models.length > 0);
  const browserReady = Boolean(
    browser && (!browser.supported || (browser.prepared && browserLoaded)),
  );
  const ready = modelReady && browserReady;

  const progress = useMemo(() => {
    let value = 1;
    if (modelReady) value += 1;
    if (browserReady) value += 1;
    return value;
  }, [modelReady, browserReady]);

  const installModel = async () => {
    setBusy("model");
    setError(null);
    try {
      const next = await invoke<OllamaStatus>("install_recommended_ollama_model");
      setOllama(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };

  const prepareBrowser = async () => {
    setBusy("browser");
    setError(null);
    try {
      const next = await invoke<BrowserCaptureSetupStatus>("prepare_browser_capture");
      setBrowser(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  };

  const finish = () => {
    window.localStorage.setItem(SETUP_COMPLETE_KEY, "true");
    setComplete(true);
  };

  if (complete) return <>{children}</>;

  return (
    <main className="setup-shell">
      <section className="setup-card" aria-labelledby="setup-title">
        <div className="setup-brand">TOPO</div>
        <p className="setup-kicker">First run · {progress}/3 ready</p>
        <h1 id="setup-title">A few clicks, then TOPO can quietly remember what matters.</h1>
        <p className="setup-intro">
          Everything stays local. There are no terminal commands, accounts or developer tools to install.
        </p>

        {error && <div className="setup-error" role="alert">{error}</div>}

        <div className="setup-steps">
          <article className="setup-step is-ready">
            <div className="setup-step-number">1</div>
            <div>
              <strong>TOPO itself</strong>
              <p>Installed and ready. Your memory store is created locally when TOPO starts.</p>
            </div>
            <span className="setup-state">Ready</span>
          </article>

          <article className={`setup-step ${modelReady ? "is-ready" : ""}`}>
            <div className="setup-step-number">2</div>
            <div>
              <strong>Private local extraction</strong>
              {!ollama ? (
                <p>Checking for Ollama…</p>
              ) : !ollama.available ? (
                <p>TOPO uses Ollama locally to turn captured conversations into reviewable memory suggestions.</p>
              ) : ollama.models.length === 0 ? (
                <p>Ollama is ready. Install TOPO’s recommended model once, then extraction stays on this computer.</p>
              ) : (
                <p>{ollama.models.length} local model{ollama.models.length === 1 ? " is" : "s are"} ready.</p>
              )}
            </div>
            <div className="setup-actions">
              {ollama && !ollama.available && (
                <>
                  <button className="setup-primary" type="button" onClick={() => void invoke("open_ollama_download")}>
                    Get Ollama
                  </button>
                  <button className="setup-link" type="button" onClick={() => void refresh()}>
                    Check again
                  </button>
                </>
              )}
              {ollama?.available && ollama.models.length === 0 && (
                <button className="setup-primary" type="button" disabled={busy === "model"} onClick={() => void installModel()}>
                  {busy === "model" ? "Installing local model…" : `Install ${ollama.recommendedModel}`}
                </button>
              )}
              {modelReady && <span className="setup-state">Ready</span>}
            </div>
          </article>

          <article className={`setup-step ${browserReady ? "is-ready" : ""}`}>
            <div className="setup-step-number">3</div>
            <div>
              <strong>Browser capture</strong>
              {!browser ? (
                <p>Checking the bundled browser companion…</p>
              ) : !browser.supported ? (
                <p>Browser capture is not packaged for this operating system yet. You can still use TOPO manually.</p>
              ) : !browser.prepared ? (
                <p>Set up the bundled local bridge for Chrome, Edge or Chromium. TOPO does the operating-system setup for you.</p>
              ) : (
                <>
                  <p>TOPO’s local bridge is prepared. One browser permission step remains.</p>
                  <ol className="browser-steps">
                    <li>Open your browser’s Extensions page and enable Developer mode.</li>
                    <li>Choose <strong>Load unpacked</strong>.</li>
                    <li>Select the TOPO extension folder below.</li>
                  </ol>
                  {browser.extensionDirectory && <code className="setup-path">{browser.extensionDirectory}</code>}
                </>
              )}
            </div>
            <div className="setup-actions">
              {browser?.supported && !browser.prepared && (
                <button className="setup-primary" type="button" disabled={busy === "browser"} onClick={() => void prepareBrowser()}>
                  {busy === "browser" ? "Setting up…" : "Set up browser capture"}
                </button>
              )}
              {browser?.prepared && (
                <>
                  <button className="setup-secondary" type="button" onClick={() => void invoke("open_capture_extension_folder")}>
                    Open extension folder
                  </button>
                  <label className="setup-check">
                    <input type="checkbox" checked={browserLoaded} onChange={(event) => setBrowserLoaded(event.target.checked)} />
                    I loaded the extension
                  </label>
                </>
              )}
              {!browser?.supported && browser !== null && <span className="setup-state">Optional</span>}
              {browserReady && browser?.supported && <span className="setup-state">Ready</span>}
            </div>
          </article>
        </div>

        <div className="setup-footer">
          <button className="setup-link" type="button" onClick={finish}>
            Finish later
          </button>
          <button className="setup-primary setup-finish" type="button" disabled={!ready} onClick={finish}>
            Start using TOPO
          </button>
        </div>
      </section>
    </main>
  );
}
