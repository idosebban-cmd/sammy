# Sammy

A private web app for Ido and Helen to understand and support their son: one place to capture school emails, observations and documents, get grounded and practical AI analysis, confirm what's worth keeping, and follow through on actions.

**The core loop:** add information → receive useful analysis → confirm what to save → track actions and progress.

## What's in this version (Phase 1)

| Area | What works |
|---|---|
| **Smart Input** (`/add`) | Paste an email, describe an observation, upload a PDF/DOCX, or ask a question. The original is always saved verbatim with its date. |
| **AI analysis** (`/entries/:id`) | A. What happened · B. What it might mean (each statement marked *fact from this submission*, *fact from Sammy's record* or *possible explanation*) · C. What we can do (2–4 recommendations) · D. Follow-up actions (explicit commitments vs suggestions) · E. What to remember. Every item can be edited, ticked or skipped. Nothing is saved to the record until a parent confirms. |
| **Dashboard** (`/`) | Needs attention (overdue / due this week), Upcoming (appointments + deadlines), Suggested next steps (kept recommendations, linked to their source), Recent activity, and a qualitative Progress snapshot. Records waiting for review are flagged. |
| **Actions** (`/actions`) | Shared tracker with owner (Ido, Helen, both, school, Local Authority, therapist, other), due date, status, priority, source link, notes and an automatic change history. Overdue/upcoming grouping and a nav badge for anything due within 3 days. |
| **Timeline & progress** (`/timeline`) | Chronological record by category, filterable by type, progress area and text. *Progress* tab groups entries by the seven development areas (no scores). *Interventions* tab tracks what's been tried and dated observations ("seems helpful / unclear / doesn't seem helpful"). |
| **Understanding Sammy** (`/sammy`) | Editable profile in nine sections, strengths first. Every entry shows whether it's a *professional finding*, *parent/school observation* or *AI hypothesis* (dashed amber), with its source. Archive or delete. |
| **Documents** (`/documents`) | PDF/DOCX upload to private storage. Text is extracted with page numbers (PDF) or section headings (DOCX) and indexed for search. Originals are never modified. |
| **Ask AI** (`/ask` + drawer on every page) | Conversational assistant that retrieves from the profile, timeline, actions, interventions, documents and earlier submissions on every turn, and cites them with links (e.g. the exact EHCP page). Says when evidence is thin. |
| **Settings** | AI provider consent, redaction list, export everything as JSON, delete chat history, change-history viewer and pruning, password and names. |

## Architecture

```
Browser (React + TypeScript + Tailwind, Vite)
  │  supabase-js with the user's session. All reads/writes go through row-level security.
  │  PDF/DOCX text extraction runs in the browser (pdf.js, mammoth). The original file goes to private storage.
  ▼
Supabase (choose London, eu-west-2, when you create the project)
  ├─ Postgres: schema + RLS in supabase/migrations
  ├─ Storage: private "documents" bucket, objects under <workspace_id>/…
  ├─ Auth: email + password, public sign-up disabled
  └─ Edge Functions (Deno), the only place the AI API key exists
       ├─ analyze: builds context → redacts → Claude (JSON schema) → validates → stores on the entry
       └─ assistant: retrieval → redacts → Claude (JSON schema) → validates citations → stores the message
```

The Edge Functions act **as the signed-in parent** (they forward the user's JWT). They don't use the service-role key, so RLS still protects every query they make.

### Data model (summary)

- `workspaces`, `workspace_members`: one workspace, two members. Membership can only be changed with the service role.
- `entries`: every Smart Input submission. `raw_text` is the untouched original. `analysis` holds the structured AI output, kept separate and labelled as AI.
- `timeline_events`, `profile_entries`, `actions` (+ `action_updates`), `interventions` (+ `intervention_observations`), `recommendations`: confirmed records. Each has `source_entry_id` / `source_document_id` / `source_label`, and timeline and profile rows have an `evidence_type`.
- `documents` (+ `document_chunks` with `page` / `section` and a full-text index).
- `chat_threads`, `chat_messages` (with validated `citations`).
- `ai_settings` (provider, model, consent with who and when), `redaction_terms`.
- `audit_log`: written by triggers on every insert, update and delete of important tables, with the actor's name. Viewable in Settings.
- **Evidence-pack foundations (Phase 2):** `commitments` (EHCP provisions, professional commitments and recommendations, school arrangements, with source document and page, frequency, review date and delivery status) and `evidence_links` (link any commitment, intervention, action or profile entry to the timeline events, entries, document passages or observations that support or contradict it). No UI yet.
- `search_records()`: ranked keyword search across documents, entries, timeline and profile. It runs with the caller's privileges, so RLS applies.

## How the AI is kept honest

- **Consent gate.** Both functions refuse to run until a parent has ticked the three statements in Settings and accepted the provider's terms. The decision is stored with who accepted and when, and can be withdrawn at any time. Without consent, everything except analysis and the assistant still works.
- **Redaction.** Before anything is sent, names on the redaction list (other children, staff) become placeholders such as `[Staff A]`, and email addresses and phone numbers are removed. The placeholders are swapped back in the response. Tested: the real name never reaches the provider.
- **Retrieval, not memory.** Each call rebuilds context from the database: profile, the last 60 timeline events, actions, interventions with observations, and keyword-matched document passages and earlier submissions. Each item gets a reference id such as `T4` or `D2`.
- **Structured outputs.** Facts, interpretations, recommendations, actions and profile updates are separate fields in a JSON schema.
- **Server-side validation after the model replies** (`supabase/functions/_shared/analysis.ts`):
  - Citations that don't exist in the context are removed. Unknown inline markers are stripped.
  - A "fact from Sammy's record" that cites nothing real is downgraded to "possible explanation".
  - A due date is kept only if the model quotes the deadline wording and that quote really appears in the source text. Otherwise it is removed, and the UI says so.
  - Suggested actions are shown as "Suggestion — not agreed with anyone". Only stated commitments are marked as commitments.
  - AI inferences saved to the profile stay labelled *AI hypothesis* unless a parent deliberately changes them.
- **Safety.** The prompt prioritises immediate safety and points to the safeguarding lead, NHS 111 or 999. The UI shows a safety banner when one is flagged. The assistant never diagnoses.
- **Model.** `claude-opus-5-5` by default (stored in `ai_settings.model`). Analysis uses `effort: high`, chat uses `medium`. Server-side refusal fallback (`fallbacks: "default"`) is on, so a declined request on a sensitive but legitimate topic is retried on a fallback model.

## Setup

1. **Create a Supabase project** in the **London (eu-west-2)** region.
2. **Apply the schema:**
   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```
   ```bash
   npx supabase db push
   ```
   Also check the project's dashboard: *Authentication → Providers → Email*, with **"Allow new users to sign up" off**.
3. **Create the two accounts** (use the service-role key from Settings → API, on your own machine only):
   ```bash
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/bootstrap.mjs --parent "Ido:ido@example.com" --parent "Helen:helen@example.com"
   ```
   It prints a temporary password for each parent. Change them in Settings after signing in.
4. **Deploy the Edge Functions and set the AI key** (the key never goes to the browser):
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... APP_ORIGIN=https://your-app-domain
   ```
   ```bash
   npx supabase functions deploy analyze
   ```
   ```bash
   npx supabase functions deploy assistant
   ```
5. **Run the web app:**
   ```bash
   cp .env.example .env.local
   ```
   Add the project URL and the **anon** key, then:
   ```bash
   npm install
   ```
   ```bash
   npm run dev
   ```
   For production, `npm run build` and host `dist/` on any static host (e.g. Netlify or Vercel, EU region). Configure an SPA fallback to `index.html`, and set the site URL in Supabase Auth settings.
6. **Sign in, open Settings, read the provider terms, and switch on AI** when you're ready.

## Privacy and security notes

- No public sign-up. Two accounts, one workspace. Every table has RLS restricted to workspace members, and storage objects are restricted by workspace folder.
- Keys: only the anon key is in the browser. The AI key lives in Edge Function secrets. The service-role key is used only by the bootstrap script, run locally.
- Supabase encrypts data at rest and in transit. Choose the London region for UK hosting. The AI provider may process data outside the UK/EU; this is stated on the consent screen.
- Corrections and deletions are recorded in the change history. To truly erase something, delete it and then prune the history (Settings → Your data).
- Export: Settings → *Export everything* gives a full JSON export. Original files can be downloaded from each document page.
- Not yet done: MFA (Supabase supports TOTP and it can be enabled in the dashboard), OCR for scanned PDFs (they're stored but not searchable), and automatic retention schedules.

## Testing

```bash
npm run build
```
```bash
npm run test:functions
```
The second command runs the Deno unit tests for redaction and AI output validation. It needs Deno installed.

`supabase/tests/rls_test.sql` is a manual row-level-security check: two parents share data, and a third account sees and can write nothing.

Phase 1 was also tested end to end in the browser against a real Postgres with RLS enforced, with the real Edge Functions and a stubbed Claude endpoint. The test signed in, gave AI consent, pasted a school email, reviewed and edited the analysis, saved, and then checked the dashboard, timeline, profile and actions. It then uploaded and searched an EHCP PDF, asked the assistant (which cited the EHCP page), confirmed that the second parent sees the same data, and confirmed that a non-member is refused.

## Phase 2 (designed for, not built)

- Evidence packs for EHCP reviews, built from `commitments` and `evidence_links`, with every claim linked to a source.
- Weekly or monthly summaries, and intervention effectiveness views, once enough real observations exist. Trend detection should stay out until the data supports it.
- Email or push reminders (currently in-app only), and semantic (embedding) retrieval alongside keyword search.
