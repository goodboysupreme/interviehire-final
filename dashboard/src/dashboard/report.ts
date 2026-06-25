import { openCandidateReportPage } from './report-page';
import type { Candidate, CandidateStatus, TranscriptLine } from '../types/models';

// ==========================================
// CANDIDATE REPORT — stage helpers + entry points
// The old slide-drawer report was replaced by the full-page
// report in report-page.js; both entry points route there.
// ==========================================

function openCandidateReport(candidateId: string) {
  openCandidateReportPage(candidateId);
}

function openReportDrawerForCandidate(candidateId: string) {
  openCandidateReportPage(candidateId);
}

function getCandidateNextStage(status: CandidateStatus | string) {
  if (status === 'Resume') return 'Screening';
  if (status === 'Screening') return 'Functional';
  if (status === 'Functional') return 'Hired';
  return null;
}

function getCandidateStageRank(status: CandidateStatus | string) {
  const ranks: Record<string, number> = { Resume: 0, Screening: 1, Functional: 2, Hired: 3 };
  return ranks[status] ?? 0;
}

function getCandidateTranscriptLines(candidate: Candidate): TranscriptLine[] {
  const raw = candidate.screeningTranscript || candidate.interviewTranscript || candidate.transcript;
  if (Array.isArray(raw)) return raw.filter(line => line && (line.text || typeof line === 'string'));
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split('\n').map(line => ({ speaker: 'Transcript', text: line.trim() })).filter(line => line.text);
  }
  return [];
}

function normalizeAnalysisList(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items.filter(Boolean).map(item => String(item).trim()).filter(Boolean);
}

export { getCandidateNextStage, getCandidateStageRank, getCandidateTranscriptLines, normalizeAnalysisList, openCandidateReport, openReportDrawerForCandidate };
