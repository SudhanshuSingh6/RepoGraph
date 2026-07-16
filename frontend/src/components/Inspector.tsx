import { RefObject, useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { api, DependenciesResponse, MentionedNode, SourceResult } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";
import { CyGraph } from "../api/client";
import DependencyPanel from "./DependencyPanel";

const TYPE_COLORS: Record<string, string> = {
  Package: "bg-blue-600", File: "bg-slate-600", Class: "bg-green-600",
  Interface: "bg-teal-600", Enum: "bg-yellow-600", Method: "bg-purple-600",
  RestEndpoint: "bg-orange-600", ExternalLib: "bg-gray-600",
};

interface NodeData {
  id: string;
  label: string;
  type: string;
  file_path?: string;
  complexity?: number;
  lines?: number;
  repo_id?: string;
  [key: string]: unknown;
}

interface Props {
  nodeId: string | null;
  canvasRef: RefObject<GraphCanvasHandle | null>;
  onClose: () => void;
}

type AITool = "explain" | "summarize" | "impact";

const AI_BUTTONS: { tool: AITool; label: string }[] = [
  { tool: "explain",   label: "Explain" },
  { tool: "summarize", label: "Summarize" },
  { tool: "impact",    label: "Show Impact" },
];

export default function Inspector({ nodeId, canvasRef, onClose }: Props) {
  const [node, setNode] = useState<NodeData | null>(null);
  const [source, setSource] = useState<SourceResult | null>(null);
  const [deps, setDeps] = useState<DependenciesResponse | null>(null);
  const [expanding, setExpanding] = useState(false);

  const [activeTool, setActiveTool] = useState<AITool | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiNodes, setAiNodes] = useState<MentionedNode[]>([]);
  const [aiCitations, setAiCitations] = useState<string[]>([]);

  useEffect(() => {
    setNode(null);
    setSource(null);
    setDeps(null);
    setActiveTool(null);
    setAiText("");
    setAiError("");
    setAiNodes([]);
    setAiCitations([]);

    if (!nodeId) return;

    api.getNode(nodeId).then((n) => setNode(n.data as NodeData)).catch(() => {});
    api.getNodeSource(nodeId).then(setSource).catch(() => {});
    api.getDependencies(nodeId).then(setDeps).catch(() => {});
  }, [nodeId]);

  const fanIn  = deps?.used_by.length ?? 0;
  const fanOut = deps?.depends_on.length ?? 0;

  async function handleExpand() {
    if (!nodeId) return;
    setExpanding(true);
    try {
      const graph: CyGraph = await api.getNeighbours(nodeId);
      canvasRef.current?.addElements(graph);
    } finally {
      setExpanding(false);
    }
  }

  function runAiTool(tool: AITool) {
    if (!nodeId || aiStreaming) return;
    setActiveTool(tool);
    setAiText("");
    setAiError("");
    setAiNodes([]);
    setAiCitations([]);
    setAiStreaming(true);

    const streamFn =
      tool === "explain" ? api.streamExplain :
      tool === "summarize" ? api.streamSummarize :
      api.streamImpact;

    streamFn(nodeId, {
      onDelta: (t) => setAiText((prev) => prev + t),
      onDone: ({ nodes, citations }) => {
        setAiStreaming(false);
        setAiNodes(nodes);
        setAiCitations(citations);
      },
      onError: (msg) => {
        setAiStreaming(false);
        setAiError(msg);
      },
    });
  }

  // name → id map from the nodes the backend matched in the response
  const nameToId = Object.fromEntries(aiNodes.map((n) => [n.name, n.id]));

  const open = nodeId !== null;

  return (
    <div
      className={`absolute inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-800 flex flex-col transition-transform duration-300 z-10 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {!node ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Loading…
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between px-4 py-3 border-b border-gray-800">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded font-medium text-white ${TYPE_COLORS[node.type] ?? "bg-gray-600"}`}>
                  {node.type}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-white truncate">{node.label}</h3>
              {node.file_path && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{node.file_path as string}</p>
              )}
            </div>
            <div className="flex items-center gap-2 ml-2">
              {nodeId && (
                <button
                  onClick={() => canvasRef.current?.flashNode(nodeId)}
                  title="Jump to node in graph"
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  ↗
                </button>
              )}
              <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
            </div>
          </div>

          {/* Metrics */}
          {(node.complexity != null || node.lines != null) && (
            <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-gray-800">
              {[
                { label: "Complexity", value: node.complexity },
                { label: "LOC",        value: node.lines },
                { label: "Fan-in",     value: fanIn },
                { label: "Fan-out",    value: fanOut },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-800 rounded p-2">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-semibold text-white">{value ?? "—"}</p>
                </div>
              ))}
            </div>
          )}

          {/* Source */}
          {source && (
            <div className="border-b border-gray-800" style={{ height: 160 }}>
              <Editor
                height="100%"
                language={source.language}
                value={source.source}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 11,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  theme: "vs-dark",
                }}
                theme="vs-dark"
              />
            </div>
          )}

          {/* Scrollable: dependencies + AI response */}
          <div className="flex-1 overflow-y-auto py-2">
            {deps ? (
              <DependencyPanel data={deps} canvasRef={canvasRef} />
            ) : (
              <p className="text-xs text-gray-600 px-4 py-2">Loading dependencies…</p>
            )}

            {(aiText || aiError) && (
              <div className="mx-3 mt-3 px-3 py-2 border border-gray-700 rounded-lg bg-gray-950 text-xs">
                {aiError ? (
                  <p className="text-red-400">{aiError}</p>
                ) : (
                  <>
                    <div className="prose-invert text-gray-300 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1">
                      <ReactMarkdown
                        components={{
                          strong: ({ children }) => {
                            const name = String(children);
                            const id = nameToId[name];
                            return id ? (
                              <button
                                onClick={() => canvasRef.current?.flashNode(id)}
                                className="text-blue-400 underline font-semibold"
                              >
                                {name}
                              </button>
                            ) : (
                              <strong className="text-white">{children}</strong>
                            );
                          },
                        }}
                      >
                        {aiText}
                      </ReactMarkdown>
                    </div>
                    {aiStreaming && <span className="text-gray-500 animate-pulse">▍</span>}

                    {aiCitations.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-800">
                        <p className="text-gray-500 font-semibold mb-1">Sources</p>
                        {aiCitations.map((f) => (
                          <p key={f} className="text-gray-400 truncate">{f}</p>
                        ))}
                      </div>
                    )}

                    {aiNodes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {aiNodes.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => canvasRef.current?.flashNode(n.id)}
                            className="text-xs text-blue-400 bg-blue-900/30 border border-blue-800 rounded px-1.5 py-0.5 hover:bg-blue-900/60"
                          >
                            ↗ {n.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* AI buttons */}
          <div className="px-3 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-2">AI</p>
            <div className="flex gap-2">
              {AI_BUTTONS.map(({ tool, label }) => (
                <button
                  key={tool}
                  onClick={() => runAiTool(tool)}
                  disabled={aiStreaming}
                  className={`flex-1 text-xs rounded py-1.5 border transition-colors ${
                    activeTool === tool && aiStreaming
                      ? "bg-indigo-900 text-indigo-300 border-indigo-700"
                      : "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 disabled:opacity-50"
                  }`}
                >
                  {activeTool === tool && aiStreaming ? "…" : label}
                </button>
              ))}
            </div>
          </div>

          {/* Expand button */}
          <div className="px-3 pb-3">
            <button
              onClick={handleExpand}
              disabled={expanding}
              className="w-full text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white rounded px-3 py-2 transition-colors"
            >
              {expanding ? "Expanding…" : "Expand Neighbours"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
