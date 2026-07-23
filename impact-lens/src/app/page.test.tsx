import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("ImpactLens home", () => {
  it("introduces the product and offers project creation", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /impactlens/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /create project/i }),
    ).toHaveAttribute("href", "/projects/new");
  });
});
