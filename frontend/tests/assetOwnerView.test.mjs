import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_ASSET_OWNER_VIEW,
  JOINT_ASSET_OWNER_VIEW,
  buildAssetOwnerViews,
  defaultAssetOwnerViewKey,
  filterAssetsByOwner,
  resolveAssetOwnerView,
} from '../src/features/assets/ownerView.ts'

const members = [
  { memberId: 'member-a', displayName: '가나다', currentUser: true },
  { memberId: 'member-b', displayName: '라마바', currentUser: false },
]

const assets = [
  { assetId: 'joint', ownershipScope: 'JOINT', ownerMemberId: null },
  { assetId: 'a', ownershipScope: 'PERSONAL', ownerMemberId: 'member-a' },
  { assetId: 'b', ownershipScope: 'PERSONAL', ownerMemberId: 'member-b' },
]

test('전체·공동·각 구성원 보기를 만들고 현재 사용자를 구분한다', () => {
  assert.deepEqual(buildAssetOwnerViews(members), [
    { key: 'all', label: '전체' },
    { key: 'joint', label: '공동 소유' },
    { key: 'member:member-a', label: '가나다 (나)' },
    { key: 'member:member-b', label: '라마바' },
  ])
})

test('소유 marker 기준으로 공동과 구성원 자산을 필터링한다', () => {
  assert.deepEqual(filterAssetsByOwner(assets, ALL_ASSET_OWNER_VIEW).map(({ assetId }) => assetId), ['joint', 'a', 'b'])
  assert.deepEqual(filterAssetsByOwner(assets, JOINT_ASSET_OWNER_VIEW).map(({ assetId }) => assetId), ['joint'])
  assert.deepEqual(filterAssetsByOwner(assets, 'member:member-a').map(({ assetId }) => assetId), ['a'])
})

test('첫 진입과 알 수 없는 URL 보기는 현재 사용자 자산으로 복구한다', () => {
  const views = buildAssetOwnerViews(members)
  const defaultKey = defaultAssetOwnerViewKey(members)

  assert.equal(defaultKey, 'member:member-a')
  assert.equal(resolveAssetOwnerView(null, views, defaultKey).key, 'member:member-a')
  assert.equal(resolveAssetOwnerView('member:missing', views, defaultKey).key, 'member:member-a')
  assert.equal(resolveAssetOwnerView(ALL_ASSET_OWNER_VIEW, views, defaultKey).key, ALL_ASSET_OWNER_VIEW)
  assert.deepEqual(filterAssetsByOwner(assets, 'unknown').map(({ assetId }) => assetId), ['joint', 'a', 'b'])
})

test('현재 사용자 표시가 없으면 전체 보기를 안전한 기본값으로 사용한다', () => {
  const membersWithoutCurrentUser = members.map((member) => ({ ...member, currentUser: false }))
  const views = buildAssetOwnerViews(membersWithoutCurrentUser)
  const defaultKey = defaultAssetOwnerViewKey(membersWithoutCurrentUser)

  assert.equal(defaultKey, ALL_ASSET_OWNER_VIEW)
  assert.equal(resolveAssetOwnerView(null, views, defaultKey).key, ALL_ASSET_OWNER_VIEW)
})
