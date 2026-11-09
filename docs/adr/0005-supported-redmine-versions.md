# 0005: Support Redmine 6.1 and later

- Status: Accepted
- Date: 2026-11-09

## Context

Redline is for any Redmine server, but every release it supports has to be
tested and its quirks handled. Redmine 6.1 is the oldest release the first
teams using Redline run, and Redmine 7 is the current major. Supporting older
releases would mean fallbacks for missing or different REST API fields that
nobody is there to test.

## Decision

- Redline supports Redmine 6.1 and later.
- CI runs the core crate's tests against a real Redmine 6.1 and the latest
  Redmine 7, using the dev compose file with `REDMINE_VERSION` set to each.
- Redline still detects what a server offers at runtime (enabled modules,
  permissions, optional fields), because that varies with configuration and
  not only with version. It doesn't add code paths for releases before 6.1.

## Consequences

- Contributors can rely on the REST API as it is in Redmine 6.1, and test
  locally with `REDMINE_VERSION=6.1`.
- Someone on an older Redmine may find parts of Redline that don't work. Bug
  reports ask for the Redmine version so those are easy to spot.
- When a new Redmine major ships, add it to the CI matrix. Raising the minimum
  is a new ADR that supersedes this one.
