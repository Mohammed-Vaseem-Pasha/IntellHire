<<<<<<< HEAD
# IntelliHire AI

IntelliHire AI is a career-preparation app with a React/Vite frontend and an
Express backend. It includes an authenticated resume analyzer and an AI
interview practice flow.

## Resume Analyzer

Upload a text-readable PDF resume (maximum 10 MB) and optionally provide a job
description and target title. The analyzer reports a general resume-quality
score without a job description, or an explainable, job-specific match score
when one is supplied. It identifies evidence from the resume and treats
unmentioned skills as unverified rather than proof that the candidate lacks
them. Scanned PDFs without extractable text are not OCR-processed.

## Interview Agent

Upload a text-readable PDF resume (maximum 10 MB) and select a required target
job role to start an interview. A job description is optional. The backend
extracts resume text and asks Groq to identify stated education, experience,
skills, projects, internships, certifications, achievements, and interests.
Those details, the target role (and optional job description), and the
candidate's complete answer history guide each conversational response. The
interviewer briefly acknowledges useful answer details when appropriate,
clarifies unclear answers, and follows relevant project or experience details
instead of reading a prepared question list. The opening question is
"Tell me about yourself." The backend derives progression from the saved
conversation and resume: it explores relevant resume areas, then asks a
selected-role technical question, motivation, suitability, and five-year
career goals before it can conclude. Fresher sessions focus on academic work,
education, and skills; sessions with listed employment explore that
experience. Role-specific guidance covers frontend, backend, full-stack, data
science, and AI/ML interviews. Each session persists a target of 10
substantive questions, raised to 12 for technical roles with substantial resume
evidence. Set `INTERVIEW_TARGET_QUESTIONS` to a value from 10 to 15 to choose a
fixed target. The backend completes only after the target is reached and the
planned final stage is complete, or when the candidate explicitly asks to end
early. Brief acknowledgments, candidate questions, and continue/clarification
requests do not count as interview questions. A temporary model failure does
not advance or complete the current turn; the saved answer can be retried.

The interviewer opens with the requested greeting, speaks each question, and
automatically starts browser speech recognition after playback. Answers are
collected as final speech-recognition results and finalized after a
configurable pause of 2.8 seconds (`VITE_INTERVIEW_ANSWER_PAUSE_MS`, accepted
range 2.5-15 seconds). Resumed speech resets the pause timer, and browser
recognition restarts preserve finalized transcript segments. Silence without
an answer and temporary recognition failures receive at most two automatic
retries. Completed answers are evaluated exactly once before the next
question is spoken. Permission or device failures stop automatic listening
and leave text entry available. When complete, the system stops recognition,
speaks a closing message, then generates a transcript-grounded report. It
does not assess facial expressions, body language, or vocal confidence.
Answer processing has a 45-second timeout; failed submissions retain the
transcript for retry. Groq answer evaluation retries temporary API/network or
invalid-response failures once. A successful evaluation is checkpointed under
its answer submission ID before the next question is generated, so retrying
after a later save or question-generation failure reuses the evaluation rather
than scoring the answer again. Per-answer evaluation uses the verified
`openai/gpt-oss-120b` model, low reasoning effort, bounded API retries, and
concise role-, answer-, question-, and resume-grounded JSON output. Timing
logs report Groq request, response parsing, checkpoint/final database saves,
backend phases, and total frontend request duration without logging the
candidate's answer. Voice interviews require a supported browser,
microphone permission, and speech synthesis; typed answers remain available
when speech recognition is unavailable.

## Development

Install dependencies in the project root and in `backend/`. Run the frontend
with `npm run dev` from the project root and the API with `npm run dev` from
`backend/`. Run the backend policy tests with `npm test` from `backend/` and
the voice-recovery and answer-API tests with
`node --test src/lib/voiceRecovery.test.js src/lib/interviewApi.test.js` from
the project root. The frontend production build is available through
`npm run build`.

The backend requires its Firebase Admin credentials, MongoDB connection
settings, and `GROQ_API_KEY` in its local environment configuration. Keep
credentials and API keys out of frontend code and source control.
=======
# IntellHire
IntelliHire AI is an AI-powered platform for mock interviews, instant feedback, performance scoring, resume ATS analysis, and personalized career preparation.
>>>>>>> 9bee750963316782705991076ac5ff635d48e39a
