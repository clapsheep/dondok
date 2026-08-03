import assert from 'node:assert/strict'
import test from 'node:test'
import {
  performerPersonLabel,
  performerQuestionLabel,
  performerSelectionError,
} from '../src/features/transactions/performerLabels.ts'

test('수입·지출·이체의 사람 선택 문구를 일상적인 질문으로 구분한다', () => {
  assert.equal(performerQuestionLabel('INCOME'), '누가 받았나요?')
  assert.equal(performerQuestionLabel('EXPENSE'), '누가 썼나요?')
  assert.equal(performerQuestionLabel('TRANSFER'), '누가 옮겼나요?')
})

test('상세와 오류에서도 같은 의미의 쉬운 표현을 사용한다', () => {
  assert.equal(performerPersonLabel('EXPENSE'), '쓴 사람')
  assert.equal(performerSelectionError('EXPENSE'), '누가 썼는지 선택해 주세요.')
})
