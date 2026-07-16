export interface CyNode {
  data: {
    id: string;
    label: string;
    type: string;
    file_path?: string;
    start_line?: number;
    end_line?: number;
    complexity?: number;
    lines?: number;
    repo_id?: string;
    [key: string]: unknown;
  };
}

export interface CyEdge {
  data: { id: string; source: string; target: string; type: string };
}

export interface CyGraph {
  nodes: CyNode[];
  edges: CyEdge[];
}

export interface NodeDetail {
  data: Record<string, unknown>;
}

export interface SourceResult {
  language: string;
  source: string;
  highlight_start: number;
  highlight_end: number;
}

export interface References {
  calls: NodeDetail["data"][];
  used_by: NodeDetail["data"][];
  imports: NodeDetail["data"][];
  extends: NodeDetail["data"][];
  implements: NodeDetail["data"][];
}

export interface HeatmapNode {
  id: string;
  name: string;
  type: string;
  file_path: string;
  complexity: number | null;
  lines: number | null;
  fan_in: number;
  fan_out: number;
  risk: "Low" | "Medium" | "High" | "Critical" | "Unknown";
}

export interface HealthInfo {
  score: number;
  stars: number;
  label: string;
}

export interface OverviewResponse {
  total_packages: number;
  total_files: number;
  total_classes: number;
  total_methods: number;
  total_external_deps: number;
  avg_complexity: number;
  largest_package: { name: string; file_count: number };
  most_connected_class: { name: string; id: string; edge_count: number };
  health: HealthInfo;
  warnings: string[];
  charts: {
    node_type_distribution: Record<string, number>;
    complexity_distribution: Record<string, number>;
    largest_packages: { name: string; id: string; file_count: number }[];
    most_connected_classes: { name: string; id: string; edge_count: number }[];
  };
}

export interface MetricsResponse {
  packages: number;
  files: number;
  classes: number;
  methods: number;
  external_deps: number;
  imports: number;
  calls: number;
  cycles: number;
}

export interface CycleNode {
  id: string;
  name: string;
  file_path: string;
}

export interface CyclesResponse {
  cycles: { nodes: CycleNode[] }[];
  count: number;
}

export interface EndpointChainStep {
  id: string;
  name: string;
  type: string;
  file_path: string;
}

export interface EndpointItem {
  id: string;
  verb: string;
  path: string;
  handler: EndpointChainStep | null;
  call_chain: EndpointChainStep[];
}

export interface EndpointsResponse {
  endpoints: EndpointItem[];
}

export interface DependencyItem {
  name: string;
  id: string;
  type: string;
  rel: string;
}

export interface DependenciesResponse {
  used_by: DependencyItem[];
  depends_on: DependencyItem[];
}

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  file_path: string;
  score: number;
  preview: string;
}

export interface EmbedStatus {
  status: "pending" | "running" | "done" | "error";
  nodes_embedded: number;
  total: number;
}

export interface MentionedNode {
  id: string;
  name: string;
}

export interface StreamDone {
  nodes: MentionedNode[];
  citations: string[];
}

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onDone: (done: StreamDone) => void;
  onError?: (message: string) => void;
}

export interface RepoResponse {
  repo_id: string;
  name: string;
  local_path: string;
  primary_language: string;
  language_breakdown: Record<string, number>;
}

export interface StatusResponse {
  status: "pending" | "parsing" | "ready" | "error" | "unknown";
  detail?: string;
  progress?: string;
}

async function streamSSE(
  path: string,
  body: unknown,
  { onDelta, onDone, onError }: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    onError?.(text || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.delta) onDelta(event.delta);
        else if (event.done) onDone({ nodes: event.nodes ?? [], citations: event.citations ?? [] });
        else if (event.error) onError?.(event.error);
      } catch {
        // malformed line — skip
      }
    }
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getGraph: (repoId: string) =>
    request<CyGraph>(`/repos/${repoId}/graph`),

  getChildren: (nodeId: string) =>
    request<CyGraph>(`/nodes/${nodeId}/children`),

  getNeighbours: (nodeId: string) =>
    request<CyGraph>(`/nodes/${nodeId}/neighbours`),

  getNode: (nodeId: string) =>
    request<NodeDetail>(`/nodes/${nodeId}`),

  getNodeSource: (nodeId: string) =>
    request<SourceResult>(`/nodes/${nodeId}/source`),

  getNodeReferences: (nodeId: string) =>
    request<References>(`/nodes/${nodeId}/references`),

  cloneRepo: (url: string) =>
    request<RepoResponse>("/repos/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),

  uploadZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<RepoResponse>("/repos/upload", { method: "POST", body: form });
  },

  startParse: (repoId: string) =>
    request<{ status: string }>(`/repos/${repoId}/parse`, { method: "POST" }),

  getStatus: (repoId: string) =>
    request<StatusResponse>(`/repos/${repoId}/status`),

  getMetrics: (repoId: string) =>
    request<MetricsResponse>(`/repos/${repoId}/metrics`),

  getOverview: (repoId: string) =>
    request<OverviewResponse>(`/repos/${repoId}/overview`),

  getHeatmap: (repoId: string) =>
    request<{ nodes: HeatmapNode[] }>(`/repos/${repoId}/heatmap`),

  getCycles: (repoId: string) =>
    request<CyclesResponse>(`/repos/${repoId}/cycles`),

  getEndpoints: (repoId: string) =>
    request<EndpointsResponse>(`/repos/${repoId}/endpoints`),

  getDependencies: (nodeId: string) =>
    request<DependenciesResponse>(`/nodes/${nodeId}/dependencies`),

  startEmbed: (repoId: string) =>
    request<{ status: string }>(`/repos/${repoId}/embed`, { method: "POST" }),

  getEmbedStatus: (repoId: string) =>
    request<EmbedStatus>(`/repos/${repoId}/embed/status`),

  searchNodes: (repoId: string, q: string) =>
    request<{ results: SearchResult[] }>(`/repos/${repoId}/search?q=${encodeURIComponent(q)}`),

  streamExplain: (nodeId: string, cbs: StreamCallbacks) =>
    streamSSE(`/nodes/${nodeId}/explain`, null, cbs),

  streamSummarize: (nodeId: string, cbs: StreamCallbacks) =>
    streamSSE(`/nodes/${nodeId}/summarize`, null, cbs),

  streamImpact: (nodeId: string, cbs: StreamCallbacks) =>
    streamSSE(`/nodes/${nodeId}/impact`, null, cbs),

  streamChat: (repoId: string, message: string, tool: "repo" | "architecture", cbs: StreamCallbacks) =>
    streamSSE(`/repos/${repoId}/chat`, { message, tool }, cbs),
};
