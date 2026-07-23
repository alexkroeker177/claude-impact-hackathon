# Zollhof Dataset — Integration & Recognition Data Pack

> Team orientation doc for the **Claude Impact Lab Hackathon · ZOLLHOF Nuremberg · 23 July 2026**.
> Source pack: `Zollhof Dataset/zollhof-recognition-data-pack/`. All files downloaded and checked on 19 July 2026.
> Everything bundled here is openly licensed and cleared for redistribution (per-source attribution below); a separate set of live APIs is call-only and must not be redistributed.

---

## 1. Overview — what this is about

This pack is the open data behind one specific problem: **migrants in Germany face a slow, opaque system for getting their foreign professional qualifications recognised** ("Anerkennung"). A nurse trained in Syria, an engineer trained in Ukraine, or a teacher trained in Poland cannot simply start working in their field in Germany — for many professions the law requires a formal determination that the foreign qualification is *equivalent* to the German one. The process is bureaucratic, fragmented across hundreds of authorities, poorly signposted, and often only available in German.

The human cost shows up in one statistic (Eurostat, in this pack): **foreign nationals in Germany are over-qualified for their jobs at ~37%, versus ~17% for German nationals — and the gap is widening.** People who could be nurses drive taxis; people who could be engineers stack shelves. Recognition is the bottleneck this track exists to attack.

The data pack assembles, in one place, the pieces you need to reason about that pipeline end to end:

- **Who applies and how it turns out** — official German recognition outcomes 2016–2024 (Destatis) and EU decision records (RegProf).
- **A multilingual matching layer** — the ESCO occupation taxonomy in 28 languages, so a job title in Arabic or Polish can be resolved to a German occupation and an international ISCO code.
- **The wiring** — a crosswalk that joins the German occupation code system (KldB 2010) to the international one (ISCO-08), which is the join key across every other file.
- **Is the qualification even in demand** — Bundesagentur für Arbeit shortage-occupation analysis and Eurostat over-qualification / job-barrier rates.
- **Real, human-written multilingual guidance** — Integreat, the municipal integration app for Nuremberg and Munich, including pages literally titled "Anerkennung ausländischer Bildungsabschlüsse", in up to 24 languages.
- **Local grounding** — Nuremberg population and migration-background data by district.

The Nuremberg focus is deliberate: the hackathon is in Nuremberg, and the pack lets a demo be grounded in the city it's built in.

---

## 2. Provenance — what the README says

The top-level `README.md` frames the challenge and documents every source, its licence, its quirks, and its traps. Key provenance points, quoted/summarised:

- **Purpose:** "This pack gives you the open data behind that problem so you can spend the afternoon building, not hunting for CSVs."
- **Licensing:** "Everything in this pack is openly licensed and cleared for redistribution. Every file was downloaded and checked on 19 July 2026." Attribution is required per source (see §7).
- **A crucial language gap, flagged up front:** ESCO's 28 locales **do not include Ukrainian or Turkish** — two of the most relevant languages for migration to Germany. The documented workaround is Integreat (Ukrainian for Nuremberg + Munich, Turkish for Munich) or translating the query to German/English first. The README says: "Decide this early; it shapes your whole pipeline."
- **Honest data caveats** are called out repeatedly (rounding, no Bundesland breakdown, no processing-time data, EU-only scope of RegProf, machine-translation errors in Integreat). These are summarised in §8.
- **A "call live, do not redistribute" section** lists the richest sources that are *not* openly licensed — **anabin (KMK)**, **Anerkennung in Deutschland (BIBB)**, **BAMF-NAvI**, and **Handbook Germany** (the last is off-limits entirely: CC BY-NC-ND, and its robots.txt disallows `anthropic-ai`, `GPTBot`, `CCBot`). See §9.
- **A "dead ends" section** documents what is *not* obtainable in an afternoon (profession→authority mapping, BQ-Portal, GENESIS API, OECD, IAB microdata, Bavarian state open data, Wikidata), so the team doesn't waste time rediscovering them.

Every subfolder's content is described in the README; there are no separate per-subfolder README.md files — the top-level README is the single source of provenance, and Integreat ships machine-readable `_disclaimer_de.json` files per region carrying the actual licence text.

---

## 3. File inventory by subfolder

Root: `Zollhof Dataset/zollhof-recognition-data-pack/`

### `esco/` — multilingual occupation taxonomy

| File | Format | Size | Description |
|---|---|---|---|
| `esco-occupations-multilingual.json` | JSON (array) | ~19.6 MB | **2,909 occupations**, each with `uri`, `iscoGroup` (ISCO-08, on 100%), `preferredLabel` (28 locales), `alternativeLabel` (synonyms per language), `description` (EN+DE only). The core label-matching layer. |

### `crosswalks/` — occupation-code join key

| File | Format | Size | Description |
|---|---|---|---|
| `kldb2010-isco08-crosswalk.xlsx` | XLSX | ~18 KB | Maps **KldB 2010 (Fassung 2020) 5-digit** codes → **ISCO-08 4-digit** unit groups. Sheet `Umsteiger KldB üF 2020 auf ISCO` (~1,525 mapping rows) + `Impressum`. Columns: KldB code, KldB label (DE), classification title (EN), ISCO-08 code, ISCO label (DE), unit group (EN), `Umstieg eindeutig (1)/nicht eindeutig (0)`, priority/alternatives count. |

### `destatis-anerkennung/` — official German recognition outcomes (statistic 21231, §17 BQFG, 2016–2024)

| File | Format | Size/Rows | Description |
|---|---|---|---|
| `destatis-21231-2024.xlsx` | XLSX | ~3.6 MB, **91 sheets** | Original workbook (`21231-01` … `21231-41` + `b01` + metadata sheets). Use the CSVs instead. |
| `csv/_manifest.csv` | CSV | 42 rows | Row/column/byte counts for every flattened table. |
| `csv/csv-21231-01.csv` | CSV | 135 rows, 12 col | Headline series 2016–2024 by legal basis, regulation status, sex. Measures: `Gesamt`, `Beschieden`, `Positiv_Beschieden`, `Volle_Gleichwertigkeit`, `Negativ_Beschieden`. |
| `csv/csv-21231-02.csv` | CSV | 7,982 rows, 11 col | Largest table — occupation (`Berufshauptgruppe`/`Berufsgattung`/`Referenzberuf`) × sex × `Entscheidung`. |
| `csv/csv-21231-07.csv` | CSV | 3,694 rows, 10 col | Occupation × **country where trained** (`Ausbildungsstaat`). |
| `csv/csv-21231-08.csv` | CSV | 4,015 rows, 10 col | Occupation × **nationality** (`Staatsangehoerigkeit`). |
| `csv/csv-21231-10.csv` | CSV | 102 rows, 7 col | **Top 100 countries of training**, ranked, with count + percent. |
| `csv/csv-21231-b01.csv` | CSV | 9 rows, 9 col | Compact headline totals by year. |
| `csv/csv-21231-03.csv … -41.csv` | CSV | 102–3,788 rows | 42 tables total — variants slicing outcomes by occupation × country/nationality × sex × decision-type × regulation status across report years. `_manifest.csv` is the index. |

### `eu-regulated-professions/` — EU recognition decisions (Directive 2005/36/EC, Germany as host)

| File | Format | Size/Rows | Description |
|---|---|---|---|
| `regprof-decisions-germany.csv` / `.json` | CSV + JSON | **10,977 records** (~123,525 decisions, 1997–2023) | Decision records: origin country, profession, year range, establishment (yes/no), type of decision, Pos/Neg/Neutral, total count, recognition regime, qualification level, **`Isco code 1` + `Isco label 1`**. 31 origin countries, 79 professions. |
| `regprof-german-professions.json` | JSON `{count, search, list}` | 175 entries | The 175 professions **regulated in Germany**: `name`, `directive`, `qualification`, `qualification_level`, `id`. |
| `regprof-professions.json` | JSON (array) | 560 entries | EU-wide profession reference: `Generic profession`, `Number of regulated professions`, per-country breakdown. |

### `integreat/` — multilingual migrant guidance (municipal integration app)

| File | Format | Description |
|---|---|---|
| `_summary.json` | JSON | Per-region language list + page counts + POI counts (see below). |
| `nuernberg/pages_<lang>.json` | JSON (array) | 8 languages: `de en fr ar fa ru uk am`. Each page: `id, url, path, title, excerpt, content` (full HTML), `parent, order, available_languages, organization, embedded_offers`. `de`=171 pages. |
| `nuernberg/locations_de.json` | JSON (array) | **64 POIs** — advice centres etc.: `title, path, content, website, email, phone_number, contacts, category, opening_hours, location` (address/lat/lon), `barrier_free`. |
| `nuernberg/_languages.json`, `_disclaimer_de.json` | JSON | Language registry + CC BY 4.0 licence text. |
| `muenchen/pages_<lang>.json` | JSON (array) | **24 languages** incl. `tr pl ro so sw ckb kmr vi zh sq el hr bg`; `de`=640 pages. Files are ~8–10 MB each. |
| `muenchen/locations_de.json` | JSON | **518 POIs.** |
| `muenchen/_languages.json`, `_disclaimer_de.json` | JSON | As above. |

### `labour-market/` — demand, shortage, over-qualification

| File | Format | Size | Description |
|---|---|---|---|
| `ba/2025_Länderergebnisse.xlsx` | XLSX | ~2.7 MB | BA shortage occupations by region — **12 regions (small Länder paired: SH/HH, NI/HB, RP/SL, BB/BE)**. Sheets: `Gesamtübersicht`, `Fachkräfte`, `Spezialisten`, `Experten`, `Meth. Hinweise`. |
| `ba/2025_Deutschland_Engpass.xlsx` | XLSX | ~1.2 MB | National shortage analysis. Sheets: `Fachkräfte`, `Spezialisten`, `Experten`. |
| `ba/2025_Deutschland_Risiko_Ergänzung.xlsx` | XLSX | ~1.2 MB | Risk-indicator supplement; sheet `Grenzwerte_Indikatoren` + skill-level sheets. |
| `ba/2025_BA-FK-Engpassanalyse.pdf` | PDF | ~1.0 MB | Methodology of the shortage analysis. |
| `eurostat-overqualification-de.json` | JSON-stat | ~8 KB | Over-qualification rates by citizenship, **1995–2025** (31 years). Dims: `citizen`(7) × `age`(7) × `sex`(3) × `time`(31); Germany only; 3,162 values. **The hero-chart file.** |
| `eurostat-job-barriers-de.json` | JSON-stat | ~3 KB | Barriers to a suitable job, 2014. Dims: `wstatus`(3) × `citizen`(8) × `barrier`(8) × `mgstatus`(3); includes `LREC_QLF` = "Lack of recognition of qualifications". 186 values. |

### `nuernberg/` — local population data

| File | Format | Rows | Description |
|---|---|---|---|
| `nuernberg-bevoelkerung-2024.csv` | CSV (`;`-delimited) | 79 districts + header | 79 statistical districts × 28 columns: total/male/female, age bands, area, and migration columns — `Einw. deutsch mit Migrationshintergrund`, `Einwohner ausländisch`, `Einwohner mit Migr.Hintergrund insg.`, nationality groups (Deutschland / EU / Europa nicht-EU / Übrige Welt). |

---

## 4. Data sources explained (plain language)

- **Anerkennung** — German for "recognition." The legal process of having a foreign professional or educational qualification formally assessed for equivalence to the German counterpart. For **regulated professions** (doctor, nurse, teacher, lawyer, many trades) recognition is *mandatory* to practise; for non-regulated professions it's optional but helps employers trust the qualification. Governed federally by the **BQFG (Berufsqualifikationsfeststellungsgesetz)**; the official statistic is collected under **§17 BQFG**.

- **ESCO** — *European Skills, Competences, Qualifications and Occupations.* The EU's multilingual occupation-and-skills taxonomy. Here it's the **matching layer**: 2,909 occupations, each labelled in 28 languages with synonyms, each carrying an ISCO-08 code. It turns "what someone calls their job in their language" into a canonical occupation + international code. (Gap: no Ukrainian, no Turkish.)

- **ISCO-08** — *International Standard Classification of Occupations* (ILO, 2008 revision). The global 4-digit occupation coding scheme. It is the **interoperability spine** of this pack: ESCO carries it, the EU decisions data carry it, and the crosswalk maps the German code system onto it.

- **KldB 2010** — *Klassifikation der Berufe 2010* (Fassung/version 2020), the **German** national occupation classification maintained by the Bundesagentur für Arbeit. 5-digit codes. German labour-market and recognition data are organised by KldB, so you need the crosswalk to connect them to ISCO/ESCO.

- **Destatis 21231** — the official German recognition statistic (**Statistisches Bundesamt**, statistic code **21231**, the §17 BQFG survey), 2016–2024. Tells you, at Germany level, **how many applications there were and how they turned out** — by occupation, country of training, nationality, sex, legal basis. Outcome measures: `Gesamt` (total), `Beschieden` (decided), `Positiv_Beschieden` (positive), `Volle_Gleichwertigkeit` (full equivalence), `Negativ_Beschieden` (negative). Partial equivalence = `Positiv_Beschieden − Volle_Gleichwertigkeit` (not a stored column).

- **EU Regulated Professions (RegProf)** — the European Commission's database of decisions on recognising professional qualifications under **Directive 2005/36/EC**. The German slice: 10,977 records / ~123,525 decisions, 1997–2023. **Scope limit: EU/EEA/Switzerland/UK origins only** — it does *not* cover third-country nationals (the main audience for this track). Use it for procedure comparison and pattern-spotting; use Destatis for the whole population. Top professions by volume: Doctor of Medicine (34,085), Nurse (25,365), Secondary school teacher (18,186), Physiotherapist (7,575).

- **Regulated professions** — occupations you may only practise with formally recognised qualifications (and often a licence). Germany has **175** in the RegProf list. Whether a profession is regulated determines whether recognition is legally required. BIBB exposes this only as a boolean; the authority that actually decides each case is *not* open data (see §8/§9).

- **Integreat** — the municipal integration app used by Nuremberg and Munich. **Genuine, human-written, professionally maintained** guidance content — including pages titled "Anerkennung ausländischer Bildungsabschlüsse" — parallel across many languages, plus a POI file of real advice centres with addresses, phones, emails, and opening hours. **The best RAG corpus in the pack.** (Caveat: translations are partly machine-generated — see §8.)

- **BA labour-market data** — the **Bundesagentur für Arbeit** (Federal Employment Agency) Fachkräfte-Engpassanalyse: which occupations are in shortage ("Engpassberufe"), by skill level (Fachkräfte / Spezialisten / Experten) and region. Answers "is this qualification even in demand?" — a shortage occupation is one where a recognised foreign qualification is most valuable.

- **Eurostat over-qualification & job barriers** — EU statistics. Over-qualification: share of employed people whose qualification exceeds their job's requirement, by citizenship, 1995–2025. Job barriers: obstacles to finding suitable work (2014), including `LREC_QLF` = lack of recognition of qualifications. This is where the headline inequity lives.

- **Nuremberg population** — city statistics office data: 79 statistical districts with population, age structure, and migration-background breakdowns. Grounds a demo in the local population geography.

---

## 5. Crosswalks / data model — how it all interlinks

Everything joins through **ISCO-08**. The KldB↔ISCO crosswalk is the bridge between the German world and the international/EU world:

```
                       ┌──────────────── ISCO-08 (4-digit) ────────────────┐
                       │            the interoperability spine              │
  job title in any     │                                                    │
  of 28 languages      │                                                    │
        │              │                                                    │
        ▼              ▼                          ▼                         ▼
  ESCO occupation ──iscoGroup──►  ISCO-08  ──crosswalk──►  KldB 2010 (5-digit, DE)
  (esco/…json)                       │                           │
                                     │                           │
                         EU decisions data (RegProf)   Destatis 21231 outcomes
                         Isco code 1 / Isco label 1    + BA shortage analysis
                                                        (both KldB-organised)
```

A worked path (from the README): the Arabic `ممرض متخصص` or Polish `pielęgniarz - specjalista` → matched via ESCO `preferredLabel`/`alternativeLabel` to *Fachkrankenpfleger* → ESCO `iscoGroup` `2221.3` → strip the ESCO sub-decimal to ISCO unit group `2221` → crosswalk to the KldB code → look up Destatis outcomes and BA shortage status for that occupation, and RegProf decision patterns for the ISCO code.

**Join-key mechanics and gotchas:**

- **ESCO `iscoGroup` is more precise than ISCO** — it carries a sub-decimal (e.g. `0110.1`, `2221.3`). The crosswalk and RegProf use plain 4-digit ISCO (`2221`), so truncate at the dot before joining.
- **The KldB↔ISCO mapping is many-to-many and not always clean.** The crosswalk's `Umstieg eindeutig (1)/nicht eindeutig (0)` column flags whether the mapping is unambiguous; the priority/alternatives column ranks multiple targets. Do not assume a 1:1 join.
- **Destatis and BA are organised by German occupation groups** (Berufshauptgruppe / Berufsgattung / Referenzberuf, which follow KldB), not by raw KldB 5-digit codes in the flattened CSVs — expect to match on occupation *labels/groups*, so keep the German label text.
- **RegProf carries ISCO directly** (`Isco code 1`), so it joins to ESCO/crosswalk without translation — but remember its EU-only origin scope.
- **Integreat and the Nuremberg population CSV do not carry occupation codes at all.** Integreat joins by *topic* (recognition guidance) and *geography* (Nuremberg/Munich); the population CSV joins only by district geography. Treat them as context/RAG/grounding layers, not as things you code-match to occupations.

---

## 6. Language coverage (pipeline-shaping)

| Layer | Languages | Ukrainian? | Turkish? |
|---|---|---|---|
| ESCO labels | 28 EU-official + ar, is, no (+en-us) | **No** | **No** |
| Integreat Nuremberg | de en fr ar fa ru **uk** am (8) | **Yes** | No |
| Integreat Munich | 24 incl. **uk**, **tr**, pl, ro, so, sw, ckb, kmr, vi, zh, sq | **Yes** | **Yes** |
| Destatis / RegProf / BA / crosswalk | German + English metadata | n/a | n/a |

The README's directive: decide language strategy first. For Ukrainian/Turkish input, either route through Integreat content or translate to DE/EN before ESCO matching. This is the single biggest architecture decision in the pack.

---

## 7. Licences & attribution

| Source | Licence | Attribution |
|---|---|---|
| ESCO v1.2.1 | CC BY 4.0 | "© European Union, ESCO v1.2.1" |
| EU Regulated Professions | CC BY 4.0 (Dec. 2011/833/EU) | "© European Union" |
| Destatis 21231 | dl-de/by-2-0 | "© Statistisches Bundesamt (Destatis), 2025" |
| Bundesagentur für Arbeit | Free use w/ attribution | "Quelle: Statistik der Bundesagentur für Arbeit" |
| Eurostat | Reuse authorised w/ source ack. | "© European Union" |
| Integreat (Nbg/Muc) | CC BY 4.0 (per-region — verify in `_disclaimer_de.json`) | City + Integreat (e.g. *Stadt Nürnberg, Referat für Jugend, Familie und Soziales*) |
| Nuremberg population | CC BY 4.0 | "Stadt Nürnberg, Amt für Stadtforschung und Statistik" |

Integreat's licence is set **per city** — Nuremberg, Munich, Fürth, Ingolstadt, Regensburg are CC BY 4.0; **Augsburg grants nothing** and two districts are non-commercial. If you pull another region live, check `/<region>/de/disclaimer/` first.

---

## 8. Data-quality notes (the traps)

1. **Destatis rounding.** Every cell is independently rounded to a multiple of 3 for disclosure control. **Totals do not equal the sum of their parts.** Do not build reconciliation checks; footnote your charts.
2. **No Bundesland breakdown in Destatis.** Statistic 21231 is Germany-level only. The 16 state offices publish separately in 16 formats (Bavaria: PDF only). There is no state-level cut to find.
3. **No processing-time data.** Destatis collects the dates but withholds duration ("Aufgrund der unsicheren Datenlage…"). Microdata is not released. If your idea depends on "how long does it take", re-scope to outcomes — and note the gap on a slide, it's itself a finding.
4. **RegProf is EU/EEA/CH/UK-only.** It excludes third-country nationals — the main audience for this track. Use it for procedure/pattern comparison, not as a population proxy. Destatis covers everyone.
5. **ESCO missing languages.** No Ukrainian, no Turkish (see §6). Also, 4 occupations failed to fetch (ESCO API HTTP 500), so it's 2,909 of ~2,913 — the missing 0.14% won't affect a demo.
6. **Integreat machine-translation errors — a demonstrable bug to fix.** Translations are partly machine-generated and the *titles* give it away: Arabic/Ukrainian versions of "Wie funktioniert die Anerkennung?" render *Anerkennung* in the pattern-recognition sense (`التعرف`, `розпізнавання`) while the body correctly uses the legal term (`الاعتراف`, `визнання`). A tool that catches domain-term mistranslation in migrant guidance is a real, demonstrable win.
7. **BA region pairing.** Länderergebnisse has **12 regions, not 16** (SH/HH, NI/HB, RP/SL, BB/BE paired). Plan any choropleth accordingly.
8. **ESCO↔ISCO precision mismatch and many-to-many KldB mapping** — see §5.
9. **CSV delimiters differ.** The Nuremberg population CSV is **semicolon-delimited** with German column names; the Destatis CSVs are comma-delimited. Set the delimiter per file.
10. **Missing open dataset (the big one):** the **profession → competent authority** mapping does not exist as open data. anabin's 1,109-row recognition-office list (live, non-redistributable) is the closest substitute. For Nuremberg you can hand-curate ~20 rows: IHK FOSA (commercial), HWK Mittelfranken (trades), Regierung von Mittelfranken (health), BLÄK (doctors).

---

## 9. Live-only sources (call, cache for demo, do NOT redistribute)

These are the richest sources and **none is openly licensed.** Public unauthenticated APIs; cache locally for the demo, label it a prototype, don't ship/mirror the data.

- **anabin (KMK)** — `https://anabin.kmk.org/api/public/`. The best structured data for the problem: 880 foreign occupations, ~780 with explicit `equivalences[].germanOccupation` mappings — effectively a **pre-built foreign→German matching table** — plus 32,518 institutions, 40,545 degrees, 1,109 recognition offices. Gotchas: no deep-linkable records; CORS pinned (proxy server-side); every `/db/` path returns 200 (SPA); `?land=` wants **3-letter** ISO codes; paginate `?limit=&offset=`, chunk ≤5,000.
- **Anerkennung in Deutschland (BIBB)** — `https://www.anerkennung-in-deutschland.de/api/v1/de/profession`. 1,194 German professions with multilingual `keywords`, and a `beratungsstellen` endpoint with lat/lon, hours, **languages spoken** — the only source mapping "my job + my city → the office that decides my case." Gotchas: the 11-language switcher is fake (only `de` differs); the API **leaks BIBB staff emails** in `internalComment`/`createdBy` — strip those.
- **BAMF-NAvI** — `https://bamf-navi.bamf.de/atlas-backend/beratungseinrichtungen?coord=…`. Migration advice centres (MBE/JMD), 72 around Nuremberg. Coords are **EPSG:25832 — reproject** before mapping.
- **Handbook Germany — off-limits.** CC BY-**NC-ND** (ND forbids the derivatives RAG produces), and robots.txt disallows `anthropic-ai`/`GPTBot`/`CCBot`. Use Integreat instead.

---

## 10. Hackathon opportunities (Claude-powered, impact-focused)

1. **"From your job to your German recognition path" — the multilingual pipeline.**
   User states their occupation in their language (incl. Ukrainian/Turkish via the Integreat/translate route). Claude resolves it through ESCO → ISCO → crosswalk → KldB, then returns: (a) is it a *regulated* profession (RegProf 175-list); (b) the Destatis outcome stats for that occupation (positive rate, full-equivalence rate) — set expectations honestly; (c) whether it's a **shortage occupation** (BA) — is it worth it; (d) the right advice centre (live BIBB/anabin, cached). One coherent answer to "what happens if I try to get recognised, and is it worth it." **Top pick** — it exercises the whole data model and is directly useful.

2. **Domain-term mistranslation catcher for migrant guidance.**
   Claude audits Integreat's parallel multilingual pages for legal-domain-term errors — the documented *Anerkennung* → "pattern recognition" bug across Arabic/Ukrainian/Russian/Persian. Flag title/body inconsistencies, propose corrected legal terms, output a QA report the city could act on. Small scope, concrete, demonstrable, and it fixes a real harm (migrants misled by the very tool meant to help them).

3. **Over-qualification / recognition-gap explainer with a hero chart.**
   Build the narrative from `eurostat-overqualification-de.json` (foreign 37% vs German 17%, widening gap, 1995–2025) + `LREC_QLF` job-barrier share, cross-referenced with Destatis negative/partial-equivalence rates by country of training. Claude generates a data-grounded, plain-language story ("here's who loses out, and where recognition is the bottleneck"), localised to Nuremberg districts via the population CSV. A policy/advocacy-flavoured impact demo.

4. **Recognition-outcome realism coach (RAG over Integreat + Destatis).**
   A conversational assistant grounded in Integreat's human-written guidance (CC BY, safe to RAG) that answers "how does recognition work for *my* case" in the user's language, and — crucially — attaches **real numbers** from Destatis 21231 for their occupation × country of training (e.g. "for nurses trained in your country, X% got full equivalence, Y% partial"). Combats both misinformation and false hope. Honest about the processing-time data gap.

5. **Nuremberg advice-centre finder + curated authority map.**
   Combine Integreat's 64 Nuremberg POIs (addresses, hours, languages, lat/lon) with a hand-curated ~20-row profession→authority table (IHK FOSA / HWK Mittelfranken / Regierung von Mittelfranken / BLÄK) — filling the single most valuable *missing* open dataset. Claude routes "my profession + I'm in Nuremberg" to the right office, in the user's language. Ships the exact thing the README says doesn't exist yet.
