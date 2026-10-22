const ROLE_TOPIC_GUIDANCE = [
    {
        match: /frontend|front-end|ui developer/i,
        topics: "JavaScript behavior, React components/state, rendering, UI accessibility, and browser performance",
    },
    {
        match: /backend|back-end/i,
        topics: "API design, data modeling, database trade-offs, authentication, and server-side testing",
    },
    {
        match: /full[\s-]?stack/i,
        topics: "frontend-backend integration, API contracts, data persistence, and end-to-end application design",
    },
    {
        match: /data scientist/i,
        topics: "data cleaning, feature selection, experiment design, statistical reasoning, and communicating findings",
    },
    {
        match: /ai|machine learning|ml engineer/i,
        topics: "model choice, data preprocessing, evaluation metrics, overfitting, and deployment constraints",
    },
    {
        match: /python developer|python engineer/i,
        topics: "Python fundamentals, data structures, exception handling, libraries, testing, and practical coding",
    },
    {
        match: /data analyst/i,
        topics: "SQL queries, data cleaning, statistical analysis, visualization, and interpreting metrics",
    },
    {
        match: /software engineer|developer|engineer/i,
        topics: "programming fundamentals, software design, APIs, testing, debugging, and maintainability",
    },
];

const RESUME_TOPICS = [
    ["projects", /project|portfolio|what (?:did|have) you (?:build|develop)/i],
    ["experience", /experience|previous role|employment|responsibilit|company|work history/i],
    ["internships", /internship|intern\b/i],
    ["education", /education|coursework|degree|university|college|academic/i],
    ["skills", /skills?|technolog|programming language|technical background/i],
    ["achievements", /achievement|certification|award|accomplishment/i],
];

// The 12 required interview coverage topics
const INTERVIEW_TOPICS = [
    {
        id: "candidate_type",
        name: "Candidate Type",
        description: "Candidate classification: Fresher or Experienced professional",
    },
    {
        id: "introduction",
        name: "Introduction",
        description: "Candidate background and opening walkthrough",
    },
    {
        id: "resume_projects",
        name: "Resume, Education, Skills, and Projects",
        description: "Projects, technical skills, coursework, or employment from the resume",
    },
    {
        id: "technical_role",
        name: "Role Technical Depth",
        description: "Technical questions relevant to selected role and actual candidate skills",
    },
    {
        id: "suitability",
        name: "Suitability for the Job",
        description: "How candidate's background, skills, and approach fit this role",
    },
    {
        id: "company_motivation",
        name: "Motivation for Joining the Company",
        description: "Interest in company mission/products based on available company info",
    },
    {
        id: "strengths_weaknesses",
        name: "Strengths and Weaknesses",
        description: "Core strengths and growth areas / areas being actively improved",
    },
    {
        id: "behavioral_challenge",
        name: "Handling Difficult People & Situations",
        description: "Handling difficult coworkers/clients, team conflict, or challenging project pressure",
    },
    {
        id: "leaving_reason",
        name: "Reason for Leaving Current Job",
        description: "Career transition motivation (strictly for experienced candidates)",
    },
    {
        id: "salary_expectations",
        name: "Salary Expectations",
        description: "Compensation and salary expectations when appropriate",
    },
    {
        id: "why_hire_you",
        name: "Why Should We Hire You?",
        description: "Candidate's unique differentiators and value proposition",
    },
    {
        id: "career_goals",
        name: "Career Goals & Future Vision",
        description: "Career goals, growth trajectory, or five-year vision",
    },
];

function classifyInterviewTopic(text = "") {
    const question = String(text || "").toLowerCase();
    if (!question) return "other";

    if (/tell me about yourself|introduce yourself|walk me through your background|give me an overview of your/i.test(question)) {
        return "introduction";
    }
    if (/why should we hire|why should we choose you|what makes you stand out|what unique value|why are you the best candidate/i.test(question)) {
        return "why_hire_you";
    }
    if (/leave (?:your|the) current|leaving (?:your|the) current|why are you looking to (?:leave|move|change)|why did you leave|reason for (?:leaving|seeking a new)/i.test(question)) {
        return "leaving_reason";
    }
    if (/salary expectation|compensation expectation|expected salary|target compensation|pay expectation/i.test(question)) {
        return "salary_expectations";
    }
    if (/why (?:our|this) company|why do you want to join (?:our|us|this organization)|what attracted you to (?:our|this) company|what do you know about (?:us|our company|our mission)/i.test(question)) {
        return "company_motivation";
    }
    if (/five years|5 years|where do you see yourself|long.?term career|career goal|future goal|career aspiration|next few years/i.test(question)) {
        return "career_goals";
    }
    if (/greatest strength|biggest strength|key strength|weakness|area (?:for|of) (?:growth|improvement)|what would your (?:manager|colleagues|team) say you could improve/i.test(question)) {
        return "strengths_weaknesses";
    }
    if (/difficult (?:person|coworker|team|colleague|client)|conflict|disagreement|challenging situation|high pressure|tight deadline|under pressure|overcoming an obstacle/i.test(question)) {
        return "behavioral_challenge";
    }
    if (/why are you (?:interested in this role|interested in this position|a good fit|well suited|the right candidate)|what makes you (?:a good fit|suitable|qualified)|how does your background (?:align|prepare)|fit for this role|suitable for this role|what attracted you|what motivates you/i.test(question)) {
        return "suitability";
    }
    for (const [topic, pattern] of RESUME_TOPICS) {
        if (pattern.test(question)) return `resume:${topic}`;
    }
    if (/how did you|what was the biggest challenge|how would you|design|implement|test|debug|api|database|react|javascript|model|transformer|metric|authentication|architecture|state management|model selection|performance|accessibility|rendering|reliability|coverage|data leakage|missing values|inference|model drift|uncertainty|python|exception|query|sql/i.test(question)) {
        return "technical_role";
    }
    if (/background|resume|work history/i.test(question)) return "resume:background";
    return "other";
}

function classifyInterviewQuestion(text = "") {
    const question = String(text || "").toLowerCase();
    if (/five years|5 years|where do you see yourself|long.?term career|career goal|future goal|career aspiration|next few years|grow into|growth goal|long-term/i.test(question)) {
        return "future";
    }
    if (/why should we hire|why should we choose|what makes you (?:a good fit|well[- ]?suited|suitable|qualified|the right candidate)|what skills or experience make you|what makes you stand out|what unique (?:strengths?|value|perspective|differentiator)|why are you (?:a good fit|well[- ]?suited|the right candidate)|fit for this (?:role|position|job)|suitable for this (?:role|position|job)/i.test(question)) {
        return "suitability";
    }
    if (/why are you interested|why this role|why this company|what attracted you|what interests you|what motivates you|leave your current|leaving your current|salary expectation/.test(question)) {
        return "motivation";
    }
    if (/tell me about yourself|introduce yourself|walk me through your background/.test(question)) {
        return "introduction";
    }
    if (/strength|weakness|difficult (?:person|coworker|team|colleague|client)|teamwork|collaborat|conflict|mistake|failure|deadline|pressure|unfamiliar skill|disagreement/.test(question)) {
        return "behavioral";
    }
    for (const [topic, pattern] of RESUME_TOPICS) {
        if (pattern.test(question)) return `resume:${topic}`;
    }
    if (/how did you|what was the biggest challenge|how would you|design|implement|test|debug|api|database|react|javascript|model|transformer|metric|authentication|architecture|state management|model selection|performance|accessibility|rendering|reliability|coverage|data leakage|missing values|inference|model drift|uncertainty|python|exception|query|sql/.test(question)) {
        return "role";
    }
    if (/background|resume|work history/.test(question)) return "resume:background";
    return "other";
}

function isConclusionPrompt(text = "") {
    return /\b(?:would you like to (?:conclude|end|finish)|are you ready to (?:conclude|finish)|shall we (?:end|wrap up)|is there anything else you would like to ask)\b/i.test(
        String(text || "")
    );
}

function isSubstantiveQuestion(text = "") {
    return /\?/.test(String(text || "")) ||
        classifyInterviewQuestion(text) !== "other";
}

function getSubstantiveQuestionCount(previousConversation = []) {
    return previousConversation.filter(
        (item) =>
            item.speaker === "interviewer" &&
            item.interactionType !== "response" &&
            isSubstantiveQuestion(item.text) &&
            !isConclusionPrompt(item.text)
    ).length;
}

function getResumeTopics(resumeProfile = {}) {
    const profile = resumeProfile || {};
    const topics = RESUME_TOPICS
        .filter(([topic]) => {
            if (topic === "projects") return profile.projects?.length > 0;
            if (topic === "experience") return profile.experience?.length > 0;
            if (topic === "internships") return profile.internships?.length > 0;
            if (topic === "education") return profile.education?.length > 0;
            if (topic === "skills") {
                return (profile.technicalSkills?.length || profile.skills?.length || 0) > 0;
            }
            return (profile.achievements?.length || profile.certifications?.length || 0) > 0;
        })
        .map(([topic]) => topic);
    return topics.length > 0 ? topics : ["background"];
}

function getCandidateDisclosedTopics(previousConversation, resumeProfile) {
    const candidateText = previousConversation
        .filter((item) => item.speaker === "candidate")
        .map((item) => String(item.text || ""))
        .join("\n")
        .toLowerCase();
    const profile = resumeProfile || {};
    const hasProfileTerm = (values) =>
        values.some((value) =>
            typeof value === "string" &&
            value.trim().length >= 3 &&
            candidateText.includes(value.trim().toLowerCase())
        );
    const covered = new Set();

    if (
        /\b(project|built|developed|created|implemented)\b/.test(candidateText) ||
        hasProfileTerm((profile.projects || []).flatMap((project) => [
            project?.title,
            ...(project?.technologies || []),
        ]))
    ) covered.add("projects");
    if (
        /\b(worked at|work experience|previous role|responsibilities|employment)\b/.test(candidateText) ||
        hasProfileTerm((profile.experience || []).flatMap((item) => [item?.role, item?.company]))
    ) covered.add("experience");
    if (
        /\bintern(ship)?\b/.test(candidateText) ||
        hasProfileTerm((profile.internships || []).flatMap((item) => [item?.role, item?.company]))
    ) covered.add("internships");
    if (
        /\b(university|college|degree|graduat\w*|coursework|studied|academic)\b/.test(candidateText) ||
        hasProfileTerm((profile.education || []).flatMap((item) => [item?.degree, item?.institution]))
    ) covered.add("education");
    if (
        /\b(skills?|technologies|programming|programming language)\b/.test(candidateText) ||
        hasProfileTerm([
            ...(profile.technicalSkills || []),
            ...(profile.skills || []),
            ...(profile.softSkills || []),
        ])
    ) covered.add("skills");
    if (
        /\b(certification|certified|achievement|award|accomplishment)\b/.test(candidateText) ||
        hasProfileTerm([...(profile.certifications || []), ...(profile.achievements || [])])
    ) covered.add("achievements");

    return covered;
}

function getCandidateDisclosedStages(previousConversation) {
    const candidateText = previousConversation
        .filter((item) => item.speaker === "candidate")
        .map((item) => String(item.text || ""))
        .join("\n")
        .toLowerCase();
    const stages = new Set();
    if (
        /\b(interested in this role|interested in the role|motivated by this role|career goal|career objective|why i want this role|passionate about)\b/.test(candidateText)
    ) stages.add("motivation");
    if (
        /\b(you should hire me|hire me because|right candidate|good fit for this role|best candidate|i am a strong fit)\b/.test(candidateText)
    ) stages.add("suitability");
    if (
        /\b(in five years|in 5 years|five.year plan|long.term goal|see myself|i hope to become|i plan to become)\b/.test(candidateText)
    ) stages.add("future");
    return stages;
}

function getProjectTracking(resumeProfile = {}, previousConversation = []) {
    const projects = Array.isArray(resumeProfile?.projects) ? resumeProfile.projects : [];
    const discussedProjects = new Set();
    const conversationText = previousConversation
        .map((item) => String(item.text || "").toLowerCase())
        .join(" ");

    for (const project of projects) {
        if (!project?.title) continue;
        const fullTitle = project.title.toLowerCase().trim();
        const titleTokens = fullTitle.split(/\s+/).filter((w) => w.length >= 3);
        if (fullTitle && (conversationText.includes(fullTitle) || (titleTokens.length >= 2 && titleTokens.every((w) => conversationText.includes(w))))) {
            discussedProjects.add(project.title);
        }
    }
    const uncoveredProjects = projects.filter((p) => p?.title && !discussedProjects.has(p.title));
    return {
        allProjects: projects,
        discussedProjects: [...discussedProjects],
        uncoveredProjects,
    };
}

function hasCompanyDetails(jobDescription = "") {
    const text = String(jobDescription || "").trim();
    if (text.length < 40) return false;
    return /\b(?:at\s+[A-Z][a-zA-Z0-9]+|about (?:our company|us)|our team|our mission|join [A-Z][a-zA-Z0-9]+|we are (?:a|an)|who we are|company culture|our values)\b/i.test(text);
}

// Generate a deterministic integer seed from string content to ensure repeatable yet unique ordering
function hashStringToNumber(str = "") {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function buildInterviewCoverageChecklist({
    candidateType = "fresher",
    durationMinutes = 20,
    jobDescription = "",
    resumeProfile = {},
    previousConversation = [],
    skippedTopicIds = new Set(),
}) {
    const hasCompany = hasCompanyDetails(jobDescription);
    const coveredTopicIds = new Set();
    const candidateDisclosed = getCandidateDisclosedStages(previousConversation);
    const candidateDisclosedTopics = getCandidateDisclosedTopics(previousConversation, resumeProfile);

    // Map conversation questions to topics
    let lastInterviewerTopic = null;
    let substantiveCount = 0;

    for (const item of previousConversation) {
        if (
            item.speaker !== "interviewer" ||
            item.interactionType === "response" ||
            !isSubstantiveQuestion(item.text) ||
            isConclusionPrompt(item.text)
        ) continue;

        substantiveCount += 1;
        const topic = classifyInterviewTopic(item.text);
        if (topic.startsWith("resume:")) {
            coveredTopicIds.add("resume_projects");
        } else if (topic === "technical_role") {
            coveredTopicIds.add("technical_role");
        } else if (topic !== "other") {
            coveredTopicIds.add(topic);
        }
        lastInterviewerTopic = topic;
    }

    if (candidateDisclosed.has("motivation") || candidateDisclosed.has("suitability")) {
        coveredTopicIds.add("suitability");
    }
    if (candidateDisclosed.has("future")) {
        coveredTopicIds.add("career_goals");
    }
    if (candidateDisclosedTopics.size > 0 && substantiveCount >= 2) {
        coveredTopicIds.add("resume_projects");
    }

    const checklist = INTERVIEW_TOPICS.map((topic) => {
        let status = "uncovered";
        let isApplicable = true;

        if (topic.id === "candidate_type") {
            status = "covered";
        } else if (topic.id === "leaving_reason" && candidateType === "fresher") {
            status = "inapplicable";
            isApplicable = false;
        } else if (topic.id === "company_motivation" && !hasCompany) {
            status = "inapplicable";
            isApplicable = false;
        } else if (durationMinutes <= 5 && ["leaving_reason", "salary_expectations", "company_motivation", "strengths_weaknesses", "behavioral_challenge"].includes(topic.id)) {
            // For 5 minute lightning interviews, focus on essential introduction, project, technical, and fit
            status = "inapplicable";
            isApplicable = false;
        } else if (durationMinutes <= 10 && ["leaving_reason", "salary_expectations"].includes(topic.id)) {
            status = "inapplicable";
            isApplicable = false;
        } else if (skippedTopicIds.has(topic.id)) {
            status = "skipped";
        } else if (coveredTopicIds.has(topic.id)) {
            status = "covered";
        }

        return {
            id: topic.id,
            name: topic.name,
            description: topic.description,
            status,
            applicable: isApplicable,
        };
    });

    return {
        checklist,
        coveredTopicIds,
        lastInterviewerTopic,
        substantiveCount,
    };
}

function getInterviewProgress({
    resumeProfile = {},
    previousConversation = [],
    targetQuestionCount = 10,
    experienceLevel = "",
    durationMinutes = 20,
    jobRole = "",
    jobDescription = "",
    sessionId = "",
} = {}) {
    const plannedQuestionCount = Number.isInteger(targetQuestionCount) &&
        targetQuestionCount >= 2 &&
        targetQuestionCount <= 35
        ? targetQuestionCount
        : 10;

    const candidateType = experienceLevel === "Experienced professional"
        ? "experienced"
        : experienceLevel === "Fresher"
            ? "fresher"
            : (resumeProfile?.experience?.length || 0) > 0 ? "experienced" : "fresher";

    const asked = new Set();
    const resumeTopicsCovered = new Set();
    let roleQuestionCount = 0;
    let behavioralQuestionCount = 0;
    let lastInterviewerTopic = null;
    const skippedTopics = new Set();

    for (const item of previousConversation) {
        if (
            item.speaker !== "interviewer" ||
            item.interactionType === "response" ||
            !isSubstantiveQuestion(item.text) ||
            isConclusionPrompt(item.text)
        ) continue;
        const stage = classifyInterviewQuestion(item.text);
        const detailedTopic = classifyInterviewTopic(item.text);
        asked.add(stage);
        if (stage.startsWith("resume:")) resumeTopicsCovered.add(stage.slice(7));
        if (stage === "role") roleQuestionCount += 1;
        if (stage === "behavioral") behavioralQuestionCount += 1;
        lastInterviewerTopic = detailedTopic;
    }

    for (const topic of getCandidateDisclosedTopics(previousConversation, resumeProfile)) {
        resumeTopicsCovered.add(topic);
    }
    for (const stage of getCandidateDisclosedStages(previousConversation)) {
        asked.add(stage);
    }

    // Check for skipped topics from candidate answers
    for (let i = 0; i < previousConversation.length - 1; i += 1) {
        const item = previousConversation[i];
        const nextItem = previousConversation[i + 1];
        if (item.speaker === "interviewer" && nextItem.speaker === "candidate") {
            const ans = String(nextItem.text || "").toLowerCase();
            if (/^(?:skip|pass|move on|i don t know|no idea|i ll learn it|not sure)\b/.test(ans)) {
                const skippedTopic = classifyInterviewTopic(item.text);
                skippedTopics.add(skippedTopic);
            }
        }
    }

    const availableResumeTopics = getResumeTopics(resumeProfile);
    const resumeTargetCount = availableResumeTopics.length === 0
        ? 1
        : Math.min(plannedQuestionCount <= 5 ? 1 : 3, availableResumeTopics.length);
    const coveredResumeTopicCount = availableResumeTopics.filter(
        (topic) => resumeTopicsCovered.has(topic)
    ).length;

    const substantiveQuestionCount = getSubstantiveQuestionCount(previousConversation);
    const projectTracking = getProjectTracking(resumeProfile, previousConversation);

    const roleTarget = plannedQuestionCount <= 5 ? 1 : (plannedQuestionCount <= 10 ? 2 : 3);

    // Build the coverage checklist
    const { checklist, coveredTopicIds } = buildInterviewCoverageChecklist({
        candidateType,
        durationMinutes,
        jobDescription,
        resumeProfile,
        previousConversation,
        skippedTopicIds: skippedTopics,
    });

    // Determine the next stage dynamically
    let nextStage = "closing";

    if (substantiveQuestionCount >= plannedQuestionCount) {
        nextStage = "closing";
    } else if (!asked.has("introduction") && !coveredTopicIds.has("introduction")) {
        nextStage = "introduction";
    } else {
        // Prioritize uncovering applicable topics
        const uncoveredChecklistTopics = checklist.filter(
            (t) => t.applicable && t.status === "uncovered"
        );

        // Core resume exploration comes early if not done
        if (coveredResumeTopicCount < resumeTargetCount && uncoveredChecklistTopics.some((t) => t.id === "resume_projects")) {
            nextStage = "resume";
        } else if (roleQuestionCount < roleTarget && uncoveredChecklistTopics.some((t) => t.id === "technical_role")) {
            nextStage = "role";
        } else if (uncoveredChecklistTopics.length > 0) {
            // Adaptive topic selection from remaining uncovered topics
            // Rules:
            // 1. Never ask career_goals/five-years immediately after why_hire_you
            // 2. Do not force 5-year question
            // 3. Vary order based on candidate profile to ensure independent sequences
            const profileSeed = hashStringToNumber(
                `${sessionId || ""}:${resumeProfile.candidateName || ""}:${(resumeProfile.technicalSkills || []).join(",")}:${jobRole}`
            );

            // Filter out candidates that violate rules
            let eligible = uncoveredChecklistTopics.filter((topic) => {
                if (lastInterviewerTopic === "why_hire_you" && topic.id === "career_goals") {
                    return false;
                }
                return true;
            });

            if (eligible.length === 0) {
                eligible = uncoveredChecklistTopics;
            }

            // Pick topic dynamically using profile seed + substantive question count for variation
            const chosenIndex = (profileSeed + substantiveQuestionCount) % eligible.length;
            const chosenTopic = eligible[chosenIndex];

            // Map chosen topic to stage
            if (chosenTopic.id === "resume_projects") {
                nextStage = "resume";
            } else if (chosenTopic.id === "technical_role") {
                nextStage = "role";
            } else if (chosenTopic.id === "strengths_weaknesses" || chosenTopic.id === "behavioral_challenge") {
                nextStage = "behavioral";
            } else if (chosenTopic.id === "why_hire_you" || chosenTopic.id === "suitability") {
                nextStage = "suitability";
            } else if (chosenTopic.id === "career_goals") {
                // If duration is short, do not force career goals, else ask future/career
                nextStage = "future";
            } else if (chosenTopic.id === "company_motivation" || chosenTopic.id === "leaving_reason" || chosenTopic.id === "salary_expectations") {
                nextStage = "motivation";
            } else {
                nextStage = "follow_up";
            }
        } else if (substantiveQuestionCount < plannedQuestionCount) {
            nextStage = "follow_up";
        } else {
            nextStage = "closing";
        }
    }

    return {
        candidateType,
        experienceLevel: experienceLevel || (candidateType === "experienced" ? "Experienced professional" : "Fresher"),
        durationMinutes,
        nextStage,
        askedStages: [...asked],
        availableResumeTopics,
        coveredResumeTopics: [...resumeTopicsCovered],
        resumeTargetCount,
        coveredResumeTopicCount,
        roleQuestionCount,
        roleQuestionTarget: roleTarget,
        behavioralQuestionCount,
        projectTracking,
        substantiveQuestionCount,
        targetQuestionCount: plannedQuestionCount,
        readyToClose: nextStage === "closing",
        topicChecklist: checklist,
        lastInterviewerTopic,
    };
}

function getRoleTopicGuidance(jobRole = "") {
    return ROLE_TOPIC_GUIDANCE.find(({ match }) => match.test(jobRole))?.topics ||
        "core responsibilities, technical decisions, testing, and problem-solving relevant to the selected role";
}

module.exports = {
    INTERVIEW_TOPICS,
    classifyInterviewTopic,
    classifyInterviewQuestion,
    buildInterviewCoverageChecklist,
    getInterviewProgress,
    getProjectTracking,
    getSubstantiveQuestionCount,
    isConclusionPrompt,
    isSubstantiveQuestion,
    getRoleTopicGuidance,
    getCandidateDisclosedTopics,
    getCandidateDisclosedStages,
    hasCompanyDetails,
};
