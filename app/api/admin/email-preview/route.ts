import { NextResponse } from "next/server";

import { apiRequireActiveAdminUser } from "@/lib/auth/api-guards";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { getEmailConfig } from "@/lib/email/config";
import {
  isLocalEmailPreviewAvailable,
  LOCAL_EMAIL_PREVIEW_TYPES,
  LocalEmailPreviewInputError,
  maskEmailRecipient,
  parseLocalEmailPreviewId,
  parseLocalEmailPreviewListQuery,
} from "@/lib/email/local-preview";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function unavailableResponse() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function isAvailable() {
  return isLocalEmailPreviewAvailable({
    nodeEnv: process.env.NODE_ENV,
    config: getEmailConfig(),
  });
}

function inputErrorResponse(error: unknown) {
  if (error instanceof LocalEmailPreviewInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(
    { error: "Unable to load local email preview." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  if (!isAvailable()) return unavailableResponse();

  const { response } = await apiRequireActiveAdminUser();
  if (response) return response;

  try {
    const query = parseLocalEmailPreviewListQuery(
      new URL(request.url).searchParams,
    );
    const messages = await prisma.emailMessage.findMany({
      where: {
        providerName: "fake",
        messageType: query.type ?? { in: [...LOCAL_EMAIL_PREVIEW_TYPES] },
      },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      select: {
        id: true,
        messageType: true,
        status: true,
        recipientEmail: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        items: messages.map((message) => ({
          id: message.id,
          type: message.messageType,
          status: message.status,
          recipient: maskEmailRecipient(message.recipientEmail),
          createdAt: message.createdAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return inputErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isAvailable()) return unavailableResponse();

  const { response } = await apiRequireActiveAdminUser();
  if (response) return response;

  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json(
        { error: "Request origin is not allowed." },
        { status: 403 },
      );
    }
    const body = await request.json().catch(() => {
      throw new LocalEmailPreviewInputError("Invalid email preview request.");
    });
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, "id")
    ) {
      throw new LocalEmailPreviewInputError(
        "Only an email preview identifier is accepted.",
      );
    }
    const id = parseLocalEmailPreviewId(
      (body as Record<string, unknown>).id,
    );
    const message = await prisma.emailMessage.findFirst({
      where: {
        id,
        providerName: "fake",
        messageType: { in: [...LOCAL_EMAIL_PREVIEW_TYPES] },
      },
      select: {
        renderedSubject: true,
        renderedTextBody: true,
        renderedHtmlBody: true,
      },
    });
    if (!message) return unavailableResponse();

    return NextResponse.json(
      {
        subject: message.renderedSubject,
        text: message.renderedTextBody,
        html: message.renderedHtmlBody,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return inputErrorResponse(error);
  }
}
