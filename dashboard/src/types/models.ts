// Core DOMAIN model interfaces for the IntervieHire dashboard.
//
// Hand-derived from the runtime shapes that the engine reads/writes:
//   - src/dashboard/state.ts        (AppState store + defaults)
//   - src/dashboard/api.ts          (mapJobOutToJob / mapApplicantOutToCandidate /
//                                     mapFullReportToCandidateReport reveal field shapes)
//   - src/dashboard/report.ts       (candidate report stage helpers / transcript)
//   - src/dashboard/vetting-data.ts (vetting details: caveats / pros / cons / rubrics)
//   - src/dashboard/deep-analysis.ts + report-page.ts (CandidateReport sub-shapes)
//
// Philosophy: this is a JS→strict-TS migration over highly dynamic code. Fields the
// dynamic code reads or writes are intentionally OPTIONAL and permissive (`?`, unions
// with `null`) so we kill TS2339 "property does not exist" without forcing rewrites of
// every call site. Index signatures (`[key: string]: any`) live ONLY on the big
// dynamic store object (AppState) — the clean domain models below stay index-free.
//
// This file is types-only and changes no runtime behaviour.

// ──────────────────────────────────────────────────────────────────────────
// Shared primitives
// ──────────────────────────────────────────────────────────────────────────

/** Where a candidate's stage sits in the pipeline. */
export type CandidateStatus = 'Resume' | 'Screening' | 'Functional' | 'Hired' | 'Rejected';

/** Normalised AI-interview status (see mapInterviewStatus in api.ts). */
export type InterviewStatus =
  | 'Completed'
  | 'Incomplete'
  | 'Evaluating'
  | 'Attempting'
  | 'Not Started'
  | 'Slot Missed'
  | string;

export type CheatProbability = 'Low' | 'Medium' | 'High' | string;

/** Recommendation enum the engine emits (snake_case) plus display variants. */
export type Recommendation =
  | 'strong_proceed'
  | 'proceed'
  | 'hold'
  | 'reject'
  | 'needs_human_review'
  | 'Advance'
  | 'Reject'
  | string;

export type Confidence = 'low' | 'medium' | 'high' | string;
export type Severity = 'low' | 'medium' | 'high' | 'critical' | string;

// ──────────────────────────────────────────────────────────────────────────
// Job + pipeline
// ──────────────────────────────────────────────────────────────────────────

/** Per-stage candidate counts shown on the job card / funnel. */
export interface JobPipeline {
  total?: number;
  resume?: number;
  screening?: number;
  functional?: number;
}

/** Toggle state for each pipeline stage (api: *_enabled flags). */
export interface JobPipelineConfig {
  careerPage?: { enabled?: boolean; listed?: boolean };
  resumeAnalysis?: { enabled?: boolean };
  recruiterScreening?: { enabled?: boolean };
  functionalInterview?: { enabled?: boolean };
}

/** Resume-stage gating criteria (resume_parameters on the backend). */
export interface ResumeCriteria {
  mustHave?: string[];
  redFlags?: string[];
  goodToHave?: string[];
  goodToHaveMinMatch?: number;
}

/** A single screening parameter inside a category. */
export interface ScreeningParam {
  name?: string;
  required?: boolean;
  flexibility?: string;
  preferredResponse?: string;
}

/** A category of screening parameters (Experience / Location / …). */
export interface ScreeningParamCategory {
  category?: string;
  params?: ScreeningParam[];
}

/** A blueprint / authored interview question. */
export interface JobQuestion {
  id?: string;
  type?: string;
  questionType?: string;
  question?: string;
  prompt?: string;
  text?: string;
  difficulty?: string;
  rubric?: any;
  estimatedMinutes?: number;
  competency?: string;
  targetRequirement?: string;
  followUpIntent?: string;
  modelAnswer?: string;
  edited?: boolean;
  follow_ups?: string[];
}

/** A functional-interview topic grouping its questions. */
export interface FunctionalTopic {
  name?: string;
  type?: string;
  difficulty?: string;
  questions?: JobQuestion[];
  questionsDetailed?: JobQuestion[];
}

export interface FunctionalParameters {
  topics?: FunctionalTopic[];
}

export interface ScreeningBlueprint {
  questions?: JobQuestion[];
}

/** A hiring job — the central domain object (state.ts.jobs + mapJobOutToJob). */
export interface Job {
  id?: string | null;
  roleName?: string;
  cardName?: string;
  companyName?: string;
  created?: string;
  customJobId?: string;
  status?: string;
  experienceBand?: string;
  description?: string;
  tags?: string[];
  createdBy?: string;
  pipeline?: JobPipeline;
  pipelineConfig?: JobPipelineConfig;
  resumeCriteria?: ResumeCriteria;
  scoringConfig?: ScoringConfig;
  screeningParams?: ScreeningParamCategory[];
  screeningBlueprint?: ScreeningBlueprint;
  functionalParameters?: FunctionalParameters;
  applicationFields?: string[];
  questions?: JobQuestion[];
  interviewSettings?: InterviewSettings;
  /** Whether the job is published to the public career page. */
  listedOnCareer?: boolean;
  /** Marks a job that exists on the backend (controls autosave/sync). */
  _backend?: boolean;
}

/** Recruiter-tunable resume scoring config (rides inside resume_parameters). */
export interface ScoringConfig {
  weights?: Record<string, number>;
  mustHaveGate?: boolean;
  mustHaveCap?: number;
  thresholds?: Record<string, number>;
  [key: string]: any;
}

// ──────────────────────────────────────────────────────────────────────────
// Interview settings (defaultInterviewSettings in state.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface InterviewSettings {
  interviewEnabled?: boolean;
  allowMobile?: boolean;
  allowLate?: boolean;
  continueFromMiddle?: boolean;
  allowReattempt?: boolean;
  requireCv?: boolean;
  proctoring?: boolean;
  whiteLabel?: boolean;
  accessControl?: 'link' | string;
}

// ──────────────────────────────────────────────────────────────────────────
// Candidate (state.ts.candidates + mapApplicantOutToCandidate)
// ──────────────────────────────────────────────────────────────────────────

/** A transcript line (vetting-data.ts / report.ts). */
export interface TranscriptLine {
  speaker?: string;
  text?: string;
}

/** Extracted resume analysis blob persisted per candidate (resume-analysis.ts). */
export interface ResumeAnalysis {
  matchScore?: number;
  recommendation?: Recommendation;
  recommendationReason?: string;
  recommendationBullets?: string[];
  summary?: string;
  strengths?: string[];
  improvements?: string[];
  experienceYears?: string;
  competencies?: ResumeCompetency[];
  projects?: ResumeProject[];
  criteriaVerdicts?: any[];
  dimensions?: Record<string, { score?: number; evidence?: string }>;
  [key: string]: any;
}

export interface ResumeCompetency {
  name?: string;
  score?: number;
  bullets?: string[];
}

export interface ResumeProject {
  name?: string;
  summary?: string;
  relevance?: number;
  whyItMatters?: string;
  skills?: string[];
}

/** A candidate / applicant flowing through a job's pipeline. */
export interface Candidate {
  id?: string | null;
  backendId?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  /** Where the resume-identity name/email was derived from (sourcing.ts). */
  resumeIdentitySource?: string | null;
  jobApplied?: string;
  jobId?: string | null;
  status?: CandidateStatus | string;
  source?: string;
  /** How the candidate entered the pipeline (entry_method): bulk_upload | direct_link | ats — drives the "Source" column. */
  entryMethod?: string | null;
  score?: string | number;
  registeredOn?: string;
  attemptedAt?: string | null;
  scheduledWindow?: { start?: any; end?: any; timezone?: any } | null;

  interviewStatus?: InterviewStatus | null;
  interviewScore?: number | null;
  cheatProbability?: CheatProbability | null;

  matchScore?: number | null;
  resumeText?: string | null;
  resumeAnalysed?: boolean | null;
  resumeShortlisted?: boolean | null;
  resumeAnalysis?: ResumeAnalysis;
  decision?: string | null;

  recruiterScreening?: string | null;
  recruiterScreeningScore?: number | null;
  screeningStatus?: InterviewStatus | null;
  screeningScore?: number | null;

  // Recruiter-authored notes + remarks timeline (report-page.ts).
  recruiterNotes?: string | null;
  remarks?: { text?: string; at?: string }[];

  // Transcript variants the report code reaches for (report.ts).
  transcript?: TranscriptLine[] | string;
  interviewTranscript?: TranscriptLine[] | string;
  screeningTranscript?: TranscriptLine[] | string;

  _backend?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Candidate vetting details (vetting-data.ts)
// ──────────────────────────────────────────────────────────────────────────

export interface VettingCaveat {
  type?: 'warning' | 'info' | string;
  text?: string;
}

export interface VettingRubric {
  label?: string;
  score?: number;
}

export interface CandidateVettingDetail {
  summary?: string;
  caveats?: VettingCaveat[];
  pros?: string[];
  cons?: string[];
  rubrics?: VettingRubric[];
  transcript?: TranscriptLine[];
}

// ──────────────────────────────────────────────────────────────────────────
// CandidateReport — the canonical structured interview evaluation
// (deep-analysis.ts builder + report-page.ts renderers + mapFullReportToCandidateReport)
// ──────────────────────────────────────────────────────────────────────────

/** A flagged concern, on the report or on an individual question/dimension. */
export interface RedFlag {
  label?: string;
  reason?: string;
  severity?: Severity;
  description?: string;
}

/** Per-skill / per-dimension aggregate score across the interview. */
export interface SkillScore {
  skill?: string;
  score?: number;
  evidenceAnswerIds?: string[];
}

/** Per-dimension grading inside a single question. */
export interface DimensionScore {
  score?: number;
  reason?: string;
  evidence?: string[];
  missing?: string[];
}

/** Model-answer comparison for a single answer. */
export interface ModelAnswerComparison {
  coveredRequiredPoints?: string[];
  missedRequiredPoints?: string[];
  coveredBonusPoints?: string[];
  incorrectClaims?: string[];
}

/** One question's full evaluation breakdown. */
export interface QuestionBreakdown {
  answerId?: string;
  questionId?: string;
  questionText?: string;
  topicName?: string;
  questionOrigin?: string;
  evaluationMode?: string;
  overallScore?: number;
  finalScore?: number;
  rubricCoverageScore?: number;
  dimensionScore?: number;
  redFlagPenalty?: number;
  dimensionScores?: Record<string, DimensionScore>;
  modelAnswerComparison?: ModelAnswerComparison;
  strengths?: string[];
  weaknesses?: string[];
  redFlags?: RedFlag[];
  followUpRecommendations?: string[];
  evaluationConfidence?: Confidence;
  summary?: string;
}

/** Composite score math shown in the Score Analysis card. */
export interface ScoreBreakdown {
  finalScore?: number;
  rubricCoverageAvg?: number;
  dimensionAvg?: number;
  redFlagPenaltyAvg?: number;
  proctoringPenalty?: number;
  formula?: string;
}

/** A single proctoring violation event. */
export interface ProctoringViolation {
  eventType?: string;
  detail?: string;
  occurredAt?: string;
  severity?: Severity;
}

/** Proctoring / integrity summary for the interview. */
export interface ProctoringReport {
  integrityScore?: number;
  penalty?: number;
  totalEvents?: number;
  violations?: ProctoringViolation[];
  bySeverity?: Record<string, number>;
}

/** Per-candidate pipeline-stage presence flags (roster report). */
export interface ReportStages {
  resume?: boolean;
  screening?: boolean;
  functional?: boolean;
}

/** The canonical structured interview report (passes straight through the API). */
export interface CandidateReport {
  interviewId?: string;
  candidateId?: string | null;
  roleTitle?: string;
  interviewType?: string;
  overallScore?: number | null;
  recommendation?: Recommendation;
  recommendationConfidence?: Confidence;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  redFlags?: RedFlag[];
  skillScores?: SkillScore[];
  questionBreakdown?: QuestionBreakdown[];
  scoreBreakdown?: ScoreBreakdown;
  proctoring?: ProctoringReport;
  suggestedNextSteps?: string[];
  transcriptOnly?: boolean;
  evaluationEngine?: string;
  evaluatedAt?: string | null;
  stages?: ReportStages;
}

// ──────────────────────────────────────────────────────────────────────────
// Team member (mapMemberOutToTeam)
// ──────────────────────────────────────────────────────────────────────────

export interface TeamMember {
  backendId?: string | null;
  name?: string;
  email?: string;
  designation?: string;
  usertype?: string;
  registeredOn?: string;
  status?: string;
  _backend?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// Agent config (state.ts.agentConfigs)
// ──────────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  model?: string;
  temperature?: number;
  threshold?: number;
  prompt?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// AppState — the big dynamic store. Index signature ONLY here.
// ──────────────────────────────────────────────────────────────────────────

export interface StageFilter {
  interviewStatus?: string[];
  cheatProb?: string[];
  recruiterScreening?: string[];
  scoreMin?: number | null;
  scoreMax?: number | null;
  actions?: string[];
}

/**
 * The global mutable store (state.ts.AppState). Every known field is typed, but the
 * permissive index signature lets dynamic code attach/read transient UI keys without
 * tripping TS2339. This is the ONLY interface here with an index signature.
 */
export interface AppState {
  activeTab?: string;
  activeSubtab?: string;
  activeJobId?: string | null;
  jobsFilter?: string;
  teamFilter?: string;
  tableSearch?: string;
  analyticsJobStatusFilter?: string[];
  analyticsCandStageFilter?: string[];
  globalSearch?: string;
  jobsSortKey?: string;
  jobsSortAsc?: boolean;
  analyticsSubtab?: string;
  stageFilters?: {
    screening?: StageFilter;
    functional?: StageFilter;
    [key: string]: StageFilter | undefined;
  };
  dateRange?: string;

  jobs?: Job[];
  candidates?: Candidate[];
  team?: TeamMember[];

  visibleColumnsAnalyticsJobs?: string[];
  visibleColumnsAnalyticsCandidates?: string[];
  visibleColumnsTeam?: string[];
  agentConfigs?: Record<string, AgentConfig>;

  [key: string]: any;
}
