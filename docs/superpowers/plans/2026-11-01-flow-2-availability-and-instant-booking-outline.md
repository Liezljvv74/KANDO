# Flow 2: availability rules and instant booking (outline)

> **Status:** OUTLINE only, written 1 November 2026. It becomes a full plan after Flow 1 is built and phone-tested. Do not start before then.
> This follows the deferred item "weekly opening hours / slot picker for providers" from the Stage 2 later list (29 October 2026).

**Goal:** A provider says when they work and what can be booked automatically. Customers only see and send times that fit. For fixed-price services the provider can switch on **accept automatically**: a request whose time passes every rule gets its quote and confirmation without the provider tapping anything.

**Depends on Flow 1:** the one request-to-booked flow, the quote document, and the single function `timeIsAcceptable` in `packages/domain/src/bookings/rules.ts`. All rules below are added inside that one function so the flow itself does not change.

## What exists today (checked 1 November 2026)

- `busy_times(provider, from, to)` (database function in `packages/db/src/rls.ts`), `GET /providers/[slug]/busy`, and the `BusyTimes` list in the app's time form: a customer sees the provider's paid and awaiting-payment times.
- `slotIsHeld`, `assertSlotFree`, `lockProviderSlots` in `packages/domain/src/bookings/busy.ts`: no overlap with a held booking, 30-minute buffer between two on-site jobs, a lock so two accepts cannot both win.
- Service price types `fixed | hourly | from | on-request` in `packages/db/src/schema/providers.ts`; `providers.worksRemotely`.

**Not in the code:** weekly opening hours, days off or holidays, minimum notice, a daily limit, a per-service switch for automatic acceptance, a slot picker for the customer.

## Steps (to be detailed when this plan is written in full)

1. **Weekly hours** - a `provider_hours` table (weekday, from, to, several ranges per day allowed), RLS like the provider's other private tables, a provider screen in "My profile" to edit them. The date and time pickers (phone-test Finding 2) should be done before this, because the customer time form is where hours show up.
2. **Days off and holidays** - `provider_days_off` (a date range, optional reason), editable from the same screen; busy times for the customer include them.
3. **Minimum notice and daily limit** - two numbers per provider (hours of notice, maximum jobs per day), checked in `timeIsAcceptable`.
4. **Rules in one place** - extend `timeIsAcceptable` with hours, days off, notice and the daily limit; every caller (request, revise, send quote, confirm) already uses it, so one test file covers it; new friendly error codes with sentences in German and English that say what to change.
5. **Customer time picker** - the time form shows only free slots for the chosen day (from hours minus busy times minus buffer), instead of free typing; falls back to typing when the provider has set no hours.
6. **Instant booking switch** - `services.accept_automatically` (default off), allowed only for `fixed` price services of providers with payout set up (`canTransact`); on a new request the server checks `timeIsAcceptable`, then sends the quote as the provider (same code path as the button), so the customer immediately sees **Confirm and pay**. The provider is told afterwards (a new notice kind) and can still cancel under the normal cancellation rules.
7. **Safety rails** - a provider who sets automatic acceptance gets a clear explanation of what it means (a customer can book and pay without them tapping); a global daily cap of automatic bookings per provider; a kill switch in the back office; a log line per automatic acceptance.
8. **Stage test, README and phone test** like Flow 1.

## Open decisions for the owner (ask before writing the full plan)

1. Hours per provider only, or also per service (for example "cleaning only mornings")?
2. Should automatic acceptance need the provider to have a minimum number of completed jobs or a good rating first?
3. Is the 30-minute buffer between on-site jobs enough, or should the provider set their own travel time?
4. Holidays: manual date ranges only, or the German public holidays by state as a default (a country-ready list per market, South Africa later)?
5. Does the customer see "booked out" times greyed, or only free ones?

## Risks

- A wrong opening hours entry books a customer for a time the provider cannot do, with no tap in between; the safety rails (step 7) and the clear explanation are part of the plan, not optional.
- Time zones: all hours are in `TIME_ZONE` from `@kando/i18n`; a second market with another zone needs a per-provider zone.
