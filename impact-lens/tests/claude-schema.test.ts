import { describe, expect, it } from "vitest";
import * as z from "zod";

import { claudeJsonSchema } from "@/lib/claude/run";

describe("Claude structured-output schema", () => {
  it("omits the unsupported JSON meta-schema reference", () => {
    const schema = claudeJsonSchema(z.object({ ok: z.boolean() }).strict()) as Record<string, unknown>;

    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe("object");
  });
});
