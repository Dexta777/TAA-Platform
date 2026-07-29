# Webflow Migration

## Purpose

This directory records the migration of custom code from the Webflow Designer into the Git repository.

Its purpose is to ensure every deployed asset has been discovered, reviewed and migrated without altering behaviour.

---

## Migration Rules

1. Do not improve code during migration.
2. Preserve existing behaviour.
3. Migrate one concern at a time.
4. Commit each migration independently.
5. Refactoring begins only after migration is complete.

---

## Completion Criteria

The migration is complete when:

- Every deployed script exists within Git.
- Every custom style exists within Git.
- Every embed exists within Git.
- Every page-level custom code block exists within Git.
- Every inventory document is complete.

At that point Git becomes the canonical source of truth.
