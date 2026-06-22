export const sessionRoleBriefingSelect = {
  name: true,
  privateInstructions: true,
  objectives: true,
  constraints: true,
  hiddenInfo: true,
  fallbackPosition: true,
} as const;

export type SessionRoleSnapshotInput = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
  sortOrder: number;
};

export function mapCaseRolesToSessionRoleCreate(
  roles: SessionRoleSnapshotInput[],
) {
  return roles.map((role, index) => ({
    name: role.name,
    privateInstructions: role.privateInstructions,
    objectives: role.objectives,
    constraints: role.constraints,
    hiddenInfo: role.hiddenInfo,
    fallbackPosition: role.fallbackPosition,
    sortOrder: index,
  }));
}
