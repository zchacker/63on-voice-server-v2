@RTK.md

## Token efficiency
- Use RTK for supported terminal commands.
- Search for relevant symbols before opening files.
- Read only files and sections relevant to the task.
- Avoid scanning vendor, node_modules, dist, build, and generated files unless necessary.
- Prefer targeted tests over running the full test suite.
- Do not repeatedly read unchanged files.
- Keep explanations concise.
- Preserve existing architecture and avoid unrelated changes.
- Request full command output when compact output hides necessary debugging details.
- do not read folder node_modules
- Treat demo/ as optional legacy reference; read demo/rooms.js only when relevant to the task.

## Project context
- Work from `/Users/hiramdiazdiaz/Documents/63on-voice-server-v2`.
- Read `AI_CONTEXT.md` first, then inspect only relevant source files.
- Prioritize `server.js`, `socket/`, and `services/`.
- Project skills are installed in `.agents/skills/`; load only relevant SKILL.md files and their requested references.
- Keep `AI_CONTEXT.md` updated when architecture, events, state, or integrations change.

## Required module architecture (owner-defined)
Applies to all future work in `socket/<module>/`. Preserve this feature-based layout:
- `*.events.js`: Socket.IO event/endpoint registration and delegation; keep handlers thin.
- `*.service.js`: Execute the event use case and send its responses/broadcasts. Coordinate validation and state operations here.
- `*.state.js`: Own and store that module's data; expose focused access/update functions. Keep unrelated module data out.
- `*.validation.js`: Check payload correctness AND permission/eligibility to execute each action (identity, roles, membership, ownership, and relevant state conditions). Return explicit validation outcomes; do not mutate state or emit responses here.
Execution flow: event -> service -> validation -> state mutation -> response/broadcast. Validate before effects. Recheck state-sensitive rules at mutation time when asynchronous work can invalidate earlier checks.
Validation must be enforced by the service so another caller cannot bypass it by skipping the event adapter. Authentication may supply identity centrally; module authorization still belongs in module validation.
The owner explicitly permits service responses via Socket.IO; do not impose a full ports/adapters rewrite. If later needed, suggest incremental transport isolation while preserving these four responsibilities.
Use `clean-code` and `clean-architecture` for relevant implementation/design work; read their SKILL.md and required mini references. Prefer small focused functions and explicit boundaries over extra layers.
This is the intended convention, not a claim that all four files already exist in every module or that current code fully follows it. Create missing files when needed by the requested change; do not add empty scaffolding across the project.
