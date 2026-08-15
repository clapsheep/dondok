import assert from 'node:assert/strict'
import test from 'node:test'
import { transferAssetLabel, transferEligibleAssets } from '../src/features/transactions/transferAssets.ts'

test('일반 이체 후보에는 활성 자산 중 계좌와 적금만 남긴다', () => {
  const assets = [
    { assetId: 'cash', systemCode: 'CASH', name: '현금' },
    { assetId: 'bank-1', systemCode: 'BANK', name: '생활비 계좌' },
    { assetId: 'card', systemCode: 'CREDIT_CARD', name: '신용카드' },
    { assetId: 'savings', systemCode: 'SAVINGS', name: '여행 적금' },
    { assetId: 'overdraft', systemCode: 'BANK', name: '마이너스 통장' },
  ]

  assert.deepEqual(
    transferEligibleAssets(assets).map((asset) => asset.assetId),
    ['bank-1', 'savings', 'overdraft'],
  )
})

test('이체 계좌 이름에는 현재 사용자·다른 구성원·공동 소유를 구분해 표시한다', () => {
  const members = [
    { memberId: 'owner', displayName: '박수양', currentUser: true },
    { memberId: 'partner', displayName: '서혜지', currentUser: false },
  ]

  assert.equal(transferAssetLabel({ name: '생활비', ownershipScope: 'PERSONAL', ownerMemberId: 'owner' }, members), '생활비 · 나')
  assert.equal(transferAssetLabel({ name: '국민 개인', ownershipScope: 'PERSONAL', ownerMemberId: 'partner' }, members), '국민 개인 · 서혜지')
  assert.equal(transferAssetLabel({ name: '공동 적금', ownershipScope: 'JOINT', ownerMemberId: null }, members), '공동 적금 · 공동')
})
