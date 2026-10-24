# Item 29 — Phase 1b plan: Guides + voice

Draft for Joe's review, 2026-10-24. Phase 1a (mechanic chat) is live and `ready_for_review`. Nothing in this plan is built yet; the open decisions are at the end.

Phase 1b finishes **use case 1** (a saved, vehicle-specific checklist for a DIY job) and **use case 4** (live help on a long job such as R2's Sniper EFI tune), and adds the paid voice service you chose.

---

## Part A — Guides

### What a guide contains

A guide is a structured job procedure for **one vehicle**, written by the mechanic and saved after you review it. It is the check-off version of what the mechanic already writes in chat, but in fixed sections, so the app can show it as a checklist:

| Section | Contents |
|---|---|
| Header | Title (e.g. "Oil change — Gandalf 5.3L"), difficulty, time estimate, one-line summary |
| Before you start | Tools **with sizes** (socket, drive, wrench), parts with part numbers, shop supplies, safety items |
| Steps | Numbered; each step can carry a socket size, a torque value, a caution and an insider tip, shown *at the step where you need them* |
| Common mistakes | e.g. "double-gasketing the oil filter" |
| Best practices / tips | Including known trouble spots for this vehicle |
| After the job | Leak check, pump the brake pedal before driving, reset oil-life, log mileage |
| Specs used | Each with its source and trust status (same rules as decision 2b) |
| Sources | Links and manual pages the mechanic used |

The basics a pro would skip (level ground, wheel chocks, jack points and stands, letting the engine cool, disposing of fluids) are always included, as your use case 1 asked.

### Where guides live

New migration (`YYYYMMDD_guides.sql`):

| Object | Purpose |
|---|---|
| `guides` | `vehicle_id`, `title`, `job_type`, `body` (the sections above, stored as `json` like chat messages), `version`, `verified_at/by` ("worked as written"), `conversation_id` + `source_tool_use_id` (where it came from). Audited, so the Changes page keeps every earlier version. |
| `guide_runs` | One per time you **do** the job: `guide_id`, `guide_version`, optional `pending_work_id` / `work_session_id`, per-step check-offs (`who`, `when`, `note`), `status` (active / finished / abandoned), `outcome` (as written / with changes). Not audited: every tick would flood the Changes page. |
| `pending_work.guide_id` | Links a pending item ("Oil change due") to its guide. The guide is reused every time the item comes round. `pending_work_open` is dropped and recreated around the `ALTER` (CLAUDE.md rule). |

Permissions match the rest of the app: members create and use guides; only an admin deletes one.

### How a guide gets made

1. **From a chat:** a **Make a guide** button in the chat (and the mechanic can offer one itself after explaining a job). It asks the mechanic to turn the conversation into a guide.
2. **From a pending item:** ⋯ menu → **Make a guide for this job**. This opens the mechanic with that request pre-typed, reusing the chat.
3. The mechanic researches if it needs to (saved specs, uploaded manuals and earlier guides come first), then calls a new `propose_guide` tool. Its strict JSON schema is the section list above, the same technique `parse-document` uses.
4. A **guide card** shows a preview (title, vehicle, difficulty, step count, tools). **Save guide** stores it and offers **Open guide**.

Guide writing runs at **high effort** (more careful reasoning) for that one request. The API lets one message change effort without throwing away the cached conversation (Opus 5.5's per-message effort setting); changing the request-wide setting would.

### Using a guide: check-off mode

- **Guides tab** on each vehicle; a guide page at `/guides/:id` with a read view and **Start job**.
- **Start job** creates a run, links it to the pending item if there is one, and switches to check-off mode:
  - one step at a time in large type, with **Done** / **Back**, and the full list a swipe away;
  - check-offs are saved as you go, with who and when, so two people working the same job see the same progress, and closing the app doesn't lose your place;
  - **Note** on any step ("drain plug was 15 mm, not 13 mm");
  - **Ask about this step** opens the mechanic already knowing the guide and the step you're on;
  - the screen stays awake during a run (the browser's Wake Lock), so the phone doesn't sleep with greasy hands on it.
- **Finish:** "Did the guide work as written?"
  - **Yes** marks the guide verified (green) and offers to mark its specs "Worked as written".
  - **With changes** asks the mechanic to propose an updated version using your step notes; you review it, and the version number goes up.
  - Then **Log the service visit**, the existing "Mark done…" flow pre-filled from the pending item, which closes the item as usual.
- **Work sessions:** each session item with a guide shows **Open guide**. Items without one show **Make a guide**.

### Use case 4 (multi-day jobs)

A long job such as the Sniper tune becomes a pending item with a guide that grows as you go. Each session is a run; progress notes from 1a carry what happened between runs. The mechanic reads the guide, the latest run and its notes, so "where were we?" works across weekends.

---

## Part B — Voice (paid service)

### Recommendation: OpenAI for both directions, after a garage noise test

| | **OpenAI** (recommended) | Deepgram | ElevenLabs |
|---|---|---|---|
| Speech → text | `gpt-transcribe` ~$0.0045/min, `gpt-4o-transcribe` ~$0.006/min, `gpt-4o-mini-transcribe` ~$0.003/min | Nova-3 streaming ~$0.0048/min (third-party figure); keyword boosting is a paid add-on | (not considered) |
| Text → speech | `gpt-4o-mini-tts` ~$0.015/min; voice and tone can be steered ("friendly, unhurried mechanic") | Aura voices | Flash ~$0.05 per 1,000 characters (≈ $0.045/min); most natural-sounding voices |
| Your recordings | Not used for training by default; abuse-monitoring logs kept up to 30 days | **Used to improve their models unless every request opts out**, and opting out loses the 50% discount | Varies by plan; zero-retention is enterprise-only |
| Garage noise | No independent comparison found | Vendor claims better noise handling (self-reported) | n/a |
| Accounts | One account, one key | One more account | One more account |

Why OpenAI: one vendor for both directions, low price, a voice you can describe in words, no training on your family's voices by default, and the transcriber can be given a vocabulary hint ("Sniper EFI, AFR, IAC, TPS, 13 millimeter, foot-pounds") so shop jargon comes through.

**Noise test before committing (cheap).** There is no independent noisy-garage benchmark, so we test on your own audio. A small admin page records 10 phrases on your phone (engine idling, shop vac or compressor running, mechanic words) and runs them through the OpenAI transcribers side by side, for a few cents. If they struggle, Deepgram goes into the same test before we choose. The code keeps the vendor behind one small interface either way.

### How it works

```
hold to talk ──► phone records (Opus audio)
release ──► `voice` Edge Function ──► OpenAI transcribe ──► text
text ──► mechanic-chat (as now, in voice mode) ──► answer streams
answer, sentence by sentence ──► `voice` Edge Function ──► OpenAI speech ──► played in order
```

- **Keys stay on the server:** a new `voice` Edge Function with the same sign-in check; its cost is logged in `ai_usage` and shown on the AI usage page.
- **Sentence-by-sentence speech:** the first sentence starts playing while the rest of the answer is still being written. That cuts the wait from "whole answer" to roughly 2–4 seconds after you let go.
- **Tap to stop** talking at any time.

### Voice mode behaviour

- **Push-to-talk, not always listening.** A big hold-to-talk button you can press with a knuckle. Always-listening drains the battery, triggers on shop noise, and costs money for every noise it hears.
- **Spoken answers are different.** The mechanic is told the answer will be heard: 1–3 short sentences, no tables or lists, one step at a time, ending with "say *next* when you're ready." Voice turns run at **low effort**, because short spoken answers don't need deep reasoning and it keeps them fast and cheap.
- **Simple commands never reach the AI.** In check-off mode, "next", "back", "repeat", "done" and "where am I" are matched on the phone from the transcript: instant and free. Anything else becomes a question to the mechanic, with the current step attached.
- The text still appears on screen, so you can glance back at a torque value.

### What voice costs

A two-hour voice-guided job (you talk ~15 min, it talks ~30 min):
- speech: about **$0.50** at OpenAI
- the mechanic: about **$2–3** in Claude turns (~60 short, low-effort turns with the manual cached)

The Claude side dominates, so most of the cost control comes from low effort and caching, not from the speech vendor.

---

## Part C — Small follow-ups bundled in

- **Manuals via the Files API:** upload each manual to Anthropic once and refer to it by id, instead of re-sending the whole PDF with every turn. It matters for the Sniper manual during long tuning sessions.
- **"Continue" button** when a turn stops early (time limit or step limit), instead of typing "continue".

---

## Build order

1. **Database:** migration for `guides`, `guide_runs`, `pending_work.guide_id`; run it and verify (Claude).
2. **Making guides:** `propose_guide` tool, guide card, high-effort request, guides included in the vehicle record.
3. **Guide pages:** Guides tab, guide page, check-off mode, wake lock, step notes, finish flow, links from pending items and work sessions.
4. **Noise test:** you create an OpenAI key with a spending limit and set `OPENAI_API_KEY` yourself; record the 10 phrases on the admin test page; we pick the transcriber.
5. **Voice:** `voice` Edge Function, voice mode in chat and check-off mode, local commands.
6. **Files API** for manuals; Continue button.
7. **Verify** with TEST guides and runs (deleted afterwards), phone-width checks, and the handoff with a testing plan.

Steps 1–3 ship and get tested on their own (guides are useful without voice).

## What's new to learn in 1b (for the work project)

- **Structured output inside an agent:** a tool whose input schema *is* the document you want, so the model's "action" is a validated JSON artifact.
- **Changing effort mid-conversation without losing the cache:** cost and quality tuning per request type.
- **A speech pipeline:** speech-to-text → LLM → text-to-speech, and why the latency budget sets the design (push-to-talk, sentence-level streaming, local commands).
- **Routing cheap work away from the model:** keyword commands on the phone versus sending everything to the AI.
- **Human verification of AI output:** "worked as written" turns an AI draft into trusted family knowledge, and corrections flow back into the next version.

---

## Open decisions (recommended option first)

1. **Voice vendor:** OpenAI for both, after the garage noise test *(recommended)* / Deepgram speech-to-text + OpenAI voice / ElevenLabs voice (most natural, ~3× the speech cost).
2. **Specs inside a guide:** offer **Save all specs to the vehicle** as unverified, one tap *(recommended)* / keep them only inside the guide / save automatically.
3. **Progress on a run:** shared by everyone working the job *(recommended)* / per person.
4. **Guide effort:** high for writing guides, ~30–80¢ each *(recommended)* / medium.
5. **Voice commands:** next / back / repeat / done handled on the phone *(recommended)* / everything goes through the mechanic.
6. **Listening:** push-to-talk *(recommended)* / always listening.
7. **Voice in the $50 cap:** count speech costs in the same monthly cap *(recommended, one budget)* / separate.

---

## Sources (voice research, October 2026)

- OpenAI API pricing (official): https://developers.openai.com/api/docs/pricing
- OpenAI `gpt-4o-mini-tts` model page: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts.md
- OpenAI per-minute TTS discussion: https://community.openai.com/t/new-tts-api-pricing-and-gotchas/1150616
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data
- Deepgram Model Improvement Program (official): https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
- Deepgram pricing (third-party summary): https://www.happyrobot.ai/hub/deepgram-pricing
- Deepgram Nova-3 announcement (vendor claims on noise): https://developers.deepgram.com/changelog/2025/2/12
- ElevenLabs API pricing (third-party summaries): https://modelslab.com/elevenlabs-api-pricing and https://developer.puter.com/tutorials/elevenlabs-api-pricing/

Third-party figures should be checked against the vendor's own pricing page before you create an account.
