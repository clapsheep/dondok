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
