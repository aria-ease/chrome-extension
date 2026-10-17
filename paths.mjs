import path from "node:path";

function configuredPath(value, fallback, baseDir) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return path.resolve(baseDir, candidate);
}

export function resolveRuntimePaths({ environment = process.env, baseDir = import.meta.dirname } = {}) {
  const ariaEaseRoot = configuredPath(environment.ARIA_EASE_PACKAGE_ROOT, "../aria-ease", baseDir);
  const projectRoot = configuredPath(environment.ARIA_EASE_PROJECT_ROOT, "../frontend-testing-ground", baseDir);
  const configuredApprovedRoots = environment.ARIA_EASE_APPROVED_ROOTS
    ?.split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  const approvedRoots = (configuredApprovedRoots?.length ? configuredApprovedRoots : [projectRoot])
    .map((root) => path.resolve(baseDir, root));

  return { ariaEaseRoot, projectRoot, approvedRoots };
}

export const runtimePaths = resolveRuntimePaths();
