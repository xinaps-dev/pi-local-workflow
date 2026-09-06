// wf-go.js — THE deterministic implementation loop.
// Portable: written for the SubagentWorkflow script API (Claude Code's Workflow
// tool runs it unchanged). No filesystem/network here — the loop only spawns
// gated workers; all state is written by .pi/scripts/check.mjs (the gate).
//
// args (emitted by .pi/scripts/prepare.mjs, passed verbatim by the relay):
//   { feature, workerModel, scoutModel, tasks: [{ id, block, runDir, gate }] }
//
// Per task: up to 2 junior attempts (fresh spawn; the failure report travels
// by file) + 1 senior-guided attempt after the session model writes an exact
// Remediation into the feature's reference.md (agreement 011). Any task
// failing all three STOPs the loop — the human investigates and decides.
// Sequential by design: task order IS the dependency order.
//
// Two ways to run: (a) prepare.mjs generates a per-run script with the task
// data INLINED (preferred — the relay copies one short path); (b) this file
// directly, with args passed by the caller. Both supported.
export const meta = {
  name: 'wf-go',
  description: 'Deterministic implementation loop: one gated worker per task, 2 attempts, stop on failure',
  phases: [{ title: 'Tasks' }, { title: 'Report' }],
}

// ---- BODY (prepare.mjs splits here and inlines the run data) ----

// Normalize: some relays pass args as a JSON-encoded STRING instead of an
// object. Accept both; anything else is a hard error.
let a = args
if (typeof a === 'string') {
  try { a = JSON.parse(a) } catch { a = undefined }
}
if (!a || !Array.isArray(a.tasks) || a.tasks.length === 0) {
  return { feature: a?.feature ?? null, error: 'no tasks in args (relay must pass the prepare.mjs args JSON verbatim)' }
}

// Senior assist reports through a validated schema (no substring parsing) and
// is GATED on the artifact it must produce: reference.md must contain the
// "## Remediation <TID>" section (also written on BLOCKED, with the reason).
// The file is the truth; the schema only types WHICH outcome it was.
const ASSIST_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'BLOCKED'] },
    summary: { type: 'string' },
  },
  required: ['status', 'summary'],
}
const assistGate = (taskId) =>
  `node -e "const {readFileSync} = require('node:fs'); const t = readFileSync(${JSON.stringify(`specs/changes/${a.feature}/reference.md`)}, 'utf8'); if (!t.includes('## Remediation ${taskId}')) process.exit(1)"`

const report = []
let stopped = null

for (const task of a.tasks) {
  let attemptsUsed = 0
  let done = false

  for (let attempt = 1; attempt <= 2 && !done; attempt++) {
    attemptsUsed = attempt
    const resultFile = `${task.runDir}/${task.id}_a${attempt}_result.md`
    if (attempt === 1) log(`▶ ${task.id}: ${task.block.split('\n')[0].replace(/^- \[ \] /, '')}`)
    const header = attempt === 1
      ? 'Task (execute exactly this ONE task, nothing else):'
      : `Your previous attempt FAILED the gate. First check if a failure report exists at ${task.runDir}/${task.id}_a1_error.md (read it if present; if absent, your previous run timed out or reached max_turns). Inspect the touched files and the verify command, understand what failed, and fix it. Then complete the task:`

    const prompt = [
      header,
      '',
      task.block,
      '',
      'Result contract — as your LAST action, write your result footer to this file:',
      `  ${resultFile}`,
      'The file must contain exactly this format:',
      '===WF-RESULT===',
      'STATUS: DONE',
      'SUMMARY: <max 200 tokens: what you did>',
      'FILES: <touched paths, comma-separated; empty if none>',
      '===WF-END===',
      'Use STATUS: BLOCKED (reason in SUMMARY) only if something genuinely prevents',
      'the task. Verification runs automatically after you finish — the exit code',
      'decides, so complete the task fully before writing the footer.',
    ].join('\n')

    const res = await agent(prompt, {
      label: `${task.id}.a${attempt}`,
      agentType: 'wf-worker',
      model: a.workerModel,
      gate: `${task.gate} a${attempt}`,
    })
    done = res !== null
    log(`${task.id} · attempt ${attempt} · ${done ? 'DONE (gate passed: footer + verify)' : 'FAILED (failure report written)'}`)
  }

  // Senior assist (agreement 011): two junior failures → the session model
  // appends an exact "Remediation TNNN" section to the feature's reference.md
  // and the junior gets ONE final guided attempt. Still failing → STOP.
  if (!done) {
    log(`${task.id}: junior failed ×2 — senior assist round`)
    const assist = await agent(
      [
        'SENIOR ASSIST. A junior worker failed this task twice at the gate:',
        '',
        task.block,
        '',
        `Feature: ${a.feature}`,
        'Failure reports (gate output: verify stderr / footer errors; may be absent if the worker timed out or reached max_turns):',
        `  ${task.runDir}/${task.id}_a1_error.md`,
        `  ${task.runDir}/${task.id}_a2_error.md`,
        '',
        'Steps:',
        `1. If the failure reports exist, read them. If they do NOT exist, the worker ran out of turns (turn limit / debugging loop). In all cases, read the files the task touches and the verify command in specs/changes/${a.feature}/tasks.md to derive the exact pass condition and understand why it failed.`,
        `2. APPEND to specs/changes/${a.feature}/reference.md (create it if missing) a section "## Remediation ${task.id}" with the EXACT data/code fragments the junior must transcribe to pass the gate, plus one line on what was wrong.`,
        '3. Do NOT edit any other file — you are defining, not implementing.',
        `4. If (and only if) the task is genuinely impossible or requirements are invalid, APPEND instead a section "## Remediation ${task.id} — BLOCKED: <one-line reason>" to reference.md and report status BLOCKED. Do NOT report BLOCKED simply because error files are absent.`,
        `5. Report through the structured output tool: {"status": "DONE" | "BLOCKED", "summary": "<one line>"}.`,
      ].join('\n'),
      {
        label: `assist:${task.id}`,
        agentType: 'wf-planner',
        schema: ASSIST_SCHEMA,
        gate: assistGate(task.id),
      },
    )
    const assistOk = !!assist && assist.status === 'DONE'
    if (!assistOk) {
      log(`${task.id}: assist ${assist ? `reported ${assist.status}` : 'failed or gate-failed (no remediation landed in reference.md)'}`)
    }
    if (assistOk) {
      attemptsUsed = 3
      const resultFile = `${task.runDir}/${task.id}_a3_result.md`
      const prompt = [
        `Your two attempts FAILED the gate. The senior wrote a remediation for this task in specs/changes/${a.feature}/reference.md (section "Remediation ${task.id}") — read it FIRST and follow it EXACTLY. Also check if a failure report exists at ${task.runDir}/${task.id}_a2_error.md (read it if present) to understand what failed. Then complete the task:`,
        '',
        task.block,
        '',
        'Result contract — as your LAST action, write your result footer to this file:',
        `  ${resultFile}`,
        'The file must contain exactly this format:',
        '===WF-RESULT===',
        'STATUS: DONE',
        'SUMMARY: <max 200 tokens: what you did>',
        'FILES: <touched paths, comma-separated; empty if none>',
        '===WF-END===',
        'Use STATUS: BLOCKED (reason in SUMMARY) only if something genuinely prevents',
        'the task. Verification runs automatically after you finish — the exit code',
        'decides, so complete the task fully before writing the footer.',
      ].join('\n')
      const res = await agent(prompt, {
        label: `${task.id}.a3`,
        agentType: 'wf-worker',
        model: a.workerModel,
        gate: `${task.gate} a3`,
      })
      done = res !== null
      log(`${task.id} · attempt 3 (senior-guided) · ${done ? 'DONE (gate passed: footer + verify)' : 'FAILED'}`)
    }
  }

  report.push({ id: task.id, done, attempts: attemptsUsed })
  if (!done) { stopped = task; break }
}

phase('Report')

// STOP distillation — local model (wf-scout), fuzzy ~10-line budget.
let distill = null
if (stopped) {
  const errFile = `${stopped.runDir}/${stopped.id}_a2_error.md`
  distill = await agent(
    `Inspect the failure for task ${stopped.id}. Check if gate reports exist at ${errFile} or ${stopped.runDir}/${stopped.id}_a1_error.md (if absent, the worker timed out or hit max_turns). ` +
    'Read the touched files and the verify command. Distill for the human: what was attempted, why it failed (most likely cause), and a suggested fix. ' +
    'About 10 lines; a few more only if complexity demands. Plain text, no preamble.',
    { label: `distill:${stopped.id}`, agentType: 'wf-scout', model: a.scoutModel, effort: 'low' },
  )
}

return {
  feature: a.feature,
  total: a.tasks.length,
  done: report.filter((r) => r.done).length,
  seniorAssists: report.filter((r) => r.attempts > 2).length,
  stopped: stopped ? stopped.id : null,
  runDir: a.tasks[0].runDir,
  tasks: report,
  distill: distill ?? null,
}
