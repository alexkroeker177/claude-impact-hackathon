import type { ParsedTable } from "@/lib/files/types";
import type { CandidateJoin } from "@/lib/semantic/schema";
import { normalizeValue } from "@/lib/metrics/evaluate";

export interface JoinAudit {
  eligible: boolean;
  reasons: string[];
  matchCoverage: number;
}

/**
 * Exact-join audit only: NFKC + trim + casefold normalization, >=90% left-key
 * match coverage, zero duplicate right keys (no many-to-many). No fuzzy matching.
 */
export function auditExactJoin(candidate: CandidateJoin, tables: ParsedTable[]): JoinAudit {
  const reasons: string[] = [];
  const leftTable = tables.find((t) => t.sourceId === candidate.left.sourceId);
  const rightTable = tables.find((t) => t.sourceId === candidate.right.sourceId);
  if (!leftTable || !rightTable) {
    return { eligible: false, reasons: ["One or both referenced tables do not exist."], matchCoverage: 0 };
  }
  if (
    !leftTable.fields.some((f) => f.id === candidate.left.fieldId) ||
    !rightTable.fields.some((f) => f.id === candidate.right.fieldId)
  ) {
    return { eligible: false, reasons: ["One or both referenced fields do not exist."], matchCoverage: 0 };
  }

  const leftValues = leftTable.rows
    .map((r) => r.values[candidate.left.fieldId] ?? "")
    .filter((v) => v.trim() !== "")
    .map(normalizeValue);

  const rightKeyCounts = new Map<string, number>();
  for (const row of rightTable.rows) {
    const raw = row.values[candidate.right.fieldId] ?? "";
    if (raw.trim() === "") continue;
    const key = normalizeValue(raw);
    rightKeyCounts.set(key, (rightKeyCounts.get(key) ?? 0) + 1);
  }

  if (leftValues.length === 0) {
    return { eligible: false, reasons: ["Left key column has no values to join on."], matchCoverage: 0 };
  }

  const duplicates = [...rightKeyCounts.values()].filter((c) => c > 1).length;
  if (duplicates > 0) {
    reasons.push(`Right key column has ${duplicates} duplicate value(s) — join would be many-to-many.`);
  }

  const matched = leftValues.filter((v) => rightKeyCounts.has(v)).length;
  const matchCoverage = matched / leftValues.length;
  if (matchCoverage < 0.9) {
    reasons.push(`Only ${Math.round(matchCoverage * 100)}% of left keys matched a right key (90% required).`);
  }

  return { eligible: duplicates === 0 && matchCoverage >= 0.9, reasons, matchCoverage };
}
