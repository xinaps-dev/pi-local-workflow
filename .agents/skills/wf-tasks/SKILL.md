---
name: wf-tasks
description: Generates the atomic tasks.md from an approved plan.md. The planner (session model) writes the tasks; validate-tasks.mjs enforces the contract deterministically BEFORE the human gate (a model validating its own format would be the fox guarding the henhouse). Use after approving a plan with wf-plan.
---

# wf-tasks — atomic task breakdown

## 0. Preconditions

- `specs/changes/<feature>/plan.md` exists and passed the wf-plan gate.
- `tasks.md` does NOT exist (if it does → ASK the user: regenerate? Progress
  marks would be lost).

## 1. Scout (only if information is missing)

If the plan lacks tooling info (compiler/interpreter, test runner, linter, build system, toolchain version),
launch `wf-scout` (scout profile from models.json) with concrete questions.
Otherwise skip.

## 2. Planner

Get the exact scratchpad symbols path:
```bash
node -e "import { wfFeatureSymbolsPath } from './.pi/scripts/lib.mjs'; console.log(wfFeatureSymbolsPath('<feature>'));"
```

Launch `wf-planner` (NO model → inherits the session, pass `isolated: true`) with the strict minimal caller prompt:

> `"Generate tasks.md, reference.md, and the ephemeral symbol manifest at '<exact_symbols_path>' based on specs/changes/<feature>/plan.md"`

CRITICAL: Do NOT copy framework laws, contract rules, or formats into this prompt.
Always pass `isolated: true` so the agent receives no network or extension tools.
`.pi/agents/wf-planner.md` is 100% self-contained in its system prompt.
Duplicating rules into the caller message bloats input tokens by thousands
and destroys prompt caching efficiency.

The planner uses its `read` tool to inspect `plan.md` and generates:
1. `specs/changes/<feature>/tasks.md` (atomic bottom-up task checklist).
2. `specs/changes/<feature>/reference.md` (canonical data tables and algorithms).
3. The ephemeral symbol manifest at the exact path provided.

Contract guarantees enforced by `wf-planner.md` and validated by `validate-tasks.mjs`:
- Sequential TNNN IDs, exactly 6-space indented keys (`files:`, `needs:`,
  `verify:`, optional `verify-win:`, `notes:`).
- Quantitative atomicity: ≤2 symbols defined per task, ≤2 files, zero design decisions.
- Incremental container & class construction: ≤2 methods/functions per task across any class, struct, module, or namespace.
- Callee-before-caller method topology: leaf methods precede orchestrator methods that invoke them.
- Ready-state lifecycle contract for asynchronous/networked services in `notes:`.
- Closed task contracts: all literal identifiers asserted by `verify:` declared in `notes:`.
- Real behavioral tests or native compiler syntax checks (`node --check`, `cargo check`).
- Ephemeral symbol manifest mapping tasks to FQN Symbol IDs (`<file>::[<Scope>.]<id>`).
- `verify:` = the test battery the senior defines, with exact expected
  values, using the language's own tooling (node asserts, cargo test,
  pytest, gcc+run+diff, dotnet test, ...). Prefer behavioral over
  existence/syntax checks: the gate runs it from the task file and the
  worker cannot weaken it (it never touches tasks.md).
- Language-agnostic: never assume Node for feature code.

## 3. Deterministic validation (the script judges, not you)

```bash
node .pi/scripts/validate-tasks.mjs
```

- On ERRORS: pass them back to the planner VERBATIM to fix (max 2 rounds),
  then stop and report to the user (broken contract).
- On WARNING (verify binary not in PATH): surface it — likely an invented
  command; the planner must use real project commands.
- On other WARNINGs (no verify, existence-only verify, chained actions):
  pass them to the planner in the same fix loop (max 2 rounds). Only
  warnings you consciously accept survive to the human gate, which sees the
  per-task verify coverage the script prints (behavioral / syntax-only /
  existence / none).

## 4. Human gate

Show tasks.md to the user TOGETHER with the verify coverage and any surviving
warnings, so the approval is informed. If plan.md declares an Integration Map,
confirm with the user that the boundary-exposing task's verify actually
exercises the mapped references (fetches/invokes them).

For every task whose verify is syntax-only, state aloud: does its `notes:`
constitute a closed specification (state shape, transitions, timing constants,
action literals declared), and is a runtime-load verify possible? If the answer
to either is no → step 2 with those comments. Approving a syntax-only task
without this statement is a gate failure.

ASK: approved?
- Approved → "tasks.md approved. Next: `/skill:wf-go`".
- Changes → step 2 with the comments.
