import {
  EmailMessageStatus,
  EmailMessageType,
  Prisma,
} from "@/app/generated/prisma/client";
import { maskEmailRecipient } from "@/lib/email/local-preview";
import { prisma } from "@/lib/prisma";

export const EMAIL_JOURNAL_ACTION_REVEAL = "EMAIL_CONTENT_REVEALED";
export const EMAIL_JOURNAL_MAX_SEARCH_LENGTH = 320;
export const EMAIL_JOURNAL_PAGE_SIZES = [20, 50] as const;
export const EMAIL_JOURNAL_DEFAULT_PAGE_SIZE = 20;

export const EMAIL_JOURNAL_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "lastAttemptAt",
  "status",
  "messageType",
  "attemptCount",
] as const;

export type EmailJournalSortField = (typeof EMAIL_JOURNAL_SORT_FIELDS)[number];
export type EmailJournalSortDirection = "asc" | "desc";

/** Statuses currently produced by the durable outbox without provider-event ingestion. */
export const EMAIL_JOURNAL_CURRENT_STATUSES = [
  EmailMessageStatus.PENDING,
  EmailMessageStatus.PROCESSING,
  EmailMessageStatus.ACCEPTED_BY_PROVIDER,
  EmailMessageStatus.ACCEPTANCE_UNKNOWN,
  EmailMessageStatus.SUPPRESSED,
  EmailMessageStatus.FAILED_RETRYABLE,
  EmailMessageStatus.FAILED_FINAL,
  EmailMessageStatus.CANCELLED,
] as const;

export type EmailJournalCurrentStatus =
  (typeof EMAIL_JOURNAL_CURRENT_STATUSES)[number];

export class EmailJournalInputError extends Error {}

export type EmailJournalListQuery = {
  q?: string;
  messageType?: EmailMessageType;
  status?: EmailMessageStatus;
  provider?: string;
  locale?: string;
  suppressed?: boolean;
  hasFailure?: boolean;
  hasProviderMessageId?: boolean;
  createdFrom?: Date;
  createdTo?: Date;
  sort: EmailJournalSortField;
  direction: EmailJournalSortDirection;
  page: number;
  pageSize: number;
};

export type EmailJournalListItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageType: EmailMessageType;
  templateKey: string;
  templateVersion: string;
  locale: string;
  recipientMasked: string;
  status: EmailMessageStatus;
  provider: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  providerMessageIdMasked: string | null;
  suppressed: boolean;
  failureSummary: string | null;
};

function allowlistedSort(value: string | null): EmailJournalSortField {
  if (!value) return "createdAt";
  if ((EMAIL_JOURNAL_SORT_FIELDS as readonly string[]).includes(value)) {
    return value as EmailJournalSortField;
  }
  throw new EmailJournalInputError("Invalid sort field.");
}

function allowlistedDirection(value: string | null): EmailJournalSortDirection {
  if (!value) return "desc";
  if (value === "asc" || value === "desc") return value;
  throw new EmailJournalInputError("Invalid sort direction.");
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
  label: string,
): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new EmailJournalInputError(`Invalid ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new EmailJournalInputError(`Invalid ${label}.`);
  }
  return parsed;
}

function parseOptionalDate(value: string | null, label: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EmailJournalInputError(`Invalid ${label}.`);
  }
  return date;
}

function parseOptionalBoolean(value: string | null, label: string): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new EmailJournalInputError(`Invalid ${label}.`);
}

function parseOptionalMessageType(
  value: string | null,
): EmailMessageType | undefined {
  if (!value) return undefined;
  if (!(Object.values(EmailMessageType) as string[]).includes(value)) {
    throw new EmailJournalInputError("Invalid message type.");
  }
  return value as EmailMessageType;
}

function parseOptionalStatus(value: string | null): EmailMessageStatus | undefined {
  if (!value) return undefined;
  if (!(Object.values(EmailMessageStatus) as string[]).includes(value)) {
    throw new EmailJournalInputError("Invalid status.");
  }
  return value as EmailMessageStatus;
}

function parseOptionalProvider(value: string | null): string | undefined {
  if (!value) return undefined;
  if (!/^[a-z0-9_]{1,64}$/i.test(value)) {
    throw new EmailJournalInputError("Invalid provider.");
  }
  return value.toLowerCase();
}

function parseOptionalLocale(value: string | null): string | undefined {
  if (!value) return undefined;
  if (value !== "ru" && value !== "en") {
    throw new EmailJournalInputError("Invalid locale.");
  }
  return value;
}

export function parseEmailJournalListQuery(
  searchParams: URLSearchParams,
): EmailJournalListQuery {
  const allowed = new Set([
    "q",
    "messageType",
    "status",
    "provider",
    "locale",
    "suppressed",
    "hasFailure",
    "hasProviderMessageId",
    "createdFrom",
    "createdTo",
    "sort",
    "direction",
    "page",
    "pageSize",
  ]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new EmailJournalInputError("Unsupported email journal query.");
    }
    if (searchParams.getAll(key).length > 1) {
      throw new EmailJournalInputError("Duplicate email journal query.");
    }
  }

  const qRaw = searchParams.get("q")?.trim() || undefined;
  if (qRaw && qRaw.length > EMAIL_JOURNAL_MAX_SEARCH_LENGTH) {
    throw new EmailJournalInputError("Search query is too long.");
  }

  const pageSize = parsePositiveInt(
    searchParams.get("pageSize"),
    EMAIL_JOURNAL_DEFAULT_PAGE_SIZE,
    Math.max(...EMAIL_JOURNAL_PAGE_SIZES),
    "pageSize",
  );
  if (!(EMAIL_JOURNAL_PAGE_SIZES as readonly number[]).includes(pageSize)) {
    throw new EmailJournalInputError("Invalid pageSize.");
  }

  const createdFrom = parseOptionalDate(searchParams.get("createdFrom"), "createdFrom");
  const createdTo = parseOptionalDate(searchParams.get("createdTo"), "createdTo");
  if (createdFrom && createdTo && createdFrom > createdTo) {
    throw new EmailJournalInputError("Invalid date range.");
  }

  return {
    q: qRaw,
    messageType: parseOptionalMessageType(searchParams.get("messageType")),
    status: parseOptionalStatus(searchParams.get("status")),
    provider: parseOptionalProvider(searchParams.get("provider")),
    locale: parseOptionalLocale(searchParams.get("locale")),
    suppressed: parseOptionalBoolean(searchParams.get("suppressed"), "suppressed"),
    hasFailure: parseOptionalBoolean(searchParams.get("hasFailure"), "hasFailure"),
    hasProviderMessageId: parseOptionalBoolean(
      searchParams.get("hasProviderMessageId"),
      "hasProviderMessageId",
    ),
    createdFrom,
    createdTo,
    sort: allowlistedSort(searchParams.get("sort")),
    direction: allowlistedDirection(searchParams.get("direction")),
    page: parsePositiveInt(searchParams.get("page"), 1, 10_000, "page"),
    pageSize,
  };
}

export function maskProviderMessageId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function failureSummaryForMessage(message: {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  status: EmailMessageStatus;
}): string | null {
  if (
    message.status !== EmailMessageStatus.FAILED_RETRYABLE &&
    message.status !== EmailMessageStatus.FAILED_FINAL &&
    message.status !== EmailMessageStatus.ACCEPTANCE_UNKNOWN &&
    !message.lastErrorCode &&
    !message.lastErrorMessage
  ) {
    return null;
  }
  if (message.lastErrorCode) return message.lastErrorCode;
  if (message.lastErrorMessage) {
    return message.lastErrorMessage.slice(0, 120);
  }
  return message.status;
}

function buildWhere(query: EmailJournalListQuery): Prisma.EmailMessageWhereInput {
  const where: Prisma.EmailMessageWhereInput = {};

  if (query.messageType) where.messageType = query.messageType;
  if (query.status) where.status = query.status;
  if (query.provider) where.providerName = query.provider;
  if (query.locale) where.locale = query.locale;
  if (query.suppressed === true) where.suppressedAt = { not: null };
  if (query.suppressed === false) where.suppressedAt = null;
  if (query.hasFailure === true) {
    where.OR = [
      { lastErrorCode: { not: null } },
      { lastErrorMessage: { not: null } },
      {
        status: {
          in: [
            EmailMessageStatus.FAILED_RETRYABLE,
            EmailMessageStatus.FAILED_FINAL,
            EmailMessageStatus.ACCEPTANCE_UNKNOWN,
          ],
        },
      },
    ];
  }
  if (query.hasFailure === false) {
    where.lastErrorCode = null;
    where.lastErrorMessage = null;
    where.status = {
      notIn: [
        EmailMessageStatus.FAILED_RETRYABLE,
        EmailMessageStatus.FAILED_FINAL,
        EmailMessageStatus.ACCEPTANCE_UNKNOWN,
      ],
    };
  }
  if (query.hasProviderMessageId === true) {
    where.lastProviderMessageId = { not: null };
  }
  if (query.hasProviderMessageId === false) {
    where.lastProviderMessageId = null;
  }
  if (query.createdFrom || query.createdTo) {
    where.createdAt = {
      ...(query.createdFrom ? { gte: query.createdFrom } : {}),
      ...(query.createdTo ? { lte: query.createdTo } : {}),
    };
  }

  if (query.q) {
    const term = query.q.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { id: term },
          { idempotencyKey: term },
          { lastProviderMessageId: term },
          { recipientEmailNormalized: term.toLowerCase() },
        ],
      },
    ];
  }

  return where;
}

function buildOrderBy(
  sort: EmailJournalSortField,
  direction: EmailJournalSortDirection,
): Prisma.EmailMessageOrderByWithRelationInput[] {
  const secondary: Prisma.EmailMessageOrderByWithRelationInput = { id: "desc" };
  switch (sort) {
    case "createdAt":
      return [{ createdAt: direction }, secondary];
    case "updatedAt":
      return [{ updatedAt: direction }, secondary];
    case "status":
      return [{ status: direction }, secondary];
    case "messageType":
      return [{ messageType: direction }, secondary];
    case "attemptCount":
      return [{ attemptCount: direction }, secondary];
    case "lastAttemptAt":
      return [{ sentAt: direction }, { updatedAt: direction }, secondary];
    default:
      return [{ createdAt: "desc" }, secondary];
  }
}

export async function listEmailJournal(query: EmailJournalListQuery): Promise<{
  items: EmailJournalListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where = buildWhere(query);
  const orderBy = buildOrderBy(query.sort, query.direction);
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await prisma.$transaction([
    prisma.emailMessage.count({ where }),
    prisma.emailMessage.findMany({
      where,
      orderBy,
      skip,
      take: query.pageSize,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        messageType: true,
        templateKey: true,
        templateVersion: true,
        locale: true,
        recipientEmail: true,
        recipientEmailNormalized: true,
        status: true,
        providerName: true,
        attemptCount: true,
        sentAt: true,
        nextAttemptAt: true,
        lastProviderMessageId: true,
        suppressedAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        attempts: {
          orderBy: { attemptNumber: "desc" },
          take: 1,
          select: { completedAt: true, startedAt: true },
        },
      },
    }),
  ]);

  const items: EmailJournalListItem[] = rows.map((row) => {
    const lastAttempt =
      row.attempts[0]?.completedAt ?? row.attempts[0]?.startedAt ?? row.sentAt;
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      messageType: row.messageType,
      templateKey: row.templateKey,
      templateVersion: row.templateVersion,
      locale: row.locale,
      recipientMasked: maskEmailRecipient(
        row.recipientEmail ?? row.recipientEmailNormalized,
      ),
      status: row.status,
      provider: row.providerName,
      attemptCount: row.attemptCount,
      lastAttemptAt: lastAttempt ? lastAttempt.toISOString() : null,
      nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
      providerMessageIdMasked: maskProviderMessageId(row.lastProviderMessageId),
      suppressed: row.suppressedAt != null,
      failureSummary: failureSummaryForMessage(row),
    };
  });

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export type EmailJournalDetail = {
  id: string;
  messageType: EmailMessageType;
  category: string;
  templateKey: string;
  templateVersion: string;
  locale: string;
  recipientMasked: string;
  status: EmailMessageStatus;
  provider: string;
  providerMessageIdMasked: string | null;
  attemptCount: number;
  suppressed: boolean;
  suppressedAt: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  terminalFailureAt: string | null;
  contentAvailable: boolean;
  contentClearedAt: string | null;
  failureSummary: string | null;
  userId: string | null;
  idempotencyKey: string;
  attempts: Array<{
    attemptNumber: number;
    provider: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    retryable: boolean;
    errorCode: string | null;
    errorSummary: string | null;
    providerMessageIdMasked: string | null;
  }>;
};

export async function getEmailJournalDetail(
  id: string,
): Promise<EmailJournalDetail | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new EmailJournalInputError("Invalid email message identifier.");
  }

  const row = await prisma.emailMessage.findUnique({
    where: { id },
    select: {
      id: true,
      messageType: true,
      category: true,
      templateKey: true,
      templateVersion: true,
      locale: true,
      recipientEmail: true,
      recipientEmailNormalized: true,
      status: true,
      providerName: true,
      lastProviderMessageId: true,
      attemptCount: true,
      suppressedAt: true,
      createdAt: true,
      updatedAt: true,
      processingAt: true,
      sentAt: true,
      nextAttemptAt: true,
      terminalFailureAt: true,
      contentClearedAt: true,
      renderedSubject: true,
      renderedTextBody: true,
      renderedHtmlBody: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      userId: true,
      idempotencyKey: true,
      attempts: {
        orderBy: { attemptNumber: "asc" },
        select: {
          attemptNumber: true,
          provider: true,
          status: true,
          startedAt: true,
          completedAt: true,
          retryable: true,
          normalizedErrorCode: true,
          sanitizedErrorMessage: true,
          providerMessageId: true,
        },
      },
    },
  });
  if (!row) return null;

  const contentAvailable =
    row.contentClearedAt == null &&
    Boolean(row.renderedSubject || row.renderedTextBody || row.renderedHtmlBody);

  return {
    id: row.id,
    messageType: row.messageType,
    category: row.category,
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    locale: row.locale,
    recipientMasked: maskEmailRecipient(
      row.recipientEmail ?? row.recipientEmailNormalized,
    ),
    status: row.status,
    provider: row.providerName,
    providerMessageIdMasked: maskProviderMessageId(row.lastProviderMessageId),
    attemptCount: row.attemptCount,
    suppressed: row.suppressedAt != null,
    suppressedAt: row.suppressedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processingAt: row.processingAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    terminalFailureAt: row.terminalFailureAt?.toISOString() ?? null,
    contentAvailable,
    contentClearedAt: row.contentClearedAt?.toISOString() ?? null,
    failureSummary: failureSummaryForMessage(row),
    userId: row.userId,
    idempotencyKey: row.idempotencyKey,
    attempts: row.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      provider: attempt.provider,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt?.toISOString() ?? null,
      retryable: attempt.retryable,
      errorCode: attempt.normalizedErrorCode,
      errorSummary: attempt.sanitizedErrorMessage
        ? attempt.sanitizedErrorMessage.slice(0, 160)
        : null,
      providerMessageIdMasked: maskProviderMessageId(attempt.providerMessageId),
    })),
  };
}

const RESET_TOKEN_QUERY =
  /([?&]token=)[a-f0-9]{64}/gi;
const RESET_TOKEN_BARE =
  /(^|[\s"'<>])(token=)[a-f0-9]{64}/gi;
const RESET_PATH_TOKEN =
  /(\/reset-password\?[^\s"'<>]*token=)[a-f0-9]{64}/gi;

export function redactPasswordResetSecrets(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(RESET_PATH_TOKEN, "$1[redacted]")
    .replace(RESET_TOKEN_QUERY, "$1[redacted]")
    .replace(RESET_TOKEN_BARE, "$1$2[redacted]");
}

export type EmailJournalRevealResult =
  | {
      available: true;
      subject: string | null;
      text: string | null;
      html: string | null;
      redacted: boolean;
    }
  | {
      available: false;
      reason: "cleared" | "missing";
    };

export async function revealEmailJournalContent(params: {
  messageId: string;
  adminUserId: string;
  requestId?: string | null;
}): Promise<EmailJournalRevealResult> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.messageId)) {
    throw new EmailJournalInputError("Invalid email message identifier.");
  }

  const row = await prisma.emailMessage.findUnique({
    where: { id: params.messageId },
    select: {
      id: true,
      messageType: true,
      contentClearedAt: true,
      renderedSubject: true,
      renderedTextBody: true,
      renderedHtmlBody: true,
      userId: true,
    },
  });
  if (!row) {
    return { available: false, reason: "missing" };
  }
  if (row.contentClearedAt) {
    await prisma.adminActionLog.create({
      data: {
        adminUserId: params.adminUserId,
        targetUserId: row.userId,
        action: EMAIL_JOURNAL_ACTION_REVEAL,
        metadata: {
          messageId: row.id,
          requestId: params.requestId ?? null,
          outcome: "cleared",
        },
      },
    });
    return { available: false, reason: "cleared" };
  }

  const hasContent = Boolean(
    row.renderedSubject || row.renderedTextBody || row.renderedHtmlBody,
  );
  if (!hasContent) {
    await prisma.adminActionLog.create({
      data: {
        adminUserId: params.adminUserId,
        targetUserId: row.userId,
        action: EMAIL_JOURNAL_ACTION_REVEAL,
        metadata: {
          messageId: row.id,
          requestId: params.requestId ?? null,
          outcome: "missing",
        },
      },
    });
    return { available: false, reason: "missing" };
  }

  const isPasswordReset = row.messageType === EmailMessageType.PASSWORD_RESET;
  const subject = isPasswordReset
    ? redactPasswordResetSecrets(row.renderedSubject)
    : row.renderedSubject;
  const text = isPasswordReset
    ? redactPasswordResetSecrets(row.renderedTextBody)
    : row.renderedTextBody;
  const html = isPasswordReset
    ? redactPasswordResetSecrets(row.renderedHtmlBody)
    : row.renderedHtmlBody;

  await prisma.adminActionLog.create({
    data: {
      adminUserId: params.adminUserId,
      targetUserId: row.userId,
      action: EMAIL_JOURNAL_ACTION_REVEAL,
      metadata: {
        messageId: row.id,
        requestId: params.requestId ?? null,
        outcome: "revealed",
        redacted: isPasswordReset,
      },
    },
  });

  return {
    available: true,
    subject,
    text,
    html,
    redacted: isPasswordReset,
  };
}
