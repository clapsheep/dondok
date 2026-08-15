import assert from 'node:assert/strict'
import test from 'node:test'
import { cardIssuer, cardIssuerCodes, cardIssuers, cardIssuerSortOrder } from '../src/features/assets/cardIssuers.ts'

test('카드사 정적 카탈로그는 모든 코드를 중복 없이 제공한다', () => {
  assert.deepEqual(cardIssuers.map(({ code }) => code), [...cardIssuerCodes])
  assert.equal(new Set(cardIssuerCodes).size, cardIssuerCodes.length)
  assert.equal(cardIssuer('SHINHAN').name, '신한카드')
  assert.equal(cardIssuer(null).code, 'OTHER')
  assert.ok(cardIssuerSortOrder('KB_KOOKMIN') < cardIssuerSortOrder('SHINHAN'))
})

test('카드사 이미지는 외부 런타임 URL을 사용하지 않는다', () => {
  for (const issuer of cardIssuers) {
    assert.doesNotMatch(issuer.logoUrl ?? '', /^https?:/)
    assert.ok(issuer.logoUrl || issuer.shortName)
  }
})
