"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  CaseLanguage,
  Difficulty,
  VisibilityLevel,
} from "@/app/generated/prisma/client";
import { requireActiveUser, requireAdminUser } from "@/lib/auth";
import {
  DEFAULT_NEGOTIATION_DURATION_SECONDS,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";
import { createCaseSchema, updateCaseSchema } from "@/lib/validations/case";

export type CreateCaseState = {
  errors?: {
    title?: string[];
    businessContext?: string[];
    publicInstructions?: string[];
    roles?: string[];
    form?: string[];
    [key: string]: string[] | undefined;
  };
};

function parseCaseRolesFromFormData(formData: FormData) {
  const roles: { name: string; privateInstructions: string }[] = [];
  const roleCount = Number(formData.get("roleCount") ?? 0);

  for (let index = 0; index < roleCount; index += 1) {
    roles.push({
      name: String(formData.get(`roles.${index}.name`) ?? ""),
      privateInstructions: String(
        formData.get(`roles.${index}.privateInstructions`) ?? "",
      ),
    });
  }

  return roles;
}

function mapCaseValidationErrors(
  parsed: ReturnType<typeof createCaseSchema.safeParse>,
): CreateCaseState {
  if (parsed.success) {
    return {};
  }

  const fieldErrors = parsed.error.flatten().fieldErrors;
  const roleErrors = parsed.error.issues
    .filter((issue) => issue.path[0] === "roles" && issue.path.length === 1)
    .map((issue) => issue.message);

  const errors: NonNullable<CreateCaseState["errors"]> = {
    title: fieldErrors.title,
    businessContext: fieldErrors.businessContext,
    publicInstructions: fieldErrors.publicInstructions,
    difficulty: fieldErrors.difficulty,
    defaultDurationMinutes: fieldErrors.negotiationDurationMinutes,
    preparationDurationMinutes: fieldErrors.preparationDurationMinutes,
    negotiationDurationMinutes: fieldErrors.negotiationDurationMinutes,
    visibility: fieldErrors.visibility,
  };

  if (roleErrors.length > 0) {
    errors.roles = roleErrors;
  }

  parsed.error.issues.forEach((issue) => {
    if (issue.path[0] === "roles" && typeof issue.path[1] === "number") {
      const roleIndex = issue.path[1];
      const field = issue.path[2];

      if (field === "name") {
        errors[`roles.${roleIndex}.name`] = [issue.message];
      }

      if (field === "privateInstructions") {
        errors[`roles.${roleIndex}.privateInstructions`] = [issue.message];
      }
    }
  });

  return { errors };
}

export async function createCase(
  _prevState: CreateCaseState,
  formData: FormData,
): Promise<CreateCaseState> {
  const user = await requireActiveUser("/cases/new");

  const roles = parseCaseRolesFromFormData(formData);

  const parsed = createCaseSchema.safeParse({
    title: formData.get("title"),
    businessContext: formData.get("businessContext"),
    publicInstructions: formData.get("publicInstructions"),
    difficulty: formData.get("difficulty") ?? "MEDIUM",
    caseLanguage: formData.get("caseLanguage") ?? "EN",
    visibility: formData.get("visibility") ?? "PRIVATE",
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    preparationDurationMinutes: formData.get("preparationDurationMinutes"),
    roles,
  });

  if (!parsed.success) {
    return mapCaseValidationErrors(parsed);
  }

  try {
    const {
      title,
      businessContext,
      publicInstructions,
      difficulty,
      caseLanguage,
      visibility,
      negotiationDurationMinutes,
      preparationDurationMinutes,
      roles: caseRoles,
    } = parsed.data;

    const negotiationCase = await prisma.negotiationCase.create({
      data: {
        title,
        description: businessContext,
        businessContext,
        publicInstructions,
        targetSkills: "",
        difficulty: difficulty as Difficulty,
        caseLanguage: caseLanguage as CaseLanguage,
        defaultPreparationDurationSeconds: minutesToSeconds(
          preparationDurationMinutes ?? 5,
        ),
        defaultDurationSeconds: minutesToSeconds(
          negotiationDurationMinutes ??
            DEFAULT_NEGOTIATION_DURATION_SECONDS / 60,
        ),
        facilitatorId: user.id,
        createdByUserId: user.id,
        visibility: visibility as VisibilityLevel,
        roles: {
          create: caseRoles.map((role, index) => ({
            name: role.name,
            privateInstructions: role.privateInstructions,
            objectives: "",
            constraints: "",
            hiddenInfo: "",
            fallbackPosition: "",
            sortOrder: index,
          })),
        },
      },
    });

    revalidatePath("/cases");
    revalidatePath("/dashboard");
    redirect(`/cases/${negotiationCase.id}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }

    return {
      errors: {
        form: [
          error instanceof Error
            ? error.message
            : "createCaseFailed",
        ],
      },
    };
  }
}

export async function updateCase(
  _prevState: CreateCaseState,
  formData: FormData,
): Promise<CreateCaseState> {
  await requireAdminUser();

  const roles = parseCaseRolesFromFormData(formData);

  const parsed = updateCaseSchema.safeParse({
    caseId: formData.get("caseId"),
    title: formData.get("title"),
    businessContext: formData.get("businessContext"),
    publicInstructions: formData.get("publicInstructions"),
    difficulty: formData.get("difficulty") ?? "MEDIUM",
    caseLanguage: formData.get("caseLanguage") ?? "EN",
    visibility: formData.get("visibility") ?? "PRIVATE",
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    preparationDurationMinutes: formData.get("preparationDurationMinutes"),
    roles,
  });

  if (!parsed.success) {
    return mapCaseValidationErrors(parsed);
  }

  try {
    const {
      caseId,
      title,
      businessContext,
      publicInstructions,
      difficulty,
      caseLanguage,
      visibility,
      negotiationDurationMinutes,
      preparationDurationMinutes,
      roles: caseRoles,
    } = parsed.data;

    const existingCase = await prisma.negotiationCase.findFirst({
      where: {
        id: caseId,
        ...activeCaseWhere,
      },
    });

    if (!existingCase) {
      return {
        errors: {
          form: ["caseNotFound"],
        },
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.negotiationCase.update({
        where: { id: caseId },
        data: {
          title,
          description: businessContext,
          businessContext,
          publicInstructions,
          difficulty: difficulty as Difficulty,
          caseLanguage: caseLanguage as CaseLanguage,
          defaultPreparationDurationSeconds: minutesToSeconds(
            preparationDurationMinutes ?? 5,
          ),
          defaultDurationSeconds: minutesToSeconds(
            negotiationDurationMinutes ??
              DEFAULT_NEGOTIATION_DURATION_SECONDS / 60,
          ),
          visibility: visibility as VisibilityLevel,
        },
      });

      await tx.caseRole.deleteMany({
        where: { negotiationCaseId: caseId },
      });

      await tx.caseRole.createMany({
        data: caseRoles.map((role, index) => ({
          negotiationCaseId: caseId,
          name: role.name,
          privateInstructions: role.privateInstructions,
          objectives: "",
          constraints: "",
          hiddenInfo: "",
          fallbackPosition: "",
          sortOrder: index,
        })),
      });
    });

    revalidatePath("/cases");
    revalidatePath(`/cases/${caseId}`);
    revalidatePath(`/cases/${caseId}/edit`);
    revalidatePath("/dashboard");
    redirect(`/cases/${caseId}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }

    return {
      errors: {
        form: [
          error instanceof Error
            ? error.message
            : "updateCaseFailed",
        ],
      },
    };
  }
}

export async function deleteCase(caseId: string) {
  await requireAdminUser();

  const existingCase = await prisma.negotiationCase.findFirst({
    where: {
      id: caseId,
      ...activeCaseWhere,
    },
  });

  if (!existingCase) {
    return;
  }

  await prisma.negotiationCase.update({
    where: { id: caseId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/dashboard");
  revalidatePath("/sessions/new");
  revalidatePath("/events");
  redirect("/cases");
}
