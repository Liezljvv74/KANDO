# Legal text for Vercel Web Analytics and Speed Insights

Status: DRAFT, not yet in the back office. The production pages are not edited by code: the owner pastes these lines into the `datenschutz` page in `/admin` (German and English) when the pull request that adds the two tools is deployed. Not legal advice. The German was written by Claude from the English and needs a German speaker. Things in [square brackets] are for the owner or the lawyer.

What the code does: the public website (not `/admin`) loads Vercel Web Analytics (page views, visitors, referrer, country, device and browser) and Vercel Speed Insights (page load speed measured in the visitor's browser). Both are run by Vercel, our hosting provider. Per Vercel's documentation they use no cookies and store nothing on the visitor's device, and visitors are told apart by a hash that changes daily, not by an identifier that follows a person from day to day. [Confirm against Vercel's current documentation and its data processing agreement before publishing.]

## Privacy policy, section 2: new table row

### English

| Visit statistics and page speed on our website (page address, referrer, country, device and browser type, load times; no cookies, no IP address stored, no profile of you across days) [CONFIRM with Vercel's documentation and DPA: no cookies, no IP address stored, no tracking across days; remove this note when done] | Understand how the website is used and keep it fast | Art. 6(1)(f) legitimate interest in running and improving the service |

### Deutsch

| Besuchsstatistik und Ladegeschwindigkeit auf unserer Website (Seitenadresse, Herkunftsseite, Land, Geräte- und Browsertyp, Ladezeiten; keine Cookies, keine gespeicherte IP-Adresse, kein tagesübergreifendes Profil von dir) [PRÜFEN laut Vercel-Dokumentation und AVV: keine Cookies, keine IP-Adresse gespeichert, kein Tracking über Tage; Hinweis danach entfernen] | Verstehen, wie die Website genutzt wird, und sie schnell halten | Art. 6(1)(f) berechtigtes Interesse am Betrieb und an der Verbesserung des Dienstes |

## Privacy policy, section 2: replace the sentence under the table

Old: "We do not use advertising, tracking or analytics cookies. We use only what is needed to keep you logged in. [Confirm when the website gets analytics: then add a consent banner.]"

### English

We do not use advertising cookies or tracking cookies, and we do not set cookies for statistics. The website uses Vercel's own visit statistics and speed measurement, which work without cookies and without storing anything on your device [CONFIRM with Vercel]. The only cookies are those needed to keep you logged in. The back office (staff only) has no statistics.

### Deutsch

Wir verwenden keine Werbe- oder Tracking-Cookies und setzen keine Cookies für Statistiken. Die Website nutzt die Besuchsstatistik und die Geschwindigkeitsmessung von Vercel, die ohne Cookies und ohne Speicherung auf deinem Gerät arbeiten [PRÜFEN bei Vercel]. Cookies gibt es nur, soweit sie nötig sind, damit du angemeldet bleibst. Das Back Office (nur für Mitarbeitende) hat keine Statistik.

## Privacy policy, section 3: Vercel line

Change "Vercel (hosting of the website and the app's server; Frankfurt region)" to:

- English: Vercel (hosting of the website and the app's server, Frankfurt region; also the visit statistics and speed measurement of the website).
- Deutsch: Vercel (Hosting der Website und des App-Servers, Region Frankfurt; außerdem Besuchsstatistik und Geschwindigkeitsmessung der Website).

## Privacy policy, section 6: retention line

- English: Visit statistics and speed measurements: kept by Vercel in anonymous form for [its retention period, to be confirmed]; they cannot be linked to your account.
- Deutsch: Besuchsstatistik und Geschwindigkeitsmessungen: werden von Vercel in anonymer Form für [Aufbewahrungsdauer, noch zu bestätigen] gespeichert; sie lassen sich nicht mit deinem Konto verknüpfen.

## Open items for the owner or the lawyer

1. Confirm that no consent banner is needed: Vercel states that Web Analytics uses no cookies and no local storage. If the lawyer reads the German rules (TDDDG section 25) more strictly for the speed measurement, a banner would be needed before the tools run.
2. Confirm the data processing agreement with Vercel covers these two services, and the retention periods.
3. If the team later adds analytics to `/admin`, update the last sentence of the replacement text.
