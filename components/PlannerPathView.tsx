import React, { useState } from 'react';
import type {
  PlatformDashboardData,
  SavedLessonRecord,
  StudyTask,
} from '../types';
import {
  createStudyTaskClient,
  deleteSavedLessonClient,
  deleteStudyTaskClient,
  generateStudyPlanClient,
  regenerateLearningPathClient,
  updateStudyTaskClient,
} from '../services/platformService';

interface PlannerPathViewProps {
  data: PlatformDashboardData | null;
  onRefreshDashboard: () => Promise<void>;
  onStartTopic: (concept: string, mode?: any) => void;
  onOpenSavedLesson: (lesson: SavedLessonRecord) => void;
}

const PlannerPathView: React.FC<PlannerPathViewProps> = ({
  data,
  onRefreshDashboard,
  onStartTopic,
  onOpenSavedLesson,
}) => {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskConcept, setTaskConcept] = useState('');
  const [taskDue, setTaskDue] = useState(new Date().toISOString().slice(0, 10));
  const [taskMinutes, setTaskMinutes] = useState(25);
  const [error, setError] = useState<string | null>(null);

  const learningPath = data?.learningPath;
  const tasks = data?.studyTasks || [];
  const revisions = data?.revisions || [];
  const savedLessons = data?.savedLessons || [];

  const handleRegeneratePath = async () => {
    setBusyAction('path');
    setError(null);
    try {
      await regenerateLearningPathClient();
      await onRefreshDashboard();
    } catch (err: any) {
      setError(err?.message || 'Could not update learning path.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleGeneratePlan = async () => {
    setBusyAction('plan');
    setError(null);
    try {
      await generateStudyPlanClient();
      await onRefreshDashboard();
    } catch (err: any) {
      setError(err?.message || 'Could not generate study plan.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setBusyAction('add');
    setError(null);
    try {
      await createStudyTaskClient({
        title: taskTitle.trim(),
        conceptName: taskConcept.trim() || taskTitle.trim(),
        dueDate: taskDue,
        estimatedMinutes: taskMinutes,
      });
      setTaskTitle('');
      setTaskConcept('');
      await onRefreshDashboard();
    } catch (err: any) {
      setError(err?.message || 'Could not add task.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateTask = async (task: StudyTask, nextStatus: StudyTask['status']) => {
    try {
      await updateStudyTaskClient(task.id, { status: nextStatus });
      await onRefreshDashboard();
    } catch (err: any) {
      setError(err?.message || 'Could not update task.');
    }
  };

  const handleRescheduleTomorrow = async (task: StudyTask) => {
    const base = new Date(task.dueDate || Date.now());
    const next = new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10);
    try {
      await updateStudyTaskClient(task.id, { dueDate: next });
      await onRefreshDashboard();
    } catch (err: any) {
      setError(err?.message || 'Could not reschedule task.');
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await deleteStudyTaskClient(id);
      await onRefreshDashboard();
    } catch {
      // ignore
    }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await deleteSavedLessonClient(id);
      await onRefreshDashboard();
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {error && (
        <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/25 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Section 1: Personalized Learning Path */}
      <section className="lm-surface rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {learningPath?.title || 'Personalized Learning Path'}
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {learningPath?.goal || 'Prerequisite-ordered topics adapting automatically as your mastery progresses.'}
            </p>
          </div>

          <button
            onClick={handleRegeneratePath}
            disabled={busyAction === 'path'}
            className="px-4 py-2 rounded-full lm-btn-outline text-xs font-medium flex items-center gap-2 disabled:opacity-45"
            style={{ color: 'var(--text-secondary)' }}
          >
            <i className={`fa-solid fa-arrows-rotate ${busyAction === 'path' ? 'animate-spin' : ''}`}></i>
            <span>Refresh Path</span>
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(learningPath?.nodes || []).map((node) => {
            const statusColor =
              node.status === 'completed'
                ? 'lm-accent-text'
                : node.status === 'needs_revision'
                  ? 'text-amber-400'
                  : node.status === 'in_progress'
                    ? 'text-white'
                    : node.status === 'locked'
                      ? 'opacity-50'
                      : 'lm-accent-text';

            return (
              <div key={node.id} className="p-4 rounded-xl lm-inset flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
                    <span className="font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>Step {node.order}</span>
                    <span className={statusColor}>{node.status.replace('_', ' ')}</span>
                  </div>
                  <div className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {node.conceptName}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {node.rationale}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span className="font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {node.masteryScore !== null ? `${node.masteryScore}% mastery` : 'Not assessed'}
                  </span>
                  <button
                    onClick={() => onStartTopic(node.conceptName, node.recommendedMode)}
                    className="font-semibold lm-accent-text hover:underline"
                  >
                    {node.status === 'completed' ? 'Review' : 'Study Now'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Section 2: Smart Study Planner */}
        <section className="lg:col-span-7 lm-surface rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                Smart Study Planner
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Auto-balances weak concepts, learning path steps, and assessments within your daily minutes.
              </p>
            </div>
            <button
              onClick={handleGeneratePlan}
              disabled={busyAction === 'plan'}
              className="px-4 py-2 rounded-full lm-btn-primary text-xs font-semibold flex items-center gap-2 disabled:opacity-45"
            >
              <i className={`fa-solid ${busyAction === 'plan' ? 'fa-spinner animate-spin' : 'fa-wand-magic-sparkles'}`}></i>
              <span>Generate Smart Plan</span>
            </button>
          </div>

          <form onSubmit={handleAddTask} className="grid sm:grid-cols-12 gap-2">
            <input
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Add custom study task..."
              className="sm:col-span-5 px-3.5 py-2 rounded-full lm-inset lm-input text-xs outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <input
              type="text"
              value={taskConcept}
              onChange={(e) => setTaskConcept(e.target.value)}
              placeholder="Concept (e.g. SQL)"
              className="sm:col-span-3 px-3.5 py-2 rounded-full lm-inset lm-input text-xs outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <input
              type="date"
              value={taskDue}
              onChange={(e) => setTaskDue(e.target.value)}
              className="sm:col-span-2 px-2.5 py-2 rounded-full lm-inset lm-input text-xs outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            <button
              type="submit"
              disabled={!taskTitle.trim() || busyAction === 'add'}
              className="sm:col-span-2 px-3 py-2 rounded-full lm-btn-outline text-xs font-semibold disabled:opacity-45"
            >
              Add Task
            </button>
          </form>

          {tasks.length === 0 ? (
            <div className="p-6 rounded-xl lm-inset text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Click Generate Smart Plan to create personalized daily study tasks from your path and assessments.
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-3.5 rounded-xl lm-inset flex flex-wrap items-center justify-between gap-3 ${
                    task.status === 'completed' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() =>
                        handleUpdateTask(task, task.status === 'completed' ? 'pending' : 'completed')
                      }
                      className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        task.status === 'completed'
                          ? 'lm-accent-soft'
                          : ''
                      }`}
                      style={task.status === 'completed' ? undefined : { borderColor: 'var(--accent-border)' }}
                      aria-label="Toggle task completion"
                    >
                      {task.status === 'completed' && <i className="fa-solid fa-check text-[10px]"></i>}
                    </button>
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-semibold truncate ${task.status === 'completed' ? 'line-through' : ''}`}
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {task.title}
                      </div>
                      <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        Due {task.dueDate} • {task.estimatedMinutes} mins • {task.taskType}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {task.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleRescheduleTomorrow(task)}
                          className="px-2.5 py-1 rounded-full lm-btn-outline text-xs"
                          style={{ color: 'var(--text-muted)' }}
                          title="Reschedule +1 day"
                        >
                          +1d
                        </button>
                        <button
                          onClick={() => onStartTopic(task.conceptName)}
                          className="px-3 py-1 rounded-full lm-accent-soft text-xs font-semibold"
                        >
                          Open
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="px-2 py-1 rounded-lg text-xs text-zinc-500 hover:text-red-400"
                      aria-label="Delete task"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: Spaced Revision + Saved Library */}
        <aside className="lg:col-span-5 space-y-6">
          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                Spaced Revision Queue
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Intervals adjust automatically from mastery and retention verification scores.
              </p>
            </div>

            {revisions.length === 0 ? (
              <div className="p-5 rounded-xl lm-inset text-xs" style={{ color: 'var(--text-muted)' }}>
                Complete an assessment in the AI Tutor to schedule evidence-based spaced revisions.
              </div>
            ) : (
              <div className="space-y-2.5">
                {revisions.map((rev) => (
                  <div key={rev.conceptId} className="p-3.5 rounded-xl lm-inset flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {rev.conceptName}
                      </div>
                      <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        Every {rev.intervalDays}d •{' '}
                        {rev.isDueNow
                          ? 'Due now'
                          : `Next: ${new Date(rev.nextReviewAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <button
                      onClick={() => onStartTopic(rev.conceptName, 'exam_preparation')}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                        rev.isDueNow
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'lm-btn-outline lm-accent-text'
                      }`}
                    >
                      {rev.isDueNow ? 'Revise Now' : 'Review'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lm-surface rounded-2xl p-6 space-y-4">
            <h2 className="font-display font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              Saved Lessons Library
            </h2>
            {savedLessons.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No saved lessons yet. Click Save on any explanation card in the AI Tutor.
              </p>
            ) : (
              <div className="space-y-2">
                {savedLessons.map((lsn) => (
                  <div key={lsn.id} className="p-3 rounded-xl lm-inset flex items-center justify-between gap-3">
                    <button
                      onClick={() => onOpenSavedLesson(lsn)}
                      className="text-left min-w-0 flex-1"
                    >
                      <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {lsn.term}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {lsn.teachingMode.replace(/_/g, ' ')}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteSaved(lsn.id)}
                      className="text-xs text-zinc-500 hover:text-red-400 px-2 py-1"
                      aria-label="Remove saved lesson"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default PlannerPathView;
