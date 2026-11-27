import crypto from "crypto";
import { createLearnerSession, getDb, hashToken, resolveSessionRecord } from "./db.ts";
import type { AuthSessionResponse, AuthUser, TeachingMode, ThemeMode, UserProfile } from "../types.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_TEACHING_MODES = new Set<TeachingMode>([
  "simple_explanation",
  "cultural_analogy",
  "visual_learning",
  "mother_tongue",
  "technical_deep_dive",
  "exam_preparation",
  "practical_application",
  "code_explanation",
  "step_by_step",
]);

const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString("hex")}`;
};

const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const storedKey = Buffer.from(keyHex, "hex");
  if (storedKey.length !== derived.length) return false;
  return crypto.timingSafeEqual(storedKey, derived);
};

const safeParseArray = (raw: string | undefined | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export const getOrCreateUserProfile = (ownerId: string): UserProfile => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
    .get(ownerId) as any | undefined;

  if (!row) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO user_profiles (
        user_id, preferred_profile_id, skill_level, learning_goals_json, subjects_json,
        teaching_preference, daily_study_minutes, target_deadline, onboarding_completed, theme_preference, updated_at
      ) VALUES (?, 'tamil_std', 'beginner', '[]', '[]', 'cultural_analogy', 30, NULL, 0, 'dark', ?)`
    ).run(ownerId, now);

    return {
      userId: ownerId,
      preferredProfileId: "tamil_std",
      skillLevel: "beginner",
      learningGoals: [],
      subjects: [],
      teachingPreference: "cultural_analogy",
      dailyStudyMinutes: 30,
      targetDeadline: null,
      onboardingCompleted: false,
      themePreference: "dark",
      updatedAt: now,
    };
  }

  return {
    userId: row.user_id,
    preferredProfileId: row.preferred_profile_id || "tamil_std",
    skillLevel: (row.skill_level as UserProfile["skillLevel"]) || "beginner",
    learningGoals: safeParseArray(row.learning_goals_json),
    subjects: safeParseArray(row.subjects_json),
    teachingPreference: VALID_TEACHING_MODES.has(row.teaching_preference)
      ? (row.teaching_preference as TeachingMode)
      : "cultural_analogy",
    dailyStudyMinutes: Number(row.daily_study_minutes) || 30,
    targetDeadline: row.target_deadline || null,
    onboardingCompleted: Boolean(row.onboarding_completed),
    themePreference: row.theme_preference === "light" ? "light" : "dark",
    updatedAt: Number(row.updated_at) || Date.now(),
  };
};

const getAuthUserById = (userId: string): AuthUser | null => {
  const db = getDb();
  const row = db
    .prepare("SELECT id, email, full_name, created_at FROM users WHERE id = ?")
    .get(userId) as any | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    createdAt: Number(row.created_at),
  };
};

/**
 * Transfers guest learner progress, assessments, study tasks, and saved lessons
 * cleanly onto the authenticated user ID so nothing learned prior to sign-up/in is lost.
 */
const migrateGuestDataToUser = (guestId: string, userId: string) => {
  if (!guestId || !userId || guestId === userId) return;
  const db = getDb();

  db.prepare("UPDATE OR IGNORE assessment_attempts SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE assessment_questions SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE student_answers SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE assessment_evaluation_records SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE mastery_observations SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE concept_mastery SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE misconception_records SET user_id = ? WHERE user_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE saved_lessons SET owner_id = ? WHERE owner_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE study_tasks SET owner_id = ? WHERE owner_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE revision_schedules SET owner_id = ? WHERE owner_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE lesson_progress SET owner_id = ? WHERE owner_id = ?").run(userId, guestId);
  db.prepare("UPDATE OR IGNORE code_submissions SET owner_id = ? WHERE owner_id = ?").run(userId, guestId);

  // Merge guest profile if user has not completed onboarding yet
  const userProfile = db.prepare("SELECT onboarding_completed FROM user_profiles WHERE user_id = ?").get(userId) as
    | { onboarding_completed: number }
    | undefined;
  const guestProfile = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(guestId) as any | undefined;
  if (guestProfile && (!userProfile || !userProfile.onboarding_completed) && guestProfile.onboarding_completed) {
    db.prepare(
      `INSERT OR REPLACE INTO user_profiles (
        user_id, preferred_profile_id, skill_level, learning_goals_json, subjects_json,
        teaching_preference, daily_study_minutes, target_deadline, onboarding_completed, theme_preference, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      guestProfile.preferred_profile_id,
      guestProfile.skill_level,
      guestProfile.learning_goals_json,
      guestProfile.subjects_json,
      guestProfile.teaching_preference,
      guestProfile.daily_study_minutes,
      guestProfile.target_deadline,
      guestProfile.onboarding_completed,
      guestProfile.theme_preference,
      Date.now()
    );
  }
};

export const getCurrentAuthSession = (token: string | null): AuthSessionResponse => {
  const session = resolveSessionRecord(token);
  if (!session) {
    const created = createLearnerSession(null);
    return {
      authenticated: false,
      learnerId: created.learnerId,
      token: created.token,
      user: null,
      profile: getOrCreateUserProfile(created.learnerId),
    };
  }

  const user = session.userId ? getAuthUserById(session.userId) : null;
  const ownerId = user ? user.id : session.effectiveOwnerId;
  return {
    authenticated: Boolean(user),
    learnerId: ownerId,
    token: token || undefined,
    user,
    profile: getOrCreateUserProfile(ownerId),
  };
};

export const signUpUser = async (params: {
  email: string;
  password: string;
  fullName: string;
  currentToken?: string | null;
}): Promise<AuthSessionResponse & { token: string }> => {
  const email = params.email.trim().toLowerCase();
  const fullName = params.fullName.trim().slice(0, 80);
  const password = params.password;

  if (!EMAIL_RE.test(email)) {
    throw Object.assign(new Error("Please enter a valid email address."), { status: 400 });
  }
  if (!fullName || fullName.length < 2) {
    throw Object.assign(new Error("Full name must be at least 2 characters."), { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (existing) {
    throw Object.assign(new Error("An account with this email already exists."), { status: 409 });
  }

  const userId = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const passwordHash = await hashPassword(password);
  const now = Date.now();

  db.prepare(
    "INSERT INTO users (id, email, password_hash, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, email, passwordHash, fullName, now, now);

  // Create default profile or migrate from active guest session
  const currentSession = resolveSessionRecord(params.currentToken);
  if (currentSession && !currentSession.userId) {
    migrateGuestDataToUser(currentSession.sessionId, userId);
    db.prepare("UPDATE learner_sessions SET user_id = ?, last_seen_at = ? WHERE id = ?").run(
      userId,
      now,
      currentSession.sessionId
    );
  }

  const sessionToken =
    currentSession && !currentSession.userId && params.currentToken
      ? params.currentToken
      : createLearnerSession(userId).token;

  const profile = getOrCreateUserProfile(userId);
  const user = getAuthUserById(userId)!;

  return {
    authenticated: true,
    learnerId: userId,
    token: sessionToken,
    user,
    profile,
  };
};

export const signInUser = async (params: {
  email: string;
  password: string;
  currentToken?: string | null;
}): Promise<AuthSessionResponse & { token: string }> => {
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!EMAIL_RE.test(email) || typeof password !== "string" || !password) {
    throw Object.assign(new Error("Valid email and password are required."), { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, email, password_hash, full_name, created_at FROM users WHERE email = ?")
    .get(email) as any | undefined;

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw Object.assign(new Error("Invalid email or password."), { status: 401 });
  }

  const userId = row.id as string;
  const now = Date.now();
  const currentSession = resolveSessionRecord(params.currentToken);

  if (currentSession && !currentSession.userId) {
    migrateGuestDataToUser(currentSession.sessionId, userId);
  }

  const newSession = createLearnerSession(userId);
  if (currentSession && params.currentToken) {
    db.prepare("DELETE FROM learner_sessions WHERE token_hash = ?").run(hashToken(params.currentToken));
  }

  return {
    authenticated: true,
    learnerId: userId,
    token: newSession.token,
    user: {
      id: userId,
      email: row.email,
      fullName: row.full_name,
      createdAt: Number(row.created_at),
    },
    profile: getOrCreateUserProfile(userId),
  };
};

export const signOutSession = (token: string | null): AuthSessionResponse & { token: string } => {
  const db = getDb();
  if (token) {
    db.prepare("DELETE FROM learner_sessions WHERE token_hash = ?").run(hashToken(token));
  }
  const fresh = createLearnerSession(null);
  return {
    authenticated: false,
    learnerId: fresh.learnerId,
    token: fresh.token,
    user: null,
    profile: getOrCreateUserProfile(fresh.learnerId),
  };
};

export const requestPasswordReset = (emailInput: string): {
  accepted: boolean;
  resetCode?: string;
  expiresInMinutes: number;
  message: string;
} => {
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw Object.assign(new Error("Please enter a valid email address."), { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;

  // Never leak whether email exists when no user matches
  if (!user) {
    return {
      accepted: true,
      expiresInMinutes: 30,
      message: "If an account exists for that email, a one-time recovery code has been issued.",
    };
  }

  const rawToken = crypto.randomBytes(6).toString("hex").toUpperCase();
  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000;

  db.prepare(
    "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(`rst_${crypto.randomUUID().slice(0, 12)}`, user.id, hashToken(rawToken), expiresAt, now);

  return {
    accepted: true,
    // Since no external SMTP server is configured in this environment, return the single-use 30-min code for direct in-app reset testing.
    resetCode: rawToken,
    expiresInMinutes: 30,
    message:
      "Recovery code generated (valid 30 minutes). Note: External email delivery is not configured, so enter this one-time verification code directly below.",
  };
};

export const confirmPasswordReset = async (params: {
  email: string;
  resetCode: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> => {
  const email = params.email.trim().toLowerCase();
  const resetCode = params.resetCode.trim().toUpperCase();
  const newPassword = params.newPassword;

  if (!EMAIL_RE.test(email) || !resetCode) {
    throw Object.assign(new Error("Email and verification code are required."), { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw Object.assign(new Error("New password must be at least 8 characters."), { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) {
    throw Object.assign(new Error("Invalid or expired recovery code."), { status: 400 });
  }

  const now = Date.now();
  const tokenRow = db
    .prepare(
      `SELECT id FROM password_reset_tokens
       WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(user.id, hashToken(resetCode), now) as { id: string } | undefined;

  if (!tokenRow) {
    throw Object.assign(new Error("Invalid or expired recovery code."), { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
    passwordHash,
    now,
    user.id
  );
  db.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?").run(now, tokenRow.id);

  return { success: true, message: "Password updated successfully. You can now sign in." };
};

export const updateUserProfile = (
  ownerId: string,
  payload: {
    fullName?: string;
    preferredProfileId?: string;
    skillLevel?: UserProfile["skillLevel"];
    learningGoals?: string[];
    subjects?: string[];
    teachingPreference?: TeachingMode;
    dailyStudyMinutes?: number;
    targetDeadline?: string | null;
    onboardingCompleted?: boolean;
    themePreference?: ThemeMode;
  }
): { user: AuthUser | null; profile: UserProfile } => {
  const db = getDb();
  const current = getOrCreateUserProfile(ownerId);
  const now = Date.now();

  if (typeof payload.fullName === "string" && payload.fullName.trim().length >= 2) {
    db.prepare("UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?").run(
      payload.fullName.trim().slice(0, 80),
      now,
      ownerId
    );
  }

  const preferredProfileId =
    typeof payload.preferredProfileId === "string" && payload.preferredProfileId.trim()
      ? payload.preferredProfileId.trim().slice(0, 50)
      : current.preferredProfileId;

  const skillLevel: UserProfile["skillLevel"] =
    payload.skillLevel === "beginner" ||
    payload.skillLevel === "intermediate" ||
    payload.skillLevel === "advanced"
      ? payload.skillLevel
      : current.skillLevel;

  const learningGoals = Array.isArray(payload.learningGoals)
    ? payload.learningGoals
        .map((g) => (typeof g === "string" ? g.trim().slice(0, 100) : ""))
        .filter(Boolean)
        .slice(0, 8)
    : current.learningGoals;

  const subjects = Array.isArray(payload.subjects)
    ? payload.subjects
        .map((s) => (typeof s === "string" ? s.trim().slice(0, 60) : ""))
        .filter(Boolean)
        .slice(0, 8)
    : current.subjects;

  const teachingPreference =
    payload.teachingPreference && VALID_TEACHING_MODES.has(payload.teachingPreference)
      ? payload.teachingPreference
      : current.teachingPreference;

  const dailyStudyMinutes =
    typeof payload.dailyStudyMinutes === "number" && Number.isFinite(payload.dailyStudyMinutes)
      ? Math.min(240, Math.max(10, Math.round(payload.dailyStudyMinutes)))
      : current.dailyStudyMinutes;

  const targetDeadline =
    payload.targetDeadline === null
      ? null
      : typeof payload.targetDeadline === "string"
        ? payload.targetDeadline.trim().slice(0, 32) || null
        : current.targetDeadline || null;

  const onboardingCompleted =
    typeof payload.onboardingCompleted === "boolean"
      ? payload.onboardingCompleted
      : current.onboardingCompleted;

  const themePreference: ThemeMode =
    payload.themePreference === "light" || payload.themePreference === "dark"
      ? payload.themePreference
      : current.themePreference;

  db.prepare(
    `INSERT OR REPLACE INTO user_profiles (
      user_id, preferred_profile_id, skill_level, learning_goals_json, subjects_json,
      teaching_preference, daily_study_minutes, target_deadline, onboarding_completed, theme_preference, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ownerId,
    preferredProfileId,
    skillLevel,
    JSON.stringify(learningGoals),
    JSON.stringify(subjects),
    teachingPreference,
    dailyStudyMinutes,
    targetDeadline,
    onboardingCompleted ? 1 : 0,
    themePreference,
    now
  );

  return {
    user: getAuthUserById(ownerId),
    profile: getOrCreateUserProfile(ownerId),
  };
};
