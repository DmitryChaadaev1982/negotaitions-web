"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CaseLanguage, Difficulty } from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
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
    negotiationDurationMinutes: fieldErrors.negotiationDurationMinutes,
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
  const roles = parseCaseRolesFromFormData(formData);

  const parsed = createCaseSchema.safeParse({
    title: formData.get("title"),
    businessContext: formData.get("businessContext"),
    publicInstructions: formData.get("publicInstructions"),
    caseLanguage: formData.get("caseLanguage") ?? "EN",
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    roles,
  });

  if (!parsed.success) {
    return mapCaseValidationErrors(parsed);
  }

  try {
    const facilitator = await getDemoFacilitator();
    const {
      title,
      businessContext,
      publicInstructions,
      caseLanguage,
      negotiationDurationMinutes,
      roles: caseRoles,
    } = parsed.data;

    const negotiationCase = await prisma.negotiationCase.create({
      data: {
        title,
        description: businessContext,
        businessContext,
        publicInstructions,
        targetSkills: "",
        difficulty: Difficulty.MEDIUM,
        caseLanguage: caseLanguage as CaseLanguage,
        defaultDurationSeconds:
          minutesToSeconds(
            negotiationDurationMinutes ??
              DEFAULT_NEGOTIATION_DURATION_SECONDS / 60,
          ),
        facilitatorId: facilitator.id,
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
  const roles = parseCaseRolesFromFormData(formData);

  const parsed = updateCaseSchema.safeParse({
    caseId: formData.get("caseId"),
    title: formData.get("title"),
    businessContext: formData.get("businessContext"),
    publicInstructions: formData.get("publicInstructions"),
    caseLanguage: formData.get("caseLanguage") ?? "EN",
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    roles,
  });

  if (!parsed.success) {
    return mapCaseValidationErrors(parsed);
  }

  try {
    const facilitator = await getDemoFacilitator();
    const {
      caseId,
      title,
      businessContext,
      publicInstructions,
      caseLanguage,
      negotiationDurationMinutes,
      roles: caseRoles,
    } = parsed.data;

    const existingCase = await prisma.negotiationCase.findFirst({
      where: {
        id: caseId,
        facilitatorId: facilitator.id,
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
          caseLanguage: caseLanguage as CaseLanguage,
          defaultDurationSeconds: minutesToSeconds(
            negotiationDurationMinutes ??
              DEFAULT_NEGOTIATION_DURATION_SECONDS / 60,
          ),
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
  const facilitator = await getDemoFacilitator();

  const existingCase = await prisma.negotiationCase.findFirst({
    where: {
      id: caseId,
      facilitatorId: facilitator.id,
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
  redirect("/cases");
}
