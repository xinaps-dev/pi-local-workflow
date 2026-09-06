// check.mjs — THE GATE. Runs automatically after each wf-worker attempt
// (as the agent's `gate` command). Fully deterministic: no LLM anywhere.
//
//   node check.mjs <taskFile.json> <a1|a2>
//
// Order of checks (any failure writes <TNNN>_<attempt>_error.md and exits 1):
//   1. result file exists (worker wrote its footer file as instructed)
//   2. footer parses: ===WF-RESULT===...===WF-END=== with STATUS/SUMMARY/FILES
//   3. STATUS must be DONE (BLOCKED = failed attempt, reason recorded)
//   4. verify command (if any) must exit 0        ← the only real truth
//   5. success: mark [x] (exact line edit) + append results.md + cleanup
// Cleanup: on success the task's result/error files are deleted; when the last
// unchecked task passes, the whole run directory is removed (clean run).
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dateStamp, nowLine, PROJECT_ROOT, verifyDenyErrors } from './lib.mjs'

const [,, taskFileArg, attemptArg] = process.argv
const attempt = String(attemptArg || '').replace(/^a?/i, (s) => 'a')
if (!taskFileArg || !/^a[1-9]$/.test(attempt)) {
  console.error('usage: node check.mjs <taskFile.json> <a1..a9>')
  process.exit(1)
}
if (!existsSync(taskFileArg)) { console.error(`ERROR: task file not found: ${taskFileArg}`); process.exit(1) }

const task = JSON.parse(readFileSync(taskFileArg, 'utf8'))
const resultFile = join(task.runDir, `${task.id}_${attempt}_result.md`)
const errorFile = join(task.runDir, `${task.id}_${attempt}_error.md`)
const attemptNum = Number(attempt.slice(1))

function die(cause, verifyOutput) {
  const tail = (verifyOutput || '').split('\n').filter(Boolean).slice(-40).join('\n')
  writeFileSync(errorFile, `# ${task.id} ${attempt} — gate failure
<!-- feature: ${task.feature} · run: ${task.runDir} · ${nowLine()} -->
<!-- files: ${task.files || '(none)'} -->

## Cause
${cause}

${tail ? `## Verify output (tail)\n\n\`\`\`\n${tail}\n\`\`\`\n` : ''}`)
  console.error(`GATE FAIL ${task.id} ${attempt}: ${cause}`)
  process.exit(1)
}

// 1+2+3 — the footer travels by FILE; a "completed" worker that did not write
// it (turn limit, partial work, forgot) fails here even if verify would pass.
if (!existsSync(resultFile)) die(`result file missing: worker did not report — ${resultFile}`)
const raw = readFileSync(resultFile, 'utf8')
const fm = raw.match(/===WF-RESULT===([\s\S]*?)===WF-END===/)
if (!fm) die('footer malformed: ===WF-RESULT===/===WF-END=== sentinels not found in result file')
const body = fm[1]
const st = body.match(/^STATUS:\s*(\S+)\s*$/m)
if (!st || !['DONE', 'BLOCKED'].includes(st[1])) die('footer malformed: STATUS line missing or not DONE|BLOCKED')
const summaryMatch = body.match(/^SUMMARY:\s*([\s\S]*?)(?=\nFILES:)/m)
const summary = summaryMatch ? summaryMatch[1].trim() : '(none)'
const files = (body.match(/^FILES:\s*(.*)$/m) || [null, ''])[1].trim()
if (st[1] === 'BLOCKED') die(`worker reported BLOCKED — ${summary}`)

// 4 — verify: the exit code is the only truth (rule 5 of the constitution).
// Defense in depth: validate-tasks.mjs already rejects deny-list commands, but
// tasks.md could be edited between validation and run — re-check here.
let verifyNote = 'no verify'
if (task.verify) {
  const denyHits = verifyDenyErrors(task.verify)
  if (denyHits.length) die(`verify rejected by deny-list (${denyHits.join(', ')}) — fix the task battery`)
  const timeout = Number(process.env.WF_VERIFY_TIMEOUT_MS || 180000)
  const r = spawnSync(task.verify, {
    shell: true, encoding: 'utf8', timeout, cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024,
  })
  if (r.status !== 0) {
    die(`verify failed (exit ${r.status ?? 'null'}${r.signal ? `, signal ${r.signal}` : ''})`, `${r.stdout || ''}\n${r.stderr || ''}`)
  }
  verifyNote = 'verify: exit 0'
}

// 5 — state update: exact one-line edit, never a rewrite.
const lines = readFileSync(task.tasksPath, 'utf8').split('\n')
const idx = lines.findIndex((l) => l.startsWith(`- [ ] ${task.id} `))
if (idx === -1) {
  if (lines.some((l) => l.startsWith(`- [x] ${task.id} `))) die('task already marked [x] — unexpected double gate run')
  die(`task line not found in tasks.md: "- [ ] ${task.id} " (was tasks.md edited mid-run?)`)
}
lines[idx] = lines[idx].replace('- [ ] ', '- [x] ')
writeFileSync(task.tasksPath, lines.join('\n'))

appendFileSync(task.resultsPath, `\n## ${task.id} · ${dateStamp()} · DONE · attempt ${attemptNum} · ${verifyNote}\nSUMMARY: ${summary}\nfiles: ${files || '(none)'}\n`)

// Cleanup: this task's scratch files; whole run dir when nothing unchecked remains.
for (const f of [resultFile, errorFile]) if (existsSync(f)) unlinkSync(f)
const remainingUnchecked = readFileSync(task.tasksPath, 'utf8').match(/^- \[ \] T\d{3} /m)
let cleanupNote = 'task scratch removed'
if (!remainingUnchecked) {
  rmSync(task.runDir, { recursive: true, force: true })
  cleanupNote = 'run dir removed (feature complete, clean run)'
}

console.log(`GATE OK ${task.id} ${attempt} · ${verifyNote} · ${cleanupNote}`)
process.exit(0)
