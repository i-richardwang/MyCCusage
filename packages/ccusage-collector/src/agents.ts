export const AGENT_OPTIONS = [
  { value: "claude-code", label: "Claude Code" },
  { value: "amp", label: "AMP" },
  { value: "opencode", label: "OpenCode" },
  { value: "codex", label: "Codex" },
  { value: "dimagent", label: "DimAgent" },
  { value: "cursor", label: "Cursor" },
  { value: "antigravity", label: "Antigravity" },
] as const;

export type AgentType = (typeof AGENT_OPTIONS)[number]["value"];

export function formatAgentList(agents: readonly AgentType[]): string {
  return agents
    .map((agent) => AGENT_OPTIONS.find(({ value }) => value === agent)!.label)
    .join(", ");
}
