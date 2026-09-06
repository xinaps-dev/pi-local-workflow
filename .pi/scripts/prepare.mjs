// prepare.mjs — validates tasks.md, reads the worker/scout profiles, and emits
// the args JSON that the wf-go relay passes VERBATIM to SubagentWorkflow.
// Also creates the run directory (~/.pi/pi-local-workflow/tmp/<project>/runs/<ts>)
// with a commented manifest and one task-file per unchecked task.
// usage: node .pi/scripts/prepare.mjs [feature-slug]
// stdout: the args JSON (machine-readable). stderr: human notes.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CHANGES, MODELS_JSON, SCRIPTS, PROJECT_ROOT, findFeature, parseTasks, validateTasks, wfRunsDir, timeStamp, nowLine, IS_WINDOWS } from './lib.mjs'

let feature
try { feature = findFeature(process.argv[2]) } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1) }

const dir = join(CHANGES, feature)
const tasksPath = join(dir, 'tasks.md')
const resultsPath = join(dir, 'results.md')
if (!existsSync(tasksPath)) { console.error(`ERROR: tasks.md not found for feature "${feature}"`); process.exit(1) }

const tasks = parseTasks(readFileSync(tasksPath, 'utf8'))
const errs = validateTasks(tasks)
if (errs.length) {
  for (const e of errs) console.error(`ERROR: ${e}`)
  console.error('ERROR: tasks.md contract is broken — fix before running wf-go.')
  process.exit(1)
}

const unchecked = tasks.filter((t) => !t.checked)
if (unchecked.length === 0) {
  console.log(JSON.stringify({ status: 'empty', feature, note: 'nothing to do — suggest /skill:wf-archive' }, null, 2))
  process.exit(0)
}

if (!existsSync(MODELS_JSON)) { console.error('ERROR: specs/config/models.json missing — run node .pi/scripts/init.mjs'); process.exit(1) }

// H1 — validate models.json: clear error, never a raw stack.
let models
try { models = JSON.parse(readFileSync(MODELS_JSON, 'utf8')) }
catch (e) {
  console.error(`ERROR: ${MODELS_JSON} is not valid JSON — ${e.message}`)
  console.error('Fix the file (trailing commas/quotes are the usual suspects) and re-run.')
  process.exit(1)
}
if (!models.worker?.provider || !models.worker?.model || !models.scout?.provider || !models.scout?.model) {
  console.error('ERROR: models.json must define worker.{provider,model} and scout.{provider,model}')
  process.exit(1)
}
const workerModel = `${models.worker.provider}/${models.worker.model}`
const scoutModel = `${models.scout.provider}/${models.scout.model}`

// OS-aware verify resolution — specs are repo-shared, so tasks.md may carry a
// POSIX `verify:` plus an optional Windows `verify-win:` twin. The variant for
// THIS runtime is picked here (deterministic code), never by an LLM layer.
const POSIX_ONLY_BINS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'curl', 'wget', 'cat', 'ls', 'touch', 'xargs', 'tee', 'head', 'tail'])
function resolveVerify(t) {
  if (IS_WINDOWS && t['verify-win']) return { verify: t['verify-win'], source: 'verify-win' }
  const bin = (t.verify || '').trim().split(/\s+/)[0]
  if (IS_WINDOWS && !t['verify-win'] && POSIX_ONLY_BINS.has(bin)) {
    console.error(`WARNING: ${t.id} has a POSIX-only verify ("${bin}") and no verify-win: — it will likely fail on this OS`)
  }
  return { verify: t.verify, source: 'verify' }
}

if (!existsSync(resultsPath)) writeFileSync(resultsPath, `# Results: ${feature}\n`)

// Pre-create target parent directories so workers never fail on missing directories.
for (const t of unchecked) {
  if (t.files) {
    for (const f of t.files.split(/[\s,]+/).filter(Boolean)) {
      const parentDir = dirname(join(PROJECT_ROOT, f))
      mkdirSync(parentDir, { recursive: true })
    }
  }
}

// ---- run directory (H2 — mkdir as atomic lock, readable _N suffix) ----------
// runs/ may not exist yet on a fresh machine — create it before the lock loop.
mkdirSync(wfRunsDir(), { recursive: true })
let runDir = join(wfRunsDir(), timeStamp())
for (let n = 2; ; n++) {
  try { mkdirSync(runDir); break }
  catch (e) {
    if (e.code !== 'EEXIST') { console.error(`ERROR: cannot create run dir: ${e.message}`); process.exit(1) }
    runDir = join(wfRunsDir(), `${timeStamp()}_${n}`)
  }
}

// Manifest — jsonc so it can carry comments; safe to delete wholesale.
writeFileSync(join(runDir, 'run.jsonc'), `// wf-go run manifest — this whole directory is scratch; safe to delete.
// Kept only when a task STOPs (error files are investigation evidence).
{
  "feature": ${JSON.stringify(feature)},
  "started": ${JSON.stringify(nowLine())},
  "workerModel": ${JSON.stringify(workerModel)},
  "tasks": [${unchecked.map((t) => JSON.stringify(t.id)).join(', ')}],
}
`)

const checkMjs = join(SCRIPTS, 'check.mjs')
const taskEntries = unchecked.map((t) => {
  const { verify, source } = resolveVerify(t)
  const taskFile = join(runDir, `${t.id}.json`)
  writeFileSync(taskFile, JSON.stringify({
    id: t.id,
    feature,
    files: t.files,
    verify,
    verifySource: source,
    tasksPath,
    resultsPath,
    runDir,
  }, null, 2))
  return {
    id: t.id,
    block: t.block.join('\n'),
    runDir,
    // The gate command — attempt suffix is appended by the workflow (a1/a2).
    gate: `node ${JSON.stringify(checkMjs)} ${JSON.stringify(taskFile)}`,
  }
})

// F1 — generate the per-run script with the data INLINED: the relay copies ONE
// short path (no multi-KB JSON through the session model = no fidelity risk).
const goSourcePath = join(PROJECT_ROOT, '.agents', 'workflows', 'wf-go.js')
const marker = '// ---- BODY'
const src = readFileSync(goSourcePath, 'utf8')
const idx = src.indexOf(marker)
if (idx === -1) {
  console.error(`ERROR: wf-go.js is missing the "${marker}" marker — cannot generate the run script`)
  process.exit(1)
}
const runData = { feature, workerModel, scoutModel, tasks: taskEntries }
const runScriptPath = join(runDir, 'wf-go-run.js')
writeFileSync(runScriptPath,
  src.slice(0, idx) +
  `// args inlined by prepare.mjs at ${nowLine()} (F1: the relay copies one path)
const args = ${JSON.stringify(runData, null, 2)};

` +
  src.slice(idx))

// What the relay copies verbatim into the SubagentWorkflow call.
console.log(JSON.stringify({ scriptPath: runScriptPath }, null, 2))
console.error(`run dir: ${runDir}`)
console.error(`feature: ${feature} · ${unchecked.length} unchecked task(s) · worker: ${workerModel}`)
