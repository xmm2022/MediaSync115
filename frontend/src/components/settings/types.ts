export type SettingsSection =
  | "cloud"
  | "media"
  | "resources"
  | "telegram"
  | "automation"
  | "system"
  | "security"
  | "logs";

export type StatusSummary = {
  state: string;
  ok: boolean | null;
  message: string;
};

export type DiagnosticStatusCard = {
  label: string;
  summary: StatusSummary;
};
