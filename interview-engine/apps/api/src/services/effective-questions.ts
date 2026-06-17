// effective-questions — resolves the question set actually in effect for a
// session.
//
// NOTE: this module is referenced by evaluation.service, aviral-evaluation.service
// and interview-conversation.service but was missing from the source checkout
// (the three importers exist, the file did not). Reconstructed from its call
// sites: each caller does `getEffectiveQuestions(session) as QuestionWithGuidance[]`
// where the session is loaded with
//   jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } }
// so the "effective" questions are the role's active, authored questions. When a
// role has no authored questions yet (e.g. the keyless demo session) we fall
// back to a small built-in bank so an interview can still run end-to-end.

type EffectiveQuestion = {
  id: string;
  text: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topicCategories: string[];
  aiEvaluationGuidance: string;
  estimatedMinutes?: number;
};

// A rubric-shaped guidance blob (parsed by parseGuidance / parseEvaluationGuidance
// in the consuming services). Kept intentionally generic for the fallback bank.
function guidance(modelAnswer: string, points: string[], redFlags: string[] = []): string {
  return JSON.stringify({
    modelAnswer,
    rubric: {
      requiredPoints: points.map((description, i) => ({ id: `p${i + 1}`, description, weight: 1 })),
      redFlags: redFlags.map((description) => ({ description })),
    },
  });
}

const DEFAULT_QUESTION_BANK: EffectiveQuestion[] = [
  {
    id: 'default-q1',
    text: 'Tell me about a time you handled a difficult situation at work — what was the context, and how did you navigate it?',
    difficulty: 'EASY',
    topicCategories: ['behavioural'],
    estimatedMinutes: 4,
    aiEvaluationGuidance: guidance(
      'A clear situation, the specific actions the candidate took, and a concrete outcome (ideally STAR-structured).',
      ['Describes a concrete situation', 'Explains their own actions, not just the team', 'States a measurable or clear outcome'],
      ['Vague or hypothetical answer with no real example'],
    ),
  },
  {
    id: 'default-q2',
    text: 'Walk me through a project you are most proud of. What was your specific contribution and the measurable outcome?',
    difficulty: 'MEDIUM',
    topicCategories: ['experience'],
    estimatedMinutes: 5,
    aiEvaluationGuidance: guidance(
      'Specific ownership of a piece of work with a quantified result and reflection on impact.',
      ['Identifies their specific contribution', 'Quantifies the outcome', 'Reflects on what made it successful'],
      ['Takes credit for purely team-level work with no personal contribution'],
    ),
  },
  {
    id: 'default-q3',
    text: 'Describe a disagreement you had with a teammate. How did you reach a resolution?',
    difficulty: 'MEDIUM',
    topicCategories: ['teamwork'],
    estimatedMinutes: 4,
    aiEvaluationGuidance: guidance(
      'Shows active listening, separates the problem from the person, and reaches a constructive resolution.',
      ['Listens to the other perspective', 'Focuses on the issue, not the person', 'Reaches a concrete resolution'],
      ['Frames the disagreement as the other person always being wrong'],
    ),
  },
];

/**
 * Returns the questions in effect for an interview session: the role's active
 * authored questions, falling back to a built-in bank when none are authored.
 * `session` is the Prisma InterviewSession loaded with `jobRole.questions`.
 */
export function getEffectiveQuestions(session: unknown): EffectiveQuestion[] {
  const roleQuestions = (session as { jobRole?: { questions?: EffectiveQuestion[] } } | null)?.jobRole?.questions;
  if (Array.isArray(roleQuestions) && roleQuestions.length > 0) {
    return roleQuestions;
  }
  return DEFAULT_QUESTION_BANK;
}
