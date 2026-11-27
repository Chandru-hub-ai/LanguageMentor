export type Language =
  | 'english'
  | 'tanglish'
  | 'tamil'
  | 'hindi'
  | 'telugu'
  | 'malayalam'
  | 'kannada';

export type TeachingMode =
  | 'simple_explanation'
  | 'cultural_analogy'
  | 'visual_learning'
  | 'mother_tongue'
  | 'technical_deep_dive'
  | 'exam_preparation'
  | 'practical_application'
  | 'code_explanation'
  | 'step_by_step';

export type LearnerLevel = 'unspecified' | 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  id: string;
  lang: Language;
  name: string;
  icon: string;
  instruction: string;
  dialectLabel?: string;
  register?: string;
  culturalAffinity?: string[];
}

export interface DiagramNode {
  id: string;
  label: string;
  role?: string;
  detail?: string;
  group?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  title: string;
  kind: 'flow' | 'architecture' | 'memory' | 'timeline';
  caption?: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface ExplanationMeta {
  teachingMode: TeachingMode;
  secondaryModes?: TeachingMode[];
  complexity: 'simple' | 'complex';
  learnerLevel: LearnerLevel;
  analogyDomain?: string;
  misconceptionDetected?: boolean;
  misconceptionSummary?: string;
  understandingCheckIncluded?: boolean;
  topicSummary?: string;
  diagram?: DiagramSpec | null;
  followUpSuggestions?: string[];
}

export interface Explanation {
  id: string;
  term: string;
  englishResponse: string;
  regionalResponse: string;
  timestamp: number;
  profileId: string;
  meta?: ExplanationMeta;
  savedId?: string;
  isBookmarked?: boolean;
}

export interface SessionTurnSummary {
  term: string;
  topicSummary: string;
  teachingMode?: TeachingMode;
  analogyDomain?: string;
  misconceptionSummary?: string;
}

export interface SessionContextPayload {
  activeProfileId: string;
  recentTurns: SessionTurnSummary[];
  olderTopicsSummary: string;
  avoidAnalogies: string[];
  sessionMisconceptions: string[];
}

// ========================
// PHASE B: ADAPTIVE ASSESSMENT, MASTERY & LEARNING GAP ENGINE
// ========================

export type AssessmentType =
  | 'diagnostic'
  | 'beginner'
  | 'adaptive_practice'
  | 'concept_mastery'
  | 'application'
  | 'scenario'
  | 'retention'
  | 'exam_prep'
  | 'code';

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'short_answer'
  | 'scenario'
  | 'conceptual'
  | 'application'
  | 'code'
  | 'debugging';

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type AttemptStatus = 'created' | 'in_progress' | 'completed' | 'abandoned';

export type ConfidenceState =
  | 'insufficient_evidence'
  | 'low_confidence'
  | 'moderate_confidence'
  | 'high_confidence';

export type MasteryBand =
  | 'FOUNDATION_REQUIRED'
  | 'DEVELOPING'
  | 'FUNCTIONAL_UNDERSTANDING'
  | 'STRONG_UNDERSTANDING';

export type MisconceptionCategory =
  | 'Conceptual misunderstanding'
  | 'Terminology confusion'
  | 'Incorrect reasoning'
  | 'Procedural error'
  | 'Calculation mistake'
  | 'Syntax mistake'
  | 'Misinterpretation'
  | 'Missing prerequisite knowledge';

export type GapType =
  | 'low_mastery'
  | 'repeated_errors'
  | 'repeated_misconception'
  | 'missing_prerequisite'
  | 'weak_foundation'
  | 'inconsistent_performance'
  | 'retention_revision_needed'
  | 'declining_performance';

export type AdaptiveAction =
  | 'RE-TEACH'
  | 'ANALOGY'
  | 'GUIDED_PRACTICE'
  | 'FOUNDATIONAL_PRACTICE'
  | 'APPLICATION'
  | 'ADVANCED_PRACTICE'
  | 'RETENTION_REVISION'
  | 'ADVANCE';

export type DiagnosticOutcomeLevel =
  | 'Foundation level'
  | 'Developing level'
  | 'Intermediate level'
  | 'Advanced understanding';

export interface PublicQuestion {
  id: string;
  attemptId: string;
  questionIndex: number;
  conceptId: string;
  subject: string;
  questionText: string;
  questionType: QuestionType;
  difficultyLevel: DifficultyLevel;
  learningObjective: string;
  options?: string[];
  codeSnippet?: string;
}

export interface GenerateAssessmentRequest {
  concept: string;
  subject?: string;
  assessmentType: AssessmentType;
  difficulty?: DifficultyLevel;
  questionCount?: number;
  profileId: string;
  learningObjective?: string;
}

export interface GenerateAssessmentResponse {
  attemptId: string;
  conceptId: string;
  conceptName: string;
  subject: string;
  assessmentType: AssessmentType;
  difficulty: DifficultyLevel;
  totalQuestions: number;
  questions: PublicQuestion[];
  currentMastery?: ConceptMasterySummary | null;
}

export interface SubmitAnswerRequest {
  attemptId: string;
  questionId: string;
  submittedAnswer: string;
  timeTakenMs?: number;
}

export interface MisconceptionObservation {
  id?: string;
  conceptId: string;
  category: MisconceptionCategory;
  description: string;
  evidenceFromAnswer: string;
  confidence: number;
  recommendedIntervention: string;
  occurrenceCount: number;
  isPattern: boolean;
}

export interface SubmitAnswerResponse {
  answerId: string;
  questionId: string;
  attemptId: string;
  evaluationResult: 'correct' | 'partially_correct' | 'incorrect' | 'uncertain';
  score: number;
  confidence: number;
  evaluationStatus: 'evaluated' | 'uncertain_needs_review' | 'fallback_partial';
  feedback: string;
  correctAnswer: string;
  answerExplanation: string;
  missingConcepts: string[];
  keyPointsPresent: string[];
  keyPointsMissing: string[];
  misconception?: MisconceptionObservation | null;
  recommendation: string;
  nextRecommendedDifficulty: DifficultyLevel;
  teachingInterventionTriggered: boolean;
  nextQuestion?: PublicQuestion | null;
  attemptProgress: {
    answeredCount: number;
    totalQuestions: number;
    correctCount: number;
    incorrectCount: number;
    partialCount: number;
    currentScore: number;
    status: AttemptStatus;
  };
}

export interface ConceptMasterySummary {
  conceptId: string;
  conceptName: string;
  subject: string;
  status: 'ASSESSED' | 'NOT ASSESSED';
  quizAccuracy: number | null;
  practicalPerformance: number | null;
  retentionPerformance: number | null;
  masteryScore: number | null;
  isProvisional: boolean;
  confidenceState: ConfidenceState;
  classificationBand: MasteryBand | null;
  attemptsCount: number;
  evidenceCount: number;
  highestDifficultyPassed: number;
  recentTrend: 'improving' | 'stable' | 'declining';
  lastAssessedAt?: number;
}

export interface PrerequisiteStatus {
  conceptId: string;
  conceptName: string;
  rationale: string;
  status: 'ASSESSED' | 'NOT ASSESSED';
  masteryScore: number | null;
  classificationBand: MasteryBand | null;
  needsReinforcement: boolean;
}

export interface LearningGapRecord {
  conceptId: string;
  conceptName: string;
  gapType: GapType;
  evidence: string;
  confidence: ConfidenceState;
  priority: 'high' | 'medium' | 'low';
  recommendedIntervention: string;
  recommendedLearningMode: TeachingMode;
  suggestedNextActivity: AdaptiveAction;
}

export interface AdaptiveDecision {
  conceptId: string;
  conceptName: string;
  masteryScore: number | null;
  evidenceConfidence: ConfidenceState;
  learningStatus: string;
  recommendedAction: AdaptiveAction;
  recommendedAssessmentType: AssessmentType;
  recommendedTeachingMode: TeachingMode;
  reason: string;
  prerequisiteAlerts: PrerequisiteStatus[];
  learningGaps: LearningGapRecord[];
  requiresUserConsent: boolean;
  nextConceptSuggestion?: string;
}

export interface DiagnosticSummary {
  subject: string;
  conceptName: string;
  level: DiagnosticOutcomeLevel;
  isProvisional: boolean;
  knowledgeGaps: string[];
  recommendedTeachingApproach: string;
}

export interface PostAssessmentSummary {
  attemptId: string;
  conceptId: string;
  conceptName: string;
  subject: string;
  assessmentType: AssessmentType;
  status: AttemptStatus;
  score: number;
  totalQuestions: number;
  answeredQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  partialCreditAnswers: number;
  conceptsAssessed: string[];
  performanceByConcept: Array<{
    conceptId: string;
    conceptName: string;
    averageScore: number;
    questionsCount: number;
  }>;
  misconceptionsIdentified: MisconceptionObservation[];
  learningGaps: LearningGapRecord[];
  mastery: ConceptMasterySummary;
  previousMasteryScore: number | null;
  diagnosticOutcome?: DiagnosticSummary | null;
  adaptiveDecision: AdaptiveDecision;
  insufficientDataNotice?: string;
}

export interface LearnerOverviewResponse {
  learnerId: string;
  masteries: ConceptMasterySummary[];
  learningGaps: LearningGapRecord[];
  repeatedMisconceptions: MisconceptionObservation[];
  recentAttempts: Array<{
    attemptId: string;
    conceptId: string;
    conceptName: string;
    assessmentType: AssessmentType;
    score: number;
    status: AttemptStatus;
    totalQuestions: number;
    answeredCount: number;
    startTime: number;
    completionTime?: number | null;
  }>;
}

// ========================
// PHASE C: AUTH, PROFILE, PLAYGROUND, PATHS, STUDY PLANNER & SPACED REVISION
// ========================

export type WorkspaceView = 'dashboard' | 'tutor' | 'playground' | 'planner';
export type ThemeMode = 'dark' | 'light';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: number;
}

export interface UserProfile {
  userId: string;
  preferredProfileId: string;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  learningGoals: string[];
  subjects: string[];
  teachingPreference: TeachingMode;
  dailyStudyMinutes: number;
  targetDeadline?: string | null;
  onboardingCompleted: boolean;
  themePreference: ThemeMode;
  updatedAt: number;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  learnerId: string;
  token?: string;
  user: AuthUser | null;
  profile: UserProfile;
}

export interface SavedLessonRecord {
  id: string;
  term: string;
  conceptId: string;
  profileId: string;
  teachingMode: TeachingMode;
  englishResponse: string;
  regionalResponse: string;
  diagram?: DiagramSpec | null;
  meta?: ExplanationMeta | null;
  isBookmarked: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ProgrammingLanguage = 'javascript' | 'python' | 'java' | 'c' | 'cpp';

export interface LanguageCapability {
  language: ProgrammingLanguage;
  label: string;
  available: boolean;
  executionMode: 'worker_sandbox' | 'remote_sandbox' | 'ai_trace_only';
  note: string;
}

export interface CodeExecutionResult {
  language: ProgrammingLanguage;
  executed: boolean;
  executionMode: 'worker_sandbox' | 'remote_sandbox' | 'unconfigured';
  status: 'success' | 'compile_error' | 'runtime_error' | 'timeout' | 'unconfigured';
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  executionTimeMs: number;
  message?: string;
}

export interface CodeSubmissionRecord {
  id: string;
  lessonId?: string | null;
  language: ProgrammingLanguage;
  code: string;
  stdin: string;
  stdout: string;
  stderr: string;
  status: string;
  executionTimeMs: number;
  aiFeedback?: string | null;
  createdAt: number;
}

export interface ProgrammingLesson {
  id: string;
  track: 'python' | 'java' | 'javascript';
  order: number;
  title: string;
  conceptId: string;
  language: ProgrammingLanguage;
  summary: string;
  starterCode: string;
  expectedGoal: string;
  hints: string[];
  sampleSolution: string;
  difficulty: 'beginner' | 'intermediate';
  status?: 'not_started' | 'in_progress' | 'completed';
  lastCode?: string;
}

export type PlaygroundHelpAction =
  | 'explain_code'
  | 'line_by_line'
  | 'explain_error'
  | 'hint'
  | 'simplify'
  | 'challenge';

export interface PlaygroundHelpResponse {
  action: PlaygroundHelpAction;
  english: string;
  regional: string;
  hintOnly?: boolean;
  suggestedChallenge?: {
    title: string;
    prompt: string;
    starterCode: string;
    hints: string[];
  };
}

export interface LearningPathNode {
  id: string;
  conceptId: string;
  conceptName: string;
  subject: string;
  order: number;
  status: 'locked' | 'ready' | 'in_progress' | 'completed' | 'needs_revision';
  masteryScore: number | null;
  prerequisiteIds: string[];
  recommendedMode: TeachingMode;
  rationale: string;
}

export interface LearningPath {
  id: string;
  title: string;
  goal: string;
  nodes: LearningPathNode[];
  updatedAt: number;
}

export interface StudyTask {
  id: string;
  title: string;
  conceptId: string;
  conceptName: string;
  taskType: 'learn' | 'practice' | 'revision' | 'coding' | 'assessment';
  dueDate: string; // YYYY-MM-DD
  estimatedMinutes: number;
  status: 'pending' | 'completed' | 'skipped';
  notes?: string;
  completedAt?: number | null;
  createdAt: number;
}

export interface RevisionScheduleItem {
  conceptId: string;
  conceptName: string;
  intervalDays: number;
  nextReviewAt: number;
  lastReviewedAt?: number | null;
  lastScore?: number | null;
  status: 'due' | 'upcoming' | 'overdue' | 'retained';
  isDueNow: boolean;
}

export interface PlatformDashboardData {
  auth: {
    authenticated: boolean;
    user: AuthUser | null;
    profile: UserProfile;
  };
  overview: LearnerOverviewResponse;
  savedLessons: SavedLessonRecord[];
  learningPath: LearningPath;
  studyTasks: StudyTask[];
  revisions: RevisionScheduleItem[];
  lessons: ProgrammingLesson[];
  recentSubmissions: CodeSubmissionRecord[];
  capabilities: LanguageCapability[];
}
