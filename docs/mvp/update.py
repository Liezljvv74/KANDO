"""Update the MVP completion workbook after a commit.

Usage (from the repository root):
  python docs/mvp/update.py --note "what changed" [--commit abc1234] [--step 0.5=Done ...] [--task 5=Done ...]

It records the status changes and a change-log line in docs/mvp/state.json, then writes a NEW workbook
Reports/MVP Completion Tasks <YYYY-MM-DD HH-MM>.xlsx (the older versions are kept). Statuses: Open, In progress,
Waiting for owner, Done. Commit state.json and the new workbook with the work they describe.
"""
import argparse, datetime, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(HERE, 'state.json')
state = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {'steps': {}, 'tasks': {}, 'log': []}

ap = argparse.ArgumentParser()
ap.add_argument('--note', required=True)
ap.add_argument('--commit', default='')
ap.add_argument('--step', action='append', default=[])
ap.add_argument('--task', action='append', default=[])
a = ap.parse_args()

now = datetime.datetime.now()
touched = []
for kind, items in (('steps', a.step), ('tasks', a.task)):
    for item in items:
        k, v = item.split('=', 1)
        state[kind][k] = v
        touched.append(('step ' if kind == 'steps' else 'task ') + k + ' ' + v)
commit = a.commit or subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
state['stamp'] = now.strftime('%Y-%m-%d %H-%M')
state['log'].append({'when': now.strftime('%Y-%m-%d %H:%M'), 'commit': commit, 'note': a.note, 'steps': touched})
json.dump(state, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
sys.exit(subprocess.call([sys.executable, os.path.join(HERE, 'mvp_report.py')]))
