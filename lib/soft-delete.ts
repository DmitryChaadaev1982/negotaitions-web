/** Prisma filter: only non-deleted negotiation case templates. */
export const activeCaseWhere = { deletedAt: null } as const;

/** Prisma filter: only non-deleted sessions (hidden from lists, still reachable by direct link). */
export const activeSessionWhere = { deletedAt: null } as const;

export function isDeleted(deletedAt: Date | null | undefined): boolean {
  return deletedAt != null;
}
