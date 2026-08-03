import assert from 'node:assert/strict'
import test from 'node:test'
import { hasFieldErrors } from '../src/lib/formErrors.ts'

test('undefined로 정리된 필드는 오류 요약을 표시하지 않는다', () => {
  assert.equal(hasFieldErrors({ assetTypeId: undefined }), false)
})

test('실제 오류 문자열이 있으면 오류 요약을 표시한다', () => {
  assert.equal(hasFieldErrors({ assetTypeId: '자산 종류를 선택해 주세요.' }), true)
})
