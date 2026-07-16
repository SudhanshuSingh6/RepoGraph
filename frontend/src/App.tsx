import { useEffect, useState } from "react";

type HealthStatus = "checking" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setStatus(d.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center gap-4">
      <h1 className="text-5xl font-bold tracking-tight">
        Repo<span className="text-blue-400">Graph</span>
      </h1>
      <p className="text-gray-400 text-lg">
        Transform any codebase into an interactive knowledge graph.
      </p>
      <div className="mt-4 flex items-center gap-2 text-sm">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            status === "ok"
              ? "bg-green-400"
              : status === "error"
                ? "bg-red-400"
                : "bg-yellow-400 animate-pulse"
          }`}
        />
        <span className="text-gray-400">
          {status === "checking"
            ? "Connecting to backend..."
            : status === "ok"
              ? "Backend connected"
              : "Backend unreachable"}
        </span>
      </div>
    </div>
  );
}
