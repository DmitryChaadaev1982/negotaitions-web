const NON_ASSIGNABLE_ROLE_NAMES = new Set(["observer"]);

export function isAssignableCaseRole(roleName: string) {
  return !NON_ASSIGNABLE_ROLE_NAMES.has(roleName.trim().toLowerCase());
}
