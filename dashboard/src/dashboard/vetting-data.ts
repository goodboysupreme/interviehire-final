import { document } from './runtime';
import type { CandidateVettingDetail } from '../types/models';

// ==========================================
// CANDIDATE VETTING DATABASE & STATE TRACKING
// ==========================================
const activeCandidateSubTabs: Record<string, string> = {};

const CandidateVettingDetails: Record<string, CandidateVettingDetail> = {
  'CAN-3401-EA1': {
    summary: 'Strong candidate with structured knowledge in modern layout patterns and CSS grids. Showed great alignment with procurement executive requirements but has a 2-month notice period.',
    caveats: [
      { type: 'warning', text: 'Notice Period: 2 months (requires immediate buyout context).' },
      { type: 'warning', text: 'Language Vetting: Occasional grammatical hesitancy when detailing high-volume client negotiations.' },
      { type: 'info', text: 'Technical Depth: Fluent in modern CSS (variables, grid, flexbox) but lacks full-stack routing experience.' }
    ],
    pros: [
      'Expertise in structured layout frameworks (CSS Grid & Flexbox).',
      'Strong eye for interface consistency and typography scaling.',
      'Calm, solution-oriented conversational tone.'
    ],
    cons: [
      'No experience with server-side proposal templating engines.',
      'May require initial guidance on government tender format specifics.'
    ],
    rubrics: [
      { label: 'Aesthetic Alignment', score: 9.0 },
      { label: 'Technical Foundation', score: 8.0 },
      { label: 'Communication Tone', score: 9.0 },
      { label: 'Tender Process Knowledge', score: 7.5 }
    ],
    transcript: [
      { speaker: 'Lina', text: 'Can you explain how you handle conflicting opinions in project schedules?' },
      { speaker: 'Ines', text: 'I lay out the technical constraints, compare the alternatives side-by-side using data, and facilitate a consensus meeting.' },
      { speaker: 'Lina', text: 'How do you structure CSS grids for dynamic content lengths in proposals?' },
      { speaker: 'Ines', text: 'I use auto-fit and minmax patterns in grid-template-columns, which lets the browser calculate layout sizes without breaking columns.' }
    ]
  },
  'CAN-9012-EA2': {
    summary: 'Detail-oriented backend engineer with secure session experience. Demonstrated strong knowledge of cryptography libraries, but requires training in front-end JS frameworks.',
    caveats: [
      { type: 'warning', text: 'Framework Gap: Highly proficient in Python helper patterns but lacks React ecosystem exposure.' },
      { type: 'info', text: 'Security Focus: Implements proper JWT signature controls and secret rotation mechanisms.' }
    ],
    pros: [
      'Excellent grasp of cryptography tools and JWT implementations.',
      'High rigor in outlining edge cases for secure communications.',
      'Proactive approach to rate limit headers and client defense.'
    ],
    cons: [
      'Limited visual interface development experience.',
      'Needs training to support team front-end deliverables.'
    ],
    rubrics: [
      { label: 'Security & Auth Vetting', score: 9.5 },
      { label: 'System Architecture', score: 9.0 },
      { label: 'Communication Flow', score: 8.5 },
      { label: 'Clean Code Hygiene', score: 9.0 }
    ],
    transcript: [
      { speaker: 'Lina', text: 'Can you explain how you handle conflicting opinions in project schedules?' },
      { speaker: 'Sarah', text: 'I align everyone on the technical goal first, document the architectural impact, and make a decision based on scalability.' },
      { speaker: 'Lina', text: 'What is your strategy for secure token rotation in API clients?' },
      { speaker: 'Sarah', text: 'We issue short-lived access tokens, use secure HttpOnly cookies for refresh tokens, and revoke the refresh chain if a duplicate usage is detected.' }
    ]
  },
  'CAN-7128-DF5': {
    summary: 'Remarkable performance in Golang tender scraper evaluation. Developed clean worker pools with proper context lifecycle support. Fits the culture perfectly.',
    caveats: [
      { type: 'warning', text: 'Remote Preference: Prefers fully remote work (might require adjustment for hybrid tender briefs).' },
      { type: 'info', text: 'Execution Speed: Code shows high efficiency with zero goroutine leaks on exit.' }
    ],
    pros: [
      'Superb implementation of Go worker pools and parallel channels.',
      'Handles external request cancellation gracefully using context.WithTimeout.',
      'Clear documentation structure inside codebase.'
    ],
    cons: [
      'Prefers purely backend tasks, slight resistance to frontend adjustments.'
    ],
    rubrics: [
      { label: 'Concurrency Control', score: 10.0 },
      { label: 'Context Lifecycle', score: 9.5 },
      { label: 'Scraping Architecture', score: 9.0 },
      { label: 'Executive Presentation', score: 9.5 }
    ],
    transcript: [
      { speaker: 'Kaelen', text: 'Can you walk through your concurrency implementation in the tender scraper?' },
      { speaker: 'Devasri', text: 'I spin up a buffered work channel and limit our worker goroutines. I select on context cancellation to stop fetching immediately if there is a timeout or if the user cancels.' }
    ]
  },
  'CAN-8234-EA1': {
    summary: 'Strong React cleanup designer. Implements AbortController to cleanly cancel asynchronous state updates and prevent memory leaks.',
    caveats: [
      { type: 'warning', text: 'React Version: Deep React 18 knowledge but needs alignment on React 19 Server Actions.' },
      { type: 'info', text: 'Resource Management: Uses active cancellation protocols to avoid race conditions.' }
    ],
    pros: [
      'Excellent cleanup hook implementation.',
      'Understands async race conditions in concurrent UI fetches.',
      'Clean file organization and concise component design.'
    ],
    cons: [
      'Lacks familiarity with modern Next.js App Router configurations.'
    ],
    rubrics: [
      { label: 'Resource Cleanup', score: 9.5 },
      { label: 'State Management', score: 9.0 },
      { label: 'Race Prevention', score: 9.0 },
      { label: 'Code Aesthetics', score: 9.5 }
    ],
    transcript: [
      { speaker: 'Kaelen', text: 'How do you handle memory leaks in React side effects?' },
      { speaker: 'Aditya', text: 'I use the cleanup function of useEffect. By returning a function that aborts the controller or clears timeouts, we prevent state updates on unmounted components.' }
    ]
  }
};

function getCandidateVettingDetails(candId: string, candidateName: string): CandidateVettingDetail {
  if (CandidateVettingDetails[candId]) {
    return CandidateVettingDetails[candId];
  }
  return {
    summary: `${candidateName} is an active candidate currently undergoing evaluation. Shown promising results during initial screening tests.`,
    caveats: [
      { type: 'info', text: 'Evaluation is in progress. Initial scores are generated dynamically.' }
    ],
    pros: [
      'Structured response formatting.',
      'Active alignment with the target role description.'
    ],
    cons: [
      'Pending final technical interview round.'
    ],
    rubrics: [
      { label: 'Technical Fit', score: 8.5 },
      { label: 'Communication', score: 8.0 },
      { label: 'Cultural Fit', score: 8.0 },
      { label: 'Problem Solving', score: 8.5 }
    ],
    transcript: [
      { speaker: 'Lina', text: 'Please tell us a bit about your experience.' },
      { speaker: 'Candidate', text: 'I have been working in engineering roles, focusing on building scalable systems and collaborating with product teams.' }
    ]
  };
}


export { activeCandidateSubTabs, CandidateVettingDetails, getCandidateVettingDetails };
