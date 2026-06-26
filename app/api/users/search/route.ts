import { NextRequest, NextResponse } from "next/server";

import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { response: authError } = await apiRequireActiveUser();
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ users: [], message: "queryTooShort" }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 20,
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  return NextResponse.json({ users });
}
