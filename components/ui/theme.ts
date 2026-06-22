import { cn } from "@/lib/cn";

/** Shared dark-theme class tokens — explicit values for reliable rendering */
export const theme = {
  textPrimary: "text-slate-50",
  textSecondary: "text-slate-300",
  textMuted: "text-slate-400",
  textAccent: "text-cyan-400",
  link: "text-cyan-400 hover:text-cyan-300 transition-colors",
  border: "border-slate-600/25",
  glass: "glass-panel rounded-xl",
  glassElevated: "glass-panel-elevated rounded-xl",
} as const;

export { cn };
