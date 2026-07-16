import { RefObject, useEffect, useState } from "react";
import { api, CycleNode, CyclesResponse } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";

interface Props {
  repoId: string;
  canvasRef: RefObject<GraphCanvasHandle | null>;
  onClose: () => void;
}

export default function CyclesPanel({ repoId, canvasRef, onClose }: Props) {
  const [data, setData] = useState<CyclesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCycles(repoId)
      .then(setData)
      .catch(() => setData({ cycles: [], count: 0 }))
      .finally(() => setLoading(false));
  }, [repoId]);

  function handleJump(nodes: CycleNode[]) {
    const ids = [...new Set(nodes.map((n) => n.id))];
    canvasRef.current?.highlightNodes(ids, "#EF4444");
    if (ids[0]) canvasRef.current?.flashNode(ids[0]);
  }

  return (
    <div className="absolute inset-y-0 left-60 w-80 bg-gray-900 border-r border-gray-800 flex flex-col z-20 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-white">Circular Dependencies</h3>
          {data && (
            <p className="text-xs text-gray-400 mt-0.5">
              {data.count === 0 ? "No cycles detected" : `${data.count} cycle${data.count !== 1 ? "s" : ""} found`}
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading && (
          <p className="text-xs text-gray-500 text-center py-4">Detecting cycles…</p>
        )}

        {!loading && data?.count === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm text-green-400 font-medium">No circular dependencies</p>
            <p className="text-xs text-gray-500 mt-1">Clean import graph</p>
          </div>
        )}

        {data?.cycles.map((cycle, i) => {
          const ids = [...new Set(cycle.nodes.map((n) => n.id))];
          return (
            <div
              key={i}
              className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-red-700 transition-colors cursor-pointer"
              onClick={() => handleJump(cycle.nodes)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {cycle.nodes.map((node, j) => (
                      <span key={j} className="flex items-center gap-1">
                        <span className="text-gray-200 font-medium truncate max-w-[80px]" title={node.name}>
                          {node.name}
                        </span>
                        {j < cycle.nodes.length - 1 && (
                          <span className="text-red-400">→</span>
                        )}
                      </span>
                    ))}
                    <span className="text-red-400 ml-1">⟲</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleJump(cycle.nodes); }}
                  className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap flex-shrink-0"
                >
                  Jump
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">{ids.length} files involved</p>
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
