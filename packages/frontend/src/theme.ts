// Shared visual constants used across frontend components.

export const colors = {
  accent: "#ff6644",
  accentDim: "rgba(255,102,68,0.2)",
  accentBorder: "rgba(255,102,68,0.4)",
  accentBg: "rgba(255,102,68,0.25)",
  accentBgHover: "rgba(255,102,68,0.35)",

  bg: "#1a0a0a",
  panelBg: "rgba(10, 10, 10, 0.78)",
  panelBgSolid: "rgba(10, 10, 10, 0.95)",

  text: "#ddd",
  textMuted: "#999",
  textDim: "#888",
  textFaint: "#666",
  textFaintest: "#555",

  border: "rgba(255,255,255,0.06)",
  borderLight: "rgba(255,255,255,0.1)",
  borderMedium: "rgba(255,255,255,0.15)",

  diffAdd: "rgba(40, 160, 60, 0.15)",
  diffAddText: "#6c6",
  diffRemove: "rgba(200, 50, 50, 0.15)",
  diffRemoveText: "#c66",

  success: "#4a4",
  error: "#c44",
} as const;

export const fonts = {
  mono: "monospace",
} as const;

export const fontSizes = {
  xs: 10,
  sm: 11,
  md: 12,
  lg: 13,
} as const;
