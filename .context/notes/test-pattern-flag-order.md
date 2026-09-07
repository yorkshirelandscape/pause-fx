---
id: test-pattern-flag-order
title: node --test's --test-name-pattern is silently ignored after a positional path
type: runbook
summary: >
  node --test scripts/ --test-name-pattern=x runs every test, pattern ignored; node --test
  --test-name-pattern=x scripts/ (flag before the positional) filters correctly. Fixed by
  dropping the explicit scripts/ path entirely and relying on Node's default test-file
  discovery, so npm test -- --test-name-pattern=... always lands in the right position.
tags:
  - testing
  - node
references:
  - file: package.json
    line: 7
links: []
---

Wanted `npm test -- --test-name-pattern=<x>` to filter down to one test. It silently ran
the whole suite instead -- no error, just every test executing as if the flag weren't
there.

Verified directly: `node --test scripts/ --test-name-pattern="x"` runs everything;
`node --test --test-name-pattern="x" scripts/` (same flag, before the positional instead of
after) correctly filters to one test. Node's CLI parser stops treating things as its own
flags once it hits the first positional argument.

`npm test -- <args>` always appends forwarded args *after* whatever the script itself
already wrote -- so a script with an explicit `scripts/` positional can never receive a
forwarded pattern correctly. Fix: drop the positional. Node's own default test-file
discovery finds `scripts/pause-fx.test.mjs` without being told where to look, so nothing
sits between the script name and a forwarded flag.
