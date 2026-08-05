import assert from 'node:assert/strict'
import test from 'node:test'
import { MEMBER_AVATAR_TONE_COUNT, memberAvatarTone, memberInitial } from '../src/components/avatarIdentity.ts'

test('구성원 아바타는 공백을 제외한 첫 글자를 사용한다', () => {
  assert.equal(memberInitial('  가람  '), '가')
  assert.equal(memberInitial(''), '?')
})

test('여러 코드 포인트로 된 첫 글자도 하나의 아바타 문자로 유지한다', () => {
  assert.equal(memberInitial('👩‍💻 개발자'), '👩‍💻')
})

test('같은 구성원 seed는 항상 같은 색상 번호를 사용한다', () => {
  const tone = memberAvatarTone('member-123')
  assert.equal(memberAvatarTone('member-123'), tone)
  assert.ok(tone >= 0 && tone < MEMBER_AVATAR_TONE_COUNT)
})
