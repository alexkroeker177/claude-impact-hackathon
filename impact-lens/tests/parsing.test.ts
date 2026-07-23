import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { parseTabularFile } from "@/lib/files/parse";
import { profileTable } from "@/lib/files/profile";

describe("parseTabularFile", () => {
  test("1. parses BOM-prefixed semicolon CSV, keeps empty cells and row numbers", () => {
    const csv = "﻿id;wave;beneficiaries\nA;Baseline;100\nB;Baseline;\n";
    const tables = parseTabularFile({
      name: "survey.csv",
      bytes: new TextEncoder().encode(csv),
    });

    expect(tables).toHaveLength(1);
    const table = tables[0];
    expect(table.fields.map((f) => f.header)).toEqual(["id", "wave", "beneficiaries"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].rowNumber).toBe(2);

    const beneficiaries = table.fields.find((f) => f.header === "beneficiaries");
    expect(beneficiaries).toBeDefined();
    expect(table.rows[1].values[beneficiaries!.id]).toBe("");

    const profile = profileTable(table);
    const beneficiariesProfile = profile.fields.find((f) => f.header === "beneficiaries");
    expect(beneficiariesProfile).toBeDefined();
    expect(beneficiariesProfile!.nullRate).toBe(0.5);
    expect(["integer", "number"]).toContain(beneficiariesProfile!.inferredType);
  });

  test("2. parses a two-sheet XLSX workbook into two tables with distinct sourceIds", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["id", "score"],
        ["A", 1],
        ["B", 2],
      ]),
      "Baseline",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["id", "score"],
        ["A", 3],
      ]),
      "Endline Wave",
    );
    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const tables = parseTabularFile({
      name: "waves.xlsx",
      bytes: new Uint8Array(out),
    });

    expect(tables).toHaveLength(2);
    expect(tables[0].sheetName).toBe("Baseline");
    expect(tables[1].sheetName).toBe("Endline Wave");
    const ids = tables.map((t) => t.sourceId);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("waves-xlsx#baseline");
    expect(ids[1]).toBe("waves-xlsx#endline-wave");
  });
});
