import { RefObject, useRef, useState } from "react";
import { api, HeatmapNode, SearchResult } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";
import { ARCH_LAYER_LIST, NODE_TYPE_COLORS } from "../lib/nodeIcons";

const NODE_TYPES = [
  "Package", "File", "Class", "Interface",
  "Enum", "Method", "RestEndpoint", "ExternalLib",
];

const EDGE_TYPES = ["CONTAINS", "CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS"];

const EDGE_COLORS: Record<string, string> = {
  CONTAINS: "#94A3B8", CALLS: "#3B82F6",
  IMPORTS: "#22C55E", EXTENDS: "#F97316", IMPLEMENTS: "#A855F7",
};

const HEATMAP_LEGEND = [
  { label: "Low (1–3)",    color: "#22C55E" },
  { label: "Medium (4–7)", color: "#EAB308" },
  { label: "High (8–12)",  color: "#F97316" },
  { label: "Critical 13+", color: "#EF4444" },
];

const SEARCH_TYPE_COLORS: Record<string, string> = {
  Package: "bg-blue-600", File: "bg-slate-600", Class: "bg-green-600",
  Interface: "bg-teal-600", Enum: "bg-yellow-600", Method: "bg-purple-600",
  RestEndpoint: "bg-orange-600", ExternalLib: "bg-gray-600",
};

interface Props {
  repoId: string;
  canvasRef: RefObject<GraphCanvasHandle | null>;
  onCyclesOpen: () => void;
  onEndpointsOpen: () => void;
}

export default function Sidebar({ repoId, canvasRef, onCyclesOpen, onEndpointsOpen }: Props) {
  const [nodeVisible, setNodeVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(NODE_TYPES.map((t) => [t, true]))
  );
  const [edgeVisible, setEdgeVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(EDGE_TYPES.map((t) => [t, t === "CONTAINS"]))
  );
  const [roleVisible, setRoleVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(ARCH_LAYER_LIST.map(({ role }) => [role, true]))
  );
  const [heatmapActive, setHeatmapActive] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchInput(q: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 3) {
      setSearchResults([]);
      canvasRef.current?.clearHighlights();
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const { results } = await api.searchNodes(repoId, q.trim());
        setSearchResults(results.slice(0, 5));
        canvasRef.current?.clearHighlights();
        canvasRef.current?.highlightNodes(results.map((r) => r.id), "#8B5CF6");
      } catch {
        setSearchResults([]);
      }
    }, 500);
  }

  function toggleNode(type: string) {
    const next = !nodeVisible[type];
    setNodeVisible((p) => ({ ...p, [type]: next }));
    if (next) canvasRef.current?.showType(type);
    else canvasRef.current?.hideType(type);
  }

  function toggleRole(role: string) {
    const next = !roleVisible[role];
    setRoleVisible((p) => ({ ...p, [role]: next }));
    if (next) canvasRef.current?.showRole(role);
    else canvasRef.current?.hideRole(role);
  }

  function toggleEdge(type: string) {
    const next = !edgeVisible[type];
    setEdgeVisible((p) => ({ ...p, [type]: next }));
    canvasRef.current?.toggleEdgeType(type, next);
  }

  async function toggleHeatmap() {
    if (heatmapActive) {
      canvasRef.current?.disableHeatmap();
      setHeatmapActive(false);
      return;
    }
    setHeatmapLoading(true);
    try {
      const { nodes } = await api.getHeatmap(repoId);
      canvasRef.current?.enableHeatmap(nodes as HeatmapNode[]);
      setHeatmapActive(true);
    } finally {
      setHeatmapLoading(false);
    }
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-200">RepoGraph</h2>
      </div>

      {/* Semantic search */}
      <div className="px-3 py-3 border-b border-gray-800">
        <input
          type="text"
          placeholder="Search by meaning…"
          onChange={(e) => handleSearchInput(e.target.value)}
          className="w-full bg-gray-800 text-gray-200 text-sm rounded px-3 py-1.5 border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-500"
        />
        {searchResults.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {searchResults.map((r) => (
              <div
                key={r.id}
                onClick={() => canvasRef.current?.flashNode(r.id)}
                className="px-2 py-1.5 rounded hover:bg-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded text-white flex-shrink-0 ${SEARCH_TYPE_COLORS[r.type] ?? "bg-gray-600"}`}>
                    {r.type}
                  </span>
                  <span className="text-xs text-white truncate">{r.name}</span>
                  <span className="text-xs text-gray-500 ml-auto flex-shrink-0">
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{r.preview}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Node types */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Node Types</p>
        {NODE_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-2 py-0.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={nodeVisible[t]}
              onChange={() => toggleNode(t)}
              className="accent-blue-500"
            />
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: NODE_TYPE_COLORS[t] }} />
            <span className="text-sm text-gray-300 group-hover:text-white">{t}</span>
          </label>
        ))}
      </div>

      {/* Architecture roles */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Architecture</p>
        {ARCH_LAYER_LIST.map(({ role, color, icon }) => (
          <label key={role} className="flex items-center gap-2 py-0.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={roleVisible[role]}
              onChange={() => toggleRole(role)}
              className="accent-blue-500"
            />
            <span className="flex items-center justify-center w-4 h-4 rounded flex-shrink-0" style={{ background: color }}>
              <img src={icon} className="w-2.5 h-2.5" alt="" />
            </span>
            <span className="text-sm text-gray-300 group-hover:text-white">{role}</span>
          </label>
        ))}
      </div>

      {/* Edge types */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Edge Types</p>
        {EDGE_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-2 py-0.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={edgeVisible[t]}
              onChange={() => toggleEdge(t)}
              className="accent-blue-500"
            />
            <span className="h-0.5 w-5 flex-shrink-0 rounded" style={{ background: EDGE_COLORS[t] }} />
            <span className="text-sm text-gray-300 group-hover:text-white">{t}</span>
          </label>
        ))}
      </div>

      {/* Heatmap */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Heatmap</p>
        <label className="flex items-center gap-2 py-0.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={heatmapActive}
            onChange={toggleHeatmap}
            disabled={heatmapLoading}
            className="accent-orange-500"
          />
          <span className="text-sm text-gray-300 group-hover:text-white">
            {heatmapLoading ? "Loading…" : "Complexity Heatmap"}
          </span>
        </label>
        {heatmapActive && (
          <div className="mt-2 space-y-1">
            {HEATMAP_LEGEND.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
                <span className="text-xs text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analysis */}
      <div className="px-3 py-3 border-b border-gray-800">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Analysis</p>
        <button
          onClick={onCyclesOpen}
          className="w-full text-sm text-left bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 border border-gray-700 transition-colors mb-2"
        >
          ⟲ Detect Cycles
        </button>
        <button
          onClick={onEndpointsOpen}
          className="w-full text-sm text-left bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 border border-gray-700 transition-colors"
        >
          ⚡ API Endpoints
        </button>
      </div>

      {/* Reset */}
      <div className="px-3 py-3 mt-auto">
        <button
          onClick={() => canvasRef.current?.fit()}
          className="w-full text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 border border-gray-700 transition-colors"
        >
          Reset View
        </button>
      </div>
    </aside>
  );
}
