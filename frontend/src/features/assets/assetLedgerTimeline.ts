import type { Transaction } from '../transactions/api'
import type { Asset } from './api'

export type AssetLedgerTransactionEntry = {
  kind: 'TRANSACTION'
  transaction: Transaction
  balanceAfterWon: number
}

export type AssetLedgerOpeningEntry = {
  kind: 'OPENING_BALANCE'
  occurredOn: string
  balanceAfterWon: number
}

export type AssetLedgerEntry = AssetLedgerTransactionEntry | AssetLedgerOpeningEntry

export type AssetLedgerMonthGroup = {
  month: string
  items: AssetLedgerEntry[]
}

export function buildAssetLedgerTimeline(
  transactions: Transaction[],
  asset: Pick<Asset, 'assetId' | 'openedOn' | 'openingBalanceWon' | 'currentBalanceWon'>,
  hasNextPage: boolean,
): AssetLedgerMonthGroup[] {
  let runningBalanceWon = asset.currentBalanceWon
  const entries: AssetLedgerEntry[] = transactions.map((transaction) => {
    const entry: AssetLedgerTransactionEntry = {
      kind: 'TRANSACTION',
      transaction,
      balanceAfterWon: runningBalanceWon,
    }
    runningBalanceWon -= postingDeltaForAsset(transaction, asset.assetId)
    return entry
  })

  const crossedOpeningDate = transactions.some((transaction) => transaction.occurredOn < asset.openedOn)
  if (!hasNextPage || crossedOpeningDate) {
    const openingIndex = transactions.findIndex((transaction) => transaction.occurredOn < asset.openedOn)
    entries.splice(openingIndex < 0 ? entries.length : openingIndex, 0, {
      kind: 'OPENING_BALANCE',
      occurredOn: asset.openedOn,
      balanceAfterWon: asset.openingBalanceWon,
    })
  }

  const groups = new Map<string, AssetLedgerEntry[]>()
  for (const entry of entries) {
    const occurredOn = entry.kind === 'TRANSACTION' ? entry.transaction.occurredOn : entry.occurredOn
    const month = occurredOn.slice(0, 7)
    const group = groups.get(month)
    if (group) group.push(entry)
    else groups.set(month, [entry])
  }
  return [...groups].map(([month, items]) => ({ month, items }))
}

function postingDeltaForAsset(transaction: Transaction, assetId: string) {
  return transaction.postings.find((posting) => posting.assetId === assetId)?.deltaWon ?? 0
}
