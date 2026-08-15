import { officialFinancialInstitutionLogos } from './financialInstitutionLogos.ts'

export const cardIssuerCodes = [
  'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'SAMSUNG', 'HYUNDAI', 'LOTTE', 'WOORI', 'HANA', 'BC', 'NH',
] as const

export type CardIssuerCode = (typeof cardIssuerCodes)[number]

export type CardIssuer = {
  code: CardIssuerCode
  name: string
  shortName: string
  color: string
  logoUrl?: string
  popular?: boolean
}

export const cardIssuers: readonly CardIssuer[] = [
  { code: 'OTHER', name: '기타 카드사', shortName: '기타', color: '#647067' },
  { code: 'KB_KOOKMIN', name: 'KB국민카드', shortName: 'KB', color: '#6b5b32', logoUrl: officialFinancialInstitutionLogos.kb, popular: true },
  { code: 'SHINHAN', name: '신한카드', shortName: '신한', color: '#2459a9', logoUrl: officialFinancialInstitutionLogos.shinhan, popular: true },
  { code: 'SAMSUNG', name: '삼성카드', shortName: '삼성', color: '#1769aa', popular: true },
  { code: 'HYUNDAI', name: '현대카드', shortName: '현대', color: '#2f3033', popular: true },
  { code: 'LOTTE', name: '롯데카드', shortName: '롯데', color: '#d7193f', popular: true },
  { code: 'WOORI', name: '우리카드', shortName: '우리', color: '#1672b9', logoUrl: officialFinancialInstitutionLogos.woori, popular: true },
  { code: 'HANA', name: '하나카드', shortName: '하나', color: '#008375', logoUrl: officialFinancialInstitutionLogos.hana, popular: true },
  { code: 'BC', name: 'BC카드', shortName: 'BC', color: '#e83d44', popular: true },
  { code: 'NH', name: 'NH농협카드', shortName: 'NH', color: '#168554', popular: true },
]

const byCode = new Map(cardIssuers.map((issuer, index) => [issuer.code, { issuer, index }]))

export function cardIssuer(code: CardIssuerCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.issuer ?? cardIssuers[0]
}

export function cardIssuerSortOrder(code: CardIssuerCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.index ?? Number.MAX_SAFE_INTEGER
}
