# Create GitHub Issue Workflow

Conventions for creating issues in `IQSmartOrg/saar`, based on this repo's
actual issue history — not an invented process.

## Title

Plain, descriptive sentence — no enforced `scope: description` prefix (this
repo's issues read like "Support Calendar View for meets", "Revisit Index DB
Schema", not a fixed template).

## Labels

Use GitHub's default label set already present on this repo — `bug`,
`documentation`, `enhancement`, `good first issue`, `help wanted`,
`duplicate`, `invalid`, `question`, `wontfix`. Don't invent new labels
(there is no custom `engineering`/area-label scheme here, unlike some other
repos).

## Body

Keep it short: what the problem or request is, and enough context to act on
it. There's no mandatory section template in this repo's history — match
the level of detail an issue actually needs, not a fixed set of headings.

## Creating the issue

```
gh issue create --repo IQSmartOrg/saar --title "..." --body-file <body.md> [--label ...]
```

Only set labels that clearly apply; it's fine to create an issue with none,
as several in this repo's history do.
