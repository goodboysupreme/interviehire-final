// Interview Blueprint engine — the authoring brain behind the redesigned
// Question Generator. Pure logic: no DOM, no localStorage. It owns the
// contract-aligned data model, AI generation of rubric-grade questions,
// normalization/validation, migration off the legacy flat `job.questions`,
// and serialization to the backend contract (aiEvaluationGuidance +
// functional_parameters) so authored blueprints port to the FastAPI/Node
// backend (see memory: interviehire-backend-contract) with zero rework.

import { callDeepSeekAPI, parseAIJson, sanitizeJSONResponse } from './ai-api.js';

// ── Vocabularies (must match the backend's enums exactly) ──────────────────
// The eval engine keys scoring weights off questionType; an unknown type
// silently degrades scoring, so generation is constrained to this set.
export const QUESTION_TYPES = [
  'technical_theory', 'coding', 'system_design', 'behavioral',
  'case_study', 'sales_roleplay', 'hr_screening', 'general', 'custom',
];
export const TOPIC_TYPES = ['Theoretical', 'Experiential'];
export const CONTRACT_DIFFICULTY = ['Easy', 'Medium', 'Hard'];
export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'];
export const MODE_SCREENING = 'screening';
export const MODE_FUNCTIONAL = 'functional';

// The dashboard's legacy question vocab is beginner|intermediate|advanced
// (constants.js). The blueprint is contract-native (Easy|Medium|Hard); we map
// only at the legacy migration boundary so neither vocab drifts.
const LEGACY_TO_CONTRACT_DIFFICULTY = { beginner: 'Easy', intermediate: 'Medium', advanced: 'Hard' };
const LEGACY_TYPE_TO_QUESTION_TYPE = {
  technical: 'technical_theory', behavioral: 'behavioral',
  situational: 'case_study', coding: 'coding',
};

const MINUTES_BY_DIFFICULTY = { Easy: 3, Medium: 4, Hard: 5 };

let _seq = 0;
function uid(prefix) {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

const clean = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);
const clampWeight = (w) => Math.max(1, Math.min(3, Math.round(Number(w) || 2)));
const snakeId = (s, fallback) =>
  (clean(s) || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || fallback;

// ── Factories ──────────────────────────────────────────────────────────────
export function createRubricPoint(description = '', weight = 2, keywords = []) {
  return { id: snakeId(description, uid('pt')), description: clean(description), keywords: arr(keywords).map((k) => clean(k)).filter(Boolean), weight: clampWeight(weight) };
}

export function createRedFlag(description = '', severity = 'medium') {
  return { id: snakeId(description, uid('rf')), description: clean(description), severity: oneOf(severity, SEVERITY_LEVELS, 'medium') };
}

export function createQuestionBlueprint(overrides = {}) {
  const difficulty = oneOf(overrides.difficulty, CONTRACT_DIFFICULTY, 'Medium');
  return {
    id: overrides.id || uid('q'),
    prompt: clean(overrides.prompt),
    questionType: oneOf(overrides.questionType, QUESTION_TYPES, 'general'),
    difficulty,
    estimatedMinutes: Number(overrides.estimatedMinutes) || MINUTES_BY_DIFFICULTY[difficulty],
    competency: clean(overrides.competency),
    modelAnswer: clean(overrides.modelAnswer),
    rubric: {
      requiredPoints: arr(overrides.rubric?.requiredPoints).map((p) => createRubricPoint(p.description, p.weight, p.keywords)),
      secondaryPoints: arr(overrides.rubric?.secondaryPoints).map((p) => createRubricPoint(p.description, p.weight ?? 1, p.keywords)),
      excellentAnswerSignals: arr(overrides.rubric?.excellentAnswerSignals).map((s) => clean(s)).filter(Boolean),
      redFlags: arr(overrides.rubric?.redFlags).map((f) => createRedFlag(f.description, f.severity)),
    },
    followUpIntent: clean(overrides.followUpIntent),
  };
}

export function createTopic(overrides = {}) {
  return {
    id: overrides.id || uid('topic'),
    name: clean(overrides.name, 'Untitled topic'),
    type: oneOf(overrides.type, TOPIC_TYPES, 'Experiential'),
    difficulty: oneOf(overrides.difficulty, CONTRACT_DIFFICULTY, 'Medium'),
    questions: arr(overrides.questions).map((q) => createQuestionBlueprint(q)),
  };
}

export const emptyFunctionalBlueprint = () => ({ topics: [] });
export const emptyScreeningBlueprint = () => ({ questions: [] });

// ── Rubric completeness (drives the "rubric ready / light / missing" badge) ──
export function rubricStrength(qb) {
  const r = qb.rubric || {};
  const hasModel = !!clean(qb.modelAnswer);
  const reqs = arr(r.requiredPoints).length;
  const flags = arr(r.redFlags).length;
  if (hasModel && reqs >= 2 && flags >= 1) return 'ready';
  if (hasModel || reqs >= 1) return 'light';
  return 'missing';
}

// ── Migration off the legacy flat `job.questions` ───────────────────────────
// Groups legacy questions by type into topics, lifting the freeform `rubric`
// sentence into a single required point and `follow_ups` into followUpIntent,
// so nothing authored under the old model is lost.
export function migrateLegacyQuestions(legacyQuestions) {
  const groups = new Map();
  arr(legacyQuestions).forEach((q) => {
    const qType = LEGACY_TYPE_TO_QUESTION_TYPE[q.type] || 'general';
    const difficulty = LEGACY_TO_CONTRACT_DIFFICULTY[q.difficulty] || 'Medium';
    const topicName = q.type ? `${q.type[0].toUpperCase()}${q.type.slice(1)}` : 'General';
    if (!groups.has(topicName)) groups.set(topicName, []);
    groups.get(topicName).push(createQuestionBlueprint({
      prompt: q.question || q.text,
      questionType: qType,
      difficulty,
      modelAnswer: clean(q.rubric),
      rubric: { requiredPoints: q.rubric ? [{ description: q.rubric, weight: 3 }] : [] },
      followUpIntent: arr(q.follow_ups).filter(Boolean).join(' · '),
    }));
  });
  const topics = [];
  groups.forEach((questions, name) => {
    topics.push(createTopic({
      name,
      type: name === 'Behavioral' ? 'Experiential' : 'Theoretical',
      difficulty: questions[0]?.difficulty || 'Medium',
      questions,
    }));
  });
  return { topics };
}

// Returns the functional blueprint for a job, migrating legacy data on first
// read. Does not persist — the caller owns saveStateToLocalStorage.
export function ensureFunctionalBlueprint(job) {
  if (job.functionalParameters && Array.isArray(job.functionalParameters.topics)) return job.functionalParameters;
  return migrateLegacyQuestions(job.questions);
}

// ── Generation prompts ──────────────────────────────────────────────────────
function jdContext(job) {
  const must = arr(job.resumeCriteria?.mustHave);
  const good = arr(job.resumeCriteria?.goodToHave);
  return [
    `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}`,
    job.experienceBand ? `Seniority: ${job.experienceBand}` : '',
    clean(job.description) ? `Job description:\n${job.description}` : '',
    must.length ? `Must-have requirements:\n- ${must.join('\n- ')}` : '',
    good.length ? `Good-to-have:\n- ${good.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');
}

const RUBRIC_SHAPE = `"rubric":{"requiredPoints":[{"description":"...","keywords":["..."],"weight":1-3}],"secondaryPoints":[{"description":"...","keywords":["..."],"weight":1}],"excellentAnswerSignals":["..."],"redFlags":[{"description":"...","severity":"low|medium|high|critical"}]}`;

// Generation is TWO-PHASE: the DeepSeek proxy caps output at 3000 tokens, and a
// full blueprint with rubrics overflows and truncates mid-JSON (verified). So
// phase 1 authors a lightweight OUTLINE (prompts only — fits easily) and phase 2
// enriches each question's rubric in its own small call. The studio fills
// rubrics in progressively.
function buildOutlineMessages(job, opts = {}) {
  const topicCount = opts.topicCount || 4;
  const perTopic = opts.questionsPerTopic || 2;
  const system = `You are a senior interviewer and assessment designer. Author the OUTLINE of a FUNCTIONAL (deep, role-specific) interview an AI avatar will conduct by VOICE.

Return ONLY JSON (no markdown), shape:
{"topics":[{"name":"...","type":"Theoretical|Experiential","difficulty":"Easy|Medium|Hard","questions":[{"prompt":"...","questionType":"${QUESTION_TYPES.join('|')}","difficulty":"Easy|Medium|Hard","estimatedMinutes":3-6,"competency":"which requirement this tests"}]}]}

Rules:
- ${topicCount} topics, ~${perTopic} questions each, mapped to the job's real requirements.
- prompt: ONE idea, conversational, speakable aloud — no compound multi-part questions.
- OUTLINE ONLY — do NOT include model answers or rubrics here.
- No preamble, no trailing commentary.`;
  return [{ role: 'system', content: system }, { role: 'user', content: `Outline the functional interview for:\n\n${jdContext(job)}` }];
}

function buildEnrichMessages(job, q, topicName) {
  const system = `You write the grading rubric an AI evaluator uses to score ONE spoken interview answer. Be concrete and discriminating.

Return ONLY JSON (no markdown), shape:
{"modelAnswer":"what a strong answer covers, 2-3 sentences",${RUBRIC_SHAPE},"followUpIntent":"when/how the avatar should probe deeper"}

Rules:
- requiredPoints: 2-4, each with 2-5 lowercase keywords the evaluator matches on, weight 1-3 by importance.
- redFlags: 1-2 realistic failure signals.
- No preamble.`;
  const user = `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Topic: ${topicName}
Question (${q.questionType}, ${q.difficulty}): ${q.prompt}
Write the model answer and rubric.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function buildScreeningMessages(job, opts = {}) {
  const count = opts.count || 4;
  const categories = arr(job.screeningParams).map((c) => c.category).filter(Boolean);
  const system = `You are a recruiter running a short SCREENING call an AI avatar conducts by VOICE. Goal: gate fit, not deep evaluation — background, motivation, logistics (compensation, notice, location), and one role-relevant probe.

Return ONLY JSON (no markdown), shape:
{"questions":[{"prompt":"...","questionType":"hr_screening","difficulty":"Easy","competency":"what this confirms","modelAnswer":"what an acceptable answer sounds like","followUpIntent":"what to clarify if the answer is vague"}]}

Rules:
- Exactly ${count} questions, short and warm, speakable aloud.
- Cover background/motivation and the logistics the role cares about${categories.length ? `: ${categories.join(', ')}` : ''}.
- No technical depth — that is the functional round's job.`;
  const user = `Author the screening questions for:\n\n${jdContext(job)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

async function callJson(messages) {
  const raw = await callDeepSeekAPI(messages, true);
  return parseAIJson(sanitizeJSONResponse(raw));
}

export async function generateFunctionalOutline(job, opts = {}) {
  const parsed = await callJson(buildOutlineMessages(job, opts));
  return normalizeFunctionalBlueprint(parsed);
}

// Authors one question's model answer + rubric. Returns the normalized fields
// the caller merges onto the question object. Throws on AI/parse failure so the
// studio can keep the existing (or local) rubric.
export async function enrichQuestionRubric(job, q, topicName) {
  const parsed = await callJson(buildEnrichMessages(job, q, topicName));
  return normalizeRubricPayload(parsed);
}

export function normalizeRubricPayload(parsed) {
  const b = createQuestionBlueprint({ modelAnswer: parsed?.modelAnswer, rubric: parsed?.rubric, followUpIntent: parsed?.followUpIntent });
  return { modelAnswer: b.modelAnswer, rubric: b.rubric, followUpIntent: b.followUpIntent };
}

export async function generateScreeningQuestions(job, opts = {}) {
  const parsed = await callJson(buildScreeningMessages(job, opts));
  return normalizeScreeningBlueprint(parsed);
}

// ── Normalization (coerce any AI/legacy payload into the contract shape) ─────
export function normalizeFunctionalBlueprint(parsed) {
  const topics = arr(parsed?.topics).length ? parsed.topics : arr(parsed);
  return { topics: topics.map((t) => createTopic({
    name: t.name || t.topic,
    type: t.type,
    difficulty: t.difficulty,
    questions: arr(t.questions).map((q) => createQuestionBlueprint(q)),
  })).filter((t) => t.questions.length) };
}

export function normalizeScreeningBlueprint(parsed) {
  const list = arr(parsed?.questions).length ? parsed.questions : arr(parsed);
  return { questions: list.map((q) => createQuestionBlueprint({
    ...q,
    questionType: 'hr_screening',
    difficulty: 'Easy',
  })).filter((q) => q.prompt) };
}

// ── Coverage map: which JD requirements the blueprint actually tests ─────────
export function computeCoverage(job, functionalBlueprint) {
  const must = arr(job.resumeCriteria?.mustHave);
  const haystacks = (functionalBlueprint.topics || []).flatMap((t) =>
    t.questions.map((q) => `${t.name} ${q.prompt} ${q.competency} ${q.rubric.requiredPoints.map((p) => `${p.description} ${p.keywords.join(' ')}`).join(' ')}`.toLowerCase()));
  return must.map((req) => {
    const words = req.toLowerCase().split(/\s+/).filter((w) => w.length > 4 &&
      !['experience', 'knowledge', 'proficiency', 'familiarity', 'equivalent', 'similar'].includes(w));
    const hits = haystacks.filter((h) => words.some((w) => h.includes(w))).length;
    return { requirement: req, count: hits, status: hits >= 2 ? 'ok' : hits === 1 ? 'thin' : 'gap' };
  });
}

// ── Calibration: glanceable stats for the top strip + inspector ──────────────
export function computeCalibration(functionalBlueprint) {
  const questions = (functionalBlueprint.topics || []).flatMap((t) => t.questions);
  const totalMinutes = questions.reduce((a, q) => a + (q.estimatedMinutes || MINUTES_BY_DIFFICULTY[q.difficulty] || 4), 0);
  const difficultyMix = CONTRACT_DIFFICULTY.reduce((m, d) => { m[d] = questions.filter((q) => q.difficulty === d).length; return m; }, {});
  const rubricReady = questions.filter((q) => rubricStrength(q) === 'ready').length;
  return {
    questionCount: questions.length,
    topicCount: (functionalBlueprint.topics || []).length,
    totalMinutes,
    difficultyMix,
    rubricReady,
    rubricCoverage: questions.length ? Math.round((rubricReady / questions.length) * 100) : 0,
  };
}

// ── Contract serialization (the portability layer to Krishna's backend) ──────
// Exactly the JSON string the Prisma Question.aiEvaluationGuidance field +
// evaluation service consume.
export function toAiEvaluationGuidance(qb) {
  return JSON.stringify({
    questionType: qb.questionType,
    modelAnswer: qb.modelAnswer,
    rubric: {
      requiredPoints: qb.rubric.requiredPoints.map((p) => ({ id: p.id, description: p.description, keywords: p.keywords, weight: p.weight })),
      secondaryPoints: qb.rubric.secondaryPoints.map((p) => ({ id: p.id, description: p.description, keywords: p.keywords, weight: p.weight })),
      excellentAnswerSignals: qb.rubric.excellentAnswerSignals,
      redFlags: qb.rubric.redFlags.map((f) => ({ id: f.id, description: f.description, severity: f.severity })),
    },
  });
}

// Backend `functional_parameters`. `questions` stays a plain string[] for
// drop-in compatibility with the current sync; `questionsDetailed` carries the
// authored rubric so an extended sync can populate aiEvaluationGuidance per
// question instead of regenerating it generically.
export function toFunctionalParameters(functionalBlueprint) {
  return {
    topics: (functionalBlueprint.topics || []).map((t) => ({
      name: t.name,
      type: t.type,
      difficulty: t.difficulty,
      questions: t.questions.map((q) => q.prompt),
      questionsDetailed: t.questions.map((q) => ({
        text: q.prompt,
        questionType: q.questionType,
        difficulty: q.difficulty,
        estimatedMinutes: q.estimatedMinutes,
        aiEvaluationGuidance: toAiEvaluationGuidance(q),
      })),
    })),
  };
}

// Backend `screening_questions` is a plain string[]; we keep the rich drafts
// separately so the studio can still edit guidance without breaking the wire.
export function toScreeningQuestions(screeningBlueprint) {
  return (screeningBlueprint.questions || []).map((q) => q.prompt);
}

// ── Keyless local fallback generators ───────────────────────────────────────
// Used when the AI proxy is unavailable so Generate always yields a real,
// rubric-bearing blueprint. Role-aware archetypes; rubrics are basic but valid.
function lq(prompt, questionType, difficulty, competency, modelAnswer, required, redFlags) {
  return createQuestionBlueprint({
    prompt, questionType, difficulty, competency, modelAnswer,
    rubric: {
      requiredPoints: (required || []).map(([description, keywords, weight]) => ({ description, keywords, weight })),
      redFlags: (redFlags || []).map(([description, severity]) => ({ description, severity })),
    },
  });
}

function roleArchetype(job) {
  const s = `${job.roleName || ''} ${job.cardName || ''} ${job.description || ''}`.toLowerCase();
  if (/develop|engineer|programmer|software|full.?stack|backend|front.?end|sde/.test(s)) return 'engineering';
  if (/product manager|product owner|\bpm\b|product/.test(s)) return 'product';
  return 'general';
}

export function localFunctionalBlueprint(job) {
  const a = roleArchetype(job);
  const T = (name, type, difficulty, questions) => createTopic({ name, type, difficulty, questions });
  if (a === 'engineering') {
    return { topics: [
      T('System design', 'Theoretical', 'Hard', [
        lq('Walk me through how you would design a service that needs to stay fast as traffic grows tenfold.', 'system_design', 'Hard', 'Scalability',
          'Identifies bottlenecks, introduces caching and horizontal scaling, and reasons about data access patterns and trade-offs.',
          [['Names a concrete bottleneck and fix', ['bottleneck', 'cache', 'scale'], 3], ['Reasons about trade-offs, not just tools', ['trade-off', 'consistency', 'latency'], 2]],
          [['Lists technologies with no reasoning', 'medium']]),
        lq('How do you keep data consistent across services when something fails mid-write?', 'system_design', 'Hard', 'Reliability',
          'Discusses idempotency, retries, transactions or sagas, and how partial failures are recovered.',
          [['Addresses partial-failure recovery', ['idempotent', 'retry', 'transaction'], 3], ['Names a concrete pattern (saga/outbox)', ['saga', 'outbox'], 2]],
          [['Assumes failures never happen', 'high']]),
      ]),
      T('Coding & quality', 'Experiential', 'Medium', [
        lq('Tell me about a tricky bug you tracked down. How did you isolate the root cause?', 'behavioral', 'Medium', 'Debugging',
          'Describes a systematic approach — reproduction, narrowing, instrumentation — and the actual root cause, not just the symptom.',
          [['Systematic isolation, not guessing', ['reproduce', 'isolate', 'logs'], 3], ['Found and fixed the root cause', ['root cause'], 2]],
          [['Only describes the symptom', 'medium']]),
        lq('How do you make sure your code is reliable before it ships?', 'technical_theory', 'Medium', 'Quality',
          'Covers automated tests, review, and CI, and reasons about what is worth testing rather than chasing coverage numbers.',
          [['Tests, review, and CI', ['test', 'review', 'ci'], 3], ['Judgment on what is worth testing', ['edge case', 'risk'], 2]],
          [['Relies only on manual testing', 'medium']]),
      ]),
      T('Collaboration', 'Experiential', 'Medium', [
        lq('Describe a time you disagreed with a teammate on a technical decision. What happened?', 'behavioral', 'Medium', 'Teamwork',
          'Shows the disagreement was resolved with data and listening, and that the relationship stayed intact.',
          [['Used evidence, not authority', ['data', 'evidence'], 3], ['Reached alignment professionally', ['align', 'listen'], 2]],
          [['Frames it as winning an argument', 'medium']]),
      ]),
    ] };
  }
  if (a === 'product') {
    return { topics: [
      T('Product sense', 'Experiential', 'Medium', [
        lq('Walk me through a product you shipped from zero to one. What was the riskiest assumption and how did you test it?', 'case_study', 'Medium', '0→1 ownership',
          'Names a concrete product, isolates one riskiest assumption, and tests it cheaply before building, with a metric-based decision.',
          [['Isolates a single riskiest assumption', ['assumption', 'risk'], 3], ['Tests cheaply before building', ['mvp', 'validate'], 3], ['Ties go/no-go to a metric', ['metric', 'threshold'], 2]],
          [['Jumps to building with no validation', 'high'], ['Cannot name a specific assumption', 'medium']]),
        lq('A feature has high engagement but low retention impact. How do you decide to invest or sunset it?', 'case_study', 'Medium', 'Prioritization',
          'Separates vanity from impact metrics, ties the call to strategy, and proposes a test rather than a gut decision.',
          [['Distinguishes engagement from impact', ['retention', 'impact'], 3], ['Decision tied to strategy or a metric', ['strategy', 'metric'], 2]],
          [['Decides on gut feel alone', 'medium']]),
      ]),
      T('Metrics & analytics', 'Theoretical', 'Hard', [
        lq('Daily active users are flat but revenue is up twenty percent. How would you diagnose what is happening?', 'technical_theory', 'Hard', 'Analytics',
          'Segments the funnel, forms hypotheses, and identifies which metric mix could produce that pattern.',
          [['Segments rather than guesses', ['segment', 'funnel'], 3], ['Forms testable hypotheses', ['hypothesis'], 2]],
          [['Jumps to one explanation', 'medium']]),
      ]),
      T('Stakeholder leadership', 'Experiential', 'Medium', [
        lq('Tell me about a time you had to align engineering and business stakeholders who wanted different things.', 'behavioral', 'Medium', 'Leadership',
          'Shows listening, reframing around shared goals, and a concrete outcome.',
          [['Reframed around shared goals', ['align', 'trade-off'], 3], ['Concrete outcome', ['outcome', 'shipped'], 2]],
          [['Just escalated to a manager', 'medium']]),
      ]),
    ] };
  }
  return { topics: [
    T('Core competency', 'Experiential', 'Medium', [
      lq('Walk me through a project you are proud of. What was your specific contribution and the impact?', 'behavioral', 'Medium', 'Impact',
        'Gives a concrete contribution, the reasoning behind decisions, and a measurable or clear impact.',
        [['Specific personal contribution', ['my role', 'i built'], 3], ['Clear impact', ['impact', 'result'], 2]],
        [['Only describes the team, not themselves', 'medium']]),
      lq('Tell me about a time you had to learn something new quickly to get a job done.', 'behavioral', 'Easy', 'Adaptability',
        'Shows proactive learning, a sensible approach, and a successful application under time pressure.',
        [['Proactive, structured learning', ['learn', 'research'], 3], ['Applied it successfully', ['applied', 'delivered'], 2]],
        [['Waited to be trained', 'low']]),
    ]),
    T('Problem solving', 'Theoretical', 'Medium', [
      lq('Describe a hard problem in your domain and how you approached it.', 'case_study', 'Medium', 'Reasoning',
        'Breaks the problem down, weighs options, and explains the chosen approach and its trade-offs.',
        [['Breaks the problem into parts', ['decompose', 'approach'], 3], ['Weighs trade-offs', ['trade-off', 'option'], 2]],
        [['No structured approach', 'medium']]),
    ]),
    T('Communication', 'Experiential', 'Easy', [
      lq('How would you explain your work to someone outside your field?', 'behavioral', 'Easy', 'Communication',
        'Translates jargon into plain language and structures the explanation for the audience.',
        [['Plain language, no jargon', ['plain', 'simple'], 3], ['Structured for the listener', ['audience', 'structure'], 2]],
        [['Stays heavy on jargon', 'low']]),
    ]),
  ] };
}

export function localScreeningQuestions(job) {
  const cats = (job.screeningParams || []).map((c) => (c.category || '').toLowerCase());
  const has = (k) => cats.some((c) => c.includes(k));
  const qs = [
    lq('To start, tell me a bit about your background and what you are working on right now.', 'hr_screening', 'Easy', 'Background',
      'Gives a concise, relevant summary of experience tied to this kind of role.', [['Relevant, concise background', ['experience'], 2]], []),
    lq('What interests you about this role and our company specifically?', 'hr_screening', 'Easy', 'Motivation',
      'Shows genuine, specific interest rather than a generic answer.', [['Specific, genuine motivation', ['interested', 'because'], 2]], [['Generic answer that fits any job', 'low']]),
  ];
  if (has('compensation') || has('availability')) {
    qs.push(lq('Could you share your notice period and your compensation expectations?', 'hr_screening', 'Easy', 'Logistics',
      'Gives clear figures and timeline that fit the role band.', [['Clear notice and expectations', ['notice', 'ctc', 'salary'], 2]], []));
  }
  if (has('location')) {
    qs.push(lq('Where are you currently based, and are you open to the role’s location or work arrangement?', 'hr_screening', 'Easy', 'Location',
      'States location and flexibility clearly.', [['Clear location and flexibility', ['based', 'relocate', 'remote'], 2]], []));
  }
  qs.push(lq('Tell me about a challenging situation in a previous role and how you handled it.', 'hr_screening', 'Easy', 'Fit',
    'Gives a concrete situation and a constructive resolution.', [['Concrete situation and resolution', ['situation', 'resolved'], 2]], []));
  return { questions: qs };
}
