import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import cytoscape, { Core, ElementDefinition } from "cytoscape";
// @ts-ignore — no bundled types for fcose
import fcose from "cytoscape-fcose";
import { CyGraph, HeatmapNode } from "../api/client";

cytoscape.use(fcose);

export interface GraphCanvasHandle {
  addElements: (graph: CyGraph) => void;
  hideType: (type: string) => void;
  showType: (type: string) => void;
  toggleEdgeType: (type: string, visible: boolean) => void;
  fit: () => void;
  panToNode: (nodeId: string) => void;
  enableHeatmap: (nodes: HeatmapNode[]) => void;
  disableHeatmap: () => void;
  highlightNodes: (ids: string[], color: string) => void;
  clearHighlights: () => void;
  flashNode: (nodeId: string) => void;
}

const NODE_COLORS: Record<string, string> = {
  Package: "#3B82F6",
  File: "#64748B",
  Class: "#22C55E",
  Interface: "#14B8A6",
  Enum: "#EAB308",
  Method: "#A855F7",
  RestEndpoint: "#F97316",
  ExternalLib: "#6B7280",
};

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
      color: "#fff",
      "text-valign": "center",
      "text-halign": "center",
      "background-color": (ele: cytoscape.NodeSingular) =>
        NODE_COLORS[ele.data("type")] ?? "#6B7280",
      width: 40,
      height: 40,
      "border-width": 2,
      "border-color": "#1e293b",
      "text-wrap": "ellipsis",
      "text-max-width": "80px",
    } as cytoscape.Css.Node,
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#fff",
      "border-width": 3,
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

        runLayout(cy, false);
      },

      hideType(type: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[type = "${type}"]`) as any)?.hide();
      },

      showType(type: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cyRef.current?.nodes(`[type = "${type}"]`) as any)?.show();
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
