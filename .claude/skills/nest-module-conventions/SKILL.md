---
name: nest-module-conventions
description: Use when writing, reviewing, or refactoring a NestJS feature module — adding a controller, command, query, service, guard or pipe, deciding which module or layer a new class belongs in, or judging whether a module's responsibilities have grown enough to justify splitting it.
---

# NestJS Module Architecture

How a feature is layered: who owns its data, which way dependencies point, and where a given responsibility belongs.

Two kinds of statement appear below, and they carry different weight:

- **Invariants** — marked on the section heading. Breaking one changes the architecture: ownership stops being enforceable, or a dependency cycle becomes possible. Treat these as requirements.
- **Conventions** — everything else, including all directory, file and class naming. They exist to make the architecture legible at a glance. Adopt them, or adopt a consistent alternative; either way the architecture is unchanged.

These layering rules narrow and extend the general patterns in the `nestjs-best-practices` skill — apply both, but on layering specifics, this skill wins.

## Architectural invariants

| Invariant | What it means |
|---|---|
| A domain owns its persistence model | One module is the only writer of a given slice of domain data |
| Dependencies point one way | Operations depend on domain; domain knows nothing of operations |
| Cross-module writes go through an owner-provided seam | Foreign writes enlist in the caller's transaction without leaving the owner's code |
| Commands own write use cases | A write scenario has one home, not several partial ones |
| Queries own read scenarios | Read shaping lives behind a named, testable boundary |
| Controllers stay thin | Transport handlers translate and delegate; they don't decide |
| Row-level access lives with read models | Data-dependent access rules are resolved once, not per endpoint |

## Two kinds of module

A feature with real lifecycle typically separates into a **domain** module and one or more **operations** modules.

**Domain module** — sole owner of a slice of domain data. Holds the entities or schemas, the invariants every writer must uphold, the shared vocabulary other modules import, the write seams for its own data, and read models over an aggregate's own state. Normally no controllers, no business read models, no schedulers.

**Operations module** — the business scenarios built on that domain, read and write alike. Holds the commands, the business read models, the mappers, the request/response contracts, the transport handlers and the schedulers. Owns no domain data of its own.

The point of the separation is that "who may write this data" stops being a matter of discipline and becomes a matter of module structure. A rule you have to remember is a rule that erodes; a rule the module graph enforces does not.

### Dependency direction — invariant

Strictly one-way: operations depends on domain, never the reverse. Nothing in a domain module may know that an operations module exists.

A domain module re-exports whatever registration grants access to its data-access objects, so operations modules can read through the owner rather than declaring a competing registration for data they don't own. Two modules independently registering the same persistence unit is the signal that ownership has gone ambiguous — resolve it by deciding which module owns the data, not by keeping both registrations in sync.

### Reads are open, writes go through a seam — invariant

Reading across domains is unrestricted. An operations module may read whatever its read models need and query it directly.

Writing data you don't own is not. The owning domain exposes an operation that accepts the **caller's transaction context**, so the write joins the caller's transaction while the only code that mutates that data stays inside its owner. What that context is — a session, a unit of work, a client handle — is a persistence-layer detail; the architectural requirement is only that the caller can pass it in and the seam honors it.

A cross-module write that bypasses the seam is a review finding even when it is correct today, because correctness there is incidental: the invariants live in the owner, and the next such write won't have read them.

## Commands — write use cases — invariant

Prefer one class per write use case over one service that accumulates them. The requirement is that a write scenario has a single identifiable home; the one-class-per-use-case shape is how that is usually achieved.

A command should normally own its transaction boundary, its business rules, and the validation that no declarative constraint on the request contract can express — cross-field rules, and rules that need a read to evaluate. When a command grows past readable, prefer decomposing it into named private steps within the class before reaching for a second class: the use case is still one use case, and splitting it into two entry points is what creates partial writes.

## Queries — read scenarios — invariant

Prefer one class per read scenario. Read-only, and raising the access errors its scenario requires.

Prefer composing small single-fact queries over growing one large one. A scenario query injects the narrow queries answering "may this caller see this record", "what are the counts", "what are the caller's own facts". Each stays independently testable and reusable by the next scenario.

A query should normally resolve what it needs itself, including the caller's identity from the request context. A transport handler should not reach into another module's service to prepare a query's arguments — that moves a piece of the read scenario into the handler, where the next endpoint won't find it.

## Mappers — pure shaping

A mapper combines records with facts its caller already resolved and returns the view. It should perform no data access of its own.

Cross-cutting output rules belong here rather than in each query. When several endpoints funnel through one mapper, enforcing a rule in a single query leaves the others leaking — the mapper is the one place that covers all of them at once.

## Services — what's left

What remains after commands and queries are collaborators of two shapes:

- **Write seams** in a domain module — the owner-side operation other modules call to mutate its data.
- **Side-effect seams** in an operations module — outbound effects such as notifications or uploads, kept behind one class so their failure policy lives in one place and a best-effort effect cannot roll back the action that triggered it.

A service that is really a write use case belongs with the commands; one that is really a read belongs with the queries. "Service" is not a third category of business logic — it is the name for collaborators that are neither.

## Controllers — invariant

Transport handlers stay thin, whatever the transport. A REST controller, a GraphQL resolver and an RPC handler carry the same responsibility: receive the request, let the guard/pipe/interceptor chain run, delegate, return the result.

A handler should normally delegate to a single command or query. Branching rules, calculations, or multi-step orchestration beyond that call mean a command or query is wearing a handler's clothes. Handlers pass the caller's identity and role flags — not decisions made on the caller's behalf.

## Access rules — invariant

Route-level authorization goes through the framework's guard mechanism, never inline in a handler. A project should have one blessed decorator/guard pairing and extend it, rather than growing a second mechanism — with two, nothing answers "what protects this route" in one place.

Access rules that depend on domain state are **not** guards. A guard answers "may this role call this operation" from the request alone. Deciding "which records, if any, may this caller see" needs the data, so it belongs in an access query that every scenario composes in. Centralizing row-level rules in one query is what stops the variants drifting apart across endpoints — the failure mode is not a wrong rule, it is four endpoints that each implemented it slightly differently.

## Request transformation

Request parsing and custom transformation belong in the framework's transformation layer — pipes in NestJS — rather than inline in a handler. Reshaping done inline is invisible to every other handler that receives the same input.

## Tests

Prefer a co-located spec for each command and each query.

Transport-level specs that boot the module and drive it over the wire exercise the real guard, pipe and filter chain, but typically mock the command and query layer. Such a spec proves routing and authorization; it does not prove persistence. A new field on a request contract needs a command-layer test as well, or it can pass every transport-level spec while never being written.

## Conventions

Recommended layout inside a feature module. None of this is architectural — a project with different names, applied consistently, satisfies every invariant above.

| Element | Recommended |
|---|---|
| Write use cases | `commands/<verb>-<noun>.command.ts` → `<Verb><Noun>Command`, one public method named for the verb |
| Read scenarios | `queries/<scenario>.query.ts` → `<Scenario>Query` |
| Collaborators | `services/` |
| View shaping | `mappers/` |
| Route authorization | `guards/` |
| Request transformation | `pipes/` |
| Request/response contracts | `dto/` |

Consistency matters more than the specific names: the value of `commands/` is that a reader knows where every write use case is without searching, and that value comes from the directory being complete, not from its name.

One mechanical caveat worth knowing where it applies: when a transport resolves handlers in registration order — HTTP routing does — handlers sharing a path prefix must be registered together and ordered so literal paths precede parameterized ones. Registration order across separate modules is not yours to control, so splitting such handlers between modules can shadow a route silently, with no startup error.

## When to split, and when not to

The trigger is a **responsibility boundary**, not size.

Consider splitting when a module:

- owns domain data *and* implements business scenarios over it — two responsibilities with different reasons to change,
- has another module writing its data directly rather than through a seam — the boundary is already being violated, so make it structural,
- accumulates unrelated write use cases in one collaborator — no single responsibility describes it,
- mixes orchestration with business rules — two levels of abstraction in one place,
- or serves several read audiences from one read model, so a change for one risks the others.

Line count is not a trigger in either direction. A large module with one clear responsibility is healthy; a small one straddling two is not, and will get worse. Splitting a module that has only one responsibility just adds indirection.

Equally, don't pre-split. A feature with one write path, one read audience and no external writers should stay a single module — the domain/operations separation pays for its indirection only once there is a boundary worth protecting.

When one of these signals shows up in review, name the boundary that's being crossed and propose the decomposition, rather than letting the module keep growing.
