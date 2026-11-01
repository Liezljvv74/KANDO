"""Record progress in the MVP tracker; write a new workbook after every 2nd merged pull request.

Usage (from the repository root):
  python docs/mvp/update.py --note "what changed" [--commit abc1234] [--step 0.5=Done ...] [--task 5=Done ...] [--merged 48]
  python docs/mvp/update.py --force --note "..."      # write a workbook now, whatever the merge count

Every call records the status changes and a change-log line in docs/mvp/state.json. A workbook
Reports/MVP Completion Tasks <YYYY-MM-DD HH-MM>.xlsx (older versions are kept) is written only when two merged
pull requests have been recorded with --merged since the last workbook (owner rule, 1 November 2026), or with --force.
Only merges that change code count (owner rule): never pass --merged for a pull request that changes documents, plans or tracker files only.
Statuses: Open, In progress, Waiting for owner, Done. Commit state.json (and the new workbook, when there is one).
"""
import argparse, datetime, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(HERE, 'state.json')
state = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {'steps': {}, 'tasks': {}, 'log': []}
state.setdefault('mergesSinceWorkbook', [])

ap = argparse.ArgumentParser()
ap.add_argument('--note', required=True)
ap.add_argument('--commit', default='')
ap.add_argument('--step', action='append', default=[])
ap.add_argument('--task', action='append', default=[])
ap.add_argument('--merged', action='append', default=[], help='number of a pull request the owner has merged')
ap.add_argument('--force', action='store_true')
a = ap.parse_args()

now = datetime.datetime.now()
touched = []
for kind, items in (('steps', a.step), ('tasks', a.task)):
    for item in items:
        if '=' not in item:
            sys.exit(f"--{kind[:-1]} needs N=Status, got '{item}'")  # nothing has been changed yet
        k, v = item.split('=', 1)
        state[kind][k] = v
        touched.append(('step ' if kind == 'steps' else 'task ') + k + ' ' + v)
for pr in a.merged:
    # a pull request already counted (in this workbook round or in the last workbook) is not counted again
    if pr not in state['mergesSinceWorkbook'] and pr not in state.get('workbookMerges', []):
        state['mergesSinceWorkbook'].append(pr)
        touched.append('merged PR #' + pr)
commit = a.commit or subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
write = a.force or len(state['mergesSinceWorkbook']) >= 2
if write:
    state['stamp'] = now.strftime('%Y-%m-%d %H-%M')
state['log'].append({'when': now.strftime('%Y-%m-%d %H:%M'), 'commit': commit, 'note': a.note, 'steps': touched})
if not write:
    json.dump(state, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print(f"Recorded in state.json; no workbook yet ({len(state['mergesSinceWorkbook'])} of 2 merged PRs since the last one).")
    sys.exit(0)
# the workbook first, from the state with this entry; the merge counter is cleared only when it was written
json.dump(state, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
code = subprocess.call([sys.executable, os.path.join(HERE, 'mvp_report.py')])
if code == 0:
    state['workbookMerges'] = list(state['mergesSinceWorkbook'])
    state['mergesSinceWorkbook'] = []
    json.dump(state, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
sys.exit(code)
