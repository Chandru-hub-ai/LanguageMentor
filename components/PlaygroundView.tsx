import React, { useEffect, useState } from 'react';
import type {
  CodeExecutionResult,
  CodeSubmissionRecord,
  LanguageCapability,
  PlaygroundHelpAction,
  PlaygroundHelpResponse,
  ProgrammingLanguage,
  ProgrammingLesson,
} from '../types';
import {
  executePlaygroundCodeClient,
  getCapabilitiesClient,
  getPlaygroundLessonsClient,
  requestPlaygroundAiHelpClient,
} from '../services/platformService';
import { LANGUAGE_PROFILES } from '../constants';

interface PlaygroundViewProps {
  activeProfileId: string;
  initialCode?: string | null;
  initialLanguage?: ProgrammingLanguage | null;
  selectedLesson?: ProgrammingLesson | null;
  onSubmissionRecorded?: () => void;
}

const STARTER_TEMPLATES: Record<ProgrammingLanguage, string> = {
  javascript: `// Isolated Web Worker Sandbox — runs right in your browser\nfunction calculateAverage(scores) {\n  const total = scores.reduce((sum, s) => sum + s, 0);\n  return (total / scores.length).toFixed(2);\n}\n\nconst marks = [78, 84, 92, 69];\nconsole.log("Student marks:", marks);\nconsole.log("Average:", calculateAverage(marks));\n`,
  python: `# Python Practice\ndef classify_mastery(score):\n    if score >= 80:\n        return "Strong Understanding"\n    elif score >= 60:\n        return "Functional Understanding"\n    return "Needs Practice"\n\nprint(classify_mastery(86))\n`,
  java: `public class Main {\n    public static void main(String[] args) {\n        int[] marks = {80, 90, 75};\n        int total = 0;\n        for (int m : marks) {\n            total += m;\n        }\n        System.out.println("Total = " + total);\n    }\n}\n`,
  c: `#include <stdio.h>\n\nint main() {\n    int a = 12, b = 8;\n    printf("Sum = %d\\n", a + b);\n    return 0;\n}\n`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    int n = 5;\n    cout << "Square = " << n * n << endl;\n    return 0;\n}\n`,
};

const PlaygroundView: React.FC<PlaygroundViewProps> = ({
  activeProfileId,
  initialCode,
  initialLanguage,
  selectedLesson,
  onSubmissionRecorded,
}) => {
  const [lessons, setLessons] = useState<ProgrammingLesson[]>([]);
  const [capabilities, setCapabilities] = useState<LanguageCapability[]>([]);
  const [activeLesson, setActiveLesson] = useState<ProgrammingLesson | null>(selectedLesson || null);
  const [language, setLanguage] = useState<ProgrammingLanguage>(
    selectedLesson?.language || initialLanguage || 'javascript'
  );
  const [code, setCode] = useState<string>(
    selectedLesson?.lastCode || selectedLesson?.starterCode || initialCode || STARTER_TEMPLATES.javascript
  );
  const [stdin, setStdin] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [execResult, setExecResult] = useState<CodeExecutionResult | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<CodeSubmissionRecord[]>([]);
  const [outputTab, setOutputTab] = useState<'output' | 'stdin' | 'history'>('output');
  const [copied, setCopied] = useState(false);

  // Hints & Solution reveal state
  const [revealedHintsCount, setRevealedHintsCount] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  // AI Mentor panel
  const [aiHelpLoading, setAiHelpLoading] = useState(false);
  const [aiHelpResult, setAiHelpResult] = useState<PlaygroundHelpResponse | null>(null);
  const [aiHelpError, setAiHelpError] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiLangView, setAiLangView] = useState<'regional' | 'english'>('regional');

  const profile = LANGUAGE_PROFILES.find((p) => p.id === activeProfileId);

  useEffect(() => {
    Promise.all([getPlaygroundLessonsClient(), getCapabilitiesClient()])
      .then(([lsns, caps]) => {
        setLessons(lsns);
        setCapabilities(caps);
      })
      .catch(() => {
        // Non-blocking
      });
  }, []);

  useEffect(() => {
    if (selectedLesson) {
      setActiveLesson(selectedLesson);
      setLanguage(selectedLesson.language);
      setCode(selectedLesson.lastCode || selectedLesson.starterCode);
      setRevealedHintsCount(0);
      setShowSolution(false);
      setExecResult(null);
      setAiHelpResult(null);
    }
  }, [selectedLesson]);

  useEffect(() => {
    if (initialCode) {
      setActiveLesson(null);
      setLanguage(initialLanguage || 'javascript');
      setCode(initialCode);
      setExecResult(null);
    }
  }, [initialCode, initialLanguage]);

  const activeCapability = capabilities.find((c) => c.language === language);

  const handleLanguageChange = (nextLang: ProgrammingLanguage) => {
    setLanguage(nextLang);
    setActiveLesson(null);
    setCode(STARTER_TEMPLATES[nextLang]);
    setExecResult(null);
    setAiHelpResult(null);
    setRevealedHintsCount(0);
    setShowSolution(false);
  };

  const handleSelectLesson = (lesson: ProgrammingLesson) => {
    setActiveLesson(lesson);
    setLanguage(lesson.language);
    setCode(lesson.lastCode || lesson.starterCode);
    setExecResult(null);
    setAiHelpResult(null);
    setRevealedHintsCount(0);
    setShowSolution(false);
  };

  const handleRunCode = async () => {
    if (isRunning || !code.trim()) return;
    setIsRunning(true);
    setOutputTab('output');
    try {
      const { result, submission } = await executePlaygroundCodeClient({
        language,
        code,
        stdin,
        lessonId: activeLesson?.id || null,
      });
      setExecResult(result);
      if (submission) {
        setRecentSubmissions((prev) => [submission, ...prev].slice(0, 10));
        onSubmissionRecorded?.();
      }
      if (result.status === 'success' && activeLesson) {
        setLessons((prev) =>
          prev.map((l) => (l.id === activeLesson.id ? { ...l, status: 'completed' } : l))
        );
      }
    } catch (err: any) {
      setExecResult({
        language,
        executed: false,
        executionMode: 'unconfigured',
        status: 'runtime_error',
        stdout: '',
        stderr: err?.message || 'Execution request failed.',
        executionTimeMs: 0,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setCode(activeLesson ? activeLesson.starterCode : STARTER_TEMPLATES[language]);
    setExecResult(null);
    setRevealedHintsCount(0);
    setShowSolution(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const handleAskAi = async (action: PlaygroundHelpAction, customQ?: string) => {
    if (aiHelpLoading || !code.trim()) return;
    setAiHelpLoading(true);
    setAiHelpError(null);
    try {
      const res = await requestPlaygroundAiHelpClient({
        language,
        code,
        stderr: execResult?.stderr,
        stdout: execResult?.stdout,
        action,
        profileId: activeProfileId,
        question: customQ,
      });
      setAiHelpResult(res);
      if (res.suggestedChallenge && action === 'challenge') {
        setActiveLesson({
          id: `ai_chal_${Date.now()}`,
          track: language === 'java' ? 'java' : language === 'python' ? 'python' : 'javascript',
          order: 99,
          title: res.suggestedChallenge.title,
          conceptId: 'algorithm',
          language,
          summary: res.suggestedChallenge.prompt,
          expectedGoal: res.suggestedChallenge.prompt,
          starterCode: res.suggestedChallenge.starterCode,
          hints: res.suggestedChallenge.hints || [],
          sampleSolution: '',
          difficulty: 'beginner',
        });
        setCode(res.suggestedChallenge.starterCode);
        setRevealedHintsCount(0);
        setShowSolution(false);
      }
    } catch (err: any) {
      setAiHelpError(err?.message || 'AI Mentor failed to respond.');
    } finally {
      setAiHelpLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header + Track Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Programming Playground & Guided Labs
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Write, run in an isolated sandbox, and learn Python, Java, JavaScript, C, or C++ with bilingual AI mentoring.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['javascript', 'python', 'java', 'c', 'cpp'] as ProgrammingLanguage[]).map((lang) => (
            <button
              key={lang}
              onClick={() => handleLanguageChange(lang)}
              className={`px-4 py-2 rounded-full text-xs font-ui font-semibold uppercase tracking-wider transition-colors border ${
                language === lang ? 'lm-tab-active' : 'lm-btn-outline'
              }`}
              style={language === lang ? undefined : { color: 'var(--text-secondary)' }}
            >
              {lang === 'cpp' ? 'C++' : lang}
            </button>
          ))}
        </div>
      </div>

      {/* Execution Mode Banner */}
      {activeCapability && !activeCapability.available && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div style={{ color: 'var(--text-secondary)' }}>
            <strong className="text-amber-400">Sandbox Notice ({activeCapability.label}): </strong>
            {activeCapability.note}
          </div>
          <button
            onClick={() => handleLanguageChange('javascript')}
            className="px-3.5 py-1.5 rounded-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold shrink-0"
          >
            Try Live JS Worker Sandbox
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Guided Lessons Track */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="lm-surface rounded-2xl p-4 space-y-3">
            <div className="text-xs font-ui font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Beginner Lesson Tracks
            </div>
            <div className="space-y-2">
              {lessons.map((lesson) => {
                const isSelected = activeLesson?.id === lesson.id;
                return (
                  <button
                    key={lesson.id}
                    onClick={() => handleSelectLesson(lesson)}
                    className={`w-full p-3 rounded-xl text-left border transition-colors ${
                      isSelected ? 'lm-accent-soft' : 'lm-inset hover:border-white/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider">
                      <span className="lm-accent-text">{lesson.language}</span>
                      {lesson.status === 'completed' && (
                        <span className="lm-accent-text">Completed</span>
                      )}
                    </div>
                    <div className="text-xs font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>
                      {lesson.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Lesson Goal + Progressive Hints */}
          {activeLesson && (
            <div className="lm-surface rounded-2xl p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider lm-accent-text">
                Challenge Goal
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {activeLesson.expectedGoal}
              </p>

              {activeLesson.hints.length > 0 && (
                <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  {activeLesson.hints.slice(0, revealedHintsCount).map((h, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg lm-inset text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <strong className="lm-accent-text">Hint {idx + 1}: </strong>
                      {h}
                    </div>
                  ))}
                  {revealedHintsCount < activeLesson.hints.length && (
                    <button
                      onClick={() => setRevealedHintsCount((c) => c + 1)}
                      className="w-full py-2 rounded-full lm-btn-outline text-xs font-medium"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Reveal Hint ({revealedHintsCount + 1}/{activeLesson.hints.length})
                    </button>
                  )}
                </div>
              )}

              {activeLesson.sampleSolution && (
                <div className="pt-1">
                  {!showSolution ? (
                    <button
                      onClick={() => setShowSolution(true)}
                      className="w-full py-2 rounded-lg text-xs font-semibold text-amber-400 hover:underline"
                    >
                      Reveal Reference Solution
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <pre className="p-2.5 rounded-lg bg-[#050507] border border-white/10 text-zinc-200 text-[11px] font-mono overflow-x-auto">
                        {activeLesson.sampleSolution}
                      </pre>
                      <button
                        onClick={() => setCode(activeLesson.sampleSolution)}
                        className="w-full py-1.5 rounded-full lm-accent-soft text-xs font-semibold"
                      >
                        Load into Editor
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Center: Editor + Console */}
        <div className="lg:col-span-5 space-y-4">
          <div className="lm-surface rounded-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="text-xs font-mono font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                {language === 'java' ? 'Main.java' : language === 'python' ? 'main.py' : language === 'c' ? 'main.c' : language === 'cpp' ? 'main.cpp' : 'main.js'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-full lm-btn-outline text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 rounded-full lm-btn-outline text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Reset
                </button>
                <button
                  onClick={handleRunCode}
                  disabled={isRunning}
                  className="px-4 py-1.5 rounded-full lm-btn-primary text-xs font-semibold flex items-center gap-1.5 disabled:opacity-45"
                >
                  {isRunning ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-play"></i>}
                  <span>Run Code</span>
                </button>
              </div>
            </div>

            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              rows={15}
              aria-label="Code editor"
              className="w-full p-4 bg-[#050507] text-zinc-100 font-mono text-xs sm:text-sm leading-relaxed outline-none resize-y min-h-[300px]"
            />
          </div>

          {/* Output / Stdin / History Console */}
          <div className="lm-surface rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center gap-1">
                {(['output', 'stdin', 'history'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOutputTab(t)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
                      outputTab === t ? 'lm-tab-active' : ''
                    }`}
                    style={outputTab === t ? undefined : { color: 'var(--text-muted)' }}
                  >
                    {t === 'stdin' ? 'Stdin Input' : t}
                  </button>
                ))}
              </div>
              {execResult && (
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span
                    className={`font-bold uppercase ${
                      execResult.status === 'success'
                        ? 'lm-accent-text'
                        : execResult.status === 'unconfigured'
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {execResult.status.replace('_', ' ')}
                  </span>
                  <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{execResult.executionTimeMs}ms</span>
                </div>
              )}
            </div>

            <div className="p-4 min-h-[150px] max-h-[260px] overflow-y-auto bg-[#050507] text-xs font-mono">
              {outputTab === 'stdin' && (
                <textarea
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  rows={4}
                  placeholder="Optional standard input lines..."
                  className="w-full bg-transparent text-zinc-200 outline-none resize-none"
                />
              )}

              {outputTab === 'output' && (
                <>
                  {!execResult ? (
                    <div className="text-zinc-500">
                      Click Run Code to execute. Output, stderr, and execution status appear here.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {execResult.message && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 font-sans">
                          {execResult.message}
                        </div>
                      )}
                      {execResult.stdout && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Stdout</div>
                          <pre className="text-[#39FF14] whitespace-pre-wrap">{execResult.stdout}</pre>
                        </div>
                      )}
                      {execResult.stderr && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1">Stderr / Error</div>
                          <pre className="text-red-300 whitespace-pre-wrap">{execResult.stderr}</pre>
                          <button
                            onClick={() => handleAskAi('explain_error')}
                            className="mt-2 px-3.5 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-300 font-sans text-xs font-semibold"
                          >
                            Ask AI to Explain This Error
                          </button>
                        </div>
                      )}
                      {!execResult.stdout && !execResult.stderr && !execResult.message && (
                        <div className="text-zinc-400">Program exited cleanly with no console output.</div>
                      )}
                    </div>
                  )}
                </>
              )}

              {outputTab === 'history' && (
                <div className="space-y-2 font-sans">
                  {recentSubmissions.length === 0 ? (
                    <div className="text-zinc-500">No runs recorded in this session yet.</div>
                  ) : (
                    recentSubmissions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setLanguage(s.language);
                          setCode(s.code);
                        }}
                        className="w-full p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-left flex items-center justify-between"
                      >
                        <span className="text-white font-semibold uppercase">{s.language}</span>
                        <span className="text-zinc-400 font-mono tabular-nums">
                          {s.status} • {s.executionTimeMs}ms
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: AI Code Mentor Panel */}
        <aside className="lg:col-span-4 lm-surface rounded-2xl p-5 flex flex-col space-y-4">
          <div>
            <h2 className="font-display font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              AI Coding Mentor
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Multilingual explanations ({profile?.name}) tailored to your code and errors.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['explain_code', 'Explain Code'],
                ['line_by_line', 'Line-by-Line'],
                ['explain_error', 'Explain Error'],
                ['hint', 'Guided Hint'],
                ['simplify', 'Simplify'],
                ['challenge', 'New Challenge'],
              ] as Array<[PlaygroundHelpAction, string]>
            ).map(([action, label]) => (
              <button
                key={action}
                onClick={() => handleAskAi(action)}
                disabled={aiHelpLoading}
                className="px-3 py-2 rounded-full lm-btn-outline text-xs font-medium disabled:opacity-45"
                style={{ color: 'var(--text-secondary)' }}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (aiQuestion.trim()) {
                handleAskAi('explain_code', aiQuestion.trim());
                setAiQuestion('');
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder="Ask about a line or bug..."
              className="flex-1 px-4 py-2 rounded-full lm-inset lm-input text-xs outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              type="submit"
              disabled={aiHelpLoading || !aiQuestion.trim()}
              className="px-4 py-2 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45"
            >
              Ask
            </button>
          </form>

          {aiHelpError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-400">
              {aiHelpError}
            </div>
          )}

          <div className="flex-1 min-h-[220px] rounded-xl lm-inset p-4 overflow-y-auto">
            {aiHelpLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 w-3/4 rounded bg-white/10"></div>
                <div className="h-3 w-full rounded bg-white/5"></div>
                <div className="h-3 w-5/6 rounded bg-white/5"></div>
              </div>
            ) : aiHelpResult ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="text-[11px] font-bold uppercase tracking-wider lm-accent-text">
                    {aiHelpResult.action.replace('_', ' ')}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setAiLangView('regional')}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        aiLangView === 'regional' ? 'lm-tab-active' : ''
                      }`}
                      style={aiLangView === 'regional' ? undefined : { color: 'var(--text-muted)' }}
                    >
                      {profile?.lang === 'english' ? 'Intuitive' : profile?.name || 'Regional'}
                    </button>
                    <button
                      onClick={() => setAiLangView('english')}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        aiLangView === 'english' ? 'lm-tab-active' : ''
                      }`}
                      style={aiLangView === 'english' ? undefined : { color: 'var(--text-muted)' }}
                    >
                      English
                    </button>
                  </div>
                </div>
                <div
                  className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap tamil-text"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {aiLangView === 'regional' ? aiHelpResult.regional : aiHelpResult.english}
                </div>
              </div>
            ) : (
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Select an action above to inspect your code line-by-line, get progressive hints, or understand any compiler/runtime error in {profile?.name || 'your language'}.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default PlaygroundView;
