import type {
  CandidateResponseInput,
  FollowupContext,
  InterviewTurnLink,
  QuestionEvaluationConfig,
  TranscriptResponseInput,
} from "./types.js";

export function createPredeterminedResponseInput(params: {
  answerId: string;
  question: Omit<QuestionEvaluationConfig, "questionOrigin">;
  transcript: string;
  language?: string;
}): CandidateResponseInput {
  return {
    answerId: params.answerId,
    question: {
      ...params.question,
      questionOrigin: "predetermined",
    },
    response: createTranscriptResponse(params.transcript, params.language),
  };
}

export function createGeneratedFollowupResponseInput(params: {
  answerId: string;
  followupQuestion: Omit<QuestionEvaluationConfig, "questionOrigin" | "questionType"> &
    Partial<Pick<QuestionEvaluationConfig, "questionType">>;
  transcript: string;
  followupContext: FollowupContext;
  language?: string;
}): CandidateResponseInput {
  return {
    answerId: params.answerId,
    question: {
      ...params.followupQuestion,
      questionType: params.followupQuestion.questionType ?? "followup",
      questionOrigin: "generated_followup",
    },
    response: createTranscriptResponse(params.transcript, params.language),
    followupContext: params.followupContext,
  };
}

export function createFollowupLink(params: InterviewTurnLink): InterviewTurnLink {
  return {
    originalQuestionId: params.originalQuestionId,
    originalAnswerId: params.originalAnswerId,
    followupQuestionId: params.followupQuestionId,
    followupAnswerId: params.followupAnswerId,
  };
}

function createTranscriptResponse(transcript: string, language?: string): TranscriptResponseInput {
  return {
    source: "transcript",
    transcript,
    language,
  };
}
