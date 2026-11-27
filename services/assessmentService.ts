import type {
  AdaptiveDecision,
  GenerateAssessmentRequest,
  GenerateAssessmentResponse,
  LearnerOverviewResponse,
  PostAssessmentSummary,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
} from "../types";

const REQUEST_TIMEOUT_MS = 45_000;

// Held strictly in JS memory (never stored in localStorage or sessionStorage)
let inMemoryBearerToken: string | null = null;
let sessionInitPromise: Promise<string> | null = null;
const inFlightOps = new Map<string, Promise<any>>();

export const getSharedBearerToken = (): string | null => inMemoryBearerToken;

export const setSharedBearerToken = (token: string | null) => {
  inMemoryBearerToken = token;
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out.")), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      credentials: "same-origin",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

export const ensureLearnerSession = async (): Promise<string> => {
  if (inMemoryBearerToken) return inMemoryBearerToken;
  if (sessionInitPromise) return sessionInitPromise;

  sessionInitPromise = (async () => {
    const res = await fetchWithTimeout("/api/assessment/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      throw new Error(data?.error || "Could not initialize learner session.");
    }
    inMemoryBearerToken = data.token;
    return data.token as string;
  })().finally(() => {
    sessionInitPromise = null;
  });

  return sessionInitPromise;
};

const authFetchJson = async <T>(
  url: string,
  options: RequestInit,
  fallbackError: string
): Promise<T> => {
  const token = await ensureLearnerSession();
  const res = await fetchWithTimeout(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  // If session expired/invalid on server restart, renew once cleanly
  if (res.status === 401) {
    inMemoryBearerToken = null;
    const freshToken = await ensureLearnerSession();
    const retryRes = await fetchWithTimeout(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshToken}`,
        ...(options.headers || {}),
      },
    });
    const retryData = await retryRes.json().catch(() => ({}));
    if (!retryRes.ok) {
      throw new Error(retryData?.error || fallbackError);
    }
    return retryData as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || fallbackError);
  }
  return data as T;
};

export const generateAdaptiveAssessment = async (
  req: GenerateAssessmentRequest
): Promise<GenerateAssessmentResponse> => {
  const dedupeKey = `gen:${req.concept.trim().toLowerCase()}:${req.assessmentType}:${req.profileId}`;
  const existing = inFlightOps.get(dedupeKey);
  if (existing) return existing;

  const task = authFetchJson<GenerateAssessmentResponse>(
    "/api/assessment/generate",
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    "Failed to generate assessment."
  ).finally(() => {
    inFlightOps.delete(dedupeKey);
  });

  inFlightOps.set(dedupeKey, task);
  return task;
};

export const submitAssessmentAnswerClient = async (
  req: SubmitAnswerRequest
): Promise<SubmitAnswerResponse> => {
  const dedupeKey = `sub:${req.attemptId}:${req.questionId}`;
  const existing = inFlightOps.get(dedupeKey);
  if (existing) return existing;

  const task = authFetchJson<SubmitAnswerResponse>(
    "/api/assessment/submit",
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    "Failed to evaluate answer."
  ).finally(() => {
    inFlightOps.delete(dedupeKey);
  });

  inFlightOps.set(dedupeKey, task);
  return task;
};

export const completeAssessmentClient = async (
  attemptId: string
): Promise<PostAssessmentSummary> => {
  const dedupeKey = `comp:${attemptId}`;
  const existing = inFlightOps.get(dedupeKey);
  if (existing) return existing;

  const task = authFetchJson<PostAssessmentSummary>(
    "/api/assessment/complete",
    {
      method: "POST",
      body: JSON.stringify({ attemptId }),
    },
    "Failed to complete assessment."
  ).finally(() => {
    inFlightOps.delete(dedupeKey);
  });

  inFlightOps.set(dedupeKey, task);
  return task;
};

export const abandonAssessmentClient = async (attemptId: string): Promise<void> => {
  await authFetchJson(
    "/api/assessment/abandon",
    {
      method: "POST",
      body: JSON.stringify({ attemptId }),
    },
    "Failed to close assessment."
  );
};

export const getAdaptiveDecisionClient = async (concept: string): Promise<AdaptiveDecision> => {
  const encoded = encodeURIComponent(concept.trim());
  return authFetchJson<AdaptiveDecision>(
    `/api/assessment/adapt?concept=${encoded}`,
    { method: "GET" },
    "Failed to fetch adaptive learning status."
  );
};

export const getLearnerOverviewClient = async (): Promise<LearnerOverviewResponse> => {
  return authFetchJson<LearnerOverviewResponse>(
    "/api/assessment/overview",
    { method: "GET" },
    "Failed to load mastery overview."
  );
};
