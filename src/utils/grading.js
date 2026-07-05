// src/utils/grading.js
// Pure helper functions for grade computation.
// Called during mark upload and result publication.
// No DB access here — just math.

/**
 * Computes the grade for one subject.
 *
 * Steps:
 * 1. If marks < passingMarks → instant "F" (fail), no further checks
 * 2. Convert marks to percentage: (marks / totalMarks) * 100
 * 3. Walk through grade rules (sorted highest first) to find the matching range
 *
 * @param {number} marks         - Marks scored
 * @param {number} totalMarks    - Max marks for the subject
 * @param {number} passingMarks  - Minimum marks to pass
 * @param {Array}  gradeRules    - Array of GradeRule rows, sorted by minMarksPercent DESC
 * @returns {{ grade, gradePoint, isPassed }}
 */
function computeGrade(marks, totalMarks, passingMarks, gradeRules) {
  // Below passing threshold → fail immediately
  if (marks < passingMarks) {
    return { grade: "F", gradePoint: 0, isPassed: false };
  }

  const percentage = (marks / totalMarks) * 100;

  // Walk rules highest → lowest, first match wins
  for (const rule of gradeRules) {
    if (percentage >= rule.minMarksPercent && percentage <= rule.maxMarksPercent) {
      return {
        grade: rule.grade,
        gradePoint: rule.gradePoint,
        isPassed: rule.gradePoint > 0, // gradePoint=0 means F
      };
    }
  }

  // Fallback — should never happen if rules cover 0-100 fully
  console.warn(`No grade rule matched for ${marks}/${totalMarks} (${percentage.toFixed(2)}%)`);
  return { grade: "F", gradePoint: 0, isPassed: false };
}

/**
 * Computes SGPA for one semester.
 *
 * Formula: Σ(gradePoint × credits) / Σ(credits)
 *
 * Example:
 *   Subject A: gradePoint=9, credits=4  → 36
 *   Subject B: gradePoint=7, credits=3  → 21
 *   Subject C: gradePoint=0, credits=3  → 0  (failed)
 *   SGPA = 57 / 10 = 5.70
 *
 * @param {Array} subjectResults - [{ credits, gradePoint, isPassed }, ...]
 * @returns {{ sgpa, totalCredits, isPassed }}
 */
function computeSGPA(subjectResults) {
  if (!subjectResults.length) return { sgpa: 0, totalCredits: 0, isPassed: false };

  let totalCredits = 0;
  let weightedSum = 0;
  let allPassed = true;

  for (const s of subjectResults) {
    totalCredits += s.credits;
    weightedSum += s.gradePoint * s.credits;
    if (!s.isPassed) allPassed = false;
  }

  const sgpa = totalCredits > 0 ? weightedSum / totalCredits : 0;

  return {
    sgpa: parseFloat(sgpa.toFixed(2)),
    totalCredits,
    isPassed: allPassed,
  };
}

/**
 * Computes CGPA across all semesters.
 *
 * Formula: Σ(sgpa × totalCredits) / Σ(totalCredits)
 * Heavier credit semesters contribute more to CGPA.
 *
 * @param {Array} semesterRecords - [{ sgpa, totalCredits }, ...]
 * @returns {number} CGPA rounded to 2 decimal places
 */
function computeCGPA(semesterRecords) {
  if (!semesterRecords.length) return 0;

  let totalCredits = 0;
  let weightedSum = 0;

  for (const sem of semesterRecords) {
    totalCredits += sem.totalCredits;
    weightedSum += sem.sgpa * sem.totalCredits;
  }

  const cgpa = totalCredits > 0 ? weightedSum / totalCredits : 0;
  return parseFloat(cgpa.toFixed(2));
}

/** average — arithmetic mean of a list of numbers. Returns 0 for an empty list (avoids a 0/0 = NaN result). */
function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

/**
 * standardDeviation — POPULATION standard deviation (not "sample" standard
 * deviation) of a list of numbers around a given mean. We use the
 * population formula (divide by N, not N-1) because for grading purposes
 * the class IS the entire population being graded, not a sample drawn
 * from some larger population.
 *
 * Formula: sqrt( Σ(x - mean)² / N )
 */
function standardDeviation(numbers, mean) {
  if (numbers.length === 0) return 0;
  const variance = average(numbers.map((n) => (n - mean) ** 2));
  return Math.sqrt(variance);
}

// How many standard deviations above/below the mean count as the very
// top / very bottom of the curve. +MAX_Z and above always gets the best
// passing grade; -MAX_Z and below (but still >= passingMarks) always gets
// the lowest passing grade. 1.5 SD is a commonly used width for this kind
// of banding — wide enough that a normal-ish mark distribution actually
// uses every grade, narrow enough that an average student still lands
// somewhere in the middle bands rather than the extremes.
const MAX_Z = 1.5;

/**
 * computeRelativeGrades — "grading on a curve": assigns every student in
 * a subject a grade based on where their marks fall relative to their
 * OWN cohort's mean and standard deviation, instead of the fixed
 * marks-percentage bands computeGrade() uses.
 *
 * HOW IT WORKS:
 * 1. The school's PASSING MARKS floor is still absolute and untouched —
 *    relative grading only decides how passing students are split
 *    between the passing grades; it can never turn a fail into a pass or
 *    vice versa.
 * 2. Compute the mean and standard deviation of marks across everyone who
 *    passed.
 * 3. Convert each passing student's marks into a "z-score": how many
 *    standard deviations above/below the mean they scored —
 *    z = (marks - mean) / standardDeviation.
 * 4. The school's passing grade rules (everything except the F rule) are
 *    sorted best-first, then evenly divided into z-score bands spanning
 *    from +MAX_Z down to -MAX_Z. E.g. with 6 passing grades, the 5
 *    interior cutoffs sit at +0.9, +0.3, -0.3, -0.9 (evenly spaced across
 *    the ±1.5 range) — a z-score at or above the top cutoff gets the best
 *    grade, at or below the bottom cutoff gets the lowest passing grade.
 *
 * EDGE CASE — not enough data to compute a meaningful curve: if fewer
 * than 2 students passed, or every passer scored EXACTLY the same marks
 * (standard deviation = 0), there is no real "spread" to grade against —
 * a curve is only meaningful when marks actually vary. In both cases this
 * quietly falls back to per-student ABSOLUTE grading (computeGrade)
 * instead of producing a meaningless or divide-by-zero result.
 *
 * @param {Array<{studentId:number, marks:number}>} marks
 * @param {number} totalMarks
 * @param {number} passingMarks
 * @param {Array}  gradeRules - GradeRule rows for the school's active grading system
 * @returns {Array<{studentId:number, marks:number, grade:string, gradePoint:number, isPassed:boolean}>}
 */
function computeRelativeGrades(marks, totalMarks, passingMarks, gradeRules) {
  const failRule = gradeRules.find((r) => r.gradePoint === 0);
  const toFailResult = (m) => ({
    studentId: m.studentId,
    marks: m.marks,
    grade: failRule?.grade ?? "F",
    gradePoint: 0,
    isPassed: false,
  });
  const toAbsoluteResult = (m) => {
    const { grade, gradePoint, isPassed } = computeGrade(m.marks, totalMarks, passingMarks, gradeRules);
    return { studentId: m.studentId, marks: m.marks, grade, gradePoint, isPassed };
  };

  const failing = marks.filter((m) => m.marks < passingMarks);
  const passing = marks.filter((m) => m.marks >= passingMarks);

  // Passing grade rules, best (highest gradePoint) first.
  const passingRules = gradeRules.filter((r) => r.gradePoint > 0).sort((a, b) => b.gradePoint - a.gradePoint);

  // Misconfigured grading system (no passing rule at all) — nothing
  // sensible to assign a passer, so fall back to computeGrade's own
  // "no rule matched" behaviour for everyone.
  if (passingRules.length === 0) {
    return marks.map(toAbsoluteResult);
  }

  const mean = average(passing.map((m) => m.marks));
  const stdDev = standardDeviation(passing.map((m) => m.marks), mean);

  // Not enough spread to curve against — grade the passers absolutely
  // instead (failers are already decided by the passingMarks floor either way).
  if (passing.length < 2 || stdDev === 0) {
    return [...failing.map(toFailResult), ...passing.map(toAbsoluteResult)];
  }

  const bandWidth = (2 * MAX_Z) / passingRules.length;

  const passingResults = passing.map((m) => {
    const z = (m.marks - mean) / stdDev;

    // Find which band this z-score falls into. Band `i` (0 = best grade)
    // covers z in [MAX_Z - (i+1)*bandWidth, MAX_Z - i*bandWidth) — except
    // the very first band (no upper limit) and the very last band (no
    // lower limit), so an unusually extreme outlier still lands in the
    // top/bottom grade rather than matching nothing.
    let bandIndex = passingRules.length - 1; // default: lowest passing grade
    for (let i = 0; i < passingRules.length; i++) {
      const lowerBound = MAX_Z - (i + 1) * bandWidth;
      if (z >= lowerBound) {
        bandIndex = i;
        break;
      }
    }

    const rule = passingRules[bandIndex];
    return { studentId: m.studentId, marks: m.marks, grade: rule.grade, gradePoint: rule.gradePoint, isPassed: true };
  });

  return [...failing.map(toFailResult), ...passingResults];
}

module.exports = { computeGrade, computeSGPA, computeCGPA, computeRelativeGrades };
