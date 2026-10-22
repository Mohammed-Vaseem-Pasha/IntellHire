/**
 * IntelliHire AI — Deep Resume Document Parser
 * Supports PDF (pdf-parse) and Word DOCX (mammoth).
 * Extracts structured profile: candidate name, skills, projects, experience, education, certifications.
 */

const { GoogleGenAI } = (() => {
  try {
    return require("@google/genai");
  } catch {
    return {};
  }
})();

// Curated Technical & Domain Taxonomy
const EXTENDED_SKILL_TAXONOMY = [
  // Programming Languages
  "javascript", "typescript", "python", "golang", "go", "java", "c#", "c++", "c",
  "rust", "ruby", "php", "swift", "kotlin", "sql", "r", "scala", "dart",
  "html", "html5", "css", "css3", "bash", "shell",

  // Frontend & UI
  "react", "react.js", "next.js", "vue", "vue.js", "angular", "svelte", "redux",
  "tailwind", "tailwindcss", "sass", "scss", "webpack", "vite", "turbopack",
  "graphql", "rest", "restful api", "websockets", "webrtc", "responsive design",
  "accessibility", "a11y", "shadcn", "material ui", "zustand", "mobx",

  // Backend & Architecture
  "node.js", "express", "express.js", "nestjs", "fastapi", "django", "flask",
  "spring", "spring boot", ".net", "asp.net", "ruby on rails", "microservices",
  "monolith", "grpc", "message queues", "kafka", "rabbitmq", "celery", "sqs",
  "event-driven architecture", "api design", "distributed systems",

  // Databases & Caching
  "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch",
  "dynamodb", "cassandra", "sqlite", "prisma", "mongoose", "typeorm", "drizzle",
  "nosql", "relational database", "indexing", "query optimization", "vector database",
  "pinecone", "chroma", "qdrant", "milvus",

  // Cloud & DevOps
  "aws", "amazon web services", "azure", "google cloud", "gcp", "docker",
  "kubernetes", "k8s", "terraform", "ci/cd", "continuous integration",
  "github actions", "gitlab ci", "jenkins", "ansible", "helm", "linux", "nginx",
  "prometheus", "grafana", "serverless", "lambda", "ecs", "s3", "cloud architecture",

  // AI / ML / Data
  "machine learning", "deep learning", "nlp", "computer vision", "llm", "large language models",
  "rag", "langchain", "llamaindex", "prompt engineering", "pytorch", "tensorflow",
  "scikit-learn", "pandas", "numpy", "opencv", "vision transformer", "transformers",
  "huggingface", "bert", "gpt", "data engineering", "spark", "hadoop",

  // Testing & Quality
  "jest", "mocha", "chai", "cypress", "playwright", "unit testing", "integration testing",
  "e2e testing", "tdd", "test driven development",

  // Engineering Practices & Security
  "system design", "scalability", "high availability", "concurrency", "multithreading",
  "oauth", "oauth2", "jwt", "owasp", "security", "git", "github", "agile", "scrum"
];

/**
 * Extracts raw text from uploaded Buffer (.pdf or .docx)
 */
async function extractRawTextFromBuffer(buffer, originalName = "", mimeType = "") {
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty file buffer received.");
  }

  const isDocx =
    originalName.toLowerCase().endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  let rawText = "";

  if (isDocx) {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      rawText = result && result.value ? result.value : "";
    } catch (docxErr) {
      console.error("DOCX parsing error:", docxErr);
      throw new Error(`Failed to extract text from DOCX: ${docxErr.message}`);
    }
  } else {
    // PDF extraction
    try {
      const pdfModule = require("pdf-parse");
      if (pdfModule.PDFParse) {
        const parser = new pdfModule.PDFParse({ data: buffer });
        const result = await parser.getText();
        rawText = result && result.text ? result.text : "";
      } else if (typeof pdfModule === "function") {
        const result = await pdfModule(buffer);
        rawText = result && result.text ? result.text : "";
      } else {
        throw new Error("PDF parser module initialization failed on server.");
      }
    } catch (pdfErr) {
      console.error("PDF parsing error:", pdfErr);
      throw new Error(`Failed to extract text from PDF: ${pdfErr.message}`);
    }
  }

  const cleaned = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();

  // Validate minimum text requirement to detect scanned images without OCR
  if (cleaned.length < 50) {
    throw new Error(
      "The uploaded document does not contain readable extractable text. Please ensure your resume is not a scanned raster image and was exported as a selectable text document (PDF or DOCX)."
    );
  }

  return cleaned;
}

/**
 * Extracts candidate contact information & web presence
 */
function extractContactInfo(text) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const githubMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);

  return {
    email: emailMatch ? emailMatch[0] : "",
    phone: phoneMatch ? phoneMatch[0] : "",
    linkedin: linkedinMatch ? linkedinMatch[0] : "",
    github: githubMatch ? githubMatch[0] : "",
  };
}

/**
 * Attempts heuristic extraction of the candidate's name from header lines
 */
function extractCandidateName(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const ignoredKeywords = [
    "resume", "curriculum", "vitae", "cv", "page", "contact", "email",
    "phone", "github", "linkedin", "profile", "summary", "experience", "skills",
    "education", "portfolio", "projects", "senior", "developer", "engineer"
  ];

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const line = lines[i];
    // A realistic name has 2 to 4 words, between 3 and 35 chars, only letters/spaces/periods
    if (
      line.length >= 3 &&
      line.length <= 35 &&
      /^[a-zA-Z]+(?:\s+[a-zA-Z]+){1,3}$/.test(line) &&
      !ignoredKeywords.some((kw) => line.toLowerCase().includes(kw))
    ) {
      return line;
    }
  }

  return "Candidate";
}

/**
 * Extracts skills matching the taxonomy
 */
function extractCandidateSkills(text) {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ")} `;
  const matched = new Set();

  for (const skill of EXTENDED_SKILL_TAXONOMY) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?:$|[^a-z0-9+#.])`, "i");
    if (regex.test(normalized)) {
      // Clean display name
      matched.add(skill.length <= 4 ? skill.toUpperCase() : skill.charAt(0).toUpperCase() + skill.slice(1));
    }
  }

  return Array.from(matched);
}

/**
 * Parses projects from resume text
 */
function extractProjects(text) {
  const projects = [];
  const lines = text.split("\n").map((l) => l.trim());

  let inProjectSection = false;
  let currentProject = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Check for Project section header
    if (
      /^(?:projects|key projects|academic projects|technical projects|selected projects|portfolio projects)\b/i.test(line) &&
      line.length < 35
    ) {
      inProjectSection = true;
      continue;
    }

    // Stop if we hit another major section
    if (
      inProjectSection &&
      /^(?:experience|work experience|employment|education|skills|certifications|achievements|honors)\b/i.test(line) &&
      line.length < 35
    ) {
      if (currentProject) projects.push(currentProject);
      break;
    }

    if (inProjectSection && line.length > 0) {
      // A project heading often has a pipe, dash, colon, tech tags, or is bold/short
      const isHeader =
        (line.includes("|") || line.includes("–") || line.includes("—") || line.includes(":") || (line.length < 60 && !line.startsWith("•") && !line.startsWith("-"))) &&
        !line.startsWith("http");

      if (isHeader) {
        if (currentProject) {
          projects.push(currentProject);
        }
        const parts = line.split(/[|–—:]/);
        const title = parts[0].trim();
        const techStr = parts.length > 1 ? parts.slice(1).join(" ") : "";
        const detectedTech = extractCandidateSkills(techStr);

        currentProject = {
          title: title || line,
          description: "",
          technologies: detectedTech,
        };
      } else if (currentProject) {
        currentProject.description = (currentProject.description + " " + line).trim();
        const moreTech = extractCandidateSkills(line);
        currentProject.technologies = Array.from(new Set([...currentProject.technologies, ...moreTech]));
      }
    }
  }

  if (currentProject && !projects.includes(currentProject)) {
    projects.push(currentProject);
  }

  // Fallback: If no dedicated project section, detect projects by keyword patterns like "developed ... using ..."
  if (projects.length === 0) {
    const pattern = /(?:built|developed|architected|created|engineered)\s+([^.]+?(?:using|with|via)\s+[^.]+?\.)/gi;
    let match;
    let count = 0;
    while ((match = pattern.exec(text)) !== null && count < 3) {
      const desc = match[0].trim();
      projects.push({
        title: `Technical Initiative ${count + 1}`,
        description: desc,
        technologies: extractCandidateSkills(desc),
      });
      count++;
    }
  }

  return projects.slice(0, 5);
}

/**
 * Extracts work experience entries
 */
function extractExperience(text) {
  const experiences = [];
  const lines = text.split("\n").map((l) => l.trim());

  let inExp = false;
  let currentExp = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(?:experience|work experience|professional experience|employment history)\b/i.test(line) && line.length < 35) {
      inExp = true;
      continue;
    }

    if (inExp && /^(?:education|projects|skills|certifications|publications)\b/i.test(line) && line.length < 35) {
      if (currentExp) experiences.push(currentExp);
      break;
    }

    if (inExp && line.length > 0) {
      const yearMatch = line.match(/\b(20\d{2}|19\d{2})\b/);
      const isRoleLine = (line.includes("|") || line.includes("–") || line.includes("—") || yearMatch) && line.length < 80;

      if (isRoleLine) {
        if (currentExp) experiences.push(currentExp);
        currentExp = {
          role: line,
          company: "",
          duration: yearMatch ? yearMatch[0] : "",
          summary: "",
        };
      } else if (currentExp) {
        currentExp.summary = (currentExp.summary + " " + line).trim();
      }
    }
  }

  if (currentExp && !experiences.includes(currentExp)) {
    experiences.push(currentExp);
  }

  return experiences.slice(0, 4);
}

/**
 * Extracts education details
 */
function extractEducation(text) {
  const education = [];
  const lines = text.split("\n").map((l) => l.trim());

  let inEdu = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(?:education|academic background|academics|qualifications)\b/i.test(line) && line.length < 35) {
      inEdu = true;
      continue;
    }

    if (inEdu && /^(?:experience|projects|skills|certifications|awards)\b/i.test(line) && line.length < 35) {
      break;
    }

    if (inEdu && line.length > 0) {
      if (/bachelor|master|b\.s|b\.tech|b\.e|m\.s|msc|phd|diploma|degree/i.test(line)) {
        const year = line.match(/\b(20\d{2}|19\d{2})\b/);
        education.push({
          degree: line,
          institution: lines[i + 1] && lines[i + 1].length < 70 ? lines[i + 1] : "",
          year: year ? year[0] : "",
        });
      }
    }
  }

  return education.slice(0, 3);
}

/**
 * Parses comprehensive structured profile from resume text
 */
async function parseResumeProfile(rawText) {
  const candidateName = extractCandidateName(rawText);
  const contact = extractContactInfo(rawText);
  const skills = extractCandidateSkills(rawText);
  const projects = extractProjects(rawText);
  const experience = extractExperience(rawText);
  const education = extractEducation(rawText);

  // Derive a 2-3 sentence executive summary
  let summary = `Candidate with competency in ${skills.slice(0, 6).join(", ")}.`;
  if (experience.length > 0) {
    summary += ` Experience highlights include ${experience[0].role}.`;
  }
  if (projects.length > 0) {
    summary += ` Key project portfolio includes ${projects[0].title}.`;
  }

  const profile = {
    candidateName,
    email: contact.email,
    phone: contact.phone,
    linkedin: contact.linkedin,
    github: contact.github,
    summary,
    skills,
    projects,
    experience,
    education,
    characterCount: rawText.length,
    rawTextPreview: rawText.slice(0, 500),
  };

  // Optional: Enhance with Gemini AI if key is available
  if (process.env.GEMINI_API_KEY && GoogleGenAI) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are an expert technical recruiter. Extract structured profile data from this resume text.
Do not invent anything. Only extract real information.

RESUME TEXT:
${rawText.slice(0, 3500)}

Return ONLY valid JSON with this exact schema:
{
  "candidateName": "Full Name",
  "summary": "2 sentence summary",
  "skills": ["Skill1", "Skill2"],
  "projects": [
    { "title": "Project Title", "description": "1 sentence description", "technologies": ["Tech1", "Tech2"] }
  ],
  "experience": [
    { "role": "Role Title", "company": "Company Name", "duration": "Dates", "summary": "Key achievement" }
  ],
  "education": [
    { "degree": "Degree", "institution": "Institution", "year": "Year" }
  ]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
      });

      if (response && response.text) {
        const cleaned = response.text.replace(/```json/gi, "").replace(/```/gi, "").trim();
        const parsed = JSON.parse(cleaned);

        if (parsed.candidateName && parsed.candidateName !== "Candidate") {
          profile.candidateName = parsed.candidateName;
        }
        if (parsed.summary) profile.summary = parsed.summary;
        if (Array.isArray(parsed.skills) && parsed.skills.length > 0) {
          profile.skills = Array.from(new Set([...profile.skills, ...parsed.skills]));
        }
        if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          profile.projects = parsed.projects;
        }
        if (Array.isArray(parsed.experience) && parsed.experience.length > 0) {
          profile.experience = parsed.experience;
        }
        if (Array.isArray(parsed.education) && parsed.education.length > 0) {
          profile.education = parsed.education;
        }
      }
    } catch (err) {
      console.warn("AI resume profile enhancement skipped; falling back to deterministic extraction:", err.message);
    }
  }

  return profile;
}

module.exports = {
  extractRawTextFromBuffer,
  parseResumeProfile,
  extractCandidateSkills,
};
