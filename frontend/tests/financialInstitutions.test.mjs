import assert from 'node:assert/strict'
import test from 'node:test'
import {
  financialInstitution,
  financialInstitutionCodes,
  financialInstitutions,
  financialInstitutionsFor,
} from '../src/features/assets/financialInstitutions.ts'

test('금융기관 정적 카탈로그는 모든 코드를 중복 없이 제공한다', () => {
  assert.deepEqual(financialInstitutions.map(({ code }) => code), [...financialInstitutionCodes])
  assert.equal(new Set(financialInstitutionCodes).size, financialInstitutionCodes.length)
  assert.equal(financialInstitution(null).code, 'OTHER')
})

test('대출은 은행과 캐피탈을, 투자는 증권사만 제공한다', () => {
  const loanCodes = new Set(financialInstitutionsFor('LOAN').map(({ code }) => code))
  const investmentCodes = new Set(financialInstitutionsFor('INVESTMENT').map(({ code }) => code))

  assert.equal(loanCodes.has('KB_KOOKMIN'), true)
  assert.equal(loanCodes.has('HYUNDAI_CAPITAL'), true)
  assert.equal(loanCodes.has('KIWOOM_SEC'), false)
  assert.equal(investmentCodes.has('KIWOOM_SEC'), true)
  assert.equal(investmentCodes.has('KOREA_INVESTMENT_SEC'), true)
  assert.equal(investmentCodes.has('KB_KOOKMIN'), false)
})

test('기관 이미지는 외부 런타임 URL을 사용하지 않고 약칭 fallback을 가진다', () => {
  for (const institution of financialInstitutions) {
    assert.doesNotMatch(institution.logoUrl ?? '', /^https?:/)
    assert.ok(institution.logoUrl || institution.shortName)
  }
})
