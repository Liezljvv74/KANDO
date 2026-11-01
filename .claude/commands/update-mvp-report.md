---
description: After a commit that goes into a PR, record it in the MVP tracker and write a new dated "MVP Completion Tasks" workbook
---

The owner's rule: everything follows the phases of the Plan sheet of the newest `Reports/MVP Completion Tasks <date time>.xlsx`, and the workbook is renewed after every commit that goes into a pull request.

1. Make the work commit first (code, texts, docs). Note its short hash.
2. From the repository root run:
   `python docs/mvp/update.py --commit <hash> --note "<what changed, which PR>" --step <N>=<Status> --task <N>=<Status>`
   Statuses: `Open`, `In progress`, `Waiting for owner`, `Done`. Use the step numbers of the Plan sheet (for example `1.1`, `2.3`) and the task numbers of the Tasks sheet. Say in the note what the owner must still do (review, merge, answer).
3. The script updates `docs/mvp/state.json` and writes a NEW file `Reports/MVP Completion Tasks <YYYY-MM-DD HH-MM>.xlsx`; older versions stay. Commit `docs/mvp/state.json` and the new workbook in a small follow-up commit and push it with the work.
4. If a step's text, order or a task changes, edit `docs/mvp/mvp_plan.py` or `docs/mvp/mvp_report.py` first (they hold the sheet contents), then run the update.
5. Tell the owner in one line what moved. Do not start work that is later in the sequence than the first step that is not Done, unless the owner asks for it.
