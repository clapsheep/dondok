import assert from 'node:assert/strict'
import test from 'node:test'
import { transferAccountAssets, transferAccountLabel } from '../src/features/transactions/transferAssets.ts'

test('일반 이체 후보에는 활성 자산 중 계좌 유형만 남긴다', () => {
  const assets = [
    { assetId: 'cash', systemCode: 'CASH', name: '현금' },
    { assetId: 'bank-1', systemCode: 'BANK', name: '생활비 계좌' },
    { assetId: 'card', systemCode: 'CREDIT_CARD', name: '신용카드' },
    { assetId: 'bank-2', systemCode: 'BANK', name: '저축 계좌' },
    { assetId: 'overdraft', systemCode: 'BANK', name: '마이너스 통장' },
  ]

  assert.deepEqual(
    transferAccountAssets(assets).map((asset) => asset.assetId),
    ['bank-1', 'bank-2', 'overdraft'],
  )
})

test('이체 계좌 이름에는 현재 사용자·다른 구성원·공동 소유를 구분해 표시한다', () => {
  const members = [
    { memberId: 'owner', displayName: '박수양', currentUser: true },
    { memberId: 'partner', displayName: '서혜지', currentUser: false },
  ]

  assert.equal(transferAccountLabel({ name: '생활비', ownershipScope: 'PERSONAL', ownerMemberId: 'owner' }, members), '생활비 · 나')
  assert.equal(transferAccountLabel({ name: '국민 개인', ownershipScope: 'PERSONAL', ownerMemberId: 'partner' }, members), '국민 개인 · 서혜지')
  assert.equal(transferAccountLabel({ name: '공동 통장', ownershipScope: 'JOINT', ownerMemberId: null }, members), '공동 통장 · 공동')
})
