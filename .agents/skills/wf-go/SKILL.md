---
name: wf-go
description: Runs the deterministic implementation loop. Mechanical relay — run prepare.mjs, then invoke SubagentWorkflow with the emitted args VERBATIM. The loop (gated workers, verify by exit code, [x] marking, retries, STOP) is code, not prose. Use when there is an approved tasks.md.
---

# wf-go — the implementation loop (relay protocol)

Your role here is a MECHANICAL RELAY: two calls, copied verbatim, zero
interpretation. The determinism lives in the code (.pi/scripts/ + the
wf-go.js workflow), not in you.

## 0. Preconditions

- The worker/scout models must be available to THIS session: if the profiles
  point at the llama.cpp router, run `/llama` first and make sure the model is
  loaded (spawns against an unregistered model die instantly with "Model not
  found" — the loop then STOPs after 2 attempts). If EVERY agent fails at
  0 tokens / <1s, this is almost certainly it.

## 1. Prepare

```bash
node .pi/scripts/prepare.mjs
```

- exit ≠ 0 → show the error verbatim and STOP.
- stdout is a JSON with `status: "empty"` → nothing to do → suggest
  `/skill:wf-archive`.

## 2. Launch the workflow

Call the `SubagentWorkflow` tool with the `scriptPath` EXACTLY as printed by
prepare.mjs (it generates a per-run script with the task data already inlined
— you copy ONE short path, never the data):

- `scriptPath`: the path from the JSON
- do NOT pass `args` — the data is already inside the generated script

The run continues in the background. **The card in the transcript is a static
snapshot** (it shows 0/0 agents at start — that's normal). For LIVE progress:

- `/agents` → the workflow row → `⏎` opens the **inspector** with real-time
  per-agent status (spinner/check, model, tokens, tool calls)
- Inspector keys: `x` stop · `p` pause · `s` skip · `r` retry · `c` view a
  worker's full conversation

The completion notification arrives automatically when all tasks settle.

## 3. On completion (the notification arrives in a later turn)

Show the workflow's returned report to the user:
- tasks: id · done · attempts
- `attempts: 3` means the task needed the senior assist (agents labelled
  `assist:<TID>` in the inspector — a normal round, not an error)
- if `stopped`: CLASSIFY with the evidence in front of you and say which:
  - **INFRA**: the card shows a spawn error verbatim ("Model not found",
    endpoint down) or every agent died at 0 tokens/<1s → "run `/llama`, verify
    the model, re-run `/skill:wf-go`"
  - **TASK**: error files exist and the distillation is present → show it, and
    "inspect conversations via /agents → Workflows (c key); fix as you prefer,
    mark [x] if appropriate, re-run /skill:wf-go to continue".

## Golden rules

- NEVER edit tasks.md or results.md yourself — state is written only by the
  gate (check.mjs).
- NEVER launch workers yourself outside the workflow (that path has no gate).
- If the user asks to stop: `/agents → Workflows` → `x` (you cannot stop it
  from here).
