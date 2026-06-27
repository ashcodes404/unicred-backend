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

module.exports = { computeGrade, computeSGPA, computeCGPA };
