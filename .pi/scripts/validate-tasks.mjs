// validate-tasks.mjs — deterministic validation of the tasks.md contract.
// Runs BEFORE the human gate in wf-tasks. Errors are exact; a model validating
// its own format would be the fox guarding the henhouse.
//
// Small-model quality bar (agreement 011):
//   ERROR  — a task touching more than 2 files (not junior-sized)
//   WARNING— no verify (weak guarantee), existence-only verify, a verify
//            binary missing from PATH, a description chaining actions, or an
//            orchestrator-shaped task (>=3 dependencies) with a syntax-only verify
//            (Rule 6, agreement 032: a state-coordinating task whose battery cannot
//            execute the module is the exact shape that lets a junior invent design)
// Warnings never block; they are surfaced so the human gate decides with
// full information. Per-task verify coverage is printed (behavioral /
// syntax-only / existence / none).
// usage: node .pi/scripts/validate-tasks.mjs [feature-slug]
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGES, findFeature, parseTasks, validateTasks, wfFeatureSymbolsPath, binInPath, verifyDenyErrors } from './lib.mjs'

let feature
try { feature = findFeature(process.argv[2]) } catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1) }

const tasksPath = join(CHANGES, feature, 'tasks.md')
if (!existsSync(tasksPath)) { console.error(`ERROR: tasks.md not found for feature "${feature}"`); process.exit(1) }

const tasks = parseTasks(readFileSync(tasksPath, 'utf8'))
if (tasks.length === 0) { console.error('ERROR: no tasks found (format: "- [ ] T001 ..." with 6-space indented keys)'); process.exit(1) }

const errs = validateTasks(tasks)

// Cognitive-load lint: every task must be executable by a small local model
// with zero design decisions.
const isTextOrExistenceBin = (cmd) => {
  if (!cmd) return false
  const bin = cmd.trim().split(/\s+/)[0]
  if (/^(\[|test|grep|rg|fgrep|egrep)$/.test(bin)) return true
  if (/\|\s*(grep|rg|fgrep|egrep)\b/.test(cmd)) return true
  return false
}

const isSyntaxOnlyVerify = (cmd) => {
  if (!cmd) return false
  return /(--check|-fsyntax-only|\bpy_compile\b|\bcargo\s+check\b|\bgo\s+vet\b|\btsc\s+--noEmit\b|\bdotnet\s+build\b|\bswiftc\s+-typecheck\b|\bzig\s+build-obj\b)/.test(cmd)
}

const tierOf = (t) => {
  if (!t.verify) return 'none'
  if (/^(\[ -[fd] |test -[fd] )/.test(t.verify)) return 'existence'
  if (isTextOrExistenceBin(t.verify)) return 'shallow'
  if (isSyntaxOnlyVerify(t.verify)) return 'syntax-only'
  return 'behavioral'
}
const warns = []
for (const t of tasks) {
  const nFiles = t.files.split(/[\s,]+/).filter(Boolean).length
  if (nFiles > 2) errs.push(`${t.id}: touches ${nFiles} files (max 2) — not junior-sized, split the task`)
  if (tierOf(t) === 'none') warns.push(`${t.id}: no verify — weak guarantee (results.md must say so)`)
  else if (tierOf(t) === 'existence') warns.push(`${t.id}: verify is existence-only — prefer a behavioral check`)
  else if (tierOf(t) === 'shallow') warns.push(`${t.id}: verify is a text-search command (grep/test) — verify must execute behavioral tests or native compiler syntax checks`)
  if (!t.needs) warns.push(`${t.id}: missing "needs:" (use "needs: none" or comma-separated task IDs)`)

  // Rule 6 (agreement 032): orchestrator-shaped task with weak battery.
  // Purely structural: dependency count (quantitative) + existing verify tier
  // classification. No extension whitelists, no keyword regexes, no natural-language
  // parsing (Laws 2 and 3). A task consuming many earlier mechanisms while its own
  // verify cannot even load the module is the exact shape that lets a junior invent
  // state-machine design undetected. Warning, never error: genuinely unloadable
  // platform artifacts may be consciously accepted at the human gate.
  const needsCount = (t.needs || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'none').length
  if (needsCount >= 3 && tierOf(t) === 'syntax-only') {
    warns.push(`${t.id}: orchestrator-shaped task (${needsCount} dependencies) with syntax-only verify — the module is not executed by its own battery. If it is import-safe, use a runtime-load verify with exported-contract assertions; if genuinely unloadable, the notes must be a closed specification (state shape, transitions, timing) and the human gate must consciously accept this`)
  }

  // Security deny-list: verify commands reach the gate via shell — destructive
  // or remote-exec payloads are a contract ERROR, not a warning.
  for (const key of ['verify', 'verify-win']) {
    for (const label of verifyDenyErrors(t[key])) {
      errs.push(`${t.id}: ${key} rejected by deny-list (${label}) — rewrite the verification without destructive/remote-exec operations`)
    }
  }

  // Spec-Test Literal Congruence: warn if verify tests literal element IDs or flags missing from notes
  const assertedIdMatches = [...(t.verify || '').matchAll(/\bid=\\?["']([a-zA-Z0-9_-]+)\\?["']/g)].map((m) => m[1])
  for (const id of assertedIdMatches) {
    if (!t.notes.includes(id)) {
      warns.push(`${t.id}: verify asserts element ID "${id}" which is missing from task notes — declare it explicitly in notes`)
    }
  }
  const ignoreRunnerFlags = new Set(['--check', '--input-type', '--test', '--experimental-vm-modules', '--loader'])
  const assertedFlagMatches = [...(t.verify || '').matchAll(/\s(--[a-zA-Z0-9_-]+)\b/g)]
    .map((m) => m[1])
    .filter((f) => !ignoreRunnerFlags.has(f))
  for (const flag of assertedFlagMatches) {
    if (!t.notes.includes(flag)) {
      warns.push(`${t.id}: verify asserts CLI flag "${flag}" which is missing from task notes — declare it explicitly in notes`)
    }
  }
}

// Universal Symbol Manifest validation (if ephemeral symbols manifest exists in scratchpad)
const symbolsPath = wfFeatureSymbolsPath(feature)
if (existsSync(symbolsPath)) {
  try {
    const manifest = JSON.parse(readFileSync(symbolsPath, 'utf8'))
    const refSet = new Set(manifest.reference || [])
    for (const t of tasks) {
      const taskSymbols = manifest.tasks?.[t.id]
      if (!taskSymbols) continue
      // Rule 1: Atomicity — max 2 symbols defined per task (pure mathematical count)
      const defines = taskSymbols.defines || []
      if (defines.length > 2) {
        errs.push(`${t.id}: defines ${defines.length} symbols in manifest (max 2) — monolithic task, split into incremental single-mechanism tasks`)
      }
      // Rule 2: File binding — symbol prefix must match one of task.files
      const declaredFiles = t.files.split(/[\s,]+/).filter(Boolean)
      for (const sym of defines) {
        const [symFile] = sym.split('::')
        if (symFile && !declaredFiles.includes(symFile)) {
          errs.push(`${t.id}: symbol "${sym}" does not belong to declared files "${t.files}"`)
        }
      }
      // Rule 3: SSOT — implemented reference symbol must exist in reference list
      if (taskSymbols.implements) {
        if (!refSet.has(taskSymbols.implements)) {
          errs.push(`${t.id}: implements "${taskSymbols.implements}" which is not defined in reference symbols list`)
        }
      }
    }

    // Rule 4: Callee before Caller — check for forward references to sibling methods
    const definedSymbolMap = new Map()
    tasks.forEach((t, i) => {
      const taskSymbols = manifest.tasks?.[t.id]
      if (!taskSymbols) return
      for (const sym of (taskSymbols.defines || [])) {
        const [file, scoped] = sym.split('::')
        if (scoped) {
          const parts = scoped.split('.')
          const shortName = parts[parts.length - 1]
          const container = parts.length > 1 ? parts[0] : null
          definedSymbolMap.set(sym, { taskId: t.id, taskIndex: i, shortName, container, file })
        }
      }
    })

    tasks.forEach((t, i) => {
      const taskSymbols = manifest.tasks?.[t.id]
      if (!taskSymbols) return
      for (const called of (taskSymbols.calls || [])) {
        const def = definedSymbolMap.get(called)
        if (def && def.taskIndex > i) {
          errs.push(`${t.id}: calls symbol "${called}" defined in later task ${def.taskId} (position ${def.taskIndex + 1} > ${i + 1}) — callee must precede caller`)
        }
      }
      for (const def of definedSymbolMap.values()) {
        if (def.taskIndex > i && def.container) {
          const containerMatch = t.notes.includes(def.container) || t.files.includes(def.file)
          const methodRef = new RegExp(`\\b${def.shortName}\\s*\\(`, 'g')
          if (containerMatch && methodRef.test(t.notes)) {
            errs.push(`${t.id}: notes reference method "${def.shortName}()" which is defined in later task ${def.taskId} (position ${def.taskIndex + 1} > ${i + 1}) — callee must precede caller`)
          }
        }
      }
    })

    // Rule 5: Closed data contracts — consumer field sets must be covered by the union
    // of STRICTLY EARLIER provides of the same data name (callee-before-caller for data).
    const dataRe = /^data::([A-Za-z0-9_.-]+)\{([^}]*)\}$/
    const provided = new Map() // name -> { fields:Set, taskId }
    tasks.forEach((t) => {
      const sym = manifest.tasks?.[t.id]
      if (!sym) return
      for (const req of (sym.requires || [])) {
        const m = dataRe.exec(String(req).trim())
        if (!m) { errs.push(`${t.id}: malformed requires entry "${req}" (expected data::<Name>{field1,field2})`); continue }
        const [, name, fieldsStr] = m
        const prov = provided.get(name)
        if (!prov) { errs.push(`${t.id}: requires data contract "data::${name}" which no earlier task provides`); continue }
        for (const f of fieldsStr.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!prov.fields.has(f)) {
            errs.push(`${t.id}: requires field "${f}" of data contract "${name}" not provided by task ${prov.taskId} (provides: ${[...prov.fields].join(', ') || 'none'})`)
          }
        }
      }
      for (const p of (sym.provides || [])) {
        const m = dataRe.exec(String(p).trim())
        if (!m) { errs.push(`${t.id}: malformed provides entry "${p}" (expected data::<Name>{field1,field2})`); continue }
        const [, name, fieldsStr] = m
        const fields = new Set(fieldsStr.split(',').map((s) => s.trim()).filter(Boolean))
        if (!fields.size) errs.push(`${t.id}: provides entry "${p}" declares no fields`)
        const prev = provided.get(name)
        if (prev) for (const f of fields) prev.fields.add(f)
        else provided.set(name, { fields, taskId: t.id })
      }
    })
  } catch (e) {
    warns.push(`could not parse symbol manifest at ${symbolsPath}: ${e.message}`)
  }
}

// Sanity: the verify command's binary should exist (catches invented "npm test").
// Pure-Node PATH probe (binInPath) — no shell, works on POSIX and Windows.
const seen = new Set()
for (const t of tasks) {
  for (const cmd of [t.verify, t['verify-win']]) {
    if (!cmd) continue
    const bin = cmd.trim().split(/\s+/)[0]
    if (seen.has(bin)) continue
    seen.add(bin)
    if (!binInPath(bin)) warns.push(`${t.id}: verify binary "${bin}" not found in PATH — does this command really exist in the project?`)
  }
}

// Immaculate scratchpad: a symbols.json inside specs/changes/<feature>/ is a stale scratch
// artifact — the symbol manifest lives only in the ephemeral scratchpad.
const staleSymbols = join(CHANGES, feature, 'symbols.json')
if (existsSync(staleSymbols)) {
  warns.push(`stale scratch file "${staleSymbols}" inside specs/ — the symbol manifest belongs to the ephemeral scratchpad; delete this file`)
}

for (const e of errs) console.error(`ERROR: ${e}`)
for (const w of warns) console.error(`WARNING: ${w}`)

if (errs.length) { console.error(`\n${errs.length} error(s) — fix tasks.md before approval.`); process.exit(1) }

const unchecked = tasks.filter((t) => !t.checked).length
console.log(`OK: ${tasks.length} tasks (${unchecked} unchecked) — contract valid.`)
console.log(`verify coverage: ${tasks.map((t) => `${t.id}=${tierOf(t)}`).join(' ')}`)
