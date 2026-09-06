// new-feature.mjs — deterministic feature scaffolding.
// The LLM never picks slugs or dates: this script normalizes the slug from the
// title, stamps the system date, and enforces ONE active feature.
// usage: node .pi/scripts/new-feature.mjs "<feature title>"
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGES, dateStamp, slugify, featureDirs, wfFeatureDir } from './lib.mjs'

const title = process.argv.slice(2).join(' ').trim()
if (!title) {
  console.error('usage: node .pi/scripts/new-feature.mjs "<feature title>"')
  process.exit(1)
}
const slug = slugify(title)
if (!slug) { console.error('ERROR: cannot derive a slug from that title'); process.exit(1) }

const others = featureDirs().filter((d) => d !== slug)
if (existsSync(join(CHANGES, slug))) {
  console.error(`ERROR: feature already exists: ${slug} — continue planning in it, or archive it first (/skill:wf-archive)`)
  process.exit(1)
}
if (others.length) {
  console.error(`ERROR: active feature(s) already present: ${others.join(', ')} — archive first (/skill:wf-archive). One active feature at a time.`)
  process.exit(1)
}

const dir = join(CHANGES, slug)
mkdirSync(dir, { recursive: true })

// Clean up any stale scratchpad from an older abandoned feature with the same slug
rmSync(wfFeatureDir(slug), { recursive: true, force: true })

writeFileSync(join(dir, 'plan.md'), `# Plan: ${slug}

**Date**: ${dateStamp()} · **Status**: draft

## Request
(TODO — the user request, verbatim essentials)

## Solution
(TODO — proposed approach, files involved (classify each: pure logic vs I/O shell), hard algorithms to pre-bake in reference.md, risks. Use scout evidence for paths; never invent them. Language-agnostic: the feature may be in ANY language.)
`)
writeFileSync(join(dir, 'results.md'), `# Results: ${slug}
`)

console.log(`Feature created: specs/changes/${slug}`)
console.log('Next: fill plan.md (interview + scout + planner via /skill:wf-plan)')
