import type { InterviewType, QuestionType } from "./types.js";

export type DimensionWeights = Record<string, number>;

export const UNIVERSAL_DIMENSIONS: DimensionWeights = {
  relevance: 15,
  correctness: 20,
  completeness: 15,
  depth: 15,
  clarity: 15,
  communication: 10,
  role_alignment: 10,
};

export const INTERVIEW_TYPE_WEIGHTS: Record<InterviewType, DimensionWeights> = {
  technical: {
    correctness: 30,
    completeness: 20,
    depth: 20,
    clarity: 10,
    communication: 10,
    role_alignment: 10,
  },
  behavioral: {
    relevance: 15,
    ownership: 20,
    impact: 20,
    reflection: 15,
    clarity: 15,
    role_alignment: 15,
  },
  system_design: {
    requirements_understanding: 15,
    architecture: 20,
    tradeoffs: 20,
    scalability: 15,
    failure_handling: 15,
    communication: 15,
  },
  case_study: {
    problem_framing: 20,
    analysis_quality: 25,
    business_judgment: 20,
    recommendation_quality: 15,
    clarity: 10,
    role_alignment: 10,
  },
  sales: {
    discovery_quality: 20,
    objection_handling: 20,
    customer_empathy: 15,
    persuasion: 15,
    structure: 15,
    communication: 15,
  },
  hr_screening: {
    relevance: 20,
    motivation: 20,
    role_alignment: 25,
    clarity: 15,
    professionalism: 10,
    risk_flags: 10,
  },
  mixed: UNIVERSAL_DIMENSIONS,
  custom: UNIVERSAL_DIMENSIONS,
};

export const QUESTION_TYPE_WEIGHTS: Partial<Record<QuestionType, DimensionWeights>> = {
  technical_theory: {
    correctness: 30,
    concept_coverage: 25,
    depth: 15,
    clarity: 15,
    examples: 10,
    communication: 5,
  },
  coding: {
    problem_understanding: 15,
    algorithm_correctness: 30,
    edge_cases: 15,
    complexity_analysis: 15,
    code_quality: 15,
    communication: 10,
  },
  system_design: INTERVIEW_TYPE_WEIGHTS.system_design,
  behavioral: INTERVIEW_TYPE_WEIGHTS.behavioral,
  case_study: INTERVIEW_TYPE_WEIGHTS.case_study,
  sales_roleplay: INTERVIEW_TYPE_WEIGHTS.sales,
  hr_screening: INTERVIEW_TYPE_WEIGHTS.hr_screening,
  followup: {
    addressed_followup: 20,
    correctness: 20,
    depth_expansion: 20,
    consistency: 15,
    adaptability: 15,
    communication: 10,
  },
};

export function getDimensionWeights(
  interviewType: InterviewType,
  questionType?: QuestionType,
): DimensionWeights {
  if (questionType && QUESTION_TYPE_WEIGHTS[questionType]) {
    return QUESTION_TYPE_WEIGHTS[questionType];
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
