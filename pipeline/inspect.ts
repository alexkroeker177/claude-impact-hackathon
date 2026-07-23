// Generates build/inspect.html — a self-contained origin-vs-harmonized comparison viewer.
// Usage: bun pipeline/inspect.ts   then open build/inspect.html (no server needed; gitignored).
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { parseFile } from "./src/csv";
import type { FileMapping, HarmonizedRecord, ManifestEntry, OrgRegistryEntry } from "./src/types";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PIPELINE = join(ROOT, "pipeline");

const manifest = JSON.parse(readFileSync(join(PIPELINE, "schema/manifest.json"), "utf8")) as {
  datasetDir: string;
  files: ManifestEntry[];
};
const harmonizedPath = join(ROOT, "data/harmonized.json");
if (!existsSync(harmonizedPath)) {
  console.error("data/harmonized.json missing — run `bun pipeline/run.ts` first");
  process.exit(1);
}
const records = JSON.parse(readFileSync(harmonizedPath, "utf8")) as HarmonizedRecord[];
const registry = JSON.parse(readFileSync(join(ROOT, "data/orgs.json"), "utf8")) as { orgs: OrgRegistryEntry[] };

const files = manifest.files
  .filter((e) => !e.deferred)
  .map((entry) => {
    const mappingPath = join(PIPELINE, "mappings", entry.file.replace(/\.csv$/, ".json"));
    const mapping = JSON.parse(readFileSync(mappingPath, "utf8")) as FileMapping;
    const text = readFileSync(join(ROOT, manifest.datasetDir, entry.file), "utf8");
    const { header, data } = parseFile(text, entry.delimiter);
    const colMeta: ({ metric: string; type: string } | null)[] = header.map(() => null);
    for (const col of mapping.columns) {
      if (col.metric && col.type) colMeta[col.index] = { metric: col.metric, type: col.type };
    }
    return {
      file: entry.file,
      cohort: entry.cohort,
      wave: entry.wave,
      date: entry.date,
      identity: mapping.identity,
      header,
      colMeta,
      rows: data.map((d) => ({ i: d.rowIndex, cells: d.cells })),
    };
  });

const recordMap: Record<string, number> = {};
records.forEach((r, idx) => {
  recordMap[`${r.source_file}|${r.source_row}|${r.source_col_index}`] = idx;
});
const orgRowMap: Record<string, string> = {};
for (const r of records) orgRowMap[`${r.source_file}|${r.source_row}`] = r.org_id;

const payload = { generated: new Date().toISOString(), files, records, recordMap, orgRowMap, orgs: registry.orgs };
const json = JSON.stringify(payload).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>YSI Harmonizer — Origin vs Formatted</title>
<style>
  :root { --a:#22c55e; --b:#84cc16; --c:#f59e0b; --d:#ef4444; --bg:#0f172a; --panel:#1e293b; --line:#334155; --tx:#e2e8f0; --dim:#94a3b8; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--tx); font:13px/1.45 -apple-system,system-ui,sans-serif; height:100vh; display:flex; flex-direction:column; }
  header { padding:10px 16px; border-bottom:1px solid var(--line); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:15px; margin-right:6px; }
  select { background:var(--panel); color:var(--tx); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font-size:13px; max-width:340px; }
  .stat { color:var(--dim); font-size:12px; }
  .legend { display:flex; gap:10px; margin-left:auto; font-size:11px; color:var(--dim); align-items:center; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:3px; vertical-align:-1px; }
  main { flex:1; display:flex; min-height:0; }
  #grid { flex:1.6; overflow:auto; }
  table { border-collapse:collapse; font-size:12px; }
  th, td { border:1px solid var(--line); padding:4px 7px; max-width:230px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:top; }
  th { position:sticky; top:0; background:var(--panel); z-index:2; text-align:left; font-weight:600; max-height:70px; }
  th .metric { display:block; font-weight:400; font-size:10px; color:#7dd3fc; }
  th.unmapped, td.unmapped { opacity:.4; }
  td.gutter, th.gutter { background:var(--panel); color:#7dd3fc; font-size:11px; position:sticky; left:0; z-index:1; }
  td.mapped { cursor:pointer; }
  td.mapped:hover { outline:2px solid #7dd3fc; outline-offset:-2px; }
  td.gA { background:rgba(34,197,94,.14); } td.gB { background:rgba(132,204,22,.13); }
  td.gC { background:rgba(245,158,11,.15); } td.gD { background:rgba(239,68,68,.18); } td.gN { background:rgba(100,116,139,.18); }
  td.sel { outline:2px solid #fff; outline-offset:-2px; }
  #detail { flex:1; border-left:1px solid var(--line); padding:16px; overflow:auto; background:#111c31; }
  #detail h2 { font-size:13px; color:var(--dim); font-weight:600; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:12px; }
  .card .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--dim); margin-bottom:3px; }
  .raw { font-family:ui-monospace,monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; max-height:180px; overflow:auto; }
  .big { font-size:22px; font-weight:700; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:3px 14px; font-size:12px; }
  .kv .k { color:var(--dim); }
  .badge { display:inline-block; padding:2px 9px; border-radius:99px; font-weight:700; font-size:12px; color:#0f172a; }
  .bA { background:var(--a);} .bB { background:var(--b);} .bC { background:var(--c);} .bD { background:var(--d);} .bN { background:#64748b; color:#fff;}
  .arrow { text-align:center; color:var(--dim); margin:6px 0; font-size:16px; }
  .empty { color:var(--dim); padding:30px 10px; text-align:center; }
  code { color:#7dd3fc; }
</style></head><body>
<header>
  <h1>YSI Harmonizer</h1>
  <select id="fileSel"></select>
  <span class="stat" id="stats"></span>
  <span class="legend">
    <span><span class="dot" style="background:var(--a)"></span>A measured</span>
    <span><span class="dot" style="background:var(--b)"></span>B calculated</span>
    <span><span class="dot" style="background:var(--c)"></span>C estimated</span>
    <span><span class="dot" style="background:var(--d)"></span>D flagged</span>
    <span><span class="dot" style="background:#64748b"></span>N not reported</span>
    <span><span class="dot" style="background:var(--line)"></span>unmapped</span>
  </span>
</header>
<main>
  <div id="grid"></div>
  <div id="detail"><div class="empty">Click a highlighted cell to compare origin ↔ formatted.</div></div>
</main>
<script>
const DATA = ${json};
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fileSel = document.getElementById("fileSel");
DATA.files.forEach((f, i) => fileSel.add(new Option(f.file, i)));
fileSel.onchange = () => render(+fileSel.value);

function render(fi) {
  const f = DATA.files[fi];
  const fileRecords = DATA.records.filter(r => r.source_file === f.file);
  const graded = fileRecords.reduce((a, r) => (a[r.grade] = (a[r.grade]||0)+1, a), {});
  document.getElementById("stats").textContent =
    f.cohort + " · " + f.wave + " · " + f.date + " — " + f.rows.length + " rows → " + fileRecords.length +
    " records (A:" + (graded.A||0) + " B:" + (graded.B||0) + " C:" + (graded.C||0) + " D:" + (graded.D||0) + " N:" + (graded.N||0) + ")";
  let h = "<table><tr><th class=gutter>org_id</th>";
  f.header.forEach((col, ci) => {
    const m = f.colMeta[ci];
    h += "<th class='" + (m ? "" : "unmapped") + "' title='" + esc(col) + "'>" + esc(col.slice(0, 60)) +
      (m ? "<span class=metric>→ " + esc(m.metric) + "</span>" : "") + "</th>";
  });
  h += "</tr>";
  for (const row of f.rows) {
    const org = DATA.orgRowMap[f.file + "|" + row.i];
    h += "<tr><td class=gutter>" + esc(org ?? "⚠ unresolved") + "</td>";
    f.header.forEach((_, ci) => {
      const m = f.colMeta[ci];
      const ri = DATA.recordMap[f.file + "|" + row.i + "|" + ci];
      const rec = ri !== undefined ? DATA.records[ri] : null;
      const cls = [m ? "mapped" : "unmapped", rec ? "g" + rec.grade : ""].join(" ");
      const cell = row.cells[ci] ?? "";
      h += "<td class='" + cls + "' " + (rec !== null && ri !== undefined ? "data-ri=" + ri : "") + " title='" + esc(cell) + "'>" + esc(cell.slice(0, 90)) + "</td>";
    });
    h += "</tr>";
  }
  document.getElementById("grid").innerHTML = h + "</table>";
  document.querySelectorAll("td[data-ri]").forEach(td => td.onclick = () => {
    document.querySelectorAll("td.sel").forEach(x => x.classList.remove("sel"));
    td.classList.add("sel");
    showDetail(+td.dataset.ri);
  });
  document.getElementById("detail").innerHTML = "<div class=empty>Click a highlighted cell to compare origin ↔ formatted.</div>";
}

function showDetail(ri) {
  const r = DATA.records[ri];
  const org = DATA.orgs.find(o => o.org_id === r.org_id);
  const fmt = r.type === "text" ? "<div class=raw>" + esc(r.value) + "</div>"
    : "<div class=big>" + esc(r.value ?? "—") +
      (r.currency ? " <span style='font-size:13px;color:var(--dim)'>" + esc(r.currency) +
        (r.value_usd != null ? " ≈ $" + r.value_usd.toLocaleString() : "") + "</span>" : "") +
      (r.unit ? " <span style='font-size:13px;color:var(--dim)'>" + esc(r.unit) + "</span>" : "") + "</div>";
  document.getElementById("detail").innerHTML =
    "<h2>Origin → Formatted</h2>" +
    "<div class=card><div class=lbl>original cell (" + esc(r.source_file) + " · row " + r.source_row + ")</div>" +
      "<div class=raw>" + esc(r.raw_value) + "</div>" +
      "<div class=lbl style='margin-top:8px'>question</div><div style='font-size:12px'>" + esc(r.source_column) + "</div></div>" +
    "<div class=arrow>↓ harmonized</div>" +
    "<div class=card><div class=lbl>" + esc(r.metric) + " · " + esc(r.type) + "</div>" + fmt +
      "<div class=kv style='margin-top:8px'>" +
      "<span class=k>org</span><span>" + esc(org ? org.canonical_name : r.org_id) + " <code>" + esc(r.org_id) + "</code></span>" +
      "<span class=k>cohort · wave</span><span>" + esc(r.cohort) + " · " + esc(r.wave) + "</span>" +
      "<span class=k>as-of date</span><span>" + esc(r.date) + "</span></div></div>" +
    "<div class=card><div class=lbl>evidence grade</div>" +
      "<span class='badge b" + r.grade + "'>" + r.grade + "</span> " +
      "<span style='font-size:12px'>" + esc(r.grade_reason ?? ({A:"measured",B:"calculated / self-reported",C:"estimated",D:"doubtful",N:"not reported"})[r.grade]) + "</span></div>";
}
render(0);
</script></body></html>`;

writeFileSync(join(ROOT, "build/inspect.html"), html);
console.log(`build/inspect.html — ${files.length} files, ${records.length} records`);
