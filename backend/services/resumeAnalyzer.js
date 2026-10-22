/**
 * IntelliHire AI — Resume & ATS Analysis Engine v3.0
 * Rule-based ATS matching enhanced with Groq AI for deep job-specific analysis.
 */

// Curated Technical & Professional Skill Taxonomy
const SKILL_TAXONOMY = [
  // Languages & Core
  "javascript", "typescript", "python", "golang", "go", "java", "c#", "c++", "c",
  "rust", "ruby", "php", "swift", "kotlin", "sql", "html", "html5", "css", "css3",

  // Frontend
  "react", "react.js", "next.js", "vue", "vue.js", "angular", "svelte", "redux",
  "tailwind", "tailwindcss", "sass", "webpack", "vite", "graphql", "rest", "restful api",
  "responsive design", "accessibility", "a11y", "web performance", "dom", "shadcn",

  // Backend & APIs
  "node.js", "express", "express.js", "nestjs", "fastapi", "django", "flask", "spring boot",
  ".net", "asp.net", "rails", "microservices", "monolith", "grpc", "websockets", "api design",
  "event-driven architecture", "message queues", "celery", "kafka", "rabbitmq",

  // Databases & Caching
  "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch", "dynamodb",
  "cassandra", "sqlite", "prisma", "mongoose", "typeorm", "orm", "nosql", "relational database",
  "indexing", "query optimization", "data modeling",

  // DevOps, Cloud & Infra
  "aws", "amazon web services", "azure", "google cloud", "gcp", "docker", "kubernetes",
  "k8s", "terraform", "ci/cd", "continuous integration", "github actions", "gitlab ci",
  "jenkins", "ansible", "helm", "linux", "bash", "nginx", "prometheus", "grafana",
  "cloud architecture", "serverless", "lambda", "ecs", "s3",

  // Software Engineering Practices
  "git", "github", "gitlab", "system design", "distributed systems", "high availability",
  "scalability", "unit testing", "integration testing", "tdd", "test driven development",
  "jest", "cypress", "playwright", "code review", "agile", "scrum", "kanban",
  "security", "oauth", "jwt", "owasp", "performance tuning", "concurrency",

  // AI, Data & ML
  "machine learning", "deep learning", "nlp", "llm", "large language models", "rag",
  "vector database", "pinecone", "chroma", "langchain", "prompt engineering",
  "pytorch", "tensorflow", "pandas", "numpy", "scikit-learn", "data engineering",

  // Leadership & Process
  "technical leadership", "architecture design", "cross-functional collaboration",
  "mentorship", "stakeholder management", "project management", "rfc authoring",
  "code standards", "system architecture", "root cause analysis"
];

// Common Action Verbs in Technical Resumes
const ACTION_VERBS = [
  "architected", "engineered", "designed", "developed", "built", "spearheaded",
  "optimized", "scaled", "deployed", "implemented", "refactored", "automated",
  "accelerated", "reduced", "increased", "migrated", "mentored", "orchestrated",
  "integrated", "authored", "led", "delivered", "streamlined", "enhanced"
];

/**
 * Extracts readable text from a PDF Buffer
 */
async function extractTextFromPdf(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty PDF buffer received.");
  }

  const pdfModule = require("pdf-parse");
  let rawText = "";

  if (pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: buffer });
    const result = await parser.getText();
    rawText = (result && result.text) ? result.text : "";
  } else if (typeof pdfModule === "function") {
    const result = await pdfModule(buffer);
    rawText = (result && result.text) ? result.text : "";
  } else {
    throw new Error("PDF parser initialization failed on server.");
  }

  const cleanedText = rawText.replace(/\r\n/g, "\n").trim();

  // Validate that the PDF actually has selectable text (not scanned images)
  if (cleanedText.length < 50) {
    throw new Error(
      "The uploaded PDF does not contain extractable text. Please ensure your resume is not a scanned raster image and was exported as a selectable text document."
    );
  }

  return cleanedText;
}

/**
 * Normalizes text for matching
 */
function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ");
}

/**
 * Extracts skills from text using taxonomy
 */
function extractSkills(text) {
  const norm = ` ${normalize(text)} `;
  const found = new Set();

  for (const skill of SKILL_TAXONOMY) {
    // Escape regex characters
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?:$|[^a-z0-9+#.])`, "i");
    if (regex.test(norm)) {
      found.add(skill);
    }
  }

  return Array.from(found);
}

/**
 * Extracts standard ATS structural sections
 */
function analyzeStructure(text) {
  const lower = text.toLowerCase();

  const sections = {
    hasContactInfo: false,
    hasExperience: false,
    hasEducation: false,
    hasSkills: false,
    hasProjectsOrSummary: false,
  };

  // Contact checks
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  if (emailRegex.test(text) || phoneRegex.test(text) || lower.includes("linkedin.com") || lower.includes("github.com")) {
    sections.hasContactInfo = true;
  }

  // Experience section
  if (/(?:experience|work history|employment|career history|professional background)/i.test(lower)) {
    sections.hasExperience = true;
  }

  // Education section
  if (/(?:education|university|degree|bachelor|master|phd|diploma|academic)/i.test(lower)) {
    sections.hasEducation = true;
  }

  // Skills section
  if (/(?:skills|technologies|technical stack|competencies|tools|proficiencies)/i.test(lower)) {
    sections.hasSkills = true;
  }

  // Projects or Summary
  if (/(?:projects|summary|about me|achievements|certifications)/i.test(lower)) {
    sections.hasProjectsOrSummary = true;
  }

  let count = 0;
  for (const key of Object.keys(sections)) {
    if (sections[key]) count++;
  }

  const structuralScore = Math.round((count / 5) * 100);

  return {
    score: structuralScore,
    details: sections,
  };
}

function extractResumeEvidence(text, jobSkills) {
  const sections = {
    experience: [],
    projects: [],
    certifications: [],
    education: [],
  };
  const headingPatterns = {
    experience: /^(?:(?:work|professional)\s+)?(?:experience|employment|career|background|work\s+history)\b/i,
    projects: /^(?:selected\s+)?projects?\b/i,
    certifications: /^(?:licenses?\s*(?:&|and)\s*)?certifications?\b/i,
    education: /^(?:education|academic\s+background|qualifications?)\b/i,
  };
  let currentSection = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s•*-]+/, "").trim();
    if (!line || line.length > 500) continue;

    const heading = Object.entries(headingPatterns).find(([, pattern]) =>
      pattern.test(line)
    );
    if (heading) {
      currentSection = heading[0];
      continue;
    }

    if (/^(?:skills|technical\s+skills|summary|profile|objective|awards?)\b/i.test(line)) {
      currentSection = "";
      continue;
    }
    if (currentSection) sections[currentSection].push(line);
  }

  const isRelevant = (line) =>
    jobSkills.length === 0 ||
    jobSkills.some((skill) => normalize(line).includes(normalize(skill)));
  const relevantExperience = sections.experience.filter(isRelevant).slice(0, 6);
  const relevantProjects = sections.projects.filter(isRelevant).slice(0, 6);
  const relevantCertifications = sections.certifications.filter(isRelevant).slice(0, 5);

  return {
    relevantExperience:
      relevantExperience.length > 0
        ? relevantExperience
        : sections.experience.slice(0, 4),
    projects:
      relevantProjects.length > 0
        ? relevantProjects
        : sections.projects.slice(0, 4),
    certifications:
      relevantCertifications.length > 0
        ? relevantCertifications
        : sections.certifications.slice(0, 4),
    qualifications: sections.education.slice(0, 4),
    experienceSectionPresent: sections.experience.length > 0,
  };
}

/**
 * Measures experience and education alignment
 */
function analyzeExperienceAndEducation(resumeText, jobText) {
  const jobLower = jobText.toLowerCase();
  const resumeLower = resumeText.toLowerCase();

  // Detect years of experience requested in job
  const expMatch = jobLower.match(/(\d+)\+?\s*(?:to\s*(\d+))?\s*(?:years?|yrs?)(?:\s*of)?\s*(?:experience|exp)?/i);
  let reqYears = expMatch ? parseInt(expMatch[1], 10) : null;

  // Detect years in resume
  const resumeExpMatches = resumeLower.match(/\b(20\d{2}|19\d{2})\b/g);
  let estimatedYears = null;
  if (resumeExpMatches && resumeExpMatches.length >= 2) {
    const years = resumeExpMatches.map((y) => parseInt(y, 10)).filter((y) => y <= new Date().getFullYear());
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    if (maxYear - minYear > 0 && maxYear - minYear < 40) {
      estimatedYears = maxYear - minYear;
    }
  }

  // Detect degree in job description
  let degreeReq = "Not explicitly stated";
  if (/master|ms in|m\.s\./i.test(jobLower)) {
    degreeReq = "Master's Degree preferred/required";
  } else if (/bachelor|bs in|b\.s\.|computer science degree|undergraduate/i.test(jobLower)) {
    degreeReq = "Bachelor's Degree in CS or equivalent";
  }

  // Detect degree in resume
  let candidateDegree = "No formal degree header identified";
  if (/phd|doctorate/i.test(resumeLower)) {
    candidateDegree = "Ph.D. / Doctorate detected";
  } else if (/master|m\.s\.|msc/i.test(resumeLower)) {
    candidateDegree = "Master's Degree identified";
  } else if (/bachelor|b\.s\.|bsc|b\.tech|b\.e\./i.test(resumeLower)) {
    candidateDegree = "Bachelor's Degree identified";
  }

  let experienceStatus = "Aligned";
  if (reqYears && estimatedYears) {
    if (estimatedYears >= reqYears) {
      experienceStatus = `Meets or exceeds requirement (~${estimatedYears} yrs detected vs ${reqYears}+ yrs required)`;
    } else {
      experienceStatus = `Potential seniority gap (~${estimatedYears} yrs detected vs ${reqYears}+ yrs required)`;
    }
  } else if (reqYears) {
    experienceStatus = `Job requests ${reqYears}+ years; verify career timeline highlights`;
  } else {
    experienceStatus = "General experience matches job profile";
  }

  return {
    requiredYears: reqYears ? `${reqYears}+ years` : "Flexible / Not explicitly specified",
    detectedExperience: estimatedYears ? `~${estimatedYears} years of detected history` : "Experience timeline detected",
    experienceStatus,
    requiredEducation: degreeReq,
    candidateEducation: candidateDegree,
  };
}

/**
 * Checks for action verbs & quantified metrics
 */
function analyzeImpactAndVerbs(text) {
  const lower = text.toLowerCase();
  const foundVerbs = [];

  for (const verb of ACTION_VERBS) {
    const regex = new RegExp(`\\b${verb}\\b`, "i");
    if (regex.test(lower)) {
      foundVerbs.push(verb);
    }
  }

  // Detect quantitative metrics: percentages (%), dollar amounts ($), scale numbers (10x, 500k, 2M)
  const metricMatches = text.match(/\b(?:\d+%(?:\.\d+)?|\$\d+(?:\.\d+)?(?:k|m|b)?|\d+(?:k|m|b|\+)\b|\b\d+x\b)/gi) || [];
  const uniqueMetrics = Array.from(new Set(metricMatches)).slice(0, 8);

  const verbScore = Math.min(100, Math.round((foundVerbs.length / 8) * 100));
  const metricScore = Math.min(100, Math.round((uniqueMetrics.length / 5) * 100));
  const impactScore = Math.round((verbScore * 0.5) + (metricScore * 0.5));

  return {
    score: impactScore,
    actionVerbsFound: foundVerbs.slice(0, 10),
    sampleMetricsFound: uniqueMetrics,
  };
}

/**
 * Groq AI deep analysis for job-specific resume insights.
 * Returns enhanced fields: partially matched skills, missing skill analysis,
 * ATS keywords, bullet improvements, and prioritized action plan.
 */
async function getGroqResumeInsights(resumeText, jobDescription, targetJobTitle, ruleBasedData) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const Groq = require("groq-sdk");
  const groq = new Groq({ apiKey });

  const matchedStr = (ruleBasedData.matchedSkills || []).join(", ");
  const missingStr = (ruleBasedData.missingSkills || []).join(", ");

  const prompt = `You are a senior technical recruiter and ATS specialist analyzing a resume against a job description.

TARGET ROLE: ${targetJobTitle || "Not specified"}

JOB DESCRIPTION:
${jobDescription.slice(0, 3000)}

RESUME TEXT:
${resumeText.slice(0, 4000)}

RULE-BASED ANALYSIS FOUND:
- Matched skills: ${matchedStr || "None detected"}
- Missing skills: ${missingStr || "None detected"}
- ATS score: ${ruleBasedData.atsMatchScore || 0}%

Analyze this resume and return a JSON object with EXACTLY these fields:

{
  "partiallyMatchedSkills": [
    {"skill": "Skill Name", "reason": "Why this is a partial match — e.g., the candidate has React but JD asks for Next.js"}
  ],
  "missingSkillsDetailed": [
    {"skill": "Skill Name", "importance": "Critical|High|Medium|Low", "genuinelyMissing": false, "reason": "Why this skill matters for the JD", "recommendation": "What the candidate should do"}
  ],
  "requiredSkillsByImportance": [
    {"skill": "Skill Name", "importance": "Critical|High|Medium|Low", "matched": true}
  ],
  "atsKeywords": [
    {"keyword": "Keyword", "reason": "Why this keyword matters for this specific job description"}
  ],
  "relevantExperience": [
    {"evidence": "Exact experience detail supported by the resume", "whyRelevant": "How it supports this role"}
  ],
  "projects": [
    {"evidence": "Project detail supported by the resume", "whyRelevant": "How it supports this role"}
  ],
  "certifications": ["Certification stated in the resume"],
  "qualifications": ["Qualification stated in the resume"],
  "bulletImprovements": [
    {"original": "An actual weak bullet or phrase found in the resume", "improved": "A stronger version using only facts supported by the resume", "note": "Any caveats — e.g., verify the metric before using"}
  ],
  "actionPlan": [
    {"priority": 1, "action": "Specific action to take", "impact": "High|Medium|Low", "reason": "Why this matters"}
  ]
}

CRITICAL RULES:
- partiallyMatchedSkills: skills in the resume that PARTIALLY relate to a JD requirement (e.g., knowing JavaScript when TypeScript is required). Maximum 5.
- missingSkillsDetailed: an absent resume mention is unverified, not proof the candidate lacks a skill. Set genuinelyMissing=false unless the resume explicitly establishes that the candidate does not possess it. Maximum 8.
- requiredSkillsByImportance: ALL skills from the JD ranked by importance for the role. Maximum 12.
- atsKeywords: important keywords/phrases from the JD that should appear in the resume. Maximum 8.
- relevantExperience, projects, certifications, and qualifications must only quote or summarize information explicitly present in the resume. Do not infer credentials.
- bulletImprovements: improve 2-3 actual bullets from the resume. The original must be copied exactly from the resume. The improved version may not introduce new skills, tools, metrics, employers, projects, responsibilities, or qualifications. Clearly label any additional detail that still needs user confirmation.
- actionPlan: 3-5 prioritized steps. Priority 1 = most important.
- A skill absent from the resume is unverified, not proof that the candidate does not possess it. Never tell the user to claim a skill they do not possess. Recommend learning and demonstrating genuinely missing skills first.`;

  try {
    const response = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: "You are a precise resume analysis engine. Return valid JSON only. Never invent candidate experience.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    });

    const raw = response.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    return {
      partiallyMatchedSkills: Array.isArray(parsed.partiallyMatchedSkills)
        ? parsed.partiallyMatchedSkills.slice(0, 5)
        : [],
      missingSkillsDetailed: Array.isArray(parsed.missingSkillsDetailed)
        ? parsed.missingSkillsDetailed.slice(0, 8)
        : [],
      requiredSkillsByImportance: Array.isArray(parsed.requiredSkillsByImportance)
        ? parsed.requiredSkillsByImportance.slice(0, 12)
        : [],
      atsKeywords: Array.isArray(parsed.atsKeywords)
        ? parsed.atsKeywords.slice(0, 8)
        : [],
      relevantExperience: Array.isArray(parsed.relevantExperience)
        ? parsed.relevantExperience.slice(0, 6)
        : [],
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.slice(0, 6)
        : [],
      certifications: Array.isArray(parsed.certifications)
        ? parsed.certifications.slice(0, 5)
        : [],
      qualifications: Array.isArray(parsed.qualifications)
        ? parsed.qualifications.slice(0, 5)
        : [],
      bulletImprovements: Array.isArray(parsed.bulletImprovements)
        ? parsed.bulletImprovements
            .filter((item) => {
              if (
                typeof item?.original !== "string" ||
                typeof item?.improved !== "string" ||
                !resumeText.toLowerCase().includes(item.original.trim().toLowerCase())
              ) {
                return false;
              }

              const sourceWords = new Set(
                normalize(item.original).split(/\s+/).filter(Boolean)
              );
              const allowedActionWords = new Set(ACTION_VERBS);
              const stopWords = new Set([
                "a", "an", "and", "as", "at", "by", "for", "from", "in", "into",
                "of", "on", "or", "the", "to", "with",
              ]);
              const introducedWords = normalize(item.improved)
                .split(/\s+/)
                .filter(Boolean)
                .filter(
                  (word) =>
                    !sourceWords.has(word) &&
                    !allowedActionWords.has(word) &&
                    !stopWords.has(word)
                );
              const sourceNumbers = item.original.match(/\b\d[\d,.%$+-]*\b/g) || [];
              const improvedNumbers = item.improved.match(/\b\d[\d,.%$+-]*\b/g) || [];
              return (
                introducedWords.length === 0 &&
                improvedNumbers.every((number) => sourceNumbers.includes(number))
              );
            })
            .slice(0, 4)
        : [],
      actionPlan: Array.isArray(parsed.actionPlan)
        ? parsed.actionPlan.slice(0, 5)
        : [],
    };
  } catch (err) {
    console.warn("Groq resume enhancement skipped:", err.message);
    return null;
  }
}

/**
 * Main Analysis Orchestrator
 */
async function analyzeResume(resumeText, jobDescription, targetJobTitle = "") {
  const hasJobDescription =
    typeof jobDescription === "string" && jobDescription.trim().length >= 20;

  // 1. Skill Extraction
  const resumeSkills = extractSkills(resumeText);
  const jobSkills = hasJobDescription ? extractSkills(jobDescription) : [];

  const matchedSkills = jobSkills.filter((s) => resumeSkills.includes(s));
  const missingSkills = jobSkills.filter((s) => !resumeSkills.includes(s));
  const additionalSkills = resumeSkills.filter((s) => !jobSkills.includes(s)).slice(0, 10);
  const evidence = extractResumeEvidence(resumeText, jobSkills);
  const partialSkillPairs = [
    ["typescript", "javascript"],
    ["next.js", "react"],
    ["react", "javascript"],
    ["kubernetes", "docker"],
    ["aws", "azure"],
    ["azure", "aws"],
    ["postgresql", "mysql"],
    ["mysql", "postgresql"],
  ];
  const partiallyMatchedSkills = partialSkillPairs
    .filter(
      ([required, related]) =>
        missingSkills.includes(required) && resumeSkills.includes(related)
    )
    .map(([required, related]) => ({
      skill: required.toUpperCase(),
      reason: `${related.toUpperCase()} is explicitly listed in the resume and is related, but it does not establish experience with ${required.toUpperCase()}.`,
    }));

  // 2. Structural Analysis
  const structure = analyzeStructure(resumeText);

  // 3. Impact & Metric Analysis
  const impact = analyzeImpactAndVerbs(resumeText);

  // 4. Experience & Education Alignment
  const expAndEdu = hasJobDescription
    ? analyzeExperienceAndEducation(resumeText, jobDescription)
    : {
        requiredYears: "N/A — no job description provided",
        detectedExperience: "Experience timeline detected",
        experienceStatus: "General review — no JD to compare against",
        requiredEducation: "N/A",
        candidateEducation: "See resume",
      };

  // 5. Transparent evidence-based scoring factors
  const totalJobKeywords = Math.max(jobSkills.length, 1);
  const skillRatio = matchedSkills.length / totalJobKeywords;
  const skillScore = Math.min(100, Math.round(skillRatio * 100));
  const experienceRequirement = expAndEdu.requiredYears.match(/\d+/);
  const requiredYears = experienceRequirement
    ? Number.parseInt(experienceRequirement[0], 10)
    : null;
  const detectedYears = Number.parseInt(
    expAndEdu.detectedExperience.match(/\d+/)?.[0] || "",
    10
  );
  const experienceScore = requiredYears
    ? Number.isFinite(detectedYears)
      ? Math.min(100, Math.round((detectedYears / requiredYears) * 100))
      : evidence.experienceSectionPresent
        ? 50
        : 0
    : evidence.experienceSectionPresent
      ? matchedSkills.length > 0
        ? Math.round(
            (matchedSkills.filter((skill) =>
              evidence.relevantExperience.some((line) =>
                normalize(line).includes(normalize(skill))
              )
            ).length /
              matchedSkills.length) *
              100
          )
        : 60
      : 0;
  const evidenceScore = Math.round(
    impact.score * 0.6 +
      (evidence.relevantExperience.length > 0 ||
      evidence.projects.length > 0 ||
      evidence.certifications.length > 0
        ? 100
        : 0) *
        0.4
  );

  // 6. Explainable ATS Weighted Score Formula
  let finalScore;
  let scoreExplanation;

  if (hasJobDescription) {
    finalScore =
      Math.round(skillScore * 0.4) +
      Math.round(experienceScore * 0.3) +
      Math.round(evidenceScore * 0.2) +
      Math.round(structure.score * 0.1);

    scoreExplanation = `Job-Specific Match: ${finalScore}%. The deterministic estimate weights resume-evidenced required skills (40%), relevant experience (30%), supporting evidence such as achievements and role-relevant projects or certifications (20%), and ATS-readable structure (10%). ${jobSkills.length === 0 ? "No skills from the analyzer's supported requirements taxonomy were detected in the job description, so skill alignment contributes 0 points." : `${matchedSkills.length} of ${jobSkills.length} detected job skills are explicitly present in the resume.`}`;
  } else {
    // General review — score based on resume quality only
    finalScore =
      Math.round(structure.score * 0.4) +
      Math.round(impact.score * 0.35) +
      Math.round(Math.min(100, resumeSkills.length * 8) * 0.25);
    scoreExplanation = `General Resume Quality: ${finalScore}%. This is not a job-specific match score. The quality estimate weights ATS structure (40%), impact language and quantified evidence (35%), and breadth of detected skills (25%). Provide a target job description for job-specific matching.`;
  }

  // 7. Evidence-Based Strengths
  const strengths = [];
  if (matchedSkills.length >= 4) {
    strengths.push(
      `Strong core technology alignment in ${matchedSkills.slice(0, 4).join(", ").toUpperCase()}.`
    );
  } else if (matchedSkills.length > 0) {
    strengths.push(
      `Detected alignment in key domain skills: ${matchedSkills.join(", ").toUpperCase()}.`
    );
  }
  if (structure.score >= 80) {
    strengths.push(
      "Comprehensive ATS structural layout with clear contact, experience, skills, and education sections."
    );
  }
  if (impact.sampleMetricsFound.length >= 2) {
    strengths.push(
      `Quantified achievements detected with measurable indicators (${impact.sampleMetricsFound.slice(0, 3).join(", ")}).`
    );
  }
  if (impact.actionVerbsFound.length >= 4) {
    strengths.push(
      `Effective active language with high-impact engineering verbs (${impact.actionVerbsFound.slice(0, 4).join(", ")}).`
    );
  }
  if (strengths.length === 0) {
    strengths.push("Resume document is machine-readable and properly structured for standard parsing.");
  }

  // 8. Targeted Improvement Suggestions
  const suggestions = [];
  if (missingSkills.length > 0) {
    const topMissing = missingSkills.slice(0, 5).map((s) => s.toUpperCase()).join(", ");
    suggestions.push(
      `The resume does not explicitly evidence these job requirements: ${topMissing}. Add them only if you genuinely have the skill and can support it with experience; otherwise learn and demonstrate them before claiming them.`
    );
  }
  if (impact.sampleMetricsFound.length < 2) {
    suggestions.push(
      "Strengthen impact quantification. Add measurable metrics (e.g. latency reductions, scale, throughput, or dollar values) to your work history bullets."
    );
  }
  if (!structure.details.hasEducation) {
    suggestions.push(
      "Ensure your Education section uses standard nomenclature ('Education', 'Degree') so automated parsers catalog your credentials."
    );
  }
  if (skillScore < 50 && hasJobDescription) {
    suggestions.push(
      "Tailor your summary and experience statements to echo the exact terminology and architectural patterns highlighted in the job specification."
    );
  }
  if (suggestions.length === 0) {
    suggestions.push("Maintain current technical alignment; refine project summaries to emphasize leadership in recent deliverables.");
  }

  // 9. Prioritized Actionable Steps
  const recommendedActions = [
    {
      priority: "High",
      action: missingSkills.length > 0
        ? `Verify the unmentioned requirements "${missingSkills.slice(0, 3).join(", ")}". Add evidence only for skills you genuinely possess; learn and demonstrate any skills you do not.`
        : hasJobDescription
          ? "Verify that the job's key requirements appear in the top half of your first page, supported by truthful examples."
          : "Choose a target role and tailor the top third of your resume to your most relevant, verifiable experience.",
      reason: missingSkills.length > 0
        ? "The resume does not mention these job requirements, so verify your experience before adding any claim."
        : "Recruiters and ATS parsers should see the strongest role-relevant evidence early.",
    },
    {
      priority: "Medium",
      action: "Revise bullet points to follow the Google X-Y-Z formula: 'Accomplished [X], as measured by [Y], by doing [Z]'.",
      reason: "Specific, verified outcomes make the scope and impact of your experience easier to evaluate.",
    },
    {
      priority: "Standard",
      action: "Review PDF export to confirm font glyphs and column layouts render cleanly in plain-text parser extractors.",
      reason: "Readable text and a simple layout help ATS tools extract your resume content accurately.",
    },
  ];

  // Build the scoring criteria explanation
  const scoringCriteria = hasJobDescription
    ? "Score = required skills evidenced in the resume (40%) + relevant experience (30%; detected years when stated, otherwise role-relevant experience-section evidence) + supporting evidence (20%; quantified impact and role-relevant experience, projects, or certifications) + ATS structure (10%). An absent resume mention is treated as unverified, not proof that you lack the skill."
    : "Score = ATS structure (40%) + impact language and quantified evidence (35%) + detected skill breadth (25%). No job-specific matching was performed.";

  // Base deterministic analysis payload
  let analysisResult = {
    analysisEngine: "IntelliHire Deterministic ATS Engine v3.0",
    aiEnhanced: false,
    isJobSpecific: hasJobDescription,
    atsMatchScore: finalScore,
    scoreExplanation,
    scoringCriteria,
    scoreBreakdown: hasJobDescription
      ? {
          skillAlignment: `${Math.round(skillScore * 0.4)} / 40`,
          relevantExperience: `${Math.round(experienceScore * 0.3)} / 30`,
          supportingEvidence: `${Math.round(evidenceScore * 0.2)} / 20`,
          atsStructure: `${Math.round(structure.score * 0.1)} / 10`,
        }
      : {
          structureQuality: `${Math.round(structure.score * 0.4)} / 40`,
          impactLanguage: `${Math.round(impact.score * 0.35)} / 35`,
          skillBreadth: `${Math.round(Math.min(100, resumeSkills.length * 8) * 0.25)} / 25`,
        },
    matchedSkills: matchedSkills.map((s) => s.toUpperCase()),
    missingSkills: missingSkills.map((s) => s.toUpperCase()),
    additionalSkills: additionalSkills.map((s) => s.toUpperCase()),
    partiallyMatchedSkills,
    requiredSkillsByImportance: jobSkills.slice(0, 12).map((skill) => {
      const skillIndex = jobDescription.toLowerCase().indexOf(skill);
      const context =
        skillIndex >= 0
          ? jobDescription
              .slice(Math.max(0, skillIndex - 70), skillIndex + skill.length + 70)
              .toLowerCase()
          : "";
      const importance = /required|must-have|must have|essential|minimum|proficient/i.test(
        context
      )
        ? "Critical"
        : skillIndex >= 0 && skillIndex < jobDescription.length / 3
          ? "High"
          : "Medium";
      return {
        skill: skill.toUpperCase(),
        importance,
        matched: resumeSkills.includes(skill),
      };
    }),
    atsKeywords: missingSkills.slice(0, 8).map((skill) => {
      const skillIndex = jobDescription.toLowerCase().indexOf(skill);
      const requirementContext =
        skillIndex >= 0
          ? jobDescription
              .slice(Math.max(0, skillIndex - 60), skillIndex + skill.length + 100)
              .replace(/\s+/g, " ")
              .trim()
          : "";
      return {
        keyword: skill.toUpperCase(),
        reason: `The job description ties ${skill.toUpperCase()} to this requirement: "${requirementContext}". Use the keyword only where your resume can provide truthful evidence.`,
      };
    }),
    missingSkillsDetailed: missingSkills.slice(0, 8).map((skill) => ({
      skill: skill.toUpperCase(),
      importance: /required|must|essential/i.test(jobDescription) ? "High" : "Medium",
      genuinelyMissing: false,
      reason: "This requirement was not explicitly found in the resume; the document alone cannot confirm whether you possess it.",
      recommendation:
        "If you have this skill, add a truthful example. If not, learn and demonstrate it before listing it as a competency.",
    })),
    bulletImprovements: [
      ...evidence.relevantExperience,
      ...evidence.projects,
    ]
      .filter((line) => line.length >= 30)
      .slice(0, 2)
      .map((line) => ({
        original: line,
        improved: `${line.replace(/[.!?]+$/, "")} [add a verified outcome or metric if available]`,
        note: "Template only: replace the bracketed text only with a result you can verify. No new achievement is asserted.",
      })),
    actionPlan: recommendedActions.map((item, index) => ({
      priority: index + 1,
      action: item.action,
      impact: index === 0 ? "High" : "Medium",
      reason: item.reason,
    })),
    keywordAnalysis: {
      totalJobRequirementsFound: jobSkills.length,
      matchedCount: matchedSkills.length,
      missingCount: missingSkills.length,
      coveragePercentage: Math.round(skillRatio * 100),
    },
    experienceAndEducation: expAndEdu,
    roleEvidence: {
      relevantExperience: evidence.relevantExperience,
      projects: evidence.projects,
      certifications: evidence.certifications,
      qualifications: evidence.qualifications,
    },
    impactAnalysis: {
      actionVerbsCount: impact.actionVerbsFound.length,
      metricsCount: impact.sampleMetricsFound.length,
      sampleMetrics: impact.sampleMetricsFound,
    },
    strengths,
    suggestions,
    recommendedActions,
  };

  // Groq AI Enhancement — deep job-specific analysis
  if (hasJobDescription && process.env.GROQ_API_KEY) {
    try {
      const groqInsights = await getGroqResumeInsights(
        resumeText,
        jobDescription,
        targetJobTitle,
        analysisResult
      );

      if (groqInsights) {
        analysisResult.aiEnhanced = true;
        analysisResult.analysisEngine = "IntelliHire Hybrid ATS Engine (Rule Engine + Groq AI)";

        if (groqInsights.partiallyMatchedSkills.length > 0) {
          const validatedPartials = groqInsights.partiallyMatchedSkills
            .filter(
              (item) =>
                typeof item?.skill === "string" &&
                missingSkills.some(
                  (skill) =>
                    skill.toLowerCase() === item.skill.trim().toLowerCase()
                ) &&
                typeof item.reason === "string" &&
                resumeSkills.some((skill) =>
                  item.reason.toLowerCase().includes(skill.toLowerCase())
                )
            )
            .map((item) => ({
              skill: item.skill.toUpperCase(),
              reason: item.reason,
            }));
          if (validatedPartials.length > 0) {
            analysisResult.partiallyMatchedSkills = validatedPartials;
          }
        }
        if (groqInsights.missingSkillsDetailed.length > 0) {
          const validatedMissing = groqInsights.missingSkillsDetailed
            .filter(
              (item) =>
                typeof item?.skill === "string" &&
                missingSkills.some(
                  (skill) =>
                    skill.toLowerCase() === item.skill.trim().toLowerCase()
                )
            )
            .map((item) => ({
              skill: item.skill.toUpperCase(),
              importance: ["Critical", "High", "Medium", "Low"].includes(
                item.importance
              )
                ? item.importance
                : "Medium",
              genuinelyMissing: false,
              reason:
                "This requirement was not explicitly found in the resume; the document alone cannot confirm whether you possess it.",
              recommendation:
                "If you have this skill, add a truthful example. If not, learn and demonstrate it before listing it as a competency.",
            }));
          if (validatedMissing.length > 0) {
            analysisResult.missingSkillsDetailed = validatedMissing;
          }
        }
        if (groqInsights.requiredSkillsByImportance.length > 0) {
          const aiPriorities = new Map(
            groqInsights.requiredSkillsByImportance
              .filter((item) => typeof item?.skill === "string")
              .map((item) => [item.skill.trim().toLowerCase(), item.importance])
          );
          analysisResult.requiredSkillsByImportance =
            analysisResult.requiredSkillsByImportance.map((item) => ({
              ...item,
              importance: ["Critical", "High", "Medium", "Low"].includes(
                aiPriorities.get(item.skill.toLowerCase())
              )
                ? aiPriorities.get(item.skill.toLowerCase())
                : item.importance,
            }));
        }
        if (groqInsights.atsKeywords.length > 0) {
          const validatedKeywords = groqInsights.atsKeywords.filter(
            (item) =>
              typeof item?.keyword === "string" &&
              jobDescription
                .toLowerCase()
                .includes(item.keyword.trim().toLowerCase()) &&
              typeof item.reason === "string"
          );
          if (validatedKeywords.length > 0) {
            analysisResult.atsKeywords = validatedKeywords;
          }
        }
        if (groqInsights.bulletImprovements.length > 0) {
          analysisResult.bulletImprovements = groqInsights.bulletImprovements;
        }
        if (groqInsights.actionPlan.length > 0) {
          const safeActionPlan = groqInsights.actionPlan.filter((item) => {
            if (typeof item?.action !== "string") return false;
            const proposesClaim =
              /\b(add|include|list|claim)\b/i.test(item.action) &&
              missingSkills.some((skill) =>
                item.action.toLowerCase().includes(skill.toLowerCase())
              );
            return (
              !proposesClaim ||
              /\b(only if|if you (?:have|possess)|verify|confirm)\b/i.test(
                item.action
              )
            );
          });
          if (safeActionPlan.length > 0) {
            analysisResult.actionPlan = safeActionPlan;
          }
        }
      }
    } catch (groqErr) {
      console.warn("Groq AI enhancement failed; returning rule-based analysis:", groqErr.message);
    }
  }

  const detailedSkillsByName = new Map(
    analysisResult.missingSkillsDetailed.map((item) => [
      item.skill.toUpperCase(),
      item,
    ])
  );
  analysisResult.missingSkillsDetailed = missingSkills.map((skill) => {
    const label = skill.toUpperCase();
    return (
      detailedSkillsByName.get(label) || {
        skill: label,
        importance:
          analysisResult.requiredSkillsByImportance.find(
            (item) => item.skill === label
          )?.importance || "Medium",
        genuinelyMissing: false,
        reason:
          "This requirement was not explicitly found in the resume; the document alone cannot confirm whether you possess it.",
        recommendation:
          "If you have this skill, add a truthful example. If not, learn and demonstrate it before listing it as a competency.",
      }
    );
  });

  return analysisResult;
}

module.exports = {
  extractTextFromPdf,
  analyzeResume,
};
