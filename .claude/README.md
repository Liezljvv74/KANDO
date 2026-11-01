# Claude Code set-up used to build KANDO: SkillWeb

This folder holds the agents, commands and skills that were used to build this project, copied from the owner's Claude Code set-up so that they are visible in the repository. Provenance and what each was used for:

## Subagents (`agents/`)
| File | Used for |
|---|---|
| `nextjs-security-scanner.md` | Security scan of the Next.js app (routes, data access, secrets); run for the scan of 29 October 2026 (`docs/security-scan-2026-10-29.md`) and again before release. |
| `vercel-security-scanner.md` | Security scan of the Vercel layer (environment scoping, preview protection, headers). Same scans. |
| `ai-architect.md` | Proposals for structural decisions (stage designs, the one-flow booking design, the AI feature). Read-only. |
| `ai-researcher.md` | Fact-finding before planning or building (what exists in the code, library and API facts). Read-only. |
| `ai-code-reviewer.md` | Review of a diff in a fresh context (dead code, duplication, silent behaviour changes). Read-only. |
| `rls-check.md` | Added for the capstone: checks that every table is classified in `rls.ts`, reads each policy, and looks for an isolation test per private table. Read-only. |

General-purpose subagents (built into Claude Code) did the per-task implementation and review work in the subagent-driven stages; their reports are summarised in `Reports/`.

## Slash commands (`commands/`)
| File | Used for |
|---|---|
| `security-scan.md` | Runs the three security scanners in parallel and merges the findings by severity. |
| `security-scan-changed.md` | The same, limited to the files changed against `main`. |
| `test-report.md` | Added for the capstone: runs the full suites once at the end of a stage and writes the Excel test report in `Reports/`. |

Also used from Claude Code itself: `/code-review` (review of a diff or a pull request; the findings of PRs 46 and 47 are in `Reports/PRs-46-47-Review-Report.xlsx`).

## Skills (`skills/`)
| Folder | Source | Used for |
|---|---|---|
| `brainstorming` | superpowers plugin 7.0.0 (MIT) | Turning an idea into a design before any building (stage designs, the flow design talks). |
| `writing-plans` | superpowers plugin 7.0.0 (MIT) | The written implementation plans in `docs/superpowers/plans/` and `docs/plans/`. |
| `subagent-driven-development` | superpowers plugin 7.0.0 (MIT) | Executing a plan task by task with an implementer and a reviewer per task (stages 1, 2a to 2e, the assessment fixes). |
| `neon-postgres` | Neon plugin 2.3.0 | Neon Postgres practice: branches, pooled and direct connections, migrations. |

Other plugins enabled in the owner's set-up and used in sessions: `ponytail` (minimal-solution discipline), `expo`, `stripe`, `frontend-design`. They are installed per user, not copied here.

## Rules
The project rules for every session are in `CLAUDE.md` (project root) and the README section "How a new session starts". The row-level-security evidence for the assessors is `docs/rls-and-auth-evidence.md`.
