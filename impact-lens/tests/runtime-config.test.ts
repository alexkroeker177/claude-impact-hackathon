import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

describe("Next runtime configuration", () => {
  it("keeps Turbopack module resolution inside the ImpactLens app", () => {
    expect(nextConfig.turbopack?.root).toBe(resolve(process.cwd()));
  });
});
