import type { EvaluationConfidence, ResponseEvaluation } from "./types.js";
import { clampScore } from "./scoring.js";

export interface EvaluationValidationResult {
  valid: boolean;
  issues: string[];
  normalized?: ResponseEvaluation;
}

const CONFIDENCE_VALUES: EvaluationConfidence[] = ["high", "medium", "low"];

export function validateResponseEvaluation(
  evaluation: ResponseEvaluation,
): EvaluationValidationResult {
  const issues: string[] = [];

  if (!evaluation.answerId) {
    issues.push("Missing answerId.");
  }

  if (!evaluation.questionId) {
    issues.push("Missing questionId.");
  }

  if (!evaluation.dimensionScores || Object.keys(evaluation.dimensionScores).length === 0) {
    issues.push("At least one dimension score is required.");
  }

  if (!CONFIDENCE_VALUES.includes(evaluation.evaluationConfidence)) {
    issues.push("evaluationConfidence must be high, medium, or low.");
  }

  for (const [dimension, score] of Object.entries(evaluation.dimensionScores ?? {})) {
    if (!score.reason) {
      issues.push(`Dimension ${dimension} is missing a reason.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    normalized: normalizeResponseEvaluation(evaluation),
  };
}

export function normalizeResponseEvaluation(evaluation: ResponseEvaluation): ResponseEvaluation {
  return {
    ...evaluation,
    overallScore: clampScore(evaluation.overallScore),
    strengths: normalizeStringArray(evaluation.strengths ?? []),
    weaknesses: normalizeStringArray(evaluation.weaknesses ?? []),
    followUpRecommendations: normalizeStringArray(evaluation.followUpRecommendations ?? []),
    redFlags: evaluation.redFlags ?? [],
    transcriptOnly: true,
    dimensionScores: Object.fromEntries(
      Object.entries(evaluation.dimensionScores ?? {}).map(([dimension, score]) => [
        dimension,
        {
          ...score,
          score: clampScore(score.score),
          evidence: normalizeStringArray(score.evidence ?? []),
          missing: normalizeStringArray(score.missing ?? []),
        },
      ]),
    ),
  };
}

function normalizeStringArray(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}
