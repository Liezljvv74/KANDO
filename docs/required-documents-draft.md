# Required documents per category: draft for review

Status: owner decisions of 28 October 2026 recorded (section 3); the table in section 2 shows the result. The Excel version `required-documents-draft.xlsx` is the working copy. Not legal advice: have the German rules checked (trade law, craft regulations, child protection) before launch. Today the app only knows two document types (`police-certificate`, `permit`) and only Babysitting requires one.

How it works in the app: each category lists the documents a provider must submit before a service in that category can go live. A provider with services in several categories submits each needed document once. Staff (later helped by AI, see the README) approve or reject each document.

## 1. Proposed document types

| Key | Document | Who needs it | What the check looks at |
| --- | --- | --- | --- |
| `id-document` | Photo ID (ID card or passport, front and back) | All providers (know-your-trader record) | Name matches the profile, not expired, readable. Sensitive: see the DPIA |
| `trade-registration` | Gewerbeanmeldung (trade registration) or proof of freelance status (Freiberufler, e.g. tax office letter) | Providers who work commercially | Name or business name matches, activity fits the service, date |
| `liability-insurance` | Proof of business liability insurance (Betriebshaftpflicht) | Categories with risk of damage in a home or to people or animals | Insured person or company matches, covers the activity, still valid |
| `police-certificate` | Führungszeugnis. For child care the extended certificate (erweitertes Führungszeugnis, §30a BZRG) | Categories with unsupervised access to children, homes or keys | Issued to the provider, not older than 3 months, "no entries" |
| `hygiene-certificate` | Food hygiene instruction (Belehrung nach §43 Infektionsschutzgesetz) | Catering | Name, date, not older than the validity set by the authority |
| `food-business-registration` | Registration of the food business with the local authority (Lebensmittelunternehmer-Registrierung) | Catering (business) | Name, authority, date |
| `permit` | Local authority permit where the activity needs one (for example §11 Tierschutzgesetz for commercial dog care and training) | Dog walking, where the local authority requires it | Name, issuing authority, scope, date |
| `craft-qualification` | Meisterbrief or entry in the craft register (Handwerksrolle) | Only for craft trades that need it by law (see small repairs) | Name, trade, issuing chamber |

## 2. Proposed requirements per category

R = required, O = optional (shown as a badge when approved, not needed to go live), – = not needed.

| Category | id-document | trade-registration | liability-insurance | police-certificate | other |
| --- | --- | --- | --- | --- | --- |
| Photography | R | R | O | – | – |
| DJ | R | R | O | – | – |
| Catering | R | R | R | – | R hygiene-certificate; R food-business-registration |
| Digital services | R | R | O | – | – |
| Marketing | R | R | O | – | – |
| Management & consulting | R | R | O | – | – |
| Dog walking | R | R | R | O (recommended) | R permit where the local authority requires one (provider confirms in the form; staff check) |
| Babysitting | R | R (or freelance proof) | O | R (extended, §30a) | O first-aid course certificate |
| Cleaning | R | R | R | O (recommended) | – |
| Moving & house clearance | R | R | R | – | – |
| Assembly | R | R | R | – | – |
| Gardening | R | R | R | – | – |
| Small repairs | R | R | R | – | O craft-qualification (optional for now, to be made compulsory later) |
| Other services | R | R | O | – | Staff may ask for more case by case |

## 3. Owner decisions (28 October 2026)

1. **Photo ID:** required from every provider.
2. **Private persons:** submit their ID (in the trade-registration slot) for now; to be confirmed with the tax adviser before launch.
3. **Optional documents:** get a slot. An approved optional document shows as a badge on the profile; it is not needed to go live. (Changed from "leave out".)
4. **Police certificate for cleaning and dog walking:** recommended, as an optional slot with a badge.
5. **Craft trades:** the craft qualification (for example a Meisterbrief) is optional for Small repairs for now and can be made compulsory later. (Changed from compulsory.)

## 4. What changes in the app if you approve

- A requirement table per category (replaces the two hard-coded types), editable by staff in the back office. An optional kind is needed: an approved optional document shows as a badge. The police certificate is optional for cleaning and dog walking.
- The profile page's Documents card lists, per service, the documents still needed.
- The AI-assisted check (Stage A in the README) reads each document type with its own fixed list of fields and checks.
