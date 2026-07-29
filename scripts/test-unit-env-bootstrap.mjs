import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

export function loadUnitTestEnv(projectRoot = process.cwd()) {
  loadEnvConfig(projectRoot);
}

loadUnitTestEnv();
