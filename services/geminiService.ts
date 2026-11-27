import type {
  DiagramSpec,
  Explanation,
  ExplanationMeta,
  SessionContextPayload,
  SessionTurnSummary,
  TeachingMode,
} from "../types";
import { getSharedBearerToken } from "./assessmentService";

export interface ExplainClientOptions {
  explicitMode?: TeachingMode;
  followUpQuestion?: string;
  previousTerm?: string;
  previousSummary?: string;
  simplify?: boolean;
  includeDiagram?: boolean;
}

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TRANSIENT_RETRIES = 2;

let activeExplainController: AbortController | null = null;
const inFlightRequests = new Map<string, Promise<any>>();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request cancelled.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const isRetryableError = (err: unknown): boolean => {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof HttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network failures (TypeError from fetch) are retryable
  return err instanceof TypeError;
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out.")), timeoutMs);

  const forwardAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
};

const postJson = async <T>(
  url: string,
  body: unknown,
  fallbackError: string,
  signal?: AbortSignal
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Request cancelled.", "AbortError");
    }

    try {
      const token = getSharedBearerToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_MS,
        signal
      );

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON response
      }

      if (!response.ok) {
        throw new HttpError(response.status, data?.error || fallbackError);
      }

      if (!data || typeof data !== "object") {
        throw new Error("Invalid response received from server.");
      }

      return data as T;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_TRANSIENT_RETRIES && isRetryableError(err)) {
        const baseDelay = err instanceof HttpError && err.status === 429 ? 1500 : 700;
        const backoff = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await sleep(backoff, signal);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
};

export interface ExplanationResult {
  english: string;
  regional: string;
  meta?: ExplanationMeta;
}

/**
 * Builds a bounded, token-efficient session context from recent history
 * without re-sending entire full-text chat transcripts.
 */
export const buildSessionContext = (
  history: Explanation[],
  activeProfileId: string
): SessionContextPayload => {
  // History is stored newest-first in App.tsx
  const recent = history.slice(0, 3).reverse();
  const older = history.slice(3);

  const recentTurns: SessionTurnSummary[] = recent.map((item) => ({
    term: item.term.slice(0, 150),
    topicSummary: (
      item.meta?.topicSummary ||
      item.englishResponse.split("\n")[0]?.replace(/[#*`]/g, "") ||
      item.term
    ).slice(0, 180),
    teachingMode: item.meta?.teachingMode,
    analogyDomain: item.meta?.analogyDomain,
    misconceptionSummary: item.meta?.misconceptionSummary,
  }));

  const olderTopicsSummary = older
    .slice(0, 8)
    .map((item) => item.term.slice(0, 60))
    .join(", ")
    .slice(0, 300);

  const avoidAnalogies = Array.from(
    new Set(
      history
        .slice(0, 6)
        .map((item) => item.meta?.analogyDomain)
        .filter((d): d is string => Boolean(d && d.trim()))
    )
  ).slice(0, 6);

  const sessionMisconceptions = Array.from(
    new Set(
      history
        .slice(0, 5)
        .map((item) => item.meta?.misconceptionSummary)
        .filter((m): m is string => Boolean(m && m.trim()))
    )
  ).slice(0, 4);

  return {
    activeProfileId,
    recentTurns,
    olderTopicsSummary,
    avoidAnalogies,
    sessionMisconceptions,
  };
};

export const cancelActiveExplanation = () => {
  if (activeExplainController) {
    activeExplainController.abort();
    activeExplainController = null;
  }
};

const validateExplanationResult = (data: Partial<ExplanationResult>): ExplanationResult => {
  const english = typeof data.english === "string" ? data.english.trim() : "";
  const regional = typeof data.regional === "string" ? data.regional.trim() : "";
  if (!english || !regional) {
    throw new Error("Incomplete explanation received. Please try again.");
  }
  return {
    english,
    regional,
    meta: data.meta,
  };
};

export const getTechExplanation = async (
  term: string,
  profileId: string,
  sessionContext?: SessionContextPayload,
  signal?: AbortSignal,
  options?: ExplainClientOptions
): Promise<ExplanationResult> => {
  const modeKey = options?.explicitMode || "auto";
  const dedupeKey = `explain:${profileId}:${modeKey}:${Boolean(options?.simplify)}:${options?.followUpQuestion || ""}:${term.trim().toLowerCase()}`;
  const existing = inFlightRequests.get(dedupeKey);
  if (existing) {
    return existing;
  }

  const requestPromise = postJson<ExplanationResult>(
    "/api/gemini/explain",
    { term, profileId, sessionContext, options },
    "Mentor is temporarily offline. Please try again.",
    signal
  )
    .then(validateExplanationResult)
    .finally(() => {
      inFlightRequests.delete(dedupeKey);
    });

  inFlightRequests.set(dedupeKey, requestPromise);
  return requestPromise;
};

export interface StreamCallbacks {
  onMeta?: (meta: ExplanationMeta) => void;
  onUpdate: (partial: { english: string; regional: string; meta?: ExplanationMeta }) => void;
}

export const getTechExplanationStream = async (
  term: string,
  profileId: string,
  callbacks: StreamCallbacks,
  sessionContext?: SessionContextPayload,
  options?: ExplainClientOptions
): Promise<ExplanationResult> => {
  cancelActiveExplanation();
  const controller = new AbortController();
  activeExplainController = controller;

  let hasEmittedUpdate = false;
  let latestMeta: ExplanationMeta | undefined;
  let latestEnglish = "";
  let latestRegional = "";

  try {
    const token = getSharedBearerToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchWithTimeout(
      "/api/gemini/explain/stream",
      {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ term, profileId, sessionContext, options }),
      },
      55_000,
      controller.signal
    );

    if (!response.ok || !response.body) {
      let errMsg = "Mentor is temporarily offline. Please try again.";
      try {
        const errJson = await response.json();
        if (errJson?.error) errMsg = errJson.error;
      } catch {
        // Ignore parse failure
      }
      throw new HttpError(response.status, errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: ExplanationResult | null = null;

    const processEventBlock = (block: string) => {
      const lines = block.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (dataLines.length === 0) return;
      const rawData = dataLines.join("\n");
      const parsed = JSON.parse(rawData);

      if (eventName === "meta") {
        latestMeta = parsed as ExplanationMeta;
        callbacks.onMeta?.(latestMeta);
      } else if (eventName === "chunk") {
        latestEnglish = typeof parsed.english === "string" ? parsed.english : latestEnglish;
        latestRegional = typeof parsed.regional === "string" ? parsed.regional : latestRegional;
        hasEmittedUpdate = true;
        callbacks.onUpdate({
          english: latestEnglish,
          regional: latestRegional,
          meta: latestMeta,
        });
      } else if (eventName === "done") {
        finalPayload = validateExplanationResult(parsed);
        latestMeta = finalPayload.meta || latestMeta;
        callbacks.onUpdate({
          english: finalPayload.english,
          regional: finalPayload.regional,
          meta: latestMeta,
        });
      } else if (eventName === "error") {
        throw new HttpError(parsed?.status || 500, parsed?.error || "Mentor stream error.");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx !== -1) {
        const block = buffer.slice(0, sepIdx).trim();
        buffer = buffer.slice(sepIdx + 2);
        if (block) {
          processEventBlock(block);
        }
        sepIdx = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim()) {
      processEventBlock(buffer.trim());
    }

    if (finalPayload) {
      return finalPayload;
    }

    if (latestEnglish.trim() && latestRegional.trim()) {
      return {
        english: latestEnglish.trim(),
        regional: latestRegional.trim(),
        meta: latestMeta,
      };
    }

    throw new Error("Stream ended before complete explanation was received.");
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    // Graceful fallback to structured JSON endpoint if streaming failed before first render
    if (!hasEmittedUpdate && !(err instanceof HttpError && err.status === 400)) {
      const fallback = await getTechExplanation(term, profileId, sessionContext, controller.signal, options);
      callbacks.onUpdate({
        english: fallback.english,
        regional: fallback.regional,
        meta: fallback.meta,
      });
      return fallback;
    }
    throw err;
  } finally {
    if (activeExplainController === controller) {
      activeExplainController = null;
    }
  }
};

export const analyzeImage = async (
  base64Image: string,
  profileId: string,
  mimeType: string = "image/jpeg",
  sessionContext?: SessionContextPayload
): Promise<ExplanationResult> => {
  const result = await postJson<ExplanationResult>(
    "/api/gemini/analyze-image",
    { image: base64Image, mimeType, profileId, sessionContext },
    "Image analysis failed."
  );
  return validateExplanationResult(result);
};

export const generateConceptDiagramClient = async (concept: string): Promise<DiagramSpec> => {
  const res = await postJson<{ diagram: DiagramSpec }>(
    "/api/gemini/diagram",
    { concept },
    "Diagram generation failed."
  );
  return res.diagram;
};

/**
 * Generates speech for the full topic via the server-side Gemini TTS route.
 * Deduplicates concurrent identical speech requests to prevent duplicate API calls.
 */
export const generateSpeech = async (text: string): Promise<string> => {
  const key = `speech:${text.trim().slice(0, 200)}:${text.length}`;
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }

  const requestPromise = postJson<{ audio: string }>(
    "/api/gemini/speech",
    { text },
    "Voice generation failed."
  )
    .then((data) => {
      if (!data.audio || typeof data.audio !== "string") {
        throw new Error("Voice generation failed.");
      }
      return data.audio;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, requestPromise);
  return requestPromise;
};

const hasWavHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x52 && // R
  bytes[1] === 0x49 && // I
  bytes[2] === 0x46 && // F
  bytes[3] === 0x46;   // F

/**
 * Returns a Blob URL for a playable/downloadable WAV file.
 */
export function addWavHeader(audioBase64: string, sampleRate: number = 24000): string {
  const audioData = decodeBase64(audioBase64);

  if (hasWavHeader(audioData)) {
    const blob = new Blob([audioData], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = audioData.length;
  const chunkSize = 36 + dataSize;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, chunkSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const blob = new Blob([header, audioData], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const decodeWavFallback = (data: Uint8Array, ctx: AudioContext): AudioBuffer => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let sampleRate = 24000;
  let dataStart = 44;
  let dataLength = Math.max(0, data.byteLength - 44);

  while (offset + 8 <= data.byteLength) {
    const id = String.fromCharCode(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3]
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 8 + 16 <= data.byteLength) {
      sampleRate = view.getUint32(offset + 12, true) || 24000;
    } else if (id === "data") {
      dataStart = offset + 8;
      dataLength = Math.min(size, data.byteLength - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }

  const sampleCount = Math.floor(dataLength / 2);
  const buffer = ctx.createBuffer(1, Math.max(1, sampleCount), sampleRate);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    channelData[i] = view.getInt16(dataStart + i * 2, true) / 32768.0;
  }
  return buffer;
};

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  if (hasWavHeader(data)) {
    try {
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return await ctx.decodeAudioData(arrayBuffer);
    } catch {
      return decodeWavFallback(data, ctx);
    }
  }

  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const buffer = ctx.createBuffer(1, Math.max(1, dataInt16.length), 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}
