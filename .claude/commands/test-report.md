---
description: Run the full suites and write the stage test report (Excel) in Reports/
---

Write the test report for the stage that just ended. Do this once per stage (not per task).

1. Run, one after another and never in parallel (the integration specs share one database and delete all `@test.skilled.invalid` users): `pnpm --filter web test`, `pnpm --filter mobile test`, `pnpm --filter @kando/contract test`, `pnpm --filter @kando/i18n test`, `pnpm --filter @kando/domain test`, each with the JSON reporter so the per-test results can be read. Also `pnpm typecheck` and `pnpm lint`; report older known errors as such and say clearly if anything is new.
2. Check that the schema and the migrations agree (`npx drizzle-kit generate` must say "No schema changes").
3. Build `Reports/<Stage>-Test-Report.xlsx` with the layout of the newest existing report (copy it: `Reports/Stage-2e-Test-Report.xlsx`): a **Test Results** sheet (area, file, test name, part, outcome), an **Other Checks** sheet (typecheck, lint, migrations, review log, things not tested on a device, with the result and a note) and an **Open Items** sheet (what is still open, who, when). Never include a secret.
4. Say plainly what passed, what failed and what was not tested. Do not hide failures or call a skipped check done.
5. Update the README "Where we are" numbers, and record the report in the MVP tracker: `python docs/mvp/update.py --note "<stage> test report" --step <N>=Done`.
