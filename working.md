# Audited Frontend-Backend API Gaps

The following problems were audited in the IntervieHire dashboard integration. These describe the disconnections between the Next.js frontend and FastAPI backend in `api` mode:

## 1. Resume File Upload Sourcing persistence
- **Location**: `dashboard/src/dashboard/sourcing.js` (`importResumesCandidates`)
- **Problem**: When a user uploads candidate resume files, they are parsed client-side using the Next.js API route `/api/parse-file`, and the candidate profile is added only in-memory to the local `AppState.candidates`. They are never persisted to the backend API (`POST /api/jobs/{job_id}/applicants/bulk` or `/upload-resumes`). Consequently, upon page reload, the client hydrates candidate lists from the backend database, causing all uploaded candidate records to disappear.
- **Fix**: Direct the resume file uploads to hit the backend `/api/jobs/{job_id}/applicants/upload-resumes` multipart endpoint in `api` mode, which parses and saves the candidate records directly on the database.

## 2. Resume Analysis Results persistence
- **Location**: `dashboard/src/dashboard/resume-analysis.js` (`runResumeAnalysis`)
- **Problem**: When the recruiter runs Lina AI Resume Analysis, the match score and JSON analysis report are stored in the client-side `AppState.candidates` and saved to localStorage. However, in `api` mode, this data is never sent to the backend. Reloading the page fetches candidate lists from the database, causing the analysis score and report to vanish.
- **Fix**: When analysis completes successfully in `api` mode, call the backend `PATCH /api/jobs/applicants/{applicant_id}` endpoint to save the match score (`match_score`) and serialized JSON analysis report (`resume_analysis_report`).

## 3. Candidate Remarks persistence
- **Location**: `dashboard/src/dashboard/report-page.js` (remarks form submission)
- **Problem**: Adding remarks inside the candidate details panel only modifies the in-memory candidate remarks list and saves it to localStorage. It does not update the database, meaning comments are lost on page refreshes.
- **Fix**: When a remark is added in `api` mode, call the backend `PATCH /api/jobs/applicants/{applicant_id}` endpoint to update the `remarks` column with a serialized JSON string containing the remarks timeline.

## 4. settings Password change Connection
- **Location**: `dashboard/src/dashboard/mount.js` (`btn-change-password` click event)
- **Problem**: Clicking the "Update Password" button in the Settings page merely displays a mockup toast stating "Password change dialog would open here." The backend has a `PUT /api/settings/password` endpoint, but it is not consumed.
- **Fix**: Implement a modal form dialog in the settings panel that prompts for the current password and new password, and calls the password update endpoint on submission.

## 5. Remarks button Click listener missing
- **Location**: `dashboard/src/dashboard/job-detail-panes.js` (tables roster)
- **Problem**: Roster tables render a `Remarks` button for each candidate, but no click event listener is registered for them, making them completely unresponsive.
- **Fix**: Register click listeners for `.btn-remarks` to open the candidate report page drawer (`openReportDrawerForCandidate`).

## 6. Applicants remarks & report Hydration mapping
- **Location**: `dashboard/src/dashboard/api.js` (`mapApplicantOutToCandidate`)
- **Problem**: The frontend maps incoming backend applicant records to camelCase candidate objects but leaves `remarks` and `resumeAnalysis` empty/unmapped.
- **Fix**: Parse `remarks` and `resume_analysis_report` from the backend JSON strings and map them to the mapped candidate objects.
