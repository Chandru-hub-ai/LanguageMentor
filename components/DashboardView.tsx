import React from 'react';
import type {
  PlatformDashboardData,
  ProgrammingLesson,
  SavedLessonRecord,
  WorkspaceView,
} from '../types';
import { LANGUAGE_PROFILES } from '../constants';

interface DashboardViewProps {
  data: PlatformDashboardData | null;
  loading: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onOpenOnboarding: () => void;
  onOpenAuth: () => void;
  onStartTopic: (concept: string) => void;
  onOpenSavedLesson: (lesson: SavedLessonRecord) => void;
  onOpenProgrammingLesson: (lesson: ProgrammingLesson) => void;
  onToggleTaskComplete: (taskId: string, done: boolean) => void;
}

const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  loading,
  onNavigate,
  onOpenOnboarding,
  onOpenAuth,
  onStartTopic,
  onOpenSavedLesson,
  onOpenProgrammingLesson,
  onToggleTaskComplete,
}) => {
  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-pulse">
        <div className="h-28 rounded-2xl lm-surface"></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl lm-surface"></div>
          ))}
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-64 rounded-2xl lm-surface"></div>
          <div className="h-64 rounded-2xl lm-surface"></div>
        </div>
      </div>
    );
  }

  const user = data?.auth.user || null;
  const profile = data?.auth.profile;
  const masteries = data?.overview.masteries || [];
  const gaps = data?.overview.learningGaps || [];
  const tasks = data?.studyTasks || [];
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const revisions = data?.revisions || [];
  const dueRevisions = revisions.filter((r) => r.isDueNow);
  const pathNodes = data?.learningPath.nodes || [];
  const nextPathNode = pathNodes.find((n) => n.status === 'needs_revision' || n.status === 'in_progress' || n.status === 'ready');
  const completedLessonsCount = (data?.lessons || []).filter((l) => l.status === 'completed').length;
  const totalLessonsCount = (data?.lessons || []).length;

  const langProfile = LANGUAGE_PROFILES.find((p) => p.id === profile?.preferredProfileId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Welcome Banner */}
      <section className="lm-surface rounded-2xl p-6 sm:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-ui font-medium" style={{ color: 'var(--text-muted)' }}>
            <span className="lm-accent-text">{langProfile?.icon} {langProfile?.name || 'Standard Tamil'}</span>
            <span>•</span>
            <span className="capitalize">{profile?.skillLevel || 'beginner'} track</span>
            {profile?.dailyStudyMinutes && (
              <>
                <span>•</span>
                <span className="font-mono tabular-nums">{profile.dailyStudyMinutes} mins/day goal</span>
              </>
            )}
          </div>
          <h1 className="font-editorial text-3xl sm:text-4xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {user ? `Welcome back, ${user.fullName.split(' ')[0]}` : 'Welcome to Language Mentor'}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {profile?.learningGoals.length
              ? `Active focus: ${profile.learningGoals.slice(0, 2).join(' • ')}`
              : 'Understand complex technical concepts through clear regional intuition, interactive diagrams, coding practice, and adaptive assessments.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!user && (
            <button
              onClick={onOpenAuth}
              className="px-4 py-2.5 rounded-full lm-btn-outline text-xs font-medium"
            >
              Sign In to Sync Account
            </button>
          )}
          {!profile?.onboardingCompleted && (
            <button
              onClick={onOpenOnboarding}
              className="px-4 py-2.5 rounded-full lm-btn-outline text-xs font-medium"
            >
              Set Learning Goals
            </button>
          )}
          <button
            onClick={() => (nextPathNode ? onStartTopic(nextPathNode.conceptName) : onNavigate('tutor'))}
            className="px-5 py-2.5 rounded-full lm-btn-primary text-xs font-semibold flex items-center gap-2"
          >
            <i className="fa-solid fa-play text-[10px]"></i>
            <span>{nextPathNode ? `Continue: ${nextPathNode.conceptName}` : 'Ask AI Tutor'}</span>
          </button>
        </div>
      </section>

      {/* Metrics Row (Real database-derived metrics only) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="lm-surface rounded-2xl p-5 space-y-1">
          <div className="text-xs font-ui font-medium" style={{ color: 'var(--text-muted)' }}>Assessed Concepts</div>
          <div className="text-2xl font-display font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {masteries.length}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {gaps.length > 0 ? `${gaps.length} gap${gaps.length > 1 ? 's' : ''} to reinforce` : 'Take a quiz in AI Tutor'}
          </div>
        </div>

        <div className="lm-surface rounded-2xl p-5 space-y-1">
          <div className="text-xs font-ui font-medium" style={{ color: 'var(--text-muted)' }}>Due Revisions</div>
          <div className="text-2xl font-display font-bold tabular-nums" style={{ color: dueRevisions.length > 0 ? '#f59e0b' : 'var(--text-primary)' }}>
            {dueRevisions.length}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {revisions.length > 0 ? `${revisions.length} scheduled total` : 'Builds from assessments'}
          </div>
        </div>

        <div className="lm-surface rounded-2xl p-5 space-y-1">
          <div className="text-xs font-ui font-medium" style={{ color: 'var(--text-muted)' }}>Study Tasks Pending</div>
          <div className="text-2xl font-display font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {pendingTasks.length}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {tasks.filter((t) => t.status === 'completed').length} completed
          </div>
        </div>

        <div className="lm-surface rounded-2xl p-5 space-y-1">
          <div className="text-xs font-ui font-medium" style={{ color: 'var(--text-muted)' }}>Coding Lessons</div>
          <div className="text-2xl font-display font-bold tabular-nums lm-accent-text">
            {completedLessonsCount}/{totalLessonsCount}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Python, Java & JavaScript
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Learning Path & Today's Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Concept Mastery + Weak Areas */}
          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                  Concept Mastery & Adaptive Gaps
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Computed directly from your completed assessments and retention checks.
                </p>
              </div>
              <button
                onClick={() => onNavigate('planner')}
                className="text-xs font-semibold lm-accent-text hover:underline whitespace-nowrap"
              >
                Full Roadmap
              </button>
            </div>

            {masteries.length === 0 ? (
              <div className="p-6 rounded-xl lm-inset text-center space-y-3">
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  No concept assessments recorded yet. Ask the AI Tutor about a topic and run a quick assessment to unlock adaptive mastery tracking.
                </p>
                <button
                  onClick={() => onStartTopic('Cloud Computing')}
                  className="px-5 py-2 rounded-full lm-btn-primary text-xs font-semibold"
                >
                  Explore First Topic: Cloud Computing
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                      <th className="py-2 pr-4 font-semibold">Concept</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                      <th className="py-2 px-3 font-semibold text-right">Mastery</th>
                      <th className="py-2 pl-3 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
                    {masteries.slice(0, 6).map((m) => (
                      <tr key={m.conceptId}>
                        <td className="py-3 pr-4">
                          <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{m.conceptName}</div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.subject}</div>
                        </td>
                        <td className="py-3 px-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {m.classificationBand?.replace(/_/g, ' ') || 'Developing'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold tabular-nums lm-accent-text">
                          {m.masteryScore !== null ? `${m.masteryScore}%` : '—'}
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <button
                            onClick={() => onStartTopic(m.conceptName)}
                            className="text-xs font-semibold lm-accent-text hover:underline"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Today's Study Planner Tasks */}
          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                  Upcoming Study Tasks
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Personalized to your daily budget and detected learning gaps.
                </p>
              </div>
              <button
                onClick={() => onNavigate('planner')}
                className="text-xs font-semibold lm-accent-text hover:underline whitespace-nowrap"
              >
                Manage Plan
              </button>
            </div>

            {pendingTasks.length === 0 ? (
              <div className="p-5 rounded-xl lm-inset flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  No pending study tasks. Generate a weekly schedule in Study Plan.
                </p>
                <button
                  onClick={() => onNavigate('planner')}
                  className="px-4 py-2 rounded-full lm-btn-primary text-xs font-semibold shrink-0"
                >
                  Open Study Planner
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingTasks.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    className="p-3.5 rounded-xl lm-inset flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleTaskComplete(task.id, true)}
                      className="flex items-center gap-3 text-left min-w-0 flex-1"
                    >
                      <span
                        className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0 hover:opacity-80"
                        style={{ borderColor: 'var(--accent-border)' }}
                      >
                        <i className="fa-solid fa-check text-[10px] opacity-0 hover:opacity-100 lm-accent-text"></i>
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {task.title}
                        </div>
                        <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          Due {task.dueDate} • {task.estimatedMinutes} min • {task.taskType}
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => onStartTopic(task.conceptName)}
                      className="px-3.5 py-1.5 rounded-full lm-btn-outline text-xs font-medium shrink-0"
                    >
                      Start
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Saved Lessons & Programming Track */}
        <div className="space-y-6">
          {/* Coding Playground Tracks */}
          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                Programming Tracks
              </h2>
              <button
                onClick={() => onNavigate('playground')}
                className="text-xs font-semibold lm-accent-text hover:underline"
              >
                Open Playground
              </button>
            </div>
            <div className="space-y-2.5">
              {(data?.lessons || []).slice(0, 4).map((lesson) => (
                <button
                  key={lesson.id}
                  onClick={() => onOpenProgrammingLesson(lesson)}
                  className="w-full p-3.5 rounded-xl lm-inset hover:border-white/30 text-left transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider lm-accent-text">
                      {lesson.language}
                    </div>
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {lesson.title}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold shrink-0 ${
                      lesson.status === 'completed' ? 'lm-accent-text' : 'opacity-60'
                    }`}
                  >
                    {lesson.status === 'completed' ? 'Done' : 'Practice'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Saved Lessons */}
          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                Saved Lessons
              </h2>
              <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {data?.savedLessons.length || 0} saved
              </span>
            </div>

            {!data?.savedLessons.length ? (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Bookmark any explanation card in the AI Tutor to access it offline inside your library.
              </p>
            ) : (
              <div className="space-y-2">
                {data.savedLessons.slice(0, 5).map((lsn) => (
                  <button
                    key={lsn.id}
                    onClick={() => onOpenSavedLesson(lsn)}
                    className="w-full p-3 rounded-xl lm-inset hover:border-white/30 text-left transition-colors"
                  >
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {lsn.term}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {lsn.teachingMode.replace(/_/g, ' ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
