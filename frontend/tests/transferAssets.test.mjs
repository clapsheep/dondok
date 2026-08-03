import assert from 'node:assert/strict'
import test from 'node:test'
import { transferAccountAssets } from '../src/features/transactions/transferAssets.ts'

test('일반 이체 후보에는 활성 자산 중 계좌 유형만 남긴다', () => {
  const assets = [
    { assetId: 'cash', systemCode: 'CASH', name: '현금' },
    { assetId: 'bank-1', systemCode: 'BANK', name: '생활비 계좌' },
    { assetId: 'card', systemCode: 'CREDIT_CARD', name: '신용카드' },
    { assetId: 'bank-2', systemCode: 'BANK', name: '저축 계좌' },
    { assetId: 'overdraft', systemCode: 'OVERDRAFT', name: '마이너스 통장' },
  ]

  assert.deepEqual(
    transferAccountAssets(assets).map((asset) => asset.assetId),
    ['bank-1', 'bank-2'],
  )
})
