# AI Agent Root Rules

Read this file first. It is the entry point for all AI work on the `saar` Chrome extension. Load
only the resource files you actually need — progressive context building keeps work fast and
focused.

Saar is a single-package TypeScript project (WXT, Manifest V3) — there is no separate backend,
frontend app, or automations directory to branch on. Every file here applies to the whole repo.

---

## Core Principles

These are non-negotiable. They apply to every task, every file, every decision.

1. **Security first** — never introduce code that could be exploited. Favour defensive patterns.
2. **Quality over speed** — follow coding standards rather than cutting corners.
3. **Consistency** — match existing patterns, libraries, and conventions already in the codebase.
4. **Incremental changes** — prefer small, targeted changes. Avoid sweeping refactors unless
   explicitly asked.
5. **Self-documenting code** — clear naming and structure over comments that explain what the code
   does.

---

## Mandatory Rules

These apply before, during, and after every task — no exceptions.

### Tools: Load the Reference File Before Using Any Tool

Before invoking any MCP or external tool, read its reference file from `ai/resources/tools/`. These
files explain how the tool works in this repo and what it is used for. **Using a tool without
reading its reference file first is not allowed.**

| Tool                           | Reference File                  |
| ------------------------------- | -------------------------------- |
| `smritix` (`mcp__smritix__*`)   | `ai/resources/tools/smritix.md` |

Add a new row here whenever a new tool is added to the repo. Remove a row if the tool is no longer
configured — a reference file for a tool that isn't there is worse than no file.

### README Files: Load Before Touching Any Folder

Before modifying any file, read the `README.md` in its directory and in every parent directory, up
to and including the repo root — the root `README.md`'s "Architecture" section is this project's
system-structure documentation; there is no separate `architecture.md` to keep in sync with it.

### README Files: Keep in Sync After Changes

After making changes, check whether the `README.md` in the affected directory (and any parent README
that describes it) is still accurate. If the change adds, removes, or renames something the README
describes, **update the README before the task is considered done**.

### Guideline Conflicts: Propose a Change, Do Not Silently Compromise

If a user request conflicts with any loaded guideline, do not silently break the rule. Instead:

1. Clearly state which guideline is in conflict and why.
2. Propose a specific edit to the relevant file in `ai/resources/`.
3. Let the user decide: update the guideline, or proceed as a deliberate exception.

---

## Task Workflow

Follow these steps in order for every task.

### Step 1 — Load Phase 1 (Foundation — always required)

1. **`coding_principles.md`** — engineering philosophy and values
2. Root **`README.md`**, "Architecture" section — ports-and-adapters structure, module boundaries

### Step 2 — Load Phase 2 (always required for code changes)

1. `coding_practices_typescript.md` — strict-mode conventions, `@/` alias, ports-as-interfaces,
   readonly data shapes, comment style
2. `coding_practices_chrome_extension.md` — MV3 permissions, service-worker lifetime, storage,
   dependency-cruiser/ESLint-enforced module boundaries

### Step 3 — Load Phase 3 (Conditional — only if the concept applies)

| If your task involves…                                        | Load this file                                    |
| --------------------------------------------------------------- | -------------------------------------------------- |
| OOP patterns, composition, inheritance, polymorphism            | `coding_practices_object_oriented_programming.md` |
| Committing, pushing, or opening a pull request                  | `skills_commit_push_pr.md`                         |
| Creating a GitHub issue                                         | `skills_create_github_issue.md`                    |

### Step 4 — Plan Before Writing Code

1. Read the `README.md` files for all directories your task will touch (see Mandatory Rules above).
2. Break the task into a step-by-step list before writing any code.
3. Identify which guidelines from the loaded files apply to each step.

### Step 5 — During Implementation

- Reference loaded guidelines for every construct you create or modify.
- Follow the naming and typing conventions in `coding_practices_typescript.md` exactly.
- Respect the domain/ui/meet boundaries in `coding_practices_chrome_extension.md` — they are
  enforced by `npm run deps` and ESLint, not just convention.

### Step 6 — Complete (Quality Assurance — always required)

Run `npm run check` (typecheck + lint + `dependency-cruiser` + tests) before considering a task
done. Verify: code follows all loaded guidelines, the command passes clean, no new warnings.

---

## Resource File Index

All resource files available in `ai/resources/`:

| File                                              | Purpose                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `coding_principles.md`                            | Engineering philosophy and values                                      |
| `coding_practices_typescript.md`                  | TypeScript conventions specific to this codebase                       |
| `coding_practices_chrome_extension.md`            | Manifest V3 / WXT practices and enforced architecture boundaries        |
| `coding_practices_object_oriented_programming.md` | Conditional — load only if task involves inheritance/composition       |
| `skills_commit_push_pr.md`                        | Conditional — commit/push/PR conventions                               |
| `skills_create_github_issue.md`                   | Conditional — GitHub issue conventions                                 |

---

## Conflict Resolution

When guidelines from different files conflict:

1. Phase 1 (Foundation) takes highest precedence.
2. Phase 2 files override Phase 1 for TypeScript/Chrome-extension-specific details.
3. Phase 3 files override earlier phases for their specific concept area.
4. When in doubt, follow the most restrictive or secure approach.

---

## File Maintenance

Update this file when:

- A new resource file is added to `ai/resources/` — add it to the index and the correct phase.
- A new tool is added — add a row to the tool table. Remove a row if a tool is no longer configured.
