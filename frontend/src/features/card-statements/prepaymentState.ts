export type StatementPrepaymentDraft = {
  amountWon: string
}

export type StatementSnapshot = {
  statementId: string
  version: number
  remainingAmountWon: number
  prepayableAmountWon: number
}

export type StatementPrepaymentWorkflow<TPreview> = {
  draft: StatementPrepaymentDraft
  baseVersion: number
  preview?: TPreview
  conflict?: StatementSnapshot
  remoteMissing: boolean
}

export function createStatementPrepaymentWorkflow<TPreview>(statement: StatementSnapshot): StatementPrepaymentWorkflow<TPreview> {
  return {
    draft: { amountWon: String(statement.remainingAmountWon) },
    baseVersion: statement.version,
    remoteMissing: false,
  }
}

export function changeStatementPrepaymentAmount<TPreview>(
  workflow: StatementPrepaymentWorkflow<TPreview>,
  amountWon: string,
): StatementPrepaymentWorkflow<TPreview> {
  return {
    ...workflow,
    draft: { amountWon },
    preview: undefined,
  }
}

export function acceptStatementPrepaymentPreview<TPreview>(
  workflow: StatementPrepaymentWorkflow<TPreview>,
  preview: TPreview,
  statementVersion: number,
): StatementPrepaymentWorkflow<TPreview> {
  return {
    ...workflow,
    baseVersion: statementVersion,
    preview,
    conflict: undefined,
  }
}

export function markStatementPrepaymentConflict<TPreview>(
  workflow: StatementPrepaymentWorkflow<TPreview>,
  latest: StatementSnapshot,
): StatementPrepaymentWorkflow<TPreview> {
  return {
    ...workflow,
    preview: undefined,
    conflict: latest,
  }
}

export function rebaseStatementPrepaymentWorkflow<TPreview>(
  workflow: StatementPrepaymentWorkflow<TPreview>,
): StatementPrepaymentWorkflow<TPreview> {
  if (!workflow.conflict) return workflow
  return {
    ...workflow,
    baseVersion: workflow.conflict.version,
    conflict: undefined,
  }
}

export function markStatementPrepaymentMissing<TPreview>(
  workflow: StatementPrepaymentWorkflow<TPreview>,
): StatementPrepaymentWorkflow<TPreview> {
  return {
    ...workflow,
    preview: undefined,
    remoteMissing: true,
  }
}

export function parseStatementPrepaymentAmount(value: string, remainingAmountWon: number) {
  const amountWon = Number(value.replaceAll(',', '').trim())
  if (!Number.isSafeInteger(amountWon) || amountWon <= 0) {
    return { error: '0원보다 큰 원 단위 정수를 입력해 주세요.' }
  }
  if (amountWon > remainingAmountWon) {
    return { error: `남은 결제 금액 ${formatWon(remainingAmountWon)} 이하로 입력해 주세요.` }
  }
  return { amountWon }
}

export function validateStatementPrepaymentDraft(draft: StatementPrepaymentDraft, remainingAmountWon: number) {
  const amount = parseStatementPrepaymentAmount(draft.amountWon, remainingAmountWon)
  return {
    amountWon: amount.amountWon,
    errors: { amountWon: amount.error },
  }
}

function formatWon(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`
}
