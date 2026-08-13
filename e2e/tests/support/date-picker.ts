import { expect, type Locator, type Page } from '@playwright/test'

type DateInputWithSpy = HTMLInputElement & {
  __dondokShowPickerSpy?: { ownDescriptor?: PropertyDescriptor }
}

export async function expectInputBodyOpensDatePicker(page: Page, input: Locator, label: string) {
  await expect(input, `${label} input이 보여야 합니다`).toBeVisible()
  await expect(input).toHaveAttribute('type', 'date')
  const draftValue = await input.inputValue()
  expect(draftValue, `${label} 기존 날짜 draft가 있어야 합니다`).not.toBe('')

  await input.evaluate((element) => {
    const dateInput = element as DateInputWithSpy
    dateInput.__dondokShowPickerSpy = {
      ownDescriptor: Object.getOwnPropertyDescriptor(dateInput, 'showPicker'),
    }
    dateInput.dataset.e2eShowPickerCalls = '0'
    Object.defineProperty(dateInput, 'showPicker', {
      configurable: true,
      value: () => {
        dateInput.dataset.e2eShowPickerCalls = String(Number(dateInput.dataset.e2eShowPickerCalls ?? '0') + 1)
      },
    })
  })

  try {
    await input.scrollIntoViewIfNeeded()
    const box = await input.boundingBox()
    expect(box, `${label} input 좌표를 측정할 수 있어야 합니다`).not.toBeNull()
    const bodyX = Math.min(box!.width / 2, Math.max(12, box!.width / 4))
    await page.mouse.click(box!.x + bodyX, box!.y + box!.height / 2)

    await expect(input, `${label} 입력 본문 click은 showPicker를 한 번 호출해야 합니다`)
      .toHaveAttribute('data-e2e-show-picker-calls', '1')
    await expect(input, `${label} click 뒤 날짜 draft를 보존해야 합니다`).toHaveValue(draftValue)
    await expect(input, `${label} click 뒤 focus를 유지해야 합니다`).toBeFocused()
  } finally {
    await input.evaluate((element) => {
      const dateInput = element as DateInputWithSpy
      const state = dateInput.__dondokShowPickerSpy
      if (state?.ownDescriptor) Object.defineProperty(dateInput, 'showPicker', state.ownDescriptor)
      else Reflect.deleteProperty(dateInput, 'showPicker')
      delete dateInput.__dondokShowPickerSpy
      delete dateInput.dataset.e2eShowPickerCalls
    })
  }
}

export async function expectResponsiveDatePicker(page: Page, trigger: Locator, label: string) {
  await expect(trigger, `${label} 선택 버튼이 보여야 합니다`).toBeVisible()
  const draftValue = await trigger.getAttribute('data-value')
  expect(draftValue, `${label} 기존 날짜 draft가 있어야 합니다`).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await trigger.click()
  const dialog = page.getByRole('dialog', { name: `${label} 선택`, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.rdp-root')).toHaveAttribute('aria-label', `${label} 달력`)
  await expect(dialog.getByRole('button', { name: '이전 달', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '다음 달', exact: true })).toBeVisible()

  const dialogBox = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(dialogBox, `${label} 달력 좌표를 측정할 수 있어야 합니다`).not.toBeNull()
  expect(viewport, `${label} viewport를 측정할 수 있어야 합니다`).not.toBeNull()
  if (viewport!.width < 768) {
    expect(Math.abs(dialogBox!.x), `${label} 모바일 drawer는 화면 왼쪽에 붙어야 합니다`).toBeLessThanOrEqual(1)
    expect(Math.abs(dialogBox!.width - viewport!.width), `${label} 모바일 drawer는 화면 너비를 사용해야 합니다`).toBeLessThanOrEqual(1)
    expect(Math.abs(dialogBox!.y + dialogBox!.height - viewport!.height), `${label} 모바일 drawer는 화면 아래에 붙어야 합니다`).toBeLessThanOrEqual(1)
  } else {
    expect(dialogBox!.width, `${label} desktop popover가 과도하게 넓으면 안 됩니다`).toBeLessThanOrEqual(360)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger, `${label} 달력을 닫으면 trigger로 focus가 돌아와야 합니다`).toBeFocused()
  await expect(trigger, `${label} 달력을 열고 닫아도 draft를 보존해야 합니다`).toHaveAttribute('data-value', draftValue!)
}

export async function selectDate(page: Page, label: string, value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`날짜는 YYYY-MM-DD 형식이어야 합니다: ${value}`)
  const targetYear = Number(match[1])
  const targetMonth = Number(match[2])
  const targetDay = Number(match[3])
  const trigger = page.getByLabel(label, { exact: true })

  if (await trigger.getAttribute('data-value') === value) return
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: `${label} 선택`, exact: true })
  await expect(dialog).toBeVisible()

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const caption = (await dialog.locator('.rdp-caption_label').textContent())?.trim() ?? ''
    const captionMatch = /(\d{4})년\s*(\d{1,2})월/.exec(caption)
    if (!captionMatch) throw new Error(`달력의 연월을 읽을 수 없습니다: ${caption}`)
    const currentIndex = Number(captionMatch[1]) * 12 + Number(captionMatch[2]) - 1
    const targetIndex = targetYear * 12 + targetMonth - 1
    if (currentIndex === targetIndex) break
    await dialog.getByRole('button', { name: currentIndex < targetIndex ? '다음 달' : '이전 달', exact: true }).click()
    if (attempt === 239) throw new Error(`${value}가 있는 달로 이동하지 못했습니다.`)
  }

  await dialog.locator('.rdp-day:not(.rdp-outside) .rdp-day_button').filter({ hasText: new RegExp(`^${targetDay}$`) }).click()
  await expect(trigger).toHaveAttribute('data-value', value)
}
