import { COMMISSION_RATE, FREE_CANCEL_HOURS, HELP_OPENING_SLUG, LATE_CANCEL_SHARE, MAX_MESSAGE_CHARS, NO_SHOW_OBJECTION_HOURS, STOP_ANSWER_DAYS, type HelpGroup } from '@kando/contract'

import { retentionMonths } from '../account'
import { ID_IMAGE_KEEP_DAYS } from '../ai/document-check'
import { ASK_DONE_HOURS, CONFIRM_DAYS, CONFIRM_REMINDER_DAYS, DISPUTE_DECISION_WORKING_DAYS, NO_ACTION_STAFF_DAYS, REVIEW_EDIT_DAYS, REVIEW_VISIBLE_DAYS } from '../bookings/ending-rules'
import { AWAITING_TIME_DAYS, MAX_OPEN_REQUESTS_PER_PAIR, MAX_REQUESTS_PER_DAY, PAY_BEFORE_START_HOURS, PAY_WINDOW_HOURS, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS, SHORT_NOTICE_PAY_HOURS, SHORT_NOTICE_THRESHOLD_HOURS, TIME_ANSWER_DAYS } from '../bookings/rules'
import { CHAT_EMAIL_THROTTLE_MINUTES } from '../chat/rules'
import { MAX_DOCUMENT_BYTES } from '../documents'
import { CUSTOMERS_WAITING_NOTICE_HOURS, MAX_PAY_AHEAD_DAYS, MIN_CHARGE_CENTS } from '../payments/rules'
import { MAX_PORTFOLIO_PHOTOS } from '../photos'
import { MAX_PROVIDER_REFERENCES } from '../providers/items'
import { PAGE_SIZE } from '../search'

/**
 * The Help topics, German first. Every number in a text is built from the constant the rule runs on (a test checks it), so the
 * Help cannot drift from the code. Every sentence was checked against the code on 9 November 2026; keep it that way: say only
 * what the code does today, and never promise what is not built (README "What the app cannot do yet").
 * A topic with `approved: false` stays hidden until the owner (and, for the money and governance texts, the lawyer) approved it.
 */
export type HelpTopicSeed = {
  slug: string
  sort: number
  group: HelpGroup
  approved: boolean
  titleDe: string
  bodyDe: string
  titleEn: string
  bodyEn: string
}

const pct = (x: number) => Math.round(x * 100)
const COMMISSION = pct(COMMISSION_RATE)
const LATE = pct(LATE_CANCEL_SHARE)
const MIN_CHARGE = (MIN_CHARGE_CENTS.EUR! / 100).toFixed(2)
const DOC_MB = MAX_DOCUMENT_BYTES / 1_000_000
const [R1, R2, R3] = CONFIRM_REMINDER_DAYS

export const helpTopics = (): HelpTopicSeed[] => {
  // DELETE_RETENTION_MONTHS can switch the retention off (0): then nothing is kept and the sentence says so.
  const months = retentionMonths()
  const keepEn = months > 0 ? `If you have a provider profile or sent verification documents, your other verification documents (not your photo ID) and your basic trader details are kept for ${months} months and then deleted automatically.` : 'Nothing else about you is kept for later.'
  const keepDe = months > 0 ? `Hast du ein Anbieterprofil oder Nachweise eingereicht, werden deine übrigen Nachweise (nicht dein Ausweis) und deine Grunddaten als Anbieter ${months} Monate aufbewahrt und danach automatisch gelöscht.` : 'Darüber hinaus wird nichts von dir für später aufbewahrt.'
  return [
    {
      slug: HELP_OPENING_SLUG,
      sort: 10,
      group: 'using-the-app',
      approved: true,
      titleEn: 'What KANDO is and how it works',
      bodyEn: `KANDO is a marketplace in the app: you find a local provider, send a request, get a quote, pay in the app and confirm when the job is done. Providers upload a photo ID and, depending on their category, further documents; a service goes live only when the documents it needs have been approved. As a customer you pay no fee on top of the price; the provider pays ${COMMISSION} percent commission, payment fees included, out of what you paid. The money is paid to the provider when you confirm the job, or ${CONFIRM_DAYS} days after the provider tapped "Job finished" if nobody reports a problem. An invoice or receipt in the provider's name appears once the job is settled. For now payments run in a test mode: no real money is charged or paid out.`,
      titleDe: 'Was KANDO ist und wie es funktioniert',
      bodyDe: `KANDO ist ein Marktplatz in der App: Du findest einen Anbieter in deiner Nähe, schickst eine Anfrage, bekommst ein Angebot, bezahlst in der App und bestätigst, wenn der Auftrag erledigt ist. Anbieter laden einen Ausweis und je nach Kategorie weitere Nachweise hoch; eine Leistung geht erst online, wenn die dafür nötigen Nachweise freigegeben sind. Als Kunde zahlst du keine Gebühr zusätzlich zum Preis; der Anbieter zahlt ${COMMISSION} Prozent Provision, Zahlungsgebühren inbegriffen, aus dem, was du bezahlt hast. Das Geld geht an den Anbieter, wenn du den Auftrag bestätigst, oder ${CONFIRM_DAYS} Tage nachdem der Anbieter auf „Auftrag erledigt“ getippt hat, wenn niemand ein Problem meldet. Eine Rechnung oder Quittung im Namen des Anbieters erscheint, sobald der Auftrag abgerechnet ist. Im Moment laufen Zahlungen nur im Testmodus: Es wird kein echtes Geld belastet oder ausgezahlt.`,
    },
    {
      slug: 'how-it-is-governed',
      sort: 20,
      group: 'safety-and-rules',
      approved: false,
      titleEn: 'How it is governed',
      bodyEn: `KANDO is the platform between customers and providers; the provider does the work and issues the invoice or receipt in their own name. Before a service goes live, the documents required for its category must be approved, and every provider is asked for a photo ID. If something goes wrong with a finished or stopped job, either side can report a problem, and our team decides within ${DISPUTE_DECISION_WORKING_DAYS} working days (Monday to Friday; public holidays are not counted) and sends both sides a written reason; no money moves until the decision. Messages with phone numbers, email addresses or links are refused in the chat, and repeated attempts are flagged to our team. If a provider does not turn up a second time within 12 months, our team is notified and can suspend the profile for a limited time. Our team can hide a review that breaks the rules and records a reason.`,
      titleDe: 'Wie die Plattform geregelt ist',
      bodyDe: `KANDO ist die Plattform zwischen Kunden und Anbietern; der Anbieter erledigt die Arbeit und stellt Rechnung oder Quittung in seinem eigenen Namen aus. Bevor eine Leistung online geht, müssen die für ihre Kategorie nötigen Nachweise freigegeben sein, und von jedem Anbieter wird ein Ausweis verlangt. Geht bei einem erledigten oder gestoppten Auftrag etwas schief, kann jede Seite ein Problem melden, und unser Team entscheidet innerhalb von ${DISPUTE_DECISION_WORKING_DAYS} Arbeitstagen (Montag bis Freitag; Feiertage werden nicht abgezogen) und schickt beiden Seiten eine schriftliche Begründung; bis zur Entscheidung wird kein Geld bewegt. Nachrichten mit Telefonnummern, E-Mail-Adressen oder Links werden im Chat abgelehnt, und wiederholte Versuche werden an unser Team gemeldet. Erscheint ein Anbieter innerhalb von 12 Monaten ein zweites Mal nicht, wird unser Team informiert und kann das Profil für eine begrenzte Zeit sperren. Unser Team kann eine Bewertung ausblenden, die gegen die Regeln verstößt, und hält dafür einen Grund fest.`,
    },
    {
      slug: 'where-the-money-is-kept',
      sort: 30,
      group: 'money-and-fees',
      approved: false,
      titleEn: 'Where the money is kept',
      bodyEn: `You pay on a page of Stripe, our payment provider; KANDO does not store your card details. The payment is not passed to the provider at once: it stays in KANDO's own Stripe account until the job is done. It is then transferred to the provider's Stripe account, minus KANDO's ${COMMISSION} percent commission, which includes the payment fees. When the money reaches the provider's bank depends on Stripe's payout schedule. If you cancel in time, or the provider cancels, you get the full price back; a refund can take a few days. For now this runs in test mode only: no real money is charged.`,
      titleDe: 'Wo das Geld liegt',
      bodyDe: `Du bezahlst auf einer Seite von Stripe, unserem Zahlungsdienstleister; KANDO speichert deine Kartendaten nicht. Die Zahlung geht nicht sofort an den Anbieter: Sie bleibt im eigenen Stripe-Konto von KANDO, bis der Auftrag erledigt ist. Danach wird sie auf das Stripe-Konto des Anbieters übertragen, abzüglich der Provision von ${COMMISSION} Prozent für KANDO, in der die Zahlungsgebühren enthalten sind. Wann das Geld auf dem Bankkonto des Anbieters ankommt, richtet sich nach dem Auszahlungsplan von Stripe. Wenn du rechtzeitig stornierst oder der Anbieter storniert, bekommst du den vollen Preis zurück; eine Rückerstattung kann einige Tage dauern. Im Moment läuft das nur im Testmodus: Es wird kein echtes Geld belastet.`,
    },
    {
      slug: 'finding-providers',
      sort: 40,
      group: 'using-the-app',
      approved: true,
      titleEn: 'Finding providers',
      bodyEn: `Open Search, choose a category, enter your postcode and, if you like, a search term (it is matched against the provider's name and skills). Providers close to you come first, then the others by name; providers who work remotely are always included. Ratings are shown on each result but do not change the order, and nobody can pay for a better place. Each page shows ${PAGE_SIZE} providers; tap "Load more" for the next ones. Only published providers with at least one service that may be offered appear.`,
      titleDe: 'Anbieter finden',
      bodyDe: `Öffne die Suche, wähle eine Kategorie, gib deine Postleitzahl und, wenn du magst, einen Suchbegriff ein (er wird mit dem Namen und den Fähigkeiten des Anbieters verglichen). Anbieter in deiner Nähe stehen zuerst, danach die anderen nach Namen; Anbieter, die aus der Ferne arbeiten, sind immer dabei. Bewertungen werden bei jedem Ergebnis angezeigt, ändern aber die Reihenfolge nicht, und niemand kann sich einen besseren Platz erkaufen. Jede Seite zeigt ${PAGE_SIZE} Anbieter; mit „Mehr laden“ siehst du die nächsten. Es erscheinen nur veröffentlichte Anbieter mit mindestens einer Leistung, die angeboten werden darf.`,
    },
    {
      slug: 'sending-a-request',
      sort: 50,
      group: 'using-the-app',
      approved: true,
      titleEn: 'Sending a request',
      bodyEn: `On a provider's page, tap "Request a quote" and describe what you need, when, for how long and whether it is on site or remote; for on-site work you also give the address. The request goes to that one provider only, who has ${REQUEST_ANSWER_DAYS} days to answer. You can have at most ${MAX_OPEN_REQUESTS_PER_PAIR} open requests with the same provider and send at most ${MAX_REQUESTS_PER_DAY} requests a day. You can change the request until the provider has sent a quote, and withdraw it as long as it is open. Once a quote exists, use the chat for changes.`,
      titleDe: 'Eine Anfrage schicken',
      bodyDe: `Tippe auf der Seite eines Anbieters auf „Angebot anfragen“ und beschreibe, was du brauchst, wann, wie lange und ob vor Ort oder aus der Ferne; bei Arbeit vor Ort gibst du auch die Adresse an. Die Anfrage geht nur an diesen einen Anbieter, der ${REQUEST_ANSWER_DAYS} Tage Zeit hat zu antworten. Du kannst höchstens ${MAX_OPEN_REQUESTS_PER_PAIR} offene Anfragen beim selben Anbieter haben und höchstens ${MAX_REQUESTS_PER_DAY} Anfragen am Tag schicken. Du kannst die Anfrage ändern, bis der Anbieter ein Angebot geschickt hat, und sie zurückziehen, solange sie offen ist. Liegt ein Angebot vor, nutze den Chat für Änderungen.`,
    },
    {
      slug: 'quotes',
      sort: 60,
      group: 'using-the-app',
      approved: true,
      titleEn: 'Quotes',
      bodyEn: `The provider answers with a quote (a price and a description of the work), or declines. A quote is valid for ${QUOTE_VALID_DAYS} days, but never beyond the time it offers. A new quote from the provider replaces the earlier one for the same request. When you tap "Accept quote", the booking is created. With a confirmed time, the booking now waits for your payment; without one, either side enters a time and the other side has ${TIME_ANSWER_DAYS} days to confirm it, and if no time is agreed within ${AWAITING_TIME_DAYS} days, the booking lapses. When a booking has lapsed, the app asks you whether you still want it.`,
      titleDe: 'Angebote',
      bodyDe: `Der Anbieter antwortet mit einem Angebot (Preis und Beschreibung der Arbeit) oder lehnt ab. Ein Angebot gilt ${QUOTE_VALID_DAYS} Tage, aber nie über den Termin hinaus, den es nennt. Ein neues Angebot des Anbieters ersetzt das frühere zur selben Anfrage. Wenn du auf „Angebot annehmen“ tippst, wird die Buchung angelegt. Mit bestätigtem Termin wartet die Buchung jetzt auf deine Zahlung; ohne Termin trägt eine Seite einen ein, und die andere Seite hat ${TIME_ANSWER_DAYS} Tage Zeit, ihn zu bestätigen, und wird innerhalb von ${AWAITING_TIME_DAYS} Tagen kein Termin vereinbart, verfällt die Buchung. Ist eine Buchung verfallen, fragt dich die App, ob du sie noch möchtest.`,
    },
    {
      slug: 'paying',
      sort: 70,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Paying',
      bodyEn: `You pay the full price on Stripe's page; the smallest amount possible is EUR ${MIN_CHARGE}. The deadline to pay is ${PAY_WINDOW_HOURS} hours after you accepted the quote, but at least ${PAY_BEFORE_START_HOURS} hours before the start; if the start is ${SHORT_NOTICE_THRESHOLD_HOURS} hours away or less, you have ${SHORT_NOTICE_PAY_HOURS} hours. A job that starts more than ${MAX_PAY_AHEAD_DAYS} days ahead cannot be paid yet. The booking is confirmed when Stripe reports your payment. If your card is declined, nothing is charged and you can pay again until the deadline. For now payments run in test mode only: no real money is charged.`,
      titleDe: 'Bezahlen',
      bodyDe: `Du zahlst den vollen Preis auf der Seite von Stripe; der kleinste mögliche Betrag ist ${MIN_CHARGE.replace('.', ',')} Euro. Die Zahlungsfrist beträgt ${PAY_WINDOW_HOURS} Stunden nach der Annahme des Angebots, aber mindestens ${PAY_BEFORE_START_HOURS} Stunden vor dem Beginn; beginnt der Auftrag in ${SHORT_NOTICE_THRESHOLD_HOURS} Stunden oder früher, hast du ${SHORT_NOTICE_PAY_HOURS} Stunden. Ein Auftrag, der mehr als ${MAX_PAY_AHEAD_DAYS} Tage in der Zukunft beginnt, kann noch nicht bezahlt werden. Die Buchung ist bestätigt, sobald Stripe deine Zahlung meldet. Wird deine Karte abgelehnt, wird nichts belastet, und du kannst bis zur Frist erneut zahlen. Im Moment laufen Zahlungen nur im Testmodus: Es wird kein echtes Geld belastet.`,
    },
    {
      slug: 'finishing-a-job',
      sort: 80,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Finishing a job and the payout',
      bodyEn: `From the start time on, the provider taps "Job finished". You then have ${CONFIRM_DAYS} days to confirm the job or report a problem, and you get reminders after ${R1}, ${R2} and ${R3} days. When you confirm, or when the ${CONFIRM_DAYS} days pass without a problem report, the money is released to the provider. If the provider never taps "Job finished", we ask you ${ASK_DONE_HOURS} hours after the end whether the job was done. These automatic steps run once a day. If the provider has not finished setting up payouts, the release waits.`,
      titleDe: 'Auftrag abschließen und Auszahlung',
      bodyDe: `Ab dem Beginn kann der Anbieter auf „Auftrag erledigt“ tippen. Du hast dann ${CONFIRM_DAYS} Tage Zeit, den Auftrag zu bestätigen oder ein Problem zu melden, und bekommst Erinnerungen nach ${R1}, ${R2} und ${R3} Tagen. Wenn du bestätigst, oder wenn die ${CONFIRM_DAYS} Tage ohne Problemmeldung vergehen, wird das Geld an den Anbieter freigegeben. Tippt der Anbieter nie auf „Auftrag erledigt“, fragen wir dich ${ASK_DONE_HOURS} Stunden nach dem Ende, ob der Auftrag erledigt wurde. Diese automatischen Schritte laufen einmal am Tag. Hat der Anbieter die Einrichtung der Auszahlung nicht abgeschlossen, wartet die Freigabe.`,
    },
    {
      slug: 'jobs-list',
      sort: 90,
      group: 'using-the-app',
      approved: true,
      titleEn: 'The Jobs list',
      bodyEn: `The Jobs tab shows all your requests, quotes and bookings in three sections: "Needs you" (where you have to act), "Active jobs" and "Past jobs". Each job has a number and shows what happens next. A search box finds a job by number, name or title. A "New message" tag shows where an unread chat message is waiting. Your invoices and receipts are listed there too.`,
      titleDe: 'Die Auftragsliste',
      bodyDe: `Der Reiter „Aufträge“ zeigt alle deine Anfragen, Angebote und Buchungen in drei Bereichen: „Wartet auf dich“ (hier musst du etwas tun), „Laufende Aufträge“ und „Vergangene Aufträge“. Jeder Auftrag hat eine Nummer und zeigt, was als Nächstes passiert. Mit dem Suchfeld findest du einen Auftrag über Nummer, Name oder Titel. Ein Hinweis „Neue Nachricht“ zeigt, wo eine ungelesene Chatnachricht wartet. Auch deine Rechnungen und Quittungen sind dort aufgelistet.`,
    },
    {
      slug: 'cancelling',
      sort: 100,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Cancelling a booking',
      bodyEn: `You can cancel a paid booking until it starts. More than ${FREE_CANCEL_HOURS} hours before the start it is free and you get the full price back (a refund can take a few days); exactly ${FREE_CANCEL_HOURS} hours before is still free. Less than ${FREE_CANCEL_HOURS} hours before the start, ${LATE} percent of the price goes to the provider (minus the commission) and the rest comes back to you. If the provider cancels, you always get everything back; a cancellation less than ${FREE_CANCEL_HOURS} hours before the start counts as a late cancellation on the provider's public profile for 12 months. A booking you have not paid yet is withdrawn, not cancelled. After the start you can no longer cancel: stop the job or report a no-show instead.`,
      titleDe: 'Eine Buchung stornieren',
      bodyDe: `Du kannst eine bezahlte Buchung bis zu ihrem Beginn stornieren. Mehr als ${FREE_CANCEL_HOURS} Stunden vor dem Beginn ist das kostenlos, und du bekommst den vollen Preis zurück (eine Rückerstattung kann einige Tage dauern); genau ${FREE_CANCEL_HOURS} Stunden vorher ist es noch kostenlos. Weniger als ${FREE_CANCEL_HOURS} Stunden vor dem Beginn gehen ${LATE} Prozent des Preises an den Anbieter (abzüglich der Provision), der Rest kommt zu dir zurück. Storniert der Anbieter, bekommst du immer alles zurück; eine Stornierung weniger als ${FREE_CANCEL_HOURS} Stunden vor dem Beginn zählt 12 Monate lang als späte Stornierung im öffentlichen Profil des Anbieters. Eine Buchung, die du noch nicht bezahlt hast, wird zurückgezogen, nicht storniert. Nach dem Beginn kannst du nicht mehr stornieren: Stoppe den Auftrag oder melde ein Nichterscheinen.`,
    },
    {
      slug: 'additional-tasks',
      sort: 110,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Additional tasks',
      bodyEn: `While a paid job is open, either side can ask for an additional task. The provider answers with a quote, and the task becomes its own booking with its own payment, its own clock and its own payout. Work on the additional task starts only once it is accepted and paid; until then only the original job is owed. If the original booking is cancelled, its paid additional tasks are cancelled with it by the same rule. An additional task is reviewed together with its job.`,
      titleDe: 'Zusatzaufgaben',
      bodyDe: `Solange ein bezahlter Auftrag offen ist, kann jede Seite eine Zusatzaufgabe anfragen. Der Anbieter antwortet mit einem Angebot, und die Aufgabe wird eine eigene Buchung mit eigener Zahlung, eigener Frist und eigener Auszahlung. Die Arbeit an der Zusatzaufgabe beginnt erst, wenn sie angenommen und bezahlt ist; bis dahin ist nur der ursprüngliche Auftrag geschuldet. Wird die ursprüngliche Buchung storniert, werden ihre bezahlten Zusatzaufgaben nach derselben Regel mit storniert. Eine Zusatzaufgabe wird gemeinsam mit ihrem Auftrag bewertet.`,
    },
    {
      slug: 'stopping-a-job',
      sort: 120,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Stopping a job',
      bodyEn: `Once a paid job has started, either side can stop it halfway with "Stop the job". No money moves at that moment. The provider then states how much has been earned, from nothing up to the full price. If the customer agrees, that amount is paid to the provider (minus the commission) and the rest goes back to the customer; if the customer disagrees, our team decides. If the customer does not answer within ${STOP_ANSWER_DAYS} days, our team decides as well.`,
      titleDe: 'Einen Auftrag stoppen',
      bodyDe: `Sobald ein bezahlter Auftrag begonnen hat, kann jede Seite ihn zwischendurch mit „Auftrag abbrechen“ stoppen. In diesem Moment wird kein Geld bewegt. Der Anbieter nennt dann, wie viel verdient wurde, von nichts bis zum vollen Preis. Stimmt der Kunde zu, wird dieser Betrag an den Anbieter gezahlt (abzüglich der Provision) und der Rest geht an den Kunden zurück; stimmt der Kunde nicht zu, entscheidet unser Team. Antwortet der Kunde nicht innerhalb von ${STOP_ANSWER_DAYS} Tagen, entscheidet ebenfalls unser Team.`,
    },
    {
      slug: 'no-show',
      sort: 130,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'When someone does not turn up',
      bodyEn: `From the start time on, either side can report that the other did not turn up. The other side then has ${NO_SHOW_OBJECTION_HOURS} hours to object or to accept the report; without an objection the report stands, and if the other side objects, our team decides. If the customer did not turn up, the provider gets the full price minus the commission. If the provider did not turn up, the customer gets everything back. The first time within 12 months the provider gets a warning; the second time our team is notified and can suspend the profile for a limited time. These automatic steps run once a day.`,
      titleDe: 'Wenn jemand nicht erscheint',
      bodyDe: `Ab dem Beginn kann jede Seite melden, dass die andere nicht erschienen ist. Die andere Seite hat dann ${NO_SHOW_OBJECTION_HOURS} Stunden Zeit, zu widersprechen oder die Meldung anzunehmen; ohne Widerspruch gilt die Meldung, und bei einem Widerspruch entscheidet unser Team. Ist der Kunde nicht erschienen, bekommt der Anbieter den vollen Preis abzüglich der Provision. Ist der Anbieter nicht erschienen, bekommt der Kunde alles zurück. Beim ersten Mal innerhalb von 12 Monaten erhält der Anbieter eine Verwarnung; beim zweiten Mal wird unser Team informiert und kann das Profil für eine begrenzte Zeit sperren. Diese automatischen Schritte laufen einmal am Tag.`,
    },
    {
      slug: 'reporting-a-problem',
      sort: 140,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Reporting a problem (disputes)',
      bodyEn: `After the provider tapped "Job finished", either side can report a problem until the ${CONFIRM_DAYS} days run out, and after a stopped job until an amount is agreed. A problem report freezes the payment: no money moves until our team has decided. Our team decides within ${DISPUTE_DECISION_WORKING_DAYS} working days (Monday to Friday; public holidays are not counted), gives both sides a written reason, and either pays the provider in full, pays a part, or refunds the customer in full. If nobody acts within ${NO_ACTION_STAFF_DAYS} days after the end of a job, it also goes to our team. Reports and disputes exist only for jobs booked in the app.`,
      titleDe: 'Ein Problem melden (Streitfälle)',
      bodyDe: `Nachdem der Anbieter auf „Auftrag erledigt“ getippt hat, kann jede Seite ein Problem melden, bis die ${CONFIRM_DAYS} Tage ablaufen, und nach einem gestoppten Auftrag, bis ein Betrag vereinbart ist. Eine Problemmeldung hält die Zahlung an: Es wird kein Geld bewegt, bis unser Team entschieden hat. Unser Team entscheidet innerhalb von ${DISPUTE_DECISION_WORKING_DAYS} Arbeitstagen (Montag bis Freitag; Feiertage werden nicht abgezogen), nennt beiden Seiten eine schriftliche Begründung und zahlt entweder den vollen Betrag an den Anbieter, einen Teil davon oder erstattet dem Kunden alles. Handelt innerhalb von ${NO_ACTION_STAFF_DAYS} Tagen nach dem Ende eines Auftrags niemand, geht er ebenfalls an unser Team. Meldungen und Streitfälle gibt es nur für Aufträge, die in der App gebucht wurden.`,
    },
    {
      slug: 'reviews',
      sort: 150,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Reviews',
      bodyEn: `After a completed job, both sides can give 1 to 5 stars and a few words, once, within ${REVIEW_VISIBLE_DAYS} days. Reviews are written blind: the other side sees yours once both reviews are in, or ${REVIEW_VISIBLE_DAYS} days after the job. You can change your review until it is shown, but for ${REVIEW_EDIT_DAYS} days at the most. Only completed jobs can be reviewed, so there are no reviews without a job. Our team can hide a review that breaks the rules; then only its author sees that it is hidden.`,
      titleDe: 'Bewertungen',
      bodyDe: `Nach einem abgeschlossenen Auftrag können beide Seiten 1 bis 5 Sterne und ein paar Worte abgeben, einmal, innerhalb von ${REVIEW_VISIBLE_DAYS} Tagen. Bewertungen werden blind geschrieben: Die andere Seite sieht deine, sobald beide Bewertungen vorliegen, oder ${REVIEW_VISIBLE_DAYS} Tage nach dem Auftrag. Du kannst deine Bewertung ändern, bis sie angezeigt wird, höchstens aber ${REVIEW_EDIT_DAYS} Tage lang. Nur abgeschlossene Aufträge können bewertet werden, also gibt es keine Bewertungen ohne Auftrag. Unser Team kann eine Bewertung ausblenden, die gegen die Regeln verstößt; dann sieht nur ihr Autor, dass sie ausgeblendet ist.`,
    },
    {
      slug: 'invoices-and-receipts',
      sort: 160,
      group: 'booking-and-paying',
      approved: true,
      titleEn: 'Invoices and receipts',
      bodyEn: `An invoice or receipt is made in the provider's name, with the provider's own numbering, once the job is settled; it is not made at the moment of payment, and a booking that ended in a full refund gets none. You find yours as a PDF under "Invoices" in the Jobs tab. Providers can also export all their documents of one year as a table (CSV) in the My business tab. While payments are in test mode, every number starts with "TEST-" and the PDF carries a test mark, so these are not real invoices. For now the app treats every provider as a private person; do not expect VAT invoices from businesses yet.`,
      titleDe: 'Rechnungen und Quittungen',
      bodyDe: `Eine Rechnung oder Quittung wird im Namen des Anbieters mit seiner eigenen Nummerierung erstellt, sobald der Auftrag abgerechnet ist; sie entsteht nicht im Moment der Zahlung, und eine Buchung, die mit einer vollständigen Rückerstattung endete, bekommt keine. Deine findest du als PDF unter „Rechnungen“ im Reiter „Aufträge“. Anbieter können außerdem alle ihre Dokumente eines Jahres im Reiter „Mein Geschäft“ als Tabelle (CSV) exportieren. Solange Zahlungen im Testmodus laufen, beginnt jede Nummer mit „TEST-“ und das PDF trägt einen Testvermerk, es sind also keine echten Rechnungen. Im Moment behandelt die App jeden Anbieter als Privatperson; erwarte daher noch keine Umsatzsteuer-Rechnungen von Unternehmen.`,
    },
    {
      slug: 'provider-setup',
      sort: 170,
      group: 'providers',
      approved: true,
      titleEn: 'Setting up as a provider',
      bodyEn: `Tap "Offer services" in Account to create your provider profile; you then find it in the My business tab. To publish it you need your name, at least one service with a category and price type, the provider type (a business also needs a business name and a legal notice), at least one strength, at least one skill, your postcode and a service radius; a picture and an experience text are optional. You can add up to ${MAX_PORTFOLIO_PHOTOS} portfolio photos and ${MAX_PROVIDER_REFERENCES} past jobs. Each service goes live as soon as the documents required for its category are approved. Documents are JPEG, PNG, WEBP or PDF files of ${DOC_MB} MB at the most.`,
      titleDe: 'Als Anbieter starten',
      bodyDe: `Tippe im Konto auf „Leistungen anbieten“, um dein Anbieterprofil anzulegen; du findest es dann im Reiter „Mein Geschäft“. Zum Veröffentlichen brauchst du deinen Namen, mindestens eine Leistung mit Kategorie und Preisart, die Anbieterart (ein Unternehmen braucht außerdem einen Firmennamen und ein Impressum), mindestens eine Stärke, mindestens eine Fähigkeit, deine Postleitzahl und einen Einsatzradius; ein Bild und ein Erfahrungstext sind freiwillig. Du kannst bis zu ${MAX_PORTFOLIO_PHOTOS} Portfolio-Fotos und ${MAX_PROVIDER_REFERENCES} frühere Aufträge hinzufügen. Jede Leistung geht online, sobald die für ihre Kategorie nötigen Nachweise freigegeben sind. Nachweise sind JPEG-, PNG-, WEBP- oder PDF-Dateien mit höchstens ${String(DOC_MB).replace('.', ',')} MB.`,
    },
    {
      slug: 'checked-and-verified',
      sort: 180,
      group: 'providers',
      approved: true,
      titleEn: '"Checked documents" and "Verified"',
      bodyEn: `These are two different things on a provider's page. "Checked documents" lists the names of the documents of that provider that have been approved, for example Photo ID; customers see only the names, never the documents. "Verified" means that the provider has finished the payout set-up with Stripe, our payment partner, so that payments are possible; it is shown only while payments are switched on. Your documents are visible only to you and our team. A photo ID image is deleted ${ID_IMAGE_KEEP_DAYS} days after it was checked, and at once when you delete your account.`,
      titleDe: '„Geprüfte Nachweise“ und „Verifiziert“',
      bodyDe: `Das sind zwei verschiedene Dinge auf der Seite eines Anbieters. „Geprüfte Nachweise“ nennt die Namen der Nachweise dieses Anbieters, die freigegeben wurden, zum Beispiel Ausweis; Kunden sehen nur die Namen, nie die Dokumente. „Verifiziert“ bedeutet, dass der Anbieter die Einrichtung der Auszahlung bei Stripe, unserem Zahlungspartner, abgeschlossen hat, sodass Zahlungen möglich sind; es wird nur angezeigt, solange Zahlungen eingeschaltet sind. Deine Dokumente sind nur für dich und unser Team sichtbar. Ein Ausweisbild wird ${ID_IMAGE_KEEP_DAYS} Tage nach der Prüfung gelöscht und sofort, wenn du dein Konto löschst.`,
    },
    {
      slug: 'payout-setup',
      sort: 190,
      group: 'providers',
      approved: true,
      titleEn: 'Setting up payouts',
      bodyEn: `While payments are switched on, you can send quotes and accept bookings only after you have set up payouts with Stripe, which asks for your identity, address and bank account. You also have to agree that the platform issues invoices and receipts in your name; if you are a small business (Kleinunternehmer) or a business, you enter a tax number or VAT ID as well. A customer who finds you before you are ready can tap "Notify me when available", and we tell you that customers are waiting, without names, at most once every ${CUSTOMERS_WAITING_NOTICE_HOURS} hours. For now payouts run in test mode only.`,
      titleDe: 'Auszahlung einrichten',
      bodyDe: `Solange Zahlungen eingeschaltet sind, kannst du Angebote schicken und Buchungen annehmen, nachdem du die Auszahlung bei Stripe eingerichtet hast; Stripe fragt nach deiner Identität, deiner Adresse und deinem Bankkonto. Außerdem musst du zustimmen, dass die Plattform Rechnungen und Quittungen in deinem Namen ausstellt; bist du Kleinunternehmer oder ein Unternehmen, gibst du zusätzlich eine Steuernummer oder USt-IdNr. an. Ein Kunde, der dich findet, bevor du bereit bist, kann „Benachrichtige mich, wenn verfügbar“ antippen, und wir sagen dir ohne Namen, dass Kunden warten, höchstens einmal alle ${CUSTOMERS_WAITING_NOTICE_HOURS} Stunden. Im Moment laufen Auszahlungen nur im Testmodus.`,
    },
    {
      slug: 'commission-and-fees',
      sort: 200,
      group: 'money-and-fees',
      approved: true,
      titleEn: 'Commission and fees',
      bodyEn: `Customers pay no fee on top of the price. Providers pay ${COMMISSION} percent commission of the booking amount, payment fees included, and only when a job is paid; there is no lead fee and no subscription. The commission is deducted from the provider's payout. If a customer cancels late, it applies only to the ${LATE} percent share the provider receives; on a full refund there is none. Before sending a quote, the provider sees what they will receive after the commission. The rate of ${COMMISSION} percent is provisional.`,
      titleDe: 'Provision und Gebühren',
      bodyDe: `Kunden zahlen keine Gebühr zusätzlich zum Preis. Anbieter zahlen ${COMMISSION} Prozent Provision auf den Buchungsbetrag, Zahlungsgebühren inbegriffen, und nur, wenn ein Auftrag bezahlt wird; es gibt keine Gebühr pro Kontakt und kein Abo. Die Provision wird von der Auszahlung des Anbieters abgezogen. Storniert ein Kunde spät, gilt sie nur für den Anteil von ${LATE} Prozent, den der Anbieter erhält; bei einer vollen Rückerstattung fällt keine an. Vor dem Senden eines Angebots sieht der Anbieter, was er nach der Provision erhält. Der Satz von ${COMMISSION} Prozent ist vorläufig.`,
    },
    {
      slug: 'commission-invoices',
      sort: 210,
      group: 'money-and-fees',
      approved: true,
      titleEn: 'Commission invoices',
      bodyEn: `For each month in which KANDO kept commission, providers get one commission invoice from the platform, listing the commission per booking. You find them as PDFs under "Commission invoices" in the My business tab. They are separate from the invoices and receipts that are made in your name for your customers. In test mode their numbers start with "TEST-" and they are not real invoices.`,
      titleDe: 'Provisionsrechnungen',
      bodyDe: `Für jeden Monat, in dem KANDO Provision einbehalten hat, bekommen Anbieter eine Provisionsrechnung von der Plattform, in der die Provision je Buchung aufgelistet ist. Du findest sie als PDF unter „Provisionsrechnungen“ im Reiter „Mein Geschäft“. Sie sind getrennt von den Rechnungen und Quittungen, die in deinem Namen für deine Kunden erstellt werden. Im Testmodus beginnen ihre Nummern mit „TEST-“, und es sind keine echten Rechnungen.`,
    },
    {
      slug: 'money-strip',
      sort: 220,
      group: 'money-and-fees',
      approved: true,
      titleEn: 'The money strip for providers',
      bodyEn: `Providers see three amounts, always after commission and payment fees. "Received this month" is money already released to you this month, by the calendar of your device. "On its way" is money from paid jobs that is not released yet and has no problem. "On hold" is paid money held back because of an open dispute, a reported no-show or a money problem our team is looking at. Jobs the customer has not paid yet, stopped jobs until their payout is released, and refunded bookings are not counted.`,
      titleDe: 'Die Geldübersicht für Anbieter',
      bodyDe: `Anbieter sehen drei Beträge, immer nach Provision und Zahlungsgebühren. „Diesen Monat erhalten“ ist Geld, das in diesem Monat schon an dich freigegeben wurde, nach dem Kalender deines Geräts. „Unterwegs“ ist Geld aus bezahlten Aufträgen, das noch nicht freigegeben ist und bei dem kein Problem vorliegt. „Zurückgehalten“ ist bezahltes Geld, das wegen eines offenen Streitfalls, eines gemeldeten Nichterscheinens oder eines Geldproblems, das unser Team prüft, zurückgehalten wird. Aufträge, die der Kunde noch nicht bezahlt hat, gestoppte Aufträge bis zur Freigabe ihrer Auszahlung und erstattete Buchungen werden nicht gezählt.`,
    },
    {
      slug: 'chat-and-contact-details',
      sort: 230,
      group: 'safety-and-rules',
      approved: true,
      titleEn: 'Chat and contact details',
      bodyEn: `Once a request exists, you and the provider can write to each other in its chat; a message can be up to ${MAX_MESSAGE_CHARS} characters. Contact details such as phone numbers, email addresses and links are refused, also when written out in words, so that the conversation stays in the app. This is an automatic check and not perfect. Payments, reviews and our help with disputes apply only to what happens in the app. Either side can block the other in a chat and can report a message.`,
      titleDe: 'Chat und Kontaktdaten',
      bodyDe: `Sobald eine Anfrage besteht, könnt ihr, du und der Anbieter, euch in ihrem Chat schreiben; eine Nachricht darf bis zu ${MAX_MESSAGE_CHARS} Zeichen lang sein. Kontaktdaten wie Telefonnummern, E-Mail-Adressen und Links werden abgelehnt, auch wenn sie in Worten ausgeschrieben sind, damit das Gespräch in der App bleibt. Das ist eine automatische Prüfung und nicht perfekt. Zahlung, Bewertungen und unsere Hilfe bei Streitfällen gelten nur für das, was in der App geschieht. Jede Seite kann die andere im Chat blockieren und eine Nachricht melden.`,
    },
    {
      slug: 'notifications',
      sort: 240,
      group: 'using-the-app',
      approved: true,
      titleEn: 'Notifications',
      bodyEn: `You get notices about your requests, quotes, bookings and payments in the app and by email. On your phone you can also get push notifications, if your phone allows them. In Account you can switch push notifications for chat messages and for reminders on or off; all other push notifications are always sent. A new chat message is emailed only if a push would not reach you, and at most once every ${CHAT_EMAIL_THROTTLE_MINUTES} minutes per conversation.`,
      titleDe: 'Benachrichtigungen',
      bodyDe: `Du bekommst Hinweise zu deinen Anfragen, Angeboten, Buchungen und Zahlungen in der App und per E-Mail. Auf deinem Handy kannst du außerdem Push-Benachrichtigungen erhalten, wenn dein Handy sie erlaubt. Im Konto kannst du Push-Benachrichtigungen für Chatnachrichten und für Erinnerungen ein- oder ausschalten; alle anderen Push-Benachrichtigungen werden immer gesendet. Eine neue Chatnachricht kommt nur dann per E-Mail, wenn eine Push-Nachricht dich nicht erreichen würde, und höchstens einmal alle ${CHAT_EMAIL_THROTTLE_MINUTES} Minuten pro Unterhaltung.`,
    },
    {
      slug: 'languages',
      sort: 250,
      group: 'using-the-app',
      approved: true,
      titleEn: 'Languages',
      bodyEn: `The app is available in German and English. It starts in your phone's language, you can change it with the language switch (in Account and on the sign-in screens), and the app remembers your choice. German is the main language. Texts that providers write themselves stay in the language they were written in; on provider pages a "Translate" button shows an automatic translation, marked as automatically translated (AI), with a link to the original.`,
      titleDe: 'Sprachen',
      bodyDe: `Die App gibt es auf Deutsch und auf Englisch. Sie startet in der Sprache deines Handys, du kannst sie mit dem Sprachschalter ändern (im Konto und auf den Anmeldeseiten), und die App merkt sich deine Wahl. Deutsch ist die Hauptsprache. Texte, die Anbieter selbst schreiben, bleiben in der Sprache, in der sie geschrieben wurden; auf Anbieterseiten zeigt die Schaltfläche „Übersetzen“ eine automatische Übersetzung, die als automatisch übersetzt (KI) gekennzeichnet ist, mit einem Link zum Original.`,
    },
    {
      slug: 'who-sees-your-data',
      sort: 260,
      group: 'your-data',
      approved: true,
      titleEn: 'Who sees your data',
      bodyEn: `Your postcode, street and city are private. A provider sees a customer's street and city only after the customer has accepted that provider's quote, and only for on-site jobs. A provider's public page shows the public name (first name and the first letter of the surname, or the business name), picture, texts, services, prices, area and past jobs. Your documents are visible only to you and our team. No analytics or advertising tool is built into the app or the website.`,
      titleDe: 'Wer deine Daten sieht',
      bodyDe: `Deine Postleitzahl, Straße und Stadt sind privat. Ein Anbieter sieht Straße und Stadt eines Kunden erst, nachdem der Kunde das Angebot dieses Anbieters angenommen hat, und nur bei Einsätzen vor Ort. Die öffentliche Seite eines Anbieters zeigt den öffentlichen Namen (Vorname und erster Buchstabe des Nachnamens oder den Firmennamen), Bild, Texte, Leistungen, Preise, Gebiet und frühere Aufträge. Deine Dokumente sind nur für dich und unser Team sichtbar. In die App und die Website ist kein Analyse- oder Werbewerkzeug eingebaut.`,
    },
    {
      slug: 'export-your-data',
      sort: 270,
      group: 'your-data',
      approved: true,
      titleEn: 'Exporting your data',
      bodyEn: `In Account, under "My data", you can export your account details, profile, files, requests, quotes, bookings and your messages as one document, as JSON or as a CSV table for a spreadsheet. The export also lists your reviews, notices and the results of automatic document checks. It does not contain your invoices and receipts, the record of money movements or disputes; write to us if you need those.`,
      titleDe: 'Deine Daten exportieren',
      bodyDe: `Im Konto unter „Meine Daten“ kannst du deine Kontodaten, dein Profil, deine Dateien, Anfragen, Angebote, Buchungen und deine Nachrichten als ein Dokument exportieren, als JSON oder als CSV-Tabelle für eine Tabellenkalkulation. Der Export enthält auch deine Bewertungen, Hinweise und die Ergebnisse automatischer Dokumentenprüfungen. Er enthält nicht deine Rechnungen und Quittungen, die Aufzeichnung der Geldbewegungen und Streitfälle; schreibe uns, wenn du diese brauchst.`,
    },
    {
      slug: 'delete-your-account',
      sort: 280,
      group: 'your-data',
      approved: true,
      titleEn: 'Deleting your account',
      bodyEn: `In Account you can delete your account; you confirm with your password. It is refused while a booking still holds money or an invoice is still missing. It deletes your profile with services and references, photos, files, messages, requests, quotes, bookings and reviews at once, and the chats too, so the other side loses them as well. Your photo ID image is deleted with the account. ${keepEn} Invoices, commission invoices and payment records we must keep by law are kept.`,
      titleDe: 'Dein Konto löschen',
      bodyDe: `Im Konto kannst du dein Konto löschen; du bestätigst mit deinem Passwort. Das wird abgelehnt, solange eine Buchung noch Geld hält oder eine Rechnung noch fehlt. Gelöscht werden sofort dein Profil mit Leistungen und Referenzen, Fotos, Dateien, Nachrichten, Anfragen, Angebote, Buchungen und Bewertungen, und auch die Chats, sodass die andere Seite sie ebenfalls verliert. Dein Ausweisbild wird mit dem Konto gelöscht. ${keepDe} Rechnungen, Provisionsrechnungen und Zahlungsbelege, die wir gesetzlich aufbewahren müssen, bleiben erhalten.`,
    },
  ]
}
