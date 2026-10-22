# IntelliHire AI — Persistence and Resume Builder Patch

## Interview / Feedback Agent
- Interview history now returns all sessions belonging to the signed-in Firebase user, including `in_progress`, `completed`, and `cancelled` sessions.
- History retains chronological order because the Feedback Agent's score-change comparison uses older sessions before newer sessions.
- Completed interview answers and their initial report scores remain persisted in `InterviewSession` before the final report is generated. If final report generation fails, the completed session remains visible and the report can be retried.
- Early-ended sessions remain visible for partial feedback; draft answers are preserved by the end-session endpoint.

## Resume Agent / Analyzer
- Added `ResumeRecord` model and authenticated `/api/resume/records` endpoints.
- Successful resume analyses are persisted with the analysis results, target role, job description, source filename, and extracted character count.
- If analysis-record persistence fails after the credit deduction, the backend attempts to refund the analysis credits and returns an explicit error.

## Resume Builder
- Added a Resume Builder workspace with fields for contact details, target role, summary, skills, education, experience, projects, and certifications.
- Builder data is saved to MongoDB under the authenticated Firebase UID and can be edited later.
- Saved builder and analyzer records are listed in the workspace; a plain-text copy can be downloaded.

## Verification
- `node --check` passed for backend server, ResumeRecord model, and interview history service.
- Backend automated tests: 48/48 passed.
- Frontend production build could not be verified in this Linux container because the uploaded `node_modules` package is missing the platform-specific Rolldown native binding. Run `npm install` on your Windows machine and then `npm run build`.
- Live MongoDB, Firebase, and Groq integration still requires testing with your own rotated credentials.

## Setup
- Keep secrets only in your local `backend/.env`; this ZIP excludes `.env` and Firebase service-account JSON files.
- Install dependencies in the project root and backend with `npm install`, then start both processes in separate terminals.
