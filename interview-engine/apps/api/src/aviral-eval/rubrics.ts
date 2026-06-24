import type { InterviewType, QuestionType } from "./types.js";

export type DimensionWeights = Record<string, number>;

// Canonical evaluation dimensions (sum to 100). Every interview/question type uses
// THESE SAME KEYS so the LLM, the scoring, and the report stay consistent — only the
// weights are "dynamically adjusted for different job roles" below.
export const DIMENSION_KEYS = [
  "model_answer_alignment",
  "factual_correctness",
  "completeness",
  "reasoning_quality",
  "clarity_structure",
  "role_level_alignment",
  "communication_quality",
] as const;

export const UNIVERSAL_DIMENSIONS: DimensionWeights = {
  model_answer_alignment: 25,
  factual_correctness: 20,
  completeness: 15,
  reasoning_quality: 15,
  clarity_structure: 10,
  role_level_alignment: 10,
  communication_quality: 5,
};

// Per-interview-type adjustments (same 7 keys, re-weighted for what the role values).
export const INTERVIEW_TYPE_WEIGHTS: Record<InterviewType, DimensionWeights> = {
  technical: {
    model_answer_alignment: 25,
    factual_correctness: 25,
    completeness: 15,
    reasoning_quality: 15,
    clarity_structure: 8,
    role_level_alignment: 7,
    communication_quality: 5,
  },
  system_design: {
    model_answer_alignment: 15,
    factual_correctness: 15,
    completeness: 15,
    reasoning_quality: 30, // tradeoffs / architecture reasoning dominates
    clarity_structure: 12,
    role_level_alignment: 8,
    communication_quality: 5,
  },
  behavioral: {
    model_answer_alignment: 10,
    factual_correctness: 10,
    completeness: 15,
    reasoning_quality: 20, // ownership / reflection
    clarity_structure: 15,
    role_level_alignment: 15,
    communication_quality: 15,
  },
  case_study: {
    model_answer_alignment: 15,
    factual_correctness: 15,
    completeness: 15,
    reasoning_quality: 30, // analysis / business judgment
    clarity_structure: 12,
    role_level_alignment: 8,
    communication_quality: 5,
  },
  sales: {
    model_answer_alignment: 10,
    factual_correctness: 10,
    completeness: 12,
    reasoning_quality: 18,
    clarity_structure: 15,
    role_level_alignment: 15,
    communication_quality: 20, // persuasion / empathy
  },
  hr_screening: {
    model_answer_alignment: 10,
    factual_correctness: 12,
    completeness: 13,
    reasoning_quality: 12,
    clarity_structure: 13,
    role_level_alignment: 25, // fit / motivation
    communication_quality: 15,
  },
  mixed: UNIVERSAL_DIMENSIONS,
  custom: UNIVERSAL_DIMENSIONS,
};

// Per-question-type overrides (still the 7 canonical keys).
export const QUESTION_TYPE_WEIGHTS: Partial<Record<QuestionType, DimensionWeights>> = {
  technical_theory: {
    model_answer_alignment: 28,
    factual_correctness: 27,
    completeness: 15,
    reasoning_quality: 12,
    clarity_structure: 8,
    role_level_alignment: 5,
    communication_quality: 5,
  },
  coding: {
    model_answer_alignment: 20,
    factual_correctness: 30, // algorithm correctness
    completeness: 15, // edge cases
    reasoning_quality: 20, // complexity / approach
    clarity_structure: 7,
    role_level_alignment: 4,
    communication_quality: 4,
  },
  system_design: INTERVIEW_TYPE_WEIGHTS.system_design,
  behavioral: INTERVIEW_TYPE_WEIGHTS.behavioral,
  case_study: INTERVIEW_TYPE_WEIGHTS.case_study,
  sales_roleplay: INTERVIEW_TYPE_WEIGHTS.sales,
  hr_screening: INTERVIEW_TYPE_WEIGHTS.hr_screening,
  followup: {
    model_answer_alignment: 15,
    factual_correctness: 20,
    completeness: 20, // depth expansion
    reasoning_quality: 20, // adaptability / consistency
    clarity_structure: 10,
    role_level_alignment: 5,
    communication_quality: 10,
  },
};

export function getDimensionWeights(
  interviewType: InterviewType,
  questionType?: QuestionType,
): DimensionWeights {
  if (questionType && QUESTION_TYPE_WEIGHTS[questionType]) {
    return QUESTION_TYPE_WEIGHTS[questionType] as DimensionWeights;
  }

  return INTERVIEW_TYPE_WEIGHTS[interviewType] ?? UNIVERSAL_DIMENSIONS;
}

export function normalizeWeights(weights: DimensionWeights): DimensionWeights {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

  if (total === 0) {
    return weights;
  }

  return Object.fromEntries(
    Object.entries(weights).map(([dimension, weight]) => [
      dimension,
      Number(((weight / total) * 100).toFixed(2)),
    ]),
  );
}
