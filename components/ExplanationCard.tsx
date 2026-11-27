import React, { useState, useRef, useEffect } from 'react';
import {
  AdaptiveAction,
  AssessmentType,
  DiagramSpec,
  Explanation,
  GenerateAssessmentResponse,
  PostAssessmentSummary,
  ProgrammingLanguage,
  PublicQuestion,
  SubmitAnswerResponse,
  TeachingMode,
} from '../types';
import { LANGUAGE_PROFILES } from '../constants';
import { generateSpeech, addWavHeader, generateConceptDiagramClient } from '../services/geminiService';
import {
  abandonAssessmentClient,
  completeAssessmentClient,
  generateAdaptiveAssessment,
  submitAssessmentAnswerClient,
} from '../services/assessmentService';
import { saveLessonClient } from '../services/platformService';
import CodeBlock from './CodeBlock';
import DiagramRenderer from './DiagramRenderer';

interface ExplanationCardProps {
  explanation: Explanation;
  onPlayAudio?: (text: string, speed: number) => Promise<AudioBufferSourceNode | undefined>;
  onAssessmentComplete?: () => void;
  onTriggerRecommendedAction?: (
    conceptName: string,
    action: AdaptiveAction,
    assessmentType: AssessmentType,
    teachingMode: TeachingMode,
    prereqConceptName?: string
  ) => void;
  onAskFollowUp?: (baseTerm: string, followUpQuestion: string, summary?: string) => void;
  onSwitchMode?: (term: string, mode: TeachingMode, simplify?: boolean) => void;
  onOpenInPlayground?: (code: string, language: ProgrammingLanguage) => void;
  onSavedLesson?: () => void;
}

const ASSESSMENT_TYPE_OPTIONS: Array<{ value: AssessmentType; label: string }> = [
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'adaptive_practice', label: 'Adaptive Practice' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'concept_mastery', label: 'Concept Mastery' },
  { value: 'application', label: 'Application' },
  { value: 'scenario', label: 'Scenario' },
  { value: 'retention', label: 'Retention Check' },
  { value: 'exam_prep', label: 'Exam Prep' },
  { value: 'code', label: 'Code & Logic' },
];

const MODE_SWITCH_OPTIONS: Array<{ mode: TeachingMode; label: string }> = [
  { mode: 'simple_explanation', label: 'Beginner' },
  { mode: 'cultural_analogy', label: 'Analogy' },
  { mode: 'visual_learning', label: 'Visual' },
  { mode: 'step_by_step', label: 'Step-by-Step' },
  { mode: 'practical_application', label: 'Practical' },
  { mode: 'exam_preparation', label: 'Exam' },
  { mode: 'code_explanation', label: 'Code Mode' },
];

type ParsedBlock =
  | { type: 'header'; text: string }
  | { type: 'numbered'; num: string; title: string; body: string }
  | { type: 'bullet'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'paragraph'; text: string };

const parseMarkdownBlocks = (raw: string): ParsedBlock[] => {
  const blocks: ParsedBlock[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', language: lang, code: codeLines.join('\n') });
      continue;
    }

    const headerMatch = /^#{1,6}\s+(.+)$/.exec(trimmed);
    if (headerMatch) {
      blocks.push({ type: 'header', text: headerMatch[1].replace(/\*\*/g, '').trim() });
      i++;
      continue;
    }

    const standaloneBoldHeader = /^(?:\d+\.\s*)?\*\*([^*]{3,70})\*\*:?$/.exec(trimmed);
    if (standaloneBoldHeader && !trimmed.includes(' — ') && !trimmed.includes(' - ')) {
      blocks.push({ type: 'header', text: standaloneBoldHeader[1].trim() });
      i++;
      continue;
    }

    const numberedMatch = /^(\d+)[.)]\s+(?:\*\*(.+?)\*\*:?\s*(.*)|(.+))$/.exec(trimmed);
    if (numberedMatch) {
      const num = numberedMatch[1];
      const title = numberedMatch[2] || '';
      const body = numberedMatch[3] ?? numberedMatch[4] ?? '';
      blocks.push({ type: 'numbered', num, title: title.trim(), body: body.trim() });
      i++;
      continue;
    }

    const bulletMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      blocks.push({ type: 'bullet', text: bulletMatch[1].trim() });
      i++;
      continue;
    }

    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return blocks;
};

const renderInlineFormatting = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold" style={{ color: 'var(--text-primary)' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded lm-accent-soft font-mono text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
};

const getSectionIcon = (title: string): string => {
  const t = title.toLowerCase();
  if (t.includes('definition') || t.includes('what it means') || t.includes('title')) return 'fa-book-open';
  if (t.includes('characteristic') || t.includes('takeaway') || t.includes('feature') || t.includes('point')) return 'fa-list-check';
  if (t.includes('example') || t.includes('analogy') || t.includes('application')) return 'fa-lightbulb';
  if (t.includes('benefit') || t.includes('advantage') || t.includes('why')) return 'fa-star';
  if (t.includes('misconception') || t.includes('mistake')) return 'fa-triangle-exclamation';
  if (t.includes('code') || t.includes('syntax')) return 'fa-code';
  return 'fa-sparkles';
};

const InteractiveMarkdownRenderer: React.FC<{
  content: string;
  regionalFont?: boolean;
  onOpenInPlayground?: (code: string, lang: ProgrammingLanguage) => void;
}> = ({ content, regionalFont, onOpenInPlayground }) => {
  if (!content.trim()) {
    return (
      <div className="space-y-2.5 animate-pulse">
        <div className="h-4 w-2/3 rounded bg-white/10"></div>
        <div className="h-3 w-full rounded bg-white/5"></div>
        <div className="h-3 w-5/6 rounded bg-white/5"></div>
      </div>
    );
  }

  const blocks = parseMarkdownBlocks(content);
  const sections: Array<{ title: string | null; items: ParsedBlock[] }> = [];
  let current: { title: string | null; items: ParsedBlock[] } = { title: null, items: [] };

  for (const b of blocks) {
    if (b.type === 'header') {
      if (current.title !== null || current.items.length > 0) {
        sections.push(current);
      }
      current = { title: b.text, items: [] };
    } else {
      current.items.push(b);
    }
  }
  if (current.title !== null || current.items.length > 0) {
    sections.push(current);
  }

  const renderBlock = (block: ParsedBlock, idx: number) => {
    if (block.type === 'code') {
      return (
        <CodeBlock
          key={idx}
          code={block.code}
          language={block.language}
          onOpenInPlayground={onOpenInPlayground}
        />
      );
    }
    if (block.type === 'numbered') {
      return (
        <div
          key={idx}
          className="flex items-start gap-3 p-3.5 rounded-xl lm-inset my-2"
        >
          <span className="w-6 h-6 rounded-full lm-accent-soft text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
            {block.num}
          </span>
          <div className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {block.title && (
              <strong className="font-bold mr-1" style={{ color: 'var(--text-primary)' }}>
                {block.title}:
              </strong>
            )}
            <span>{renderInlineFormatting(block.body)}</span>
          </div>
        </div>
      );
    }
    if (block.type === 'bullet') {
      return (
        <div key={idx} className="flex items-start gap-2.5 my-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <span className="lm-accent-text mt-1.5 text-[7px]">
            <i className="fa-solid fa-circle"></i>
          </span>
          <span>{renderInlineFormatting(block.text)}</span>
        </div>
      );
    }
    if (block.type === 'paragraph') {
      return (
        <p
          key={idx}
          className={`my-2 leading-relaxed ${regionalFont ? 'text-[15px] tamil-text' : 'text-sm'}`}
          style={{ color: 'var(--text-secondary)' }}
        >
          {renderInlineFormatting(block.text)}
        </p>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
      {sections.map((sec, sIdx) => {
        if (!sec.title) {
          return <div key={sIdx}>{sec.items.map(renderBlock)}</div>;
        }
        return (
          <details
            key={sIdx}
            open={sIdx === 0}
            className="rounded-xl lm-surface-elevated overflow-hidden group"
          >
            <summary
              className="px-4 py-3 cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold select-none hover:opacity-90 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="flex items-center gap-2.5">
                <i className={`fa-solid ${getSectionIcon(sec.title)} lm-accent-text text-xs`}></i>
                <span>{sec.title}</span>
              </span>
              <i className="fa-solid fa-chevron-down text-[11px] transition-transform group-open:rotate-180" style={{ color: 'var(--text-muted)' }}></i>
            </summary>
            <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {sec.items.map(renderBlock)}
            </div>
          </details>
        );
      })}
    </div>
  );
};

const ExplanationCard: React.FC<ExplanationCardProps> = ({
  explanation,
  onPlayAudio,
  onAssessmentComplete,
  onTriggerRecommendedAction,
  onAskFollowUp,
  onSwitchMode,
  onOpenInPlayground,
  onSavedLesson,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'english' | 'regional'>('regional');

  // Phase C: Interactive Diagram, Save, Follow-up
  const [diagram, setDiagram] = useState<DiagramSpec | null>(explanation.meta?.diagram || null);
  const [isDiagramLoading, setIsDiagramLoading] = useState(false);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [isSaved, setIsSaved] = useState(Boolean(explanation.savedId));
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Phase B: Adaptive Assessment State
  const [selectedType, setSelectedType] = useState<AssessmentType>('adaptive_practice');
  const [isAssessLoading, setIsAssessLoading] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [assessmentSession, setAssessmentSession] = useState<GenerateAssessmentResponse | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<PublicQuestion | null>(null);
  const [answerInput, setAnswerInput] = useState('');
  const [questionStartedAt, setQuestionStartedAt] = useState<number>(Date.now());
  const [lastFeedback, setLastFeedback] = useState<SubmitAnswerResponse | null>(null);
  const [completedSummary, setCompletedSummary] = useState<PostAssessmentSummary | null>(null);

  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const profile = LANGUAGE_PROFILES.find((p) => p.id === explanation.profileId);

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

  useEffect(() => {
    if (explanation.meta?.diagram) {
      setDiagram(explanation.meta.diagram);
    }
  }, [explanation.meta?.diagram]);

  useEffect(() => {
    return () => {
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.onended = null;
          activeSourceRef.current.stop();
        } catch {
          // Ignore already stopped source
        }
        activeSourceRef.current = null;
      }
    };
  }, []);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.onended = null;
          activeSourceRef.current.stop();
        } catch {
          // Ignore already stopped source
        }
        activeSourceRef.current = null;
      }
      setIsPlaying(false);
      return;
    }

    if (!onPlayAudio) return;

    setIsGenerating(true);
    try {
      const source = await onPlayAudio(explanation.regionalResponse, playbackSpeed);
      if (source) {
        activeSourceRef.current = source;
        setIsPlaying(true);
        source.onended = () => {
          setIsPlaying(false);
          activeSourceRef.current = null;
        };
      }
    } catch (err) {
      console.error('Audio playback error', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    setDownloadError(null);
    try {
      const base64 = await generateSpeech(explanation.regionalResponse);
      if (base64) {
        const wavUrl = addWavHeader(base64);
        const link = document.createElement('a');
        link.href = wavUrl;
        link.download = `Mentor_Full_${explanation.term.replace(/\s+/g, '_')}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(wavUrl), 1000);
      }
    } catch (err: any) {
      setDownloadError(err?.message || 'Full voice download failed. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const cycleSpeed = () => {
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];
    setPlaybackSpeed(nextSpeed);
    if (activeSourceRef.current) {
      activeSourceRef.current.playbackRate.value = nextSpeed;
    }
  };

  const handleVisualize = async () => {
    if (isDiagramLoading) return;
    setIsDiagramLoading(true);
    setActionNotice(null);
    try {
      const generated = await generateConceptDiagramClient(explanation.term);
      setDiagram(generated);
    } catch (err: any) {
      setActionNotice(err?.message || 'Could not generate diagram.');
    } finally {
      setIsDiagramLoading(false);
    }
  };

  const handleSaveLesson = async () => {
    if (isSavingLesson || !explanation.englishResponse) return;
    setIsSavingLesson(true);
    setActionNotice(null);
    try {
      await saveLessonClient({
        term: explanation.term,
        profileId: explanation.profileId,
        teachingMode: explanation.meta?.teachingMode || 'cultural_analogy',
        englishResponse: explanation.englishResponse,
        regionalResponse: explanation.regionalResponse,
        diagram,
        meta: explanation.meta || null,
        isBookmarked: true,
      });
      setIsSaved(true);
      setActionNotice('Lesson saved to your library.');
      onSavedLesson?.();
    } catch (err: any) {
      setActionNotice(err?.message || 'Could not save lesson.');
    } finally {
      setIsSavingLesson(false);
    }
  };

  const handleFollowUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = followUpInput.trim();
    if (!q || !onAskFollowUp) return;
    onAskFollowUp(explanation.term, q, explanation.meta?.topicSummary);
    setFollowUpInput('');
  };

  const handleStartAssessment = async (overrideType?: AssessmentType) => {
    if (isAssessLoading) return;
    const typeToUse = overrideType || selectedType;
    setSelectedType(typeToUse);
    setIsAssessLoading(true);
    setAssessError(null);
    setLastFeedback(null);
    setCompletedSummary(null);
    setAnswerInput('');

    try {
      const res = await generateAdaptiveAssessment({
        concept: explanation.term,
        assessmentType: typeToUse,
        questionCount: 3,
        profileId: explanation.profileId,
      });
      setAssessmentSession(res);
      setCurrentQuestion(res.questions[0] || null);
      setQuestionStartedAt(Date.now());
    } catch (err: any) {
      setAssessError(err?.message || 'Could not generate assessment.');
    } finally {
      setIsAssessLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!assessmentSession || !currentQuestion || !answerInput.trim() || isAssessLoading) return;
    setIsAssessLoading(true);
    setAssessError(null);

    try {
      const result = await submitAssessmentAnswerClient({
        attemptId: assessmentSession.attemptId,
        questionId: currentQuestion.id,
        submittedAnswer: answerInput.trim(),
        timeTakenMs: Math.max(0, Date.now() - questionStartedAt),
      });
      setLastFeedback(result);
    } catch (err: any) {
      setAssessError(err?.message || 'Could not evaluate answer.');
    } finally {
      setIsAssessLoading(false);
    }
  };

  const handleAdvanceQuestion = async () => {
    if (!assessmentSession || isAssessLoading) return;
    if (lastFeedback?.nextQuestion) {
      setCurrentQuestion(lastFeedback.nextQuestion);
      setLastFeedback(null);
      setAnswerInput('');
      setQuestionStartedAt(Date.now());
      return;
    }

    setIsAssessLoading(true);
    setAssessError(null);
    try {
      const summary = await completeAssessmentClient(assessmentSession.attemptId);
      setCompletedSummary(summary);
      setCurrentQuestion(null);
      setLastFeedback(null);
      onAssessmentComplete?.();
    } catch (err: any) {
      setAssessError(err?.message || 'Could not complete assessment.');
    } finally {
      setIsAssessLoading(false);
    }
  };

  const handleCloseAssessment = async () => {
    if (assessmentSession && !completedSummary) {
      try {
        await abandonAssessmentClient(assessmentSession.attemptId);
      } catch {
        // Ignore close errors
      }
    }
    setAssessmentSession(null);
    setCurrentQuestion(null);
    setLastFeedback(null);
    setCompletedSummary(null);
    setAssessError(null);
    setAnswerInput('');
  };

  return (
    <article className="lm-surface rounded-2xl overflow-hidden shadow-xl">
      {/* Header Bar */}
      <div className="p-5 md:p-6 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-base">{profile?.icon}</span>
              <span className="text-xs font-ui font-bold uppercase tracking-wider lm-accent-text">
                {profile?.name || 'Mentor'}
              </span>
              {explanation.meta?.teachingMode && (
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  • {explanation.meta.teachingMode.replace(/_/g, ' ')}
                </span>
              )}
              {explanation.meta?.analogyDomain && (
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  • Analogy: {explanation.meta.analogyDomain}
                </span>
              )}
            </div>
            <h3 className="font-editorial text-2xl md:text-3xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {explanation.term}
            </h3>
          </div>

          {/* Audio + Save Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveLesson}
              disabled={isSavingLesson || !explanation.englishResponse}
              className={`h-10 px-3.5 rounded-full border text-xs font-semibold flex items-center gap-2 transition-colors ${
                isSaved ? 'lm-accent-soft' : 'lm-btn-outline'
              }`}
              style={isSaved ? undefined : { color: 'var(--text-secondary)' }}
              title="Save lesson to library"
            >
              <i className={`fa-${isSaved ? 'solid' : 'regular'} fa-bookmark`}></i>
              <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
            </button>

            <div className="flex items-center gap-1 lm-inset p-1 rounded-full">
              <button
                onClick={cycleSpeed}
                className="h-8 px-2.5 rounded-full hover:bg-white/10 text-xs font-mono font-bold lm-accent-text tabular-nums"
                title="Cycle playback speed"
              >
                {playbackSpeed}x
              </button>

              <button
                onClick={handleTogglePlay}
                disabled={isGenerating}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-colors ${
                  isPlaying
                    ? 'bg-red-500/20 text-red-400 border border-red-500/35'
                    : 'lm-btn-primary disabled:opacity-45'
                }`}
                aria-label={isPlaying ? 'Pause narration' : 'Play narration'}
              >
                {isGenerating ? (
                  <i className="fa-solid fa-spinner animate-spin text-xs"></i>
                ) : isPlaying ? (
                  <i className="fa-solid fa-pause text-xs"></i>
                ) : (
                  <i className="fa-solid fa-play text-xs"></i>
                )}
              </button>

              <button
                onClick={handleDownload}
                disabled={isGenerating}
                className="w-8 h-8 rounded-full lm-btn-outline flex items-center justify-center disabled:opacity-45"
                style={{ color: 'var(--text-secondary)' }}
                title="Download Full Explanation WAV"
                aria-label="Download WAV"
              >
                <i className="fa-solid fa-download text-xs"></i>
              </button>
            </div>
          </div>
        </div>

        {/* Mode Switcher & Quick Learning Actions */}
        {(onSwitchMode || explanation.englishResponse) && (
          <div className="mt-4 pt-3.5 border-t flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center gap-1.5">
              {onSwitchMode &&
                MODE_SWITCH_OPTIONS.map((item) => {
                  const active = explanation.meta?.teachingMode === item.mode;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => onSwitchMode(explanation.term, item.mode, item.mode === 'simple_explanation')}
                      className={`px-3 py-1 rounded-full text-xs font-ui font-medium transition-colors border ${
                        active ? 'lm-tab-active' : 'lm-btn-outline'
                      }`}
                      style={active ? undefined : { color: 'var(--text-secondary)' }}
                    >
                      {item.label}
                    </button>
                  );
                })}
            </div>

            <div className="flex items-center gap-2">
              {onSwitchMode && (
                <button
                  type="button"
                  onClick={() => onSwitchMode(explanation.term, 'simple_explanation', true)}
                  className="px-3.5 py-1.5 rounded-full lm-btn-outline text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Simplify
                </button>
              )}
              <button
                type="button"
                onClick={handleVisualize}
                disabled={isDiagramLoading || !explanation.englishResponse}
                className="px-3.5 py-1.5 rounded-full lm-accent-soft text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-45 flex items-center gap-1.5"
              >
                {isDiagramLoading ? (
                  <i className="fa-solid fa-spinner animate-spin"></i>
                ) : (
                  <i className="fa-solid fa-diagram-project"></i>
                )}
                <span>{diagram ? 'Refresh Diagram' : 'Visualize Concept'}</span>
              </button>
            </div>
          </div>
        )}

        {downloadError && (
          <div className="mt-3 px-3.5 py-2 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation"></i>
            <span>{downloadError}</span>
          </div>
        )}
        {actionNotice && (
          <div className="mt-3 px-3.5 py-2 lm-accent-soft rounded-xl text-xs font-medium">
            {actionNotice}
          </div>
        )}
      </div>

      {/* Interactive SVG Visual Diagram */}
      {diagram && (
        <div className="px-5 md:px-6 pt-2">
          <DiagramRenderer diagram={diagram} />
        </div>
      )}

      {/* Mobile Tab Switcher (hidden on md and above) */}
      <div className="flex md:hidden border-b px-4 py-2 gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => setMobileTab('english')}
          className={`flex-1 py-2 rounded-full text-xs font-semibold transition-colors ${
            mobileTab === 'english' ? 'lm-tab-active' : 'lm-inset'
          }`}
          style={mobileTab === 'english' ? undefined : { color: 'var(--text-secondary)' }}
        >
          English
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('regional')}
          className={`flex-1 py-2 rounded-full text-xs font-semibold transition-colors ${
            mobileTab === 'regional' ? 'lm-tab-active' : 'lm-inset'
          }`}
          style={mobileTab === 'regional' ? undefined : { color: 'var(--text-secondary)' }}
        >
          {profile?.name || 'Regional'}
        </button>
      </div>

      {/* Dual Column Interactive Explanations */}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className={`p-5 md:p-6 ${mobileTab === 'english' ? 'block' : 'hidden md:block'}`}>
          <h4 className="text-xs font-ui font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <i className="fa-solid fa-globe lm-accent-text"></i>
            <span>English Technical Explanation</span>
          </h4>
          <InteractiveMarkdownRenderer
            content={explanation.englishResponse}
            onOpenInPlayground={onOpenInPlayground}
          />
        </div>

        <div className={`p-5 md:p-6 ${mobileTab === 'regional' ? 'block' : 'hidden md:block'}`}>
          <h4 className="text-xs font-ui font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <i className="fa-solid fa-language lm-accent-text"></i>
            <span>{profile?.name || 'Regional'} Explanation</span>
          </h4>
          <InteractiveMarkdownRenderer
            content={explanation.regionalResponse}
            regionalFont={profile?.lang !== 'english'}
            onOpenInPlayground={onOpenInPlayground}
          />
        </div>
      </div>

      {/* Follow-Up Question Input */}
      {onAskFollowUp && explanation.englishResponse && (
        <div className="px-5 md:px-6 py-4 border-t lm-inset" style={{ borderColor: 'var(--border-subtle)' }}>
          {explanation.meta?.followUpSuggestions && explanation.meta.followUpSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {explanation.meta.followUpSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onAskFollowUp(explanation.term, s, explanation.meta?.topicSummary)}
                  className="text-xs px-3.5 py-1.5 rounded-full lm-btn-outline"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleFollowUpSubmit} className="flex gap-2">
            <input
              type="text"
              value={followUpInput}
              onChange={(e) => setFollowUpInput(e.target.value)}
              placeholder={`Ask a follow-up about ${explanation.term}...`}
              className="flex-1 px-4 py-2.5 rounded-full lm-surface lm-input text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              type="submit"
              disabled={!followUpInput.trim()}
              className="px-5 py-2.5 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45 whitespace-nowrap"
            >
              Ask Follow-up
            </button>
          </form>
        </div>
      )}

      {/* Phase B: Integrated Adaptive Assessment & Mastery Bar */}
      <div className="px-5 py-4 md:px-6 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            <i className="fa-solid fa-brain lm-accent-text"></i>
            <span>Verify Understanding & Adaptive Mastery</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as AssessmentType)}
              disabled={isAssessLoading}
              className="lm-inset lm-input rounded-full px-3.5 py-2 text-xs font-medium outline-none"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Assessment type"
            >
              {ASSESSMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="lm-option">
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleStartAssessment('diagnostic')}
              disabled={isAssessLoading || !explanation.englishResponse}
              className="px-4 py-2 rounded-full lm-btn-outline text-xs font-medium disabled:opacity-45"
              style={{ color: 'var(--text-secondary)' }}
            >
              Diagnostic
            </button>

            <button
              onClick={() => handleStartAssessment()}
              disabled={isAssessLoading || !explanation.englishResponse}
              className="px-5 py-2 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45 flex items-center gap-2"
            >
              {isAssessLoading ? (
                <i className="fa-solid fa-spinner animate-spin"></i>
              ) : (
                <i className="fa-solid fa-graduation-cap"></i>
              )}
              <span>{assessmentSession ? 'Restart Assessment' : 'Start Assessment'}</span>
            </button>

            {(assessmentSession || completedSummary) && (
              <button
                onClick={handleCloseAssessment}
                className="px-3.5 py-2 rounded-full lm-btn-outline text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
                title="Close assessment"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {assessError && (
          <div className="mt-4 px-4 py-2.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-400 flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation"></i>
            <span>{assessError}</span>
          </div>
        )}

        {currentQuestion && (
          <div className="mt-4 p-5 rounded-2xl lm-inset space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              <span className="uppercase tracking-wider lm-accent-text">
                {assessmentSession?.assessmentType.replace('_', ' ')} • Question{' '}
                {(lastFeedback?.attemptProgress.answeredCount ?? 0) + (lastFeedback ? 0 : 1)} of{' '}
                {assessmentSession?.totalQuestions}
              </span>
              <span className="font-mono tabular-nums">
                Level {currentQuestion.difficultyLevel}/5 • {currentQuestion.questionType.replace('_', ' ')}
              </span>
            </div>

            <p className="font-semibold text-base leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              {currentQuestion.questionText}
            </p>

            {currentQuestion.codeSnippet && (
              <CodeBlock code={currentQuestion.codeSnippet} onOpenInPlayground={onOpenInPlayground} />
            )}

            {!lastFeedback ? (
              <div className="space-y-3">
                {currentQuestion.options && currentQuestion.options.length > 0 ? (
                  <div className="grid gap-2">
                    {currentQuestion.options.map((option) => (
                      <button
                        key={option}
                        onClick={() => setAnswerInput(option)}
                        disabled={isAssessLoading}
                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                          answerInput === option
                            ? 'lm-accent-soft font-semibold'
                            : 'lm-surface hover:border-white/30'
                        }`}
                        style={{ color: answerInput === option ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    disabled={isAssessLoading}
                    placeholder="Write your explanation or logic here..."
                    className="w-full lm-surface lm-input rounded-xl p-3.5 text-sm outline-none"
                    style={{ color: 'var(--text-primary)' }}
                  />
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={isAssessLoading || !answerInput.trim()}
                    className="px-5 py-2.5 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45 flex items-center gap-2"
                  >
                    {isAssessLoading && <i className="fa-solid fa-spinner animate-spin"></i>}
                    <span>Submit Answer</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full tabular-nums ${
                      lastFeedback.evaluationResult === 'correct'
                        ? 'lm-accent-soft'
                        : lastFeedback.evaluationResult === 'partially_correct'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {lastFeedback.evaluationResult.replace('_', ' ')} • {lastFeedback.score}/100
                  </span>
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    Next Adaptive Level: {lastFeedback.nextRecommendedDifficulty}/5
                  </span>
                </div>

                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {lastFeedback.feedback}
                </p>

                {lastFeedback.evaluationResult !== 'correct' && (
                  <p className="text-xs lm-accent-text">
                    <span className="font-bold">Reference Answer:</span> {lastFeedback.correctAnswer}
                  </p>
                )}

                {lastFeedback.missingConcepts.length > 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>Focus Points:</span>{' '}
                    {lastFeedback.missingConcepts.join(', ')}
                  </p>
                )}

                {lastFeedback.misconception && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
                    <div className="font-bold">
                      Misconception Observation ({lastFeedback.misconception.category}
                      {lastFeedback.misconception.isPattern ? ' • Repeated Pattern' : ' • Observation'}):
                    </div>
                    <div>{lastFeedback.misconception.description}</div>
                    <div>Suggestion: {lastFeedback.misconception.recommendedIntervention}</div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{lastFeedback.recommendation}</span>
                  <button
                    onClick={handleAdvanceQuestion}
                    disabled={isAssessLoading}
                    className="px-5 py-2.5 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45"
                  >
                    {lastFeedback.nextQuestion ? 'Next Question' : 'Complete & View Summary'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {completedSummary && (
          <div className="mt-4 p-5 rounded-2xl lm-inset space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider lm-accent-text">
                  Post-Assessment Summary • {completedSummary.assessmentType.replace('_', ' ')}
                </div>
                <h5 className="text-lg font-bold mt-0.5 tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  Score: {completedSummary.score}% ({completedSummary.correctAnswers} correct,{' '}
                  {completedSummary.partialCreditAnswers} partial, {completedSummary.incorrectAnswers} incorrect)
                </h5>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Mastery: {completedSummary.mastery.masteryScore ?? 'NOT ASSESSED'}%
                  {completedSummary.mastery.isProvisional ? ' (Provisional)' : ''}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {completedSummary.mastery.classificationBand?.replace(/_/g, ' ')} •{' '}
                  {completedSummary.mastery.confidenceState.replace(/_/g, ' ')}
                </div>
              </div>
            </div>

            {completedSummary.insufficientDataNotice && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                {completedSummary.insufficientDataNotice}
              </p>
            )}

            {completedSummary.diagnosticOutcome && (
              <div className="p-3 rounded-xl lm-accent-soft text-xs space-y-1">
                <div className="font-bold">
                  Diagnostic Level: {completedSummary.diagnosticOutcome.level}
                  {completedSummary.diagnosticOutcome.isProvisional ? ' (Provisional)' : ''}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  {completedSummary.diagnosticOutcome.recommendedTeachingApproach}
                </div>
              </div>
            )}

            {completedSummary.learningGaps.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Detected Learning Gaps:</div>
                {completedSummary.learningGaps.map((g, i) => (
                  <div key={`${g.conceptId}-${i}`} className="text-xs lm-surface rounded-lg px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-semibold uppercase" style={{ color: 'var(--text-primary)' }}>
                      {g.gapType.replace(/_/g, ' ')}:
                    </span>{' '}
                    {g.evidence} — {g.recommendedIntervention}
                  </div>
                ))}
              </div>
            )}

            <div className="p-3.5 rounded-xl lm-surface flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs space-y-0.5 max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                <div className="font-bold lm-accent-text">
                  Recommended Next Activity: {completedSummary.adaptiveDecision.recommendedAction.replace(/_/g, ' ')}
                </div>
                <div>{completedSummary.adaptiveDecision.reason}</div>
              </div>

              {onTriggerRecommendedAction && (
                <button
                  onClick={() => {
                    const prereq = completedSummary.adaptiveDecision.prerequisiteAlerts.find(
                      (p) => p.needsReinforcement
                    )?.conceptName;
                    onTriggerRecommendedAction(
                      completedSummary.adaptiveDecision.nextConceptSuggestion &&
                        completedSummary.adaptiveDecision.recommendedAction === 'ADVANCE'
                        ? completedSummary.adaptiveDecision.nextConceptSuggestion
                        : completedSummary.conceptName,
                      completedSummary.adaptiveDecision.recommendedAction,
                      completedSummary.adaptiveDecision.recommendedAssessmentType,
                      completedSummary.adaptiveDecision.recommendedTeachingMode,
                      prereq
                    );
                  }}
                  className="px-4 py-2 rounded-full lm-btn-primary text-xs font-semibold"
                >
                  Apply Recommendation
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
};

export default ExplanationCard;
