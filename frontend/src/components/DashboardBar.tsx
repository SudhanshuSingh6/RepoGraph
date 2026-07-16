import { useEffect, useState } from "react";
import { api, OverviewResponse } from "../api/client";

const STARS = ["★★★★★", "★★★★☆", "★★★☆☆", "★★☆☆☆", "★☆☆☆☆"];

function starStr(stars: number) {
  const idx = Math.max(0, Math.min(4, 5 - stars));
  return STARS[idx];
}

const HEALTH_COLORS: Record<string, string> = {
  Excellent: "text-green-400",
  Good:      "text-blue-400",
  Fair:      "text-yellow-400",
  Poor:      "text-orange-400",
  Critical:  "text-red-400",
};

interface BarProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

function Bar({ label, value, max, color }: BarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
        <span className="truncate max-w-[120px]">{label}</span>
        <span className="text-gray-300 ml-2">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

interface Props {
  repoId: string;
}

export default function DashboardBar({ repoId }: Props) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [chartsOpen, setChartsOpen] = useState(false);

  useEffect(() => {
    api.getOverview(repoId).then(setOverview).catch(() => {});
  }, [repoId]);

  if (!overview) {
    return (
      <div className="h-10 bg-gray-900 border-b border-gray-800 flex items-center px-4">
        <span className="text-xs text-gray-500">Loading metrics…</span>
      </div>
    );
  }

  const { health, warnings, charts } = overview;
  const nodeDistMax = Math.max(...Object.values(charts.node_type_distribution));
  const cxDistMax = Math.max(...Object.values(charts.complexity_distribution));
  const pkgMax = charts.largest_packages[0]?.file_count ?? 1;
  const connMax = charts.most_connected_classes[0]?.edge_count ?? 1;

  const NODE_PALETTE: Record<string, string> = {
    Package: "#3B82F6", File: "#64748B", Class: "#22C55E",
    Interface: "#14B8A6", Enum: "#EAB308", Method: "#A855F7",
    RestEndpoint: "#F97316", ExternalLib: "#6B7280",
  };
  const CX_PALETTE: Record<string, string> = {
    "1-3": "#22C55E", "4-7": "#EAB308", "8-12": "#F97316", "13+": "#EF4444",
  };

  return (
    <div className="bg-gray-900 border-b border-gray-800 z-10">
      {/* Main bar */}
      <div className="flex items-center justify-between px-4 h-10 gap-4">
        {/* Stat chips */}
        <div className="flex items-center gap-3 overflow-x-auto">
          {[
            { label: "Packages", value: overview.total_packages },
            { label: "Files",    value: overview.total_files },
            { label: "Classes",  value: overview.total_classes },
            { label: "Methods",  value: overview.total_methods },
            { label: "Ext deps", value: overview.total_external_deps },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-xs font-semibold text-white">{value.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Right side: health + chart toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => { setChartsOpen((o) => !o); setWarningsOpen(false); }}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Charts {chartsOpen ? "▲" : "▼"}
          </button>

          <button
            onClick={() => { setWarningsOpen((o) => !o); setChartsOpen(false); }}
            className={`flex items-center gap-2 text-xs font-medium transition-colors ${
              warningsOpen ? "text-white" : "text-gray-300 hover:text-white"
            }`}
          >
            <span className={`font-bold ${HEALTH_COLORS[health.label] ?? "text-gray-400"}`}>
              {starStr(health.stars)} {health.score}/100
            </span>
            <span className={`text-xs ${HEALTH_COLORS[health.label] ?? "text-gray-400"}`}>
              {health.label}
            </span>
            {warnings.length > 0 && (
              <span className="text-xs bg-yellow-600 text-white rounded px-1.5 py-0.5">
                {warnings.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Warnings panel */}
      {warningsOpen && warnings.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-800 bg-gray-950 flex flex-wrap gap-2">
          {warnings.map((w, i) => (
            <span
              key={i}
              className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-800 rounded px-2 py-0.5"
            >
              {w}
            </span>
          ))}
        </div>
      )}

      {/* Charts panel */}
      {chartsOpen && (
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-950 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Node type distribution */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2">Node Types</p>
            {Object.entries(charts.node_type_distribution)
              .filter(([, v]) => v > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([label, value]) => (
                <Bar key={label} label={label} value={value} max={nodeDistMax} color={NODE_PALETTE[label] ?? "#6B7280"} />
              ))}
          </div>

          {/* Complexity distribution */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2">Complexity</p>
            {Object.entries(charts.complexity_distribution).map(([label, value]) => (
              <Bar key={label} label={label} value={value} max={cxDistMax} color={CX_PALETTE[label] ?? "#6B7280"} />
            ))}
          </div>

          {/* Largest packages */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2">Largest Packages</p>
            {charts.largest_packages.map((p) => (
              <Bar key={p.name} label={p.name} value={p.file_count} max={pkgMax} color="#3B82F6" />
            ))}
          </div>

          {/* Most connected classes */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2">Most Connected</p>
            {charts.most_connected_classes.map((c) => (
              <Bar key={c.name} label={c.name} value={c.edge_count} max={connMax} color="#22C55E" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
