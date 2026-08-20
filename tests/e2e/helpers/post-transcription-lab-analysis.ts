import {
  bindParticipantPersonalFeedback,
  createMockAnalysisOutput,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import { parseCanonicalAnalysisOutput } from "@/lib/materials-ai-analysis-view";

export type LabAnalysisActor = {
  participantId: string;
  displayName: string;
  type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  roleName?: string;
};

export function buildLabCanonicalAnalysisJson(input: {
  scenarioId: string;
  buyer: LabAnalysisActor;
  seller: LabAnalysisActor;
  facilitator: LabAnalysisActor;
  observer: LabAnalysisActor;
}): NegotiationAnalysisOutput {
  const mock = createMockAnalysisOutput("ru");
  const buyerFeedback = mock.participantPersonalFeedback[0];
  const sellerFeedback = mock.participantPersonalFeedback[1];
  if (!buyerFeedback || !sellerFeedback) {
    throw new Error("createMockAnalysisOutput must expose two personal-feedback entries");
  }

  const analysis: NegotiationAnalysisOutput = {
    ...mock,
    executiveSummary: `${mock.executiveSummary} Сценарий ${input.scenarioId}: автоматическое сопоставление спикеров оставлено в AUTO_SUGGESTED без подтверждения.`,
    roleObjectivesAnalysis: [
      {
        participantName: input.buyer.displayName,
        roleName: input.buyer.roleName ?? "Buyer",
        objectiveProgress:
          "Покупатель продвинул график и удержал целевую цену, но уступил по предоплате.",
        evidence:
          "В транскрипте согласованы три недели, сто двадцать и схема оплаты двадцать плюс десять.",
        score: 74,
      },
      {
        participantName: input.seller.displayName,
        roleName: input.seller.roleName ?? "Seller",
        objectiveProgress:
          "Продавец защитил объём и резерв, но принял более ранний срок поставки.",
        evidence:
          "Зафиксированы двенадцать тысяч единиц, резерв три процента и опция плюс десять процентов.",
        score: 71,
      },
    ],
    participantPersonalFeedback: [
      {
        ...buyerFeedback,
        sessionParticipantId: input.buyer.participantId,
        participantName: input.buyer.displayName,
      },
      {
        ...sellerFeedback,
        sessionParticipantId: input.seller.participantId,
        participantName: input.seller.displayName,
      },
    ],
  };

  const bound = bindParticipantPersonalFeedback(analysis, [
    { id: input.buyer.participantId, displayName: input.buyer.displayName, type: input.buyer.type },
    { id: input.seller.participantId, displayName: input.seller.displayName, type: input.seller.type },
    {
      id: input.facilitator.participantId,
      displayName: input.facilitator.displayName,
      type: input.facilitator.type,
    },
    { id: input.observer.participantId, displayName: input.observer.displayName, type: input.observer.type },
  ]);

  const parsed = parseCanonicalAnalysisOutput(bound);
  if (!parsed.success) {
    throw new Error(
      `Lab AiAnalysis fixture failed the production reader: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return bound;
}
