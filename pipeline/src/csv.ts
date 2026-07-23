// Quote-aware CSV parser — handles multi-line quoted fields, escaped quotes, BOM, CRLF.
// No deps: the dataset's quirks (3 semicolon files, newlines inside answers) need exactly this much.

export function parseCsv(text: string, delimiter: string): { rows: string[][]; bom: boolean } {
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return { rows, bom };
}

/** Header + non-empty data rows, each tagged with its 1-based data-row index (blank rows keep numbering stable). */
export function parseFile(text: string, delimiter: string) {
  const { rows, bom } = parseCsv(text, delimiter);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const data: { rowIndex: number; cells: string[] }[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].some((c) => c.trim() !== "")) data.push({ rowIndex: i, cells: rows[i] });
  }
  return { header, data, bom };
}
