import React, { useState } from 'react';
import { LANGUAGE_PROFILES } from '../constants';
import type { AuthUser, TeachingMode, UserProfile } from '../types';
import { updateProfileClient } from '../services/platformService';

interface OnboardingPanelProps {
  isOpen: boolean;
  user: AuthUser | null;
  profile: UserProfile;
  onClose: () => void;
  onSaved: (updated: { user: AuthUser | null; profile: UserProfile }) => void;
}

const GOAL_OPTIONS = [
  'Master CS fundamentals',
  'Learn Python programming',
  'Learn Java programming',
  'Crack technical interviews',
  'Ace university exams',
  'Build web apps & APIs',
];

const SUBJECT_OPTIONS = [
  'Programming & DSA',
  'Web, APIs & Cloud',
  'Databases & Systems',
  'AI & Data Science',
];

const TEACHING_PREF_OPTIONS: Array<{ value: TeachingMode; label: string }> = [
  { value: 'cultural_analogy', label: 'Real-World Cultural Analogies' },
  { value: 'simple_explanation', label: 'Beginner-Friendly Plain Intuition' },
  { value: 'visual_learning', label: 'Visual Flow & Architecture Diagrams' },
  { value: 'step_by_step', label: 'Step-by-Step Walkthrough' },
  { value: 'practical_application', label: 'Practical & Industry Scenarios' },
  { value: 'exam_preparation', label: 'Exam & University Prep Structure' },
  { value: 'code_explanation', label: 'Code-First Line-by-Line Teaching' },
];

const OnboardingPanel: React.FC<OnboardingPanelProps> = ({
  isOpen,
  user,
  profile,
  onClose,
  onSaved,
}) => {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [preferredProfileId, setPreferredProfileId] = useState(profile.preferredProfileId);
  const [skillLevel, setSkillLevel] = useState<UserProfile['skillLevel']>(profile.skillLevel);
  const [learningGoals, setLearningGoals] = useState<string[]>(profile.learningGoals);
  const [subjects, setSubjects] = useState<string[]>(
    profile.subjects.length ? profile.subjects : ['Programming & DSA']
  );
  const [teachingPreference, setTeachingPreference] = useState<TeachingMode>(
    profile.teachingPreference
  );
  const [dailyStudyMinutes, setDailyStudyMinutes] = useState<number>(profile.dailyStudyMinutes || 30);
  const [targetDeadline, setTargetDeadline] = useState<string>(profile.targetDeadline || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleItem = (list: string[], value: string, setter: (v: string[]) => void) => {
    if (list.includes(value)) {
      setter(list.filter((x) => x !== value));
    } else {
      setter([...list, value]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfileClient({
        fullName: user && fullName.trim().length >= 2 ? fullName.trim() : undefined,
        preferredProfileId,
        skillLevel,
        learningGoals,
        subjects,
        teachingPreference,
        dailyStudyMinutes,
        targetDeadline: targetDeadline || null,
        onboardingCompleted: true,
      });
      onSaved(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl lm-surface shadow-2xl">
        <div
          className="px-6 py-4 border-b flex items-center justify-between sticky top-0 z-10 backdrop-blur-xl"
          style={{ backgroundColor: 'var(--header-bg)', borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <h2 className="font-editorial font-semibold text-xl" style={{ color: 'var(--text-primary)' }}>
              {profile.onboardingCompleted ? 'Learning Profile & Preferences' : 'Personalize Your Learning Path'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Tailors AI explanations, study plans, and recommended tracks to your level and language.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full lm-btn-outline flex items-center justify-center"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close preferences"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-400">
              {error}
            </div>
          )}

          {user && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Display Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Preferred Language / Dialect
              </label>
              <select
                value={preferredProfileId}
                onChange={(e) => setPreferredProfileId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              >
                {LANGUAGE_PROFILES.map((p) => (
                  <option key={p.id} value={p.id} className="lm-option">
                    {p.icon} {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Current Skill Level
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['beginner', 'intermediate', 'advanced'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSkillLevel(lvl)}
                    className={`py-2.5 rounded-full text-xs font-semibold capitalize border transition-colors ${
                      skillLevel === lvl ? 'lm-tab-active' : 'lm-btn-outline'
                    }`}
                    style={skillLevel === lvl ? undefined : { color: 'var(--text-secondary)' }}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Focus Subjects
            </label>
            <div className="grid sm:grid-cols-2 gap-2">
              {SUBJECT_OPTIONS.map((subj) => {
                const selected = subjects.includes(subj);
                return (
                  <button
                    key={subj}
                    type="button"
                    onClick={() => toggleItem(subjects, subj, setSubjects)}
                    className={`px-3.5 py-2.5 rounded-xl text-left text-xs font-semibold border flex items-center justify-between transition-colors ${
                      selected ? 'lm-accent-soft' : 'lm-inset hover:border-white/30'
                    }`}
                    style={selected ? undefined : { color: 'var(--text-secondary)' }}
                  >
                    <span>{subj}</span>
                    {selected && <i className="fa-solid fa-check"></i>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Learning Goals
            </label>
            <div className="grid sm:grid-cols-2 gap-2">
              {GOAL_OPTIONS.map((goal) => {
                const selected = learningGoals.includes(goal);
                return (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => toggleItem(learningGoals, goal, setLearningGoals)}
                    className={`px-3.5 py-2.5 rounded-xl text-left text-xs font-medium border flex items-center justify-between transition-colors ${
                      selected ? 'lm-accent-soft' : 'lm-inset hover:border-white/30'
                    }`}
                    style={selected ? undefined : { color: 'var(--text-secondary)' }}
                  >
                    <span>{goal}</span>
                    {selected && <i className="fa-solid fa-check"></i>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Default Teaching Strategy
              </label>
              <select
                value={teachingPreference}
                onChange={(e) => setTeachingPreference(e.target.value as TeachingMode)}
                className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                style={{ color: 'var(--text-primary)' }}
              >
                {TEACHING_PREF_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="lm-option">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Daily Study (mins)
              </label>
              <input
                type="number"
                min={10}
                max={240}
                step={5}
                value={dailyStudyMinutes}
                onChange={(e) => setDailyStudyMinutes(Number(e.target.value) || 30)}
                className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm font-mono tabular-nums outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Target Exam / Milestone Date (Optional)
            </label>
            <input
              type="date"
              value={targetDeadline}
              onChange={(e) => setTargetDeadline(e.target.value)}
              className="w-full sm:w-64 px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-full lm-btn-outline text-xs font-semibold"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-full lm-btn-primary text-xs font-semibold disabled:opacity-45"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OnboardingPanel;
