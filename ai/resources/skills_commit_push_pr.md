# Commit, Push & PR Workflow

Conventions for committing, pushing, and opening pull requests in this repo,
based on its actual git history — not an invented process.

## Commit message

- Conventional commit format: `type(scope): short description`, imperative,
  lowercase. Scope is free-form and can be multiple words (`fix(meet tab):
  support ask to join`, `refactor(all): modules and release pipeline`) — it
  does not have to be a single module name.
- **Do not** add a `Co-Authored-By` or any other AI-attribution trailer to
  commits in this repo (see the root `CLAUDE.md`/`AGENTS.md`).
- Only commit when the user asks. If it's unclear whether they want a commit
  made, ask first.

## Branch naming

- If on `main`, create a new branch before committing — short, lowercase,
  kebab-case, named for the change (`quick-fix`, `fix-booking-confirmation`).

## `main` is protected

Pushes to `main` require a PR through a merge queue with a passing `check`
status (see repo branch protection). Don't assume a direct push will land
cleanly — branch and open a PR unless told otherwise.

## Pull requests

- No PR template file exists in this repo (`.github/pull_request_template.md`
  is absent) — write a plain, concise PR body: what changed and why, not a
  fixed set of headings.
- PR title follows the same `type(scope): description` format as commits.
- No labels are applied to PRs in this repo's history — don't invent a label
  scheme.
- Do not add Claude Code attribution or "Generated with" lines to the PR
  body, consistent with the commit-message rule above.
