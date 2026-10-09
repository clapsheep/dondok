import type { Transaction } from '../transactions/api'
import { groupTransactionsByDate } from '../transactions/groupTransactionsByDate.ts'
import type { Asset } from './api'

export type AssetLedgerTransactionEntry = {
  kind: 'TRANSACTION'
  transaction: Transaction
  balanceAfterWon: number | null
}

export type AssetLedgerOpeningEntry = {
  kind: 'OPENING_BALANCE'
  occurredOn: string
  balanceAfterWon: number
}

export type AssetLedgerEntry = AssetLedgerTransactionEntry | AssetLedgerOpeningEntry

export type AssetLedgerDayGroup = {
  date: string
  items: AssetLedgerEntry[]
}

export function buildAssetLedgerTimeline(
  transactions: Transaction[],
  asset: Pick<Asset, 'assetId' | 'openedOn' | 'openingBalanceWon' | 'currentBalanceWon'>,
  hasNextPage: boolean,
): AssetLedgerDayGroup[] {
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

  return groupTransactionsByDate(entries, (entry) => entry.kind === 'TRANSACTION' ? entry.transaction.occurredOn : entry.occurredOn)
}

function postingDeltaForAsset(transaction: Transaction, assetId: string) {
  return transaction.postings.find((posting) => posting.assetId === assetId)?.deltaWon ?? 0
}
