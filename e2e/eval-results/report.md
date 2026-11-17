# Full auto eval, 2026-11-16T14:56:16.824Z

26 of 26 passed. Cases: e2e/eval-cases.json. Mock WhatsApp + mock model (e2e/mock-server.mjs).

| run | case | result | expected | got | note |
|---|---|---|---|---|---|
| dry | greeting | PASS | dry-run | dry-run |  |
| dry | FAQ hit (opening hours) | PASS | dry-run | dry-run |  |
| dry | out of scope -> handoff | PASS | draft | draft |  |
| dry | thanks -> no reply needed | PASS | skip | skip |  |
| dry | not on the allowlist | PASS | draft | draft |  |
| dry | group message | PASS | draft | draft |  |
| dry | burst -> per-chat rate limit | PASS | dry-run, draft, draft | dry-run, draft, draft |  |
| dry | duplicate message | PASS | dry-run, skip | dry-run, skip |  |
| dry | quiet hours | PASS | draft | draft |  |
| dry | human typed recently | PASS | draft | draft |  |
| dry | errors -> auto-disable | PASS | error, error | error, error | Full auto turned itself off |
| live | greeting | PASS | sent | sent | sent in page: "Hello! How can I help you today?" |
| live | FAQ hit (opening hours) | PASS | sent | sent | sent in page: "We are open Monday to Friday, 09:00 to 17:00." |
| live | out of scope -> handoff | PASS | draft | draft |  |
| live | thanks -> no reply needed | PASS | skip | skip |  |
| live | not on the allowlist | PASS | draft | draft |  |
| live | group message | PASS | draft | draft |  |
| live | burst -> per-chat rate limit | PASS | sent, draft, draft | sent, draft, draft | sent in page: "Hello! How can I help you today?" |
| live | duplicate message | PASS | sent, skip | sent, skip | sent in page: "Hello! How can I help you today?" |
| live | quiet hours | PASS | draft | draft |  |
| live | human typed recently | PASS | draft | draft |  |
| live | errors -> auto-disable | PASS | error, error | error, error | Full auto turned itself off |
| ui | custom template appears in Ask and is sent | PASS | button + text | button + text |  |
| ui | edited prompt file used without restart | PASS | edited text | edited text |  |
| ui | kill switch turns Full auto off | PASS | off | off |  |
| ui | live needed the confirm dialog | PASS | asked | asked | Send replies for real? |

## Transcripts

### dry: greeting (Rina)

- in: Rina: Hello, good morning!
- **dry-run**: all checks passed (dry run: nothing sent) (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Let me get a colleague to help you with that.","co; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: FAQ hit (opening hours) (Budi)

- in: Budi: What are your opening hours?
- **dry-run**: all checks passed (dry run: nothing sent) (confidence 0.95) -> "We are open Monday to Friday, 09:00 to 17:00."

  model calls: triage=YES; autoreply={"reply":"We are open Monday to Friday, 09:00 to 17:00.","co

### dry: out of scope -> handoff (Citra)

- in: Citra: I want my money back or I call my lawyer
- **draft**: model asked for a human (confidence 0.3) -> "Let me get a colleague to help you with that."

  model calls: triage=YES; autoreply={"reply":"Let me get a colleague to help you with that.","co

### dry: thanks -> no reply needed (Dewi)

- in: Dewi: ok thanks!
- **skip**: no reply needed (llm)

  model calls: triage=NO

### dry: not on the allowlist (Stranger)

- in: Stranger: Hello?
- **draft**: chat not on the allowlist (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: group message (Project Team)

- in: Ana: hi all
- in: Bob: Hello, anyone there?
- **draft**: group chat (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: burst -> per-chat rate limit (Eka)

- in: Eka: Hello
- **dry-run**: all checks passed (dry run: nothing sent) (confidence 0.92) -> "Hello! How can I help you today?"
- in: Eka: hello??
- **draft**: hourly limit for this chat (confidence 0.92) -> "Hello! How can I help you today?"
- in: Eka: Hi, are you there?
- **draft**: hourly limit for this chat (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: duplicate message (Fajar)

- in: Fajar: Hi there
- **dry-run**: all checks passed (dry run: nothing sent) (confidence 0.92) -> "Hello! How can I help you today?"
- in: Fajar: Hi there (reported again)
- **skip**: already handled this message

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: quiet hours (Gita)

- in: Gita: Hello, are you open?
- **draft**: quiet hours (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: human typed recently (Hadi)

- in: Hadi: Hello!
- **draft**: you typed in this chat recently (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### dry: errors -> auto-disable (Indra)

- in: Indra: error one
- **error**: Request failed (400): eval: scripted failure
- in: Indra: error two
- **error**: Request failed (400): eval: scripted failure

  model calls: triage=FAIL; triage=FAIL

### live: greeting (Rina)

- in: Rina: Hello, good morning!
- **sent**: all checks passed (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=FAIL; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: FAQ hit (opening hours) (Budi)

- in: Budi: What are your opening hours?
- **sent**: all checks passed (confidence 0.95) -> "We are open Monday to Friday, 09:00 to 17:00."

  model calls: triage=YES; autoreply={"reply":"We are open Monday to Friday, 09:00 to 17:00.","co

### live: out of scope -> handoff (Citra)

- in: Citra: I want my money back or I call my lawyer
- **draft**: model asked for a human (confidence 0.3) -> "Let me get a colleague to help you with that."

  model calls: triage=YES; autoreply={"reply":"Let me get a colleague to help you with that.","co

### live: thanks -> no reply needed (Dewi)

- in: Dewi: ok thanks!
- **skip**: no reply needed (llm)

  model calls: triage=NO

### live: not on the allowlist (Stranger)

- in: Stranger: Hello?
- **draft**: chat not on the allowlist (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: group message (Project Team)

- in: Ana: hi all
- in: Bob: Hello, anyone there?
- **draft**: group chat (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: burst -> per-chat rate limit (Eka)

- in: Eka: Hello
- **sent**: all checks passed (confidence 0.92) -> "Hello! How can I help you today?"
- in: Eka: hello??
- **draft**: hourly limit for this chat (confidence 0.92) -> "Hello! How can I help you today?"
- in: Eka: Hi, are you there?
- **draft**: hourly limit for this chat (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9; triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: duplicate message (Fajar)

- in: Fajar: Hi there
- **sent**: all checks passed (confidence 0.92) -> "Hello! How can I help you today?"
- in: Fajar: Hi there (reported again)
- **skip**: already handled this message

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: quiet hours (Gita)

- in: Gita: Hello, are you open?
- **draft**: quiet hours (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: human typed recently (Hadi)

- in: Hadi: Hello!
- **draft**: you typed in this chat recently (confidence 0.92) -> "Hello! How can I help you today?"

  model calls: triage=YES; autoreply={"reply":"Hello! How can I help you today?","confidence":0.9

### live: errors -> auto-disable (Indra)

- in: Indra: error one
- **error**: Request failed (400): eval: scripted failure
- in: Indra: error two
- **error**: Request failed (400): eval: scripted failure

  model calls: triage=FAIL; triage=FAIL
