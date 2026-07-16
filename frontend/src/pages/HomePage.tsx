import { useState, useRef, DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

type Phase = "idle" | "cloning" | "parsing" | "done" | "error";

export default function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function pollUntilReady(repoId: string) {
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getStatus(repoId);
        if (s.progress) setProgress(s.progress);
        if (s.status === "ready") {
          clearInterval(pollRef.current!);
          navigate(`/graph/${repoId}`);
        } else if (s.status === "error") {
          clearInterval(pollRef.current!);
          setError(s.detail ?? "Parse failed.");
          setPhase("error");
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 2000);
  }

  async function startIngest(repoId: string) {
    setPhase("parsing");
    setProgress("Starting…");
    await api.startParse(repoId);
    await pollUntilReady(repoId);
  }

  async function handleImport() {
    if (!url.trim()) return;
    setError("");
    setPhase("cloning");
    try {
      const repo = await api.cloneRepo(url.trim());
      await startIngest(repo.repo_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Clone failed.");
      setPhase("error");
    }
  }

  async function handleFile(file: File) {
    if (!file.name.endsWith(".zip")) {
      setError("Only .zip files are accepted.");
      return;
    }
    setError("");
    setPhase("cloning");
    try {
      const repo = await api.uploadZip(file);
      await startIngest(repo.repo_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setPhase("error");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const busy = phase === "cloning" || phase === "parsing";

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold text-white mb-2">
        Repo<span className="text-blue-400">Graph</span>
      </h1>
      <p className="text-gray-400 text-sm mb-10">
        Transform any codebase into an interactive knowledge graph.
      </p>

      {busy && (
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 text-blue-400">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm">
              {phase === "cloning" ? "Cloning repository…" : `Parsing… ${progress}`}
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-6 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-4 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-2xl">
        {/* GitHub panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-200 mb-1">GitHub Repository</h2>
          <p className="text-xs text-gray-500 mb-4">Public repos only — shallow clone</p>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleImport()}
            placeholder="https://github.com/owner/repo"
            disabled={busy}
            className="w-full bg-gray-800 text-gray-200 text-sm rounded px-3 py-2 border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500 mb-3 disabled:opacity-50"
          />
          <button
            onClick={handleImport}
            disabled={busy || !url.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white text-sm font-medium rounded px-4 py-2 transition-colors"
          >
            Import
          </button>
        </div>

        {/* ZIP panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-gray-200 mb-1">ZIP Archive</h2>
          <p className="text-xs text-gray-500 mb-4">Private repos, local projects, offline demos</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !busy && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg h-24 flex flex-col items-center justify-center cursor-pointer transition-colors ${
              dragging ? "border-blue-500 bg-blue-900/20" : "border-gray-700 hover:border-gray-500"
            } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <p className="text-sm text-gray-400">Drag ZIP here</p>
            <p className="text-xs text-gray-600 mt-1">or click to browse</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      </div>
    </div>
  );
}
