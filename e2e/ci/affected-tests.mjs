import { execFileSync } from 'node:child_process'

const groups = [
  [/asset|Asset/, ['assets', 'asset-concurrency', 'asset-removal', 'asset-overview', 'individual-asset-owner', 'payment-source-modal']],
  [/transaction|Transaction|Money|calculator/, ['transactions', 'transaction-management', 'transaction-draft-navigation', 'transaction-layout.webkit', 'money-calculator.webkit', 'card-purchase-management', 'card-statement-settlement', 'statistics']],
  [/card|Card|settlement|Settlement/, ['card-purchase-management', 'card-statement-settlement', 'transactions', 'statistics', 'asset-overview']],
  [/categor|Categor/, ['categories', 'transactions', 'statistics']],
  [/statistic|Statistic/, ['statistics']],
  [/membership|Membership|ledger|Ledger/, ['membership', 'ledger-deletion', 'asset-concurrency']],
]
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function affectedPattern(paths) {
  const files = new Set()
  for (const path of paths) {
    if (/^(docs|design)\//.test(path) || /\.md$/.test(path)) continue
    if (/^e2e\/tests\/[^/]+\.spec\.ts$/.test(path)) {
      files.add(path.split('/').at(-1))
      continue
    }
    // Shared auth, fixtures, schema, runtime and CI changes warrant all projects.
    if (/^(infra|\.github)\/|compose|Dockerfile|lock|package\.json|db\/migration|e2e\/|auth|security|session|frontend\/src\/(components\/ui|lib)|\.css$|App\.tsx/.test(path)) return '.*'
    if (!/^(backend|frontend)\//.test(path)) return '.*'
    const matches = groups.filter(([pattern]) => pattern.test(path))
    if (!matches.length) return '.*'
    for (const [, specs] of matches) for (const spec of specs) files.add(`${spec}.spec.ts`)
  }
  return files.size ? [...files].sort().map(escape).join('|') : '(?!)'
}

if (process.argv[1]?.endsWith('affected-tests.mjs')) {
  const base = process.env.PR_BASE_SHA
  if (!/^[0-9a-f]{40}$/.test(base ?? '')) throw new Error('PR_BASE_SHA must be a full revision')
  const paths = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  console.log(affectedPattern(paths))
}
