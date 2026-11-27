import type { CodeExecutionResult, LanguageCapability, ProgrammingLanguage } from "../types.ts";

const VALID_LANGUAGES = new Set<ProgrammingLanguage>(["javascript", "python", "java", "c", "cpp"]);
const MAX_CODE_BYTES = 32_768;
const MAX_STDIN_BYTES = 8_192;
const REMOTE_EXEC_TIMEOUT_MS = 10_000;

const PISTON_RUNTIME_MAP: Record<Exclude<ProgrammingLanguage, "javascript">, { language: string; version: string; fileName: string }> = {
  python: { language: "python", version: "*", fileName: "main.py" },
  java: { language: "java", version: "*", fileName: "Main.java" },
  c: { language: "c", version: "*", fileName: "main.c" },
  cpp: { language: "c++", version: "*", fileName: "main.cpp" },
};

export const isValidLanguage = (lang: unknown): lang is ProgrammingLanguage =>
  typeof lang === "string" && VALID_LANGUAGES.has(lang as ProgrammingLanguage);

export const getExecutionCapabilities = (): LanguageCapability[] => {
  const remoteConfigured = Boolean(process.env.CODE_EXECUTION_API_URL?.trim());

  return [
    {
      language: "javascript",
      label: "JavaScript (ES2022)",
      available: true,
      executionMode: "worker_sandbox",
      note: "Runs inside an isolated browser Web Worker sandbox (no DOM/network access, 5s timeout).",
    },
    {
      language: "python",
      label: "Python 3",
      available: remoteConfigured,
      executionMode: remoteConfigured ? "remote_sandbox" : "ai_trace_only",
      note: remoteConfigured
        ? "Executes in isolated remote sandbox service."
        : "Remote sandbox (CODE_EXECUTION_API_URL) not configured. Use AI Code Trace or configure Settings > Secrets.",
    },
    {
      language: "java",
      label: "Java (JDK)",
      available: remoteConfigured,
      executionMode: remoteConfigured ? "remote_sandbox" : "ai_trace_only",
      note: remoteConfigured
        ? "Executes in isolated remote sandbox service."
        : "Remote sandbox (CODE_EXECUTION_API_URL) not configured. Use AI Code Trace or configure Settings > Secrets.",
    },
    {
      language: "c",
      label: "C (GCC)",
      available: remoteConfigured,
      executionMode: remoteConfigured ? "remote_sandbox" : "ai_trace_only",
      note: remoteConfigured
        ? "Executes in isolated remote sandbox service."
        : "Remote sandbox (CODE_EXECUTION_API_URL) not configured. Use AI Code Trace or configure Settings > Secrets.",
    },
    {
      language: "cpp",
      label: "C++ (G++)",
      available: remoteConfigured,
      executionMode: remoteConfigured ? "remote_sandbox" : "ai_trace_only",
      note: remoteConfigured
        ? "Executes in isolated remote sandbox service."
        : "Remote sandbox (CODE_EXECUTION_API_URL) not configured. Use AI Code Trace or configure Settings > Secrets.",
    },
  ];
};

export const validateCodeSubmission = (
  language: unknown,
  code: unknown,
  stdin: unknown
): { language: ProgrammingLanguage; code: string; stdin: string } => {
  if (!isValidLanguage(language)) {
    throw Object.assign(new Error("Unsupported language selected."), { status: 400 });
  }
  if (typeof code !== "string" || !code.trim()) {
    throw Object.assign(new Error("Source code cannot be empty."), { status: 400 });
  }
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    throw Object.assign(new Error("Source code exceeds the 32KB safety limit."), { status: 400 });
  }
  const safeStdin = typeof stdin === "string" ? stdin : "";
  if (Buffer.byteLength(safeStdin, "utf8") > MAX_STDIN_BYTES) {
    throw Object.assign(new Error("Standard input exceeds the 8KB limit."), { status: 400 });
  }
  return { language, code, stdin: safeStdin };
};

/**
 * Proxies code execution safely to an external isolated sandbox API (e.g. Piston).
 * Never executes arbitrary untrusted code directly inside the Express server process.
 */
export const executeViaRemoteSandbox = async (
  language: ProgrammingLanguage,
  code: string,
  stdin: string
): Promise<CodeExecutionResult> => {
  const apiUrl = process.env.CODE_EXECUTION_API_URL?.trim();
  const apiKey = process.env.CODE_EXECUTION_API_KEY?.trim();

  if (!apiUrl) {
    return {
      language,
      executed: false,
      executionMode: "unconfigured",
      status: "unconfigured",
      stdout: "",
      stderr: "",
      exitCode: null,
      executionTimeMs: 0,
      message:
        language === "javascript"
          ? "JavaScript runs directly inside the isolated browser Web Worker sandbox."
          : `Remote execution sandbox is not configured for ${language.toUpperCase()}. Configure CODE_EXECUTION_API_URL in Settings > Secrets to enable remote compiled execution, or use AI Code Help / JavaScript sandbox.`,
    };
  }

  const runtime =
    language === "javascript"
      ? { language: "javascript", version: "*", fileName: "main.js" }
      : PISTON_RUNTIME_MAP[language];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_EXEC_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: runtime.fileName, content: code }],
        stdin,
        run_timeout: 5000,
        compile_timeout: 8000,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as any;
    const elapsed = Date.now() - startedAt;

    if (!response.ok) {
      return {
        language,
        executed: false,
        executionMode: "remote_sandbox",
        status: "runtime_error",
        stdout: "",
        stderr: payload?.message || `Sandbox service returned HTTP ${response.status}.`,
        exitCode: 1,
        executionTimeMs: elapsed,
      };
    }

    if (payload?.compile && payload.compile.code !== 0) {
      return {
        language,
        executed: true,
        executionMode: "remote_sandbox",
        status: "compile_error",
        stdout: (payload.compile.stdout || "").slice(0, 16_000),
        stderr: (payload.compile.stderr || payload.compile.output || "Compilation error").slice(0, 16_000),
        exitCode: payload.compile.code ?? 1,
        executionTimeMs: elapsed,
      };
    }

    const run = payload?.run || payload;
    const stdout = String(run?.stdout || "").slice(0, 16_000);
    const stderr = String(run?.stderr || "").slice(0, 16_000);
    const exitCode = typeof run?.code === "number" ? run.code : 0;

    return {
      language,
      executed: true,
      executionMode: "remote_sandbox",
      status: exitCode === 0 && !stderr ? "success" : run?.signal === "SIGKILL" ? "timeout" : exitCode !== 0 ? "runtime_error" : "success",
      stdout,
      stderr,
      exitCode,
      executionTimeMs: elapsed,
    };
  } catch (err: any) {
    return {
      language,
      executed: false,
      executionMode: "remote_sandbox",
      status: err?.name === "AbortError" ? "timeout" : "runtime_error",
      stdout: "",
      stderr: err?.name === "AbortError" ? "Execution timed out." : err?.message || "Sandbox request failed.",
      exitCode: 1,
      executionTimeMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
};
