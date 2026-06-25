/**
 * Privacy serializers — NegotAItions Phase 5
 *
 * Privacy classification:
 *
 * PUBLIC data (safe to expose to all authenticated viewers):
 *   - case title, public context/instructions, language, difficulty,
 *     preparation/negotiation duration, targetSkills, role names only
 *
 * PRIVATE/HIDDEN data (must be scoped by role):
 *   - privateInstructions, objectives, constraints, hiddenInfo,
 *     fallbackPosition, facilitator-only notes, raw AI prompt/context,
 *     full facilitator AI analysis, other participants' private role briefings
 *
 * Role rules:
 *   - PARTICIPANT sees only own private role briefing in concrete session
 *   - PARTICIPANT never sees other participants' private role data
 *   - OBSERVER sees public session context only; no private role briefings
 *   - FACILITATOR/HOST sees all participant briefings for sessions they manage
 *   - ADMIN can access private data; admin views must show admin warning label
 *   - Shared participant AI report must be sanitized (see sanitizeSharedAiReport)
 *   - Full facilitator AI report is visible only to facilitator/host/admin
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type PrivateRoleBriefing = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

/** A zeroed-out private briefing that exposes only the role name. */
export type PublicRoleView = {
  name: string;
  /** Always empty string — private data redacted. */
  privateInstructions: "";
  /** Always empty string — private data redacted. */
  objectives: "";
  /** Always empty string — private data redacted. */
  constraints: "";
  /** Always empty string — private data redacted. */
  hiddenInfo: "";
  /** Always empty string — private data redacted. */
  fallbackPosition: "";
};

export function toPublicRoleView(name: string): PublicRoleView {
  return {
    name,
    privateInstructions: "",
    objectives: "",
    constraints: "",
    hiddenInfo: "",
    fallbackPosition: "",
  };
}

export type PublicCaseView = {
  id: string;
  title: string;
  caseLanguage: string;
  difficulty: string;
  businessContext: string;
  publicInstructions: string;
  targetSkills: string;
  defaultPreparationDurationSeconds: number;
  defaultDurationSeconds: number;
  /** Only role names and IDs — no private role fields. */
  roles: Array<{ id: string; name: string }>;
};

/** Participant/observer view of a session — no private role data from other participants. */
export type SessionPublicRosterEntry = {
  id: string;
  displayName: string;
  type: string;
  /** Role name only; no private data. */
  roleName: string | null;
};

// ---------------------------------------------------------------------------
// Case serializers
// ---------------------------------------------------------------------------

/**
 * Public case view — safe for case library and unauthenticated access.
 * No private role fields are included.
 */
export function toPublicCaseView(negotiationCase: {
  id: string;
  title: string;
  caseLanguage: string;
  difficulty: string;
  businessContext: string;
  publicInstructions: string;
  targetSkills: string;
  defaultPreparationDurationSeconds: number;
  defaultDurationSeconds: number;
  roles: Array<{ id: string; name: string; sortOrder: number }>;
}): PublicCaseView {
  return {
    id: negotiationCase.id,
    title: negotiationCase.title,
    caseLanguage: negotiationCase.caseLanguage,
    difficulty: negotiationCase.difficulty,
    businessContext: negotiationCase.businessContext,
    publicInstructions: negotiationCase.publicInstructions,
    targetSkills: negotiationCase.targetSkills,
    defaultPreparationDurationSeconds:
      negotiationCase.defaultPreparationDurationSeconds,
    defaultDurationSeconds: negotiationCase.defaultDurationSeconds,
    roles: negotiationCase.roles
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((role) => ({ id: role.id, name: role.name })),
  };
}

/**
 * Event lobby case view — public summary for participant/observer in event lobby.
 * Same as public case view; host/facilitator/admin see the same public summary.
 * No private role instructions at any level.
 */
export const toEventLobbyCaseView = toPublicCaseView;

/**
 * Admin case view — full case data for admin support/debugging.
 *
 * MUST be used only in admin-authenticated server contexts.
 * UI MUST display the admin warning label:
 *   EN: "Admin view — contains private role data."
 *   RU: "Административный режим — содержит скрытые данные ролей."
 */
export function toAdminCaseView<T>(negotiationCase: T): T & { _adminView: true } {
  return { ...negotiationCase, _adminView: true as const };
}

// ---------------------------------------------------------------------------
// Session participant serializers
// ---------------------------------------------------------------------------

type SessionParticipantInput = {
  id: string;
  displayName: string;
  type: string;
  sessionRole: PrivateRoleBriefing | null;
};

/**
 * Build the public-safe roster from all session participants.
 * Includes role names but no private role data.
 */
export function toPublicRoster(
  allParticipants: SessionParticipantInput[],
): SessionPublicRosterEntry[] {
  return allParticipants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    type: p.type,
    roleName: p.sessionRole?.name ?? null,
  }));
}

/**
 * Scope assigned participants for a PARTICIPANT viewer.
 *
 * - Own role: full private briefing
 * - Other participants: name + role name only; private fields zeroed out
 *
 * Use this to build the `assignedParticipants` prop for JoinPageView
 * or any client-facing participant view.
 */
export function scopeAssignedParticipantsForParticipant(
  allParticipants: SessionParticipantInput[],
  currentParticipantId: string,
): Array<{ id: string; displayName: string; role: PrivateRoleBriefing }> {
  return allParticipants
    .filter((p): p is SessionParticipantInput & { sessionRole: PrivateRoleBriefing } =>
      p.sessionRole !== null,
    )
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role:
        p.id === currentParticipantId
          ? p.sessionRole
          : toPublicRoleView(p.sessionRole.name),
    }));
}

/**
 * Scope assigned participants for an OBSERVER viewer.
 * Observers receive role names only; all private fields are zeroed out.
 */
export function scopeAssignedParticipantsForObserver(
  allParticipants: SessionParticipantInput[],
): Array<{ id: string; displayName: string; role: PublicRoleView }> {
  return allParticipants
    .filter((p): p is SessionParticipantInput & { sessionRole: PrivateRoleBriefing } =>
      p.sessionRole !== null,
    )
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: toPublicRoleView(p.sessionRole.name),
    }));
}

/**
 * Scope assigned participants for a FACILITATOR viewer.
 * Facilitators receive all participant role briefings (needed to run the session).
 */
export function scopeAssignedParticipantsForFacilitator(
  allParticipants: SessionParticipantInput[],
): Array<{ id: string; displayName: string; role: PrivateRoleBriefing }> {
  return allParticipants
    .filter((p): p is SessionParticipantInput & { sessionRole: PrivateRoleBriefing } =>
      p.sessionRole !== null,
    )
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      role: p.sessionRole,
    }));
}

// ---------------------------------------------------------------------------
// AI analysis sanitization
// ---------------------------------------------------------------------------

/**
 * Fields that must never appear in the shared participant AI report.
 * These strings are checked at test time against shared report output.
 */
export const BLOCKED_AI_SHARED_FIELDS = [
  "roleObjectivesAnalysis",
  "rawPrompt",
  "analysisContext",
  "facilitatorNotes",
] as const;

/**
 * Sanitize a full AI analysis for sharing with session participants.
 *
 * Removes all fields that could reveal:
 *   - private role objectives/instructions
 *   - hidden objectives and fallback positions
 *   - BATNA / reservation points
 *   - facilitator-only notes
 *   - raw prompt or analysis context
 *
 * participantPersonalFeedback is retained in the shared version; it is
 * further filtered per-participant at delivery time in the materials/status API
 * so each participant sees only their own entry.
 */
export function sanitizeSharedAiReport<
  T extends {
    roleObjectivesAnalysis?: unknown;
    rawPrompt?: unknown;
    analysisContext?: unknown;
    facilitatorNotes?: unknown;
  },
>(fullAnalysis: T): Omit<T, "roleObjectivesAnalysis" | "rawPrompt" | "analysisContext" | "facilitatorNotes"> {
  const sanitized = { ...fullAnalysis };
  delete (sanitized as Record<string, unknown>).roleObjectivesAnalysis;
  delete (sanitized as Record<string, unknown>).rawPrompt;
  delete (sanitized as Record<string, unknown>).analysisContext;
  delete (sanitized as Record<string, unknown>).facilitatorNotes;
  return sanitized;
}

/**
 * Filter participantPersonalFeedback to only the entry for this participant.
 *
 * Falls back to displayName matching when sessionParticipantId is unavailable
 * in legacy AI output. Documents the limitation.
 */
export function filterPersonalFeedbackForParticipant<
  T extends {
    participantPersonalFeedback?: Array<{
      participantName?: string;
      sessionParticipantId?: string;
    }>;
  },
>(
  analysis: T,
  opts: { participantId: string; displayName: string },
): T {
  if (!analysis.participantPersonalFeedback) {
    return analysis;
  }
  const filtered = analysis.participantPersonalFeedback.filter(
    (entry) =>
      // Prefer ID-based match (reduces displayName collision risk)
      (entry.sessionParticipantId && entry.sessionParticipantId === opts.participantId) ||
      // Fall back to displayName match for legacy AI output without IDs
      (!entry.sessionParticipantId && entry.participantName === opts.displayName),
  );
  return { ...analysis, participantPersonalFeedback: filtered };
}

// ---------------------------------------------------------------------------
// Access control helpers
// ---------------------------------------------------------------------------

/**
 * Check if the viewer can see the full (unsanitized) AI analysis.
 * Only facilitators, session hosts, and admins may see the full report.
 */
export function canViewFullAiAnalysis(opts: {
  isFacilitator: boolean;
  isEventHostOwner: boolean;
  isAdmin: boolean;
}): boolean {
  return opts.isFacilitator || opts.isEventHostOwner || opts.isAdmin;
}

/**
 * Check if the viewer can see the shared (sanitized) AI analysis.
 * Available to all session participants when facilitator has published it.
 */
export function canViewSharedAiAnalysis(opts: {
  isSharedWithSession: boolean;
}): boolean {
  return opts.isSharedWithSession;
}

// ---------------------------------------------------------------------------
// Admin warning label
// ---------------------------------------------------------------------------

/**
 * i18n keys for admin private-view warning labels.
 * UI MUST render one of these whenever admin is viewing private role data.
 *   EN: "Admin view — contains private role data."
 *   RU: "Административный режим — содержит скрытые данные ролей."
 */
export const ADMIN_VIEW_WARNING_KEY = "admin.privateRoleDataWarning" as const;
