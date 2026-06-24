export type InterviewType =
  | "technical"
  | "behavioral"
  | "system_design"
  | "case_study"
  | "sales"
  | "hr_screening"
  | "mixed"
  | "custom";

export type QuestionType =
  | "technical_theory"
  | "coding"
  | "system_design"
  | "behavioral"
  | "case_study"
  | "sales_roleplay"
  | "hr_screening"
  | "general"
  | "followup"
  | "custom";

export type QuestionOrigin = "predetermined" | "generated_followup";

export type EvaluationMode =
  | "model_answer_based"
  | "rubric_only"
  | "followup_contextual";

export type EvaluationConfidence = "high" | "medium" | "low";

export type Recommendation =
  | "strong_proceed"
  | "proceed"
  | "hold"
  | "reject"
  | "needs_human_review";

export type RedFlagSeverity = "low" | "medium" | "high" | "critical";

export interface InterviewContext {
  interviewId: string;
  candidateId: string;
  companyId?: string;
  roleTitle: string;
  roleLevel?: string;
  interviewType: InterviewType;
  mustHaveSkills?: string[];
  niceToHaveSkills?: string[];
  companyEvaluationNotes?: string;
}

export interface EvaluationPoint {
  id: string;
  description: string;
  weight: number;
}

export interface ExpectedRedFlag {
  id: string;
  description: string;
  severity: RedFlagSeverity;
}

export interface ModelAnswerRubric {
  requiredPoints: EvaluationPoint[];
  bonusPoints: EvaluationPoint[];
  redFlags: ExpectedRedFlag[];
  notes?: string;
}

export interface QuestionEvaluationConfig {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  questionOrigin: QuestionOrigin;
  difficulty?: "easy" | "medium" | "hard" | "custom";
  skillTags?: string[];
  importanceWeight?: number;
  modelAnswer?: string;
  modelAnswerRubric?: ModelAnswerRubric;
}

export interface FollowupContext {
  originalQuestionId: string;
  originalAnswerId?: string;
  originalQuestionText: string;
  originalTranscript: string;
  followupQuestionId?: string;
  generatedFollowupQuestion: string;
}

export interface TranscriptResponseInput {
  source: "transcript";
  transcript: string;
  language?: string;
}

export interface FutureAudioAnalysis {
  source: "audio";
  pace?: number | null;
  hesitation?: number | null;
  interruptionCount?: number | null;
  confidenceSignal?: number | null;
  notes?: string | null;
}

export interface FutureVideoAnalysis {
  source: "video";
  eyeContact?: number | null;
  engagement?: number | null;
  facialExpressionNotes?: string | null;
  postureNotes?: string | null;
}

export interface CandidateResponseInput {
  answerId: string;
  question: QuestionEvaluationConfig;
  response: TranscriptResponseInput;
  followupContext?: FollowupContext;
  futureSignals?: {
    audio?: FutureAudioAnalysis;
    video?: FutureVideoAnalysis;
  };
}

export interface DimensionScore {
  score: number;
  reason: string;
  evidence?: string[];
  missing?: string[];
}

export interface ModelAnswerComparison {
  coveredRequiredPoints: string[];
  missedRequiredPoints: string[];
  coveredBonusPoints: string[];
  incorrectClaims: string[];
}

export interface FollowupAnalysis {
  addressedFollowup: boolean;
  improvedPreviousAnswer: boolean;
  contradictedPreviousAnswer: boolean;
  handledProbeWell: boolean;
  followupValue: "high" | "medium" | "low";
  reason: string;
}

export interface ResponseEvaluation {
  answerId: string;
  questionId: string;
  questionText?: string;
  questionOrigin: QuestionOrigin;
  evaluationMode: EvaluationMode;
  overallScore: number;
  dimensionScores: Record<string, DimensionScore>;
  modelAnswerComparison?: ModelAnswerComparison;
  followupAnalysis?: FollowupAnalysis;
  strengths: string[];
  weaknesses: string[];
  redFlags: Array<{
    label: string;
    severity: RedFlagSeverity;
    reason: string;
  }>;
  followUpRecommendations: string[];
  evaluationConfidence: EvaluationConfidence;
  summary: string;
  transcriptOnly: true;
  // Deterministic scoring breakdown (computed from the LLM judgment, not asked of it):
  // finalScore = 0.45*rubricCoverageScore + 0.55*dimensionScore - redFlagPenalty
  rubricCoverageScore?: number;
  dimensionScore?: number;
  redFlagPenalty?: number;
  finalScore?: number;
  rawLlmScore?: number;
}

export interface ProctoringViolation {
  eventType: string;
  severity: RedFlagSeverity;
  occurredAt?: string;
  detail?: string;
}

export interface ProctoringSummary {
  totalEvents: number;
  bySeverity: Record<string, number>;
  penalty: number;
  integrityScore: number;
  violations: ProctoringViolation[];
}

export interface ScoreBreakdown {
  rubricCoverageAvg: number;
  dimensionAvg: number;
  redFlagPenaltyAvg: number;
  answerAggregate: number;   // weighted aggregate of per-answer finalScore (before proctoring)
  proctoringPenalty: number;
  finalScore: number;        // answerAggregate - proctoringPenalty (clamped)
  formula: string;
}

export interface SkillScore {
  skill: string;
  score: number;
  evidenceAnswerIds: string[];
}

export interface CandidateReport {
  interviewId: string;
  candidateId: string;
  roleTitle: string;
  interviewType: InterviewType;
  overallScore: number;
  recommendation: Recommendation;
  recommendationConfidence: EvaluationConfidence;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  redFlags: ResponseEvaluation["redFlags"];
  skillScores: SkillScore[];
  questionBreakdown: ResponseEvaluation[];
  suggestedNextSteps: string[];
  transcriptOnly: true;
  proctoring?: ProctoringSummary;
  scoreBreakdown?: ScoreBreakdown;
  evaluationEngine?: string;
  futureSignalPlaceholders: {
    audioAnalysisEnabled: false;
    videoAnalysisEnabled: false;
  };
}

export interface InterviewTurnLink {
  originalQuestionId: string;
  originalAnswerId: string;
  followupQuestionId: string;
  followupAnswerId?: string;
}
