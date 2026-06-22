import { cn } from "@/lib/cn";

export function inputClassName(hasError: boolean) {
  return cn("form-input", hasError && "form-input-error");
}

export const labelClassName =
  "mb-1.5 block text-sm font-medium text-slate-300";

export const hintClassName = "mt-1.5 text-xs text-slate-400";

export const errorClassName = "mt-1.5 text-sm text-rose-400";

export const alertErrorClassName =
  "rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300";

export const alertSuccessClassName =
  "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300";
