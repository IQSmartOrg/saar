# TypeScript Conventions

This project compiles under `tsconfig.json`'s `strict: true`, plus
`noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax`
(see `tsconfig.json`). These are enforced by `npm run typecheck` — write code
that satisfies them rather than reaching for `as`/`!` to silence them.

## Type-only imports

`verbatimModuleSyntax` means a type-only import must say so:

```ts
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '@/settings/types';
import type { Unsubscribe } from '@/utils/types';
```

Mixing a value and its type in one import (as in the first line above) is
fine — only the type gets the `type` keyword.

## Path alias

Import across module boundaries with the `@/` alias (`@/settings/types`, not
a relative `../../settings/types`). It is declared once in `tsconfig.json`
and mirrored in `wxt.config.ts`'s dependency-cruiser setup — do not add a
second alias convention.

## Interfaces as ports, one concrete implementation

The dominant shape in this codebase is an interface describing a capability,
with a single class implementing it against a real API:

```ts
export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<void>;
  onChange(cb: (s: Settings) => void): Unsubscribe;
}

export class ChromeSettingsStore implements SettingsStore { /* ... */ }
```

This is what lets domain code be tested without Chrome APIs and swapped for
a fake in tests. Don't reach for more OOP than this — see
`coding_practices_object_oriented_programming.md` for when (rarely) more is
warranted.

## Readonly by default

Data-shape interfaces mark every field `readonly`:

```ts
export interface Settings {
  readonly botAccountIndex: number | null;
  readonly autoJoin: boolean;
  // ...
}
```

Mutation happens by producing a new object (`{ ...current, ...patch }`), not
by writing through a reference.

## No `any`, narrow casts only where the type system genuinely cannot know

`chrome.storage` returns `Record<string, unknown>`-shaped data with no way
for TypeScript to know the stored shape. Cast narrowly, at the one point
where the data re-enters the typed world, not upstream of it:

```ts
return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] as Partial<Settings> | undefined) };
```

Do not introduce `any` to make an error go away — either the type is
genuinely unknown at that point (cast narrowly, as above) or the code has a
real type error worth fixing.

## Explicit return types on exported functions and methods

Every method above declares its return type (`Promise<Settings>`,
`Promise<void>`, `Unsubscribe`) rather than relying on inference. This is
what makes a signature readable without reading the body, and it is what
catches an accidental `undefined` return path at the declaration site
instead of at some distant call site.

## Comments explain why, not what

Consistent with this repo's overall style (see the root `CLAUDE.md`/
`AGENTS.md` chain): a comment exists only for a non-obvious constraint,
platform quirk, or the reason behind a choice — never to restate what the
next line already says. `wxt.config.ts` and `src/settings/types.ts` are good
examples to match tone against.

## Testing

Vitest + `happy-dom` + `fake-indexeddb` (see `vitest.config.ts`). Domain
modules (`src/meet`, `src/processing`, `src/utils`, etc.) are designed to be
testable without a real browser — see
`coding_practices_chrome_extension.md` for the boundary rules that make that
possible. Write tests against the interface a module exposes, not its
internals, and prefer one test module can be understood in isolation over a
suite that requires reading five files to follow.
