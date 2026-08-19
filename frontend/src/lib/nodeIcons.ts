// ── Colors ────────────────────────────────────────────────────────────────────

export const ARCH_COLORS: Record<string, string> = {
  Controller:    "#EF4444", // red
  Service:       "#10B981", // emerald
  Repository:    "#8B5CF6", // violet
  Model:         "#3B82F6", // blue
  Middleware:    "#F97316", // orange
  Configuration: "#475569", // slate
  Utility:       "#6B7280", // gray
};

export const NODE_TYPE_COLORS: Record<string, string> = {
  Package:      "#3B82F6",
  File:         "#64748B",
  Class:        "#22C55E",
  Interface:    "#14B8A6",
  Enum:         "#EAB308",
  Method:       "#A855F7",
  RestEndpoint: "#F97316",
  ExternalLib:  "#6B7280",
};

export function getNodeBgColor(type: string, role?: string): string {
  if (role && ARCH_COLORS[role]) return ARCH_COLORS[role];
  return NODE_TYPE_COLORS[type] ?? "#6B7280";
}

// ── SVG icon helpers ──────────────────────────────────────────────────────────

function svgUri(inner: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Lucide icon paths — inlined verbatim from lucide.dev source

const MONITOR = [
  '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>',
  '<line x1="8" y1="21" x2="16" y2="21"/>',
  '<line x1="12" y1="17" x2="12" y2="21"/>',
].join("");

const SETTINGS = [
  '<circle cx="12" cy="12" r="3"/>',
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
].join("");

const DATABASE = [
  '<ellipse cx="12" cy="5" rx="9" ry="3"/>',
  '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>',
  '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
].join("");

const BOX = [
  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>',
  '<line x1="12" y1="22.08" x2="12" y2="12"/>',
].join("");

const GIT_BRANCH = [
  '<line x1="6" y1="3" x2="6" y2="15"/>',
  '<circle cx="18" cy="6" r="3"/>',
  '<circle cx="6" cy="18" r="3"/>',
  '<path d="M18 9a9 9 0 0 1-9 9"/>',
].join("");

const WRENCH = [
  '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
].join("");

const HAMMER = [
  '<path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/>',
  '<path d="M17.64 15L22 10.64"/>',
  '<path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
].join("");

const PACKAGE = [
  '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>',
  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
  '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>',
  '<line x1="12" y1="22.08" x2="12" y2="12"/>',
].join("");

const FILE = [
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
  '<polyline points="14 2 14 8 20 8"/>',
].join("");

const DIAMOND = [
  '<polygon points="12 2 22 12 12 22 2 12"/>',
].join("");

const FUNCTION_SQUARE = [
  '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>',
  '<path d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3"/>',
  '<path d="M9 11.2h5.7"/>',
].join("");

const GLOBE = [
  '<circle cx="12" cy="12" r="10"/>',
  '<line x1="2" y1="12" x2="22" y2="12"/>',
  '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
].join("");

const TAG = [
  '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>',
  '<line x1="7" y1="7" x2="7.01" y2="7"/>',
].join("");

const EXTERNAL_LINK = [
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  '<polyline points="15 3 21 3 21 9"/>',
  '<line x1="10" y1="14" x2="21" y2="3"/>',
].join("");

// ── Icon maps ─────────────────────────────────────────────────────────────────

export const ROLE_ICONS: Record<string, string> = {
  Controller:    svgUri(MONITOR),
  Service:       svgUri(SETTINGS),
  Repository:    svgUri(DATABASE),
  Model:         svgUri(BOX),
  Middleware:    svgUri(GIT_BRANCH),
  Configuration: svgUri(WRENCH),
  Utility:       svgUri(HAMMER),
};

export const TYPE_ICONS: Record<string, string> = {
  Package:      svgUri(PACKAGE),
  File:         svgUri(FILE),
  Class:        svgUri(FILE),
  Interface:    svgUri(DIAMOND),
  Method:       svgUri(FUNCTION_SQUARE),
  RestEndpoint: svgUri(GLOBE),
  Enum:         svgUri(TAG),
  ExternalLib:  svgUri(EXTERNAL_LINK),
};

export function getNodeIcon(type: string, role?: string): string {
  if (role && ROLE_ICONS[role]) return ROLE_ICONS[role];
  return TYPE_ICONS[type] ?? TYPE_ICONS["File"];
}

// ── Sidebar legend list ───────────────────────────────────────────────────────

export const ARCH_LAYER_LIST = Object.entries(ARCH_COLORS).map(([role, color]) => ({
  role,
  color,
  icon: ROLE_ICONS[role],
}));
