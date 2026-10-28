import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
function App() {
  const [json, setJson] = React.useState('{"invoice":{"amount":125,"currency":"EUR"}}');
  const [result, setResult] = React.useState("");
  async function analyze() {
    try {
      const response = await fetch("/api/analyze/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
      if (!response.ok) throw new Error("HTTP " + response.status);
      setResult(JSON.stringify(await response.json(), null, 2));
    } catch (error) { setResult(String(error)); }
  }
  return <main><header><span className="badge">NEXUS / v0.1</span><h1>Integration Workspace</h1><p>Analyze structured data with the same engine exposed through MCP.</p></header><section><label htmlFor="json">JSON input</label><textarea id="json" value={json} onChange={e => setJson(e.target.value)} /><button onClick={analyze}>Analyze structure →</button></section><section><h2>Analysis</h2><pre>{result || "Results will appear here."}</pre></section></main>;
}
createRoot(document.getElementById("root")!).render(<App />);
