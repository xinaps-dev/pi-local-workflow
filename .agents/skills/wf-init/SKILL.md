---
name: wf-init
description: Initializes the workflow system. Runs .pi/scripts/init.mjs which creates specs/{config,history,changes} and a default models.json if missing, and verifies the wf-* agents, the wf-go workflow and the CLI scripts exist. Use the first time the system is set up in a project.
---

# wf-init — system initialization

Mechanical: run the script and relay its report. No LLM judgment involved.

```bash
node .pi/scripts/init.mjs
```

- Missing components are listed as `MISSING` → surface them to the user; do
  not fix or create anything yourself.
- All OK → "System initialized. Next: `/skill:wf-plan`".

Note: this script never checks servers, endpoints or loaded models (the
framework treats subagent errors, not inference servers).
