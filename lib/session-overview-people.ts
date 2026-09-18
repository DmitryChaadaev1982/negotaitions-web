/**
 * Session people display.
 *
 * Domain authority: Session owner = `Session.facilitatorId`.
 * There is no separate Session createdBy/owner column. Case
 * `createdByUserId` is not Session ownership.
 */
export type SessionOwnerFacilitatorDisplay = {
  ownerUserId: string | null;
  facilitatorUserId: string | null;
  ownerLabel: string | null;
  facilitatorLabel: string | null;
  displayLabel: string | null;
  samePerson: boolean;
  missing: boolean;
};

export function resolveSessionOwnerFacilitatorDisplay(input: {
  facilitatorId?: string | null;
  facilitatorName?: string | null;
  facilitatorEmail?: string | null;
}): SessionOwnerFacilitatorDisplay {
  const facilitatorUserId = input.facilitatorId?.trim() || null;
  const facilitatorLabel =
    input.facilitatorName?.trim() ||
    input.facilitatorEmail?.trim() ||
    null;
  return {
    ownerUserId: facilitatorUserId,
    facilitatorUserId,
    ownerLabel: facilitatorLabel,
    facilitatorLabel,
    displayLabel: facilitatorLabel,
    samePerson: true,
    missing: facilitatorLabel == null,
  };
}
