# A clock outside the entry point does not break a test. It makes one flaky
# months later, which is why this is checked rather than left to review.
#
# Run against evals/fixtures/clock rather than the project's own config: a
# template has no application to break, and a case that cannot run is the thing
# this suite exists to catch.
LEDGER_ROW=16
CHECK='HARNESS_CONFIG=evals/fixtures/clock/harness.config.json node scripts/clock-boundary.mjs'
break_it() {
  echo 'export const nowish = () => Date.now();' >> evals/fixtures/clock/src/pure.ts
}
