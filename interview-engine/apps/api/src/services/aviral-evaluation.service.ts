import { prisma } from '../lib/prisma.js';
import { callDeepSeekJson } from './deepseek.service.js';
import { pairAnsweredEvalQuestions } from '@interviehire/shared';
import {
  aggregateCandidateReport,
  buildAnswerEvaluationPrompt,
  validateResponseEvaluation,
  type CandidateResponseInput,
  type EvaluationPoint,
  type ExpectedRedFlag,
  type InterviewContext,
  type ModelAnswerRubric,
  type QuestionType,
  type RedFlagSeverity,
  type ResponseEvaluation,
} from '../aviral-eval/index.js';

type TranscriptEntry = {
  speaker?: string;
  text?: string | null;
  questionIndex?: number | null;
};

type QuestionWithGuidance = {
  id: string;
  text: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topicCategories: string[];
  aiEvaluationGuidance: string;
};

type ParsedGuidance = {
  questionType?: QuestionType;
  modelAnswer?: string;
  rubric?: ModelAnswerRubric;
};

const EVALUATION_CONCURRENCY = 3;

const VALID_QUESTION_TYPES = new Set<QuestionType>([
  'technical_theory',
  'coding',
  'system_design',
  'behavioral',
  'case_study',
  'sales_roleplay',
  'hr_screening',
  'general',
  'followup',
  'custom',
]);

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'custom']);

export async function evaluateInterviewWithAviral(sessionId: string): Promise<any> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      company: true,
      candidate: true,
      jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } },
      proctoringLogs: true,
    },
  });

  if (!session) throw new Error('Session not found');

  const transcript = normalizeTranscript(session.transcript);
  const questions = session.jobRole.questions as QuestionWithGuidance[];

  const context: InterviewContext = {
    interviewId: session.id,
    candidateId: session.candidateId,
    companyId: session.companyId,
    roleTitle: session.jobRole.title,
    roleLevel: 'junior',
    interviewType: 'technical',
    mustHaveSkills: session.jobRole.primaryCriteria,
    niceToHaveSkills: session.jobRole.secondaryCriteria,
  };

  const askedQuestionIndexes = new Set(
    transcript
      .filter((entry) => entry?.speaker === 'ai' && isValidQuestionIndex(entry.questionIndex, questions.length))
      .map((entry) => Number(entry.questionIndex)),
  );
  const answeredQuestions = pairAnsweredEvalQuestions(transcript, questions)
    .filter(({ questionIndex }) => askedQuestionIndexes.has(questionIndex));

  const inputs: CandidateResponseInput[] = answeredQuestions.map(({ question, answer }, index) =>
    buildResponseInput(session.id, question, answer, index),
  );

  const evaluations = await evaluateInputsWithDeepSeek(context, inputs);

  const report = aggregateCandidateReport(context, evaluations);
  const proctoringSummary = {
    eventCount: session.proctoringLogs.length,
    criticalOrHighCount: session.proctoringLogs.filter((log) => ['CRITICAL', 'HIGH'].includes(log.severity)).length,
  };
  const finalReport = {
    ...report,
    proctoringSummary,
  };

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { evaluation: finalReport as any, status: 'EVALUATED', completedAt: new Date() },
  });

  return finalReport;
}

function buildResponseInput(
  sessionId: string,
  question: QuestionWithGuidance,
  answer: string,
  index: number,
): CandidateResponseInput {
  const guidance = parseEvaluationGuidance(question.aiEvaluationGuidance);
  const questionType = normalizeQuestionType(guidance.questionType);
  const difficulty = normalizeDifficulty(question.difficulty);

  return {
    answerId: `${sessionId}-q${index + 1}`,
    question: {
      questionId: question.id,
      questionText: question.text,
      questionType,
      questionOrigin: 'predetermined',
      difficulty,
      skillTags: question.topicCategories,
      modelAnswer: guidance.modelAnswer,
      modelAnswerRubric: guidance.rubric,
    },
    response: {
      source: 'transcript',
      transcript: answer,
    },
  };
}

async function evaluateInputsWithDeepSeek(
  context: InterviewContext,
  inputs: CandidateResponseInput[],
): Promise<ResponseEvaluation[]> {
  if (inputs.length === 0) {
    return [];
  }

  const evaluations: ResponseEvaluation[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < inputs.length) {
      const currentIndex = cursor;
      cursor += 1;
      const input = inputs[currentIndex];
      const evaluation = await evaluateSingleInput(context, input);

      if (evaluation) {
        evaluations.push(evaluation);
      }
    }
  };

  const workerCount = Math.min(EVALUATION_CONCURRENCY, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return evaluations;
}

async function evaluateSingleInput(
  context: InterviewContext,
  input: CandidateResponseInput,
): Promise<ResponseEvaluation | null> {
  try {
    const prompt = buildAnswerEvaluationPrompt(context, input);
    const raw = await callDeepSeekJson<ResponseEvaluation>({
      systemInstruction:
        'You are a rigorous, fair technical interview evaluator. Return strict JSON exactly matching the requested ResponseEvaluation schema.',
      prompt,
      maxOutputTokens: Number(process.env.DEEPSEEK_EVALUATION_MAX_TOKENS || 12000),
      temperature: 0.1,
    });

    const result = validateResponseEvaluation({
      ...raw,
      answerId: raw.answerId || input.answerId,
      questionId: raw.questionId || input.question.questionId,
      questionOrigin: input.question.questionOrigin,
    });

    return result.normalized ?? null;
  } catch (error) {
    console.error(`Aviral evaluation failed for answer ${input.answerId}. Skipping.`, error);
    return null;
  }
}

function parseEvaluationGuidance(raw: string): ParsedGuidance {
  const rawText = typeof raw === 'string' ? raw.trim() : '';

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const modelAnswer =
      typeof parsed?.modelAnswer === 'string' && parsed.modelAnswer.trim()
        ? parsed.modelAnswer.trim()
        : rawText || undefined;

    return {
      questionType: typeof parsed?.questionType === 'string' ? (parsed.questionType as QuestionType) : undefined,
      modelAnswer,
      rubric: mapStoredRubric(parsed?.rubric),
    };
  } catch {
    return {
      questionType: undefined,
      modelAnswer: rawText || undefined,
      rubric: undefined,
    };
  }
}

function mapStoredRubric(rawRubric: unknown): ModelAnswerRubric | undefined {
  if (!rawRubric || typeof rawRubric !== 'object') {
    return undefined;
  }

  const rubric = rawRubric as {
    requiredPoints?: unknown;
    secondaryPoints?: unknown;
    excellentAnswerSignals?: unknown;
    redFlags?: unknown;
    notes?: unknown;
  };

  const requiredPoints = mapPoints(rubric.requiredPoints);

  if (requiredPoints.length === 0) {
    return undefined;
  }

  const bonusPoints = [...mapPoints(rubric.secondaryPoints), ...mapPoints(rubric.excellentAnswerSignals)];
  const redFlags = mapRedFlags(rubric.redFlags);

  return {
    requiredPoints,
    bonusPoints,
    redFlags,
    notes: typeof rubric.notes === 'string' && rubric.notes.trim() ? rubric.notes.trim() : undefined,
  };
}

function mapPoints(points: unknown): EvaluationPoint[] {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point, index) => {
      const value = (point ?? {}) as { id?: unknown; description?: unknown; weight?: unknown };
      const description = typeof value.description === 'string' ? value.description.trim() : '';
      const weight = Number.isFinite(Number(value.weight)) && Number(value.weight) > 0 ? Number(value.weight) : 1;

      return {
        id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `point_${index + 1}`,
        description,
        weight,
      };
    })
    .filter((point) => point.description);
}

function mapRedFlags(redFlags: unknown): ExpectedRedFlag[] {
  if (!Array.isArray(redFlags)) {
    return [];
  }

  return redFlags
    .map((flag, index) => {
      const value = (flag ?? {}) as { id?: unknown; description?: unknown; severity?: unknown };
      const description = typeof value.description === 'string' ? value.description.trim() : '';

      return {
        id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `red_flag_${index + 1}`,
        description,
        severity: normalizeSeverity(value.severity),
      };
    })
    .filter((flag) => flag.description);
}

function normalizeSeverity(severity: unknown): RedFlagSeverity {
  return severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical'
    ? severity
    : 'medium';
}

function normalizeQuestionType(questionType: QuestionType | undefined): QuestionType {
  if (questionType && VALID_QUESTION_TYPES.has(questionType)) {
    return questionType;
  }

  return questionType === undefined ? 'technical_theory' : 'general';
}

function normalizeDifficulty(
  difficulty: QuestionWithGuidance['difficulty'],
): 'easy' | 'medium' | 'hard' | 'custom' {
  const lowered = difficulty.toLowerCase();

  return (VALID_DIFFICULTIES.has(lowered) ? lowered : 'custom') as 'easy' | 'medium' | 'hard' | 'custom';
}

function normalizeTranscript(raw: unknown): TranscriptEntry[] {
  if (Array.isArray(raw)) return raw as TranscriptEntry[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isValidQuestionIndex(value: unknown, questionCount: number): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < questionCount;
}
