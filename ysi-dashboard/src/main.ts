import Chart from "chart.js/auto";
import "./styles.css";

type Level = "inform" | "engage" | "outcomes" | "impact" | "societal";
type Profile = { file: string; cohort: string; wave: string; language: string; delimiter: string; rows: number; columns: number; sparsity: number; parseErrors: number };
type FunnelRecord = { id: string; organisation: string; file: string; cohort: string; wave: string; values: Record<Level, number | null>; violation: boolean };
type JoinCandidate = { organisation: string; confidence: string; score: number; files: string[]; cohorts: string[]; waves: string[] };
type DashboardData = { generatedAt: string; hero: Record<string, number | string>; profiles: Profile[]; funnelRecords: FunnelRecord[]; joinCandidates: JoinCandidate[]; methodology: Record<string, string> };

const levels: Level[] = ["inform", "engage", "outcomes", "impact", "societal"];
const levelLabels = ["Informed", "Engaged", "Outcomes", "Deep impact", "Societal"];
const colors = ["#17b890", "#2f86eb", "#7467ee", "#e26292", "#f4a340"];
const format = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en");

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `<main class="loading">Reading the dataset…</main>`;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
const shortFile = (name: string) => name.replace(/\.csv$/i, "").replaceAll("_", " ");

async function start() {
  const response = await fetch("/data/dashboard.json");
  if (!response.ok) throw new Error(`Could not load dashboard data (${response.status})`);
  const data = await response.json() as DashboardData;
  renderShell(data);
  renderCoverage(data.profiles);
  renderProfileChart(data.profiles);
  wireFunnel(data);
  renderJoinTable(data.joinCandidates);
}

function renderShell(data: DashboardData) {
  const heroCards = [
    [data.hero.files, "source files", "Three delimiter traps"],
    [data.hero.responses, "survey responses", "Small-n, wide schema"],
    [data.hero.cohorts, "programme cohorts", String(data.hero.years)],
    [data.hero.funnelRecords, "funnel records", `${data.hero.joinCandidates} join candidates`],
  ];
  app.innerHTML = `
    <header class="masthead">
      <div class="brand"><span class="brand-mark">Y</span><span>YSI · IMPACT INTELLIGENCE</span></div>
      <div class="status"><span></span> Local source · ${new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
    </header>
    <main>
      <section class="hero">
        <div><div class="eyebrow">DATASET X-RAY</div><h1>Impact is in there.<br><em>The structure isn’t.</em></h1></div>
        <p>A field guide to 3.5 years of Aurelia Propel surveys—showing what the programme can measure today, and what must be harmonised first.</p>
      </section>
      <section class="hero-grid">${heroCards.map(([value, label, note]) => `<article class="metric-card"><strong>${value}</strong><span>${label}</span><small>${note}</small></article>`).join("")}</section>
      <section class="callout"><span>THE CORE PROBLEM</span><p>Every cohort tells a piece of the impact story, but inconsistent questions, formats, languages and identifiers stop the pieces from lining up.</p></section>
      <section class="section-block">
        <div class="section-heading"><div><span class="number">01</span><div><h2>Where the evidence lives</h2><p>Cohort coverage is uneven. Only AP1 reaches a true endline.</p></div></div><div class="legend"><i class="available"></i>Available <i class="missing"></i>Missing</div></div>
        <div id="coverage" class="coverage"></div>
      </section>
      <section class="split section-block">
        <div>
          <div class="section-heading compact"><div><span class="number">02</span><div><h2>The shape of the mess</h2><p>Each bubble is one source file.</p></div></div></div>
          <div class="panel chart-panel"><canvas id="profile-chart"></canvas></div>
        </div>
        <aside class="findings">
          <span class="eyebrow">WHY THIS MATTERS</span>
          <div><strong>142</strong><p>columns in the widest file—but just six responses. Manual comparison breaks quickly.</p></div>
          <div><strong>2</strong><p>languages across drifting question sets. Equivalent concepts rarely share headers.</p></div>
          <div><strong>0</strong><p>shared IDs across all waves. Organisation matching becomes analytical work.</p></div>
        </aside>
      </section>
      <section class="section-block funnel-section">
        <div class="section-heading"><div><span class="number">03</span><div><h2>The impact signal</h2><p>Median people reported at each level. Missing values stay missing—not zero.</p></div></div>
          <div class="filters"><label>Cohort<select id="cohort-filter"></select></label><label>Source<select id="file-filter"></select></label></div>
        </div>
        <div class="funnel-layout">
          <div class="panel funnel-card"><div id="funnel" class="funnel"></div></div>
          <div class="panel signal-card"><div><span class="eyebrow">READ THIS CAREFULLY</span><strong id="funnel-count">—</strong><p>records with at least one funnel value</p></div><div><strong id="violation-count">—</strong><p>records break the expected top-to-bottom sequence</p></div><div class="micro-note">Large values are not automatically wrong. They may reflect indirect reach, different time windows, or number-format ambiguity.</div></div>
        </div>
      </section>
      <section class="section-block">
        <div class="section-heading"><div><span class="number">04</span><div><h2>Can we follow organisations over time?</h2><p>Candidate links from organisation-name normalisation. These are leads, not confirmed joins.</p></div></div><span class="pill">Human review required</span></div>
        <div class="panel table-wrap"><table><thead><tr><th>Candidate organisation</th><th>Confidence</th><th>Files linked</th><th>Wave coverage</th></tr></thead><tbody id="join-table"></tbody></table></div>
      </section>
      <section class="recommendation"><span class="eyebrow">THE OPPORTUNITY</span><h2>Build the harmonisation layer first.</h2><p>A transparent pipeline that resolves organisations, maps survey questions and validates the impact funnel unlocks every downstream dashboard and report.</p><div class="steps"><span><b>1</b> Parse</span><i></i><span><b>2</b> Resolve</span><i></i><span><b>3</b> Map</span><i></i><span><b>4</b> Validate</span></div></section>
      <footer><span>YSI Dataset X-Ray · Hackathon exploration</span><button id="method-button">Methodology + caveats</button></footer>
    </main>
    <dialog id="method-dialog"><button class="close" aria-label="Close">×</button><span class="eyebrow">METHODOLOGY</span><h2>What this dashboard does</h2>${Object.values(data.methodology).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>("#method-dialog")!;
  document.querySelector("#method-button")!.addEventListener("click", () => dialog.showModal());
  dialog.querySelector(".close")!.addEventListener("click", () => dialog.close());
}

function renderCoverage(profiles: Profile[]) {
  const cohorts = ["AP1", "AP2", "AP3", "AP4"];
  const waves = ["Baseline", "Follow-up", "Midline", "Endline"];
  const element = document.querySelector("#coverage")!;
  element.innerHTML = `<div></div>${waves.map((wave) => `<b>${wave}</b>`).join("")}${cohorts.map((cohort) => {
    return `<strong>${cohort}</strong>${waves.map((wave) => {
      const found = profiles.filter((profile) => profile.cohort === cohort && profile.wave === wave);
      return `<div class="coverage-cell ${found.length ? "has-data" : "no-data"}" title="${found.map((profile) => profile.file).join("\n") || "No source file"}">${found.length ? `<span>${found.length}</span><small>${found.reduce((sum, item) => sum + item.rows, 0)} rows</small>` : `<span>—</span>`}</div>`;
    }).join("")}`;
  }).join("")}`;
}

function renderProfileChart(profiles: Profile[]) {
  const context = document.querySelector<HTMLCanvasElement>("#profile-chart")!;
  new Chart(context, {
    type: "bubble",
    data: { datasets: [{ data: profiles.map((profile) => ({ x: profile.columns, y: Math.round(profile.sparsity * 100), r: Math.max(5, Math.sqrt(profile.rows) * 3), profile })), backgroundColor: profiles.map((profile) => profile.language.includes("Portuguese") ? "#f4a340aa" : "#2f86eb99"), borderColor: profiles.map((profile) => profile.language.includes("Portuguese") ? "#f4a340" : "#2f86eb"), borderWidth: 1 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => { const profile = (item.raw as { profile: Profile }).profile; return [`${shortFile(profile.file)}`, `${profile.rows} rows × ${profile.columns} columns`, `${Math.round(profile.sparsity * 100)}% empty cells · ${profile.language}`]; } } } }, scales: { x: { title: { display: true, text: "Columns → schema width" }, grid: { color: "#e6e9ed" } }, y: { title: { display: true, text: "Empty cells (%)" }, min: 0, max: 100, grid: { color: "#e6e9ed" } } } }
  });
}

function wireFunnel(data: DashboardData) {
  const cohortSelect = document.querySelector<HTMLSelectElement>("#cohort-filter")!;
  const fileSelect = document.querySelector<HTMLSelectElement>("#file-filter")!;
  const cohorts = [...new Set(data.funnelRecords.map((record) => record.cohort))];
  cohortSelect.innerHTML = `<option value="all">All cohorts</option>${cohorts.map((cohort) => `<option>${escapeHtml(cohort)}</option>`).join("")}`;
  const updateFiles = () => {
    const relevant = data.funnelRecords.filter((record) => cohortSelect.value === "all" || record.cohort === cohortSelect.value);
    const files = [...new Set(relevant.map((record) => record.file))];
    fileSelect.innerHTML = `<option value="all">All sources</option>${files.map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(shortFile(file))}</option>`).join("")}`;
  };
  const update = () => {
    const records = data.funnelRecords.filter((record) => (cohortSelect.value === "all" || record.cohort === cohortSelect.value) && (fileSelect.value === "all" || record.file === fileSelect.value));
    renderFunnel(records);
  };
  cohortSelect.addEventListener("change", () => { updateFiles(); update(); });
  fileSelect.addEventListener("change", update);
  updateFiles(); update();
}

function renderFunnel(records: FunnelRecord[]) {
  const stats = levels.map((level) => {
    const values = records.map((record) => record.values[level]).filter((value): value is number => value !== null);
    return { value: median(values), n: values.length };
  });
  const max = Math.max(...stats.map((item) => item.value ?? 0), 1);
  document.querySelector("#funnel")!.innerHTML = stats.map((item, index) => {
    const width = item.value === null ? 28 : 42 + (item.value / max) * 52;
    const previous = index ? stats[index - 1].value : null;
    const conversion = previous && item.value !== null ? `${Math.round(item.value / previous * 100)}% from prior` : index === 0 ? "top of funnel" : "not comparable";
    return `<div class="funnel-row"><div class="funnel-bar" style="width:${width}%;background:${colors[index]}"><span>${levelLabels[index]}</span><strong>${item.value === null ? "—" : format.format(item.value)}</strong></div><div class="funnel-meta"><span>n=${item.n}</span><small>${conversion}</small></div></div>`;
  }).join("");
  document.querySelector("#funnel-count")!.textContent = exact.format(records.length);
  document.querySelector("#violation-count")!.textContent = exact.format(records.filter((record) => record.violation).length);
}

function renderJoinTable(candidates: JoinCandidate[]) {
  document.querySelector("#join-table")!.innerHTML = candidates.slice(0, 12).map((candidate) => `<tr><td><strong>${escapeHtml(candidate.organisation)}</strong><small>${escapeHtml(candidate.cohorts.join(" · "))}</small></td><td><span class="confidence ${candidate.score < 1 ? "fuzzy" : ""}">${candidate.score < 1 ? `${Math.round(candidate.score * 100)}% fuzzy` : "Exact normalized"}</span></td><td><b>${candidate.files.length}</b><small>${escapeHtml(candidate.files.slice(0, 2).map(shortFile).join("; "))}${candidate.files.length > 2 ? ` +${candidate.files.length - 2}` : ""}</small></td><td>${escapeHtml(candidate.waves.join(" → "))}</td></tr>`).join("") || `<tr><td colspan="4">No cross-file candidates found with the current conservative rules.</td></tr>`;
}

start().catch((error: unknown) => {
  app.innerHTML = `<main class="error"><strong>Dashboard could not start.</strong><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></main>`;
});
