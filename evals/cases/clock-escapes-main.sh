# A clock outside main.ts does not break a test. It makes one flaky months
# later, which is why this is checked rather than left to review.
LEDGER_ROW=16
CHECK='node scripts/clock-boundary.mjs'
break_it() {
  echo 'export const nowish = () => Date.now();' >> puyopuyo/src/core/board.ts
}
