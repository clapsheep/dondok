import test from 'node:test'
import assert from 'node:assert/strict'
import { transactionReflection } from '../src/features/transactions/transactionDetailPresentation.ts'

const expense = {type:'EXPENSE', managementType:'CARD_PURCHASE', amountWon:126000, statisticsAmountWon:42000, excludedFromStatistics:false, transferPurpose:null}
test('대표 결제는 실제 결제액과 달리 내 부담만 집계하며 제외 시 0원으로 표시한다', () => {
  const result=transactionReflection(expense)
  assert.equal(result.amount,42000)
  assert.equal(result.label,'지출에 반영')
  assert.equal(result.representative,true)
  assert.match(result.note,/126,000원/)
  assert.equal(transactionReflection({...expense,excludedFromStatistics:true}).amount,0)
  assert.match(transactionReflection({...expense,excludedFromStatistics:true}).note,/제외/)
})
test('카드 환불은 수입이 아니라 지출 차감이며 집계 제외를 따른다', () => {
  const refund={...expense,managementType:'CARD_REFUND',type:'INCOME'}
  assert.equal(transactionReflection(refund).label,'지출에서 차감')
  assert.equal(transactionReflection(refund).amount,42000)
  assert.equal(transactionReflection(refund).representative,false)
  assert.equal(transactionReflection({...refund,excludedFromStatistics:true}).amount,0)
})
test('일반 이체와 카드 결제는 수입·지출에 재집계하지 않으며 납입과 인출은 목적을 보존한다', () => {
  const transfer={...expense,type:'TRANSFER',managementType:'GENERAL',statisticsAmountWon:0}
  assert.equal(transactionReflection(transfer).amount,0)
  assert.equal(transactionReflection({...transfer,managementType:'SYSTEM'}).label,'수입·지출에 미포함')
  for(const [purpose,label] of [['SAVINGS_DEPOSIT','적금 납입'],['SAVINGS_WITHDRAWAL','적금 인출'],['INVESTMENT_DEPOSIT','투자 납입'],['INVESTMENT_WITHDRAWAL','투자 인출']]) {
    const result=transactionReflection({...transfer,transferPurpose:purpose})
    assert.equal(result.label,`${label}에 반영`)
    assert.equal(result.amount,126000)
  }
})
test('수입과 일반 지출은 API 집계 금액을 그대로 표시한다', () => {
  assert.equal(transactionReflection({...expense,type:'INCOME',managementType:'GENERAL',statisticsAmountWon:126000}).label,'수입에 반영')
  assert.equal(transactionReflection({...expense,managementType:'GENERAL',statisticsAmountWon:126000}).amount,126000)
})
