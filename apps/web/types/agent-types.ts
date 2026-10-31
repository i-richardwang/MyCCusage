// Canonical agent identifiers, in dashboard display order.
export const AGENT_TYPES = [
  "claude-code",
  "opencode",
  "amp",
  "codex",
  "dimagent",
  "cursor",
  "antigravity",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  amp: "AMP",
  codex: "Codex",
  dimagent: "DimAgent",
  cursor: "Cursor",
  antigravity: "Antigravity",
};
