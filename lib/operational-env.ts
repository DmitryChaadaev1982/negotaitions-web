import { loadEnvConfig as loadNextEnvConfig } from "@next/env";

export type OperationalEnvBootstrapResult = {
  loaded: boolean;
  nodeEnv: string | undefined;
  projectDir: string;
};

export type OperationalEnvBootstrapOptions = {
  nodeEnv?: string;
  projectDir?: string;
  loadEnvConfig?: (projectDir: string) => unknown;
};

export function shouldLoadLocalOperationalEnv(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv !== "production";
}

export function bootstrapOperationalEnv(
  options: OperationalEnvBootstrapOptions = {},
): OperationalEnvBootstrapResult {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const projectDir = options.projectDir ?? process.cwd();

  if (!shouldLoadLocalOperationalEnv(nodeEnv)) {
    return { loaded: false, nodeEnv, projectDir };
  }

  const loadEnvConfig = options.loadEnvConfig ?? loadNextEnvConfig;
  loadEnvConfig(projectDir);
  return { loaded: true, nodeEnv, projectDir };
}
