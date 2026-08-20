# Handoff: repo doc-prune + comment-shrink pass

Transient work artifact. Delete before the final commit/PR (it is itself a
non-benchmark/observability doc that this task would otherwise remove).

## The ask (verbatim intent)

Big pass over the whole repo:

1. Delete all docs NOT about benchmarks or observability tests. Everything else
   goes.
2. Remove every README in a non-root folder. Keep only root `README.md`.
3. Shrink every code comment to a single terse lowercase line; ungrammatical
   like a sloppy dev; cut hard, delete pure restatements.
4. Remove any comment content referencing AI/agents, project docs, ADRs, or
   tracker issue numbers - anything not about the exact code it sits on.
5. Preserve functionality. Only stylistic changes (comments, names).
6. Be thorough, multiple passes, use subagents.

## Done

- Deletions (staged via `git rm`, recoverable from history):
  - Root docs: `CONTEXT.md DESIGN.md SECURITY.md VISION.md` and their test refs.
  - `docs/`: kept ONLY `docs/operations/observability.md` and the three
    `docs/load-tests/2026-*.md` benchmark reports. Deleted adr/ architecture/
    engineering/ product/ runbooks/ screenshots/ security/ testing/,
    `docs/README.md`, `docs/maintenance.md`,
    `docs/operations/azure-deployment.md`, `docs/operations/runbook-index.md`,
    `docs/load-tests/README.md`.
  - All non-root `README.md` (apps/*, packages/*, infrastructure/*, docs/*).
  - `.github/ISSUE_TEMPLATE/task.md` (agent-workflow template).
- Gitignored local files removed from working tree: `AGENTS.md`, `CLAUDE.md`
  (symlink), `RESUME_BULLETS.md`. These were untracked (gitignored), so NOT
  recoverable via git. Backup copies at
  `/home/secur/.claude/jobs/69dfb428/tmp/gitignored-docs-backup/` (AGENTS.md,
  RESUME_BULLETS.md). That job tmp is wiped when the job is deleted - move them
  somewhere durable if the user wants them kept.
- `README.md` rewritten: removed dead links to deleted docs, removed
  issue-queue / agent language, fixed the codebase tree and infrastructure
  section. Only remaining internal link is `docs/operations/observability.md`
  (exists). Verified zero agent/queue mentions.
- `tests/repository.test.mjs`: `requiredFiles` list rewritten to reference only
  surviving files (was asserting deleted docs/READMEs exist -> would fail).
- Comment-shrink: 6 of 9 subagents finished (comments-only, verified byte-clean
  by each): apps/api core+auth, apps/api checkout+holds, apps/api rest,
  apps/web lib, apps/web app pages, infrastructure+compose+workflows. Doc-path
  references stripped from `apps/api/src/organizations/policy.ts`,
  `organizations.service.ts`, `apps/web/src/app/scan/page.tsx`. External bug ref
  kept (shortened) in `apps/web/src/app/layout.tsx` (vercel/next.js#86060).

## In flight (3 subagents, may still be editing on disk)

- worker + scripts + tests + eslint.config.mjs + playwright.config.ts
- packages: contracts + config + ui
- packages: database (src only) + payments + test-utils

If a fresh session picks this up, assume these MAY be incomplete. Re-run the
comment sweep over those paths (see Remaining).

## Remaining

1. Confirm the 3 in-flight areas are fully shrunk. Sweep for leftovers:
   - multi-line block/JSDoc: `grep -rn "/\*\*" apps packages --include=*.ts | grep -v generated | grep -v dist`
   - doc/agent refs in comments: `grep -rniE "docs/|adr|VISION|CONTEXT|DESIGN|\bagent\b|claude|codex|autonomous"` over source (exclude generated/dist/.next; user-agent header + "Reference" identifiers are false positives).
2. VERIFY (functionality-preserving is the whole point):
   ```
   pnpm format:check   # collapsing comments may trip prettier - run pnpm format if so
   pnpm lint
   pnpm typecheck
   pnpm test           # includes tests/repository.test.mjs (link + required-file checks)
   pnpm build
   ```
   `pnpm test:integration` / `test:e2e` need `pnpm services:up` running.
3. Delete this HANDOFF.md.
4. Commit. NOTE: the merge-commit-only override lived in the now-deleted
   project CLAUDE.md; global rule = small non-worktree changes push directly to
   main, worktree work goes via a merge-commit PR. Confirm with the user before
   pushing (this session had not been asked to push).

## Gotchas / hard constraints

- Comments-only: no code/logic/identifier/string/format changes. Verify diffs
  are comment-lines only.
- Never edit: `packages/database/src/generated/**`, any `dist/**`, `.next/**`,
  `node_modules`, and especially `packages/database/prisma/migrations/**`
  (editing applied migrations changes Prisma checksums -> drift).
- Preserve functional/pragma comments byte-for-byte: eslint-disable*,
  @ts-expect-error/@ts-ignore/@ts-nocheck, prettier-ignore, c8/istanbul/v8
  ignore, triple-slash `/// <reference>`, shebangs, `# syntax=` docker
  directive. `"use client"`/`"use server"` are directive strings, not comments.
- `alerts.yml` / terraform `outputs` have `runbook: docs/...` as YAML VALUES,
  not comments - leave them.

## Suggested skills

- `writing-style` - before any further `README.md` / published-prose edit.
- `review` - review the whole diff since the pre-task commit (3a7cf4b) along
  the comments-only + functionality-preserved axis before committing.
- `caveman` - session is in caveman full mode; keep terse.
