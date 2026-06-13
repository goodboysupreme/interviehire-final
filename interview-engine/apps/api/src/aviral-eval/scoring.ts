import type {
  CandidateReport,
  EvaluationConfidence,
  EvaluationMode,
  InterviewContext,
  QuestionEvaluationConfig,
  Recommendation,
  ResponseEvaluation,
  SkillScore,
} from "./types.js";
import { getDimensionWeights } from "./rubrics.js";

export function inferEvaluationMode(question: QuestionEvaluationConfig): EvaluationMode {
  if (question.questionOrigin === "generated_followup") {
    return "followup_contextual";
  }

  if (question.modelAnswer || question.modelAnswerRubric) {
    return "model_answer_based";
  }

  return "rubric_only";
}

export function clampScore(score: number): number {
  if (Number.isNaN(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function weightedAverage(scores: Array<{ score: number; weight: number }>): number {
  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);

  if (totalWeight === 0) {
    return 0;
  }

  const totalScore = scores.reduce(
    (sum, item) => sum + clampScore(item.score) * item.weight,
    0,
  );

  return clampScore(totalScore / totalWeight);
}

export function calculateAnswerScore(
  evaluation: Pick<ResponseEvaluation, "dimensionScores">,
  context: Pick<InterviewContext, "interviewType">,
  question: QuestionEvaluationConfig,
): number {
  const weights = getDimensionWeights(context.interviewType, question.questionType);
  const weightedScores = Object.entries(weights)
    .filter(([dimension]) => evaluation.dimensionScores[dimension])
    .map(([dimension, weight]) => ({
      score: evaluation.dimensionScores[dimension].score,
      weight,
    }));

  if (weightedScores.length === 0) {
    const fallbackScores = Object.values(evaluation.dimensionScores).map((dimension) => ({
      score: dimension.score,
      weight: 1,
    }));

    return weightedAverage(fallbackScores);
  }

  return weightedAverage(weightedScores);
}

export function aggregateCandidateReport(
  context: InterviewContext,
  evaluations: ResponseEvaluation[],
): CandidateReport {
  const weightedEvaluations = evaluations.map((evaluation) => ({
    score: evaluation.overallScore,
    weight: getQuestionAggregationWeight(evaluation),
  }));
  const overallScore = weightedAverage(weightedEvaluations);
  const redFlags = evaluations.flatMap((evaluation) => evaluation.redFlags);
  const recommendation = getRecommendation(overallScore, redFlags);
  const recommendationConfidence = getRecommendationConfidence(evaluations);
  const skillScores = buildSkillScores(evaluations);

  return {
    interviewId: context.interviewId,
    candidateId: context.candidateId,
    roleTitle: context.roleTitle,
    interviewType: context.interviewType,
    overallScore,
    recommendation,
    recommendationConfidence,
    summary: buildSummary(overallScore, recommendation, recommendationConfidence),
    strengths: topUniqueStrings(evaluations.flatMap((evaluation) => evaluation.strengths), 6),
    weaknesses: topUniqueStrings(evaluations.flatMap((evaluation) => evaluation.weaknesses), 6),
    redFlags,
    skillScores,
    questionBreakdown: evaluations,
    suggestedNextSteps: topUniqueStrings(
      evaluations.flatMap((evaluation) => evaluation.followUpRecommendations),
      5,
    ),
    transcriptOnly: true,
    futureSignalPlaceholders: {
      audioAnalysisEnabled: false,
      videoAnalysisEnabled: false,
    },
  };
}

function getQuestionAggregationWeight(evaluation: ResponseEvaluation): number {
  const baseWeight = evaluation.questionOrigin === "predetermined" ? 1 : 0.7;
  const confidenceMultiplier: Record<EvaluationConfidence, number> = {
    high: 1,
    medium: 0.85,
    low: 0.6,
  };

  return baseWeight * confidenceMultiplier[evaluation.evaluationConfidence];
}

function getRecommendation(
  overallScore: number,
  redFlags: ResponseEvaluation["redFlags"],
): Recommendation {
  if (redFlags.some((flag) => flag.severity === "critical")) {
    return "needs_human_review";
  }

  if (redFlags.some((flag) => flag.severity === "high") && overallScore < 80) {
    return "hold";
  }

  if (overallScore >= 88) {
    return "strong_proceed";
  }

  if (overallScore >= 72) {
    return "proceed";
  }

  if (overallScore >= 55) {
    return "hold";
  }

  return "reject";
}

function getRecommendationConfidence(
  evaluations: ResponseEvaluation[],
): EvaluationConfidence {
  if (evaluations.length === 0) {
    return "low";
  }

  const lowConfidenceCount = evaluations.filter(
    (evaluation) => evaluation.evaluationConfidence === "low",
  ).length;
  const highConfidenceCount = evaluations.filter(
    (evaluation) => evaluation.evaluationConfidence === "high",
  ).length;

  if (lowConfidenceCount / evaluations.length >= 0.35) {
    return "low";
  }

  if (highConfidenceCount / evaluations.length >= 0.6) {
    return "high";
  }

  return "medium";
}

function buildSkillScores(evaluations: ResponseEvaluation[]): SkillScore[] {
  const dimensionMap = new Map<string, Array<{ score: number; answerId: string }>>();

  for (const evaluation of evaluations) {
    for (const [dimension, dimensionScore] of Object.entries(evaluation.dimensionScores)) {
      const existing = dimensionMap.get(dimension) ?? [];
      existing.push({ score: dimensionScore.score, answerId: evaluation.answerId });
      dimensionMap.set(dimension, existing);
    }
  }

  return Array.from(dimensionMap.entries()).map(([skill, values]) => ({
    skill,
    score: weightedAverage(values.map((value) => ({ score: value.score, weight: 1 }))),
    evidenceAnswerIds: values.map((value) => value.answerId),
  }));
}

function buildSummary(
  score: number,
  recommendation: Recommendation,
  confidence: EvaluationConfidence,
): string {
  return `Candidate scored ${score}/100 with a ${recommendation.replace(/_/g, " ")} recommendation and ${confidence} confidence based on transcript-only evaluation.`;
}

function topUniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }

    seen.add(normalized.toLowerCase());
    output.push(normalized);

    if (output.length >= limit) {
      break;
    }
  }

  return output;
}
