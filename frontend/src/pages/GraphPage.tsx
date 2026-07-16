import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, CyGraph } from "../api/client";
import GraphCanvas, { GraphCanvasHandle } from "../components/GraphCanvas";
import Sidebar from "../components/Sidebar";
import Inspector from "../components/Inspector";
import DashboardBar from "../components/DashboardBar";
import CyclesPanel from "../components/CyclesPanel";
import EndpointsPanel from "../components/EndpointsPanel";
import ChatPanel from "../components/ChatPanel";

const EXPAND_ON_CLICK = new Set(["Package", "File", "Class"]);

export default function GraphPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<GraphCanvasHandle | null>(null);

  const [graph, setGraph] = useState<CyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (!repoId) return;
    api.getGraph(repoId)
      .then(setGraph)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [repoId]);

  async function handleNodeClick(nodeId: string, nodeType: string) {
    if (EXPAND_ON_CLICK.has(nodeType)) {
      try {
        const children: CyGraph = await api.getChildren(nodeId);
        canvasRef.current?.addElements(children);
      } catch {
        // ignore
      }
    } else {
      setSelectedNodeId(nodeId);
    }
  }

  function openCycles() {
    setEndpointsOpen(false);
    setCyclesOpen((o) => !o);
  }

  function openEndpoints() {
    setCyclesOpen(false);
    setEndpointsOpen((o) => !o);
  }

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-gray-400 text-sm">Loading graph…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => navigate("/")} className="text-sm text-blue-400 hover:text-blue-300">
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  if (!graph || !repoId) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950">
      <DashboardBar repoId={repoId} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          repoId={repoId}
          canvasRef={canvasRef}
          onCyclesOpen={openCycles}
          onEndpointsOpen={openEndpoints}
        />

        <div className="relative flex-1 overflow-hidden">
          <GraphCanvas
            ref={canvasRef}
            initialGraph={graph}
            onNodeClick={handleNodeClick}
          />

          {/* Analysis panels (left overlay) */}
          {cyclesOpen && repoId && (
            <CyclesPanel
              repoId={repoId}
              canvasRef={canvasRef}
              onClose={() => setCyclesOpen(false)}
            />
          )}
          {endpointsOpen && repoId && (
            <EndpointsPanel
              repoId={repoId}
              canvasRef={canvasRef}
              onClose={() => setEndpointsOpen(false)}
            />
          )}

          <Inspector
            nodeId={selectedNodeId}
            canvasRef={canvasRef}
            onClose={() => setSelectedNodeId(null)}
          />

          {chatOpen && (
            <ChatPanel
              repoId={repoId}
              canvasRef={canvasRef}
              onNodeSelect={(id) => setSelectedNodeId(id)}
              onClose={() => setChatOpen(false)}
            />
          )}

          {/* Ask AI */}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="absolute bottom-36 right-4 z-10 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg transition-colors"
            >
              ✦ Ask AI
            </button>
          )}

          {/* Back button */}
          <button
            onClick={() => navigate("/")}
            className="absolute top-3 left-3 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 border border-gray-700 transition-colors z-10"
          >
            ← Home
          </button>
        </div>
      </div>
    </div>
  );
}
