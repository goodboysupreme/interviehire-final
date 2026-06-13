// Single source of truth for the vocabularies that were drifting across the
// JD/parse prompts, the edit dropdowns, and the question editors — mismatches
// here silently corrupted AI output (experience bands reset on edit, question
// difficulty downgraded on save). Every prompt, <select>, and default MUST use
// these so AI-set values always round-trip.

export const EXPERIENCE_BANDS = [
  'Fresher',
  'Upto 2 Years',
  '1-4 Years',
  '3-6 Years',
  '5-10 Years',
  '8-15 Years',
  '10+ Years',
];

export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'];

// Pipe-joined form for embedding the allowed values inside an LLM prompt.
export const EXPERIENCE_BANDS_PROMPT = EXPERIENCE_BANDS.join(' | ');
export const DIFFICULTY_LEVELS_PROMPT = DIFFICULTY_LEVELS.join(' | ');
