# Sammy

A private web app for Ido and Helen to understand and support their son: one place to capture school emails, observations and documents, get grounded and practical AI analysis, confirm what's worth keeping, and follow through on actions.

**The core loop:** add information → receive useful analysis → confirm what to save → track actions and progress.

## What's new in Phase 1.5

- **Personalised AI.** Every analysis and answer reads Sammy's whole structured record, not a few search hits. That covers background, profile, provision and recommendations (with what has followed them up), interventions and what was observed, 18 months of timeline, actions and appointments, recent emails and documents. Documents the request refers to are read in full. Analyses explain *why* each recorded fact matters.
- **Five-part analysis:** *What happened · Understanding · What we can do (plus questions for school) · Follow-ups · Progress*. Short observations get a brief version.
- **Interventions linked to outcomes.** Each intervention records the change, then what happened afterwards, then an assessment. Analyses propose observations against existing interventions, with a reminder of how much evidence there is ("observation 2 — too early to judge"). There's an on-demand AI progress review that says how strong the evidence is for each intervention and never claims cause.
- **Reliable follow-ups.** Tasks and appointments (with times). Dates can come from relative phrases: "next Friday" is worked out with a calendar, "before half-term" with your school calendar. Worked-out dates stay flagged "date to confirm" until confirmed. Also new: how long you've been waiting for a reply, completion outcomes, and optional **email reminders** (one daily digest at most, no personal details by default).
- **Documents.** Scanned PDFs are read page by page with AI. A **Provision & recommendations** register records whether each item is confirmed, proposed or reported, whether it's happening, and which actions and interventions follow it up. It also answers "what hasn't been followed up?".
- **Everyday use.** A "How was Sammy's day?" box on the dashboard. The Add page works out whether you pasted an email, wrote an observation or asked a question, and unsent drafts are kept. Saving a review is atomic: all or nothing. The dashboard surfaces dates to confirm and replies you've waited 7+ days for. The assistant suggests follow-up questions.
- **AI behaviour.** Refusals are shown clearly and are never retried on another model. The server-side model fallback has been removed. Technical failures get controlled retries: the SDK's backoff, plus one retry for an unreadable response.
- **Fixes.** A member could change the `workspace_id` on their own membership row, which would let them join another workspace. Only the display name is now editable. A "Delete everything" option has been added.

## What's in the app

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
- **Model.** `claude-opus-5-5` by default (stored in `ai_settings.model`). Analysis uses `effort: high`, chat uses `medium`. Responses are streamed. If the model declines a request, the parent sees a clear "declined" message; it is never rerouted to another model.

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
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... APP_ORIGIN=https://your-app-domain APP_URL=https://your-app-domain
   ```
   ```bash
   npx supabase functions deploy analyze
   ```
   ```bash
   npx supabase functions deploy assistant
   ```
   ```bash
   npx supabase functions deploy transcribe
   ```
   ```bash
   npx supabase functions deploy reminders --no-verify-jwt
   ```
   `reminders` authenticates its own callers: the daily job uses a shared secret, and preview/test calls use the parent's session.
5. **Email reminders (optional).** Create a [Resend](https://resend.com) account with a verified sending domain, then:
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_... REMINDER_FROM="Sammy <reminders@your-domain>" CRON_SECRET=a-long-random-string
   ```
   Schedule a daily run in the SQL editor. It needs the `pg_cron` and `pg_net` extensions (Database → Extensions):
   ```sql
   select cron.schedule('sammy-reminders', '30 6 * * *', $$
     select net.http_post(
       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'SAME-CRON-SECRET'),
       body := '{}'::jsonb);
   $$);
   ```
   Each parent then switches reminders on in Settings, where they can preview today's email or send a test.
6. **Run the web app:**
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
7. **Sign in, open Settings, read the provider terms, and switch on AI** when you're ready.

## Backups and recovery

- **Your own copy:** Settings → *Export everything* downloads every record as JSON. Do this regularly (e.g. monthly) and keep it somewhere private. Original documents are separate files; download important ones from their document page.
- **Supabase backups:** paid Supabase plans take daily database backups (and offer point-in-time recovery as an add-on); check what your plan includes under *Database → Backups*. Storage files (the original documents) are not part of database backups.
- **Developer backup:**
  ```bash
  npx supabase db dump --data-only -f sammy-backup.sql
  ```
- **Recovery from mistakes:** every edit and deletion is in the change history (Settings), including the full earlier version, so individual records can be reconstructed from it.
- **Nothing is lost on AI errors:** submissions are saved before analysis, a failed or refused analysis leaves the original intact, and saving a review is a single transaction.

## Privacy and security notes

- No public sign-up. Two accounts, one workspace. Every table has RLS restricted to workspace members, and storage objects are restricted by workspace folder.
- Keys: only the anon key is in the browser. The AI key lives in Edge Function secrets. The service-role key is used only by the bootstrap script, run locally.
- Supabase encrypts data at rest and in transit. Choose the London region for UK hosting. The AI provider may process data outside the UK/EU; this is stated on the consent screen.
- Corrections and deletions are recorded in the change history. To truly erase something, delete it and then prune the history (Settings → Your data).
- Export: Settings → *Export everything* gives a full JSON export. Original files can be downloaded from each document page.
- Not yet done: MFA (Supabase supports TOTP and it can be enabled in the dashboard), OCR for scanned PDFs (they're stored but not searchable), and automatic retention schedules.

## Testing

### Real-AI evaluation

`scripts/ai-eval/run.mjs` evaluates the real model end to end with **synthetic data only**. It covers:
- the collective-worship incident email
- a short positive observation
- an email that contradicts the record
- relative dates ("next Friday", "before half-term", "within two weeks")
- a draft EHCP amendments document
- six assistant questions: EHCP adult support, unfollowed EP recommendations, the October meeting commitments, comparing EHCP versions, a question about a document that doesn't exist, and practical advice
- a progress review
- error handling

It checks structure, citation validity, redaction, date sourcing, use of context and appropriate caution, and writes a Markdown report with every output in full.

Run it against a **separate test project** (or `supabase start`), with a test parent account in an empty workspace and `ANTHROPIC_API_KEY` set as a function secret:
```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... EVAL_EMAIL=test-parent@example.com EVAL_PASSWORD=... npm run eval:ai -- --accept-ai-terms
```

### Other checks

```bash
npm run build
```
```bash
npm run test:functions
```
The second command runs the Deno unit tests (redaction, AI output validation, deadline sourcing, document matching and reminder scheduling). It needs Deno installed.

`supabase/tests/rls_test.sql` is a manual row-level-security check: two parents share data, and a third account sees and can write nothing.

Phase 1 was also tested end to end in the browser against a real Postgres with RLS enforced, with the real Edge Functions and a stubbed Claude endpoint. The test signed in, gave AI consent, pasted a school email, reviewed and edited the analysis, saved, and then checked the dashboard, timeline, profile and actions. It then uploaded and searched an EHCP PDF, asked the assistant (which cited the EHCP page), confirmed that the second parent sees the same data, and confirmed that a non-member is refused.

## Phase 2 (designed for, not built)

- Evidence packs for EHCP reviews, built from `commitments` and `evidence_links`, with every claim linked to a source.
- Weekly or monthly summaries, and intervention effectiveness views, once enough real observations exist. Trend detection should stay out until the data supports it.
- Email or push reminders (currently in-app only), and semantic (embedding) retrieval alongside keyword search.
