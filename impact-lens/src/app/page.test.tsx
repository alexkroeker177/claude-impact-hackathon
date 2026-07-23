import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect }));

import Home from "./page";

describe("ImpactLens home", () => {
  beforeEach(() => redirect.mockClear());

  it("opens the persisted project workspace", () => {
    Home();
    expect(redirect).toHaveBeenCalledWith("/projects");
  });
});
