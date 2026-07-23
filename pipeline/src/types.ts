export type ValueType = "count" | "money" | "percent" | "months" | "score" | "text";

export interface ManifestEntry {
  file: string;
  cohort: string; // "AP1".."AP4" | "mixed" (resolve per-org via registry)
  wave: string;
  date: string; // YYYY-MM
  delimiter: "," | ";";
  lang: "en" | "pt";
  deferred?: boolean;
}

export interface FileProfile {
  file: string;
  bom: boolean;
  cols: number;
  dataRows: number;
  columns: { index: number; header: string; fillRate: number; samples: string[] }[];
}

export interface ColumnMapping {
  index: number;
  metric: string | null; // canonical metric id, or null = skip
  type: ValueType | null;
  currency: string | null; // ISO code hint for money columns where the header pins it
  date_override: string | null; // YYYY-MM when the question text pins a different as-of date
  notes: string | null;
}

export interface FileMapping {
  file: string;
  identity: { org_col: number | null; person_col: number | null; email_col: number | null };
  columns: ColumnMapping[];
}

export interface OrgRegistryEntry {
  org_id: string;
  canonical_name: string;
  aliases: string[];
  people: string[];
  email_domains: string[];
  cohorts: string[];
  country: string | null;
}

export type Grade = "A" | "B" | "C" | "D";

export interface HarmonizedRecord {
  org_id: string;
  cohort: string;
  wave: string;
  date: string;
  metric: string;
  type: ValueType;
  value: number | string | null; // null = unparseable (raw preserved)
  unit: string | null;
  currency: string | null; // money only
  value_usd: number | null; // money only, demo-grade fixed rates
  raw_value: string;
  source_file: string;
  source_row: number; // 1-based data-row index (header excluded)
  source_column: string;
  grade: Grade;
  grade_reason: string | null;
}

export interface Anomaly {
  kind: "funnel_monotonicity" | "negative_value" | "outlier" | "parse_failure" | "duplicate_conflict";
  org_id: string;
  date: string;
  detail: string;
  metrics: string[];
  source_file: string;
}
