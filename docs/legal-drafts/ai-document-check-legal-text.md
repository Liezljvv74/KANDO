# Automated checks of documents (AI): text for the Terms and the Privacy Policy

Status: DRAFT of 3 November 2026 for the owner's review (MVP plan step 2.4). Not legal advice. German is the main language; the English is the meaning of the German and needs the owner's English review.

Owner decision of 3 November 2026: all information about the AI used is in the terms and conditions the user accepts at sign-up, and the privacy text names the provider category and region. **Nothing about the document check is shown on screen** (not on the upload screen, not in the app). The text below is for the pages that staff edit in the back office (Pages: terms and privacy); it is not in the app code.

Things in [square brackets] are for the owner or the lawyer to confirm. The text states only what the plan and the built feature do.

## 1. Terms and Conditions: new section (after "5. Document checks and publishing")

### English

**5a. Automated checks of documents (AI)**
1. When you upload a document for verification (for example a photo ID, an insurance certificate or a trade registration), it may be read by an AI service as an aid to our check. This is a third-party AI model service that we reach through OpenRouter. The data is processed in the EU where this is available [confirm with OpenRouter and the chosen model]. We send the document to the service once, for this check, with settings that ask for no training on your data and no retention of it.
2. The AI does not take over the decision. If it finds no problem and is sure enough, the document may be approved automatically. If it finds a problem, is not sure, or is not available, a person on our team decides. The AI never rejects a document: only a person does. A person also looks at a random sample, about one in ten, of the documents the AI would have approved.
3. What we keep of the AI result: only its verdict (no problem found, or problem found), how sure it was and, when it did not approve, a short reason. We do not keep ID numbers, dates of birth, addresses or other content read from the document. The document itself stays in our private storage, visible only to you and our staff.
4. The image of a photo ID is deleted 30 days after the check has finished, and at the latest when you delete your account. Other documents are kept as described in section 6.
5. You can ask what the AI result was: "Your data" in the app under Account (export as JSON or CSV) includes it. "Delete my account" deletes it. For anything else, for example if you want a person to look at a decision again, write to info@skillweb.space.

### Deutsch

**5a. Automatisierte Prüfung von Dokumenten (KI)**
1. Wenn du ein Dokument zur Prüfung hochlädst (zum Beispiel einen Ausweis, einen Versicherungsnachweis oder eine Gewerbeanmeldung), kann es von einem KI-Dienst als Hilfe für unsere Prüfung gelesen werden. Das ist ein KI-Modelldienst eines Drittanbieters, den wir über OpenRouter nutzen. Die Daten werden, wo verfügbar, in der EU verarbeitet [mit OpenRouter und dem gewählten Modell bestätigen]. Wir senden das Dokument nur einmal für diese Prüfung an den Dienst, mit Einstellungen, die verlangen, dass deine Daten nicht zum Training genutzt und nicht gespeichert werden.
2. Die KI trifft die Entscheidung nicht allein. Findet sie kein Problem und ist sie sich sicher genug, kann das Dokument automatisch freigegeben werden. Findet sie ein Problem, ist sie sich unsicher oder ist der Dienst nicht erreichbar, entscheidet eine Person aus unserem Team. Die KI weist ein Dokument nie zurück: das tut nur eine Person. Eine Person sieht sich außerdem eine zufällige Stichprobe an, etwa jedes zehnte der Dokumente, die die KI freigegeben hätte.
3. Vom Ergebnis der KI speichern wir nur die Einschätzung (kein Problem gefunden oder Problem gefunden), wie sicher sie war und, wenn sie nicht freigegeben hat, einen kurzen Grund. Wir speichern keine Ausweisnummern, Geburtsdaten, Adressen oder andere Inhalte, die aus dem Dokument gelesen wurden. Das Dokument selbst bleibt in unserem privaten Speicher, sichtbar nur für dich und unser Team.
4. Das Bild eines Ausweises wird 30 Tage nach Abschluss der Prüfung gelöscht, spätestens wenn du dein Konto löschst. Andere Dokumente werden aufbewahrt, wie in Abschnitt 6 beschrieben.
5. Du kannst nachsehen, wie das Ergebnis der KI war: "Deine Daten" in der App unter Konto (Export als JSON oder CSV) enthält es. "Mein Konto löschen" löscht es. Für alles andere, zum Beispiel wenn eine Person eine Entscheidung noch einmal ansehen soll, schreibe an info@skillweb.space.

## 2. Privacy Policy: additions

### English

**New section 4a. Automated checks of documents (AI)**
When you upload a document for verification, it may be read by an AI model service as an aid to our staff check. The service is a third-party AI model provider reached through OpenRouter (our processor, under a data processing agreement [confirm signed]); data is processed in the EU where available [confirm]. The document is sent once, with the provider's settings for no training and no retention. We store only the verdict, the confidence and, when a person must step in, a short reason that contains no ID number, date of birth or address; nothing read from the document is stored. A person decides every case the AI does not clearly approve, and checks a random sample of the rest. Photo ID images are deleted 30 days after the check has finished and with your account. Legal basis: Art. 6(1)(b) and (f) GDPR [confirm with the lawyer, with the data protection impact assessment]. You can export the results ("Your data" under Account) and delete them ("Delete my account"); you can also write to info@skillweb.space.

**Table in section 2, new row**

| Data | Purpose | Legal basis (GDPR) |
| --- | --- | --- |
| Result of the AI check of a document: verdict, confidence, short reason when not approved, date, whether it was a spot check | Help our staff check documents; approve clearly fine documents faster | Art. 6(1)(b) and (f) [confirm] |

**Section 3 (processors):** the line "OpenRouter and the AI model provider behind it (translation, see section 4)" becomes "(translation, see section 4, and the check of documents, see section 4a)".

**Section 6 (retention), new point:** "AI results of documents: deleted with the document and with your account. Photo ID images: deleted 30 days after the check has finished."

### Deutsch

**Neuer Abschnitt 4a. Automatisierte Prüfung von Dokumenten (KI)**
Wenn du ein Dokument zur Prüfung hochlädst, kann es von einem KI-Modelldienst als Hilfe für die Prüfung durch unser Team gelesen werden. Der Dienst ist ein KI-Modellanbieter eines Drittanbieters, den wir über OpenRouter nutzen (unser Auftragsverarbeiter, mit Auftragsverarbeitungsvertrag [Abschluss bestätigen]); die Daten werden, wo verfügbar, in der EU verarbeitet [bestätigen]. Das Dokument wird einmal gesendet, mit den Einstellungen des Anbieters für kein Training und keine Speicherung. Wir speichern nur die Einschätzung, die Sicherheit und, wenn eine Person eingreifen muss, einen kurzen Grund ohne Ausweisnummer, Geburtsdatum oder Adresse; nichts aus dem Dokument wird gespeichert. Eine Person entscheidet jeden Fall, den die KI nicht eindeutig freigibt, und prüft eine zufällige Stichprobe der übrigen. Ausweisbilder werden 30 Tage nach Abschluss der Prüfung und mit deinem Konto gelöscht. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und f DSGVO [mit der Rechtsberatung und der Datenschutz-Folgenabschätzung bestätigen]. Du kannst die Ergebnisse exportieren ("Deine Daten" unter Konto) und löschen ("Mein Konto löschen"); du kannst auch an info@skillweb.space schreiben.

**Tabelle in Abschnitt 2, neue Zeile**

| Daten | Zweck | Rechtsgrundlage (DSGVO) |
| --- | --- | --- |
| Ergebnis der KI-Prüfung eines Dokuments: Einschätzung, Sicherheit, kurzer Grund bei Nichtfreigabe, Datum, ob es eine Stichprobe war | Unserem Team bei der Dokumentenprüfung helfen; eindeutig in Ordnung befundene Dokumente schneller freigeben | Art. 6 Abs. 1 lit. b und f [bestätigen] |

**Abschnitt 3 (Auftragsverarbeiter):** Die Zeile "OpenRouter und der KI-Modellanbieter dahinter (Übersetzung, siehe Abschnitt 4)" wird zu "(Übersetzung, siehe Abschnitt 4, und Prüfung von Dokumenten, siehe Abschnitt 4a)".

**Abschnitt 6 (Speicherdauer), neuer Punkt:** "KI-Ergebnisse zu Dokumenten: werden mit dem Dokument und mit deinem Konto gelöscht. Ausweisbilder: werden 30 Tage nach Abschluss der Prüfung gelöscht."

## 3. Open points for the owner

1. **Sign-up does not yet require accepting the Terms.** The sign-up screen (`apps/mobile/src/app/(auth)/sign-up.tsx`) has no checkbox and no link to the Terms or the Privacy Policy (the drafts list "a sign-up checkbox confirming age 18 and acceptance of the Terms and Privacy Policy is not built yet"). Without it, the AI information is not "accepted at sign-up". Smallest change: one checkbox "Ich habe die AGB und die Datenschutzerklärung gelesen und bin mindestens 18" with two links, sign-up button disabled until ticked, and the date of acceptance stored on the user row (one column and one write; not a few lines, so not built here).
2. The Terms and Privacy pages live in the database (back office, Pages), not in the repo: the text above has to be pasted in there (German as main text, English as translation) after the owner's review.
3. A confirmation that the chosen model's endpoint really keeps data in the EU, does not train and keeps nothing (the app asks for it; it cannot prove it).
4. The AI result contains a short reason; the Art. 22 GDPR safeguards (a person can look again) are met by the "write to us" line and by the rule that only a person rejects: the lawyer should confirm the wording.
