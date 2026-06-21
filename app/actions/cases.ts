"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Difficulty } from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
import {
  DEFAULT_NEGOTIATION_DURATION_SECONDS,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { createCaseSchema } from "@/lib/validations/case";

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

export async function createCase(
  _prevState: CreateCaseState,
  formData: FormData,
): Promise<CreateCaseState> {
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

  const parsed = createCaseSchema.safeParse({
    title: formData.get("title"),
    businessContext: formData.get("businessContext"),
    publicInstructions: formData.get("publicInstructions"),
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    roles,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const roleErrors = parsed.error.issues
      .filter((issue) => issue.path[0] === "roles" && issue.path.length === 1)
      .map((issue) => issue.message);

    const errors: CreateCaseState["errors"] = {
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

  try {
    const facilitator = await getDemoFacilitator();
    const {
      title,
      businessContext,
      publicInstructions,
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
            : "Unable to create case. Please try again.",
        ],
      },
    };
  }
}
