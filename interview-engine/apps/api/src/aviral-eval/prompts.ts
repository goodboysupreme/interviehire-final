import type { CandidateResponseInput, InterviewContext, QuestionEvaluationConfig } from "./types.js";
import { getDimensionWeights, normalizeWeights } from "./rubrics.js";
import { inferEvaluationMode } from "./scoring.js";

export function buildRubricExtractionPrompt(question: QuestionEvaluationConfig): string {
  return [
    "Convert the model answer into a structured evaluation rubric.",
    "Do not treat the model answer as the only valid wording. Extract concepts and mistakes.",
    "Return strict JSON only.",
    "",
    `Question: ${question.questionText}`,
    `Question type: ${question.questionType}`,
    `Difficulty: ${question.difficulty ?? "not specified"}`,
    `Model answer: ${question.modelAnswer ?? ""}`,
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        requiredPoints: [
          {
            id: "short_snake_case_id",
            description: "Concept the candidate must cover.",
            weight: 25,
          },
        ],
        bonusPoints: [
          {
            id: "short_snake_case_id",
            description: "Extra strong answer signal.",
            weight: 10,
          },
        ],
        redFlags: [
          {
            id: "short_snake_case_id",
            description: "Clearly incorrect or risky claim.",
            severity: "low | medium | high | critical",
          },
        ],
        notes: "Any evaluation guidance.",
      },
      null,
      2,
    ),
  ].join("\n");
}

export function buildAnswerEvaluationPrompt(
  context: InterviewContext,
  input: CandidateResponseInput,
): string {
  const mode = inferEvaluationMode(input.question);

  if (mode === "followup_contextual") {
    return buildFollowupEvaluationPrompt(context, input);
  }

  const weights = normalizeWeights(
    getDimensionWeights(context.interviewType, input.question.questionType),
  );

  return [
    "Evaluate the candidate response for an interview report.",
    "Use transcript content only. Ignore audio/video behavior unless explicit structured signals are provided.",
    "Score fairly for equivalent correct ideas, even when wording differs from the model answer.",
    "Do not invent evidence. Keep evidence quotes short.",
    "Return strict JSON only.",
    "",
    `Role: ${context.roleTitle}`,
    `Role level: ${context.roleLevel ?? "not specified"}`,
    `Interview type: ${context.interviewType}`,
    `Must-have skills: ${(context.mustHaveSkills ?? []).join(", ") || "not specified"}`,
    `Question type: ${input.question.questionType}`,
    `Evaluation mode: ${mode}`,
    `Dimension weights: ${JSON.stringify(weights)}`,
    "",
    `Question: ${input.question.questionText}`,
    `Model answer: ${input.question.modelAnswer ?? "not available"}`,
    `Structured model rubric: ${JSON.stringify(input.question.modelAnswerRubric ?? null)}`,
    "",
    `Candidate transcript: ${input.response.transcript}`,
    "",
    "Required JSON shape:",
    getEvaluationJsonShape(mode),
  ].join("\n");
}

export function buildFollowupEvaluationPrompt(
  context: InterviewContext,
  input: CandidateResponseInput,
): string {
  const weights = normalizeWeights(getDimensionWeights(context.interviewType, "followup"));

  return [
    "Evaluate a generated follow-up answer as a continuation of the original answer.",
    "The follow-up should be judged on directness, depth expansion, consistency, adaptability, correctness, and communication.",
    "Use transcript content only. Do not infer audio/video signals.",
    "Return strict JSON only.",
    "",
    `Role: ${context.roleTitle}`,
    `Role level: ${context.roleLevel ?? "not specified"}`,
    `Interview type: ${context.interviewType}`,
    `Dimension weights: ${JSON.stringify(weights)}`,
    "",
    `Original question: ${input.followupContext?.originalQuestionText ?? "not available"}`,
    `Original candidate transcript: ${input.followupContext?.originalTranscript ?? "not available"}`,
    `Generated follow-up question: ${
      input.followupContext?.generatedFollowupQuestion ?? input.question.questionText
    }`,
    `Follow-up candidate transcript: ${input.response.transcript}`,
    "",
    "Required JSON shape:",
    getEvaluationJsonShape("followup_contextual"),
  ].join("\n");
}

function getEvaluationJsonShape(mode: string): string {
  const baseShape = {
    answerId: "answer id from input",
    questionId: "question id from input",
    questionOrigin: "predetermined | generated_followup",
    evaluationMode: mode,
    overallScore: 0,
    dimensionScores: {
      dimension_name: {
        score: 0,
        reason: "Short reason.",
        evidence: ["Short transcript evidence."],
        missing: ["Important missing item."],
      },
    },
    strengths: ["Concrete strength."],
    weaknesses: ["Concrete weakness."],
    redFlags: [
      {
        label: "Red flag label.",
        severity: "low | medium | high | critical",
        reason: "Why this matters.",
      },
    ],
    followUpRecommendations: ["Suggested probe for next round."],
    evaluationConfidence: "high | medium | low",
    summary: "One-paragraph answer summary.",
    transcriptOnly: true,
  };

  if (mode === "followup_contextual") {
    return JSON.stringify(
      {
        ...baseShape,
        followupAnalysis: {
          addressedFollowup: true,
          improvedPreviousAnswer: true,
          contradictedPreviousAnswer: false,
          handledProbeWell: true,
          followupValue: "high | medium | low",
          reason: "What signal the follow-up added.",
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      ...baseShape,
      modelAnswerComparison: {
        coveredRequiredPoints: ["Required point id or description."],
        missedRequiredPoints: ["Required point id or description."],
        coveredBonusPoints: ["Bonus point id or description."],
        incorrectClaims: ["Incorrect claim from transcript."],
      },
    },
    null,
    2,
  );
}
