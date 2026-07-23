import { describe, expect, it } from "vitest";
import { isMockMode, loadMockDashboard, loadMockPlan } from "@/lib/mock";
import { semanticPlanSchema } from "@/lib/semantic/schema";

describe("mock mode", () => {
  it("is off unless IMPACTLENS_MOCK=1 or --mock is passed", () => {
    expect(isMockMode()).toBe(false);
    process.env.IMPACTLENS_MOCK = "1";
    expect(isMockMode()).toBe(true);
    delete process.env.IMPACTLENS_MOCK;
  });

  it("loads a fixture plan that passes the real SemanticPlan schema", () => {
    const plan = semanticPlanSchema.parse(loadMockPlan());
    expect(plan.proposedMetrics.length).toBeGreaterThanOrEqual(3);
    expect(plan.orderedFunnel).not.toBeNull();
  });

  it("loads a fixture dashboard with metrics, funnel chart and Claude-written insights", () => {
    const dashboard = loadMockDashboard();
    expect(dashboard.metrics.length).toBeGreaterThanOrEqual(3);
    expect(dashboard.chart?.type).toBe("funnel");
    expect(dashboard.insights?.length).toBeGreaterThanOrEqual(3);
    expect(dashboard.assessment.length).toBeGreaterThan(50);
    // generatedAt is re-stamped on load, not the capture time.
    expect(Date.now() - new Date(dashboard.generatedAt).getTime()).toBeLessThan(10_000);
  });
});
