---
name: wf-archive
description: Closes and archives a finished feature. Local scout verifies plan↔code (file:line evidence), gaps go to the human for decision, then archive.mjs does the deterministic close-out (NNN numbering, ARCHIVE line, move to specs/history/). Use when tasks.md is all [x].
---

# wf-archive — feature close-out and archive

## 0. Preconditions

- All tasks `[x]` in `specs/changes/<feature>/tasks.md` (if not → suggest
  `/skill:wf-go`).

## 1. Plan ↔ code verification (scout, local model)

Launch `wf-scout` (scout profile from models.json, pass `isolated: true`) with the minimal caller prompt:
> `"Verify requirements from specs/changes/<feature>/plan.md against product code. Provide file:line evidence for each requirement."`

Do NOT inline the full plan.md into the prompt — the scout reads it via its `read` tool.
Validate its footer (fail-safe: 1 retry → then you verify yourself with read tools).

## 2. Human gate on gaps

- All covered → step 3.
- Gaps → present each with its evidence. ASK: generate tasks for the gaps
  (extend plan.md → wf-tasks → wf-go) or accept and archive? Never decide
  yourself.

## 3. Deterministic archive (the script decides NNN and the move)

```bash
node .pi/scripts/archive.mjs
```

- exit ≠ 0 (pending tasks / destination exists) → relay verbatim, stop.
- Success → show the destination `specs/history/NNN-<feature>` and the
  results.md summary (done / attempts / no-verify).

`specs/history/` is the durable memory: future planners consult it as a
reference of how each feature was solved.
