import type {
  CandidateReport,
  EvaluationConfidence,
  EvaluationMode,
  InterviewContext,
  ProctoringSummary,
  ProctoringViolation,
  QuestionEvaluationConfig,
  RedFlagSeverity,
  Recommendation,
  ResponseEvaluation,
  ScoreBreakdown,
  SkillScore,
} from "./types.js";
import { getDimensionWeights } from "./rubrics.js";

// Per-answer content red-flag penalty (the LLM's redFlags on the answer itself).
const CONTENT_FLAG_PENALTY: Record<RedFlagSeverity, number> = {
  low: 2,
  medium: 5,
  high: 12,
  critical: 25,
};

// Proctoring (integrity) penalty per logged violation severity.
const PROCTORING_PENALTY: Record<string, number> = {
  LOW: 1,
  MEDIUM: 4,
  HIGH: 10,
  CRITICAL: 20,
};

// finalAnswerScore = 45% rubric coverage + 55% weighted dimensions − red-flag penalty
const RUBRIC_WEIGHT = 0.45;
const DIMENSION_WEIGHT = 0.55;

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

// Weighted dimension score (0-100) using the role/question-adjusted weights.
export function computeWeightedDimensionScore(
  evaluation: Pick<ResponseEvaluation, "dimensionScores">,
  context: Pick<InterviewContext, "interviewType">,
  question: QuestionEvaluationConfig,
): number {
  return calculateAnswerScore(evaluation, context, question);
}

// Rubric coverage (0-100): how many of the required model-answer concepts the
// candidate covered, plus a little credit for bonus points, minus credit for
// incorrect claims. Falls back to the LLM's own overallScore when the question
// has no structured rubric / comparison to score against.
export function computeRubricCoverageScore(
  evaluation: ResponseEvaluation,
  question: QuestionEvaluationConfig,
): number {
  const cmp = evaluation.modelAnswerComparison;
  const rubric = question.modelAnswerRubric;

  if (!cmp) {
    return clampScore(evaluation.overallScore);
  }

  const covered = (cmp.coveredRequiredPoints ?? []).length;
  const missed = (cmp.missedRequiredPoints ?? []).length;
  const requiredTotal = rubric?.requiredPoints?.length || covered + missed;

  if (requiredTotal === 0) {
    // No required points to measure → use bonus/incorrect signal around the LLM score.
    const base = clampScore(evaluation.overallScore);
    const bonus = Math.min(10, (cmp.coveredBonusPoints ?? []).length * 3);
    const wrong = Math.min(40, (cmp.incorrectClaims ?? []).length * 12);
    return clampScore(base + bonus - wrong);
  }

  const coverage = (covered / requiredTotal) * 100;
  const bonus = Math.min(10, (cmp.coveredBonusPoints ?? []).length * 3);
  const wrong = Math.min(35, (cmp.incorrectClaims ?? []).length * 12);
  return clampScore(coverage + bonus - wrong);
}

export function computeRedFlagPenalty(evaluation: ResponseEvaluation): number {
  const raw = (evaluation.redFlags ?? []).reduce(
    (sum, flag) => sum + (CONTENT_FLAG_PENALTY[flag.severity] ?? 0),
    0,
  );
  return Math.min(40, raw);
}

// finalAnswerScore = 0.45*rubricCoverage + 0.55*weightedDimensions − redFlagPenalty.
// Mutates the evaluation to carry the breakdown, and sets overallScore = finalScore
// so the report aggregation runs on the final, penalty-adjusted number.
export function enrichEvaluationScores(
  evaluation: ResponseEvaluation,
  context: Pick<InterviewContext, "interviewType">,
  question: QuestionEvaluationConfig,
): ResponseEvaluation {
  const dimensionScore = computeWeightedDimensionScore(evaluation, context, question);
  const rubricCoverageScore = computeRubricCoverageScore(evaluation, question);
  const redFlagPenalty = computeRedFlagPenalty(evaluation);
  const finalScore = clampScore(
    RUBRIC_WEIGHT * rubricCoverageScore + DIMENSION_WEIGHT * dimensionScore - redFlagPenalty,
  );

  return {
    ...evaluation,
    rawLlmScore: evaluation.overallScore,
    rubricCoverageScore,
    dimensionScore,
    redFlagPenalty,
    finalScore,
    overallScore: finalScore,
  };
}

// ── Proctoring (integrity) ─────────────────────────────────────────────────────
export interface ProctoringLogLike {
  eventType: string;
  severity: string;
  occurredAt?: Date | string | null;
  metadata?: unknown;
}

export function buildProctoringSummary(logs: ProctoringLogLike[]): ProctoringSummary {
  const bySeverity: Record<string, number> = {};
  let penalty = 0;
  const violations: ProctoringViolation[] = [];

  for (const log of logs) {
    const sev = String(log.severity || "").toUpperCase();
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    penalty += PROCTORING_PENALTY[sev] ?? 0;
    let detail: string | undefined;
    if (log.metadata && typeof log.metadata === "object") {
      const m = log.metadata as Record<string, unknown>;
      detail = (m.detail || m.message || m.reason || m.note) as string | undefined;
    }
    violations.push({
      eventType: log.eventType,
      severity: (["low", "medium", "high", "critical"].includes(sev.toLowerCase())
        ? sev.toLowerCase()
        : "medium") as RedFlagSeverity,
      occurredAt: log.occurredAt ? new Date(log.occurredAt).toISOString() : undefined,
      detail,
    });
  }

  penalty = Math.min(40, penalty);
  return {
    totalEvents: logs.length,
    bySeverity,
    penalty,
    integrityScore: clampScore(100 - penalty),
    violations,
  };
}

// Attach the proctoring summary + the explicit score-analysis breakdown to a report
// and fold the proctoring penalty into the final overall score.
export function applyProctoringToReport(
  report: CandidateReport,
  evaluations: ResponseEvaluation[],
  proctoring: ProctoringSummary,
): CandidateReport {
  const answerAggregate = report.overallScore; // already the weighted aggregate of finalScores
  const avg = (pick: (e: ResponseEvaluation) => number | undefined) => {
    const vals = evaluations.map(pick).filter((v): v is number => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  const scoreBreakdown: ScoreBreakdown = {
    rubricCoverageAvg: avg((e) => e.rubricCoverageScore),
    dimensionAvg: avg((e) => e.dimensionScore),
    redFlagPenaltyAvg: avg((e) => e.redFlagPenalty),
    answerAggregate,
    proctoringPenalty: proctoring.penalty,
    finalScore: clampScore(answerAggregate - proctoring.penalty),
    formula: "finalAnswerScore = 45% rubric coverage + 55% weighted dimensions − content red-flag penalty; overall − proctoring penalty",
  };

  const overallScore = scoreBreakdown.finalScore;
  return {
    ...report,
    overallScore,
    recommendation: getRecommendation(overallScore, report.redFlags),
    proctoring,
    scoreBreakdown,
  };
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
