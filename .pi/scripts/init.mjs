// init.mjs — idempotent scaffolding for the workflow system.
// Non-goal: no server/model/endpoint checks —
// inference problems surface as subagent errors and are handled by wf-go.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGES, HISTORY, CONFIG, MODELS_JSON, PROJECT_ROOT } from './lib.mjs'

const rows = []
const row = (item, status) => rows.push([item, status])

for (const d of [CONFIG, HISTORY, CHANGES]) {
  const before = existsSync(d)
  mkdirSync(d, { recursive: true })
  row(d.replace(PROJECT_ROOT + '/', ''), before ? 'ready' : 'created')
}

if (!existsSync(MODELS_JSON)) {
  // Default profile — the user edits this to match their own server/models.
  writeFileSync(MODELS_JSON, JSON.stringify({
    worker: { provider: 'llama.cpp', model: 'qwen3.8-27B' },
    scout: { provider: 'llama.cpp', model: 'qwen3.8-27B' },
  }, null, 2) + '\n')
  row('specs/config/models.json', 'created (default — edit to match your server)')
} else {
  row('specs/config/models.json', 'exists')
}

for (const a of ['wf-worker.md', 'wf-scout.md', 'wf-planner.md']) {
  row(`.pi/agents/${a}`, existsSync(join(PROJECT_ROOT, '.pi', 'agents', a)) ? 'ok' : 'MISSING')
}
row('.agents/workflows/wf-go.js', existsSync(join(PROJECT_ROOT, '.agents', 'workflows', 'wf-go.js')) ? 'ok' : 'MISSING')
row('.pi/scripts/check.mjs', existsSync(join(PROJECT_ROOT, '.pi', 'scripts', 'check.mjs')) ? 'ok' : 'MISSING')

const w = Math.max(...rows.map(([i]) => i.length))
for (const [item, status] of rows) console.log(`  ${item.padEnd(w)}  ${status}`)
console.log('')
const missing = rows.filter(([, s]) => s === 'MISSING')
if (missing.length) {
  console.log('ERROR: missing components above — fix before using the system.')
  process.exit(1)
}
console.log('System initialized. Next: /skill:wf-plan')
