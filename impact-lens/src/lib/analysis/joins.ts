export type JoinFieldRef = { sourceId: string; fieldId: string };

export type ExactJoinCandidate = {
  id: string;
  left: JoinFieldRef;
  right: JoinFieldRef;
  relationship: "one_to_one" | "one_to_many";
  leftInferredType?: string;
  rightInferredType?: string;
};

export type JoinTable = {
  sourceId: string;
  fields?: Array<{ id?: string; fieldId?: string; inferredType?: string; type?: string }>;
  rows: Array<{ values: Record<string, string> }>;
};

export type JoinAudit = {
  candidateId: string;
  relationship: ExactJoinCandidate["relationship"];
  eligible: boolean;
  matchCoverage: number;
  leftMatchCoverage: number;
  rightMatchCoverage: number;
  leftInferredType?: string;
  rightInferredType?: string;
  leftDuplicateKeys: number;
  rightDuplicateKeys: number;
  manyToManyKeys: number;
  reasons: string[];
};

export function normalizeJoinValue(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function auditExactJoin(candidate: ExactJoinCandidate, tables: JoinTable[]): JoinAudit {
  const left = tables.find((table) => table.sourceId === candidate.left.sourceId);
  const right = tables.find((table) => table.sourceId === candidate.right.sourceId);
  const reasons: string[] = [];

  if (!left || !right) {
    return {
      candidateId: candidate.id,
      relationship: candidate.relationship,
      eligible: false,
      matchCoverage: 0,
      leftMatchCoverage: 0,
      rightMatchCoverage: 0,
      ...(candidate.leftInferredType ? { leftInferredType: candidate.leftInferredType } : {}),
      ...(candidate.rightInferredType ? { rightInferredType: candidate.rightInferredType } : {}),
      leftDuplicateKeys: 0,
      rightDuplicateKeys: 0,
      manyToManyKeys: 0,
      reasons: ["One or both proposed sources are unavailable."],
    };
  }

  const leftValues = valuesFor(left, candidate.left.fieldId);
  const rightValues = valuesFor(right, candidate.right.fieldId);
  const leftCounts = countValues(leftValues);
  const rightCounts = countValues(rightValues);
  const leftSet = new Set(leftValues);
  const rightSet = new Set(rightValues);
  const matchingLeft = leftValues.filter((value) => rightSet.has(value)).length;
  const matchingRight = rightValues.filter((value) => leftSet.has(value)).length;
  const leftMatchCoverage = leftValues.length ? matchingLeft / leftValues.length : 0;
  const rightMatchCoverage = rightValues.length ? matchingRight / rightValues.length : 0;
  const matchCoverage = candidate.relationship === "one_to_many"
    ? rightMatchCoverage
    : Math.min(leftMatchCoverage, rightMatchCoverage);
  const leftDuplicateKeys = duplicateKeyCount(leftCounts);
  const rightDuplicateKeys = duplicateKeyCount(rightCounts);
  const manyToManyKeys = [...leftCounts.keys()].filter(
    (key) => (leftCounts.get(key) ?? 0) > 1 && (rightCounts.get(key) ?? 0) > 1,
  ).length;

  const leftType = candidate.leftInferredType ?? fieldType(left, candidate.left.fieldId);
  const rightType = candidate.rightInferredType ?? fieldType(right, candidate.right.fieldId);
  if (leftType && rightType && !areJoinTypesCompatible(leftType, rightType)) {
    reasons.push("Join key inferred types are incompatible.");
  }
  if (matchCoverage < 0.9) reasons.push(`Exact match coverage is ${Math.round(matchCoverage * 100)}%; at least 90% is required.`);
  if (manyToManyKeys > 0) reasons.push("The proposed key creates many-to-many matches.");
  if (leftDuplicateKeys > 0) reasons.push("The declared one side (left) contains duplicate join keys.");
  if (candidate.relationship === "one_to_one" && rightDuplicateKeys > 0) {
    reasons.push("A one-to-one relationship requires unique join keys on the right side.");
  }
  if (!leftValues.length || !rightValues.length) reasons.push("One or both join keys contain no usable values.");

  return {
    candidateId: candidate.id,
    relationship: candidate.relationship,
    eligible: reasons.length === 0,
    matchCoverage,
    leftMatchCoverage,
    rightMatchCoverage,
    ...(leftType ? { leftInferredType: leftType } : {}),
    ...(rightType ? { rightInferredType: rightType } : {}),
    leftDuplicateKeys,
    rightDuplicateKeys,
    manyToManyKeys,
    reasons,
  };
}

function valuesFor(table: JoinTable, fieldId: string): string[] {
  return table.rows
    .map((row) => normalizeJoinValue(row.values[fieldId] ?? ""))
    .filter(Boolean);
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function duplicateKeyCount(counts: Map<string, number>): number {
  return [...counts.values()].filter((count) => count > 1).length;
}

function fieldType(table: JoinTable, fieldId: string): string | undefined {
  const field = table.fields?.find((candidate) => (candidate.id ?? candidate.fieldId) === fieldId);
  return field?.inferredType ?? field?.type;
}

function areJoinTypesCompatible(left: string, right: string): boolean {
  const leftFamily = joinTypeFamily(left);
  const rightFamily = joinTypeFamily(right);
  return leftFamily === rightFamily;
}

function joinTypeFamily(type: string): string {
  const normalized = type.trim().toLocaleLowerCase("en-US");
  if (["integer", "number"].includes(normalized)) return "number";
  if (["identifier", "category", "text", "string"].includes(normalized)) return "string";
  return normalized;
}
