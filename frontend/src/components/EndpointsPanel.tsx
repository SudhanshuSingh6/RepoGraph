import { RefObject, useEffect, useState } from "react";
import { api, EndpointItem, EndpointsResponse } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";

const VERB_COLORS: Record<string, string> = {
  GET:    "bg-blue-700",
  POST:   "bg-green-700",
  PUT:    "bg-yellow-700",
  PATCH:  "bg-orange-700",
  DELETE: "bg-red-700",
};

interface Props {
  repoId: string;
  canvasRef: RefObject<GraphCanvasHandle | null>;
  onClose: () => void;
}

export default function EndpointsPanel({ repoId, canvasRef, onClose }: Props) {
  const [data, setData] = useState<EndpointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getEndpoints(repoId)
      .then(setData)
      .catch(() => setData({ endpoints: [] }))
      .finally(() => setLoading(false));
  }, [repoId]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function highlightChain(ep: EndpointItem) {
    const ids = ep.call_chain.map((s) => s.id).filter(Boolean);
    if (ep.handler?.id) ids.unshift(ep.handler.id);
    canvasRef.current?.highlightNodes(ids, "#3B82F6");
    if (ids[0]) canvasRef.current?.flashNode(ids[0]);
  }

  return (
    <div className="absolute inset-y-0 left-60 w-80 bg-gray-900 border-r border-gray-800 flex flex-col z-20 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">API Endpoints</h3>
          {data && (
            <p className="text-xs text-gray-400 mt-0.5">
              {data.endpoints.length} endpoint{data.endpoints.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {loading && (
          <p className="text-xs text-gray-500 text-center py-4">Loading endpoints…</p>
        )}

        {!loading && data?.endpoints.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">—</p>
            <p className="text-sm text-gray-400">No REST endpoints found</p>
            <p className="text-xs text-gray-600 mt-1">Try parsing a web framework repo</p>
          </div>
        )}

        {data?.endpoints.map((ep) => {
          const isOpen = expanded.has(ep.id);
          return (
            <div key={ep.id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              {/* Endpoint header row */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-750 transition-colors"
                onClick={() => toggleExpand(ep.id)}
              >
                <span className={`text-xs font-bold text-white px-1.5 py-0.5 rounded flex-shrink-0 ${VERB_COLORS[ep.verb?.toUpperCase()] ?? "bg-gray-600"}`}>
                  {ep.verb?.toUpperCase() ?? "?"}
                </span>
                <span className="text-xs text-gray-200 font-mono flex-1 text-left truncate">{ep.path}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); highlightChain(ep); }}
                  className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
                  role="button"
                >
                  Jump
                </span>
                <span className="text-gray-500 text-xs">{isOpen ? "▲" : "▼"}</span>
              </button>

              {/* Call chain */}
              {isOpen && (
                <div className="border-t border-gray-700 px-3 py-2">
                  {ep.call_chain.length === 0 && !ep.handler && (
                    <p className="text-xs text-gray-500">No call chain resolved</p>
                  )}
                  {ep.call_chain.map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex flex-col items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-500 mt-1.5 flex-shrink-0" />
                        {i < ep.call_chain.length - 1 && (
                          <div className="w-px flex-1 bg-gray-700 my-0.5" style={{ minHeight: 12 }} />
                        )}
                      </div>
                      <div className="flex-1 flex items-center justify-between min-w-0 pb-1">
                        <span className="text-xs text-gray-300 truncate">{step.name}</span>
                        {step.id && (
                          <button
                            onClick={() => canvasRef.current?.flashNode(step.id)}
                            className="text-xs text-blue-400 hover:text-blue-300 ml-2 flex-shrink-0"
                          >
                            ↗
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-800">
        <button
          onClick={() => canvasRef.current?.clearHighlights()}
          className="w-full text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded px-3 py-1.5 border border-gray-700 transition-colors"
        >
          Clear Highlights
        </button>
      </div>
    </div>
  );
}
