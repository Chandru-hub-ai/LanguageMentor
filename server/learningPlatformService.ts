import crypto from "crypto";
import { getDb, normalizeConceptId, formatConceptName } from "./db.ts";
import { getLearnerOverview } from "./assessmentService.ts";
import { getExecutionCapabilities } from "./codeExecutionService.ts";
import type {
  CodeSubmissionRecord,
  DiagramSpec,
  ExplanationMeta,
  LearningPath,
  LearningPathNode,
  PlatformDashboardData,
  ProgrammingLanguage,
  ProgrammingLesson,
  RevisionScheduleItem,
  SavedLessonRecord,
  StudyTask,
  TeachingMode,
  UserProfile,
} from "../types.ts";
import { getOrCreateUserProfile } from "./authService.ts";

export const PROGRAMMING_LESSONS: ProgrammingLesson[] = [
  {
    id: "py_vars_io",
    track: "python",
    order: 1,
    title: "Variables, Types & Input Formatting",
    conceptId: "variables",
    language: "python",
    difficulty: "beginner",
    summary: "Store values in named variables, inspect dynamic types, and compute clear formatted output.",
    expectedGoal: "Declare variables for a student's name, study minutes, and target score, then print a formatted summary.",
    starterCode: `# Practice: Variables & Output\nstudent_name = "Kavya"\ndaily_minutes = 45\ntarget_score = 85.5\n\n# TODO: Print a summary showing weekly study minutes (daily_minutes * 7)\nprint(f"{student_name} studies {daily_minutes * 7} minutes per week.")\n`,
    hints: [
      "Multiply daily_minutes by 7 to compute weekly minutes.",
      "Use an f-string like f\"...\" to combine variables cleanly inside print().",
    ],
    sampleSolution: `student_name = "Kavya"\ndaily_minutes = 45\ntarget_score = 85.5\nweekly_minutes = daily_minutes * 7\nprint(f"{student_name} studies {weekly_minutes} minutes/week aiming for {target_score}%.")\n`,
  },
  {
    id: "py_conditions_loops",
    track: "python",
    order: 2,
    title: "Conditions & Loops for Mastery Checks",
    conceptId: "loops",
    language: "python",
    difficulty: "beginner",
    summary: "Combine if/elif/else branching with for-loops to classify scores cleanly.",
    expectedGoal: "Iterate through a list of quiz scores and count how many meet or exceed 70.",
    starterCode: `scores = [58, 72, 84, 65, 91]\npassed = 0\n\nfor score in scores:\n    if score >= 70:\n        passed += 1\n\nprint("Passed quizzes:", passed)\n`,
    hints: [
      "Check if each score is >= 70 inside the loop.",
      "Increment the counter variable only when the condition holds true.",
    ],
    sampleSolution: `scores = [58, 72, 84, 65, 91]\npassed = 0\nfor score in scores:\n    if score >= 70:\n        passed += 1\nprint(f"Passed {passed} out of {len(scores)} quizzes")\n`,
  },
  {
    id: "py_functions_lists",
    track: "python",
    order: 3,
    title: "Functions & Linear Search",
    conceptId: "searching",
    language: "python",
    difficulty: "intermediate",
    summary: "Encapsulate reusable search logic in a Python function and return structured results.",
    expectedGoal: "Write a function find_topic(topics, query) returning its 0-based index or -1 if absent.",
    starterCode: `def find_topic(topics, query):\n    for idx, item in enumerate(topics):\n        if item.lower() == query.lower():\n            return idx\n    return -1\n\ncurriculum = ["Variables", "Loops", "Arrays", "Recursion"]\nprint("Index of Loops:", find_topic(curriculum, "loops"))\n`,
    hints: [
      "Use enumerate(topics) to get both the index and the element.",
      "Compare lowercase strings so searches work case-insensitively.",
    ],
    sampleSolution: `def find_topic(topics, query):\n    for idx, item in enumerate(topics):\n        if item.lower() == query.lower():\n            return idx\n    return -1\n\ncurriculum = ["Variables", "Loops", "Arrays", "Recursion"]\nprint(find_topic(curriculum, "Arrays"))\n`,
  },
  {
    id: "java_main_types",
    track: "java",
    order: 1,
    title: "Java Structure, Main Method & Primitive Types",
    conceptId: "programming_fundamentals",
    language: "java",
    difficulty: "beginner",
    summary: "Understand Java class structure, static main entry point, int/double/String types, and println.",
    expectedGoal: "Print a learner profile summary using int, double, and String variables in Java.",
    starterCode: `public class Main {\n    public static void main(String[] args) {\n        String topic = "Cloud Computing";\n        int studyMinutes = 40;\n        double score = 88.5;\n        System.out.println("Topic: " + topic + " | Minutes: " + studyMinutes + " | Score: " + score);\n    }\n}\n`,
    hints: [
      "In Java, executable code begins inside public static void main(String[] args).",
      "End every statement with a semicolon (;).",
    ],
    sampleSolution: `public class Main {\n    public static void main(String[] args) {\n        String topic = "Cloud Computing";\n        int studyMinutes = 40;\n        double score = 88.5;\n        System.out.println("Topic: " + topic + " | Weekly: " + (studyMinutes * 7) + "m | Score: " + score);\n    }\n}\n`,
  },
  {
    id: "java_loops_arrays",
    track: "java",
    order: 2,
    title: "Java Loops, Arrays & Accumulators",
    conceptId: "arrays",
    language: "java",
    difficulty: "beginner",
    summary: "Traverse fixed-length Java int arrays using a for-loop to compute average mastery.",
    expectedGoal: "Sum all elements in an int[] array and compute the average cleanly.",
    starterCode: `public class Main {\n    public static void main(String[] args) {\n        int[] marks = {75, 82, 90, 68};\n        int total = 0;\n        for (int i = 0; i < marks.length; i++) {\n            total += marks[i];\n        }\n        double avg = (double) total / marks.length;\n        System.out.println("Average: " + avg);\n    }\n}\n`,
    hints: [
      "Cast total to (double) before division so Java avoids integer truncation.",
      "Use marks.length without parentheses for arrays.",
    ],
    sampleSolution: `public class Main {\n    public static void main(String[] args) {\n        int[] marks = {75, 82, 90, 68};\n        int total = 0;\n        for (int m : marks) {\n            total += m;\n        }\n        System.out.println("Average: " + ((double) total / marks.length));\n    }\n}\n`,
  },
  {
    id: "js_live_sandbox",
    track: "javascript",
    order: 1,
    title: "JavaScript Functions, Arrays & Instant Runner",
    conceptId: "arrays",
    language: "javascript",
    difficulty: "beginner",
    summary: "Run live code right inside the isolated Web Worker sandbox to practice arrays and higher-order logic.",
    expectedGoal: "Filter scores >= 70 and compute the average using array methods or loops.",
    starterCode: `const scores = [62, 78, 85, 91, 54];\nconst passing = scores.filter((s) => s >= 70);\nconst avg =\n  passing.reduce((sum, val) => sum + val, 0) / Math.max(1, passing.length);\n\nconsole.log("Passing scores:", passing);\nconsole.log("Passing average:", avg.toFixed(1));\n`,
    hints: [
      "Array.prototype.filter keeps elements matching the boolean callback.",
      "Guard division by zero with Math.max(1, passing.length).",
    ],
    sampleSolution: `const scores = [62, 78, 85, 91, 54];\nconst passing = scores.filter((s) => s >= 70);\nconst avg = passing.reduce((sum, val) => sum + val, 0) / Math.max(1, passing.length);\nconsole.log("Count:", passing.length, "Average:", avg.toFixed(1));\n`,
  },
];

const parseJsonSafe = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const getSavedLessons = (ownerId: string): SavedLessonRecord[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, term, concept_id, profile_id, teaching_mode, english_response, regional_response,
              diagram_json, meta_json, is_bookmarked, created_at, updated_at
       FROM saved_lessons
       WHERE owner_id = ?
       ORDER BY updated_at DESC
       LIMIT 60`
    )
    .all(ownerId) as any[];

  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    conceptId: r.concept_id,
    profileId: r.profile_id,
    teachingMode: r.teaching_mode as TeachingMode,
    englishResponse: r.english_response,
    regionalResponse: r.regional_response,
    diagram: parseJsonSafe<DiagramSpec | null>(r.diagram_json, null),
    meta: parseJsonSafe<ExplanationMeta | null>(r.meta_json, null),
    isBookmarked: Boolean(r.is_bookmarked),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
};

export const saveLessonRecord = (
  ownerId: string,
  payload: {
    term: string;
    profileId: string;
    teachingMode: TeachingMode;
    englishResponse: string;
    regionalResponse: string;
    diagram?: DiagramSpec | null;
    meta?: ExplanationMeta | null;
    isBookmarked?: boolean;
  }
): SavedLessonRecord => {
  const db = getDb();
  const conceptId = normalizeConceptId(payload.term);
  const now = Date.now();

  const existing = db
    .prepare(
      `SELECT id, created_at FROM saved_lessons
       WHERE owner_id = ? AND concept_id = ? AND profile_id = ?
       LIMIT 1`
    )
    .get(ownerId, conceptId, payload.profileId) as { id: string; created_at: number } | undefined;

  const id = existing?.id || `lsn_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const createdAt = existing?.created_at || now;
  const isBookmarked = payload.isBookmarked !== false;

  db.prepare(
    `INSERT OR REPLACE INTO saved_lessons (
      id, owner_id, term, concept_id, profile_id, teaching_mode, english_response, regional_response,
      diagram_json, meta_json, is_bookmarked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ownerId,
    payload.term.trim().slice(0, 200),
    conceptId,
    payload.profileId,
    payload.teachingMode,
    payload.englishResponse,
    payload.regionalResponse,
    payload.diagram ? JSON.stringify(payload.diagram) : null,
    payload.meta ? JSON.stringify(payload.meta) : null,
    isBookmarked ? 1 : 0,
    createdAt,
    now
  );

  return {
    id,
    term: payload.term.trim().slice(0, 200),
    conceptId,
    profileId: payload.profileId,
    teachingMode: payload.teachingMode,
    englishResponse: payload.englishResponse,
    regionalResponse: payload.regionalResponse,
    diagram: payload.diagram || null,
    meta: payload.meta || null,
    isBookmarked,
    createdAt,
    updatedAt: now,
  };
};

export const deleteSavedLesson = (ownerId: string, lessonId: string): boolean => {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM saved_lessons WHERE id = ? AND owner_id = ?")
    .run(lessonId, ownerId);
  return Number(res.changes || 0) > 0;
};

const CORE_SUBJECT_TRACKS: Record<string, string[]> = {
  "Programming & DSA": [
    "programming_fundamentals",
    "variables",
    "conditions",
    "loops",
    "arrays",
    "searching",
    "sorting",
    "recursion",
    "algorithm",
  ],
  "Web, APIs & Cloud": [
    "networking_basics",
    "http_https",
    "api",
    "cloud_computing",
    "load_balancing",
    "cybersecurity",
  ],
  "Databases & Systems": [
    "ram_memory",
    "virtual_memory",
    "operating_systems",
    "databases",
    "sql",
    "normalization",
  ],
  "AI & Data Science": ["machine_learning", "generative_ai", "data_science"],
};

export const getOrGenerateLearningPath = (ownerId: string, forceRegenerate = false): LearningPath => {
  const db = getDb();
  const profile: UserProfile = getOrCreateUserProfile(ownerId);
  const overview = getLearnerOverview(ownerId);
  const masteryMap = new Map(overview.masteries.map((m) => [m.conceptId, m]));
  const gapSet = new Set(overview.learningGaps.map((g) => g.conceptId));

  // Choose concepts aligned to selected subjects or default core roadmap
  const chosenConceptIds: string[] = [];
  if (profile.subjects.length > 0) {
    for (const subj of profile.subjects) {
      for (const [trackName, ids] of Object.entries(CORE_SUBJECT_TRACKS)) {
        if (
          subj.toLowerCase().includes("program") ||
          subj.toLowerCase().includes("java") ||
          subj.toLowerCase().includes("python") ||
          subj.toLowerCase().includes("dsa")
        ) {
          if (trackName === "Programming & DSA") ids.forEach((id) => chosenConceptIds.push(id));
        } else if (subj.toLowerCase().includes("cloud") || subj.toLowerCase().includes("web") || subj.toLowerCase().includes("network")) {
          if (trackName === "Web, APIs & Cloud") ids.forEach((id) => chosenConceptIds.push(id));
        } else if (subj.toLowerCase().includes("database") || subj.toLowerCase().includes("sql") || subj.toLowerCase().includes("system")) {
          if (trackName === "Databases & Systems") ids.forEach((id) => chosenConceptIds.push(id));
        } else if (subj.toLowerCase().includes("ai") || subj.toLowerCase().includes("data") || subj.toLowerCase().includes("ml")) {
          if (trackName === "AI & Data Science") ids.forEach((id) => chosenConceptIds.push(id));
        }
      }
    }
  }

  // Also append any concepts learner has actively practiced
  for (const m of overview.masteries) {
    if (!chosenConceptIds.includes(m.conceptId)) {
      chosenConceptIds.push(m.conceptId);
    }
  }

  if (chosenConceptIds.length === 0) {
    CORE_SUBJECT_TRACKS["Programming & DSA"].slice(0, 6).forEach((id) => chosenConceptIds.push(id));
    CORE_SUBJECT_TRACKS["Web, APIs & Cloud"].slice(0, 4).forEach((id) => chosenConceptIds.push(id));
  }

  const uniqueIds = Array.from(new Set(chosenConceptIds)).slice(0, 12);

  const catalogRows = db
    .prepare("SELECT concept_id, concept_name, subject, description FROM concept_catalog")
    .all() as Array<{ concept_id: string; concept_name: string; subject: string; description: string }>;
  const catalogMap = new Map(catalogRows.map((c) => [c.concept_id, c]));

  const prereqRows = db
    .prepare("SELECT concept_id, prerequisite_id FROM concept_prerequisites")
    .all() as Array<{ concept_id: string; prerequisite_id: string }>;
  const prereqMap = new Map<string, string[]>();
  for (const row of prereqRows) {
    const arr = prereqMap.get(row.concept_id) || [];
    arr.push(row.prerequisite_id);
    prereqMap.set(row.concept_id, arr);
  }

  const nodes: LearningPathNode[] = uniqueIds.map((conceptId, idx) => {
    const cat = catalogMap.get(conceptId);
    const mastery = masteryMap.get(conceptId);
    const prereqs = (prereqMap.get(conceptId) || []).filter((pid) => uniqueIds.includes(pid));
    const prereqsSatisfied = prereqs.every((pid) => {
      const pm = masteryMap.get(pid);
      return (pm?.masteryScore ?? 0) >= 60;
    });

    let status: LearningPathNode["status"] = "ready";
    if (gapSet.has(conceptId) && mastery && (mastery.masteryScore ?? 0) < 60) {
      status = "needs_revision";
    } else if (mastery && (mastery.masteryScore ?? 0) >= 80 && !mastery.isProvisional) {
      status = "completed";
    } else if (mastery && mastery.attemptsCount > 0) {
      status = "in_progress";
    } else if (prereqs.length > 0 && !prereqsSatisfied && idx > 0) {
      status = "locked";
    }

    const recommendedMode: TeachingMode =
      status === "needs_revision"
        ? "cultural_analogy"
        : profile.teachingPreference || "cultural_analogy";

    const rationale =
      status === "needs_revision"
        ? "Adaptive assessment detected gaps or misconceptions—revisit with fresh analogies and guided checks."
        : status === "completed"
          ? "Strong understanding verified across evidence checks."
          : status === "in_progress"
            ? "Started; complete additional practice or verification quiz to solidify mastery."
            : prereqs.length > 0 && !prereqsSatisfied
              ? `Builds on ${prereqs.map((id) => formatConceptName(id)).join(", ")}.`
              : cat?.description || "Core concept aligned to your learning goal.";

    return {
      id: `node_${conceptId}`,
      conceptId,
      conceptName: mastery?.conceptName || cat?.concept_name || formatConceptName(conceptId),
      subject: mastery?.subject || cat?.subject || "Computer Science",
      order: idx + 1,
      status,
      masteryScore: mastery?.masteryScore ?? null,
      prerequisiteIds: prereqs,
      recommendedMode,
      rationale,
    };
  });

  const title =
    profile.subjects.length > 0
      ? `${profile.subjects.slice(0, 2).join(" & ")} Path`
      : "Core Foundations & Practical Systems";
  const goal =
    profile.learningGoals.length > 0
      ? profile.learningGoals[0]
      : "Build conceptual clarity first, then verify mastery through practice and code.";

  const now = Date.now();
  const existing = db
    .prepare("SELECT id FROM learning_paths WHERE owner_id = ? LIMIT 1")
    .get(ownerId) as { id: string } | undefined;

  const pathId = existing?.id || `path_${crypto.randomUUID().slice(0, 12)}`;
  if (forceRegenerate || !existing) {
    db.prepare(
      `INSERT OR REPLACE INTO learning_paths (id, owner_id, title, goal, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(pathId, ownerId, title, goal, JSON.stringify(nodes), now, now);
  } else {
    db.prepare(
      `UPDATE learning_paths SET title = ?, goal = ?, nodes_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
    ).run(title, goal, JSON.stringify(nodes), now, pathId, ownerId);
  }

  return {
    id: pathId,
    title,
    goal,
    nodes,
    updatedAt: now,
  };
};

const todayIso = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export const getStudyTasks = (ownerId: string): StudyTask[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, concept_id, concept_name, task_type, due_date, estimated_minutes,
              status, notes, completed_at, created_at
       FROM study_tasks
       WHERE owner_id = ?
       ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, due_date ASC, created_at DESC
       LIMIT 60`
    )
    .all(ownerId) as any[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    conceptId: r.concept_id,
    conceptName: r.concept_name,
    taskType: r.task_type as StudyTask["taskType"],
    dueDate: r.due_date,
    estimatedMinutes: Number(r.estimated_minutes),
    status: r.status as StudyTask["status"],
    notes: r.notes || undefined,
    completedAt: r.completed_at ? Number(r.completed_at) : null,
    createdAt: Number(r.created_at),
  }));
};

export const createStudyTask = (
  ownerId: string,
  payload: {
    title: string;
    conceptName: string;
    taskType?: StudyTask["taskType"];
    dueDate?: string;
    estimatedMinutes?: number;
    notes?: string;
  }
): StudyTask => {
  const db = getDb();
  const id = `tsk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const conceptName = payload.conceptName.trim().slice(0, 120) || "General Topic";
  const conceptId = normalizeConceptId(conceptName);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate || "") ? payload.dueDate! : todayIso(0);
  const estimatedMinutes = Math.min(180, Math.max(5, Number(payload.estimatedMinutes) || 20));
  const taskType: StudyTask["taskType"] =
    payload.taskType && ["learn", "practice", "revision", "coding", "assessment"].includes(payload.taskType)
      ? payload.taskType
      : "learn";
  const now = Date.now();

  db.prepare(
    `INSERT INTO study_tasks (
      id, owner_id, title, concept_id, concept_name, task_type, due_date, estimated_minutes, status, notes, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?)`
  ).run(
    id,
    ownerId,
    payload.title.trim().slice(0, 160),
    conceptId,
    conceptName,
    taskType,
    dueDate,
    estimatedMinutes,
    payload.notes?.trim().slice(0, 300) || null,
    now,
    now
  );

  return {
    id,
    title: payload.title.trim().slice(0, 160),
    conceptId,
    conceptName,
    taskType,
    dueDate,
    estimatedMinutes,
    status: "pending",
    notes: payload.notes?.trim().slice(0, 300) || undefined,
    completedAt: null,
    createdAt: now,
  };
};

export const updateStudyTask = (
  ownerId: string,
  taskId: string,
  updates: { status?: StudyTask["status"]; dueDate?: string; title?: string }
): StudyTask | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM study_tasks WHERE id = ? AND owner_id = ?")
    .get(taskId, ownerId) as any | undefined;
  if (!row) return null;

  const status =
    updates.status && ["pending", "completed", "skipped"].includes(updates.status)
      ? updates.status
      : row.status;
  const dueDate =
    updates.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(updates.dueDate) ? updates.dueDate : row.due_date;
  const title =
    typeof updates.title === "string" && updates.title.trim() ? updates.title.trim().slice(0, 160) : row.title;
  const now = Date.now();
  const completedAt = status === "completed" ? row.completed_at || now : null;

  db.prepare(
    "UPDATE study_tasks SET title = ?, status = ?, due_date = ?, completed_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?"
  ).run(title, status, dueDate, completedAt, now, taskId, ownerId);

  return {
    id: row.id,
    title,
    conceptId: row.concept_id,
    conceptName: row.concept_name,
    taskType: row.task_type,
    dueDate,
    estimatedMinutes: Number(row.estimated_minutes),
    status,
    notes: row.notes || undefined,
    completedAt,
    createdAt: Number(row.created_at),
  };
};

export const deleteStudyTask = (ownerId: string, taskId: string): boolean => {
  const db = getDb();
  const res = db.prepare("DELETE FROM study_tasks WHERE id = ? AND owner_id = ?").run(taskId, ownerId);
  return Number(res.changes || 0) > 0;
};

export const generateSmartStudyPlan = (ownerId: string): StudyTask[] => {
  const db = getDb();
  const profile = getOrCreateUserProfile(ownerId);
  const path = getOrGenerateLearningPath(ownerId, true);
  const overview = getLearnerOverview(ownerId);

  // Clear pending auto-generated tasks while keeping completed/manual task history clean
  db.prepare("DELETE FROM study_tasks WHERE owner_id = ? AND status = 'pending' AND notes = 'Smart Study Plan'").run(
    ownerId
  );

  const dailyBudget = Math.max(15, profile.dailyStudyMinutes || 30);
  const drafts: Array<{
    title: string;
    conceptName: string;
    taskType: StudyTask["taskType"];
    dayOffset: number;
    minutes: number;
  }> = [];

  // 1. Prioritize weak concepts / learning gaps first
  for (const gap of overview.learningGaps.slice(0, 2)) {
    drafts.push({
      title: `Reinforce ${gap.conceptName} with analogies & quick check`,
      conceptName: gap.conceptName,
      taskType: "revision",
      dayOffset: 0,
      minutes: Math.min(25, dailyBudget),
    });
  }

  // 2. Schedule next ready/in-progress path concepts
  const upcomingNodes = path.nodes
    .filter((n) => n.status === "ready" || n.status === "in_progress" || n.status === "needs_revision")
    .slice(0, 4);

  upcomingNodes.forEach((node, idx) => {
    const dayOffset = Math.min(4, Math.floor((idx + drafts.length) / 2));
    drafts.push({
      title: `Study ${node.conceptName} (${node.recommendedMode.replace(/_/g, " ")})`,
      conceptName: node.conceptName,
      taskType: "learn",
      dayOffset,
      minutes: Math.min(30, Math.max(15, Math.round(dailyBudget * 0.7))),
    });
    drafts.push({
      title: `Verify mastery: ${node.conceptName} assessment`,
      conceptName: node.conceptName,
      taskType: "assessment",
      dayOffset: Math.min(6, dayOffset + 1),
      minutes: 15,
    });
  });

  // 3. Add a coding practice task if programming is relevant
  const codingTrack = profile.subjects.some((s) => s.toLowerCase().includes("java"))
    ? "Java Loops & Arrays"
    : "Python & JavaScript Fundamentals";
  drafts.push({
    title: `Playground Practice: ${codingTrack}`,
    conceptName: codingTrack,
    taskType: "coding",
    dayOffset: 1,
    minutes: 20,
  });

  for (const item of drafts.slice(0, 7)) {
    createStudyTask(ownerId, {
      title: item.title,
      conceptName: item.conceptName,
      taskType: item.taskType,
      dueDate: todayIso(item.dayOffset),
      estimatedMinutes: item.minutes,
      notes: "Smart Study Plan",
    });
  }

  return getStudyTasks(ownerId);
};

export const syncAndGetRevisions = (ownerId: string): RevisionScheduleItem[] => {
  const db = getDb();
  const overview = getLearnerOverview(ownerId);
  const now = Date.now();

  for (const m of overview.masteries) {
    const existing = db
      .prepare("SELECT * FROM revision_schedules WHERE owner_id = ? AND concept_id = ?")
      .get(ownerId, m.conceptId) as any | undefined;

    // Interval scaled realistically by mastery & trend (never falsely 'retained' without evidence)
    const score = m.masteryScore ?? 0;
    const intervalDays =
      score >= 85 && !m.isProvisional
        ? 7
        : score >= 70
          ? 3
          : score >= 50
            ? 2
            : 1;

    if (!existing) {
      const nextReviewAt = (m.lastAssessedAt || now) + intervalDays * 86_400_000;
      const status =
        nextReviewAt <= now
          ? "due"
          : m.retentionPerformance !== null && m.retentionPerformance >= 80
            ? "retained"
            : "upcoming";
      db.prepare(
        `INSERT INTO revision_schedules (
          owner_id, concept_id, concept_name, interval_days, next_review_at, last_reviewed_at, last_score, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ownerId,
        m.conceptId,
        m.conceptName,
        intervalDays,
        nextReviewAt,
        m.lastAssessedAt || null,
        m.masteryScore,
        status,
        now
      );
    } else if (m.lastAssessedAt && Number(m.lastAssessedAt) > Number(existing.last_reviewed_at || 0)) {
      const nextReviewAt = m.lastAssessedAt + intervalDays * 86_400_000;
      const status =
        m.retentionPerformance !== null && m.retentionPerformance >= 80 && nextReviewAt > now
          ? "retained"
          : nextReviewAt <= now
            ? "due"
            : "upcoming";
      db.prepare(
        `UPDATE revision_schedules
         SET interval_days = ?, next_review_at = ?, last_reviewed_at = ?, last_score = ?, status = ?, updated_at = ?
         WHERE owner_id = ? AND concept_id = ?`
      ).run(
        intervalDays,
        nextReviewAt,
        m.lastAssessedAt,
        m.masteryScore,
        status,
        now,
        ownerId,
        m.conceptId
      );
    }
  }

  const rows = db
    .prepare("SELECT * FROM revision_schedules WHERE owner_id = ? ORDER BY next_review_at ASC")
    .all(ownerId) as any[];

  return rows.map((r) => {
    const nextAt = Number(r.next_review_at);
    const overdue = nextAt < now - 86_400_000;
    const dueNow = nextAt <= now;
    const status: RevisionScheduleItem["status"] = overdue
      ? "overdue"
      : dueNow
        ? "due"
        : r.status === "retained"
          ? "retained"
          : "upcoming";
    return {
      conceptId: r.concept_id,
      conceptName: r.concept_name,
      intervalDays: Number(r.interval_days),
      nextReviewAt: nextAt,
      lastReviewedAt: r.last_reviewed_at ? Number(r.last_reviewed_at) : null,
      lastScore: r.last_score !== null && r.last_score !== undefined ? Number(r.last_score) : null,
      status,
      isDueNow: dueNow,
    };
  });
};

export const getLessonsWithProgress = (ownerId: string): ProgrammingLesson[] => {
  const db = getDb();
  const rows = db
    .prepare("SELECT lesson_id, status, last_code FROM lesson_progress WHERE owner_id = ?")
    .all(ownerId) as Array<{ lesson_id: string; status: string; last_code: string }>;
  const map = new Map(rows.map((r) => [r.lesson_id, r]));

  return PROGRAMMING_LESSONS.map((lesson) => {
    const prog = map.get(lesson.id);
    return {
      ...lesson,
      status: (prog?.status as ProgrammingLesson["status"]) || "not_started",
      lastCode: prog?.last_code || undefined,
    };
  });
};

export const saveLessonProgressAndSubmission = (
  ownerId: string,
  payload: {
    lessonId?: string | null;
    language: ProgrammingLanguage;
    code: string;
    stdin: string;
    stdout: string;
    stderr: string;
    status: string;
    executionTimeMs: number;
    markCompleted?: boolean;
    aiFeedback?: string | null;
  }
): CodeSubmissionRecord => {
  const db = getDb();
  const id = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = Date.now();

  db.prepare(
    `INSERT INTO code_submissions (
      id, owner_id, lesson_id, language, code, stdin, stdout, stderr, status, execution_time_ms, ai_feedback, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ownerId,
    payload.lessonId || null,
    payload.language,
    payload.code,
    payload.stdin,
    payload.stdout,
    payload.stderr,
    payload.status,
    payload.executionTimeMs,
    payload.aiFeedback || null,
    now
  );

  if (payload.lessonId) {
    const existing = db
      .prepare("SELECT attempts_count, completed_at, status FROM lesson_progress WHERE owner_id = ? AND lesson_id = ?")
      .get(ownerId, payload.lessonId) as { attempts_count: number; completed_at: number | null; status: string } | undefined;

    const nextStatus =
      payload.markCompleted || existing?.status === "completed" ? "completed" : "in_progress";
    const completedAt =
      nextStatus === "completed" ? existing?.completed_at || now : null;

    db.prepare(
      `INSERT OR REPLACE INTO lesson_progress (owner_id, lesson_id, status, last_code, attempts_count, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ownerId,
      payload.lessonId,
      nextStatus,
      payload.code,
      (existing?.attempts_count || 0) + 1,
      completedAt,
      now
    );
  }

  return {
    id,
    lessonId: payload.lessonId || null,
    language: payload.language,
    code: payload.code,
    stdin: payload.stdin,
    stdout: payload.stdout,
    stderr: payload.stderr,
    status: payload.status,
    executionTimeMs: payload.executionTimeMs,
    aiFeedback: payload.aiFeedback || null,
    createdAt: now,
  };
};

export const getRecentCodeSubmissions = (ownerId: string): CodeSubmissionRecord[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, lesson_id, language, code, stdin, stdout, stderr, status, execution_time_ms, ai_feedback, created_at
       FROM code_submissions
       WHERE owner_id = ?
       ORDER BY created_at DESC
       LIMIT 15`
    )
    .all(ownerId) as any[];

  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id || null,
    language: r.language as ProgrammingLanguage,
    code: r.code,
    stdin: r.stdin,
    stdout: r.stdout,
    stderr: r.stderr,
    status: r.status,
    executionTimeMs: Number(r.execution_time_ms),
    aiFeedback: r.ai_feedback || null,
    createdAt: Number(r.created_at),
  }));
};

export const getPlatformDashboardData = (
  ownerId: string,
  authInfo: { authenticated: boolean; user: PlatformDashboardData["auth"]["user"]; profile: UserProfile }
): PlatformDashboardData => {
  return {
    auth: authInfo,
    overview: getLearnerOverview(ownerId),
    savedLessons: getSavedLessons(ownerId),
    learningPath: getOrGenerateLearningPath(ownerId, false),
    studyTasks: getStudyTasks(ownerId),
    revisions: syncAndGetRevisions(ownerId),
    lessons: getLessonsWithProgress(ownerId),
    recentSubmissions: getRecentCodeSubmissions(ownerId),
    capabilities: getExecutionCapabilities(),
  };
};
