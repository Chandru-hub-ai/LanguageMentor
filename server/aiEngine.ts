import { GoogleGenAI, Modality, ThinkingLevel, Type } from "@google/genai";
import { getProfileById, LANGUAGE_PROFILES } from "../shared/profiles.ts";
import type {
  DiagramSpec,
  ExplanationMeta,
  LearnerLevel,
  PlaygroundHelpAction,
  PlaygroundHelpResponse,
  Profile,
  ProgrammingLanguage,
  SessionContextPayload,
  TeachingMode,
} from "../types.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEOUT_MS = 45_000;
const PRIMARY_TEXT_MODEL = "gemini-4-hydrogen";
const FALLBACK_TEXT_MODEL = "gemini-3.1-flash-lite";
const PRIMARY_TTS_MODEL = "gemini-3.8-flash-lite-tts";
const FALLBACK_TTS_MODEL = "gemini-3.8-flash-tts";

let cachedAiBeta: GoogleGenAI | null = null;
let cachedKey: string | undefined;

export const getAiClient = (): GoogleGenAI => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  if (!cachedAiBeta || cachedKey !== apiKey) {
    cachedAiBeta = new GoogleGenAI({
      apiKey,
      apiVersion: "v1beta",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedAiBeta;
};

export const CULTURAL_ANALOGY_DOMAINS = [
  "bus transportation",
  "local shops",
  "household activities",
  "agriculture",
  "college life",
  "food preparation",
  "banking",
  "mobile phones",
  "internet",
  "daily routines",
  "local infrastructure",
  "village life",
  "city life",
  "railways & postal delivery",
  "shared electricity & water service",
] as const;

export interface LearningContextAnalysis {
  concept: string;
  effectiveProfile: Profile;
  learnerLevel: LearnerLevel;
  complexity: "simple" | "complex";
  primaryMode: TeachingMode;
  secondaryModes: TeachingMode[];
  likelyMisconceptionSignal: boolean;
  includeUnderstandingCheck: boolean;
  suggestedAnalogyDomain: string;
  avoidAnalogies: string[];
  hasCodeInput: boolean;
}

const MODE_LABELS: Record<TeachingMode, string> = {
  simple_explanation: "MODE A — SIMPLE EXPLANATION (plain, beginner-friendly language)",
  cultural_analogy: "MODE B — CULTURAL ANALOGY (relatable real-world analogy with explicit mapping and limitations)",
  visual_learning: "MODE V — VISUAL LEARNING (conceptual diagram breakdown, data/process flow, mental model visualization)",
  mother_tongue: "MODE C — MOTHER-TONGUE EXPLANATION (natural regional clarity)",
  technical_deep_dive: "MODE D — TECHNICAL EXPLANATION (formal technical architecture, mechanisms, and depth)",
  exam_preparation: "MODE E — EXAM PREPARATION (structured academic definition, core points, examples, advantages/limits)",
  practical_application: "MODE F — PRACTICAL APPLICATION (real-world scenarios, industry usage, and demonstrations)",
  code_explanation: "MODE G — CODE EXPLANATION (line-by-line logic, inputs, outputs, execution flow)",
  step_by_step: "MODE H — STEP-BY-STEP LEARNING (sequential numbered stages from basics to execution)",
};

export interface ExplainOptions {
  explicitMode?: TeachingMode;
  learnerSkillLevel?: LearnerLevel;
  learningGoals?: string[];
  followUpQuestion?: string;
  previousTerm?: string;
  previousSummary?: string;
  simplify?: boolean;
  includeDiagram?: boolean;
}

const resolveProfileOverrideFromQuery = (query: string, defaultProfileId: string): Profile => {
  const q = query.toLowerCase();
  const explicitMatches: Array<[RegExp, string]> = [
    [/\bin\s+tanglish\b|\btanglish\b/, "tanglish"],
    [/\bcoimbatore\b|\bkovai\b/, "tamil_coimbatore"],
    [/\btirunelveli\b|\bnellai\b/, "tamil_tirunelveli"],
    [/\bmadurai\b/, "tamil_madurai"],
    [/\bchennai\b/, "tamil_chennai"],
    [/\bkongu\b/, "tamil_kongu"],
    [/\bacademic\s+tamil\b|\bformal\s+tamil\b|\bpure\s+tamil\b/, "tamil_academic"],
    [/\bstandard\s+tamil\b|\bin\s+tamil\b/, "tamil_std"],
    [/\bin\s+hindi\b/, "hindi_std"],
    [/\bin\s+telugu\b/, "telugu_std"],
    [/\bin\s+malayalam\b/, "malayalam_std"],
    [/\bin\s+kannada\b/, "kannada_std"],
    [/\bin\s+english\s+only\b|\bonly\s+in\s+english\b/, "english_std"],
  ];

  for (const [pattern, targetId] of explicitMatches) {
    if (pattern.test(q)) {
      return LANGUAGE_PROFILES.find((p) => p.id === targetId) || getProfileById(defaultProfileId);
    }
  }
  return getProfileById(defaultProfileId);
};

const pickAnalogyDomain = (profile: Profile, avoidAnalogies: string[], concept: string): string => {
  const avoidSet = new Set(avoidAnalogies.map((a) => a.toLowerCase().trim()));
  const preferred = profile.culturalAffinity || [];
  for (const domain of preferred) {
    if (!avoidSet.has(domain.toLowerCase())) {
      return domain;
    }
  }

  // Deterministic spread based on concept string so repeat queries don't collapse to one analogy
  let hash = 0;
  for (let i = 0; i < concept.length; i++) {
    hash = (hash * 31 + concept.charCodeAt(i)) >>> 0;
  }
  for (let offset = 0; offset < CULTURAL_ANALOGY_DOMAINS.length; offset++) {
    const candidate = CULTURAL_ANALOGY_DOMAINS[(hash + offset) % CULTURAL_ANALOGY_DOMAINS.length];
    if (!avoidSet.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return CULTURAL_ANALOGY_DOMAINS[0];
};

export const analyzeLearningContext = (
  rawQuery: string,
  profileId: string,
  sessionContext?: SessionContextPayload,
  isImage: boolean = false,
  options?: ExplainOptions
): LearningContextAnalysis => {
  const query = rawQuery.trim();
  const q = query.toLowerCase();
  const effectiveProfile = resolveProfileOverrideFromQuery(query, profileId);

  const hasCodeInput =
    /```|`[^`]+`|\b(function|const|let|var|def|class|import|export|return|select\s+\*|for\s*\(|while\s*\(|if\s*\(|public\s+static|console\.log|print\()\b/i.test(
      query
    ) ||
    /[{};=<>]{2,}/.test(query) ||
    /\b(code|program|snippet|script|line by line|debug|syntax|output of)\b/i.test(q);

  let learnerLevel: LearnerLevel = options?.learnerSkillLevel || "unspecified";
  if (options?.simplify || /\b(beginner|new to|eli5|for a kid|noob|scratch|basic|simply|simple terms|easy words)\b/i.test(q)) {
    learnerLevel = "beginner";
  } else if (/\b(advanced|under the hood|internals|production|deep dive|architecture|asymptotic|kernel|low-level)\b/i.test(q)) {
    learnerLevel = "advanced";
  } else if (/\b(intermediate|already know|compare|difference between|trade-?off)\b/i.test(q)) {
    learnerLevel = "intermediate";
  }

  const wantsSimple = Boolean(options?.simplify) || /\b(simple|easy|eli5|basic|beginner|short|quick|meaning|what is)\b/i.test(q);
  const wantsExam = /\b(exam|syllabus|2 mark|5 mark|10 mark|16 mark|university|viva|interview|notes|advantages|disadvantages)\b/i.test(q);
  const wantsPractical = /\b(practical|real.?world|use case|example|scenario|project|industry|used for|where is it used)\b/i.test(q);
  const wantsTechnical = /\b(technical|architecture|deep|how it works|protocol|internal|mechanism|algorithm|complexity)\b/i.test(q);
  const wantsStepByStep = /\b(step.?by.?step|steps|workflow|process|stages|lifecycle|how does .* work)\b/i.test(q);
  const wantsVisual = /\b(diagram|visual|visualize|flowchart|architecture diagram|memory layout)\b/i.test(q);
  const wantsAnalogy = /\b(analogy|metaphor|relatable|real life|like what)\b/i.test(q);
  const wantsQuizCheck = /\b(quiz|test me|check my understanding|practice question|ask me)\b/i.test(q);

  const likelyMisconceptionSignal =
    /\b(same as|is .* just|why does .* always|doesn't .* mean|so .* is|right\?|true that|heard that|myth|confused|difference between|vs)\b/i.test(
      q
    );

  let primaryMode: TeachingMode = "cultural_analogy";
  const secondaryModes: TeachingMode[] = [];

  if (options?.explicitMode && MODE_LABELS[options.explicitMode]) {
    primaryMode = options.explicitMode;
    if (primaryMode !== "cultural_analogy") secondaryModes.push("cultural_analogy");
    if (primaryMode !== "practical_application") secondaryModes.push("practical_application");
  } else if (options?.simplify) {
    primaryMode = "simple_explanation";
    secondaryModes.push("cultural_analogy", "step_by_step");
  } else if (hasCodeInput) {
    primaryMode = "code_explanation";
    secondaryModes.push("step_by_step", "practical_application");
  } else if (wantsVisual) {
    primaryMode = "visual_learning";
    secondaryModes.push("step_by_step", "cultural_analogy");
  } else if (wantsExam) {
    primaryMode = "exam_preparation";
    secondaryModes.push("technical_deep_dive", "practical_application");
  } else if (wantsStepByStep) {
    primaryMode = "step_by_step";
    secondaryModes.push("cultural_analogy", "practical_application");
  } else if (wantsTechnical || learnerLevel === "advanced") {
    primaryMode = "technical_deep_dive";
    secondaryModes.push("practical_application");
  } else if (wantsPractical) {
    primaryMode = "practical_application";
    secondaryModes.push("cultural_analogy", "technical_deep_dive");
  } else if (wantsSimple || learnerLevel === "beginner") {
    primaryMode = "simple_explanation";
    secondaryModes.push("cultural_analogy");
  } else if (wantsAnalogy) {
    primaryMode = "cultural_analogy";
    secondaryModes.push("simple_explanation", "technical_deep_dive");
  } else {
    primaryMode = "cultural_analogy";
    secondaryModes.push("simple_explanation", "technical_deep_dive", "practical_application");
  }

  if (effectiveProfile.lang !== "english" && !secondaryModes.includes("mother_tongue")) {
    secondaryModes.push("mother_tongue");
  }

  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const isSimpleDirect =
    !isImage &&
    !hasCodeInput &&
    !wantsExam &&
    !wantsTechnical &&
    !wantsStepByStep &&
    !wantsVisual &&
    !wantsQuizCheck &&
    !options?.explicitMode &&
    wordCount <= 4 &&
    /^(what is|define|meaning of)?\s*[\w\s-]{2,40}\??$/i.test(query) &&
    learnerLevel === "beginner";

  const complexity: "simple" | "complex" = isSimpleDirect ? "simple" : "complex";

  const includeUnderstandingCheck =
    wantsQuizCheck ||
    likelyMisconceptionSignal ||
    (complexity === "complex" &&
      (primaryMode === "step_by_step" ||
        primaryMode === "exam_preparation" ||
        primaryMode === "technical_deep_dive"));

  const avoidAnalogies = Array.isArray(sessionContext?.avoidAnalogies)
    ? sessionContext.avoidAnalogies.slice(0, 6)
    : [];
  const suggestedAnalogyDomain = pickAnalogyDomain(effectiveProfile, avoidAnalogies, query);

  return {
    concept: query.slice(0, 300),
    effectiveProfile,
    learnerLevel,
    complexity,
    primaryMode,
    secondaryModes,
    likelyMisconceptionSignal,
    includeUnderstandingCheck,
    suggestedAnalogyDomain,
    avoidAnalogies,
    hasCodeInput,
  };
};

const formatSessionContextBlock = (sessionContext?: SessionContextPayload): string => {
  if (!sessionContext) return "SESSION CONTEXT: Fresh learning session. No prior student history exists.";

  const lines: string[] = [];
  if (sessionContext.olderTopicsSummary?.trim()) {
    lines.push(`- Earlier session topics: ${sessionContext.olderTopicsSummary.trim().slice(0, 300)}`);
  }
  if (sessionContext.recentTurns?.length) {
    const turns = sessionContext.recentTurns
      .slice(-3)
      .map((t) => `${t.term}${t.topicSummary ? ` (${t.topicSummary})` : ""}`)
      .join(" -> ");
    lines.push(`- Recent flow: ${turns}`);
  }
  if (sessionContext.avoidAnalogies?.length) {
    lines.push(`- Analogies ALREADY used recently (DO NOT repeat): ${sessionContext.avoidAnalogies.join(", ")}`);
  }
  if (sessionContext.sessionMisconceptions?.length) {
    lines.push(`- Misconceptions noted earlier in this session: ${sessionContext.sessionMisconceptions.join("; ")}`);
  }

  return lines.length > 0
    ? `RELEVANT SESSION CONTEXT (use only when genuinely relevant; never pretend to remember unprovided history):\n${lines.join("\n")}`
    : "SESSION CONTEXT: Fresh learning session. No prior student history exists.";
};

export const buildAdaptivePrompts = (
  analysis: LearningContextAnalysis,
  sessionContext?: SessionContextPayload,
  isImage: boolean = false,
  options?: ExplainOptions
): { systemInstruction: string; userPrompt: string } => {
  const { effectiveProfile } = analysis;
  const activeModesText = [analysis.primaryMode, ...analysis.secondaryModes]
    .map((m) => `- ${MODE_LABELS[m]}`)
    .join("\n");

  const goalBlock = options?.learningGoals?.length
    ? `\n- Learner goals: ${options.learningGoals.slice(0, 3).join(", ")}`
    : "";

  const followUpBlock = options?.followUpQuestion
    ? `\nFOLLOW-UP QUESTION CONTEXT:
- Base topic: "${options.previousTerm || analysis.concept}"
${options.previousSummary ? `- Prior summary: ${options.previousSummary.slice(0, 240)}` : ""}
- Student follow-up question: "${options.followUpQuestion}"
Answer the follow-up directly and connect it back to the core mental model cleanly.`
    : "";

  const simplifyRule = options?.simplify
    ? `\nSIMPLIFICATION DIRECTIVE:
- The learner asked to simplify this concept. Strip heavy jargon, use crystal-clear short sentences, concrete everyday mental models, and clear bullet points.`
    : "";

  const visualRule =
    analysis.primaryMode === "visual_learning" || options?.includeDiagram
      ? `\nVISUAL DIAGRAM METADATA:
- Populate "meta.diagram" with a clean 3-to-6 node conceptual flow/architecture/memory diagram (nodes with id/label/detail, edges with from/to/label) so the frontend renders an interactive SVG schematic.`
      : "";

  const structureGuidance =
    analysis.complexity === "simple" && !options?.followUpQuestion
      ? `RESPONSE DEPTH (SIMPLE/DIRECT):
- Keep it crisp, clear, and focused. Answer directly without dumping unnecessary boilerplate sections.
- Include: clear meaning, brief real-world connection (if genuinely helpful), and 2-3 concise takeaways.`
      : `RESPONSE DEPTH (STRUCTURED TEACHING — UNDERSTAND -> VISUALIZE -> RELATE -> EXPLAIN -> APPLY -> VERIFY):
- Select only the sections that genuinely help this question (never force unused sections):
  1. **Concept Title & What It Means**
  2. **Simple Explanation**
  3. **Familiar Analogy** (only if it clarifies the mechanism; explicitly map analogy parts -> real tech terms AND state 1 limitation of the analogy)
  4. **Technical Definition & How It Works**
  5. **Real-World Application & Code Example** (include fenced markdown code block like \`\`\`python or \`\`\`javascript when code illustrates the concept clearly)
  6. **Common Misconceptions** ${analysis.likelyMisconceptionSignal ? "(REQUIRED: inspect the question carefully for any misconception, explain respectfully why it is inaccurate, and clarify with an accurate example)" : "(include if learners commonly confuse this topic)"}
  7. **Key Takeaways**
  ${analysis.includeUnderstandingCheck ? "8. **Understanding Check** (1 short conceptual or scenario check question at the end so the student can verify understanding)" : "- Do NOT append a quiz/understanding check question unless helpful."}
- Keep explanations thorough yet crisp — avoid fluff or repetitive filler.`;

  const codeGuidance = analysis.hasCodeInput || analysis.primaryMode === "code_explanation"
    ? `\nCODE MENTORING RULE:\n- Include clean syntax-highlighted fenced markdown code blocks (\`\`\`lang ... \`\`\`), trace inputs/outputs, execution order, and edge cases cleanly.`
    : "";

  const languageColumnsRule =
    effectiveProfile.lang === "english"
      ? `DUAL-PANEL ENGLISH MODE:
- "english" panel: Structured technical explanation, architecture/mechanics, code/exam points, and real-world application in clear global English.
- "regional" panel: Intuitive, conversational plain-English companion walkthrough using the relatable analogy, misconception clarity, and quick takeaways.`
      : `DUAL-PANEL MULTILINGUAL MODE:
- "english" panel: Clear, globally standard technical explanation in English.
- "regional" panel: Authentic explanation in **${effectiveProfile.name}** (${effectiveProfile.dialectLabel || effectiveProfile.lang}).
- ${effectiveProfile.instruction}
- Keep standard technical terms (API, Cloud, Server, RAM, HTTP, Git, SQL, etc.) in English where natural so students retain real-world technical vocabulary.
- Never distort technical accuracy for the sake of dialect.`;

  const systemInstruction = `You are Language Mentor 2.0, a culturally intelligent, adaptive multilingual technical mentor.

LEARNER & SESSION CONTEXT:
- Learner proficiency signal: ${analysis.learnerLevel === "unspecified" ? "Not specified (adapt clearly from core intuition up to accurate technical depth without inventing a skill score)" : analysis.learnerLevel}${goalBlock}
- Active teaching modes:
${activeModesText}
${formatSessionContextBlock(sessionContext)}
${followUpBlock}${simplifyRule}${visualRule}

CULTURAL ANALOGY INTELLIGENCE:
- Preferred fresh context if an analogy helps: "${analysis.suggestedAnalogyDomain}" (or another fitting everyday context like local shops, bus/train transit, agriculture, food preparation, college life, banking/UPI, mobile phones, or water/electricity service).
- NEVER repeat any analogy domain listed under "Analogies ALREADY used".
- NEVER force an analogy if a direct explanation is clearer, and NEVER introduce technical inaccuracy.
- When using a complex analogy, explicitly map analogy parts -> technical concepts and note where the analogy stops applying.

MISCONCEPTION & ACCURACY GUARDRAILS:
- Never hallucinate facts, invent scores, or claim persistent tracking beyond the session context provided.
- If the student's question contains a misconception, identify it gently, explain why it is incorrect, give an accurate example, and reinforce the right concept without discouraging them.
${codeGuidance}

${structureGuidance}

${languageColumnsRule}`;

  const userPrompt = isImage
    ? `Analyze the uploaded image (diagram, code, textbook page, architecture, or technical device). Identify the core concept accurately and teach it in both English and ${effectiveProfile.name} following the active teaching strategy.`
    : options?.followUpQuestion
      ? `Topic: "${options.previousTerm || analysis.concept}". Answer the student's follow-up question: "${options.followUpQuestion}" in both English and ${effectiveProfile.name}.`
      : `Student question/topic: "${analysis.concept}"`;

  return { systemInstruction, userPrompt };
};

export const DIAGRAM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    kind: { type: Type.STRING },
    caption: { type: Type.STRING },
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          role: { type: Type.STRING },
          detail: { type: Type.STRING },
        },
        required: ["id", "label"],
      },
    },
    edges: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          from: { type: Type.STRING },
          to: { type: Type.STRING },
          label: { type: Type.STRING },
        },
        required: ["from", "to"],
      },
    },
  },
  required: ["title", "kind", "nodes", "edges"],
};

export const EXPLANATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    english: {
      type: Type.STRING,
      description:
        "Clear, globally standard technical explanation in English with adaptive Markdown sections matching the active teaching mode.",
    },
    regional: {
      type: Type.STRING,
      description:
        "Culturally intelligent explanation in the requested regional language/dialect (or companion plain English in English mode), preserving accurate technical terms.",
    },
    meta: {
      type: Type.OBJECT,
      properties: {
        teachingMode: { type: Type.STRING },
        complexity: { type: Type.STRING },
        analogyDomain: { type: Type.STRING },
        misconceptionDetected: { type: Type.BOOLEAN },
        misconceptionSummary: { type: Type.STRING },
        understandingCheckIncluded: { type: Type.BOOLEAN },
        topicSummary: { type: Type.STRING },
        followUpSuggestions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        diagram: DIAGRAM_SCHEMA,
      },
      required: ["teachingMode", "complexity", "topicSummary"],
    },
  },
  required: ["english", "regional", "meta"],
};

export const parseDualResponse = (
  text: string
): { english: string; regional: string; meta?: Partial<ExplanationMeta> } => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        english?: string;
        regional?: string;
        meta?: Partial<ExplanationMeta>;
      };
      if (parsed.english || parsed.regional) {
        return {
          english: (parsed.english || "").trim(),
          regional: (parsed.regional || "").trim(),
          meta: parsed.meta,
        };
      }
    } catch {
      // Fall through to delimiter/markdown parser
    }
  }

  // Handle tagged stream format if passed directly
  const engTag = /\[\[ENGLISH\]\]([\s\S]*?)(?:\[\[\/ENGLISH\]\]|\[\[REGIONAL\]\]|$)/i.exec(trimmed);
  const regTag = /\[\[REGIONAL\]\]([\s\S]*?)(?:\[\[\/REGIONAL\]\]|$)/i.exec(trimmed);
  if (engTag || regTag) {
    let parsedMeta: Partial<ExplanationMeta> | undefined;
    const metaTag = /\[\[META\]\]([\s\S]*?)\[\[\/META\]\]/i.exec(trimmed);
    if (metaTag?.[1]) {
      try {
        parsedMeta = JSON.parse(metaTag[1].trim());
      } catch {
        // Ignore malformed meta
      }
    }
    return {
      english: (engTag?.[1] || "").trim() || "Explanation provided in companion panel.",
      regional: (regTag?.[1] || "").trim() || (engTag?.[1] || "").trim(),
      meta: parsedMeta,
    };
  }

  const regionalHeaderRegex = /(?:^|\n)\s*(?:#{1,6}\s*|\*\*)?Regional\s*Explanation\*?\*?:?\s*/i;
  const regionalMatch = regionalHeaderRegex.exec(trimmed);
  if (regionalMatch) {
    const beforeRegional = trimmed
      .slice(0, regionalMatch.index)
      .replace(/^\s*(?:#{1,6}\s*|\*\*)?(?:English|Standard)\s*Explanation\*?\*?:?\s*/i, "")
      .trim();
    const afterRegional = trimmed.slice(regionalMatch.index + regionalMatch[0].length).trim();
    return {
      english: beforeRegional || "Explanation provided in regional language.",
      regional: afterRegional,
    };
  }

  return {
    english: trimmed,
    regional: trimmed,
  };
};

export const getErrorStatusAndMessage = (
  error: unknown,
  fallbackMessage: string
): { status: number; message: string } => {
  const err = error as { status?: number; code?: number; message?: string; name?: string };
  if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
    return { status: 499, message: "Request was cancelled." };
  }
  if (err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timed out")) {
    return { status: 504, message: "AI request timed out. Please try again." };
  }

  let rawMessage = err?.message || fallbackMessage;
  let status =
    typeof err?.status === "number" ? err.status : typeof err?.code === "number" ? err.code : 500;

  if (rawMessage.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed?.error?.message) {
        rawMessage = parsed.error.message;
      }
      if (typeof parsed?.error?.code === "number") {
        status = parsed.error.code;
      }
    } catch {
      // Keep original string
    }
  }

  if (status === 400 || rawMessage.includes("API_KEY_INVALID")) {
    return {
      status: 400,
      message: rawMessage.includes("API_KEY")
        ? "Invalid Gemini API key. Please check Settings > Secrets."
        : rawMessage,
    };
  }
  if (status === 403 || rawMessage.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message: "Permission denied for Gemini API. Please check your API key in Settings > Secrets.",
    };
  }
  if (status === 404 || rawMessage.includes("NOT_FOUND")) {
    return { status: 404, message: "Requested Gemini model was not found." };
  }
  if (status === 429 || rawMessage.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Gemini API rate limit reached. Please wait a few seconds and try again.",
    };
  }
  return { status: status >= 400 && status < 600 ? status : 500, message: rawMessage };
};

const isTransientStatus = (status: number): boolean =>
  status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> => {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (val) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
};

const sanitizeDiagram = (raw: unknown): DiagramSpec | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes) || obj.nodes.length < 2) return null;

  const nodes = obj.nodes
    .slice(0, 7)
    .map((n: any, idx) => ({
      id: typeof n?.id === "string" && n.id.trim() ? n.id.trim() : `n${idx + 1}`,
      label: typeof n?.label === "string" ? n.label.trim().slice(0, 48) : `Step ${idx + 1}`,
      role: typeof n?.role === "string" ? n.role.trim().slice(0, 32) : undefined,
      detail: typeof n?.detail === "string" ? n.detail.trim().slice(0, 140) : undefined,
    }))
    .filter((n) => n.label.length > 0);

  if (nodes.length < 2) return null;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  const edges = rawEdges
    .map((e: any) => ({
      from: typeof e?.from === "string" ? e.from.trim() : "",
      to: typeof e?.to === "string" ? e.to.trim() : "",
      label: typeof e?.label === "string" ? e.label.trim().slice(0, 32) : undefined,
    }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const kindRaw = typeof obj.kind === "string" ? obj.kind.toLowerCase() : "flow";
  const kind: DiagramSpec["kind"] =
    kindRaw === "architecture" || kindRaw === "memory" || kindRaw === "timeline"
      ? kindRaw
      : "flow";

  return {
    title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 80) : "Concept Visual",
    kind,
    caption: typeof obj.caption === "string" ? obj.caption.trim().slice(0, 140) : undefined,
    nodes,
    edges,
  };
};

const buildMetaFromAnalysis = (
  analysis: LearningContextAnalysis,
  partial?: Partial<ExplanationMeta>
): ExplanationMeta => ({
  teachingMode: (partial?.teachingMode as TeachingMode) || analysis.primaryMode,
  secondaryModes: analysis.secondaryModes,
  complexity: (partial?.complexity as "simple" | "complex") || analysis.complexity,
  learnerLevel: analysis.learnerLevel,
  analogyDomain: partial?.analogyDomain || analysis.suggestedAnalogyDomain,
  misconceptionDetected:
    typeof partial?.misconceptionDetected === "boolean"
      ? partial.misconceptionDetected
      : analysis.likelyMisconceptionSignal,
  misconceptionSummary: partial?.misconceptionSummary || "",
  understandingCheckIncluded:
    typeof partial?.understandingCheckIncluded === "boolean"
      ? partial.understandingCheckIncluded
      : analysis.includeUnderstandingCheck,
  topicSummary: partial?.topicSummary || analysis.concept.slice(0, 120),
  diagram: sanitizeDiagram(partial?.diagram),
  followUpSuggestions: Array.isArray(partial?.followUpSuggestions)
    ? partial.followUpSuggestions
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 3)
    : undefined,
});

export const generateExplanation = async (
  term: string,
  profileId: string,
  sessionContext?: SessionContextPayload,
  signal?: AbortSignal,
  options?: ExplainOptions
): Promise<{ english: string; regional: string; meta: ExplanationMeta }> => {
  const ai = getAiClient();
  const analysis = analyzeLearningContext(term, profileId, sessionContext, false, options);
  const { systemInstruction, userPrompt } = buildAdaptivePrompts(analysis, sessionContext, false, options);

  const models = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: EXPLANATION_RESPONSE_SCHEMA,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            },
          }),
          DEFAULT_TIMEOUT_MS,
          signal
        );

        const parsed = parseDualResponse(response.text || "");
        if (!parsed.english.trim() || !parsed.regional.trim()) {
          throw new Error("AI response validation failed: incomplete explanation output.");
        }
        return {
          english: parsed.english,
          regional: parsed.regional,
          meta: buildMetaFromAnalysis(analysis, parsed.meta),
        };
      } catch (err) {
        lastError = err;
        const { status, message } = getErrorStatusAndMessage(err, "");
        if (status === 499) throw err;
        console.warn(`Explain attempt (${model} #${attempt + 1}) failed (${status}):`, message);
        if (!isTransientStatus(status)) {
          throw err;
        }
        if (attempt === 0) {
          const jitter = Math.floor(Math.random() * 250);
          await sleep((status === 429 ? 1400 : 700) + jitter);
        }
      }
    }
  }

  throw lastError;
};

export const analyzeImageExplanation = async (
  imageBase64: string,
  mimeType: string,
  profileId: string,
  sessionContext?: SessionContextPayload,
  signal?: AbortSignal
): Promise<{ english: string; regional: string; meta: ExplanationMeta }> => {
  const ai = getAiClient();
  const analysis = analyzeLearningContext(
    "Uploaded image technical concept",
    profileId,
    sessionContext,
    true
  );
  const { systemInstruction, userPrompt } = buildAdaptivePrompts(analysis, sessionContext, true);

  const models = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: {
              parts: [
                { inlineData: { mimeType, data: imageBase64 } },
                { text: userPrompt },
              ],
            },
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: EXPLANATION_RESPONSE_SCHEMA,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            },
          }),
          DEFAULT_TIMEOUT_MS,
          signal
        );

        const parsed = parseDualResponse(response.text || "");
        if (!parsed.english.trim() || !parsed.regional.trim()) {
          throw new Error("Image analysis returned an incomplete response.");
        }
        return {
          english: parsed.english,
          regional: parsed.regional,
          meta: buildMetaFromAnalysis(analysis, parsed.meta),
        };
      } catch (err) {
        lastError = err;
        const { status, message } = getErrorStatusAndMessage(err, "");
        if (status === 499) throw err;
        console.warn(`Image analysis attempt (${model} #${attempt + 1}) failed (${status}):`, message);
        if (!isTransientStatus(status)) {
          throw err;
        }
        if (attempt === 0) {
          await sleep((status === 429 ? 1400 : 700) + Math.floor(Math.random() * 250));
        }
      }
    }
  }

  throw lastError;
};

export interface StreamEventCallbacks {
  onMeta?: (meta: ExplanationMeta) => void;
  onChunk: (payload: {
    englishDelta?: string;
    regionalDelta?: string;
    english: string;
    regional: string;
  }) => void;
}

class TaggedStreamParser {
  private buffer = "";
  private section: "none" | "meta" | "english" | "regional" | "done" = "none";
  private englishText = "";
  private regionalText = "";
  private metaParsed: Partial<ExplanationMeta> | undefined;

  push(chunk: string): {
    meta?: Partial<ExplanationMeta>;
    englishDelta: string;
    regionalDelta: string;
    english: string;
    regional: string;
  } {
    this.buffer += chunk;
    let englishDelta = "";
    let regionalDelta = "";
    let newMeta: Partial<ExplanationMeta> | undefined;

    while (this.buffer.length > 0) {
      if (this.section === "none" || this.section === "done") {
        const metaIdx = this.buffer.indexOf("[[META]]");
        const engIdx = this.buffer.indexOf("[[ENGLISH]]");
        const regIdx = this.buffer.indexOf("[[REGIONAL]]");

        const candidates = [
          metaIdx >= 0 ? { idx: metaIdx, tag: "[[META]]", next: "meta" as const } : null,
          engIdx >= 0 ? { idx: engIdx, tag: "[[ENGLISH]]", next: "english" as const } : null,
          regIdx >= 0 ? { idx: regIdx, tag: "[[REGIONAL]]", next: "regional" as const } : null,
        ].filter(Boolean) as Array<{ idx: number; tag: string; next: "meta" | "english" | "regional" }>;

        if (candidates.length === 0) {
          // Keep tail in case a tag is split across chunks
          if (this.buffer.length > 20) {
            this.buffer = this.buffer.slice(-16);
          }
          break;
        }
        candidates.sort((a, b) => a.idx - b.idx);
        const first = candidates[0];
        this.buffer = this.buffer.slice(first.idx + first.tag.length);
        this.section = first.next;
        continue;
      }

      if (this.section === "meta") {
        const endMeta = this.buffer.indexOf("[[/META]]");
        if (endMeta === -1) break;
        const jsonStr = this.buffer.slice(0, endMeta).trim();
        this.buffer = this.buffer.slice(endMeta + "[[/META]]".length);
        this.section = "none";
        try {
          this.metaParsed = JSON.parse(jsonStr);
          newMeta = this.metaParsed;
        } catch {
          // Ignore malformed meta JSON
        }
        continue;
      }

      if (this.section === "english") {
        const closeTag = "[[/ENGLISH]]";
        const altTag = "[[REGIONAL]]";
        const closeIdx = this.buffer.indexOf(closeTag);
        const altIdx = this.buffer.indexOf(altTag);

        if (closeIdx !== -1 || altIdx !== -1) {
          const cutIdx =
            closeIdx !== -1 && altIdx !== -1
              ? Math.min(closeIdx, altIdx)
              : closeIdx !== -1
                ? closeIdx
                : altIdx;
          const piece = this.buffer.slice(0, cutIdx);
          if (piece) {
            const cleanPiece = this.englishText.length === 0 ? piece.replace(/^\s+/, "") : piece;
            this.englishText += cleanPiece;
            englishDelta += cleanPiece;
          }
          if (cutIdx === closeIdx) {
            this.buffer = this.buffer.slice(cutIdx + closeTag.length);
            this.section = "none";
          } else {
            this.buffer = this.buffer.slice(cutIdx + altTag.length);
            this.section = "regional";
          }
          continue;
        }

        // Hold back last 14 chars in case closing tag is split across chunk boundary
        const safeLen = Math.max(0, this.buffer.length - 14);
        if (safeLen === 0) break;
        const piece = this.buffer.slice(0, safeLen);
        this.buffer = this.buffer.slice(safeLen);
        const cleanPiece = this.englishText.length === 0 ? piece.replace(/^\s+/, "") : piece;
        this.englishText += cleanPiece;
        englishDelta += cleanPiece;
        break;
      }

      if (this.section === "regional") {
        const closeTag = "[[/REGIONAL]]";
        const closeIdx = this.buffer.indexOf(closeTag);
        if (closeIdx !== -1) {
          const piece = this.buffer.slice(0, closeIdx);
          if (piece) {
            const cleanPiece = this.regionalText.length === 0 ? piece.replace(/^\s+/, "") : piece;
            this.regionalText += cleanPiece;
            regionalDelta += cleanPiece;
          }
          this.buffer = this.buffer.slice(closeIdx + closeTag.length);
          this.section = "done";
          continue;
        }

        const safeLen = Math.max(0, this.buffer.length - 14);
        if (safeLen === 0) break;
        const piece = this.buffer.slice(0, safeLen);
        this.buffer = this.buffer.slice(safeLen);
        const cleanPiece = this.regionalText.length === 0 ? piece.replace(/^\s+/, "") : piece;
        this.regionalText += cleanPiece;
        regionalDelta += cleanPiece;
        break;
      }
    }

    return {
      meta: newMeta,
      englishDelta,
      regionalDelta,
      english: this.englishText,
      regional: this.regionalText,
    };
  }

  finalize(rawFullText: string): {
    english: string;
    regional: string;
    meta?: Partial<ExplanationMeta>;
  } {
    if (this.section === "english" && this.buffer) {
      this.englishText += this.buffer.replace(/\[\[\/?ENGLISH\]\]/gi, "");
      this.buffer = "";
    } else if (this.section === "regional" && this.buffer) {
      this.regionalText += this.buffer.replace(/\[\[\/?REGIONAL\]\]/gi, "");
      this.buffer = "";
    }

    const eng = this.englishText.trim();
    const reg = this.regionalText.trim();
    if (eng && reg) {
      return { english: eng, regional: reg, meta: this.metaParsed };
    }
    return parseDualResponse(rawFullText);
  }
}

export const streamExplanation = async (
  term: string,
  profileId: string,
  callbacks: StreamEventCallbacks,
  sessionContext?: SessionContextPayload,
  signal?: AbortSignal,
  options?: ExplainOptions
): Promise<{ english: string; regional: string; meta: ExplanationMeta }> => {
  const ai = getAiClient();
  const analysis = analyzeLearningContext(term, profileId, sessionContext, false, options);
  const { systemInstruction, userPrompt } = buildAdaptivePrompts(analysis, sessionContext, false, options);

  const includeDiagramHint = analysis.primaryMode === "visual_learning" || options?.includeDiagram;
  const diagramSchemaHint = includeDiagramHint
    ? `,"diagram":{"title":"Visual Flow","kind":"flow","caption":"Step flow","nodes":[{"id":"n1","label":"Step 1","detail":"..."}],"edges":[{"from":"n1","to":"n2","label":"next"}]}`
    : "";

  const streamSystemInstruction = `${systemInstruction}

STREAMING OUTPUT FORMAT (STRICT):
Output EXACTLY these three tagged blocks in order, with NO extra text before or after:
[[META]]{"teachingMode":"${analysis.primaryMode}","complexity":"${analysis.complexity}","analogyDomain":"${analysis.suggestedAnalogyDomain}","misconceptionDetected":${analysis.likelyMisconceptionSignal},"misconceptionSummary":"","understandingCheckIncluded":${analysis.includeUnderstandingCheck},"topicSummary":"short 1-line topic summary","followUpSuggestions":["concise follow-up 1","concise follow-up 2"]${diagramSchemaHint}}[[/META]]
[[ENGLISH]]
(Write the complete English explanation here in clean Markdown)
[[/ENGLISH]]
[[REGIONAL]]
(Write the complete ${analysis.effectiveProfile.name} explanation here in clean Markdown)
[[/REGIONAL]]`;

  const models = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let lastError: unknown;

  for (const model of models) {
    let emittedAnyContent = false;
    try {
      const parser = new TaggedStreamParser();
      let rawFullText = "";

      const streamResponse = await withTimeout(
        ai.models.generateContentStream({
          model,
          contents: userPrompt,
          config: {
            systemInstruction: streamSystemInstruction,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
          },
        }),
        DEFAULT_TIMEOUT_MS,
        signal
      );

      for await (const chunk of streamResponse) {
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const text = chunk.text || "";
        if (!text) continue;
        rawFullText += text;

        const update = parser.push(text);
        if (update.meta && callbacks.onMeta) {
          callbacks.onMeta(buildMetaFromAnalysis(analysis, update.meta));
        }
        if (update.englishDelta || update.regionalDelta) {
          emittedAnyContent = true;
          callbacks.onChunk({
            englishDelta: update.englishDelta || undefined,
            regionalDelta: update.regionalDelta || undefined,
            english: update.english,
            regional: update.regional,
          });
        }
      }

      const finalResult = parser.finalize(rawFullText);
      if (!finalResult.english.trim() || !finalResult.regional.trim()) {
        throw new Error("Stream completed without complete explanation blocks.");
      }

      return {
        english: finalResult.english.trim(),
        regional: finalResult.regional.trim(),
        meta: buildMetaFromAnalysis(analysis, finalResult.meta),
      };
    } catch (err) {
      lastError = err;
      const { status, message } = getErrorStatusAndMessage(err, "");
      if (status === 499 || emittedAnyContent) {
        throw err;
      }
      console.warn(`Stream attempt (${model}) failed (${status}):`, message);
      if (!isTransientStatus(status)) {
        throw err;
      }
      await sleep((status === 429 ? 1200 : 600) + Math.floor(Math.random() * 200));
    }
  }

  throw lastError;
};

// Server-side TTS cache + in-flight deduplication to avoid duplicate API/RPM usage
const ttsCache = new Map<string, string>();
const ttsInFlight = new Map<string, Promise<string>>();
const MAX_TTS_CACHE = 40;

const trimAtSentenceBoundary = (text: string, maxLen: number): string => {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  for (const sep of [". ", "! ", "? ", "। ", "\n", ", ", " "]) {
    const idx = slice.lastIndexOf(sep);
    if (idx > maxLen * 0.6) {
      return slice.slice(0, idx + sep.length).trim();
    }
  }
  return slice.trim();
};

export const sanitizeTextForSpeech = (rawText: string): string => {
  const cleaned = rawText
    .replace(/\[\[\/?[A-Z]+\]\]/g, " ")
    .replace(/```[\s\S]*?```/g, " code snippet ")
    .replace(/[#*`_~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return trimAtSentenceBoundary(cleaned, 2000);
};

export const synthesizeSpeechAudio = async (rawText: string): Promise<string> => {
  const text = sanitizeTextForSpeech(rawText);
  if (!text) {
    throw new Error("No speakable text provided.");
  }

  const cached = ttsCache.get(text);
  if (cached) {
    return cached;
  }

  const existing = ttsInFlight.get(text);
  if (existing) {
    return existing;
  }

  const ai = getAiClient();

  const task = (async () => {
    const ttsModels = [PRIMARY_TTS_MODEL, FALLBACK_TTS_MODEL];
    let lastError: unknown;

    for (const model of ttsModels) {
      let useMetadata = true;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const part: { text: string; speechMetadata?: { style: string } } = {
            text,
          };
          if (useMetadata) {
            part.speechMetadata = {
              style: "Clear, natural, encouraging mentor narration",
            };
          }

          const response = await withTimeout(
            ai.models.generateContent({
              model,
              contents: [{ role: "user", parts: [part] }],
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Kore" },
                  },
                },
              },
            }),
            DEFAULT_TIMEOUT_MS
          );

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.inlineData?.data) {
              if (ttsCache.size >= MAX_TTS_CACHE) {
                const oldestKey = ttsCache.keys().next().value;
                if (oldestKey) ttsCache.delete(oldestKey);
              }
              ttsCache.set(text, p.inlineData.data);
              return p.inlineData.data;
            }
          }

          const finishReason = response.candidates?.[0]?.finishReason;
          throw new Error(
            finishReason
              ? `Voice generation returned no audio (${finishReason}).`
              : "Voice generation returned no audio data."
          );
        } catch (err) {
          lastError = err;
          const { status, message } = getErrorStatusAndMessage(err, "");
          console.warn(`TTS attempt (${model} #${attempt + 1}) failed (${status}):`, message);

          if (useMetadata && status === 400) {
            useMetadata = false;
            continue;
          }
          if (!isTransientStatus(status)) {
            throw err;
          }
          if (attempt === 0) {
            await sleep((status === 429 ? 1200 : 900) + Math.floor(Math.random() * 200));
          }
        }
      }
    }

    throw lastError;
  })();

  ttsInFlight.set(text, task);
  try {
    return await task;
  } finally {
    ttsInFlight.delete(text);
  }
};

export const generateConceptDiagram = async (
  concept: string,
  signal?: AbortSignal
): Promise<DiagramSpec> => {
  const ai = getAiClient();
  const prompt = `Build a clear, accurate 4-to-6 node visual learning diagram for "${concept}". Use kind "flow", "architecture", "memory", or "timeline". Keep labels concise (under 40 chars) and include crisp node details and directional edges explaining how data/steps move.`;

  const models = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: DIAGRAM_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }),
          DEFAULT_TIMEOUT_MS,
          signal
        );

        const parsed = JSON.parse(response.text || "{}");
        const diagram = sanitizeDiagram(parsed);
        if (!diagram) {
          throw new Error("Could not generate structured diagram for this concept.");
        }
        return diagram;
      } catch (err) {
        lastError = err;
        const { status } = getErrorStatusAndMessage(err, "");
        if (status === 499 || !isTransientStatus(status)) throw err;
        if (attempt === 0) await sleep((status === 429 ? 1400 : 700) + Math.floor(Math.random() * 250));
      }
    }
  }

  throw lastError;
};

const PLAYGROUND_HELP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    english: { type: Type.STRING },
    regional: { type: Type.STRING },
    hintOnly: { type: Type.BOOLEAN },
    suggestedChallenge: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        prompt: { type: Type.STRING },
        starterCode: { type: Type.STRING },
        hints: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
  },
  required: ["english", "regional"],
};

export const generatePlaygroundAiHelp = async (params: {
  language: ProgrammingLanguage;
  code: string;
  stderr?: string;
  stdout?: string;
  action: PlaygroundHelpAction;
  profileId: string;
  question?: string;
  signal?: AbortSignal;
}): Promise<PlaygroundHelpResponse> => {
  const ai = getAiClient();
  const profile = getProfileById(params.profileId);

  const actionInstruction: Record<PlaygroundHelpAction, string> = {
    explain_code: "Explain what this code does conceptually, its inputs/outputs, and real execution trace.",
    line_by_line: "Walk through this code line-by-line cleanly, explaining every statement, variable update, and branch.",
    explain_error:
      "Explain why this runtime/compile error happens conceptually and guide the student to spot the bug first WITHOUT immediately dumping a complete rewritten solution unless tiny syntax clarification is needed.",
    hint: "Give 2 progressive pedagogical hints to guide the learner toward solving the problem without giving away the final full answer.",
    simplify: "Simplify this explanation into beginner-friendly plain language with a relatable analogy.",
    challenge:
      "Design one focused, realistic beginner-to-intermediate practice challenge in the same programming language, including starterCode and 2 progressive hints inside suggestedChallenge.",
  };

  const systemInstruction = `You are Language Mentor's interactive Programming Mentor.
Language profile: ${profile.name} (${profile.dialectLabel || profile.lang}).
${profile.instruction}
Keep standard programming keywords/syntax in English inside code references.
Respond strictly in JSON matching the schema with "english" (clear Markdown) and "regional" (${profile.lang === "english" ? "intuitive plain-English walkthrough" : `authentic ${profile.name}`}).`;

  const userPrompt = `Programming Language: ${params.language.toUpperCase()}
Action: ${params.action} — ${actionInstruction[params.action]}
${params.question ? `Learner question: ${params.question}\n` : ""}
Source Code:
\`\`\`${params.language}
${params.code.slice(0, 6000)}
\`\`\`
${params.stdout ? `Stdout:\n${params.stdout.slice(0, 1500)}\n` : ""}
${params.stderr ? `Stderr / Error:\n${params.stderr.slice(0, 1500)}\n` : ""}`;

  const models = [PRIMARY_TEXT_MODEL, FALLBACK_TEXT_MODEL];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: PLAYGROUND_HELP_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }),
          DEFAULT_TIMEOUT_MS,
          params.signal
        );

        const raw = JSON.parse(response.text || "{}") as any;
        return {
          action: params.action,
          english: String(raw.english || "Guidance unavailable.").trim(),
          regional: String(raw.regional || raw.english || "Guidance unavailable.").trim(),
          hintOnly: params.action === "hint" || params.action === "explain_error" ? true : Boolean(raw.hintOnly),
          suggestedChallenge: raw.suggestedChallenge?.title ? raw.suggestedChallenge : undefined,
        };
      } catch (err) {
        lastError = err;
        const { status } = getErrorStatusAndMessage(err, "");
        if (status === 499 || !isTransientStatus(status)) throw err;
        if (attempt === 0) await sleep((status === 429 ? 1400 : 700) + Math.floor(Math.random() * 250));
      }
    }
  }

  throw lastError;
};

