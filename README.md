# csv-reader-speed-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xnotyoursol/csv-reader-speed-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/0xnotyoursol/csv-reader-speed-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every case: a fast CSV reader for broken CSV files, written for the make.fun "Read broken CSV files faster, 21 November 2026" bounty.

`solve.js` reads each `{text, header}` input once, left to right, with the reference's exact broken-row policy (BOM, CRLF, stray CRs, quoted fields with doubled quotes and line breaks inside, junk after a closing quote, unterminated quotes, short/long rows) and returns `{columns, rows, errors}`. Speed comes from native slicing instead of character-at-a-time reads: a record line with no quote in it is split natively, unquoted fields are found with bounded `indexOf` scans, and quoted fields take the slice as it stands unless the body holds a doubled quote, a line break or a CR.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), answers each with `run()` from `solve.js`, and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=cpetny9f&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
