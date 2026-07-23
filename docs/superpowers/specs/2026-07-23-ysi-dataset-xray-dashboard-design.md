# YSI Dataset X-Ray Dashboard Design

## Goal

Build a local, single-page dashboard that helps the hackathon team understand both the impact evidence inside the Aurelia Propel IMM dataset and the data problems that prevent reliable longitudinal analysis. The dashboard is an exploration tool for deciding what to build next, not an executive reporting surface.

## Audience and decision

The primary audience is the hackathon team. The default view must answer two questions without interaction:

1. What impact information is available across cohorts and waves?
2. What cleaning, mapping, and entity-resolution work is required before that information can be trusted?

## Scope

The dashboard reads all 19 CSV files from `Aurelia_Propel_IMM Dataset/` without modifying or redistributing them. It displays only local, derived summaries. It does not implement production authentication, deployment, live APIs, or a complete universal semantic mapping of every survey question.

## Dashboard structure

### Dataset overview

The top section shows source-file count, parsed response count, cohort count, date coverage, and a concise warning that the data is small-n, wide-schema, bilingual, and lacks a shared identifier.

### Coverage and data quality

A cohort-by-wave coverage view shows which lifecycle stages exist for AP1 through AP4. Supporting views compare file row counts, column counts, sparsity, delimiter, and language. These views expose asymmetric follow-up coverage, schema drift, and parsing hazards.

### Impact funnel

The dashboard maps the recurring five impact levels—Inform, Engage, Outcomes, Impact, and Societal—from the files where they are present. Users can filter by cohort and source file. The view shows level totals or medians, adjacent-stage conversion rates, sample sizes, and records that violate the expected non-increasing sequence. Missing and unparseable values remain visibly distinct from zero.

### Joinability explorer

The bottom section summarizes candidate organisation links across files using normalized organisation names and available email domains. It shows exact and fuzzy candidate matches, confidence, source files, and missing-wave gaps. It is diagnostic: candidate matches are not presented as confirmed identities.

## Architecture and data flow

A preprocessing script parses the CSVs locally with delimiter and BOM handling, removes blank records, profiles each file, discovers candidate identity columns, extracts funnel fields through an explicit alias map, normalizes numeric values conservatively, and writes a compact derived JSON artifact. The browser app reads that JSON and renders the dashboard. Raw rows and contact details are not shipped into the browser bundle.

The implementation will use TypeScript and the repository's Bun preference. The UI will be a lightweight responsive web app suitable for a live local demo. Components will be separated into source profiling, metric extraction, entity matching, and visualization modules so uncertain mappings remain inspectable.

## Error handling and trust

Parsing errors identify the source file and do not silently drop an entire dataset. Unparseable numeric values are counted and surfaced. Currency values are not aggregated across currencies. Fuzzy entity matches include a confidence label and remain reversible. Every chart carries its denominator or sample size, and source metadata identifies the contributing files.

## Validation

Automated checks will verify:

- all 19 source CSVs are discovered and parsed with their correct delimiter;
- parsed row and column counts reconcile with the source inventory;
- blank rows are excluded consistently;
- funnel fields preserve missing values and flag non-monotonic records;
- derived JSON contains no email addresses, phone numbers, or raw free text;
- global filters update all applicable views; and
- the production build succeeds and the dashboard renders at desktop and narrow widths.

## Success criteria

Within two minutes, a team member can identify the dataset's cohort/wave gaps, see at least one meaningful five-level funnel view, understand why entity resolution is necessary, and name the strongest next product direction. The dashboard runs locally from the provided data and can be demonstrated without network access.
