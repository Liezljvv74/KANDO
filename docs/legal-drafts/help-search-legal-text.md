# Help search (AI): text for the Terms and the Privacy Policy

Drafts for the owner to paste into the pages in `/admin` (German is the main text, English the translation), after the lawyer's review. The code does not edit the legal pages or the DPIA. Same approach as the document check (`ai-document-check-legal-text.md`): everything about the AI is in the Terms accepted at sign-up; nothing on screen, because the search returns our own Help texts, not AI-written text.

What the code does (so the lines below are true): the text typed into the Help search box (2 to 100 characters) is sent from our server, never from the phone, to an embedding model reached through OpenRouter (`openai/text-embedding-3-small`), with the settings "do not store, do not train" (`data_collection: deny`, `zdr: true`, no other provider). The model returns a list of numbers; we compare it with the stored numbers of our Help topics. The search text and the numbers are not stored or logged. Per search we keep one counter row for 24 hours (a salted hash of the IP address, or the user id when signed in) to limit use.

## 1. Terms and Conditions: add to the section on AI / automated checks

**English**
> The Help search uses an AI language service. When you type a search into the Help, your text is sent to this service, through our provider OpenRouter, only to find the Help topics that match its meaning. The service returns numbers, not text; the topics shown are always our own texts. We do not store your search text. Do not type personal data into the search box.

**Deutsch**
> Die Hilfe-Suche nutzt einen KI-Sprachdienst. Wenn du in der Hilfe etwas suchst, wird dein Text über unseren Dienstleister OpenRouter an diesen Dienst gesendet, nur um die Hilfethemen zu finden, die inhaltlich passen. Der Dienst gibt Zahlen zurück, keinen Text; die angezeigten Themen sind immer unsere eigenen Texte. Wir speichern deinen Suchtext nicht. Bitte gib in das Suchfeld keine persönlichen Daten ein.

## 2. Privacy Policy: data table row (section 2) and processors (section 3)

**English, table row:** Text you type into the Help search box | Find the Help topics that fit your words, also by meaning (an embedding service reached through OpenRouter); not stored or logged by us | Art. 6(1)(f) GDPR, legitimate interest in a working Help.
**Deutsch, Tabellenzeile:** Text, den du in das Suchfeld der Hilfe eingibst | Passende Hilfethemen finden, auch nach Bedeutung (ein Einbettungsdienst über OpenRouter); von uns nicht gespeichert oder protokolliert | Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an einer funktionierenden Hilfe.

**English, section 3 (processors):** OpenRouter and the AI model provider behind it receive the text of a Help search (see the Terms). Names, emails, addresses and documents are never sent.
**Deutsch, Abschnitt 3 (Auftragsverarbeiter):** OpenRouter und der dahinterstehende KI-Anbieter erhalten den Text einer Hilfe-Suche (siehe AGB). Namen, E-Mail-Adressen, Adressen und Dokumente werden nie gesendet.

## 3. Privacy Policy: how long we keep data (section 6)

**English:** Help search: we do not store the text you type. To limit how often the search can be used we keep one counter entry per search for 24 hours: a salted hash of your IP address (not the address itself) or, if you are signed in, your user id.
**Deutsch:** Hilfe-Suche: Den eingegebenen Text speichern wir nicht. Um zu begrenzen, wie oft gesucht werden kann, speichern wir pro Suche 24 Stunden lang einen Zähleintrag: einen gesalzenen Hash deiner IP-Adresse (nicht die Adresse selbst) oder, wenn du angemeldet bist, deine Nutzer-ID.

## Notes for the DPIA review

- "Delete my data": nothing about the search text is stored, so there is nothing to delete for it. The counter rows of a signed-in person (`translation_requests`, key `help-search:user:<id>`) are deleted with the account (tested in `account-delete.int.spec.ts`); anonymous rows hold only a salted hash and disappear after 24 hours.
- Article 50 label: the search returns our own Help texts, so no "AI-written" label is shown; the DPIA review decides whether that stays so.
- Before launch: confirm OpenRouter's and the model provider's data use and region (the same open point as for translation).

## Note on the stored search vectors (added 10 November 2026)
To avoid asking the embedding model the same question twice, `help_search_cache` keeps, per language and model, a sha256 hash of the lower-cased query and its vector (list of numbers). The query text itself is not stored and the row has no user or address. Rows older than 30 days are deleted by the daily clean-up. Nothing in it is linked to a person, so the account deletion does not need to touch it; the lawyer to confirm that a hash and a vector of a short query are not personal data.
