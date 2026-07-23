# Claude Impact Lab Hackathon — Nuremberg, 2026-07-23

> One day. Impact shipped. This repo is a hackathon project built at ZOLLHOF (Zollhof 7, 90443 Nürnberg) during the Claude Impact Lab Hackathon. **The whole point is a working demo by 20:00** — not slides, not polish. Build, don't slide.

This CLAUDE.md is the project's north star: it fixes the **scope** we're building against and the **grading criteria** every decision should serve. When in doubt, optimize for the four judging criteria below.

---

## The one hard constraint: time

- **Doors 13:30 · Building 14:30–20:00 (with a dinner break 18:00–18:30) · Pitches 20:00 · Winners by 21:30.**
- **~5 working hours, one team (≤4 people).** Everything below is scoped to that budget.
- **A working demo beats everything.** Judges want to see it run. Slides are garnish. If a feature can't be demoed live by 20:00, it's out of scope for today.
- Team must stay the full day (13:30–21:30) to pitch. No early leave.

---

## Selected Challenge track



###  Yunus Social Innovation — AI-Powered Impact Intelligence
Social enterprises collect impact data constantly, but it scatters across inconsistent surveys and spreadsheets.
**Brief:** Turn messy, real-world impact data into something **clear and useful**, so organisations can see whether their programmes actually work.
**Data:** the anonymised Aurelia Propel IMM dataset → [`docs/YSI-Dataset.md`](docs/YSI-Dataset.md). Cohort (AP1–AP4) × wave (Baseline→Midline→Endline); the core hard problem is joining beneficiary records across waves; 5-level impact funnel is the headline metric.

every hour serves the demo for that track.


The challenge (based on their presentation):

- Everyone wants to help: Every year, governments, foundations and companies, spend Billions on programmes meant to improve lifes. To check whether this money is well spent, organisations collect huge amounts of data: surveys, reports, spreadsheets, interviews

- The result: But there's a problem: the data exists, but it's a mess. There is no common understanding of what social impact means and how it should be measured. And even within a single organisation it is often spread across files, formats, people and time.

- The problem: This makes it almost impossible to understand which programmes work best, what problems or patterns surface across different initiatives, and which projects are showing early warning signs, or just early signs of success. 

---

## Judging — how we're scored

**Four criteria, weighted equally.** The panel scores every pitch against all four. Judges: Claude Ambassadors, Yunus Social Innovation, ZOLLHOF, possibly Anthropic. **No audience vote.**

| # | Criterion | The question judges ask | What this means for our build |
|---|-----------|-------------------------|-------------------------------|
| 1 | **Innovativeness** | Is the approach genuinely new, or a familiar idea with AI bolted on? | Don't just wrap a chatbot around a FAQ. Use the data model / a non-obvious angle. Show something the judges haven't seen five times today. |
| 2 | **Feasibility** | Could this actually be built and run beyond today? | Realistic scope, honest about data limits (e.g. anabin/BIBB are live-API only, can't ship). A demo that runs on real data > a mockup. Note the path to production. |
| 3 | **Impact & business value** | Who does it help, how much, and can it sustain itself? | Name the beneficiary concretely (an immigrant navigating Anerkennung; an NGO program manager). Quantify with the data's hero stats (e.g. foreign over-qualification 37% vs 17%). Have a sustainability answer. |
| 4 | **Pitch quality** | Is the problem clear, the demo convincing, the ask specific? | Problem stated in one sentence. **Live working demo.** A specific ask at the end. Rehearse the 8–10 min. |

**Optimization rule:** since the four are equal-weight, a project strong on three and absent on one loses to a balanced one. Don't over-invest in a slick demo (crit 4) while neglecting the "why is this new" story (crit 1) or the "who does it help" case (crit 3). Budget effort across all four.

---

## Working scope for today

**In scope:** one track, one working end-to-end demo on real (provided) data, a tight pitch that hits all four criteria.

**Out of scope for today** (name these as "next steps" in the pitch, don't build them):
- Production auth, accounts, deployment hardening.
- Redistributing or shipping any track dataset — **house rule: track datasets are for today only, do not redistribute.**
- Live integrations with non-redistributable sources (anabin, BIBB, BAMF-NAvI) — cache a slice for the demo, cite it as a real integration path.
- Breadth over depth: better to nail one track module end-to-end than to half-build three.

## Perks / constraints to remember
- **$100 Anthropic API credit per attendee** — budget it; default to the strongest current Claude model (Opus 4.8 / Sonnet 5) for the demo, cheaper tiers for bulk/preprocessing.
- English & German both fine.

## Repo conventions (this project)
- Datasets live in `YSI Dataset/` and `Zollhof Dataset/` (spaces in names — quote paths). **Read-only, do-not-redistribute.**
- Dataset analyses live in `docs/`. Read them before building.
- Working code goes at the repo root / a clearly named app folder; keep the datasets untouched.
- Global LifeOS tool prefs still apply (bun/bunx not npm; TypeScript by default).

---

*Built during the Claude Impact Lab Hackathon, ZOLLHOF Nuremberg. Ship the demo.*
