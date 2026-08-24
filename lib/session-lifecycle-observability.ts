export type AutomaticCloseInvocation = "periodic" | "transition";

export type AutomaticCloseLogEmission = {
  emit: boolean;
  level: "info" | "warn";
};

export function resolveAutomaticCloseLogEmission(params: {
  invocation: AutomaticCloseInvocation;
  decision: string;
  closed: boolean;
}): AutomaticCloseLogEmission {
  if (params.closed || params.decision === "closed") {
    return { emit: true, level: "info" };
  }
  if (params.decision === "lost_race") {
    return { emit: true, level: "warn" };
  }
  if (params.invocation === "periodic") {
    return { emit: false, level: "info" };
  }
  return { emit: true, level: "info" };
}
