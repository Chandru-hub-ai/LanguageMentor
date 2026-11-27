import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "language_mentor.db");

let dbInstance: DatabaseSync | null = null;

export const normalizeConceptId = (rawConcept: string): string => {
  const cleaned = rawConcept
    .toLowerCase()
    .replace(/^(what is|explain|define|how does|how do|learn|quiz on|about)\s+/i, "")
    .replace(/[?!.,:;'"()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliasMap: Array<[RegExp, string]> = [
    [/\bprogramming fundamentals\b|\bbasics of programming\b/, "programming_fundamentals"],
    [/\bvariables?\b/, "variables"],
    [/\bconditions?\b|\bif else\b|\bbranching\b/, "conditions"],
    [/\bloops?\b|\bfor loop\b|\bwhile loop\b|\biteration\b/, "loops"],
    [/\barrays?\b/, "arrays"],
    [/\bsearching\b|\bbinary search\b|\blinear search\b/, "searching"],
    [/\bsorting\b|\bquicksort\b|\bmergesort\b|\bbubble sort\b/, "sorting"],
    [/\brecursion\b|\brecursive\b/, "recursion"],
    [/\bdata structures?\b/, "data_structures"],
    [/\balgorithms?\b/, "algorithm"],
    [/\bcloud computing\b|\baws\b|\bazure\b/, "cloud_computing"],
    [/\bload balanc/, "load_balancing"],
    [/\bnetworking\b|\bcomputer network/, "networking_basics"],
    [/\bhttp\b|\bhttps\b/, "http_https"],
    [/\bapi\b|\brest api\b/, "api"],
    [/\bvirtual memory\b|\bpaging\b/, "virtual_memory"],
    [/\bram\b|\bmemory\b/, "ram_memory"],
    [/\boperating system|\bos\b/, "operating_systems"],
    [/\bdatabase|\bdbms\b/, "databases"],
    [/\bsql\b/, "sql"],
    [/\bnormalization\b/, "normalization"],
    [/\bgenerative ai\b|\bllm\b/, "generative_ai"],
    [/\bmachine learning\b|\bml\b/, "machine_learning"],
    [/\bcybersecurity\b|\bsecurity\b/, "cybersecurity"],
    [/\bblockchain\b/, "blockchain"],
    [/\bdata science\b/, "data_science"],
  ];

  for (const [pattern, id] of aliasMap) {
    if (pattern.test(cleaned)) {
      return id;
    }
  }

  const slug = cleaned
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return slug || "general_tech_concept";
};

export const formatConceptName = (conceptId: string, rawInput?: string): string => {
  if (rawInput && rawInput.trim().length > 0 && rawInput.trim().length <= 80) {
    return rawInput
      .trim()
      .replace(/^(what is|explain|define|how does)\s+/i, "")
      .replace(/[?!.]+$/, "")
      .trim();
  }
  return conceptId
    .split("_")
    .map((w) => (w.length <= 3 && /^(api|sql|ram|os|ai|ml|ip|dns)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
};

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const SEED_CONCEPTS: Array<{ id: string; name: string; subject: string; description: string }> = [
  { id: "programming_fundamentals", name: "Programming Fundamentals", subject: "Computer Science", description: "Core instructions, data types, and control flow." },
  { id: "variables", name: "Variables", subject: "Computer Science", description: "Named memory locations storing values during execution." },
  { id: "conditions", name: "Conditions", subject: "Computer Science", description: "Boolean branching using if/else and logical checks." },
  { id: "loops", name: "Loops", subject: "Computer Science", description: "Iterative execution of code blocks." },
  { id: "arrays", name: "Arrays", subject: "Data Structures", description: "Indexed contiguous collections of elements." },
  { id: "searching", name: "Searching", subject: "Algorithms", description: "Locating elements via linear or binary search." },
  { id: "sorting", name: "Sorting", subject: "Algorithms", description: "Ordering collections efficiently." },
  { id: "recursion", name: "Recursion", subject: "Algorithms", description: "Functions solving subproblems via self-calls and base cases." },
  { id: "algorithm", name: "Algorithm", subject: "Algorithms", description: "Step-by-step finite problem-solving procedures and complexity." },
  { id: "networking_basics", name: "Networking Basics", subject: "Networking", description: "Packets, IP addressing, clients, and servers." },
  { id: "http_https", name: "HTTP & HTTPS", subject: "Networking", description: "Web request/response protocol and TLS encryption." },
  { id: "api", name: "API", subject: "Software Engineering", description: "Structured contracts enabling software systems to communicate." },
  { id: "cloud_computing", name: "Cloud Computing", subject: "Cloud Systems", description: "On-demand remote compute, storage, and networking." },
  { id: "load_balancing", name: "Load Balancing", subject: "Cloud Systems", description: "Distributing traffic across healthy backend servers." },
  { id: "ram_memory", name: "RAM & Memory", subject: "Computer Architecture", description: "Volatile fast primary memory vs persistent storage." },
  { id: "virtual_memory", name: "Virtual Memory", subject: "Operating Systems", description: "Logical-to-physical paging and memory isolation." },
  { id: "operating_systems", name: "Operating Systems", subject: "Operating Systems", description: "Resource, process, and memory management kernel." },
  { id: "databases", name: "Databases", subject: "Databases", description: "Organized persistent data storage and ACID guarantees." },
  { id: "sql", name: "SQL", subject: "Databases", description: "Declarative querying and manipulation of relational data." },
  { id: "normalization", name: "Normalization", subject: "Databases", description: "Eliminating redundancy via structured relational normal forms." },
  { id: "cybersecurity", name: "Cybersecurity", subject: "Security", description: "Protecting systems via authentication, encryption, and least privilege." },
  { id: "blockchain", name: "Blockchain", subject: "Distributed Systems", description: "Cryptographically linked append-only distributed ledgers." },
  { id: "machine_learning", name: "Machine Learning", subject: "Artificial Intelligence", description: "Learning predictive patterns from training data." },
  { id: "generative_ai", name: "Generative AI", subject: "Artificial Intelligence", description: "Models synthesizing new text, audio, code, or images." },
  { id: "data_science", name: "Data Science", subject: "Data Analytics", description: "Extracting actionable insights from structured and unstructured data." },
];

const SEED_PREREQUISITES: Array<{ conceptId: string; prerequisiteId: string; rationale: string }> = [
  { conceptId: "variables", prerequisiteId: "programming_fundamentals", rationale: "Variables store program state inside fundamental execution flow." },
  { conceptId: "conditions", prerequisiteId: "variables", rationale: "Conditional branches evaluate values stored in variables." },
  { conceptId: "loops", prerequisiteId: "conditions", rationale: "Loops rely on termination conditions to avoid infinite execution." },
  { conceptId: "arrays", prerequisiteId: "loops", rationale: "Traversing and processing array elements depends on loop iteration." },
  { conceptId: "searching", prerequisiteId: "arrays", rationale: "Search algorithms operate over indexed sequences like arrays." },
  { conceptId: "sorting", prerequisiteId: "searching", rationale: "Understanding element comparison and ordering builds toward efficient sorting." },
  { conceptId: "recursion", prerequisiteId: "conditions", rationale: "Every recursive function requires a conditional base case to stop." },
  { conceptId: "algorithm", prerequisiteId: "loops", rationale: "Analyzing time complexity and step execution builds on loop iteration." },
  { conceptId: "http_https", prerequisiteId: "networking_basics", rationale: "HTTP runs over TCP/IP client-server networking fundamentals." },
  { conceptId: "api", prerequisiteId: "http_https", rationale: "Web APIs use HTTP methods, headers, and status codes to exchange data." },
  { conceptId: "cloud_computing", prerequisiteId: "networking_basics", rationale: "Cloud services deliver remote servers and storage over networks." },
  { conceptId: "load_balancing", prerequisiteId: "cloud_computing", rationale: "Load balancers distribute incoming traffic across cloud server pools." },
  { conceptId: "virtual_memory", prerequisiteId: "ram_memory", rationale: "Virtual memory maps process pages onto physical RAM and disk." },
  { conceptId: "operating_systems", prerequisiteId: "virtual_memory", rationale: "OS kernels isolate processes using virtual memory and scheduling." },
  { conceptId: "sql", prerequisiteId: "databases", rationale: "SQL queries relational tables managed by a database engine." },
  { conceptId: "normalization", prerequisiteId: "sql", rationale: "Database normalization designs clean relational tables queried by SQL." },
  { conceptId: "generative_ai", prerequisiteId: "machine_learning", rationale: "Generative AI architectures build directly on machine learning representations." },
  { conceptId: "cybersecurity", prerequisiteId: "networking_basics", rationale: "Securing web traffic and APIs starts with how network communication works." },
];

export const getDb = (): DatabaseSync => {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS learner_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concept_catalog (
      concept_id TEXT PRIMARY KEY,
      concept_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS concept_prerequisites (
      concept_id TEXT NOT NULL,
      prerequisite_id TEXT NOT NULL,
      rationale TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (concept_id, prerequisite_id)
    );

    CREATE TABLE IF NOT EXISTS assessment_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      concept_name TEXT NOT NULL,
      assessment_type TEXT NOT NULL,
      initial_difficulty INTEGER NOT NULL,
      current_difficulty INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      completion_time INTEGER,
      total_questions INTEGER NOT NULL,
      answered_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      incorrect_count INTEGER NOT NULL DEFAULT 0,
      partial_count INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      language_profile_id TEXT NOT NULL,
      evaluation_summary_json TEXT
    );

    CREATE TABLE IF NOT EXISTS assessment_questions (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      question_index INTEGER NOT NULL,
      concept_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL,
      difficulty_level INTEGER NOT NULL,
      learning_objective TEXT NOT NULL,
      options_json TEXT,
      code_snippet TEXT,
      correct_answer TEXT NOT NULL,
      answer_explanation TEXT NOT NULL,
      option_misconceptions_json TEXT,
      evaluation_criteria_json TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_answers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      submitted_answer TEXT NOT NULL,
      evaluation_result TEXT NOT NULL,
      score REAL NOT NULL,
      time_taken_ms INTEGER,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      concept_id TEXT NOT NULL,
      difficulty_level INTEGER NOT NULL,
      submitted_at INTEGER NOT NULL,
      feedback TEXT NOT NULL,
      misconception_ids_json TEXT,
      UNIQUE (attempt_id, question_id),
      FOREIGN KEY (attempt_id) REFERENCES assessment_attempts(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_evaluation_records (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      evaluator_type TEXT NOT NULL,
      score REAL NOT NULL,
      confidence REAL NOT NULL,
      rationale TEXT NOT NULL,
      key_points_present_json TEXT NOT NULL DEFAULT '[]',
      key_points_missing_json TEXT NOT NULL DEFAULT '[]',
      missing_concepts_json TEXT NOT NULL DEFAULT '[]',
      misconceptions_json TEXT NOT NULL DEFAULT '[]',
      evaluation_status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (answer_id) REFERENCES student_answers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mastery_observations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      evidence_category TEXT NOT NULL,
      normalized_score REAL NOT NULL,
      difficulty_level INTEGER NOT NULL,
      weight_multiplier REAL NOT NULL,
      is_correct INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (attempt_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS concept_mastery (
      user_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      concept_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      quiz_accuracy REAL,
      practical_performance REAL,
      retention_performance REAL,
      mastery_score REAL NOT NULL,
      is_provisional INTEGER NOT NULL DEFAULT 1,
      confidence_state TEXT NOT NULL,
      classification_band TEXT NOT NULL,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      highest_difficulty_passed INTEGER NOT NULL DEFAULT 0,
      recent_trend TEXT NOT NULL DEFAULT 'stable',
      last_assessed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS misconception_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence_from_answer TEXT NOT NULL,
      confidence REAL NOT NULL,
      recommended_intervention TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      is_pattern INTEGER NOT NULL DEFAULT 0,
      last_observed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attempts_user_concept ON assessment_attempts(user_id, concept_id, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_questions_attempt ON assessment_questions(attempt_id, question_index);
    CREATE INDEX IF NOT EXISTS idx_answers_user_concept ON student_answers(user_id, concept_id, submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_observations_user_concept ON mastery_observations(user_id, concept_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_misconceptions_user_concept ON misconception_records(user_id, concept_id, is_pattern DESC);

    -- PHASE C: Incremental User Accounts, Profiles, Saved Lessons, Paths, Study Planner, Spaced Revision & Playground
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      preferred_profile_id TEXT NOT NULL DEFAULT 'tamil_std',
      skill_level TEXT NOT NULL DEFAULT 'beginner',
      learning_goals_json TEXT NOT NULL DEFAULT '[]',
      subjects_json TEXT NOT NULL DEFAULT '[]',
      teaching_preference TEXT NOT NULL DEFAULT 'cultural_analogy',
      daily_study_minutes INTEGER NOT NULL DEFAULT 30,
      target_deadline TEXT,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      theme_preference TEXT NOT NULL DEFAULT 'dark',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_lessons (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      term TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      teaching_mode TEXT NOT NULL,
      english_response TEXT NOT NULL,
      regional_response TEXT NOT NULL,
      diagram_json TEXT,
      meta_json TEXT,
      is_bookmarked INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learning_paths (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      nodes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      concept_name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      due_date TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL DEFAULT 20,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revision_schedules (
      owner_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      concept_name TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 1,
      next_review_at INTEGER NOT NULL,
      last_reviewed_at INTEGER,
      last_score REAL,
      status TEXT NOT NULL DEFAULT 'upcoming',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      owner_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      last_code TEXT NOT NULL DEFAULT '',
      attempts_count INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS code_submissions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      lesson_id TEXT,
      language TEXT NOT NULL,
      code TEXT NOT NULL,
      stdin TEXT NOT NULL DEFAULT '',
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL DEFAULT 0,
      ai_feedback TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_saved_lessons_owner ON saved_lessons(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_study_tasks_owner_due ON study_tasks(owner_id, due_date ASC);
    CREATE INDEX IF NOT EXISTS idx_revision_owner_due ON revision_schedules(owner_id, next_review_at ASC);
    CREATE INDEX IF NOT EXISTS idx_code_submissions_owner ON code_submissions(owner_id, created_at DESC);
  `);

  // Safe incremental migration on learner_sessions to link authenticated users without data loss
  const sessionCols = db.prepare("PRAGMA table_info(learner_sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === "user_id")) {
    db.exec("ALTER TABLE learner_sessions ADD COLUMN user_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_learner_sessions_user ON learner_sessions(user_id)");

  const insertConcept = db.prepare(
    "INSERT OR IGNORE INTO concept_catalog (concept_id, concept_name, subject, description) VALUES (?, ?, ?, ?)"
  );
  for (const c of SEED_CONCEPTS) {
    insertConcept.run(c.id, c.name, c.subject, c.description);
  }

  const insertPrereq = db.prepare(
    "INSERT OR IGNORE INTO concept_prerequisites (concept_id, prerequisite_id, rationale) VALUES (?, ?, ?)"
  );
  for (const p of SEED_PREREQUISITES) {
    insertPrereq.run(p.conceptId, p.prerequisiteId, p.rationale);
  }

  dbInstance = db;
  return db;
};

export const ensureConceptInCatalog = (
  conceptId: string,
  conceptName: string,
  subject: string = "Technology"
) => {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO concept_catalog (concept_id, concept_name, subject, description) VALUES (?, ?, ?, '')"
  ).run(conceptId, conceptName, subject);
};

export const createLearnerSession = (userId: string | null = null): { learnerId: string; token: string } => {
  const db = getDb();
  const learnerId = `lrn_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const now = Date.now();
  db.prepare(
    "INSERT INTO learner_sessions (id, token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run(learnerId, tokenHash, userId, now, now);
  return { learnerId, token };
};

export const resolveSessionRecord = (
  token: string | undefined | null
): { sessionId: string; userId: string | null; effectiveOwnerId: string } | null => {
  if (!token || typeof token !== "string" || token.length < 16) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT id, user_id FROM learner_sessions WHERE token_hash = ?")
    .get(hashToken(token)) as { id: string; user_id: string | null } | undefined;
  if (!row) return null;
  db.prepare("UPDATE learner_sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), row.id);
  return {
    sessionId: row.id,
    userId: row.user_id || null,
    effectiveOwnerId: row.user_id || row.id,
  };
};

export const verifyLearnerToken = (token: string | undefined | null): string | null => {
  const rec = resolveSessionRecord(token);
  return rec ? rec.effectiveOwnerId : null;
};
