// lib.mjs — shared helpers for the workflow CLI (.pi/scripts/)
// Pure Node stdlib, no deps. Deterministic by design: dates from the system,
// sequence numbering, fixed-format contracts.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, delimiter as pathDelimiter } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = dirname(dirname(__dirname)) // .pi/scripts → project
export const SPECS = join(PROJECT_ROOT, 'specs')
export const CHANGES = join(SPECS, 'changes')
export const HISTORY = join(SPECS, 'history')
export const CONFIG = join(SPECS, 'config')
export const MODELS_JSON = join(CONFIG, 'models.json')
export const SCRIPTS = __dirname

// Unique project identifier based on repo name + path hash (prevents collision between clones/worktrees)
export function projectKey() {
  const name = basename(PROJECT_ROOT).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const hash = createHash('sha256').update(PROJECT_ROOT).digest('hex').slice(0, 8)
  return `${name}-${hash}`
}

// Temp area for runs & scratchpad — outside the repo, safe to delete, human-inspectable.
export function wfTmpDir() {
  return join(homedir(), '.pi', 'pi-local-workflow', 'tmp', projectKey())
}

export function wfRunsDir() {
  return join(wfTmpDir(), 'runs')
}

export function wfFeatureDir(feature) {
  return join(wfTmpDir(), 'features', feature)
}

export function wfFeatureSymbolsPath(feature) {
  return join(wfFeatureDir(feature), 'symbols.json')
}

// ---- OS awareness -----------------------------------------------------------
// The deterministic scripts run on the developer's machine, so process.platform
// IS the runtime truth — detected here by code, never decided by an LLM layer.
export const IS_WINDOWS = process.platform === 'win32'

// Shell builtins cannot be probed on PATH; their presence is assumed (they are
// existence/shallow-tier verify commands anyway).
const SHELL_BUILTINS = new Set([
  'test', '[', 'echo', 'cd', 'exit', 'set', 'true', 'false', 'type', 'printf',
  'source', 'which', 'command', 'dir', 'md', 'rd', 'copy', 'del', 'where',
])

// Pure-Node PATH probe — no shell, identical semantics on POSIX and Windows
// (PATHEXT extensions on win32, executable bit on POSIX).
export function binInPath(bin) {
  if (!bin || SHELL_BUILTINS.has(bin)) return true
  const dirs = (process.env.PATH || '').split(pathDelimiter).filter(Boolean)
  const exts = IS_WINDOWS
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        const st = statSync(join(dir, bin + ext))
        if (st.isFile() && (IS_WINDOWS || (st.mode & 0o111) !== 0)) return true
      } catch { /* not here */ }
    }
  }
  return false
}

// ---- verify deny-list -------------------------------------------------------
// verify: commands are authored by the planner (an LLM fed with repo content)
// and executed with shell:true by the gate. A destructive or remote-exec
// payload must never reach the gate: rejected as ERROR before the human gate
// (validate-tasks.mjs) and re-checked at gate time (check.mjs) — defense in
// depth against tasks.md edits between validation and run.
const VERIFY_DENY_PATTERNS = [
  [/\brm\s+(?:-{1,2}[a-zA-Z]+\s+)*-{1,2}[a-zA-Z]*r/i, 'recursive rm (use language-native cleanup)'],
  [/\bmkfs\b/i, 'mkfs'],
  [/\bdd\s+if=/i, 'dd'],
  [/\bformat\s+[a-z]:/i, 'drive format'],
  [/\bdel\s+\/[sq]/i, 'recursive del'],
  [/\brmdir\s+\/s/i, 'recursive rmdir'],
  [/remove-item[^\n]*-recurse/i, 'recursive Remove-Item'],
  [/\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i, 'pipe to shell'],
  [/\|\s*powershell\b/i, 'pipe to powershell'],
  [/\binvoke-expression\b/i, 'Invoke-Expression'],
  [/\biex\s*\(/i, 'iex'],
  [/\bsudo\b/i, 'sudo'],
  [/\bgit\s+push\b/i, 'git push'],
  [/\bcrontab\b/i, 'crontab'],
  [/\breg\s+add\b/i, 'registry write'],
  [/\bregedit\b/i, 'regedit'],
  [/(?:^|[\s;])>+\s*\/(?!dev\/null\b|tmp\b)/, 'redirect to absolute root path (only /dev/null and /tmp allowed)'],
  [/(?:^|[\s;])>+\s*~/, 'redirect to home directory'],
  [/\bnohup\b/i, 'nohup'],
  [/\bdisown\b/i, 'disown'],
  [/\bshutdown\b/i, 'shutdown'],
  [/\breboot\b/i, 'reboot'],
  [/\bchmod\s+777\s+\//i, 'chmod 777 on absolute path'],
]

// Returns a list of deny-list violations for a verify command (empty = clean).
export function verifyDenyErrors(cmd) {
  if (!cmd) return []
  const errs = []
  for (const [re, label] of VERIFY_DENY_PATTERNS) {
    if (re.test(cmd)) errs.push(label)
  }
  return errs
}

const p2 = (n) => String(n).padStart(2, '0')
export function dateStamp() {
  const d = new Date()
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
export function timeStamp() {
  const d = new Date()
  return `${dateStamp().replace(/-/g, '')}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
}
export function nowLine() {
  const d = new Date()
  return `${dateStamp()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

export function slugify(title) {
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30).replace(/^-+|-+$/g, '')
}

// ---- tasks.md contract -----------------------------------------------------
// - [ ] T001 <description>
//       files: a, b
//       verify: <shell command>   (optional — exit 0 = done)
//       verify-win: <command>     (optional Windows variant, picked per-OS at prepare time)
//       notes: <prose>            (optional)
export function parseTasks(md) {
  const tasks = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[([ xX])\] (T\d{3}) (.*)$/)
    if (!m) continue
    const task = { checked: m[1] !== ' ', id: m[2], desc: m[3], files: '', needs: '', verify: '', notes: '', block: [lines[i]] }
    let j = i + 1
    while (j < lines.length) {
      const km = lines[j].match(/^ {6}(files|needs|verify|verify-win|notes):\s?(.*)$/)
      if (!km) break
      task[km[1]] = km[2].trim()
      task.block.push(lines[j])
      j++
    }
    tasks.push(task)
    i = j - 1
  }
  return tasks
}

export function validateTasks(tasks) {
  const errs = []
  const taskMap = new Map()
  tasks.forEach((t, i) => {
    taskMap.set(t.id, i)
    const expected = `T${String(i + 1).padStart(3, '0')}`
    if (t.id !== expected) {
      errs.push(`position ${i + 1}: expected id ${expected}, found ${t.id} (ids must be sequential from T001, no gaps/duplicates)`)
    }
    if (!t.files) errs.push(`${t.id}: missing "files:" (comma-separated paths)`)
  })

  tasks.forEach((t, i) => {
    if (t.needs && t.needs.toLowerCase() !== 'none') {
      const deps = t.needs.split(/[\s,]+/).filter(Boolean)
      for (const dep of deps) {
        if (!taskMap.has(dep)) {
          errs.push(`${t.id}: references non-existent dependency "${dep}" in "needs:"`)
        } else {
          const depIdx = taskMap.get(dep)
          if (depIdx >= i) {
            errs.push(`${t.id}: invalid forward dependency on "${dep}" (position ${depIdx + 1} >= ${i + 1}) — dependencies must precede consumers`)
          }
        }
      }
    }
  })

  return errs
}

export function featureDirs() {
  if (!existsSync(CHANGES)) return []
  return readdirSync(CHANGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
}

export function findFeature(explicit) {
  const dirs = featureDirs()
  if (explicit) {
    if (!dirs.includes(explicit)) throw new Error(`feature not found: ${explicit} (available: ${dirs.join(', ') || 'none'})`)
    return explicit
  }
  if (dirs.length === 0) throw new Error('no active feature in specs/changes/ — run /skill:wf-plan first')
  if (dirs.length > 1) throw new Error(`multiple active features: ${dirs.join(', ')} — pass one explicitly`)
  return dirs[0]
}
