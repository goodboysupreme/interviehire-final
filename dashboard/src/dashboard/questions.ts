// Legacy role-template question generator. Kept only as the keyless seed used by
// enrichJobWithAI at job creation (ai-api.js); the old Question Studio render path
// was removed when the Interview Blueprint Studio (blueprint-studio.js) replaced it.

import type { Job } from '../types/models';

function generateQuestionsLocally(job: Job) {
  const role = (job.roleName || job.cardName || 'Professional').toLowerCase();
  
  let questions = [];
  if (role.includes('developer') || role.includes('engineer') || role.includes('programmer') || role.includes('software')) {
    questions = [
      {
        id: "q-gen-1",
        type: "technical",
        question: "Explain the architectural considerations when building scalable web applications. How do you handle performance bottlenecks, caching, and database optimizations?",
        difficulty: "intermediate",
        rubric: "Candidate should explain caching strategies (Redis, CDN), database indexes/queries tuning, and horizontal vs. vertical scaling.",
        follow_ups: ["Can you share a real-world project where you resolved a bottleneck?", "How do you decide between SQL and NoSQL databases?"]
      },
      {
        id: "q-gen-2",
        type: "technical",
        question: "How do you ensure code quality, test coverage, and smooth CI/CD deployments in your team? What tools and practices do you advocate for?",
        difficulty: "intermediate",
        rubric: "Look for familiarity with Jest/Playwright, GitHub Actions/Jenkins, branch staging, linting, and peer reviews.",
        follow_ups: ["What is your strategy for testing async code or APIs?", "How do you handle rollbacks if a production deploy fails?"]
      },
      {
        id: "q-gen-3",
        type: "behavioral",
        question: "Describe a situation where you had a strong technical disagreement with a team lead or colleague. How did you present your arguments, and what was the outcome?",
        difficulty: "intermediate",
        rubric: "Candidate should demonstrate professional communication, active listening, reliance on data/evidence, and dedication to team alignment.",
        follow_ups: ["How did you handle the personal relationship afterward?", "What did you learn from that conflict?"]
      },
      {
        id: "q-gen-4",
        type: "behavioral",
        question: "Tell me about a time when you were assigned a task using a technology or domain you had zero prior experience with. How did you navigate the learning curve?",
        difficulty: "beginner",
        rubric: "Candidate should detail proactive research, asking questions, building small spikes/POCs, and managing deadlines under uncertainty.",
        follow_ups: ["How long did it take you to feel productive?", "Who did you look to for help or documentation?"]
      },
      {
        id: "q-gen-5",
        type: "situational",
        question: "Imagine our production application goes offline during a major product launch, and the team is under high pressure. Walk me through your immediate steps to diagnose and mitigate the issue.",
        difficulty: "advanced",
        rubric: "Candidate must emphasize safety first: checking logs (Sentry/Datadog), rolling back recent commits, transparent communication with stakeholders, and structured root-cause analysis.",
        follow_ups: ["How do you keep the rest of the team informed during the outage?", "What measures do you put in place to prevent a recurrence?"]
      }
    ];
  } else if (role.includes('manager') || role.includes('lead') || role.includes('product') || role.includes('director')) {
    questions = [
      {
        id: "q-gen-1",
        type: "technical",
        question: "How do you translate business objectives and customer feedback into a structured product roadmap? How do you prioritize feature requests?",
        difficulty: "intermediate",
        rubric: "Look for prioritization frameworks like RICE, Kano, or MoSCoW, data-driven decisions, and balancing stakeholder demands.",
        follow_ups: ["How do you handle a request that is high-priority for a client but low-value for the roadmap?", "How do you measure product-market fit?"]
      },
      {
        id: "q-gen-2",
        type: "technical",
        question: "Describe your approach to metric tracking and product analytics. What KPIs do you look at daily, and how do you use them to drive growth?",
        difficulty: "intermediate",
        rubric: "Candidate should mention DAU/MAU, conversion funnels, churn rate, NPS, and using tools like Amplitude, Mixpanel, or SQL.",
        follow_ups: ["How do you run and evaluate A/B test experiments?", "What is a leading indicator of churn in your experience?"]
      },
      {
        id: "q-gen-3",
        type: "behavioral",
        question: "Tell me about a time when you had to make a high-stakes decision without complete data. What was the situation, what did you decide, and what was the outcome?",
        difficulty: "intermediate",
        rubric: "Demonstrates ability to manage ambiguity, weigh risks, rely on qualitative signals, and take accountability for outcomes.",
        follow_ups: ["Would you make the same decision today?", "How did you communicate the risk to your leadership?"]
      },
      {
        id: "q-gen-4",
        type: "behavioral",
        question: "Describe a project that failed or missed its deadlines under your leadership. How did you manage expectations, and what retrospective actions did you take?",
        difficulty: "beginner",
        rubric: "Shows humility, transparency in reporting blockers, focus on learning, and implementing process guardrails in subsequent sprints.",
        follow_ups: ["How did the team react to the failure?", "What was the feedback from your client/stakeholder?"]
      },
      {
        id: "q-gen-5",
        type: "situational",
        question: "A key engineering lead states that a feature promised to marketing cannot be completed in time unless code quality is severely compromised. How do you handle this conflict?",
        difficulty: "advanced",
        rubric: "Balances technical debt and business deadlines. Prefers scoping down features, negotiation, clear alignment on technical trade-offs, and protecting team health.",
        follow_ups: ["How do you explain the delay to the marketing team?", "What is your strategy for paying back the tech debt later?"]
      }
    ];
  } else {
    questions = [
      {
        id: "q-gen-1",
        type: "technical",
        question: "What is your methodology for managing projects and deadlines? How do you ensure high-quality delivery when handling multiple competing priorities?",
        difficulty: "intermediate",
        rubric: "Candidate should mention prioritization (Eisenhower matrix), calendar blocks, task managers, status updates, and setting clear boundaries.",
        follow_ups: ["How do you handle sudden shifts in project goals?", "What tools do you find most effective for collaboration?"]
      },
      {
        id: "q-gen-2",
        type: "technical",
        question: "Describe your communication strategy when coordinating across different teams (e.g. Sales, Operations, Product). How do you align conflicting goals?",
        difficulty: "intermediate",
        rubric: "Look for stakeholder analysis, documentation (RFCs, minutes), regular syncs, empathy, and active listening.",
        follow_ups: ["What is your preferred format for weekly status updates?", "How do you handle a team that is slow to respond?"]
      },
      {
        id: "q-gen-3",
        type: "behavioral",
        question: "Tell me about a time when you received tough feedback from a supervisor or client. How did you process it, and what actions did you take to improve?",
        difficulty: "intermediate",
        rubric: "Shows growth mindset, emotional maturity, taking notes, creating an action plan, and seeking follow-up reviews.",
        follow_ups: ["How did your relationship with the feedback provider change?", "Can you give an example of a mistake you have corrected since then?"]
      },
      {
        id: "q-gen-4",
        type: "behavioral",
        question: "Describe a successful project you led or contributed to significantly. What was your role, and what specific impact did you deliver?",
        difficulty: "beginner",
        rubric: "Clear focus on contribution, collaboration, quantifying results (e.g. time saved, revenue increased, error rates reduced).",
        follow_ups: ["What part of the success are you most proud of?", "How did you celebrate the achievement with your team?"]
      },
      {
        id: "q-gen-5",
        type: "situational",
        question: "You realize that a teammate has made a critical error in a report already submitted to a client, but they are defensive about it. How do you handle this?",
        difficulty: "advanced",
        rubric: "Prioritizes correcting the error for the client first. Communicates privately, presents factual evidence objectively without blame, and collaborates on the fix.",
        follow_ups: ["How do you ensure the client's trust is maintained?", "How do you build a safer, blame-free culture in the team?"]
      }
    ];
  }
  return questions;
}

// Render the Questions Pane for a specific job

export { generateQuestionsLocally };
