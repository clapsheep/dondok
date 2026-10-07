import test from 'node:test'
import assert from 'node:assert/strict'
import { affectedPattern } from './affected-tests.mjs'

test('documentation changes keep only the mandatory core suite', () => {
  assert.equal(affectedPattern(['docs/project-context.md', 'README.md']), '(?!)')
})
test('card changes select card, statement and statistics regressions', () => {
  const pattern = new RegExp(affectedPattern(['backend/src/main/java/com/dondok/settlement/application/CardStatementService.java']))
  assert.ok(pattern.test('card-statement-settlement.spec.ts'))
  assert.ok(pattern.test('statistics.spec.ts'))
  assert.ok(!pattern.test('auth.spec.ts'))
})
test('shared code, unknown code and CI changes fail open to the full suite', () => {
  for (const path of ['frontend/src/App.tsx', 'backend/src/main/resources/db/migration/V1.sql', '.github/workflows/ci.yml', 'e2e/tests/support/auth.ts', 'frontend/src/new-domain.ts']) {
    assert.equal(affectedPattern([path]), '.*', path)
  }
})
test('changed WebKit spec selects that file and escapes regex punctuation', () => {
  const pattern = new RegExp(affectedPattern(['e2e/tests/money-calculator.webkit.spec.ts']))
  assert.ok(pattern.test('money-calculator.webkit.spec.ts'))
  assert.ok(!pattern.test('money-calculatorXwebkitXspecXts'))
})
