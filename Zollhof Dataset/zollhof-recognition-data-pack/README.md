# ZOLLHOF Track — Integration & Recognition Data Pack

**Claude Impact Lab Hackathon · ZOLLHOF Nuremberg · Thursday 23 July 2026**

The challenge: migrants in Germany face a slow, opaque system for getting foreign
professional qualifications recognised. This pack gives you the open data behind
that problem so you can spend the afternoon building, not hunting for CSVs.

Everything in this pack is **openly licensed and cleared for redistribution**.
Every file was downloaded and checked on 19 July 2026. Attribution requirements
are listed per source below — please honour them in your demo.

There is also a short list at the end of **APIs you may call live but must not
redistribute**. Read that section before you cache anything.

---

## What's in here

```
esco/                     Occupation taxonomy, 2,909 occupations x 28 locales
destatis-anerkennung/     German recognition outcomes 2016–2024
eu-regulated-professions/ EU recognition decisions, German slice
integreat/                Multilingual migrant guidance, Nuremberg + Munich
crosswalks/               KldB 2010 ↔ ISCO-08 occupation code mapping
labour-market/            Shortage occupations, over-qualification rates
nuernberg/                City population & migration background by district
```

---

## 1. `esco/` — the multilingual matching layer

**`esco-occupations-multilingual.json`** — **2,909 occupations**, every one with an
ISCO-08 code.

ESCO v1.2.1, slimmed to what you need for label matching. Each record:

| Field | Notes |
|---|---|
| `uri` | Stable ESCO concept URI |
| `iscoGroup` | ISCO-08 code — joins to the crosswalk and to the EU decisions data. Present on 100% of records. |
| `preferredLabel` | **28 locales** (see the language note below) |
| `alternativeLabel` | Synonyms per language — the fuzzy-match fuel |
| `description` | EN + DE only, to keep the file small |

This is the single most useful file here. It is what lets you take a job title in
one language and land on the German occupation and its ISCO code — e.g.
`ممرض متخصص` or `pielęgniarz - specjalista` → *Fachkrankenpfleger* → ISCO `2221.3`.

> ### Read this before you pick your input languages
>
> ESCO's 28 locales are the **EU official languages** plus Arabic, Icelandic and
> Norwegian (and `en-us` counts as its own code). In full:
>
> `ar bg cs da de el en en-us es et fi fr ga hr hu is it lt lv mt nl no pl pt ro sk sl sv`
>
> **There is no Ukrainian and no Turkish in ESCO.** Those are two of the most
> relevant languages for migration to Germany, so this is a real gap and not a
> detail — if you demo with Ukrainian input, ESCO alone will not match it.
>
> The workaround is in this same pack: **Integreat covers Ukrainian** (Nuremberg
> and Munich) **and Turkish** (Munich). Use Integreat content for those
> languages, or translate the query into German or English first and then match
> against ESCO. Decide this early; it shapes your whole pipeline.

Four occupations failed to fetch (ESCO's API returned HTTP 500 on its own
concepts), so this is 2,909 of roughly 2,913 reachable via the hierarchy. The
missing 0.14% won't affect a demo, but the number is honest rather than rounded.

The full ESCO release (skills, relations, RDF) is not bundled — it's ~225 MB.
Get it from https://esco.ec.europa.eu/en/use-esco/download, or call the live API
(no key required):

```
https://ec.europa.eu/esco/api/search?text=nurse&language=en&type=occupation
https://ec.europa.eu/esco/api/resource/occupation?uri=<uri>
```

One `resource/occupation` call returns all 28 locales at once. Note the taxonomy
entry point is `resource/taxonomy`, not `resource/concept` — the latter returns
no children for the scheme URI, which is easy to lose an hour to.

> **Licence:** CC BY 4.0. Attribute *"© European Union, ESCO v1.2.1"*.

---

## 2. `destatis-anerkennung/` — did the application succeed?

The official German recognition statistic (**statistic code 21231**, the survey
under § 17 BQFG), 2016–2024.

- `destatis-21231-2024.xlsx` — the original 91-sheet workbook
- `csv/csv-21231-*.csv` — **42 pre-flattened tables**, one row per observation.
  Use these. The formatted sheets have merged headers and add nothing.
- `csv/_manifest.csv` — row and column counts for every table

Useful starting points:

| File | Contents |
|---|---|
| `csv-21231-01.csv` | Headline series 2016–2024 by legal basis, regulation status, sex |
| `csv-21231-07.csv` | 3,694 rows — occupation × **country where trained** |
| `csv-21231-08.csv` | 4,015 rows — occupation × **nationality** |
| `csv-21231-10.csv` | Top 100 countries of training |

Measures are `Gesamt`, `Beschieden`, `Positiv_Beschieden`,
`Volle_Gleichwertigkeit`, `Negativ_Beschieden`. Partial equivalence isn't a
column — derive it as `Positiv_Beschieden − Volle_Gleichwertigkeit`.

**Two traps that will bite you:**

1. **Every cell is independently rounded to a multiple of 3** for disclosure
   control. Totals will not equal the sum of their parts. Don't build a
   reconciliation check; do footnote your charts.
2. **There is no Bundesland breakdown.** This statistic is Germany-level only.
   No amount of searching will find one — 16 state offices publish separately,
   in 16 formats, and Bavaria publishes PDF only.

**Processing times are not available.** The survey *does* collect the relevant
dates, but Destatis withholds them: *"Aufgrund der unsicheren Datenlage werden
Daten zur Verfahrensdauer im Statistischen Bericht nicht veröffentlicht."*
Microdata is not released either. If your idea depends on "how long does it
take", re-scope to outcomes now rather than at 19:00. That gap is itself a
finding worth putting on a slide.

> **Licence:** Datenlizenz Deutschland 2.0 (dl-de/by-2-0).
> Attribute *"© Statistisches Bundesamt (Destatis), 2025"*.

---

## 3. `eu-regulated-professions/` — how other EU countries decided

- `regprof-decisions-germany.csv` / `.json` — **10,977 records, 123,525
  decisions, 1997–2023**, Germany as host country, 31 origin countries,
  79 professions, ISCO-coded.
- `regprof-german-professions.json` — the 175 professions regulated in Germany
- `regprof-professions.json` — profession reference list across the EU

Top professions by decision volume: Doctor of Medicine (34,085), Nurse (25,365),
Secondary school teacher (18,186), Physiotherapist (7,575).

**Important scope limit:** this is Directive 2005/36/EC data, so origins are
**EU/EEA/Switzerland/UK only**. It does *not* cover third-country nationals, who
are the main audience for this track. Use it to compare procedures and spot
patterns, not as a proxy for the whole population. Destatis covers everyone.

Live API (undocumented but public, no key, CORS enabled):
`https://api.tech.ec.europa.eu/regprof20/prodmigration/decisions/export?lang=EN&b_services=`
(the full export is 80 MB — the German slice is already extracted for you).

> **Licence:** CC BY 4.0 (Commission Decision 2011/833/EU). Attribute *"© European Union"*.

---

## 4. `integreat/` — real multilingual guidance, for the actual city

Integreat is the municipal integration app used by Nuremberg and Munich. This is
genuine, human-written guidance content — including pages titled
**"Anerkennung ausländischer Bildungsabschlüsse"** — in a lot of languages.

| Region | Pages | Languages | POIs |
|---|---|---|---|
| `nuernberg/` | 171 (de) | **8** — de, en, fr, ar, fa, ru, uk, am | 64 |
| `muenchen/` | 640 (de) | **24** — incl. tr, pl, ro, so, sw, ckb, kmr, vi, zh, sq | 518 |

Each `pages_<lang>.json` has full HTML content, parent/child structure and
permalinks. `locations_de.json` has addresses, lat/lon, phone, email and opening
hours — real advice centres you can put on a map.

This is the best RAG corpus in the pack: same content, professionally
maintained, parallel across languages.

**A live problem you could fix today.** The translations are partly
machine-generated and the *titles* give it away. The Arabic and Ukrainian
versions of "Wie funktioniert die Anerkennung?" translate *Anerkennung* in the
pattern-recognition sense — `التعرف` and `розпізнавання` — while the body text
correctly uses the legal term (`الاعتراف`, `визнання`). A tool that catches
domain-term mistranslation in migrant guidance is a real, demonstrable win.

Live API (no key, CORS enabled, but rate-limited — keep it to ~1 request/sec):

```
https://cms.integreat-app.de/api/v3/regions/
https://cms.integreat-app.de/api/v3/nuernberg/languages/
https://cms.integreat-app.de/api/v3/nuernberg/<lang>/pages/
https://cms.integreat-app.de/api/v3/nuernberg/de/locations/
```

> **Licence:** CC BY 4.0 — verified individually for Nuremberg and Munich in
> each region's disclaimer endpoint. Attribute the city
> (*Stadt Nürnberg, Referat für Jugend, Familie und Soziales* /
> *Landeshauptstadt München, Sozialreferat*) and Integreat.
>
> **Per-region caveat:** the licence is set per city. Nuremberg, Munich, Fürth,
> Ingolstadt and Regensburg are CC BY 4.0, but **Augsburg grants nothing** and
> two districts are explicitly non-commercial. If you pull another region live,
> check `/<region>/de/disclaimer/` first.

---

## 5. `crosswalks/` — wiring the code systems together

`kldb2010-isco08-crosswalk.xlsx` maps the German **KldB 2010 (Fassung 2020)**
5-digit occupation codes to **ISCO-08** 4-digit unit groups.

This is the join key for the whole pack:

```
ESCO occupation ──iscoGroup──► ISCO-08 ──crosswalk──► KldB 2010
                                  │                      │
                        EU decisions data       Destatis + BA labour market
```

> **Licence:** Bundesagentur für Arbeit statistics are free to use without
> restriction. Attribute *"Quelle: Statistik der Bundesagentur für Arbeit"*.

---

## 6. `labour-market/` — is this qualification even in demand?

- `ba/2025_Länderergebnisse.xlsx` — shortage occupations by region.
  **Note: 12 regions, not 16** — small Länder are paired (SH/HH, NI/HB, RP/SL,
  BB/BE). Plan your choropleth accordingly.
- `ba/2025_Deutschland_Engpass.xlsx` — national shortage analysis
- `ba/2025_BA-FK-Engpassanalyse.pdf` — the methodology, worth skimming
- `eurostat-overqualification-de.json` — over-qualification by citizenship,
  1995–2025
- `eurostat-job-barriers-de.json` — barriers to finding suitable work, including
  the category `LREC_QLF` = *"Lack of recognition of qualifications"*

**Your hero chart is in the Eurostat file.** German nationals sit at ~17%
over-qualification and are slowly improving. Foreign nationals are at ~37% and
the gap is *widening*:

| Citizenship | 2020 | 2023 | 2025 |
|---|---|---|---|
| German nationals | 18.4 | 17.7 | **17.4** |
| Foreign nationals | 32.8 | 34.2 | **36.7** |
| Non-EU27 | 31.2 | 31.9 | **37.0** |

That is the problem this track exists to address, in three rows.

> **Licences:** BA — free use with attribution. Eurostat — reuse for commercial
> and non-commercial purposes authorised provided the source is acknowledged.

---

## 7. `nuernberg/` — local colour

`nuernberg-bevoelkerung-2024.csv` — 79 statistical districts × 28 columns,
including `Einwohner mit Migr.Hintergrund insg.` and nationality groups.

Handy for grounding a demo in the city you're standing in. Note this is the
*entire* useful open-data catalogue for Nuremberg on this topic — the city
portal has 19 datasets, all demographic. There is no open list of local advice
centres; Integreat's POI file is the closest thing.

> **Licence:** CC BY 4.0 — *Stadt Nürnberg, Amt für Stadtforschung und Statistik*.

---

## Call live, do NOT redistribute

These are the richest sources for this track, and **none of them is openly
licensed.** They have public, unauthenticated APIs. You may call them during the
hackathon and cache responses locally for your demo. Do not commit the harvested
data to a public repo, do not ship it in a product, and say on your slide that
it's a prototype using a non-commercial source.

**anabin (KMK)** — `https://anabin.kmk.org/api/public/`
The best structured data that exists for this problem: 880 foreign occupations
of which ~780 carry an explicit `equivalences[].germanOccupation` mapping, plus
32,518 institutions, 40,545 degrees and 1,109 recognition offices. A pre-built
foreign→German matching table.

*Terms, verbatim from https://anabin.kmk.org/impressum:* "Die unerlaubte
Vervielfältigung oder Weitergabe einzelner Inhalte oder kompletter Seiten ist
nicht gestattet und strafbar. Lediglich die Herstellung von Kopien und Downloads
für den persönlichen, privaten und nicht kommerziellen Gebrauch ist erlaubt."
So: query it, cache it for your demo, **don't mirror or ship it**.

**Linking to it is fine and is a different act from copying** — their terms place
no restriction on inbound links (the one link-shaped rule is that displaying the
site in third-party frames needs written permission). Browse it directly:

| | |
|---|---|
| Occupations | https://anabin.kmk.org/db/berufe |
| Degrees | https://anabin.kmk.org/db/hochschulabschluesse |
| Institutions | https://anabin.kmk.org/db/institutionen |
| Recognition offices | https://anabin.kmk.org/db/anerkennungs-und-beratungsstellen |

Three things that will waste your time if you don't know them:

1. **You cannot deep-link to a record.** The app has no per-record routes and
   strips the query string via `history.replaceState` without ever calling
   `pushState`, so a user's search is never in the address bar and can't be
   shared. The only parameter read is `?land=`, and it wants a **three-letter**
   ISO code — `?land=ESP`, not `ES`.
2. **CORS is pinned to `https://anabin-backend.kmk.org`** and does not reflect
   your Origin, so a browser `fetch` will always fail. Proxy server-side.
3. **Every `/db/` path returns HTTP 200**, including nonsense ones — it's a
   single-page app that redirects internally to `/db/404-fehler`. Never treat a
   200 from this host as proof that a route exists.

Paginate with `?limit=&offset=` (`page` is silently ignored); chunk at 5,000 or
you'll get a 503.

**Anerkennung in Deutschland (BIBB)** — `https://www.anerkennung-in-deutschland.de/api/v1/de/profession`
1,194 German professions with multilingual `keywords` aliases, and a
`beratungsstellen` endpoint returning advice centres with lat/lon, opening hours
and **languages spoken**. Operationally the only source that maps
*"my job + my city" → the office that actually decides my case*.
*Terms: all rights reserved. `robots.txt` sets `Crawl-delay: 100`.*
Two gotchas: the 11-language switcher is a mirage — `en`, `ar`, `tr`, `uk` all
return byte-identical English, only `de` differs. And the API leaks internal
fields (`internalComment`, `createdBy`) containing **BIBB staff email
addresses** — strip those before displaying or storing anything.

**BAMF-NAvI** — `https://bamf-navi.bamf.de/atlas-backend/beratungseinrichtungen?coord=649000,5478000`
Migration advice centres (MBE/JMD) — 72 around Nuremberg. Coordinates are
**EPSG:25832, not WGS84** — reproject before mapping. No licence stated; treat
as all rights reserved.

**Handbook Germany — don't.** Excellent content in 9 languages, but licensed
CC BY-**NC-ND**. The *ND* forbids derivatives, which is exactly what
summarising, translating or RAG-rewriting produces. Their robots.txt also
explicitly disallows `anthropic-ai`, `GPTBot` and `CCBot`. Use Integreat instead
— it's the same kind of content and it's CC BY.

---

## Dead ends, so you don't spend the afternoon finding them

- **The profession → competent authority mapping does not exist as open data.**
  This is the single most valuable missing dataset for this track. BIBB exposes
  `competence` as a boolean (regulated yes/no), not an authority reference.
  anabin's 1,109-row recognition-office list is the closest substitute. For
  Nuremberg specifically you can hand-curate ~20 rows in half an hour: IHK FOSA
  (commercial), HWK Mittelfranken (trades), Regierung von Mittelfranken
  (health), BLÄK (doctors).
- **BQ-Portal** — 108 country and 6,500 occupational profiles, and an API that
  is advertised as free but has no public endpoint. Access is by emailing a
  named person at IW Köln. Not obtainable in an afternoon.
- **Destatis GENESIS API** — data endpoints reject the anonymous `GAST` account;
  you need a (free, instant) registration. Not worth it: GENESIS holds only 2
  tables for this statistic, both Germany-level. The bundled XLSX has 42.
- **OECD** — every API endpoint returns 403 behind a Cloudflare challenge.
  Download CSVs manually from the Data Explorer UI if you need them.
- **IAB microdata** (they're based here in Nuremberg) — the SUF requires a
  posted, hand-signed data use agreement; scanned signatures are explicitly
  rejected. Realistically 4–8 weeks. Their aggregate files at
  `https://doku.iab.de/arbeitsmarktdaten/` are open, though.
- **Bavarian state open data** — `open.bydata.de` returns **zero** results for
  `Beratungsstellen`, `Migration Nürnberg` and `Integration Nürnberg`.
- **Wikidata** for advice centres — 272 organisations in Nuremberg, not one of
  them an advice centre. Skip it.

---

## Attribution block for your slides

```
Contains data from:
  ESCO v1.2.1 — © European Union, CC BY 4.0
  EU Regulated Professions Database — © European Union, CC BY 4.0
  Statistisches Bundesamt (Destatis) 2025 — dl-de/by-2-0
  Statistik der Bundesagentur für Arbeit
  Eurostat — © European Union
  Integreat / Stadt Nürnberg / Landeshauptstadt München — CC BY 4.0
  Stadt Nürnberg, Amt für Stadtforschung und Statistik — CC BY 4.0
```

Questions about the data? Ask an organiser.
