import {
  ensureLearnerSession,
  getSharedBearerToken,
  setSharedBearerToken,
} from "./assessmentService";
import type {
  AuthSessionResponse,
  CodeExecutionResult,
  CodeSubmissionRecord,
  DiagramSpec,
  ExplanationMeta,
  LanguageCapability,
  LearningPath,
  PlatformDashboardData,
  PlaygroundHelpAction,
  PlaygroundHelpResponse,
  ProgrammingLanguage,
  ProgrammingLesson,
  RevisionScheduleItem,
  SavedLessonRecord,
  StudyTask,
  TeachingMode,
  UserProfile,
} from "../types";

const REQUEST_TIMEOUT_MS = 45_000;

const fetchWithAuth = async <T>(
  url: string,
  options: RequestInit = {},
  fallbackError = "Request failed."
): Promise<T> => {
  const token = getSharedBearerToken() || (await ensureLearnerSession());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || fallbackError);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
};

// ========================
// AUTH & PROFILE
// ========================

export const restoreAuthSession = async (): Promise<AuthSessionResponse> => {
  const res = await fetch("/api/auth/session", { credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as AuthSessionResponse;
  if (!res.ok) {
    throw new Error((data as any)?.error || "Could not initialize session.");
  }
  if (data.token) {
    setSharedBearerToken(data.token);
  }
  return data;
};

export const signUpClient = async (payload: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthSessionResponse> => {
  const data = await fetchWithAuth<AuthSessionResponse>(
    "/api/auth/signup",
    { method: "POST", body: JSON.stringify(payload) },
    "Account creation failed."
  );
  if (data.token) setSharedBearerToken(data.token);
  return data;
};

export const signInClient = async (payload: {
  email: string;
  password: string;
}): Promise<AuthSessionResponse> => {
  const data = await fetchWithAuth<AuthSessionResponse>(
    "/api/auth/signin",
    { method: "POST", body: JSON.stringify(payload) },
    "Sign in failed."
  );
  if (data.token) setSharedBearerToken(data.token);
  return data;
};

export const signOutClient = async (): Promise<AuthSessionResponse> => {
  const data = await fetchWithAuth<AuthSessionResponse>(
    "/api/auth/signout",
    { method: "POST" },
    "Sign out failed."
  );
  if (data.token) setSharedBearerToken(data.token);
  else setSharedBearerToken(null);
  return data;
};

export const requestPasswordResetClient = async (email: string): Promise<{
  accepted: boolean;
  resetCode?: string;
  expiresInMinutes: number;
  message: string;
}> => {
  const res = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Could not generate recovery code.");
  return data;
};

export const confirmPasswordResetClient = async (payload: {
  email: string;
  resetCode: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> => {
  const res = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Could not reset password.");
  return data;
};

export const updateProfileClient = async (
  updates: Partial<UserProfile> & { fullName?: string }
): Promise<{ user: AuthSessionResponse["user"]; profile: UserProfile }> => {
  return fetchWithAuth(
    "/api/profile",
    { method: "PUT", body: JSON.stringify(updates) },
    "Could not save profile preferences."
  );
};

// ========================
// DASHBOARD & SAVED LESSONS
// ========================

export const getPlatformDashboardClient = async (): Promise<PlatformDashboardData> => {
  return fetchWithAuth<PlatformDashboardData>(
    "/api/platform/dashboard",
    { method: "GET" },
    "Could not load dashboard data."
  );
};

export const saveLessonClient = async (payload: {
  term: string;
  profileId: string;
  teachingMode: TeachingMode;
  englishResponse: string;
  regionalResponse: string;
  diagram?: DiagramSpec | null;
  meta?: ExplanationMeta | null;
  isBookmarked?: boolean;
}): Promise<SavedLessonRecord> => {
  const res = await fetchWithAuth<{ lesson: SavedLessonRecord }>(
    "/api/lessons/saved",
    { method: "POST", body: JSON.stringify(payload) },
    "Could not save lesson."
  );
  return res.lesson;
};

export const deleteSavedLessonClient = async (id: string): Promise<void> => {
  await fetchWithAuth(
    `/api/lessons/saved/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Could not remove saved lesson."
  );
};

// ========================
// LEARNING PATH, STUDY PLANNER & SPACED REVISION
// ========================

export const regenerateLearningPathClient = async (): Promise<LearningPath> => {
  const res = await fetchWithAuth<{ learningPath: LearningPath }>(
    "/api/learning-path/regenerate",
    { method: "POST" },
    "Could not update learning path."
  );
  return res.learningPath;
};

export const generateStudyPlanClient = async (): Promise<StudyTask[]> => {
  const res = await fetchWithAuth<{ tasks: StudyTask[] }>(
    "/api/study-plan/generate",
    { method: "POST" },
    "Could not generate smart study plan."
  );
  return res.tasks;
};

export const createStudyTaskClient = async (payload: {
  title: string;
  conceptName: string;
  taskType?: StudyTask["taskType"];
  dueDate?: string;
  estimatedMinutes?: number;
}): Promise<StudyTask> => {
  const res = await fetchWithAuth<{ task: StudyTask }>(
    "/api/study-plan/tasks",
    { method: "POST", body: JSON.stringify(payload) },
    "Could not create study task."
  );
  return res.task;
};

export const updateStudyTaskClient = async (
  taskId: string,
  updates: { status?: StudyTask["status"]; dueDate?: string; title?: string }
): Promise<StudyTask> => {
  const res = await fetchWithAuth<{ task: StudyTask }>(
    `/api/study-plan/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(updates) },
    "Could not update study task."
  );
  return res.task;
};

export const deleteStudyTaskClient = async (taskId: string): Promise<void> => {
  await fetchWithAuth(
    `/api/study-plan/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
    "Could not delete study task."
  );
};

export const getRevisionsClient = async (): Promise<RevisionScheduleItem[]> => {
  const res = await fetchWithAuth<{ revisions: RevisionScheduleItem[] }>(
    "/api/revisions",
    { method: "GET" },
    "Could not load revision schedule."
  );
  return res.revisions;
};

// ========================
// PROGRAMMING PLAYGROUND & ISOLATED WORKER SANDBOX
// ========================

export const getPlaygroundLessonsClient = async (): Promise<ProgrammingLesson[]> => {
  const res = await fetchWithAuth<{ lessons: ProgrammingLesson[] }>(
    "/api/playground/lessons",
    { method: "GET" },
    "Could not load programming lessons."
  );
  return res.lessons;
};

export const getCapabilitiesClient = async (): Promise<LanguageCapability[]> => {
  const res = await fetch("/api/playground/capabilities", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  return data?.capabilities || [];
};

/**
 * Runs JavaScript strictly inside a temporary isolated Web Worker with DOM/network APIs shadowed
 * and a 5-second hard termination timeout — never using direct main-thread eval().
 */
export const runJavaScriptInWorkerSandbox = (
  code: string,
  stdin: string
): Promise<CodeExecutionResult> => {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const workerSource = `
      self.onmessage = function(e) {
        const userCode = e.data.code;
        const rawStdin = e.data.stdin || "";
        const stdinLines = rawStdin.split(/\\r?\\n/);
        let lineIdx = 0;
        const out = [];
        const err = [];
        const formatVal = (v) => {
          if (typeof v === "string") return v;
          if (v === undefined) return "undefined";
          try { return JSON.stringify(v); } catch { return String(v); }
        };
        const console = {
          log: (...args) => out.push(args.map(formatVal).join(" ")),
          info: (...args) => out.push(args.map(formatVal).join(" ")),
          warn: (...args) => err.push("WARN: " + args.map(formatVal).join(" ")),
          error: (...args) => err.push(args.map(formatVal).join(" ")),
        };
        const readLine = () => lineIdx < stdinLines.length ? stdinLines[lineIdx++] : "";
        // Shadow browser network/worker APIs inside the worker scope
        const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, importScripts = undefined;
        try {
          const fn = new Function("console", "readLine", "fetch", "XMLHttpRequest", "WebSocket", "importScripts", "\\"use strict\\";\\n" + userCode);
          fn(console, readLine, fetch, XMLHttpRequest, WebSocket, importScripts);
          self.postMessage({
            status: err.length > 0 && out.length === 0 ? "runtime_error" : "success",
            stdout: out.join("\\n").slice(0, 16000),
            stderr: err.join("\\n").slice(0, 16000),
            exitCode: 0
          });
        } catch (ex) {
          self.postMessage({
            status: "runtime_error",
            stdout: out.join("\\n").slice(0, 16000),
            stderr: (ex && ex.stack ? ex.name + ": " + ex.message : String(ex)).slice(0, 16000),
            exitCode: 1
          });
        }
      };
    `;

    const blob = new Blob([workerSource], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    let settled = false;

    const cleanup = () => {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      URL.revokeObjectURL(url);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        language: "javascript",
        executed: true,
        executionMode: "worker_sandbox",
        status: "timeout",
        stdout: "",
        stderr: "Execution timed out after 5 seconds (possible infinite loop).",
        exitCode: 124,
        executionTimeMs: Date.now() - startedAt,
      });
    }, 5000);

    worker.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const d = event.data || {};
      resolve({
        language: "javascript",
        executed: true,
        executionMode: "worker_sandbox",
        status: d.status || "success",
        stdout: d.stdout || "",
        stderr: d.stderr || "",
        exitCode: d.exitCode ?? 0,
        executionTimeMs: Date.now() - startedAt,
      });
    };

    worker.onerror = (ev) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve({
        language: "javascript",
        executed: true,
        executionMode: "worker_sandbox",
        status: "runtime_error",
        stdout: "",
        stderr: ev.message || "JavaScript sandbox execution error.",
        exitCode: 1,
        executionTimeMs: Date.now() - startedAt,
      });
    };

    worker.postMessage({ code, stdin });
  });
};

export const executePlaygroundCodeClient = async (payload: {
  language: ProgrammingLanguage;
  code: string;
  stdin: string;
  lessonId?: string | null;
  preferWorkerForJs?: boolean;
}): Promise<{ result: CodeExecutionResult; submission: CodeSubmissionRecord | null }> => {
  if (payload.language === "javascript" && payload.preferWorkerForJs !== false) {
    const result = await runJavaScriptInWorkerSandbox(payload.code, payload.stdin);
    const saved = await fetchWithAuth<{ submission: CodeSubmissionRecord }>(
      "/api/playground/submissions",
      {
        method: "POST",
        body: JSON.stringify({
          lessonId: payload.lessonId || null,
          language: "javascript",
          code: payload.code,
          stdin: payload.stdin,
          stdout: result.stdout,
          stderr: result.stderr,
          status: result.status,
          executionTimeMs: result.executionTimeMs,
          markCompleted: result.status === "success",
        }),
      },
      "Could not save execution result."
    );
    return { result, submission: saved.submission };
  }

  return fetchWithAuth<{ result: CodeExecutionResult; submission: CodeSubmissionRecord | null }>(
    "/api/playground/execute",
    {
      method: "POST",
      body: JSON.stringify({
        language: payload.language,
        code: payload.code,
        stdin: payload.stdin,
        lessonId: payload.lessonId || null,
      }),
    },
    "Code execution failed."
  );
};

export const requestPlaygroundAiHelpClient = async (payload: {
  language: ProgrammingLanguage;
  code: string;
  stderr?: string;
  stdout?: string;
  action: PlaygroundHelpAction;
  profileId: string;
  question?: string;
}): Promise<PlaygroundHelpResponse> => {
  return fetchWithAuth<PlaygroundHelpResponse>(
    "/api/playground/ai-help",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "AI Mentor help unavailable."
  );
};
