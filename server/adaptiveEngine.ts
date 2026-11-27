import crypto from "crypto";
import { getDb, ensureConceptInCatalog, formatConceptName } from "./db.ts";
import type {
  AdaptiveAction,
  AdaptiveDecision,
  AssessmentType,
  ConceptMasterySummary,
  ConfidenceState,
  DiagnosticOutcomeLevel,
  DiagnosticSummary,
  DifficultyLevel,
  GapType,
  LearningGapRecord,
  MasteryBand,
  MisconceptionCategory,
  MisconceptionObservation,
  PrerequisiteStatus,
  TeachingMode,
} from "../types.ts";

export const ADAPTIVE_CONFIG = {
  masteryWeights: {
    quiz_accuracy: 0.5,
    practical_performance: 0.3,
    retention_performance: 0.2,
  },
  difficultyMultipliers: {
    1: 0.85,
    2: 0.95,
    3: 1.05,
    4: 1.18,
    5: 1.3,
  } as Record<number, number>,
  masteryBands: [
    { min: 0, max: 39, band: "FOUNDATION_REQUIRED" as MasteryBand },
    { min: 40, max: 59, band: "DEVELOPING" as MasteryBand },
    { min: 60, max: 79, band: "FUNCTIONAL_UNDERSTANDING" as MasteryBand },
    { min: 80, max: 100, band: "STRONG_UNDERSTANDING" as MasteryBand },
  ],
  retentionStaleMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export type EvidenceCategory = "quiz_accuracy" | "practical_performance" | "retention_performance";

export const mapAssessmentToEvidenceCategory = (
  assessmentType: AssessmentType,
  questionType: string
): EvidenceCategory => {
  if (assessmentType === "retention") return "retention_performance";
  if (
    assessmentType === "application" ||
    assessmentType === "scenario" ||
    assessmentType === "code" ||
    questionType === "application" ||
    questionType === "scenario" ||
    questionType === "code" ||
    questionType === "debugging"
  ) {
    return "practical_performance";
  }
  return "quiz_accuracy";
};

export const classifyMasteryBand = (score: number): MasteryBand => {
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  for (const b of ADAPTIVE_CONFIG.masteryBands) {
    if (rounded >= b.min && rounded <= b.max) {
      return b.band;
    }
  }
  return "FOUNDATION_REQUIRED";
};

export const computeConfidenceState = (params: {
  observationCount: number;
  completedAttemptsCount: number;
  maxDifficultyTested: number;
  categoryCount: number;
}): ConfidenceState => {
  const { observationCount, completedAttemptsCount, maxDifficultyTested, categoryCount } = params;
  if (observationCount < 3 || completedAttemptsCount < 1) {
    return "insufficient_evidence";
  }
  if (observationCount < 5 || maxDifficultyTested < 2) {
    return "low_confidence";
  }
  if (
    observationCount >= 8 &&
    completedAttemptsCount >= 2 &&
    maxDifficultyTested >= 3 &&
    categoryCount >= 2
  ) {
    return "high_confidence";
  }
  return "moderate_confidence";
};

export const recalculateConceptMastery = (
  userId: string,
  conceptId: string,
  conceptName?: string,
  subject?: string
): ConceptMasterySummary => {
  const db = getDb();
  const catalogRow = db
    .prepare("SELECT concept_name, subject FROM concept_catalog WHERE concept_id = ?")
    .get(conceptId) as { concept_name: string; subject: string } | undefined;

  const resolvedName = conceptName || catalogRow?.concept_name || formatConceptName(conceptId);
  const resolvedSubject = subject || catalogRow?.subject || "Technology";
  ensureConceptInCatalog(conceptId, resolvedName, resolvedSubject);

  const observations = db
    .prepare(
      `SELECT evidence_category, normalized_score, difficulty_level, weight_multiplier, is_correct, created_at
       FROM mastery_observations
       WHERE user_id = ? AND concept_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId, conceptId) as Array<{
    evidence_category: EvidenceCategory;
    normalized_score: number;
    difficulty_level: number;
    weight_multiplier: number;
    is_correct: number;
    created_at: number;
  }>;

  if (observations.length === 0) {
    return {
      conceptId,
      conceptName: resolvedName,
      subject: resolvedSubject,
      status: "NOT ASSESSED",
      quizAccuracy: null,
      practicalPerformance: null,
      retentionPerformance: null,
      masteryScore: null,
      isProvisional: true,
      confidenceState: "insufficient_evidence",
      classificationBand: null,
      attemptsCount: 0,
      evidenceCount: 0,
      highestDifficultyPassed: 0,
      recentTrend: "stable",
    };
  }

  const categoryTotals: Record<EvidenceCategory, { weightedSum: number; weightTotal: number }> = {
    quiz_accuracy: { weightedSum: 0, weightTotal: 0 },
    practical_performance: { weightedSum: 0, weightTotal: 0 },
    retention_performance: { weightedSum: 0, weightTotal: 0 },
  };

  let maxDifficultyTested = 1;
  let highestDifficultyPassed = 0;
  let lastAssessedAt = 0;

  for (const obs of observations) {
    const cat = categoryTotals[obs.evidence_category]
      ? obs.evidence_category
      : "quiz_accuracy";
    const weight = obs.weight_multiplier || 1;
    categoryTotals[cat].weightedSum += obs.normalized_score * weight;
    categoryTotals[cat].weightTotal += weight;

    if (obs.difficulty_level > maxDifficultyTested) {
      maxDifficultyTested = obs.difficulty_level;
    }
    if (obs.normalized_score >= 70 && obs.difficulty_level > highestDifficultyPassed) {
      highestDifficultyPassed = obs.difficulty_level;
    }
    if (obs.created_at > lastAssessedAt) {
      lastAssessedAt = obs.created_at;
    }
  }

  const quizAccuracy =
    categoryTotals.quiz_accuracy.weightTotal > 0
      ? Number((categoryTotals.quiz_accuracy.weightedSum / categoryTotals.quiz_accuracy.weightTotal).toFixed(1))
      : null;
  const practicalPerformance =
    categoryTotals.practical_performance.weightTotal > 0
      ? Number(
          (
            categoryTotals.practical_performance.weightedSum /
            categoryTotals.practical_performance.weightTotal
          ).toFixed(1)
        )
      : null;
  const retentionPerformance =
    categoryTotals.retention_performance.weightTotal > 0
      ? Number(
          (
            categoryTotals.retention_performance.weightedSum /
            categoryTotals.retention_performance.weightTotal
          ).toFixed(1)
        )
      : null;

  // Renormalize weights strictly over available (non-null) categories; never treat missing data as 0
  const availableParts: Array<{ value: number; weight: number }> = [];
  if (quizAccuracy !== null) {
    availableParts.push({ value: quizAccuracy, weight: ADAPTIVE_CONFIG.masteryWeights.quiz_accuracy });
  }
  if (practicalPerformance !== null) {
    availableParts.push({
      value: practicalPerformance,
      weight: ADAPTIVE_CONFIG.masteryWeights.practical_performance,
    });
  }
  if (retentionPerformance !== null) {
    availableParts.push({
      value: retentionPerformance,
      weight: ADAPTIVE_CONFIG.masteryWeights.retention_performance,
    });
  }

  const totalWeight = availableParts.reduce((acc, p) => acc + p.weight, 0) || 1;
  const masteryScore = Number(
    availableParts.reduce((acc, p) => acc + p.value * (p.weight / totalWeight), 0).toFixed(1)
  );

  const completedAttemptsRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM assessment_attempts
       WHERE user_id = ? AND concept_id = ? AND status = 'completed'`
    )
    .get(userId, conceptId) as { cnt: number };

  const completedAttemptsCount = completedAttemptsRow?.cnt || 0;
  const totalAttemptsRow = db
    .prepare(
      `SELECT COUNT(DISTINCT attempt_id) AS cnt FROM mastery_observations
       WHERE user_id = ? AND concept_id = ?`
    )
    .get(userId, conceptId) as { cnt: number };

  const confidenceState = computeConfidenceState({
    observationCount: observations.length,
    completedAttemptsCount,
    maxDifficultyTested,
    categoryCount: availableParts.length,
  });

  const isProvisional =
    confidenceState === "insufficient_evidence" ||
    confidenceState === "low_confidence" ||
    availableParts.length < 2;

  const classificationBand = classifyMasteryBand(masteryScore);

  let recentTrend: "improving" | "stable" | "declining" = "stable";
  if (observations.length >= 6) {
    const recent3 = observations.slice(-3);
    const earlier = observations.slice(0, -3);
    const recentAvg = recent3.reduce((s, o) => s + o.normalized_score, 0) / recent3.length;
    const earlierAvg = earlier.reduce((s, o) => s + o.normalized_score, 0) / earlier.length;
    if (recentAvg - earlierAvg >= 12) recentTrend = "improving";
    else if (earlierAvg - recentAvg >= 15) recentTrend = "declining";
  }

  const now = Date.now();
  db.prepare(
    `INSERT INTO concept_mastery (
       user_id, concept_id, concept_name, subject,
       quiz_accuracy, practical_performance, retention_performance,
       mastery_score, is_provisional, confidence_state, classification_band,
       attempts_count, evidence_count, highest_difficulty_passed, recent_trend,
       last_assessed_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, concept_id) DO UPDATE SET
       concept_name = excluded.concept_name,
       subject = excluded.subject,
       quiz_accuracy = excluded.quiz_accuracy,
       practical_performance = excluded.practical_performance,
       retention_performance = excluded.retention_performance,
       mastery_score = excluded.mastery_score,
       is_provisional = excluded.is_provisional,
       confidence_state = excluded.confidence_state,
       classification_band = excluded.classification_band,
       attempts_count = excluded.attempts_count,
       evidence_count = excluded.evidence_count,
       highest_difficulty_passed = excluded.highest_difficulty_passed,
       recent_trend = excluded.recent_trend,
       last_assessed_at = excluded.last_assessed_at,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    conceptId,
    resolvedName,
    resolvedSubject,
    quizAccuracy,
    practicalPerformance,
    retentionPerformance,
    masteryScore,
    isProvisional ? 1 : 0,
    confidenceState,
    classificationBand,
    Math.max(completedAttemptsCount, totalAttemptsRow?.cnt || 1),
    observations.length,
    highestDifficultyPassed,
    recentTrend,
    lastAssessedAt,
    now
  );

  return {
    conceptId,
    conceptName: resolvedName,
    subject: resolvedSubject,
    status: "ASSESSED",
    quizAccuracy,
    practicalPerformance,
    retentionPerformance,
    masteryScore,
    isProvisional,
    confidenceState,
    classificationBand,
    attemptsCount: Math.max(completedAttemptsCount, totalAttemptsRow?.cnt || 1),
    evidenceCount: observations.length,
    highestDifficultyPassed,
    recentTrend,
    lastAssessedAt,
  };
};

export const getConceptMastery = (
  userId: string,
  conceptId: string,
  conceptName?: string,
  subject?: string
): ConceptMasterySummary => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM concept_mastery WHERE user_id = ? AND concept_id = ?")
    .get(userId, conceptId) as any;

  if (!row) {
    const cat = db
      .prepare("SELECT concept_name, subject FROM concept_catalog WHERE concept_id = ?")
      .get(conceptId) as { concept_name: string; subject: string } | undefined;
    return {
      conceptId,
      conceptName: conceptName || cat?.concept_name || formatConceptName(conceptId),
      subject: subject || cat?.subject || "Technology",
      status: "NOT ASSESSED",
      quizAccuracy: null,
      practicalPerformance: null,
      retentionPerformance: null,
      masteryScore: null,
      isProvisional: true,
      confidenceState: "insufficient_evidence",
      classificationBand: null,
      attemptsCount: 0,
      evidenceCount: 0,
      highestDifficultyPassed: 0,
      recentTrend: "stable",
    };
  }

  return {
    conceptId: row.concept_id,
    conceptName: row.concept_name,
    subject: row.subject,
    status: "ASSESSED",
    quizAccuracy: row.quiz_accuracy,
    practicalPerformance: row.practical_performance,
    retentionPerformance: row.retention_performance,
    masteryScore: row.mastery_score,
    isProvisional: Boolean(row.is_provisional),
    confidenceState: row.confidence_state,
    classificationBand: row.classification_band,
    attemptsCount: row.attempts_count,
    evidenceCount: row.evidence_count,
    highestDifficultyPassed: row.highest_difficulty_passed,
    recentTrend: row.recent_trend,
    lastAssessedAt: row.last_assessed_at,
  };
};

/**
 * Phase 5: Deterministic adaptive difficulty transitions.
 * - Never jumps to advanced after a single correct answer.
 * - Never repeatedly lowers difficulty due to one isolated mistake.
 */
export const computeNextDifficulty = (
  attemptId: string,
  currentDifficulty: DifficultyLevel
): { nextDifficulty: DifficultyLevel; teachingInterventionTriggered: boolean } => {
  const db = getDb();
  const answers = db
    .prepare(
      `SELECT score, difficulty_level, evaluation_result
       FROM student_answers
       WHERE attempt_id = ?
       ORDER BY submitted_at ASC`
    )
    .all(attemptId) as Array<{
    score: number;
    difficulty_level: number;
    evaluation_result: string;
  }>;

  if (answers.length === 0) {
    return { nextDifficulty: currentDifficulty, teachingInterventionTriggered: false };
  }

  const lastTwo = answers.slice(-2);
  let nextDiff = currentDifficulty;
  let teachingInterventionTriggered = false;

  // Require at least 2 consecutive strong responses at current difficulty to step up (+1 max)
  if (
    lastTwo.length === 2 &&
    lastTwo.every((a) => a.score >= 80 && a.difficulty_level >= currentDifficulty) &&
    currentDifficulty < 5
  ) {
    nextDiff = (currentDifficulty + 1) as DifficultyLevel;
  } else if (
    lastTwo.length === 2 &&
    lastTwo.every((a) => a.score < 50 && a.difficulty_level <= currentDifficulty)
  ) {
    if (currentDifficulty > 1) {
      nextDiff = (currentDifficulty - 1) as DifficultyLevel;
    } else {
      // Repeated mistakes at Level 1 trigger teaching intervention
      teachingInterventionTriggered = true;
    }
  }

  return { nextDifficulty: nextDiff, teachingInterventionTriggered };
};

export const recordMisconceptionObservation = (params: {
  userId: string;
  conceptId: string;
  category: MisconceptionCategory;
  description: string;
  evidenceFromAnswer: string;
  confidence: number;
  recommendedIntervention: string;
}): MisconceptionObservation => {
  const db = getDb();
  const normalizedDesc = params.description.trim().slice(0, 300);
  const now = Date.now();

  const existingRows = db
    .prepare(
      `SELECT * FROM misconception_records
       WHERE user_id = ? AND concept_id = ? AND category = ?`
    )
    .all(params.userId, params.conceptId, params.category) as any[];

  const normalizedKey = normalizedDesc.toLowerCase().slice(0, 60);
  const matched = existingRows.find(
    (r) => String(r.description).toLowerCase().slice(0, 60) === normalizedKey
  );

  if (matched) {
    const newCount = (matched.occurrence_count || 1) + 1;
    const isPattern = newCount >= 2 ? 1 : 0;
    db.prepare(
      `UPDATE misconception_records
       SET occurrence_count = ?, is_pattern = ?, evidence_from_answer = ?, confidence = ?, last_observed_at = ?
       WHERE id = ?`
    ).run(
      newCount,
      isPattern,
      params.evidenceFromAnswer.slice(0, 300),
      Math.max(matched.confidence, params.confidence),
      now,
      matched.id
    );

    return {
      id: matched.id,
      conceptId: params.conceptId,
      category: params.category,
      description: matched.description,
      evidenceFromAnswer: params.evidenceFromAnswer,
      confidence: Math.max(matched.confidence, params.confidence),
      recommendedIntervention: matched.recommended_intervention,
      occurrenceCount: newCount,
      isPattern: Boolean(isPattern),
    };
  }

  const id = `msc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  db.prepare(
    `INSERT INTO misconception_records (
       id, user_id, concept_id, category, description,
       evidence_from_answer, confidence, recommended_intervention,
       occurrence_count, is_pattern, last_observed_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).run(
    id,
    params.userId,
    params.conceptId,
    params.category,
    normalizedDesc,
    params.evidenceFromAnswer.slice(0, 300),
    Math.max(0, Math.min(1, params.confidence)),
    params.recommendedIntervention.slice(0, 300),
    now,
    now
  );

  return {
    id,
    conceptId: params.conceptId,
    category: params.category,
    description: normalizedDesc,
    evidenceFromAnswer: params.evidenceFromAnswer,
    confidence: Math.max(0, Math.min(1, params.confidence)),
    recommendedIntervention: params.recommendedIntervention,
    occurrenceCount: 1,
    isPattern: false,
  };
};

export const analyzePrerequisites = (
  userId: string,
  conceptId: string
): PrerequisiteStatus[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.prerequisite_id, p.rationale, COALESCE(c.concept_name, p.prerequisite_id) AS concept_name
       FROM concept_prerequisites p
       LEFT JOIN concept_catalog c ON c.concept_id = p.prerequisite_id
       WHERE p.concept_id = ?`
    )
    .all(conceptId) as Array<{
    prerequisite_id: string;
    rationale: string;
    concept_name: string;
  }>;

  const targetMastery = getConceptMastery(userId, conceptId);
  const strugglingWithTarget =
    targetMastery.status === "ASSESSED" &&
    targetMastery.masteryScore !== null &&
    targetMastery.masteryScore < 60;

  return rows.map((row) => {
    const prereqMastery = getConceptMastery(userId, row.prerequisite_id, row.concept_name);
    const isWeak =
      prereqMastery.status === "ASSESSED" &&
      prereqMastery.masteryScore !== null &&
      prereqMastery.masteryScore < 60;
    const isUnassessedWhileStruggling =
      strugglingWithTarget && prereqMastery.status === "NOT ASSESSED";

    return {
      conceptId: row.prerequisite_id,
      conceptName: prereqMastery.conceptName,
      rationale: row.rationale,
      status: prereqMastery.status,
      masteryScore: prereqMastery.masteryScore,
      classificationBand: prereqMastery.classificationBand,
      needsReinforcement: isWeak || isUnassessedWhileStruggling,
    };
  });
};

export const detectLearningGapsForConcept = (
  userId: string,
  conceptId: string
): LearningGapRecord[] => {
  const db = getDb();
  const mastery = getConceptMastery(userId, conceptId);
  if (mastery.status === "NOT ASSESSED" || mastery.masteryScore === null) {
    // Phase 14: Never fabricate gaps or label unassessed concepts as weak
    return [];
  }

  const gaps: LearningGapRecord[] = [];
  const incorrectRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM student_answers
       WHERE user_id = ? AND concept_id = ? AND evaluation_result = 'incorrect'`
    )
    .get(userId, conceptId) as { cnt: number };
  const incorrectCount = incorrectRow?.cnt || 0;

  // 1. Weak foundational or low mastery
  if (mastery.masteryScore < 40) {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "weak_foundation",
      evidence: `Mastery score ${mastery.masteryScore}% (${mastery.evidenceCount} assessed items)`,
      confidence: mastery.confidenceState,
      priority: "high",
      recommendedIntervention: "Re-teach core intuition with a simple real-world analogy and foundational checks.",
      recommendedLearningMode: "simple_explanation",
      suggestedNextActivity: "RE-TEACH",
    });
  } else if (mastery.masteryScore < 60) {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "low_mastery",
      evidence: `Developing mastery at ${mastery.masteryScore}% across ${mastery.attemptsCount} attempt(s)`,
      confidence: mastery.confidenceState,
      priority: "medium",
      recommendedIntervention: "Use step-by-step worked examples followed by guided practice.",
      recommendedLearningMode: "step_by_step",
      suggestedNextActivity: "GUIDED_PRACTICE",
    });
  }

  // 2. Repeated errors
  if (incorrectCount >= 3) {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "repeated_errors",
      evidence: `${incorrectCount} incorrect responses recorded on ${mastery.conceptName}`,
      confidence: mastery.confidenceState,
      priority: "high",
      recommendedIntervention: "Switch to cultural analogy + targeted misconception walkthrough.",
      recommendedLearningMode: "cultural_analogy",
      suggestedNextActivity: "ANALOGY",
    });
  }

  // 3. Repeated misconception patterns
  const patterns = db
    .prepare(
      `SELECT category, description, occurrence_count FROM misconception_records
       WHERE user_id = ? AND concept_id = ? AND is_pattern = 1`
    )
    .all(userId, conceptId) as Array<{
    category: string;
    description: string;
    occurrence_count: number;
  }>;

  if (patterns.length > 0) {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "repeated_misconception",
      evidence: `${patterns[0].category} observed ${patterns[0].occurrence_count} times: ${patterns[0].description}`,
      confidence: mastery.confidenceState,
      priority: "high",
      recommendedIntervention: `Directly address "${patterns[0].description}" before advancing.`,
      recommendedLearningMode: "simple_explanation",
      suggestedNextActivity: "RE-TEACH",
    });
  }

  // 4. Prerequisite weaknesses
  const prereqs = analyzePrerequisites(userId, conceptId);
  const weakPrereqs = prereqs.filter((p) => p.needsReinforcement);
  if (weakPrereqs.length > 0) {
    const first = weakPrereqs[0];
    gaps.push({
      conceptId: first.conceptId,
      conceptName: first.conceptName,
      gapType: "missing_prerequisite",
      evidence:
        first.status === "NOT ASSESSED"
          ? `Prerequisite "${first.conceptName}" is NOT ASSESSED while ${mastery.conceptName} mastery is ${mastery.masteryScore}%`
          : `Prerequisite "${first.conceptName}" mastery is ${first.masteryScore}%`,
      confidence: mastery.confidenceState,
      priority: "high",
      recommendedIntervention: `Strengthen prerequisite "${first.conceptName}": ${first.rationale}`,
      recommendedLearningMode: "simple_explanation",
      suggestedNextActivity: "FOUNDATIONAL_PRACTICE",
    });
  }

  // 5. Inconsistent performance
  const obsScores = db
    .prepare(
      `SELECT normalized_score FROM mastery_observations
       WHERE user_id = ? AND concept_id = ?
       ORDER BY created_at DESC LIMIT 6`
    )
    .all(userId, conceptId) as Array<{ normalized_score: number }>;
  if (obsScores.length >= 4) {
    const vals = obsScores.map((o) => o.normalized_score);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread >= 55 && mastery.masteryScore >= 40 && mastery.masteryScore < 80) {
      gaps.push({
        conceptId,
        conceptName: mastery.conceptName,
        gapType: "inconsistent_performance",
        evidence: `Recent question scores vary widely (${Math.min(...vals)}% to ${Math.max(...vals)}%)`,
        confidence: mastery.confidenceState,
        priority: "medium",
        recommendedIntervention: "Reinforce consistency with practical application scenarios.",
        recommendedLearningMode: "practical_application",
        suggestedNextActivity: "APPLICATION",
      });
    }
  }

  // 6. Declining performance
  if (mastery.recentTrend === "declining") {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "declining_performance",
      evidence: "Recent responses scored noticeably lower than earlier attempts.",
      confidence: mastery.confidenceState,
      priority: "medium",
      recommendedIntervention: "Schedule a short revision and targeted check.",
      recommendedLearningMode: "step_by_step",
      suggestedNextActivity: "RETENTION_REVISION",
    });
  }

  // 7. Retention needed
  const isStale =
    mastery.lastAssessedAt !== undefined &&
    Date.now() - mastery.lastAssessedAt > ADAPTIVE_CONFIG.retentionStaleMs;
  if (
    mastery.masteryScore >= 75 &&
    (isStale || mastery.retentionPerformance === null) &&
    mastery.evidenceCount >= 3
  ) {
    gaps.push({
      conceptId,
      conceptName: mastery.conceptName,
      gapType: "retention_revision_needed",
      evidence:
        mastery.retentionPerformance === null
          ? "Concept has not yet been verified with a retention check."
          : "Last assessment was over 7 days ago.",
      confidence: mastery.confidenceState,
      priority: "low",
      recommendedIntervention: "Run a quick retention revision quiz to lock in long-term recall.",
      recommendedLearningMode: "practical_application",
      suggestedNextActivity: "RETENTION_REVISION",
    });
  }

  return gaps;
};

export const detectAllLearningGaps = (userId: string): LearningGapRecord[] => {
  const db = getDb();
  const assessed = db
    .prepare("SELECT concept_id FROM concept_mastery WHERE user_id = ?")
    .all(userId) as Array<{ concept_id: string }>;

  const allGaps: LearningGapRecord[] = [];
  const seen = new Set<string>();
  for (const row of assessed) {
    const gaps = detectLearningGapsForConcept(userId, row.concept_id);
    for (const g of gaps) {
      const key = `${g.conceptId}:${g.gapType}`;
      if (!seen.has(key)) {
        seen.add(key);
        allGaps.push(g);
      }
    }
  }
  const priorityRank = { high: 0, medium: 1, low: 2 };
  allGaps.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  return allGaps;
};

export const computeDiagnosticOutcome = (
  attemptId: string,
  conceptName: string,
  subject: string
): DiagnosticSummary => {
  const db = getDb();
  const answers = db
    .prepare(
      `SELECT a.score, a.difficulty_level, a.evaluation_result, q.learning_objective
       FROM student_answers a
       JOIN assessment_questions q ON q.id = a.question_id
       WHERE a.attempt_id = ?`
    )
    .all(attemptId) as Array<{
    score: number;
    difficulty_level: number;
    evaluation_result: string;
    learning_objective: string;
  }>;

  const isProvisional = answers.length < 3;
  if (answers.length === 0) {
    return {
      subject,
      conceptName,
      level: "Foundation level",
      isProvisional: true,
      knowledgeGaps: ["Insufficient diagnostic answers submitted."],
      recommendedTeachingApproach: "Start with a diagnostic quiz of at least 3 questions before setting difficulty.",
    };
  }

  const totalWeight = answers.reduce(
    (acc, a) => acc + (ADAPTIVE_CONFIG.difficultyMultipliers[a.difficulty_level] || 1),
    0
  );
  const weightedScore =
    answers.reduce(
      (acc, a) =>
        acc + a.score * (ADAPTIVE_CONFIG.difficultyMultipliers[a.difficulty_level] || 1),
      0
    ) / (totalWeight || 1);
  const maxDifficultyCorrect = Math.max(
    0,
    ...answers.filter((a) => a.score >= 70).map((a) => a.difficulty_level)
  );

  let level: DiagnosticOutcomeLevel = "Foundation level";
  let recommendedTeachingApproach =
    "Start with plain-language intuition and a relatable everyday analogy.";

  if (weightedScore >= 80 && maxDifficultyCorrect >= 3) {
    level = "Advanced understanding";
    recommendedTeachingApproach =
      "Move straight into complex edge cases, real-world architecture, and challenge problems.";
  } else if (weightedScore >= 60) {
    level = "Intermediate level";
    recommendedTeachingApproach =
      "Focus on deeper mechanisms, practical applications, and targeted misconception checks.";
  } else if (weightedScore >= 40) {
    level = "Developing level";
    recommendedTeachingApproach =
      "Combine step-by-step guided examples with applied beginner exercises.";
  }

  const knowledgeGaps = answers
    .filter((a) => a.score < 60)
    .map((a) => a.learning_objective)
    .slice(0, 4);

  return {
    subject,
    conceptName,
    level,
    isProvisional,
    knowledgeGaps,
    recommendedTeachingApproach,
  };
};

export const computeAdaptiveDecision = (
  userId: string,
  conceptId: string,
  conceptName?: string
): AdaptiveDecision => {
  const db = getDb();
  const mastery = getConceptMastery(userId, conceptId, conceptName);
  const prerequisiteAlerts = analyzePrerequisites(userId, conceptId);
  const learningGaps = detectLearningGapsForConcept(userId, conceptId);

  // Suggest next concept that lists conceptId as a prerequisite
  const nextConceptRow = db
    .prepare(
      `SELECT COALESCE(c.concept_name, p.concept_id) AS next_name
       FROM concept_prerequisites p
       LEFT JOIN concept_catalog c ON c.concept_id = p.concept_id
       WHERE p.prerequisite_id = ?
       LIMIT 1`
    )
    .get(conceptId) as { next_name: string } | undefined;

  if (mastery.status === "NOT ASSESSED" || mastery.masteryScore === null) {
    return {
      conceptId,
      conceptName: mastery.conceptName,
      masteryScore: null,
      evidenceConfidence: "insufficient_evidence",
      learningStatus: "NOT ASSESSED",
      recommendedAction: "GUIDED_PRACTICE",
      recommendedAssessmentType: "diagnostic",
      recommendedTeachingMode: "cultural_analogy",
      reason: `No assessment evidence recorded yet for ${mastery.conceptName}. Start with a short diagnostic check to measure baseline understanding.`,
      prerequisiteAlerts,
      learningGaps: [],
      requiresUserConsent: true,
      nextConceptSuggestion: nextConceptRow?.next_name,
    };
  }

  const weakPrereq = prerequisiteAlerts.find((p) => p.needsReinforcement);
  const hasPatternMisconception = learningGaps.some((g) => g.gapType === "repeated_misconception");
  const needsRetention = learningGaps.some((g) => g.gapType === "retention_revision_needed");
  const score = mastery.masteryScore;

  let recommendedAction: AdaptiveAction = "GUIDED_PRACTICE";
  let recommendedAssessmentType: AssessmentType = "adaptive_practice";
  let recommendedTeachingMode: TeachingMode = "step_by_step";
  let reason = "";

  if (weakPrereq && score < 55) {
    recommendedAction = "FOUNDATIONAL_PRACTICE";
    recommendedAssessmentType = "beginner";
    recommendedTeachingMode = "simple_explanation";
    reason = `Mastery on ${mastery.conceptName} is ${score}%, and prerequisite "${weakPrereq.conceptName}" (${
      weakPrereq.status === "NOT ASSESSED" ? "NOT ASSESSED" : `${weakPrereq.masteryScore}%`
    }) needs reinforcement.`;
  } else if (hasPatternMisconception) {
    recommendedAction = "ANALOGY";
    recommendedAssessmentType = "concept_mastery";
    recommendedTeachingMode = "cultural_analogy";
    reason = `Repeated misconception detected on ${mastery.conceptName}. A relatable analogy and targeted correction will clear up the confusion.`;
  } else if (score < 40) {
    recommendedAction = "RE-TEACH";
    recommendedAssessmentType = "beginner";
    recommendedTeachingMode = "simple_explanation";
    reason = `Mastery is ${score}% (${mastery.classificationBand}). Re-teaching foundational intuition before harder questions is recommended.`;
  } else if (score < 60) {
    recommendedAction = "GUIDED_PRACTICE";
    recommendedAssessmentType = "adaptive_practice";
    recommendedTeachingMode = "step_by_step";
    reason = `Mastery is ${score}% (Developing). Step-by-step guided practice will consolidate the core mechanism.`;
  } else if (score < 80) {
    recommendedAction = mastery.practicalPerformance === null ? "APPLICATION" : "ADVANCED_PRACTICE";
    recommendedAssessmentType =
      mastery.practicalPerformance === null ? "application" : "scenario";
    recommendedTeachingMode = "practical_application";
    reason = `Functional understanding (${score}%) achieved. Real-world application scenarios will build deeper transfer and confidence.`;
  } else if (
    mastery.confidenceState === "insufficient_evidence" ||
    mastery.confidenceState === "low_confidence"
  ) {
    // High score on a single easy quiz is NOT sufficient evidence to advance
    recommendedAction = "APPLICATION";
    recommendedAssessmentType = "application";
    recommendedTeachingMode = "practical_application";
    reason = `Score is ${score}%, but evidence confidence is "${mastery.confidenceState.replace("_", " ")}". Complete an application or higher-difficulty check to confirm strong mastery.`;
  } else if (needsRetention) {
    recommendedAction = "RETENTION_REVISION";
    recommendedAssessmentType = "retention";
    recommendedTeachingMode = "practical_application";
    reason = `Strong mastery (${score}%) recorded, and a quick retention check will confirm long-term recall.`;
  } else {
    recommendedAction = "ADVANCE";
    recommendedAssessmentType = "concept_mastery";
    recommendedTeachingMode = "technical_deep_dive";
    reason = `Strong understanding (${score}%) backed by ${mastery.confidenceState.replace("_", " ")}. Ready to advance${
      nextConceptRow?.next_name ? ` to ${nextConceptRow.next_name}` : " to deeper topics"
    }.`;
  }

  return {
    conceptId,
    conceptName: mastery.conceptName,
    masteryScore: score,
    evidenceConfidence: mastery.confidenceState,
    learningStatus: `${mastery.classificationBand}${mastery.isProvisional ? " (Provisional)" : ""}`,
    recommendedAction,
    recommendedAssessmentType,
    recommendedTeachingMode,
    reason,
    prerequisiteAlerts,
    learningGaps,
    requiresUserConsent: true,
    nextConceptSuggestion: nextConceptRow?.next_name,
  };
};
