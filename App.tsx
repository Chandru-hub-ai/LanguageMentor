import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getTechExplanationStream,
  cancelActiveExplanation,
  buildSessionContext,
  generateSpeech,
  decodeBase64,
  decodeAudioData,
  analyzeImage,
  type ExplainClientOptions,
} from './services/geminiService';
import {
  AdaptiveAction,
  AssessmentType,
  AuthSessionResponse,
  AuthUser,
  Explanation,
  LearnerOverviewResponse,
  PlatformDashboardData,
  ProgrammingLanguage,
  ProgrammingLesson,
  SavedLessonRecord,
  TeachingMode,
  ThemeMode,
  UserProfile,
  WorkspaceView,
} from './types';
import { getLearnerOverviewClient } from './services/assessmentService';
import {
  getPlatformDashboardClient,
  restoreAuthSession,
  updateProfileClient,
  updateStudyTaskClient,
} from './services/platformService';
import { POPULAR_TERMS, LANGUAGE_PROFILES, LEARNING_GEMS } from './constants';
import ExplanationCard from './components/ExplanationCard';
import Navbar from './components/Navbar';
import AuthModal from './components/AuthModal';
import OnboardingPanel from './components/OnboardingPanel';
import DashboardView from './components/DashboardView';
import PlaygroundView from './components/PlaygroundView';
import PlannerPathView from './components/PlannerPathView';

const TUTOR_MODE_OPTIONS: Array<{ value: TeachingMode | 'auto'; label: string }> = [
  { value: 'auto', label: 'Adaptive Auto' },
  { value: 'cultural_analogy', label: 'Cultural Analogy' },
  { value: 'simple_explanation', label: 'Beginner Friendly' },
  { value: 'visual_learning', label: 'Visual Diagram' },
  { value: 'step_by_step', label: 'Step-by-Step' },
  { value: 'practical_application', label: 'Practical' },
  { value: 'exam_preparation', label: 'Exam Mode' },
  { value: 'code_explanation', label: 'Code Mode' },
];

const App: React.FC = () => {
  // Workspace Navigation & Auth / Profile State
  const [activeView, setActiveView] = useState<WorkspaceView>('tutor');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [dashboardData, setDashboardData] = useState<PlatformDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Tutor State
  const [term, setTerm] = useState('');
  const [history, setHistory] = useState<Explanation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState('tamil_std');
  const [selectedTeachingMode, setSelectedTeachingMode] = useState<TeachingMode | 'auto'>('auto');
  const [error, setError] = useState<string | null>(null);
  const [learnerOverview, setLearnerOverview] = useState<LearnerOverviewResponse | null>(null);

  // Playground Cross-Navigation State
  const [playgroundCode, setPlaygroundCode] = useState<string | null>(null);
  const [playgroundLang, setPlaygroundLang] = useState<ProgrammingLanguage | null>(null);
  const [selectedCodingLesson, setSelectedCodingLesson] = useState<ProgrammingLesson | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Explanation[]>(history);
  const activeProfileRef = useRef<string>(activeProfileId);
  const isLoadingRef = useRef<boolean>(isLoading);

  historyRef.current = history;
  activeProfileRef.current = activeProfileId;
  isLoadingRef.current = isLoading;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Subtle fine-pointer tracking ring from obsidian editorial theme
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return;
    let frameId = 0;
    let targetX = -100;
    let targetY = -100;
    let curX = -100;
    let curY = -100;

    const handleMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
    };

    const tick = () => {
      curX += (targetX - curX) * 0.2;
      curY += (targetY - curY) * 0.2;
      if (cursorRingRef.current) {
        cursorRingRef.current.style.transform = `translate3d(${curX - 18}px, ${curY - 18}px, 0)`;
      }
      frameId = requestAnimationFrame(tick);
    };

    window.addEventListener('mousemove', handleMove, { passive: true });
    frameId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(frameId);
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await getPlatformDashboardClient();
      setDashboardData(data);
      setLearnerOverview(data.overview);
      setAuthUser(data.auth.user);
      setUserProfile(data.auth.profile);
    } catch {
      // Non-blocking refresh
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const session = await restoreAuthSession();
        if (!mounted) return;
        setAuthUser(session.user);
        setUserProfile(session.profile);
        setActiveProfileId(session.profile.preferredProfileId || 'tamil_std');
        setTheme(session.profile.themePreference || 'dark');
        await refreshDashboard();
      } catch {
        if (mounted) setDashboardLoading(false);
      }
    })();

    return () => {
      mounted = false;
      cancelActiveExplanation();
    };
  }, [refreshDashboard]);

  const handleToggleTheme = async () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      const updated = await updateProfileClient({ themePreference: nextTheme });
      setUserProfile(updated.profile);
    } catch {
      // Local theme remains updated
    }
  };

  const handleAuthSuccess = async (session: AuthSessionResponse) => {
    setAuthUser(session.user);
    setUserProfile(session.profile);
    setActiveProfileId(session.profile.preferredProfileId || activeProfileId);
    setTheme(session.profile.themePreference || theme);
    await refreshDashboard();
  };

  const playAudio = async (text: string, speed: number = 1) => {
    try {
      if (!text || !text.trim()) {
        throw new Error('No explanation text available to speak.');
      }
      setError(null);
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const base64Audio = await generateSpeech(text);
      if (!base64Audio) throw new Error('Voice generation failed.');

      const buffer = await decodeAudioData(decodeBase64(base64Audio), ctx);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      source.connect(ctx.destination);
      source.start();

      return source;
    } catch (e: any) {
      console.error('Audio error:', e);
      setError('Voice explanation failed: ' + (e.message || 'Unknown error'));
      return undefined;
    }
  };

  const processTerm = async (inputTerm: string, overrideOptions?: ExplainClientOptions) => {
    const trimmedTerm = inputTerm.trim();
    if (!trimmedTerm || isLoadingRef.current) return;

    const currentProfileId = activeProfileRef.current;
    const sessionContext = buildSessionContext(historyRef.current, currentProfileId);
    const effectiveOptions: ExplainClientOptions = {
      explicitMode:
        overrideOptions?.explicitMode ||
        (selectedTeachingMode !== 'auto' ? selectedTeachingMode : undefined),
      ...overrideOptions,
    };

    const cardTitle = effectiveOptions.followUpQuestion
      ? `${effectiveOptions.previousTerm || trimmedTerm} — ${effectiveOptions.followUpQuestion}`
      : trimmedTerm;

    const itemId = crypto.randomUUID();
    const createdAt = Date.now();
    let cardInserted = false;

    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);

    const upsertCard = (english: string, regional: string, meta?: Explanation['meta']) => {
      if (!cardInserted) {
        cardInserted = true;
        const newItem: Explanation = {
          id: itemId,
          term: cardTitle,
          englishResponse: english,
          regionalResponse: regional,
          timestamp: createdAt,
          profileId: currentProfileId,
          meta,
        };
        setHistory((prev) => [newItem, ...prev]);
        setTerm('');
        setTimeout(() => {
          scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        setHistory((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  englishResponse: english,
                  regionalResponse: regional,
                  meta: meta || item.meta,
                }
              : item
          )
        );
      }
    };

    try {
      const result = await getTechExplanationStream(
        trimmedTerm,
        currentProfileId,
        {
          onUpdate: (partial) => {
            upsertCard(partial.english, partial.regional, partial.meta);
          },
        },
        sessionContext,
        effectiveOptions
      );

      upsertCard(result.english, result.regional, result.meta);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Mentor is temporarily offline. Please try again.');
      }
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isLoadingRef.current) return;

    const currentProfileId = activeProfileRef.current;
    const sessionContext = buildSessionContext(historyRef.current, currentProfileId);

    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const { english, regional, meta } = await analyzeImage(
            base64,
            currentProfileId,
            file.type || 'image/jpeg',
            sessionContext
          );
          const item: Explanation = {
            id: crypto.randomUUID(),
            term: 'Image Subject',
            englishResponse: english,
            regionalResponse: regional,
            timestamp: Date.now(),
            profileId: currentProfileId,
            meta,
          };
          setHistory((prev) => [item, ...prev]);
        } catch (err: any) {
          setError(err?.message || 'Failed to process image.');
        } finally {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      };
      reader.onerror = () => {
        setError('Failed to read image file.');
        isLoadingRef.current = false;
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setError('Failed to process image.');
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      const rec = new SpeechRec();
      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      rec.onerror = (e: any) => {
        setIsListening(false);
        if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
          setError(`Voice input error: ${e.error}`);
        }
      };
      rec.onresult = (e: any) => {
        const t = e.results?.[0]?.[0]?.transcript;
        if (t) {
          setTerm(t);
          processTerm(t);
        }
      };
      recognitionRef.current = rec;
      return () => {
        try {
          rec.abort();
        } catch {
          // Ignore cleanup errors
        }
      };
    }
  }, [activeProfileId]);

  const toggleListening = () => {
    const rec = recognitionRef.current;
    if (!rec) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    try {
      if (isListening) {
        rec.stop();
      } else {
        setError(null);
        rec.start();
      }
    } catch (err: any) {
      setIsListening(false);
      setError(err?.message || 'Could not start voice input.');
    }
  };

  const refreshLearnerOverview = async () => {
    try {
      const overview = await getLearnerOverviewClient();
      setLearnerOverview(overview);
      await refreshDashboard();
    } catch {
      // Non-blocking background refresh
    }
  };

  const handleTriggerRecommendedAction = (
    conceptName: string,
    action: AdaptiveAction,
    _assessmentType: AssessmentType,
    teachingMode: TeachingMode,
    prereqConceptName?: string
  ) => {
    setActiveView('tutor');
    switch (action) {
      case 'RE-TEACH':
        processTerm(`Explain ${conceptName} in simple beginner terms`, { explicitMode: 'simple_explanation', simplify: true });
        break;
      case 'ANALOGY':
        processTerm(`Explain ${conceptName} using a fresh relatable everyday analogy`, { explicitMode: 'cultural_analogy' });
        break;
      case 'FOUNDATIONAL_PRACTICE':
        processTerm(`Explain ${prereqConceptName || conceptName} foundational basics step by step`, { explicitMode: 'step_by_step' });
        break;
      case 'GUIDED_PRACTICE':
        processTerm(`Explain ${conceptName} step by step with practical examples`, { explicitMode: 'step_by_step' });
        break;
      case 'APPLICATION':
      case 'ADVANCED_PRACTICE':
        processTerm(`Explain ${conceptName} with real-world industry scenarios and technical depth`, { explicitMode: 'practical_application' });
        break;
      case 'RETENTION_REVISION':
        processTerm(`Give a quick retention revision summary of ${conceptName}`, { explicitMode: teachingMode });
        break;
      case 'ADVANCE':
      default:
        processTerm(conceptName, { explicitMode: teachingMode });
        break;
    }
  };

  const handleStartTopicFromPlatform = (concept: string, mode?: TeachingMode) => {
    setActiveView('tutor');
    if (mode) {
      setSelectedTeachingMode(mode);
    }
    processTerm(concept, mode ? { explicitMode: mode } : undefined);
  };

  const handleOpenSavedLesson = (lsn: SavedLessonRecord) => {
    const hydrated: Explanation = {
      id: lsn.id,
      term: lsn.term,
      englishResponse: lsn.englishResponse,
      regionalResponse: lsn.regionalResponse,
      timestamp: lsn.updatedAt,
      profileId: lsn.profileId,
      meta: lsn.meta ? { ...lsn.meta, diagram: lsn.diagram || lsn.meta.diagram } : {
        teachingMode: lsn.teachingMode,
        complexity: 'complex',
        learnerLevel: 'unspecified',
        diagram: lsn.diagram,
      },
      savedId: lsn.id,
      isBookmarked: lsn.isBookmarked,
    };
    setHistory((prev) => [hydrated, ...prev.filter((h) => h.id !== hydrated.id)]);
    setActiveView('tutor');
  };

  const handleOpenInPlayground = (code: string, lang: ProgrammingLanguage) => {
    setSelectedCodingLesson(null);
    setPlaygroundCode(code);
    setPlaygroundLang(lang);
    setActiveView('playground');
  };

  const handleOpenProgrammingLesson = (lesson: ProgrammingLesson) => {
    setPlaygroundCode(null);
    setSelectedCodingLesson(lesson);
    setActiveView('playground');
  };

  const handleToggleTaskComplete = async (taskId: string, done: boolean) => {
    try {
      await updateStudyTaskClient(taskId, { status: done ? 'completed' : 'pending' });
      await refreshDashboard();
    } catch {
      // ignore
    }
  };

  const dueRevisionsCount = (dashboardData?.revisions || []).filter((r) => r.isDueNow).length;

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      {/* Subtle Atmospheric Backdrop (Dark Theme Only) */}
      <div className="lm-ambient-backdrop" aria-hidden="true">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover opacity-[0.22]"
        >
          <source
            src="https://api.getlayers.ai/storage/v1/object/public/public/assets/loopstack-f8c64439bf/flower.mp4"
            type="video/mp4"
          />
        </video>
        <img
          src="https://api.getlayers.ai/storage/v1/object/public/public/assets/loopstack-f8c64439bf/black_gradient.svg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/65 to-black/95"></div>
      </div>

      {/* Subtle Pointer Ring for Desktop */}
      <div
        ref={cursorRingRef}
        aria-hidden="true"
        className="hidden lg:block fixed top-0 left-0 w-9 h-9 rounded-full pointer-events-none z-50 border opacity-45 transition-opacity"
        style={{
          borderColor: 'var(--accent-primary)',
          transform: 'translate3d(-100px, -100px, 0)',
        }}
      ></div>

      <div className="relative z-10 flex-1 flex flex-col">
        <Navbar
          activeView={activeView}
          onNavigate={setActiveView}
          user={authUser}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onOpenPreferences={() => setIsOnboardingOpen(true)}
          dueRevisionsCount={dueRevisionsCount}
        />

        <div className="flex-1">
          {activeView === 'dashboard' && (
            <DashboardView
              data={dashboardData}
              loading={dashboardLoading}
              onNavigate={setActiveView}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
              onOpenAuth={() => setIsAuthModalOpen(true)}
              onStartTopic={handleStartTopicFromPlatform}
              onOpenSavedLesson={handleOpenSavedLesson}
              onOpenProgrammingLesson={handleOpenProgrammingLesson}
              onToggleTaskComplete={handleToggleTaskComplete}
            />
          )}

          {activeView === 'playground' && (
            <PlaygroundView
              activeProfileId={activeProfileId}
              initialCode={playgroundCode}
              initialLanguage={playgroundLang}
              selectedLesson={selectedCodingLesson}
              onSubmissionRecorded={refreshDashboard}
            />
          )}

          {activeView === 'planner' && (
            <PlannerPathView
              data={dashboardData}
              onRefreshDashboard={refreshDashboard}
              onStartTopic={handleStartTopicFromPlatform}
              onOpenSavedLesson={handleOpenSavedLesson}
            />
          )}

          {activeView === 'tutor' && (
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Rail */}
              <aside className="lg:col-span-3 space-y-6">
                {learnerOverview &&
                  (learnerOverview.masteries.length > 0 || learnerOverview.learningGaps.length > 0) && (
                    <div className="lm-surface rounded-2xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-ui font-bold lm-accent-text uppercase tracking-wider flex items-center gap-2">
                          <i className="fa-solid fa-chart-line"></i> Concept Mastery
                        </h3>
                        <button
                          onClick={() => setActiveView('dashboard')}
                          className="text-xs font-semibold lm-accent-text hover:underline"
                        >
                          View All
                        </button>
                      </div>
                      <div className="space-y-3">
                        {learnerOverview.masteries.slice(0, 4).map((m) => (
                          <div key={m.conceptId} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold truncate pr-2" style={{ color: 'var(--text-primary)' }}>
                                {m.conceptName}
                              </span>
                              <span className="lm-accent-text font-mono font-bold tabular-nums">
                                {m.masteryScore !== null ? `${m.masteryScore}%` : '—'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 lm-inset rounded-full overflow-hidden">
                              <div
                                className="h-full mentor-gradient rounded-full transition-all"
                                style={{ width: `${Math.max(4, m.masteryScore || 0)}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                <div className="lm-surface rounded-2xl p-5 space-y-4">
                  <h3 className="text-xs font-ui font-bold lm-accent-text uppercase tracking-wider flex items-center gap-2">
                    <i className="fa-solid fa-lightbulb"></i> Learning Principles
                  </h3>
                  <div className="space-y-4">
                    {LEARNING_GEMS.map((gem) => (
                      <div key={gem.id} className="space-y-1 pb-3 border-b last:border-b-0 last:pb-0" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-base">{gem.icon}</span>
                          <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{gem.title}</h4>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                          {gem.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>

              {/* Main AI Tutor Workspace */}
              <div className="lg:col-span-9 space-y-6">
                {/* Editorial Hero + Language / Dialect Selector */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <h1 className="font-editorial text-3xl sm:text-4xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                      <span className="word-reveal-mask">
                        <span className="word-reveal-inner">Think in your language.</span>
                      </span>{' '}
                      <span className="italic font-normal lm-accent-text">Master the craft.</span>
                    </h1>
                    <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Culturally grounded explanations across Tamil dialects and English, paired with diagrams, voice narration, and adaptive assessments.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs font-ui font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Mentor Language & Dialect
                    </span>
                    {userProfile && !userProfile.onboardingCompleted && (
                      <button
                        onClick={() => setIsOnboardingOpen(true)}
                        className="text-xs font-semibold lm-accent-text hover:underline"
                      >
                        Personalize study goals & skill level
                      </button>
                    )}
                  </div>

                  <div className="flex overflow-x-auto pb-2 gap-2 no-scrollbar scroll-smooth">
                    {LANGUAGE_PROFILES.map((p) => {
                      const active = activeProfileId === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            setActiveProfileId(p.id);
                            setError(null);
                          }}
                          className={`flex-shrink-0 px-4 py-2 rounded-full font-ui font-medium text-xs sm:text-sm transition-all flex items-center gap-2 border ${
                            active ? 'lm-tab-active shadow-sm' : 'lm-btn-outline'
                          }`}
                          style={active ? undefined : { color: 'var(--text-secondary)' }}
                        >
                          <span className="text-base">{p.icon}</span>
                          <span className="whitespace-nowrap">{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Prompt Input Console */}
                <div className="lm-surface rounded-2xl p-5 sm:p-6 space-y-5 shadow-lg">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-grow relative">
                      <input
                        type="text"
                        placeholder="Ask any technical concept, code snippet, or diagram question..."
                        value={term}
                        onChange={(e) => setTerm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && processTerm(term)}
                        className="w-full lm-inset lm-input rounded-full py-3.5 pl-5 pr-12 text-sm sm:text-base font-medium outline-none transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                      />
                      <button
                        onClick={toggleListening}
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                          isListening ? 'bg-red-500 text-white' : 'hover:bg-white/10'
                        }`}
                        style={isListening ? undefined : { color: 'var(--text-muted)' }}
                        aria-label="Voice input"
                      >
                        <i className="fa-solid fa-microphone"></i>
                      </button>
                    </div>

                    <button
                      onClick={() => processTerm(term)}
                      disabled={isLoading || !term.trim()}
                      className="px-7 py-3.5 lm-btn-primary font-ui font-semibold rounded-full disabled:opacity-45 text-sm whitespace-nowrap flex items-center justify-center gap-2"
                    >
                      {isLoading ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-paper-plane text-xs"></i>}
                      <span>Ask Mentor</span>
                    </button>
                  </div>

                  {/* Teaching Mode Bar + Photo Scan + Quick Topics */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={selectedTeachingMode}
                        onChange={(e) => setSelectedTeachingMode(e.target.value as TeachingMode | 'auto')}
                        aria-label="Teaching mode"
                        className="lm-inset lm-input rounded-full px-3.5 py-2 text-xs font-medium outline-none"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {TUTOR_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value} className="lm-option">
                            Mode: {opt.label}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-full lm-btn-outline text-xs font-medium flex items-center gap-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <i className="fa-solid fa-camera lm-accent-text"></i>
                        <span>Photo Scan</span>
                      </button>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {POPULAR_TERMS.slice(0, 4).map((t) => (
                        <button
                          key={t}
                          onClick={() => processTerm(t)}
                          className="text-xs font-medium hover:underline transition-colors"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl flex items-center gap-3 text-sm font-medium">
                    <i className="fa-solid fa-circle-exclamation"></i>
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-8">
                  {history.length > 0 ? (
                    history.map((item, idx) => (
                      <div key={item.id} ref={idx === 0 ? scrollRef : null}>
                        <ExplanationCard
                          explanation={item}
                          onPlayAudio={playAudio}
                          onAssessmentComplete={refreshLearnerOverview}
                          onTriggerRecommendedAction={handleTriggerRecommendedAction}
                          onAskFollowUp={(baseTerm, followUpQuestion, previousSummary) =>
                            processTerm(baseTerm, {
                              followUpQuestion,
                              previousTerm: baseTerm,
                              previousSummary,
                            })
                          }
                          onSwitchMode={(baseTerm, mode, simplify) =>
                            processTerm(baseTerm, {
                              explicitMode: mode,
                              simplify,
                              includeDiagram: mode === 'visual_learning',
                            })
                          }
                          onOpenInPlayground={handleOpenInPlayground}
                          onSavedLesson={refreshDashboard}
                        />
                      </div>
                    ))
                  ) : (
                    !isLoading && (
                      <div className="lm-surface rounded-2xl p-10 text-center space-y-4">
                        <div className="w-12 h-12 rounded-full lm-accent-soft mx-auto flex items-center justify-center text-xl">
                          <i className="fa-solid fa-chalkboard-user"></i>
                        </div>
                        <div className="space-y-1.5 max-w-md mx-auto">
                          <h2 className="font-editorial font-semibold text-2xl" style={{ color: 'var(--text-primary)' }}>
                            Start an interactive session
                          </h2>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                            Choose a dialect above and ask about any technical topic, or open the Programming Playground to practice Python, Java, or JavaScript.
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                          {['Cloud Computing', 'Recursion', 'SQL Normalization'].map((sample) => (
                            <button
                              key={sample}
                              onClick={() => processTerm(sample)}
                              className="px-4 py-2 rounded-full lm-btn-outline text-xs font-medium"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              Explain {sample}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {isLoading && (
                    <div className="lm-surface rounded-2xl p-8 flex flex-col items-center justify-center gap-4">
                      <div
                        className="w-9 h-9 border-2 rounded-full animate-spin"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          borderTopColor: 'var(--accent-primary)',
                        }}
                      ></div>
                      <p className="lm-accent-text font-medium text-sm">
                        Preparing adaptive multilingual explanation...
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </main>
          )}
        </div>

        {/* Minimal Editorial Footer */}
        <footer className="mt-16 border-t py-6 px-4 sm:px-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="font-display font-semibold tracking-tight" style={{ color: 'var(--text-secondary)' }}>
              Language Mentor <span className="lm-accent-text">•</span> Culturally Intelligent AI Learning Platform
            </div>
            <div className="font-ui">Understand • Relate • Explain • Apply • Verify</div>
          </div>
        </footer>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        user={authUser}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {userProfile && (
        <OnboardingPanel
          isOpen={isOnboardingOpen}
          user={authUser}
          profile={userProfile}
          onClose={() => setIsOnboardingOpen(false)}
          onSaved={async ({ user, profile }) => {
            setAuthUser(user);
            setUserProfile(profile);
            setActiveProfileId(profile.preferredProfileId);
            await refreshDashboard();
          }}
        />
      )}
    </div>
  );
};

export default App;
