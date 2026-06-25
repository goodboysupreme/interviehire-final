// Shared HTML-escaping helper. Every module that interpolates user-supplied or
// AI-generated text into an innerHTML template literal MUST run it through this
// first — resume/CSV content and LLM output are untrusted and persist in
// localStorage, so an unescaped value is stored XSS.
export function escapeHTML(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
