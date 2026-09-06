// archive.mjs — deterministic close-out: NNN numbering, ARCHIVE line, move to
// history. The scout verification and the human gap-decision happen in the
// wf-archive skill BEFORE this runs.
// usage: node .pi/scripts/archive.mjs [feature-slug]
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGES, HISTORY, findFeature, parseTasks, dateStamp, wfFeatureDir } from './lib.mjs'

let feature
try { feature = findFeature(process.argv[2]) } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1) }

const dir = join(CHANGES, feature)
const tasksPath = join(dir, 'tasks.md')
if (!existsSync(tasksPath)) { console.error(`ERROR: tasks.md not found for feature "${feature}"`); process.exit(1) }

const tasks = parseTasks(readFileSync(tasksPath, 'utf8'))
const pending = tasks.filter((t) => !t.checked)
if (pending.length) {
  console.error(`ERROR: ${pending.length} unchecked task(s): ${pending.map((t) => t.id).join(', ')} — run /skill:wf-go first`)
  process.exit(1)
}

// NNN = next free integer in specs/history (never overwrite; %03d).
mkdirSync(HISTORY, { recursive: true })
const used = readdirSync(HISTORY)
  .map((d) => parseInt((d.match(/^(\d{3})-/) || [])[1] || '0', 10))
  .filter((n) => n > 0)
const nnn = String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')
const dest = join(HISTORY, `${nnn}-${feature}`)

if (existsSync(dest)) { console.error(`ERROR: destination already exists: ${dest} — never overwrite; fix numbering manually`); process.exit(1) }

appendFileSync(join(dir, 'results.md'), `\n## ARCHIVE · ${dateStamp()} · archived at history/${nnn}-${feature}\n`)
renameSync(dir, dest)

// Clean up ephemeral feature scratchpad
rmSync(wfFeatureDir(feature), { recursive: true, force: true })

console.log(`Archived: specs/history/${nnn}-${feature}`)
console.log('specs/history/ is the durable memory — future planners consult it. Next feature: /skill:wf-plan')
