---
name: wf-plan
description: Creates a feature's plan.md. Minimal user interview, then the deterministic new-feature.mjs scaffolding (slug + date + single-active-feature enforced by code), local scout for real project context, planner (session model) filling the plan, and a human approval gate. Use when the user requests a new feature or change (group ALL their requests into ONE feature).
---

# wf-plan — feature plan

## 0. Preconditions

- `specs/config/models.json` exists (if not → ERROR → `/skill:wf-init`).

## 1. Interview (only the essentials)

If the request is already clear (expected behavior + scope), do NOT interview.
If essential data is missing, ask ONE short list of questions. Several user
requests = ONE feature with a name that groups them.

## 2. Scaffolding (deterministic — the script decides slug/date, not you)

```bash
node .pi/scripts/new-feature.mjs "<feature title>"
```

- On ERROR (feature exists / another feature active): relay the error
  verbatim and stop — the human decides (archive first, or continue).
- On success: the script created `specs/changes/<slug>/{plan.md,results.md}`
  with the system date. You NEVER pick slugs or dates yourself.

## 3. Scout (local model — cheap)

Read `specs/config/models.json` → `scout` profile. Launch `subagent_type: wf-scout`
with that `model` (via the Agent tool, pass `isolated: true`) and a minimal surgical question:
> `"Check project root with ls for build descriptors (package.json, Cargo.toml, go.mod, etc.) and report existing toolchain or greenfield status."`

Maximum 2 calls. Validate the `===WF-RESULT===` footer (missing/malformed/wrapped-up →
1 retry → if it fails again, answer yourself with read tools only, minimal).

## 4. Planner (session model — do NOT pass a model)

Launch `wf-planner` (via Agent tool, pass `isolated: true`) with the minimal caller prompt:
> `"Fill specs/changes/<slug>/plan.md for user request: '<verbatim_request>'. Scout findings: <summary>."`

CRITICAL: Do NOT copy framework laws, rules, or formatting constraints into this prompt.
`wf-planner.md` already contains the complete, self-contained architecture and planning rules
in its system prompt. Duplicating rules bloats context and destroys prompt caching efficiency.
The planner uses its `read` tool to inspect files and fills the TODO sections of `plan.md`.

## 5. Human gate

Show the plan to the user (summary + path). ASK: approved?
- Changes requested → back to step 4 with their comments.
- Approved → "plan.md approved. Next: `/skill:wf-tasks`".

Never run wf-tasks automatically after approval: the human decides when.
