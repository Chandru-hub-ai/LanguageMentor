import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  analyzeImageExplanation,
  generateConceptDiagram,
  generateExplanation,
  generatePlaygroundAiHelp,
  getErrorStatusAndMessage,
  sanitizeTextForSpeech,
  streamExplanation,
  synthesizeSpeechAudio,
  type ExplainOptions,
} from "./server/aiEngine.ts";
import {
  createLearnerSession,
  getDb,
  normalizeConceptId,
  resolveSessionRecord,
  verifyLearnerToken,
} from "./server/db.ts";
import {
  abandonAssessmentAttempt,
  completeAssessmentAttempt,
  generateAssessment,
  getLearnerOverview,
  submitAssessmentAnswer,
} from "./server/assessmentService.ts";
import { computeAdaptiveDecision } from "./server/adaptiveEngine.ts";
import {
  confirmPasswordReset,
  getCurrentAuthSession,
  getOrCreateUserProfile,
  requestPasswordReset,
  signInUser,
  signOutSession,
  signUpUser,
  updateUserProfile,
} from "./server/authService.ts";
import {
  executeViaRemoteSandbox,
  getExecutionCapabilities,
  validateCodeSubmission,
} from "./server/codeExecutionService.ts";
import {
  createStudyTask,
  deleteSavedLesson,
  deleteStudyTask,
  generateSmartStudyPlan,
  getLessonsWithProgress,
  getOrGenerateLearningPath,
  getPlatformDashboardData,
  getSavedLessons,
  getStudyTasks,
  saveLessonProgressAndSubmission,
  saveLessonRecord,
  syncAndGetRevisions,
  updateStudyTask,
} from "./server/learningPlatformService.ts";
import type {
  AssessmentType,
  DifficultyLevel,
  PlaygroundHelpAction,
  ProgrammingLanguage,
  SessionContextPayload,
  SessionTurnSummary,
  TeachingMode,
} from "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VALID_ASSESSMENT_TYPES = new Set<AssessmentType>([
  "diagnostic",
  "beginner",
  "adaptive_practice",
  "concept_mastery",
  "application",
  "scenario",
  "retention",
  "exam_prep",
  "code",
]);

const VALID_TEACHING_MODES = new Set<TeachingMode>([
  "simple_explanation",
  "cultural_analogy",
  "visual_learning",
  "mother_tongue",
  "technical_deep_dive",
  "exam_preparation",
  "practical_application",
  "code_explanation",
  "step_by_step",
]);

const VALID_PLAYGROUND_ACTIONS = new Set<PlaygroundHelpAction>([
  "explain_code",
  "line_by_line",
  "explain_error",
  "hint",
  "simplify",
  "challenge",
]);

const sanitizeString = (val: unknown, maxLen: number): string =>
  typeof val === "string" ? val.trim().slice(0, maxLen) : "";

const sanitizeSessionContext = (raw: unknown): SessionContextPayload | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;

  const recentTurns: SessionTurnSummary[] = Array.isArray(obj.recentTurns)
    ? obj.recentTurns
        .slice(-3)
        .map((item) => {
          const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          return {
            term: sanitizeString(t.term, 150),
            topicSummary: sanitizeString(t.topicSummary, 200),
            teachingMode: typeof t.teachingMode === "string" ? (t.teachingMode as any) : undefined,
            analogyDomain: sanitizeString(t.analogyDomain, 80) || undefined,
            misconceptionSummary: sanitizeString(t.misconceptionSummary, 200) || undefined,
          };
        })
        .filter((t) => t.term.length > 0)
    : [];

  const avoidAnalogies = Array.isArray(obj.avoidAnalogies)
    ? obj.avoidAnalogies
        .map((x) => sanitizeString(x, 80))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const sessionMisconceptions = Array.isArray(obj.sessionMisconceptions)
    ? obj.sessionMisconceptions
        .map((x) => sanitizeString(x, 200))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    activeProfileId: sanitizeString(obj.activeProfileId, 50) || "tamil_std",
    recentTurns,
    olderTopicsSummary: sanitizeString(obj.olderTopicsSummary, 350),
    avoidAnalogies,
    sessionMisconceptions,
  };
};

const parseCookieToken = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
};

const isSameOriginRequest = (req: express.Request): boolean => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const expectedHost = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
    return originHost === expectedHost.split(",")[0].trim();
  } catch {
    return false;
  }
};

const extractToken = (req: express.Request): { token: string | null; fromCookie: boolean } => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token) return { token, fromCookie: false };
  }
  const cookieToken = parseCookieToken(req.headers.cookie, "lm_session");
  if (cookieToken) return { token: cookieToken, fromCookie: true };
  return { token: null, fromCookie: false };
};

const setSessionCookie = (req: express.Request, res: express.Response, token: string) => {
  const isHttps =
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "").toLowerCase().includes("https");
  const attrs = [
    `lm_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Max-Age=2592000",
    isHttps ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax",
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
};

const requireLearner = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const { token, fromCookie } = extractToken(req);
  if (fromCookie && req.method !== "GET" && !isSameOriginRequest(req)) {
    return res.status(403).json({ error: "Cross-origin request rejected." });
  }
  const learnerId = verifyLearnerToken(token);
  if (!learnerId) {
    return res.status(401).json({ error: "Valid learner session required." });
  }
  (req as any).learnerId = learnerId;
  return next();
};

const extractExplainOptions = (req: express.Request): ExplainOptions => {
  const raw = (req.body?.options ?? {}) as Record<string, unknown>;
  const { token } = extractToken(req);
  const ownerId = verifyLearnerToken(token);
  const profile = ownerId ? getOrCreateUserProfile(ownerId) : null;

  const explicitMode =
    typeof raw.explicitMode === "string" && VALID_TEACHING_MODES.has(raw.explicitMode as TeachingMode)
      ? (raw.explicitMode as TeachingMode)
      : undefined;

  return {
    explicitMode,
    learnerSkillLevel: profile ? profile.skillLevel : undefined,
    learningGoals: profile?.learningGoals,
    followUpQuestion: sanitizeString(raw.followUpQuestion, 400) || undefined,
    previousTerm: sanitizeString(raw.previousTerm, 150) || undefined,
    previousSummary: sanitizeString(raw.previousSummary, 300) || undefined,
    simplify: Boolean(raw.simplify),
    includeDiagram: Boolean(raw.includeDiagram) || explicitMode === "visual_learning",
  };
};

async function startServer() {
  getDb();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "20mb" }));

  // ========================
  // PHASE C: AUTHENTICATION & PROFILE ROUTES
  // ========================

  app.get("/api/auth/session", (req, res) => {
    const { token } = extractToken(req);
    const session = getCurrentAuthSession(token);
    if (session.token) {
      setSessionCookie(req, res, session.token);
    }
    return res.json(session);
  });

  app.post("/api/auth/signup", async (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    try {
      const { token } = extractToken(req);
      const { email, password, fullName } = req.body ?? {};
      const result = await signUpUser({
        email: typeof email === "string" ? email : "",
        password: typeof password === "string" ? password : "",
        fullName: typeof fullName === "string" ? fullName : "",
        currentToken: token,
      });
      setSessionCookie(req, res, result.token);
      return res.status(201).json(result);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Sign up failed." });
    }
  });

  app.post("/api/auth/signin", async (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    try {
      const { token } = extractToken(req);
      const { email, password } = req.body ?? {};
      const result = await signInUser({
        email: typeof email === "string" ? email : "",
        password: typeof password === "string" ? password : "",
        currentToken: token,
      });
      setSessionCookie(req, res, result.token);
      return res.json(result);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Sign in failed." });
    }
  });

  app.post("/api/auth/signout", (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    const { token } = extractToken(req);
    const result = signOutSession(token);
    setSessionCookie(req, res, result.token);
    return res.json(result);
  });

  app.post("/api/auth/password-reset/request", (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    try {
      const { email } = req.body ?? {};
      const result = requestPasswordReset(typeof email === "string" ? email : "");
      return res.json(result);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Recovery request failed." });
    }
  });

  app.post("/api/auth/password-reset/confirm", async (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    try {
      const { email, resetCode, newPassword } = req.body ?? {};
      const result = await confirmPasswordReset({
        email: typeof email === "string" ? email : "",
        resetCode: typeof resetCode === "string" ? resetCode : "",
        newPassword: typeof newPassword === "string" ? newPassword : "",
      });
      return res.json(result);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Password reset failed." });
    }
  });

  app.get("/api/profile", requireLearner, (req, res) => {
    const { token } = extractToken(req);
    const session = getCurrentAuthSession(token);
    return res.json({ user: session.user, profile: session.profile });
  });

  app.put("/api/profile", requireLearner, (req, res) => {
    try {
      const ownerId = (req as any).learnerId as string;
      const result = updateUserProfile(ownerId, req.body ?? {});
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Could not update profile." });
    }
  });

  // ========================
  // PHASE A + C: AI TUTOR, DIAGRAMS & TTS ROUTES
  // ========================

  app.post("/api/gemini/explain", async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const { term, profileId, sessionContext } = req.body ?? {};
      if (typeof term !== "string" || !term.trim()) {
        return res.status(400).json({ error: "A technical term or question is required." });
      }
      const safeTerm = term.trim().slice(0, 2000);
      const safeProfileId = typeof profileId === "string" ? profileId.slice(0, 50) : "tamil_std";
      const safeContext = sanitizeSessionContext(sessionContext);
      const options = extractExplainOptions(req);

      const result = await generateExplanation(safeTerm, safeProfileId, safeContext, controller.signal, options);
      return res.json(result);
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(
        error,
        "Mentor is temporarily offline. Please try again."
      );
      if (status === 499) return res.end();
      console.error("Gemini explain error:", error);
      return res.status(status).json({ error: message });
    }
  });

  app.post("/api/gemini/explain/stream", async (req, res) => {
    const { term, profileId, sessionContext } = req.body ?? {};
    if (typeof term !== "string" || !term.trim()) {
      return res.status(400).json({ error: "A technical term or question is required." });
    }

    const safeTerm = term.trim().slice(0, 2000);
    const safeProfileId = typeof profileId === "string" ? profileId.slice(0, 50) : "tamil_std";
    const safeContext = sanitizeSessionContext(sessionContext);
    const options = extractExplainOptions(req);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    const writeEvent = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const finalResult = await streamExplanation(
        safeTerm,
        safeProfileId,
        {
          onMeta: (meta) => writeEvent("meta", meta),
          onChunk: (chunk) => writeEvent("chunk", chunk),
        },
        safeContext,
        controller.signal,
        options
      );

      writeEvent("done", finalResult);
      return res.end();
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(
        error,
        "Mentor is temporarily offline. Please try again."
      );
      if (status !== 499) {
        console.error("Gemini stream error:", error);
        writeEvent("error", { status, error: message });
      }
      return res.end();
    }
  });

  app.post("/api/gemini/diagram", async (req, res) => {
    try {
      const concept = sanitizeString(req.body?.concept, 200);
      if (!concept) {
        return res.status(400).json({ error: "Concept is required to generate a diagram." });
      }
      const diagram = await generateConceptDiagram(concept);
      return res.json({ diagram });
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(error, "Could not generate visual diagram.");
      return res.status(status).json({ error: message });
    }
  });

  app.post("/api/gemini/analyze-image", async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const { image, mimeType, profileId, sessionContext } = req.body ?? {};
      if (typeof image !== "string" || !image.trim()) {
        return res.status(400).json({ error: "Image data is required." });
      }
      const safeMimeType =
        typeof mimeType === "string" && ALLOWED_IMAGE_MIME_TYPES.has(mimeType)
          ? mimeType
          : "image/jpeg";
      const safeProfileId = typeof profileId === "string" ? profileId.slice(0, 50) : "tamil_std";
      const safeContext = sanitizeSessionContext(sessionContext);

      const result = await analyzeImageExplanation(
        image,
        safeMimeType,
        safeProfileId,
        safeContext,
        controller.signal
      );

      return res.json(result);
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(error, "Image analysis failed.");
      if (status === 499) return res.end();
      console.error("Gemini image analysis error:", error);
      return res.status(status).json({ error: message });
    }
  });

  app.post("/api/gemini/speech", async (req, res) => {
    try {
      const { text } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "Text is required for speech generation." });
      }

      if (!sanitizeTextForSpeech(text)) {
        return res.status(400).json({ error: "No speakable text provided." });
      }

      const base64Audio = await synthesizeSpeechAudio(text);

      return res.json({
        audio: base64Audio,
        mimeType: "audio/wav",
      });
    } catch (error) {
      console.error("Gemini speech error:", error);
      const { status, message } = getErrorStatusAndMessage(error, "Voice generation failed.");
      return res.status(status).json({ error: message });
    }
  });

  // ========================
  // PHASE B: ADAPTIVE ASSESSMENT, MASTERY & LEARNING GAP ROUTES
  // ========================

  app.post("/api/assessment/session", (req, res) => {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ error: "Cross-origin request rejected." });
    }
    const { token } = extractToken(req);
    const sessionRecord = resolveSessionRecord(token);
    if (sessionRecord && token) {
      setSessionCookie(req, res, token);
      return res.json({ learnerId: sessionRecord.effectiveOwnerId, token });
    }
    const created = createLearnerSession(null);
    setSessionCookie(req, res, created.token);
    return res.json(created);
  });

  app.post("/api/assessment/generate", requireLearner, async (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const { concept, subject, assessmentType, difficulty, questionCount, profileId, learningObjective } =
        req.body ?? {};

      if (typeof concept !== "string" || !concept.trim()) {
        return res.status(400).json({ error: "Concept is required to generate an assessment." });
      }

      const safeType: AssessmentType = VALID_ASSESSMENT_TYPES.has(assessmentType)
        ? assessmentType
        : "adaptive_practice";
      const safeDifficulty: DifficultyLevel | undefined =
        typeof difficulty === "number" && difficulty >= 1 && difficulty <= 5
          ? (Math.round(difficulty) as DifficultyLevel)
          : undefined;
      const safeCount =
        typeof questionCount === "number"
          ? Math.min(5, Math.max(2, Math.round(questionCount)))
          : 3;

      const result = await generateAssessment(learnerId, {
        concept: concept.trim().slice(0, 150),
        subject: typeof subject === "string" ? subject.trim().slice(0, 80) : undefined,
        assessmentType: safeType,
        difficulty: safeDifficulty,
        questionCount: safeCount,
        profileId: typeof profileId === "string" ? profileId.slice(0, 50) : "tamil_std",
        learningObjective:
          typeof learningObjective === "string"
            ? learningObjective.trim().slice(0, 200)
            : undefined,
      });

      return res.json(result);
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(
        error,
        "Assessment generation failed. Please try again."
      );
      console.error("Assessment generate error:", error);
      return res.status(status).json({ error: message });
    }
  });

  app.post("/api/assessment/submit", requireLearner, async (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const { attemptId, questionId, submittedAnswer, timeTakenMs } = req.body ?? {};

      if (
        typeof attemptId !== "string" ||
        !attemptId.trim() ||
        typeof questionId !== "string" ||
        !questionId.trim() ||
        typeof submittedAnswer !== "string" ||
        !submittedAnswer.trim()
      ) {
        return res.status(400).json({
          error: "attemptId, questionId, and a non-empty submittedAnswer are required.",
        });
      }

      const result = await submitAssessmentAnswer(learnerId, {
        attemptId: attemptId.trim(),
        questionId: questionId.trim(),
        submittedAnswer: submittedAnswer.trim().slice(0, 4000),
        timeTakenMs: typeof timeTakenMs === "number" ? timeTakenMs : undefined,
      });

      return res.json(result);
    } catch (error: any) {
      const explicitStatus = typeof error?.status === "number" ? error.status : undefined;
      const { status, message } = getErrorStatusAndMessage(error, "Answer evaluation failed.");
      return res.status(explicitStatus || status).json({ error: message });
    }
  });

  app.post("/api/assessment/complete", requireLearner, (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const { attemptId } = req.body ?? {};
      if (typeof attemptId !== "string" || !attemptId.trim()) {
        return res.status(400).json({ error: "attemptId is required." });
      }
      const summary = completeAssessmentAttempt(learnerId, attemptId.trim());
      syncAndGetRevisions(learnerId);
      return res.json(summary);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Failed to complete assessment." });
    }
  });

  app.post("/api/assessment/abandon", requireLearner, (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const { attemptId } = req.body ?? {};
      if (typeof attemptId !== "string" || !attemptId.trim()) {
        return res.status(400).json({ error: "attemptId is required." });
      }
      const result = abandonAssessmentAttempt(learnerId, attemptId.trim());
      return res.json(result);
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Failed to abandon attempt." });
    }
  });

  app.get("/api/assessment/adapt", requireLearner, (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const rawConcept = sanitizeString(req.query.concept, 150);
      if (!rawConcept) {
        return res.status(400).json({ error: "concept query parameter is required." });
      }
      const conceptId = normalizeConceptId(rawConcept);
      const decision = computeAdaptiveDecision(learnerId, conceptId, rawConcept);
      return res.json(decision);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to compute adaptive decision." });
    }
  });

  app.get("/api/assessment/overview", requireLearner, (req, res) => {
    try {
      const learnerId = (req as any).learnerId as string;
      const overview = getLearnerOverview(learnerId);
      return res.json(overview);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to load learner overview." });
    }
  });

  // ========================
  // PHASE C: PLATFORM DASHBOARD, SAVED LESSONS, LEARNING PATHS, PLANNER & PLAYGROUND ROUTES
  // ========================

  app.get("/api/platform/dashboard", requireLearner, (req, res) => {
    try {
      const ownerId = (req as any).learnerId as string;
      const { token } = extractToken(req);
      const session = getCurrentAuthSession(token);
      const data = getPlatformDashboardData(ownerId, {
        authenticated: session.authenticated,
        user: session.user,
        profile: session.profile,
      });
      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to load dashboard." });
    }
  });

  app.get("/api/lessons/saved", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ lessons: getSavedLessons(ownerId) });
  });

  app.post("/api/lessons/saved", requireLearner, (req, res) => {
    try {
      const ownerId = (req as any).learnerId as string;
      const { term, profileId, teachingMode, englishResponse, regionalResponse, diagram, meta, isBookmarked } =
        req.body ?? {};
      if (typeof term !== "string" || !term.trim() || typeof englishResponse !== "string" || !englishResponse.trim()) {
        return res.status(400).json({ error: "Lesson term and explanation text are required." });
      }
      const saved = saveLessonRecord(ownerId, {
        term,
        profileId: typeof profileId === "string" ? profileId : "tamil_std",
        teachingMode: VALID_TEACHING_MODES.has(teachingMode) ? teachingMode : "cultural_analogy",
        englishResponse,
        regionalResponse: typeof regionalResponse === "string" ? regionalResponse : englishResponse,
        diagram,
        meta,
        isBookmarked,
      });
      return res.status(201).json({ lesson: saved });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to save lesson." });
    }
  });

  app.delete("/api/lessons/saved/:id", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    const deleted = deleteSavedLesson(ownerId, String(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: "Saved lesson not found." });
    }
    return res.json({ deleted: true });
  });

  app.get("/api/learning-path", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ learningPath: getOrGenerateLearningPath(ownerId, false) });
  });

  app.post("/api/learning-path/regenerate", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ learningPath: getOrGenerateLearningPath(ownerId, true) });
  });

  app.get("/api/study-plan", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ tasks: getStudyTasks(ownerId) });
  });

  app.post("/api/study-plan/generate", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ tasks: generateSmartStudyPlan(ownerId) });
  });

  app.post("/api/study-plan/tasks", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    const { title, conceptName, taskType, dueDate, estimatedMinutes, notes } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Task title is required." });
    }
    const task = createStudyTask(ownerId, {
      title,
      conceptName: typeof conceptName === "string" && conceptName.trim() ? conceptName : title,
      taskType,
      dueDate,
      estimatedMinutes,
      notes,
    });
    return res.status(201).json({ task });
  });

  app.patch("/api/study-plan/tasks/:id", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    const updated = updateStudyTask(ownerId, String(req.params.id), req.body ?? {});
    if (!updated) {
      return res.status(404).json({ error: "Study task not found." });
    }
    return res.json({ task: updated });
  });

  app.delete("/api/study-plan/tasks/:id", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    const deleted = deleteStudyTask(ownerId, String(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: "Study task not found." });
    }
    return res.json({ deleted: true });
  });

  app.get("/api/revisions", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ revisions: syncAndGetRevisions(ownerId) });
  });

  app.get("/api/playground/capabilities", (_req, res) => {
    return res.json({ capabilities: getExecutionCapabilities() });
  });

  app.get("/api/playground/lessons", requireLearner, (req, res) => {
    const ownerId = (req as any).learnerId as string;
    return res.json({ lessons: getLessonsWithProgress(ownerId) });
  });

  app.post("/api/playground/execute", requireLearner, async (req, res) => {
    try {
      const ownerId = (req as any).learnerId as string;
      const { language, code, stdin, lessonId } = req.body ?? {};
      const validated = validateCodeSubmission(language, code, stdin);
      const execResult = await executeViaRemoteSandbox(
        validated.language,
        validated.code,
        validated.stdin
      );

      let submission = null;
      if (execResult.executed) {
        submission = saveLessonProgressAndSubmission(ownerId, {
          lessonId: typeof lessonId === "string" ? lessonId : null,
          language: validated.language,
          code: validated.code,
          stdin: validated.stdin,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          status: execResult.status,
          executionTimeMs: execResult.executionTimeMs,
          markCompleted: execResult.status === "success",
        });
      }

      return res.json({ result: execResult, submission });
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Code execution request failed." });
    }
  });

  app.post("/api/playground/submissions", requireLearner, (req, res) => {
    try {
      const ownerId = (req as any).learnerId as string;
      const { language, code, stdin, stdout, stderr, status, executionTimeMs, lessonId, markCompleted } =
        req.body ?? {};
      const validated = validateCodeSubmission(language, code, stdin);
      const submission = saveLessonProgressAndSubmission(ownerId, {
        lessonId: typeof lessonId === "string" ? lessonId : null,
        language: validated.language,
        code: validated.code,
        stdin: validated.stdin,
        stdout: typeof stdout === "string" ? stdout.slice(0, 16_000) : "",
        stderr: typeof stderr === "string" ? stderr.slice(0, 16_000) : "",
        status: typeof status === "string" ? status.slice(0, 40) : "success",
        executionTimeMs: typeof executionTimeMs === "number" ? Math.max(0, Math.round(executionTimeMs)) : 0,
        markCompleted: Boolean(markCompleted),
      });
      return res.status(201).json({ submission });
    } catch (error: any) {
      const status = typeof error?.status === "number" ? error.status : 500;
      return res.status(status).json({ error: error?.message || "Could not record code submission." });
    }
  });

  app.post("/api/playground/ai-help", requireLearner, async (req, res) => {
    try {
      const { language, code, stderr, stdout, action, profileId, question } = req.body ?? {};
      const validated = validateCodeSubmission(language, code, "");
      const safeAction: PlaygroundHelpAction = VALID_PLAYGROUND_ACTIONS.has(action)
        ? action
        : "explain_code";
      const safeProfileId = typeof profileId === "string" ? profileId.slice(0, 50) : "tamil_std";

      const result = await generatePlaygroundAiHelp({
        language: validated.language as ProgrammingLanguage,
        code: validated.code,
        stderr: typeof stderr === "string" ? stderr : undefined,
        stdout: typeof stdout === "string" ? stdout : undefined,
        action: safeAction,
        profileId: safeProfileId,
        question: typeof question === "string" ? question.slice(0, 400) : undefined,
      });

      return res.json(result);
    } catch (error) {
      const { status, message } = getErrorStatusAndMessage(error, "Playground mentor unavailable.");
      return res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      return res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
