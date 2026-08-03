import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeAssetName, resolveAssetName } from '../src/features/assets/assetName.ts'

test('이름 비교를 위해 앞뒤 공백과 대소문자를 정규화한다', () => {
  assert.equal(normalizeAssetName('  My BANK  '), 'my bank')
})

test('직접 입력한 자산 이름은 유형이 달라도 그대로 사용한다', () => {
  assert.equal(resolveAssetName({
    draftName: '생활비 통장',
    typeName: '은행',
    assets: [{ assetId: 'other', name: '은행' }],
  }), '생활비 통장')
})

test('빈 이름은 선택한 유형명을 사용하고 중복이면 가장 작은 suffix를 붙인다', () => {
  assert.equal(resolveAssetName({
    draftName: '   ',
    typeName: '은행',
    assets: [
      { assetId: 'one', name: '은행' },
      { assetId: 'three', name: '은행 3' },
    ],
  }), '은행 2')
})

test('신규 등록에서 입력한 이름을 지우면 현재 종류의 비어 있는 가장 작은 suffix를 사용한다', () => {
  assert.equal(resolveAssetName({
    draftName: '',
    typeName: '계좌',
    assets: [
      { assetId: 'one', name: '계좌' },
      { assetId: 'two', name: '계좌 2' },
      { assetId: 'four', name: '계좌 4' },
    ],
  }), '계좌 3')
})

test('수정 중인 자산은 중복 이름 계산에서 제외한다', () => {
  assert.equal(resolveAssetName({
    draftName: '',
    typeName: '은행',
    assets: [{ assetId: 'current', name: '은행' }],
    excludedAssetId: 'current',
  }), '은행')
})

test('기타도 고정 유형명을 기본 이름으로 사용한다', () => {
  assert.equal(resolveAssetName({
    draftName: '',
    typeName: '기타',
    assets: [],
  }), '기타')
})

test('suffix가 필요해도 파생 이름을 100자 이내로 유지한다', () => {
  const longTypeName = '가'.repeat(100)
  const resolved = resolveAssetName({
    draftName: '',
    typeName: longTypeName,
    assets: [{ assetId: 'one', name: longTypeName }],
  })

  assert.equal(resolved.length, 100)
  assert.match(resolved, / 2$/)
})
