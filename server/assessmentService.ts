import crypto from "crypto";
import { ThinkingLevel, Type } from "@google/genai";
import { getAiClient, getErrorStatusAndMessage } from "./aiEngine.ts";
import { getProfileById } from "../shared/profiles.ts";
import {
  ensureConceptInCatalog,
  formatConceptName,
  getDb,
  normalizeConceptId,
} from "./db.ts";
import {
  ADAPTIVE_CONFIG,
  computeAdaptiveDecision,
  computeDiagnosticOutcome,
  computeNextDifficulty,
  detectAllLearningGaps,
  detectLearningGapsForConcept,
  getConceptMastery,
  mapAssessmentToEvidenceCategory,
  recalculateConceptMastery,
  recordMisconceptionObservation,
} from "./adaptiveEngine.ts";
import type {
  AssessmentType,
  AttemptStatus,
  ConceptMasterySummary,
  DifficultyLevel,
  GenerateAssessmentRequest,
  GenerateAssessmentResponse,
  LearnerOverviewResponse,
  MisconceptionCategory,
  MisconceptionObservation,
  PostAssessmentSummary,
  PublicQuestion,
  QuestionType,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
} from "../types.ts";

const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const inFlightGenerate = new Map<string, Promise<GenerateAssessmentResponse>>();

const VALID_QUESTION_TYPES = new Set<QuestionType>([
  "mcq",
  "true_false",
  "short_answer",
  "scenario",
  "conceptual",
  "application",
  "code",
  "debugging",
]);

const VALID_MISCONCEPTION_CATEGORIES: MisconceptionCategory[] = [
  "Conceptual misunderstanding",
  "Terminology confusion",
  "Incorrect reasoning",
  "Procedural error",
  "Calculation mistake",
  "Syntax mistake",
  "Misinterpretation",
  "Missing prerequisite knowledge",
];

const QUESTION_GENERATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionText: { type: Type.STRING },
          questionType: { type: Type.STRING },
          difficultyLevel: { type: Type.INTEGER },
          learningObjective: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          codeSnippet: { type: Type.STRING },
          correctAnswer: { type: Type.STRING },
          answerExplanation: { type: Type.STRING },
          evaluationCriteria: { type: Type.ARRAY, items: { type: Type.STRING } },
          optionMisconceptions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                optionText: { type: Type.STRING },
                category: { type: Type.STRING },
                description: { type: Type.STRING },
                intervention: { type: Type.STRING },
              },
              required: ["optionText", "category", "description", "intervention"],
            },
          },
        },
        required: [
          "questionText",
          "questionType",
          "difficultyLevel",
          "learningObjective",
          "correctAnswer",
          "answerExplanation",
          "evaluationCriteria",
        ],
      },
    },
  },
  required: ["subject", "questions"],
};

const RUBRIC_EVALUATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_correct: { type: Type.BOOLEAN },
    score: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    feedback: { type: Type.STRING },
    missing_concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
    misconceptions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          description: { type: Type.STRING },
          recommended_intervention: { type: Type.STRING },
        },
        required: ["category", "description", "recommended_intervention"],
      },
    },
    key_points_present: { type: Type.ARRAY, items: { type: Type.STRING } },
    key_points_missing: { type: Type.ARRAY, items: { type: Type.STRING } },
    evaluation_status: { type: Type.STRING },
  },
  required: [
    "is_correct",
    "score",
    "confidence",
    "feedback",
    "missing_concepts",
    "misconceptions",
    "key_points_present",
    "key_points_missing",
    "evaluation_status",
  ],
};

const normalizeAnswerString = (s: string): string =>
  s.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeMisconceptionCategory = (raw: string): MisconceptionCategory => {
  const found = VALID_MISCONCEPTION_CATEGORIES.find(
    (c) => c.toLowerCase() === raw.trim().toLowerCase()
  );
  return found || "Conceptual misunderstanding";
};

const stripHollowPraise = (feedback: string, score: number): string => {
  if (score >= 75) return feedback.trim();
  return feedback
    .trim()
    .replace(/^(great job!?|awesome!?|excellent!?|well done!?|nice work!?|perfect!?)\s*/i, "");
};

const callGeminiJson = async <T>(
  systemInstruction: string,
  userPrompt: string,
  schema: unknown
): Promise<T> => {
  const ai = getAiClient();
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: schema as any,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        const text = (res.text || "").trim();
        return JSON.parse(text) as T;
      } catch (err) {
        lastError = err;
        const { status } = getErrorStatusAndMessage(err, "");
        if (status !== 429 && status < 500) {
          throw err;
        }
        if (attempt === 0) {
          await sleep((status === 429 ? 1300 : 700) + Math.floor(Math.random() * 200));
        }
      }
    }
  }

  throw lastError;
};

const pickAllowedFormats = (type: AssessmentType): QuestionType[] => {
  switch (type) {
    case "diagnostic":
      return ["mcq", "true_false", "conceptual", "short_answer"];
    case "beginner":
      return ["mcq", "true_false", "short_answer"];
    case "code":
      return ["code", "debugging", "mcq"];
    case "scenario":
      return ["scenario", "mcq", "short_answer"];
    case "application":
      return ["application", "scenario", "short_answer"];
    case "exam_prep":
      return ["conceptual", "short_answer", "mcq"];
    case "retention":
      return ["mcq", "true_false", "conceptual"];
    case "concept_mastery":
      return ["mcq", "conceptual", "application", "short_answer"];
    default:
      return ["mcq", "true_false", "short_answer", "scenario"];
  }
};

const inferTargetDifficultyLadder = (
  type: AssessmentType,
  requestedDifficulty: DifficultyLevel | undefined,
  mastery: ConceptMasterySummary,
  count: number
): DifficultyLevel[] => {
  let base: number = requestedDifficulty || 2;
  if (!requestedDifficulty) {
    if (type === "beginner") base = 1;
    else if (type === "diagnostic") base = 2;
    else if (mastery.status === "ASSESSED" && mastery.masteryScore !== null) {
      if (mastery.masteryScore >= 80) base = 4;
      else if (mastery.masteryScore >= 60) base = 3;
      else if (mastery.masteryScore >= 40) base = 2;
      else base = 1;
    } else {
      base = 2;
    }
  }

  const ladder: DifficultyLevel[] = [];
  for (let i = 0; i < count; i++) {
    let lvl = base;
    if (type === "diagnostic" || type === "adaptive_practice") {
      if (i === 0) lvl = Math.max(1, base - 1);
      else if (i === 1) lvl = base;
      else if (i === 2) lvl = Math.min(5, base + 1);
      else lvl = Math.min(5, base + (i % 2));
    } else {
      lvl = Math.min(5, Math.max(1, base + (i === count - 1 && base < 5 ? 1 : 0)));
    }
    ladder.push(lvl as DifficultyLevel);
  }
  return ladder;
};

interface RawGeneratedQuestion {
  questionText: string;
  questionType: string;
  difficultyLevel: number;
  learningObjective: string;
  options?: string[];
  codeSnippet?: string;
  correctAnswer: string;
  answerExplanation: string;
  evaluationCriteria: string[];
  optionMisconceptions?: Array<{
    optionText: string;
    category: string;
    description: string;
    intervention: string;
  }>;
}

export const generateAssessment = async (
  userId: string,
  req: GenerateAssessmentRequest
): Promise<GenerateAssessmentResponse> => {
  const rawConcept = req.concept.trim().slice(0, 150);
  const conceptId = normalizeConceptId(rawConcept);
  const conceptName = formatConceptName(conceptId, rawConcept);
  const assessmentType: AssessmentType = req.assessmentType || "adaptive_practice";
  const questionCount = Math.min(5, Math.max(2, Number(req.questionCount) || 3));
  const profile = getProfileById(req.profileId || "tamil_std");

  const dedupeKey = `${userId}:${conceptId}:${assessmentType}:${questionCount}`;
  const existing = inFlightGenerate.get(dedupeKey);
  if (existing) {
    return existing;
  }

  const task = (async (): Promise<GenerateAssessmentResponse> => {
    const db = getDb();
    const existingMastery = getConceptMastery(userId, conceptId, conceptName, req.subject);
    const subjectHint = req.subject?.trim() || existingMastery.subject || "Technology";
    ensureConceptInCatalog(conceptId, conceptName, subjectHint);

    // Avoid repeating previously asked questions for this user + concept
    const previousQuestions = db
      .prepare(
        `SELECT question_text FROM assessment_questions
         WHERE user_id = ? AND concept_id = ?
         ORDER BY created_at DESC LIMIT 12`
      )
      .all(userId, conceptId) as Array<{ question_text: string }>;
    const avoidSet = new Set(previousQuestions.map((p) => normalizeAnswerString(p.question_text)));

    const allowedFormats = pickAllowedFormats(assessmentType);
    const difficultyLadder = inferTargetDifficultyLadder(
      assessmentType,
      req.difficulty,
      existingMastery,
      questionCount
    );

    const prereqs = db
      .prepare(
        `SELECT COALESCE(c.concept_name, p.prerequisite_id) AS name
         FROM concept_prerequisites p
         LEFT JOIN concept_catalog c ON c.concept_id = p.prerequisite_id
         WHERE p.concept_id = ?`
      )
      .all(conceptId) as Array<{ name: string }>;

    const systemInstruction = `You are Language Mentor 2.0's Educational Assessment Architect.
Generate ${questionCount} high-precision, unambiguous assessment questions strictly testing "${conceptName}" (subject: "${subjectHint}").

ASSESSMENT CONFIGURATION:
- Assessment Type: ${assessmentType}
- Allowed Question Formats: ${allowedFormats.join(", ")} (Use "mcq" for multiple-choice, "true_false" for true/false, "short_answer"/"conceptual"/"scenario"/"application"/"code"/"debugging" for open responses).
- Target Difficulty Ladder (1=Foundation .. 5=Challenge): [${difficultyLadder.join(", ")}]
- Student Language Preference: ${profile.name} (${profile.dialectLabel || profile.lang}). Write clear technical English question text, and if ${profile.lang !== "english" ? `helpful, you may include natural ${profile.name} clarification/context inside the question or explanation while keeping technical terms exact` : "keep English crisp and direct"}.
- Current Mastery Evidence: ${existingMastery.status === "ASSESSED" ? `${existingMastery.masteryScore}% (${existingMastery.confidenceState})` : "NOT ASSESSED (do NOT assume beginner; test fairly across the ladder)"}
${prereqs.length > 0 && assessmentType === "diagnostic" ? `- Prerequisite concepts to probe in Q1 if diagnostic: ${prereqs.map((p) => p.name).join(", ")}` : ""}
${req.learningObjective ? `- Focus Learning Objective: ${req.learningObjective}` : ""}

STRICT QUALITY & VALIDATION RULES:
1. Every question MUST be directly about "${conceptName}". Never generate off-topic questions.
2. NEVER repeat any previously asked question:
${previousQuestions.slice(0, 6).map((p) => `   - "${p.question_text.slice(0, 120)}"`).join("\n") || "   - (None)"}
3. For "mcq": provide exactly 4 distinct plausible options, and "correctAnswer" MUST match one of those 4 options character-for-character. Include "optionMisconceptions" for wrong options!
4. For "true_false": provide options ["True", "False"] and "correctAnswer" must be "True" or "False".
5. For "code" or "debugging": include a short, valid codeSnippet (and never claim runtime execution).
6. For open-ended formats ("short_answer", "conceptual", "scenario", "application", "code", "debugging"): provide 2-4 concrete "evaluationCriteria" key points and an authoritative reference "correctAnswer".`;

    const userPrompt = `Generate ${questionCount} distinct ${assessmentType} questions for "${conceptName}" matching difficulty levels [${difficultyLadder.join(", ")}].`;

    const generated = await callGeminiJson<{ subject: string; questions: RawGeneratedQuestion[] }>(
      systemInstruction,
      userPrompt,
      QUESTION_GENERATION_SCHEMA
    );

    const validatedQuestions: Array<{
      questionText: string;
      questionType: QuestionType;
      difficultyLevel: DifficultyLevel;
      learningObjective: string;
      options: string[] | null;
      codeSnippet: string | null;
      correctAnswer: string;
      answerExplanation: string;
      evaluationCriteria: string[];
      optionMisconceptions: Array<{
        optionText: string;
        category: MisconceptionCategory;
        description: string;
        intervention: string;
      }>;
    }> = [];

    const seenInBatch = new Set<string>();
    const rawList = Array.isArray(generated?.questions) ? generated.questions : [];

    for (let i = 0; i < rawList.length && validatedQuestions.length < questionCount; i++) {
      const q = rawList[i];
      const qText = (q.questionText || "").trim();
      const normQ = normalizeAnswerString(qText);
      if (!qText || seenInBatch.has(normQ) || avoidSet.has(normQ)) continue;

      let qType = (q.questionType || "mcq").toLowerCase().trim() as QuestionType;
      if (!VALID_QUESTION_TYPES.has(qType)) qType = "mcq";

      const diffNum = Number(q.difficultyLevel) || difficultyLadder[validatedQuestions.length] || 2;
      const difficultyLevel = Math.min(5, Math.max(1, Math.round(diffNum))) as DifficultyLevel;

      let options: string[] | null = null;
      let correctAnswer = (q.correctAnswer || "").trim();

      if (qType === "mcq") {
        const cleanOpts = Array.from(
          new Set((Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean))
        );
        if (cleanOpts.length < 3) {
          // Convert invalid MCQ into short_answer rather than shipping broken options
          qType = "short_answer";
        } else {
          options = cleanOpts.slice(0, 4);
          const matchedOpt = options.find(
            (o) => normalizeAnswerString(o) === normalizeAnswerString(correctAnswer)
          );
          if (!matchedOpt) {
            // Do not allow an MCQ whose answer doesn't match an option
            correctAnswer = options[0];
          } else {
            correctAnswer = matchedOpt;
          }
        }
      } else if (qType === "true_false") {
        options = ["True", "False"];
        correctAnswer = /^true$/i.test(correctAnswer) ? "True" : "False";
      }

      if (!correctAnswer) continue;

      seenInBatch.add(normQ);
      validatedQuestions.push({
        questionText: qText,
        questionType: qType,
        difficultyLevel,
        learningObjective: (q.learningObjective || `Understand ${conceptName}`).trim(),
        options,
        codeSnippet: q.codeSnippet?.trim() || null,
        correctAnswer,
        answerExplanation: (q.answerExplanation || `Core concept: ${correctAnswer}`).trim(),
        evaluationCriteria:
          Array.isArray(q.evaluationCriteria) && q.evaluationCriteria.length > 0
            ? q.evaluationCriteria.map((c) => String(c).trim()).filter(Boolean)
            : [correctAnswer],
        optionMisconceptions: Array.isArray(q.optionMisconceptions)
          ? q.optionMisconceptions.map((m) => ({
              optionText: String(m.optionText || "").trim(),
              category: normalizeMisconceptionCategory(String(m.category || "")),
              description: String(m.description || "").trim(),
              intervention: String(m.intervention || "").trim(),
            }))
          : [],
      });
    }

    if (validatedQuestions.length === 0) {
      throw new Error("Could not generate valid assessment questions. Please try again.");
    }

    // Sort by difficulty ladder initially so adaptive selection starts appropriately
    const initialDifficulty = validatedQuestions[0].difficultyLevel;
    const resolvedSubject = (generated?.subject || subjectHint).trim();
    const attemptId = `att_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = Date.now();

    const publicQuestions: PublicQuestion[] = [];

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO assessment_attempts (
           id, user_id, subject_id, concept_id, concept_name, assessment_type,
           initial_difficulty, current_difficulty, start_time, total_questions,
           status, language_profile_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?)`
      ).run(
        attemptId,
        userId,
        resolvedSubject,
        conceptId,
        conceptName,
        assessmentType,
        initialDifficulty,
        initialDifficulty,
        now,
        validatedQuestions.length,
        profile.id
      );

      const insertQ = db.prepare(
        `INSERT INTO assessment_questions (
           id, attempt_id, user_id, question_index, concept_id, subject,
           question_text, question_type, difficulty_level, learning_objective,
           options_json, code_snippet, correct_answer, answer_explanation,
           option_misconceptions_json, evaluation_criteria_json, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      validatedQuestions.forEach((vq, idx) => {
        const qId = `qst_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
        insertQ.run(
          qId,
          attemptId,
          userId,
          idx,
          conceptId,
          resolvedSubject,
          vq.questionText,
          vq.questionType,
          vq.difficultyLevel,
          vq.learningObjective,
          vq.options ? JSON.stringify(vq.options) : null,
          vq.codeSnippet,
          vq.correctAnswer,
          vq.answerExplanation,
          JSON.stringify(vq.optionMisconceptions),
          JSON.stringify(vq.evaluationCriteria),
          JSON.stringify({ assessmentType }),
          now
        );

        publicQuestions.push({
          id: qId,
          attemptId,
          questionIndex: idx,
          conceptId,
          subject: resolvedSubject,
          questionText: vq.questionText,
          questionType: vq.questionType,
          difficultyLevel: vq.difficultyLevel,
          learningObjective: vq.learningObjective,
          options: vq.options || undefined,
          codeSnippet: vq.codeSnippet || undefined,
        });
      });

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return {
      attemptId,
      conceptId,
      conceptName,
      subject: resolvedSubject,
      assessmentType,
      difficulty: initialDifficulty,
      totalQuestions: publicQuestions.length,
      questions: publicQuestions,
      currentMastery: existingMastery,
    };
  })().finally(() => {
    inFlightGenerate.delete(dedupeKey);
  });

  inFlightGenerate.set(dedupeKey, task);
  return task;
};

interface RubricEvalResult {
  is_correct: boolean;
  score: number;
  confidence: number;
  feedback: string;
  missing_concepts: string[];
  misconceptions: Array<{
    category: string;
    description: string;
    recommended_intervention: string;
  }>;
  key_points_present: string[];
  key_points_missing: string[];
  evaluation_status: "evaluated" | "uncertain_needs_review" | "fallback_partial";
}

const deterministicFallbackRubric = (
  submitted: string,
  referenceAnswer: string,
  criteria: string[]
): RubricEvalResult => {
  const normSub = normalizeAnswerString(submitted);
  if (!normSub || normSub.length < 3) {
    return {
      is_correct: false,
      score: 0,
      confidence: 0.9,
      feedback: "No meaningful answer was provided. Review the core concept and try explaining in your own words.",
      missing_concepts: criteria,
      misconceptions: [],
      key_points_present: [],
      key_points_missing: criteria,
      evaluation_status: "evaluated",
    };
  }

  const keyTokens = Array.from(
    new Set(
      `${referenceAnswer} ${criteria.join(" ")}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4)
    )
  );

  const matched = keyTokens.filter((t) => normSub.includes(t));
  const ratio = keyTokens.length > 0 ? matched.length / Math.min(keyTokens.length, 8) : 0.4;
  const score = Math.min(85, Math.max(15, Math.round(ratio * 100)));

  return {
    is_correct: score >= 75,
    score,
    confidence: 0.45,
    feedback:
      score >= 70
        ? "Your response covers key ideas, though automated rubric review marked confidence as provisional."
        : "Your response captures partial intuition, but misses key technical points from the expected explanation.",
    missing_concepts: criteria.slice(0, 2),
    misconceptions: [],
    key_points_present: matched.slice(0, 4),
    key_points_missing: criteria.slice(0, 2),
    evaluation_status: "fallback_partial",
  };
};

const evaluateOpenAnswerWithRubric = async (params: {
  questionText: string;
  questionType: QuestionType;
  conceptName: string;
  referenceAnswer: string;
  criteria: string[];
  submittedAnswer: string;
  languageProfileId: string;
}): Promise<RubricEvalResult> => {
  const profile = getProfileById(params.languageProfileId);
  const systemInstruction = `You are a strict, fair educational evaluator for Language Mentor 2.0.
Evaluate the student's response against the reference answer and rubric criteria for "${params.conceptName}".
RULES:
1. Award partial credit fairly (0 to 100) based on conceptual correctness, essential key points, logical clarity, and technical accuracy.
2. ${params.questionType === "code" || params.questionType === "debugging" ? "Evaluate code/debugging logic statically against the rubric; NEVER claim the code was executed." : "Accept valid equivalent phrasing in English, Tamil, or Tanglish."}
3. Never give hollow praise like "Great job!" when score < 75. State specifically what is accurate, what is missing, and why.
4. Set confidence (0.0 to 1.0). If the student answer is ambiguous or borderline, set confidence < 0.55 and evaluation_status = "uncertain_needs_review".
5. Write feedback clearly in English (and brief ${profile.name} encouragement only if helpful).`;

  const userPrompt = `Question (${params.questionType}): ${params.questionText}
Reference Answer: ${params.referenceAnswer}
Rubric Key Points: ${params.criteria.join(" | ")}
Student Submitted Answer: "${params.submittedAnswer}"`;

  try {
    const raw = await callGeminiJson<RubricEvalResult>(
      systemInstruction,
      userPrompt,
      RUBRIC_EVALUATION_SCHEMA
    );

    const score = Number.isFinite(Number(raw.score))
      ? Math.max(0, Math.min(100, Math.round(Number(raw.score))))
      : 0;
    const confidence = Number.isFinite(Number(raw.confidence))
      ? Math.max(0, Math.min(1, Number(raw.confidence)))
      : 0.7;

    const feedback = stripHollowPraise(
      typeof raw.feedback === "string" && raw.feedback.trim()
        ? raw.feedback
        : "Answer evaluated against concept rubric.",
      score
    );

    const evaluationStatus =
      confidence < 0.55
        ? "uncertain_needs_review"
        : raw.evaluation_status === "uncertain_needs_review"
          ? "uncertain_needs_review"
          : "evaluated";

    return {
      is_correct: score >= 80,
      score,
      confidence,
      feedback,
      missing_concepts: Array.isArray(raw.missing_concepts)
        ? raw.missing_concepts.map(String).slice(0, 5)
        : [],
      misconceptions: Array.isArray(raw.misconceptions) ? raw.misconceptions.slice(0, 3) : [],
      key_points_present: Array.isArray(raw.key_points_present)
        ? raw.key_points_present.map(String).slice(0, 5)
        : [],
      key_points_missing: Array.isArray(raw.key_points_missing)
        ? raw.key_points_missing.map(String).slice(0, 5)
        : [],
      evaluation_status: evaluationStatus,
    };
  } catch (err) {
    console.warn("Rubric Gemini fallback triggered:", err);
    return deterministicFallbackRubric(
      params.submittedAnswer,
      params.referenceAnswer,
      params.criteria
    );
  }
};

export const submitAssessmentAnswer = async (
  userId: string,
  req: SubmitAnswerRequest
): Promise<SubmitAnswerResponse> => {
  const db = getDb();
  const attempt = db
    .prepare("SELECT * FROM assessment_attempts WHERE id = ?")
    .get(req.attemptId) as any;

  if (!attempt) {
    throw Object.assign(new Error("Assessment attempt not found."), { status: 404 });
  }
  if (attempt.user_id !== userId) {
    throw Object.assign(new Error("Access denied for this assessment attempt."), { status: 403 });
  }
  if (attempt.status === "completed" || attempt.status === "abandoned") {
    throw Object.assign(new Error(`Cannot submit answers to a ${attempt.status} attempt.`), {
      status: 409,
    });
  }

  const question = db
    .prepare("SELECT * FROM assessment_questions WHERE id = ? AND attempt_id = ?")
    .get(req.questionId, req.attemptId) as any;

  if (!question) {
    throw Object.assign(new Error("Question not found in this assessment attempt."), {
      status: 404,
    });
  }

  const existingAnswer = db
    .prepare("SELECT id FROM student_answers WHERE attempt_id = ? AND question_id = ?")
    .get(req.attemptId, req.questionId) as { id: string } | undefined;

  if (existingAnswer) {
    throw Object.assign(new Error("This question has already been answered in this attempt."), {
      status: 409,
    });
  }

  const submittedAnswer = String(req.submittedAnswer || "").trim().slice(0, 4000);
  if (!submittedAnswer) {
    throw Object.assign(new Error("Submitted answer cannot be empty."), { status: 400 });
  }

  const qType = question.question_type as QuestionType;
  const difficultyLevel = question.difficulty_level as DifficultyLevel;
  const criteria: string[] = question.evaluation_criteria_json
    ? JSON.parse(question.evaluation_criteria_json)
    : [];
  const optionMisconceptions: Array<{
    optionText: string;
    category: MisconceptionCategory;
    description: string;
    intervention: string;
  }> = question.option_misconceptions_json ? JSON.parse(question.option_misconceptions_json) : [];

  let evaluatorType: "deterministic_key" | "gemini_rubric" | "fallback_uncertain" =
    "deterministic_key";
  let score = 0;
  let confidence = 1.0;
  let evaluationResult: "correct" | "partially_correct" | "incorrect" | "uncertain" = "incorrect";
  let evaluationStatus: "evaluated" | "uncertain_needs_review" | "fallback_partial" = "evaluated";
  let feedback = "";
  let missingConcepts: string[] = [];
  let keyPointsPresent: string[] = [];
  let keyPointsMissing: string[] = [];
  let recordedMisconception: MisconceptionObservation | null = null;

  if (qType === "mcq" || qType === "true_false") {
    const isExactMatch =
      normalizeAnswerString(submittedAnswer) === normalizeAnswerString(question.correct_answer);
    score = isExactMatch ? 100 : 0;
    confidence = 1.0;
    evaluationResult = isExactMatch ? "correct" : "incorrect";
    feedback = isExactMatch
      ? `Correct. ${question.answer_explanation}`
      : `Incorrect — you selected "${submittedAnswer}", whereas the correct answer is "${question.correct_answer}". ${question.answer_explanation}`;

    if (!isExactMatch) {
      missingConcepts = [question.learning_objective];
      const matchedMisc = optionMisconceptions.find(
        (m) => normalizeAnswerString(m.optionText) === normalizeAnswerString(submittedAnswer)
      );
      if (matchedMisc && matchedMisc.description) {
        recordedMisconception = recordMisconceptionObservation({
          userId,
          conceptId: attempt.concept_id,
          category: normalizeMisconceptionCategory(matchedMisc.category),
          description: matchedMisc.description,
          evidenceFromAnswer: `Selected "${submittedAnswer}" on: ${question.question_text.slice(0, 120)}`,
          confidence: 0.78,
          recommendedIntervention:
            matchedMisc.intervention || `Review ${question.learning_objective}`,
        });
      }
    }
  } else {
    const rubric = await evaluateOpenAnswerWithRubric({
      questionText: question.question_text,
      questionType: qType,
      conceptName: attempt.concept_name,
      referenceAnswer: question.correct_answer,
      criteria,
      submittedAnswer,
      languageProfileId: attempt.language_profile_id,
    });

    evaluatorType =
      rubric.evaluation_status === "fallback_partial" ? "fallback_uncertain" : "gemini_rubric";
    score = rubric.score;
    confidence = rubric.confidence;
    evaluationStatus = rubric.evaluation_status;
    feedback = rubric.feedback;
    missingConcepts = rubric.missing_concepts;
    keyPointsPresent = rubric.key_points_present;
    keyPointsMissing = rubric.key_points_missing;

    if (rubric.evaluation_status === "uncertain_needs_review" && score >= 40 && score < 80) {
      evaluationResult = "partially_correct";
    } else if (score >= 80) {
      evaluationResult = "correct";
    } else if (score >= 40) {
      evaluationResult = "partially_correct";
    } else {
      evaluationResult = "incorrect";
    }

    if (score < 70 && rubric.misconceptions.length > 0) {
      const m = rubric.misconceptions[0];
      recordedMisconception = recordMisconceptionObservation({
        userId,
        conceptId: attempt.concept_id,
        category: normalizeMisconceptionCategory(m.category),
        description: m.description,
        evidenceFromAnswer: submittedAnswer.slice(0, 180),
        confidence: Math.min(0.9, confidence),
        recommendedIntervention: m.recommended_intervention,
      });
    }
  }

  const now = Date.now();
  const answerId = `ans_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const evalId = `evl_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const obsId = `obs_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const safeTimeTaken =
    typeof req.timeTakenMs === "number" && req.timeTakenMs > 0 && req.timeTakenMs < 3_600_000
      ? Math.round(req.timeTakenMs)
      : null;

  const prevAttemptsCountRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM student_answers WHERE user_id = ? AND concept_id = ?`
    )
    .get(userId, attempt.concept_id) as { cnt: number };

  const evidenceCategory = mapAssessmentToEvidenceCategory(
    attempt.assessment_type as AssessmentType,
    qType
  );
  const weightMultiplier = ADAPTIVE_CONFIG.difficultyMultipliers[difficultyLevel] || 1;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO student_answers (
         id, user_id, attempt_id, question_id, submitted_answer,
         evaluation_result, score, time_taken_ms, attempt_number,
         concept_id, difficulty_level, submitted_at, feedback, misconception_ids_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      answerId,
      userId,
      req.attemptId,
      req.questionId,
      submittedAnswer,
      evaluationResult,
      score,
      safeTimeTaken,
      (prevAttemptsCountRow?.cnt || 0) + 1,
      attempt.concept_id,
      difficultyLevel,
      now,
      feedback,
      recordedMisconception?.id ? JSON.stringify([recordedMisconception.id]) : "[]"
    );

    db.prepare(
      `INSERT INTO assessment_evaluation_records (
         id, answer_id, user_id, attempt_id, question_id, evaluator_type,
         score, confidence, rationale, key_points_present_json,
         key_points_missing_json, missing_concepts_json, misconceptions_json,
         evaluation_status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evalId,
      answerId,
      userId,
      req.attemptId,
      req.questionId,
      evaluatorType,
      score,
      confidence,
      feedback,
      JSON.stringify(keyPointsPresent),
      JSON.stringify(keyPointsMissing),
      JSON.stringify(missingConcepts),
      JSON.stringify(recordedMisconception ? [recordedMisconception] : []),
      evaluationStatus,
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO mastery_observations (
         id, user_id, concept_id, attempt_id, question_id,
         evidence_category, normalized_score, difficulty_level,
         weight_multiplier, is_correct, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      obsId,
      userId,
      attempt.concept_id,
      req.attemptId,
      req.questionId,
      evidenceCategory,
      score,
      difficultyLevel,
      weightMultiplier,
      score >= 80 ? 1 : 0,
      now
    );

    // Recompute running attempt counters from authoritative student_answers rows
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS answered_count,
           SUM(CASE WHEN evaluation_result = 'correct' THEN 1 ELSE 0 END) AS correct_count,
           SUM(CASE WHEN evaluation_result = 'incorrect' THEN 1 ELSE 0 END) AS incorrect_count,
           SUM(CASE WHEN evaluation_result = 'partially_correct' THEN 1 ELSE 0 END) AS partial_count,
           AVG(score) AS avg_score
         FROM student_answers
         WHERE attempt_id = ?`
      )
      .get(req.attemptId) as any;

    const { nextDifficulty, teachingInterventionTriggered } = computeNextDifficulty(
      req.attemptId,
      attempt.current_difficulty as DifficultyLevel
    );

    db.prepare(
      `UPDATE assessment_attempts
       SET answered_count = ?, correct_count = ?, incorrect_count = ?,
           partial_count = ?, score = ?, current_difficulty = ?, status = 'in_progress'
       WHERE id = ?`
    ).run(
      stats.answered_count || 0,
      stats.correct_count || 0,
      stats.incorrect_count || 0,
      stats.partial_count || 0,
      Number((stats.avg_score || 0).toFixed(1)),
      nextDifficulty,
      req.attemptId
    );

    db.exec("COMMIT");

    // Pick next unanswered question closest to adaptive nextDifficulty
    const remainingQuestions = db
      .prepare(
        `SELECT q.* FROM assessment_questions q
         LEFT JOIN student_answers a ON a.question_id = q.id AND a.attempt_id = q.attempt_id
         WHERE q.attempt_id = ? AND a.id IS NULL
         ORDER BY ABS(q.difficulty_level - ?) ASC, q.question_index ASC
         LIMIT 1`
      )
      .get(req.attemptId, nextDifficulty) as any;

    const nextQuestion: PublicQuestion | null = remainingQuestions
      ? {
          id: remainingQuestions.id,
          attemptId: remainingQuestions.attempt_id,
          questionIndex: remainingQuestions.question_index,
          conceptId: remainingQuestions.concept_id,
          subject: remainingQuestions.subject,
          questionText: remainingQuestions.question_text,
          questionType: remainingQuestions.question_type,
          difficultyLevel: remainingQuestions.difficulty_level,
          learningObjective: remainingQuestions.learning_objective,
          options: remainingQuestions.options_json
            ? JSON.parse(remainingQuestions.options_json)
            : undefined,
          codeSnippet: remainingQuestions.code_snippet || undefined,
        }
      : null;

    // Update mastery incrementally from actual observations
    recalculateConceptMastery(userId, attempt.concept_id, attempt.concept_name, attempt.subject_id);

    let recommendation = "Continue to the next question.";
    if (teachingInterventionTriggered) {
      recommendation = `Repeated difficulty at Level 1 detected. Review "${attempt.concept_name}" with a simpler analogy before continuing.`;
    } else if (score < 50) {
      recommendation = `Focus on: ${question.learning_objective}`;
    } else if (score >= 85) {
      recommendation =
        nextDifficulty > attempt.current_difficulty
          ? `Consistent mastery shown — adaptive difficulty stepped up to Level ${nextDifficulty}.`
          : "Solid reasoning on this objective.";
    }

    return {
      answerId,
      questionId: req.questionId,
      attemptId: req.attemptId,
      evaluationResult,
      score,
      confidence,
      evaluationStatus,
      feedback,
      correctAnswer: question.correct_answer,
      answerExplanation: question.answer_explanation,
      missingConcepts,
      keyPointsPresent,
      keyPointsMissing,
      misconception: recordedMisconception,
      recommendation,
      nextRecommendedDifficulty: nextDifficulty,
      teachingInterventionTriggered,
      nextQuestion,
      attemptProgress: {
        answeredCount: stats.answered_count || 0,
        totalQuestions: attempt.total_questions,
        correctCount: stats.correct_count || 0,
        incorrectCount: stats.incorrect_count || 0,
        partialCount: stats.partial_count || 0,
        currentScore: Number((stats.avg_score || 0).toFixed(1)),
        status: "in_progress",
      },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

export const completeAssessmentAttempt = (
  userId: string,
  attemptId: string
): PostAssessmentSummary => {
  const db = getDb();
  const attempt = db
    .prepare("SELECT * FROM assessment_attempts WHERE id = ?")
    .get(attemptId) as any;

  if (!attempt) {
    throw Object.assign(new Error("Assessment attempt not found."), { status: 404 });
  }
  if (attempt.user_id !== userId) {
    throw Object.assign(new Error("Access denied for this assessment attempt."), { status: 403 });
  }
  if (attempt.status === "abandoned") {
    throw Object.assign(new Error("Abandoned attempt cannot be marked completed."), { status: 409 });
  }

  const answers = db
    .prepare(
      `SELECT a.*, q.learning_objective
       FROM student_answers a
       JOIN assessment_questions q ON q.id = a.question_id
       WHERE a.attempt_id = ?
       ORDER BY a.submitted_at ASC`
    )
    .all(attemptId) as any[];

  if (answers.length === 0) {
    throw Object.assign(
      new Error("Cannot complete an assessment with zero submitted answers."),
      { status: 400 }
    );
  }

  // Idempotent return if already completed
  if (attempt.status === "completed" && attempt.evaluation_summary_json) {
    return JSON.parse(attempt.evaluation_summary_json) as PostAssessmentSummary;
  }

  const prevMastery = getConceptMastery(
    userId,
    attempt.concept_id,
    attempt.concept_name,
    attempt.subject_id
  );
  const previousMasteryScore = prevMastery.masteryScore;

  const avgScore = Number(
    (answers.reduce((acc, a) => acc + Number(a.score || 0), 0) / answers.length).toFixed(1)
  );
  const correctAnswers = answers.filter((a) => a.evaluation_result === "correct").length;
  const incorrectAnswers = answers.filter((a) => a.evaluation_result === "incorrect").length;
  const partialCreditAnswers = answers.filter(
    (a) => a.evaluation_result === "partially_correct"
  ).length;

  const now = Date.now();
  db.prepare(
    `UPDATE assessment_attempts
     SET status = 'completed', completion_time = ?, score = ?,
         answered_count = ?, correct_count = ?, incorrect_count = ?, partial_count = ?
     WHERE id = ?`
  ).run(
    now,
    avgScore,
    answers.length,
    correctAnswers,
    incorrectAnswers,
    partialCreditAnswers,
    attemptId
  );

  const updatedMastery = recalculateConceptMastery(
    userId,
    attempt.concept_id,
    attempt.concept_name,
    attempt.subject_id
  );

  const misconceptionIds = answers
    .flatMap((a) => {
      try {
        return JSON.parse(a.misconception_ids_json || "[]") as string[];
      } catch {
        return [];
      }
    })
    .filter(Boolean);

  const misconceptionsIdentified: MisconceptionObservation[] = [];
  if (misconceptionIds.length > 0) {
    const placeholders = misconceptionIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM misconception_records WHERE id IN (${placeholders}) AND user_id = ?`)
      .all(...misconceptionIds, userId) as any[];
    for (const r of rows) {
      misconceptionsIdentified.push({
        id: r.id,
        conceptId: r.concept_id,
        category: r.category,
        description: r.description,
        evidenceFromAnswer: r.evidence_from_answer,
        confidence: r.confidence,
        recommendedIntervention: r.recommended_intervention,
        occurrenceCount: r.occurrence_count,
        isPattern: Boolean(r.is_pattern),
      });
    }
  }

  const learningGaps = detectLearningGapsForConcept(userId, attempt.concept_id);
  const adaptiveDecision = computeAdaptiveDecision(userId, attempt.concept_id, attempt.concept_name);
  const diagnosticOutcome =
    attempt.assessment_type === "diagnostic"
      ? computeDiagnosticOutcome(attemptId, attempt.concept_name, attempt.subject_id)
      : null;

  const insufficientDataNotice =
    answers.length < 3 || updatedMastery.confidenceState === "insufficient_evidence"
      ? `Provisional result based on ${answers.length} answered question(s) (${updatedMastery.evidenceCount} total evidence points). Complete additional assessments for higher confidence.`
      : undefined;

  const summary: PostAssessmentSummary = {
    attemptId,
    conceptId: attempt.concept_id,
    conceptName: attempt.concept_name,
    subject: attempt.subject_id,
    assessmentType: attempt.assessment_type,
    status: "completed",
    score: avgScore,
    totalQuestions: attempt.total_questions,
    answeredQuestions: answers.length,
    correctAnswers,
    incorrectAnswers,
    partialCreditAnswers,
    conceptsAssessed: [attempt.concept_name],
    performanceByConcept: [
      {
        conceptId: attempt.concept_id,
        conceptName: attempt.concept_name,
        averageScore: avgScore,
        questionsCount: answers.length,
      },
    ],
    misconceptionsIdentified,
    learningGaps,
    mastery: updatedMastery,
    previousMasteryScore,
    diagnosticOutcome,
    adaptiveDecision,
    insufficientDataNotice,
  };

  db.prepare("UPDATE assessment_attempts SET evaluation_summary_json = ? WHERE id = ?").run(
    JSON.stringify(summary),
    attemptId
  );

  return summary;
};

export const abandonAssessmentAttempt = (userId: string, attemptId: string) => {
  const db = getDb();
  const attempt = db
    .prepare("SELECT user_id, status FROM assessment_attempts WHERE id = ?")
    .get(attemptId) as { user_id: string; status: AttemptStatus } | undefined;

  if (!attempt) {
    throw Object.assign(new Error("Assessment attempt not found."), { status: 404 });
  }
  if (attempt.user_id !== userId) {
    throw Object.assign(new Error("Access denied for this assessment attempt."), { status: 403 });
  }
  if (attempt.status === "completed") {
    throw Object.assign(new Error("Completed attempt cannot be abandoned."), { status: 409 });
  }

  db.prepare(
    "UPDATE assessment_attempts SET status = 'abandoned', completion_time = ? WHERE id = ?"
  ).run(Date.now(), attemptId);
  return { attemptId, status: "abandoned" as AttemptStatus };
};

export const getLearnerOverview = (userId: string): LearnerOverviewResponse => {
  const db = getDb();
  const masteryRows = db
    .prepare("SELECT * FROM concept_mastery WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as any[];

  const masteries: ConceptMasterySummary[] = masteryRows.map((row) => ({
    conceptId: row.concept_id,
    conceptName: row.concept_name,
    subject: row.subject,
    status: "ASSESSED",
    quizAccuracy: row.quiz_accuracy,
    practicalPerformance: row.practical_performance,
    retentionPerformance: row.retention_performance,
    masteryScore: row.mastery_score,
    isProvisional: Boolean(row.is_provisional),
    confidenceState: row.confidence_state,
    classificationBand: row.classification_band,
    attemptsCount: row.attempts_count,
    evidenceCount: row.evidence_count,
    highestDifficultyPassed: row.highest_difficulty_passed,
    recentTrend: row.recent_trend,
    lastAssessedAt: row.last_assessed_at,
  }));

  const learningGaps = detectAllLearningGaps(userId);

  const misconceptionRows = db
    .prepare(
      `SELECT * FROM misconception_records
       WHERE user_id = ?
       ORDER BY is_pattern DESC, occurrence_count DESC, last_observed_at DESC
       LIMIT 10`
    )
    .all(userId) as any[];

  const repeatedMisconceptions: MisconceptionObservation[] = misconceptionRows.map((r) => ({
    id: r.id,
    conceptId: r.concept_id,
    category: r.category,
    description: r.description,
    evidenceFromAnswer: r.evidence_from_answer,
    confidence: r.confidence,
    recommendedIntervention: r.recommended_intervention,
    occurrenceCount: r.occurrence_count,
    isPattern: Boolean(r.is_pattern),
  }));

  const attemptRows = db
    .prepare(
      `SELECT * FROM assessment_attempts
       WHERE user_id = ?
       ORDER BY start_time DESC LIMIT 10`
    )
    .all(userId) as any[];

  const recentAttempts = attemptRows.map((a) => ({
    attemptId: a.id,
    conceptId: a.concept_id,
    conceptName: a.concept_name,
    assessmentType: a.assessment_type,
    score: a.score,
    status: a.status,
    totalQuestions: a.total_questions,
    answeredCount: a.answered_count,
    startTime: a.start_time,
    completionTime: a.completion_time,
  }));

  return {
    learnerId: userId,
    masteries,
    learningGaps,
    repeatedMisconceptions,
    recentAttempts,
  };
};
