import { RefObject } from "react";
import { DependenciesResponse, DependencyItem } from "../api/client";
import { GraphCanvasHandle } from "./GraphCanvas";

const TYPE_COLORS: Record<string, string> = {
  Package: "bg-blue-600", File: "bg-slate-600", Class: "bg-green-600",
  Interface: "bg-teal-600", Enum: "bg-yellow-600", Method: "bg-purple-600",
  RestEndpoint: "bg-orange-600", ExternalLib: "bg-gray-600",
};

const REL_COLORS: Record<string, string> = {
  CALLS: "text-blue-400", IMPORTS: "text-green-400",
  EXTENDS: "text-orange-400", IMPLEMENTS: "text-purple-400",
};

interface ItemRowProps {
  item: DependencyItem;
  canvasRef: RefObject<GraphCanvasHandle | null>;
}

function ItemRow({ item, canvasRef }: ItemRowProps) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-800 group">
      <span className={`text-xs px-1.5 py-0.5 rounded text-white flex-shrink-0 ${TYPE_COLORS[item.type] ?? "bg-gray-600"}`}>
        {item.type}
      </span>
      <span className="text-xs text-gray-300 flex-1 truncate" title={item.name}>{item.name}</span>
      <span className={`text-xs font-mono flex-shrink-0 ${REL_COLORS[item.rel] ?? "text-gray-400"}`}>
        {item.rel}
      </span>
      <button
        onClick={() => canvasRef.current?.flashNode(item.id)}
        className="text-xs text-blue-400 hover:text-blue-300 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity"
        title="Jump to graph"
      >
        ↗
      </button>
    </div>
  );
}

interface Props {
  data: DependenciesResponse;
  canvasRef: RefObject<GraphCanvasHandle | null>;
}

export default function DependencyPanel({ data, canvasRef }: Props) {
  return (
    <div className="space-y-3">
      {/* Used by */}
      <div>
        <p className="text-xs font-semibold text-gray-400 px-2 mb-1">
          Used By <span className="text-gray-600 font-normal">({data.used_by.length})</span>
        </p>
        {data.used_by.length === 0 ? (
          <p className="text-xs text-gray-600 px-2">None</p>
        ) : (
          data.used_by.map((item, i) => (
            <ItemRow key={i} item={item} canvasRef={canvasRef} />
          ))
        )}
      </div>

      {/* Depends on */}
      <div>
        <p className="text-xs font-semibold text-gray-400 px-2 mb-1">
          Depends On <span className="text-gray-600 font-normal">({data.depends_on.length})</span>
        </p>
        {data.depends_on.length === 0 ? (
          <p className="text-xs text-gray-600 px-2">None</p>
        ) : (
          data.depends_on.map((item, i) => (
            <ItemRow key={i} item={item} canvasRef={canvasRef} />
          ))
        )}
      </div>
    </div>
  );
}
