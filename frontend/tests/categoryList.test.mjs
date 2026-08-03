import assert from 'node:assert/strict'
import test from 'node:test'
import { insertCategoryBeforeFallback } from '../src/features/categories/categoryList.ts'

const fallback = { categoryId: 'fallback', name: '기타 지출', isFallback: true }

test('거래 화면에서 추가한 분류를 기타 바로 앞에 한 번만 넣는다', () => {
  const food = { categoryId: 'food', name: '식비', isFallback: false }
  const pet = { categoryId: 'pet', name: '반려동물', isFallback: false }

  assert.deepEqual(
    insertCategoryBeforeFallback([food, fallback], pet).map((category) => category.categoryId),
    ['food', 'pet', 'fallback'],
  )
  assert.deepEqual(
    insertCategoryBeforeFallback([food, pet, fallback], pet).map((category) => category.categoryId),
    ['food', 'pet', 'fallback'],
  )
})
