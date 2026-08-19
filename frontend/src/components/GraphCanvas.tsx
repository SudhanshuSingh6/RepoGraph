import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
} from "react";
import cytoscape, { Core, ElementDefinition } from "cytoscape";
// @ts-ignore — no bundled types for fcose
import fcose from "cytoscape-fcose";
// @ts-ignore — no bundled types for cytoscape-dagre
import dagre from "cytoscape-dagre";
import { CyGraph, HeatmapNode } from "../api/client";
import { getNodeBgColor, getNodeIcon } from "../lib/nodeIcons";

cytoscape.use(fcose);
cytoscape.use(dagre);

function inferRoots(cy: Core): cytoscape.NodeCollection {
  const visible = cy.nodes(":visible");
  let roots = visible.filter('[type = "Package"]');
  if (roots.length) return roots;
  roots = visible.filter('[type = "File"]');
  if (roots.length) return roots;
  roots = visible.filter('[role = "Controller"]');
  if (roots.length) return roots;
  roots = visible.filter((n: cytoscape.NodeSingular) => n.indegree(false) === 0);
  return roots.length ? roots : visible;
}

export interface GraphCanvasHandle {
  addElements: (graph: CyGraph) => void;
  hideType: (type: string) => void;
  showType: (type: string) => void;
  hideRole: (role: string) => void;
  showRole: (role: string) => void;
  toggleEdgeType: (type: string, visible: boolean) => void;
  fit: () => void;
  panToNode: (nodeId: string) => void;
  enableHeatmap: (nodes: HeatmapNode[]) => void;
  disableHeatmap: () => void;
  highlightNodes: (ids: string[], color: string) => void;
  clearHighlights: () => void;
  flashNode: (nodeId: string) => void;
}

const EDGE_COLORS: Record<string, string> = {
  CALLS: "#3B82F6",
  IMPORTS: "#22C55E",
  EXTENDS: "#F97316",
  IMPLEMENTS: "#A855F7",
  CONTAINS: "#94A3B8",
};

const HEATMAP_COLORS: Record<string, string> = {
  Low:      "#22C55E",
  Medium:   "#EAB308",
  High:     "#F97316",
  Critical: "#EF4444",
  Unknown:  "#6B7280",
};

const STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-size": 11,
      color: "#cbd5e1",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 6,
      "background-color": (ele: cytoscape.NodeSingular) =>
        getNodeBgColor(ele.data("type"), ele.data("role")),
      "background-image": (ele: cytoscape.NodeSingular) =>
        getNodeIcon(ele.data("type"), ele.data("role")),
      "background-width": "60%",
      "background-height": "60%",
      "background-fit": "none" as "none",
      "background-clip": "node" as "node",
      width: 52,
      height: 52,
      "border-width": 2,
      "border-color": "#1e293b",
      "text-wrap": "ellipsis",
      "text-max-width": "80px",
      "transition-property": "border-color, border-width, width, height, background-width, background-height",
      "transition-duration": 150,
      "transition-timing-function": "ease-in-out" as "ease-in-out",
    } as cytoscape.Css.Node,
  },
  {
    selector: "node:hover",
    style: {
      "border-color": "#94a3b8",
      "border-width": 3,
      "background-width": "68%",
      "background-height": "68%",
    } as cytoscape.Css.Node,
  },
  {
    selector: "node:selected",
    style: {
      "border-color": (ele: cytoscape.NodeSingular) =>
        getNodeBgColor(ele.data("type"), ele.data("role")),
      "border-width": 4,
      "shadow-blur": 22,
      "shadow-color": (ele: cytoscape.NodeSingular) =>
        getNodeBgColor(ele.data("type"), ele.data("role")),
      "shadow-opacity": 0.75,
      width: 57,
      height: 57,
      "background-width": "65%",
      "background-height": "65%",
    } as cytoscape.Css.Node,
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": (ele: cytoscape.EdgeSingular) =>
        EDGE_COLORS[ele.data("type")] ?? "#94A3B8",
      "target-arrow-color": (ele: cytoscape.EdgeSingular) =>
        EDGE_COLORS[ele.data("type")] ?? "#94A3B8",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      opacity: 0.7,
    } as cytoscape.Css.Edge,
  },
];

interface Props {
  initialGraph: CyGraph;
  onNodeClick: (nodeId: string, nodeType: string) => void;
}

const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(
  ({ initialGraph, onNodeClick }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const cyRef = useRef<Core | null>(null);
    const minimapRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const heatmapDataRef = useRef<Map<string, HeatmapNode>>(new Map());
    const heatmapActiveRef = useRef(false);
    const [layoutMode, setLayoutMode] = useState<"force" | "tree">("force");
    const layoutModeRef = useRef<"force" | "tree">("force");

    const runLayout = useCallback((cy: Core, fit = false) => {
      cy.layout({
        name: "fcose",
        animate: true,
        animationDuration: 500,
        fit,
        padding: 40,
        // @ts-ignore
        randomize: false,
        nodeRepulsion: 8000,
        idealEdgeLength: 100,
      } as Parameters<Core["layout"]>[0]).run();
    }, []);

    const runTreeLayout = useCallback((cy: Core, fit = false) => {
      const roots = inferRoots(cy);
      cy.layout({
        name: "dagre",
        // @ts-ignore
        rankDir: "TB",
        ranker: "network-simplex",
        animate: true,
        animationDuration: 500,
        fit,
        padding: 60,
        nodeSep: 50,
        rankSep: 80,
        edgeSep: 10,
        roots,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
      } as Parameters<Core["layout"]>[0]).run();
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;

      const cy = cytoscape({
        container: containerRef.current,
        elements: [...initialGraph.nodes, ...initialGraph.edges] as ElementDefinition[],
        style: STYLE,
        wheelSensitivity: 0.3,
      });

      cy.on("tap", "node", (evt) => {
        const node = evt.target;
        onNodeClick(node.id(), node.data("type"));
      });

      // Heatmap tooltip on hover
      cy.on("mouseover", "node", (evt) => {
        if (!heatmapActiveRef.current || !tooltipRef.current) return;
        const node = evt.target;
        const nodeId = node.id();
        const data = heatmapDataRef.current.get(nodeId);
        if (!data) return;

        const pos = node.renderedPosition();
        const container = containerRef.current!.getBoundingClientRect();

        tooltipRef.current.style.left = `${pos.x + 12}px`;
        tooltipRef.current.style.top  = `${pos.y - 10}px`;
        tooltipRef.current.innerHTML = `
          <div class="flex items-center justify-between gap-4 mb-1">
            <span class="font-semibold text-white truncate max-w-[120px]">${data.name}</span>
            <span class="text-xs px-1.5 py-0.5 rounded font-medium text-white" style="background:${HEATMAP_COLORS[data.risk]}">${data.risk}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-300">
            <span>Complexity</span><span class="text-white">${data.complexity ?? "—"}</span>
            <span>LOC</span><span class="text-white">${data.lines ?? "—"}</span>
            <span>Fan-in</span><span class="text-white">${data.fan_in}</span>
            <span>Fan-out</span><span class="text-white">${data.fan_out}</span>
          </div>
        `;
        tooltipRef.current.style.display = "block";
        void container; // keep ref alive
      });

      cy.on("mouseout", "node", () => {
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      });

      cy.on("pan zoom", () => {
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      });

      runLayout(cy, true);
      cyRef.current = cy;

      // Minimap
      if (minimapRef.current) {
        try {
          // @ts-ignore
          const navigator = cy.navigator({ container: minimapRef.current });
          void navigator;
        } catch {
          // cytoscape-navigator not loaded — graceful skip
        }
      }

      return () => {
        cy.destroy();
        cyRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      addElements(graph: CyGraph) {
        const cy = cyRef.current;
        if (!cy) return;

        const newEls: ElementDefinition[] = [
          ...graph.nodes.filter((n) => !cy.getElementById(n.data.id).length),
          ...graph.edges.filter((e) => !cy.getElementById(e.data.id).length),
        ] as ElementDefinition[];

        if (!newEls.length) return;

        const added = cy.add(newEls);
        added.nodes().style({ opacity: 0 });
        added.nodes().animate({ style: { opacity: 1 } }, { duration: 300 });

        if (layoutModeRef.current === "tree") runTreeLayout(cy, false);
        else runLayout(cy, false);
      },

      hideType(type: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[type = "${type}"]`) as any)?.hide();
      },

      showType(type: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[type = "${type}"]`) as any)?.show();
      },

      hideRole(role: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[role = "${role}"]`) as any)?.hide();
      },

      showRole(role: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[role = "${role}"]`) as any)?.show();
      },

      toggleEdgeType(type: string, visible: boolean) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const edges = cyRef.current?.edges(`[type = "${type}"]`) as any;
        if (visible) edges?.show();
        else edges?.hide();
      },

      fit() {
        cyRef.current?.fit(undefined, 40);
      },

      panToNode(nodeId: string) {
        const cy = cyRef.current;
        if (!cy) return;
        const node = cy.getElementById(nodeId);
        if (node.length) cy.animate({ center: { eles: node }, zoom: 1.5 }, { duration: 400 });
      },

      enableHeatmap(nodes: HeatmapNode[]) {
        const cy = cyRef.current;
        if (!cy) return;
        heatmapDataRef.current = new Map(nodes.map((n) => [n.id, n]));
        heatmapActiveRef.current = true;

        nodes.forEach((n) => {
          const el = cy.getElementById(n.id);
          if (!el.length) return;
          const color = HEATMAP_COLORS[n.risk] ?? "#6B7280";
          const size = Math.max(20, Math.min(60, 10 + Math.log2((n.lines ?? 1) + 1) * 8));
          el.style({ "background-color": color, width: size, height: size });
        });
      },

      disableHeatmap() {
        const cy = cyRef.current;
        if (!cy) return;
        heatmapActiveRef.current = false;
        heatmapDataRef.current.clear();
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
        cy.nodes().removeStyle();
      },

      highlightNodes(ids: string[], color: string) {
        const cy = cyRef.current;
        if (!cy) return;
        ids.forEach((id) => {
          const el = cy.getElementById(id);
          if (el.length) el.style({ "border-color": color, "border-width": 4 });
        });
      },

      clearHighlights() {
        cyRef.current?.nodes().style({ "border-color": "#1e293b", "border-width": 2 });
      },

      flashNode(nodeId: string) {
        const cy = cyRef.current;
        if (!cy) return;
        const node = cy.getElementById(nodeId);
        if (!node.length) return;

        cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 400 });

        let count = 0;
        const flash = () => {
          if (count >= 6) {
            node.style({ "border-color": "#1e293b", "border-width": 2 });
            return;
          }
          const on = count % 2 === 0;
          node.style({
            "border-color": on ? "#FBBF24" : "#1e293b",
            "border-width": on ? 4 : 2,
          });
          count++;
          setTimeout(flash, 180);
        };
        setTimeout(flash, 420);
      },
    }));

    return (
      <div className="relative w-full h-full bg-gray-950">
        <div ref={containerRef} className="w-full h-full" />

        {/* Zoom + layout controls */}
        <div className="absolute top-4 left-4 flex flex-col gap-1 z-10">
          <button
            onClick={() => cyRef.current?.zoom({ level: (cyRef.current.zoom() * 1.3), renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 } })}
            className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-lg leading-none select-none"
            title="Zoom in"
          >+</button>
          <button
            onClick={() => cyRef.current?.zoom({ level: (cyRef.current.zoom() / 1.3), renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 } })}
            className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-lg leading-none select-none"
            title="Zoom out"
          >−</button>
          <button
            onClick={() => cyRef.current?.fit(undefined, 40)}
            className="w-8 h-8 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-xs leading-none select-none"
            title="Fit to screen"
          >⤢</button>
          <div className="h-px bg-gray-700 my-0.5" />
          <button
            onClick={() => {
              layoutModeRef.current = "force";
              setLayoutMode("force");
              const cy = cyRef.current;
              if (cy) runLayout(cy, true);
            }}
            className={`w-8 h-8 flex items-center justify-center rounded border text-sm leading-none select-none transition-colors ${
              layoutMode === "force" ? "bg-blue-700 border-blue-600 text-white" : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
            }`}
            title="Force layout"
          >🌐</button>
          <button
            onClick={() => {
              layoutModeRef.current = "tree";
              setLayoutMode("tree");
              const cy = cyRef.current;
              if (cy) runTreeLayout(cy, true);
            }}
            className={`w-8 h-8 flex items-center justify-center rounded border text-sm leading-none select-none transition-colors ${
              layoutMode === "tree" ? "bg-blue-700 border-blue-600 text-white" : "bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300"
            }`}
            title="Tree layout (dagre)"
          >🌳</button>
        </div>

        {/* Heatmap tooltip */}
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-20 hidden bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl text-xs"
          style={{ maxWidth: 220 }}
        />

        {/* Minimap */}
        <div
          ref={minimapRef}
          className="absolute bottom-4 right-4 w-40 h-28 rounded border border-gray-700 bg-gray-900 overflow-hidden"
        />
      </div>
    );
  }
);

GraphCanvas.displayName = "GraphCanvas";
export default GraphCanvas;
