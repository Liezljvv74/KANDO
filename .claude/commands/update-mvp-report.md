---
description: Record progress in the MVP tracker; the "MVP Completion Tasks" workbook is updated in place after every 2 merged code PRs
---

The owner's rule: everything follows the phases of the Plan sheet of `Reports/MVP Completion Tasks.xlsx`. The workbook is renewed **only after every 2 successful merges** (owner rule of 1 November 2026), not after each commit.

1. Make the work commit first (code, texts, docs). Note its short hash.
2. From the repository root run:
   `python docs/mvp/update.py --commit <hash> --note "<what changed, which PR>" --step <N>=<Status> --task <N>=<Status>`
   Statuses: `Open`, `In progress`, `Waiting for owner`, `Done`. Use the step numbers of the Plan sheet (for example `1.1`, `2.3`) and the task numbers of the Tasks sheet. Say in the note what the owner must still do (review, merge, answer). This updates `docs/mvp/state.json` and the change log only.
3. When the owner has merged a PR (check `gh pr view <n> --json state`), add `--merged <n>` to the next call, but only when the PR changed code: a PR with documents, plans or tracker files only is not counted (owner rule). When two merges have been recorded since the last workbook, the script writes a NEW file `Reports/MVP Completion Tasks <YYYY-MM-DD HH-MM>.xlsx` (older versions stay). `--force` writes one now.
4. Commit `docs/mvp/state.json` (and the new workbook when there is one) with the next piece of work.
5. If a step's text, order or a task changes, edit `docs/mvp/mvp_plan.py` or `docs/mvp/mvp_report.py` first (they hold the sheet contents).
6. Do not start work that is later in the sequence than the first step that is not Done, unless the owner asks for it. Tell the owner in one line what moved.
