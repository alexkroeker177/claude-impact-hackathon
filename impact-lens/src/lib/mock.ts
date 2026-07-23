import fs from "node:fs";
import path from "node:path";

import type { SemanticPlan } from "@/lib/semantic/schema";
import type { DashboardAnalysis } from "@/lib/analysis/types";

/**
 * Demo mock mode: replays a captured, real Opus 4.8 analysis of the demo CSV
 * (AP1and2_April_25) instantly instead of calling Claude live. Enabled by
 * starting the app with IMPACTLENS_MOCK=1 (`bun run dev:mock`) or a --mock arg.
 * Fixtures: fixtures/mock-plan.json + fixtures/mock-dashboard.json.
 */
export function isMockMode(): boolean {
  return process.env.IMPACTLENS_MOCK === "1" || process.argv.includes("--mock");
}

function readFixture<T>(name: string): T {
  const file = path.join(process.cwd(), "fixtures", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function loadMockPlan(): SemanticPlan {
  return readFixture<SemanticPlan>("mock-plan.json");
}

export function loadMockDashboard(): DashboardAnalysis {
  return { ...readFixture<DashboardAnalysis>("mock-dashboard.json"), generatedAt: new Date().toISOString() };
}

/** Short pause so the mocked steps still read as "working" on stage. */
export function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
