# Executed inside mvp_report.py (uses sheet(), wb, FILL).
P = []
def p(step, phase, what, done, needs, who, effort, tasks, parallel=''):
    P.append([step, phase, what, done, needs, who, effort, tasks, parallel])

# Phase 0
p('0.1', '0 Decide and set up', 'Hold PR #47 (do not merge): the server now requires a date and time on requests and the current app cannot send one.', 'PR #47 stays open until step 1.9.', '-', 'Owner', 'S', '4', 'everything')
p('0.2', '0 Decide and set up', 'AI feature planning: the owner decisions are in (OpenRouter model; all documents including photo ID, sensitive data protected; automatic decisions with a human check in some cases). Still to settle in the plan: the human-check rule, how ID data is protected, the model, cost cap, and the AI quote assistant (owner asked to be reminded). Result: a written plan in docs/superpowers/plans/.', 'AI plan approved by the owner.', '-', 'Both', 'S', '2', '0.3, 1.1')
p('0.3', '0 Decide and set up', 'PARTLY DONE: the .claude folder with the used agents, commands and skills and its README is on branch chore/claude-folder (open the PR, review it with /code-review --comment, owner approves on GitHub, merge). Still to do: CLAUDE.md in the root, the /test-report command, the RLS-check agent, and a README section "How this project is built with Claude Code".', 'CLAUDE.md in the root; .claude merged to main; README section added.', '-', 'Both', 'S', '5, 6, 7', '0.2, 1.1')
p('0.4', '0 Decide and set up', 'Write the one-page RLS and auth evidence note (Neon approved by the owner).', 'docs/rls-and-auth-evidence.md.', '-', 'Claude', 'S', '1', '0.2, 1.1')

# Phase 1
p('0.5', '0 Decide and set up', 'Confirm the reuse map for the app screens (Reuse map sheet); update Tasks 10 to 12 of the Flow 1 plan as a reuse map (plan text only). Note: the approved plan retires direct booking (the Book button opens the same request form), so the earlier suggestion to keep it until Flow 2 was dropped.', 'Owner confirmation; plan updated.', '-', 'Owner', 'S', '3, 17, 28', '0.2, 0.3')
p('0.6', '0 Decide and set up', 'Post a Review record comment on each merged PR that has a written review (owner go-ahead pending).', 'Comments visible on the merged PRs.', 'owner go-ahead', 'Claude', 'S', '7', 'everything')
p('1.1', '1 Finish Flow 1', 'Task 9: finish the notice wording (in-app, push, email, German and English) and correct the plan text.', 'Notice texts complete; i18n parity and notification specs pass.', '-', 'Claude', 'S', '15', '0.x')
p('1.2', '1 Finish Flow 1', 'Task 10a (app): ONE request form by extracting the shared "when and where" fields from TimeProposalForm (date, time, duration, on site, address prefilled from the saved account address, note) with native date and time pickers (Finding 2); (the old preferredDate field is already removed). The same shared fields serve the enter-a-time and counter screens.', 'A customer can send a request with a time on a phone build; jest tests for the form.', '1.1', 'Claude', 'M', '3, 20', '')
p('1.3', '1 Finish Flow 1', 'Task 10b (app): provider answer panel by extending the existing SendQuoteForm (amount, scope, optional date, time, duration) with the switch "date and time confirmed", prefilled with the request\'s time; propose another time; reject (decline already exists).', 'Provider can answer every request type; jest tests.', '1.2', 'Claude', 'M', '3', '')
p('1.4', '1 Finish Flow 1', 'Task 10c (app): customer quote screen by extending the existing QuoteCard and request page: Confirm (replaces the accept screen, which falls away); Decline with the offer to chat first; find another provider; pending-time confirm button; awaiting-time status text; no stand-in time shown; "discuss changes in the chat" instead of an edit button once a quote exists.', 'The whole flow can be walked in the app; jest tests.', '1.3', 'Claude', 'M', '3', '')
p('1.5', '1 Finish Flow 1', 'Task 11 (app): "Quotes sent" and "My received quotes" on the account page, PDF open / download / print.', 'Both lists and the PDF open on a phone build.', '1.4', 'Claude', 'M', '16', '1.6')
p('1.6', '1 Finish Flow 1', 'Task 12: retire the old proposed-booking path for quotes, make the time required in the contract, remove the AcceptQuoteScreen route (preferredDate is already gone), keep accept only for additional tasks; The Book button opens the same request form; POST /bookings and BookScreen retire (instant booking returns with Flow 2).', 'No second booking path; specs updated.', '1.4', 'Claude', 'M', '17', '1.5')
p('1.7', '1 Finish Flow 1', 'Task 13: full suites once, test report in Reports/, README update, phone test script with a tap count before and after.', 'Reports/Flow-1-Test-Report.xlsx; all suites green.', '1.5, 1.6', 'Claude', 'M', '18', '')
p('1.8', '1 Finish Flow 1', 'Decide the open Flow 1 points (street privacy, second PDF, PDF language) and apply the answers.', 'Decisions recorded in the plan.', '-', 'Owner', 'S', '19', '1.2-1.7')
p('1.9', '1 Finish Flow 1', 'Release: apply migrations 0024 to 0026 to kando-main, merge #47 and the app PR, check production, make a new Android build.', 'Production runs Flow 1; new APK installed on the test phone.', '1.7, 1.8, owner actions O.1', 'Both', 'M', '4, 34', '')
p('1.10', '1 Finish Flow 1', 'Phone walk-through on Android with the test accounts, including a full Stripe TEST payment; fix what it finds; retest findings 4 and 6.', 'Walk-through list signed off by the owner; fixes merged.', '1.9', 'Both', 'M', '12, 20', '')

# Phase 2
p('2.1', '2 AI feature', 'Provider and data protection: choose the provider, sign the processing agreement, sign off the DPIA, add the key to Vercel (server side only).', 'Provider contract and DPIA sign-off recorded in docs/legal-drafts.', '0.2', 'Owner', 'S', '2, 25', 'Phase 1')
p('2.2', '2 AI feature', 'Build the backend: table with row-level security for AI results, server job after upload, model call through the provider, result stored as a suggestion, rate limits and cost cap, tests (incl. a failing provider).', 'Upload creates a suggestion; failures never block an upload; specs pass.', '2.1, 0.2', 'Claude', 'L', '2', '')
p('2.3', '2 AI feature', 'Back office: a suggestion panel next to each document (type, name match, expiry, flags), staff decide as before; the decision is logged.', 'Reviewer sees suggestion and decides; admin specs pass.', '2.2', 'Claude', 'M', '2', '')
p('2.4', '2 AI feature', 'Disclosure and privacy: label in German and English where the person uploads and where staff see the suggestion; privacy text names the provider; the Article 50 note.', 'Labels visible; docs/article-50-note.md.', '2.3', 'Claude', 'S', '10', '')
p('2.5', '2 AI feature', 'Delete my data covers the AI result; export contains it.', 'Deletion spec proves removal.', '2.2', 'Claude', 'S', '11', '2.3')
p('2.6', '2 AI feature', 'Evaluation: run the feature on about 20 sample documents (made-up documents, never real ones), compare with the staff decision, record the result.', 'A measured result (for example 18 of 20 correct) in Reports/.', '2.3', 'Both', 'S', '26', '')

# Phase 3
p('3.1', '3 Security and compliance', 'Run the security scan on the final code (/security-scan and the three scanners); fix every critical and high finding and the open items (anonymous inserts into translations, owner_id readable, whole-row admin detail, server-only, CSP script-src).', 'docs/security-scan-<date>.md: no critical or high open.', '1.7, 2.3', 'Claude', 'M', '8', '3.2')
p('3.2', '3 Security and compliance', 'Secrets: scan working tree and history again; clean up Vercel Preview variables; mark secrets Sensitive; WAF rate-limit rules.', 'Clean scan output; checklist ticked by the owner.', 'owner actions', 'Both', 'S', '9', '3.1')
p('3.3', '3 Security and compliance', 'Legal pages published (Impressum, Datenschutz, AGB, Ranking) in German and English; age and terms tick at sign-up; report this profile or photo; public web page to request deletion.', 'Pages live; tick enforced; spec covers it.', 'owner supplies company details', 'Both', 'M', '24, 11', '2.x')
p('3.4', '3 Security and compliance', 'Real deletion on the live Neon Auth with a throw-away account; confirm everything is gone.', 'Written result in the evidence folder.', '1.9', 'Both', 'S', '11', '')
p('3.5', '3 Security and compliance', 'Run /code-review --comment on the release PR so the review is visible on GitHub; fix; the owner submits a GitHub review (Approve) and merges.', 'At least one PR shows a recorded review on GitHub.', '1.7', 'Both', 'S', '7', '')

# Phase 4
p('4.1', '4 Quality and evidence', 'Green repository: lint errors (38) and mobile type errors (4) fixed or excluded; CI green; update README "Where we are", Known gaps and test numbers.', 'pnpm lint, pnpm typecheck and CI all green on main.', '1.9', 'Claude', 'S', '23, 35', '')
p('4.2', '4 Quality and evidence', 'Demo data on production: delete the old test accounts; create one demo customer and two published demo providers with approved documents, finished jobs and reviews.', 'Demo walk-through works end to end on the live site.', '1.9, 2.3', 'Both', 'S', '22', '')
p('4.3', '4 Quality and evidence', 'README top section: goal / problem / how it works paragraph, Situation-Complication-Resolution, stack, AI disclosure; re-check the scorecard sheet.', 'Every row of the scorecard is Met.', 'all above', 'Claude', 'S', '13', '')

# Phase 5
p('5.1', '5 Presentation', 'Deck in the SCR frame with the six points; screenshots and a recorded demo as fallback; evaluation numbers from the reports.', 'Deck and demo script ready.', '4.3', 'Both', 'M', '14, 26', '')
p('5.2', '5 Presentation', 'Upload the project to showcase.turingcollege.com; rehearse the 10 minutes; prepare answers for the 5 minutes of questions (stack choice, RLS, AI risk, what is next).', 'Showcase entry live; rehearsal done.', '5.1', 'Owner', 'S', '14', '')

# Owner actions in parallel
p('O.1', 'Owner actions (run in parallel from day 1)', 'Vercel Preview variables and plan, Stripe Preview webhooks, storage keys, Neon Auth settings, first administrator on production, Resend domain, FCM credentials (see the Owner actions sheet).', 'Owner actions sheet ticked.', '-', 'Owner', 'M', '21, 33', 'Phases 1 to 3')

for row in P:
    row.append(STATE['steps'].get(row[0], 'Open'))
ws = sheet('Plan', ['Step', 'Phase', 'What happens', 'Done when', 'Needs first', 'Who', 'Effort', 'Tasks sheet No', 'Can run alongside', 'Status'], P, [7, 28, 100, 55, 22, 10, 8, 14, 20, 16], colour_col=9)
# colour phases
cols = {'0': 'D9E1F2', '1': 'E2EFDA', '2': 'FFF2CC', '3': 'FCE4D6', '4': 'EDEDED', '5': 'DDEBF7', 'O': 'F2F2F2'}
for row in ws.iter_rows(min_row=2):
    from openpyxl.styles import PatternFill
    row[0].fill = PatternFill('solid', fgColor=cols.get(str(row[0].value)[0], 'FFFFFF'))
    row[1].fill = PatternFill('solid', fgColor=cols.get(str(row[0].value)[0], 'FFFFFF'))
wb.move_sheet('Plan', offset=-(len(wb.sheetnames) - 2))


R = [
    ['Before every merge', 'Run /code-review --comment on the PR, fix the findings, and submit a GitHub review (Approve) in the PR page BEFORE merging. At least for the next release PR (the capstone needs a reviewed PR visible on GitHub).', 'Claude reminds at each PR', 'Saved (memory)'],
    ['AI planning', 'Discuss the AI quote assistant (drafts the quote text from a request) when the AI feature planning starts.', 'Claude reminds at AI planning', 'Saved (memory)'],
    ['Before the demo', 'Street privacy question: the street is stored in the request and hidden only in the responses. Accept for the MVP or move it into a protected place?', 'Claude raises it after Task 10', 'Saved (memory)'],
    ['Later', 'Stand-in start time for awaiting-time bookings (nullable start_at, or filter on status). Documented in the README Known gaps.', 'Claude raises it after the capstone', 'In README'],
    ['Plan', 'AI document check: define the human-check rule and the ID-data protection before building.', 'At AI planning', 'Open'],
    ['Now', 'Reply on the reuse map, direct booking kept until Flow 2, review records on merged PRs, and opening the PR for the .claude folder.', 'Owner', 'Waiting for the owner'],
]
sheet('Reminders', ['When', 'What', 'Who reminds', 'Status'], R, [20, 120, 34, 24])

U = [
    ['Request form (customer)', 'description, preferredDate (day only, typed), photos', 'KEEP description and photos; ADD the shared when-and-where fields (reuse TimeProposalForm: date, time, duration, on site, address, note) with native pickers; address prefilled from the saved account address', 'preferredDate: REMOVED on 1 Nov 2026 (column dropped by migration 0027, contract, server, data export, form, display and texts); nobody uses the app, so nothing is kept for old requests'],
    ['Shared "when and where" fields', 'TimeProposalForm: date, time, duration, on site, address, note (used by Book, Accept quote and Counter)', 'ONE shared component, extracted and given native pickers; used by the request form, the enter-a-time screen and the counter', 'Nothing duplicated: no second set of fields'],
    ['Provider answer (quote)', 'SendQuoteForm: amount, scope, suggested date, time, duration', 'KEEP and extend: date, time, duration become optional with the switch "date and time confirmed", prefilled from the request; reject exists already (decline)', 'The "suggestion" label and its text key'],
    ['Customer quote card', 'QuoteCard: amount, scope, suggested time, status, validity, Accept button', 'KEEP; button becomes Confirm (direct call, no time entry); add the quote number, revision, "date and time to be confirmed" and later the PDF link', 'The navigation to the accept screen'],
    ['Accept quote screen', 'AcceptQuoteScreen and /bookings/accept (customer proposes a time after a quote)', '-', 'FALLS AWAY (the customer confirms; the time is in the request and the quote). Server route /quotes/[id]/accept stays for additional tasks'],
    ['Request page', 'request-detail: description, preferredDate, quotes, withdraw/decline', 'KEEP; show time and place; "discuss changes in the chat" instead of editing once a quote exists; Decline offers the chat first; find another provider', 'preferredDate display (old requests only)'],
    ['Booking page', 'booking-detail with pay, cancel, finish, counter sheet (PR 45)', 'KEEP; add the pending-time block with a confirm button and the awaiting-time text (stand-in time never shown); reuse the OpenChat + enter-time pattern from the counter sheet', 'Nothing'],
    ['Counter screen', 'CounterScreen (counter a proposed booking time)', 'KEEP for direct bookings; the enter-a-time screen for awaiting-time is the SAME screen with another submit call', 'No separate form'],
    ['Direct booking', 'BookScreen and POST /bookings for fixed-price services', 'The Book button opens the SAME request form with the service chosen (as the approved plan says: one flow); instant booking returns with Flow 2', 'BookScreen and POST /bookings retire in Task 12; old proposed rows are still answered until none exist (known leftover)'],
    ['Quote lists (Task 11)', 'New: Quotes sent / My received quotes on the account page', 'List rows open the EXISTING request page; PDF link on the row', 'No new detail screen'],
    ['Inbox / Needs your answer (Task 14, finding 5)', 'Notices on Home and My bookings', 'ONE list: build Needs your answer as the first version of the inbox', 'No separate pop-out or second list'],
    ['Server fields', 'requests.start_at, duration_min, on_site, address, note; quotes.start_at, duration_min; bookings.start_at and pending-time columns', 'All already built and shared through the TimeProposal shape; nothing new to add for the screens', 'Nothing left to remove: preferredDate is gone; the export now carries startAt, durationMin and onSite'],
]
sheet('Reuse map', ['Screen or field', 'Exists today', 'Reuse / change', 'Falls away or stays as a known duplicate'], U, [30, 55, 90, 70])
