import { officialFinancialInstitutionLogos } from './financialInstitutionLogos.ts'

export const financialInstitutionCodes = [
  'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'HANA', 'WOORI', 'NH', 'IBK', 'KAKAO_BANK',
  'K_BANK', 'TOSS_BANK', 'SC', 'CITI', 'KDB', 'SUHYUP', 'POST_OFFICE', 'MG',
  'CREDIT_UNION', 'SAVINGS_BANK', 'BNK_BUSAN', 'BNK_GYEONGNAM', 'IM_BANK',
  'GWANGJU', 'JEONBUK', 'JEJU', 'HYUNDAI_CAPITAL', 'KB_CAPITAL',
  'SHINHAN_CAPITAL', 'HANA_CAPITAL', 'WOORI_FINANCIAL_CAPITAL', 'NH_CAPITAL',
  'LOTTE_CAPITAL', 'BNK_CAPITAL', 'JB_WOORI_CAPITAL', 'MIRAE_ASSET_SEC',
  'KOREA_INVESTMENT_SEC', 'NH_INVESTMENT_SEC', 'SAMSUNG_SEC', 'KB_SEC',
  'KIWOOM_SEC', 'SHINHAN_SEC', 'HANA_SEC', 'MERITZ_SEC', 'DAISHIN_SEC',
  'HANWHA_SEC', 'HYUNDAI_MOTOR_SEC', 'DB_SEC', 'YUANTA_SEC', 'EUGENE_SEC',
  'SK_SEC', 'IBK_SEC', 'KAKAO_PAY_SEC', 'TOSS_SEC', 'LS_SEC', 'SHINYOUNG_SEC',
] as const

export type FinancialInstitutionCode = (typeof financialInstitutionCodes)[number]
export type FinancialInstitutionUsage = 'DEPOSIT' | 'LOAN' | 'INVESTMENT'
export type FinancialInstitutionGroup = 'BANK' | 'CAPITAL' | 'SECURITIES' | 'OTHER'

export type FinancialInstitution = {
  code: FinancialInstitutionCode
  name: string
  shortName: string
  color: string
  usages: readonly FinancialInstitutionUsage[]
  group: FinancialInstitutionGroup
  logoUrl?: string
  popular?: boolean
}

const depositAndLoan = ['DEPOSIT', 'LOAN'] as const
const loanOnly = ['LOAN'] as const
const investmentOnly = ['INVESTMENT'] as const

export const financialInstitutions: readonly FinancialInstitution[] = [
  { code: 'OTHER', name: '기타 금융기관', shortName: '기타', color: '#647067', usages: ['DEPOSIT', 'LOAN', 'INVESTMENT'], group: 'OTHER', popular: true },
  { code: 'KB_KOOKMIN', name: 'KB국민은행', shortName: 'KB', color: '#6b5b32', logoUrl: officialFinancialInstitutionLogos.kb, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'SHINHAN', name: '신한은행', shortName: '신한', color: '#2459a9', logoUrl: officialFinancialInstitutionLogos.shinhan, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'HANA', name: '하나은행', shortName: '하나', color: '#008375', logoUrl: officialFinancialInstitutionLogos.hana, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'WOORI', name: '우리은행', shortName: '우리', color: '#1672b9', logoUrl: officialFinancialInstitutionLogos.woori, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'NH', name: 'NH농협은행', shortName: 'NH', color: '#168554', usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'IBK', name: 'IBK기업은행', shortName: 'IBK', color: '#246bad', logoUrl: officialFinancialInstitutionLogos.ibk, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'KAKAO_BANK', name: '카카오뱅크', shortName: '카카오', color: '#3c3525', logoUrl: officialFinancialInstitutionLogos.kakao, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'K_BANK', name: '케이뱅크', shortName: '케이', color: '#5d3bc4', logoUrl: officialFinancialInstitutionLogos.kbank, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'TOSS_BANK', name: '토스뱅크', shortName: '토스', color: '#2468e8', logoUrl: officialFinancialInstitutionLogos.toss, usages: depositAndLoan, group: 'BANK', popular: true },
  { code: 'SC', name: 'SC제일은행', shortName: 'SC', color: '#118c75', usages: depositAndLoan, group: 'BANK' },
  { code: 'CITI', name: '한국씨티은행', shortName: '씨티', color: '#1868a7', usages: depositAndLoan, group: 'BANK' },
  { code: 'KDB', name: 'KDB산업은행', shortName: 'KDB', color: '#1671a9', usages: depositAndLoan, group: 'BANK' },
  { code: 'SUHYUP', name: 'Sh수협은행', shortName: '수협', color: '#1672a8', usages: depositAndLoan, group: 'BANK' },
  { code: 'POST_OFFICE', name: '우체국예금', shortName: '우체국', color: '#d44736', usages: ['DEPOSIT'], group: 'BANK' },
  { code: 'MG', name: '새마을금고', shortName: 'MG', color: '#176947', usages: depositAndLoan, group: 'BANK' },
  { code: 'CREDIT_UNION', name: '신협', shortName: '신협', color: '#1f648f', usages: depositAndLoan, group: 'BANK' },
  { code: 'SAVINGS_BANK', name: '저축은행', shortName: '저축', color: '#52705f', usages: depositAndLoan, group: 'BANK' },
  { code: 'BNK_BUSAN', name: 'BNK부산은행', shortName: '부산', color: '#c53d46', usages: depositAndLoan, group: 'BANK' },
  { code: 'BNK_GYEONGNAM', name: 'BNK경남은행', shortName: '경남', color: '#c53d46', usages: depositAndLoan, group: 'BANK' },
  { code: 'IM_BANK', name: 'iM뱅크', shortName: 'iM', color: '#236cb4', usages: depositAndLoan, group: 'BANK' },
  { code: 'GWANGJU', name: '광주은행', shortName: '광주', color: '#cf3b43', usages: depositAndLoan, group: 'BANK' },
  { code: 'JEONBUK', name: '전북은행', shortName: '전북', color: '#3569a6', usages: depositAndLoan, group: 'BANK' },
  { code: 'JEJU', name: '제주은행', shortName: '제주', color: '#2872ae', usages: depositAndLoan, group: 'BANK' },
  { code: 'HYUNDAI_CAPITAL', name: '현대캐피탈', shortName: '현대', color: '#172a46', usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'KB_CAPITAL', name: 'KB캐피탈', shortName: 'KB', color: '#6b5b32', logoUrl: officialFinancialInstitutionLogos.kb, usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'SHINHAN_CAPITAL', name: '신한캐피탈', shortName: '신한', color: '#2459a9', logoUrl: officialFinancialInstitutionLogos.shinhan, usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'HANA_CAPITAL', name: '하나캐피탈', shortName: '하나', color: '#008375', logoUrl: officialFinancialInstitutionLogos.hana, usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'WOORI_FINANCIAL_CAPITAL', name: '우리금융캐피탈', shortName: '우리', color: '#1672b9', logoUrl: officialFinancialInstitutionLogos.woori, usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'NH_CAPITAL', name: 'NH농협캐피탈', shortName: 'NH', color: '#168554', usages: loanOnly, group: 'CAPITAL', popular: true },
  { code: 'LOTTE_CAPITAL', name: '롯데캐피탈', shortName: '롯데', color: '#d71920', usages: loanOnly, group: 'CAPITAL' },
  { code: 'BNK_CAPITAL', name: 'BNK캐피탈', shortName: 'BNK', color: '#c53d46', usages: loanOnly, group: 'CAPITAL' },
  { code: 'JB_WOORI_CAPITAL', name: 'JB우리캐피탈', shortName: 'JB', color: '#315d97', usages: loanOnly, group: 'CAPITAL' },
  { code: 'MIRAE_ASSET_SEC', name: '미래에셋증권', shortName: '미래', color: '#ef6c00', usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'KOREA_INVESTMENT_SEC', name: '한국투자증권', shortName: '한투', color: '#b33a3f', usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'NH_INVESTMENT_SEC', name: 'NH투자증권', shortName: 'NH', color: '#168554', usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'SAMSUNG_SEC', name: '삼성증권', shortName: '삼성', color: '#194da1', usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'KB_SEC', name: 'KB증권', shortName: 'KB', color: '#6b5b32', logoUrl: officialFinancialInstitutionLogos.kb, usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'KIWOOM_SEC', name: '키움증권', shortName: '키움', color: '#7b2f87', usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'SHINHAN_SEC', name: '신한투자증권', shortName: '신한', color: '#2459a9', logoUrl: officialFinancialInstitutionLogos.shinhan, usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'HANA_SEC', name: '하나증권', shortName: '하나', color: '#008375', logoUrl: officialFinancialInstitutionLogos.hana, usages: investmentOnly, group: 'SECURITIES', popular: true },
  { code: 'MERITZ_SEC', name: '메리츠증권', shortName: '메리츠', color: '#7a2432', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'DAISHIN_SEC', name: '대신증권', shortName: '대신', color: '#d9272e', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'HANWHA_SEC', name: '한화투자증권', shortName: '한화', color: '#e66b24', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'HYUNDAI_MOTOR_SEC', name: '현대차증권', shortName: '현대차', color: '#17365d', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'DB_SEC', name: 'DB증권', shortName: 'DB', color: '#24764c', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'YUANTA_SEC', name: '유안타증권', shortName: '유안타', color: '#d83a3f', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'EUGENE_SEC', name: '유진투자증권', shortName: '유진', color: '#31558c', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'SK_SEC', name: 'SK증권', shortName: 'SK', color: '#d95d26', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'IBK_SEC', name: 'IBK투자증권', shortName: 'IBK', color: '#246bad', logoUrl: officialFinancialInstitutionLogos.ibk, usages: investmentOnly, group: 'SECURITIES' },
  { code: 'KAKAO_PAY_SEC', name: '카카오페이증권', shortName: '카카오', color: '#3c3525', logoUrl: officialFinancialInstitutionLogos.kakao, usages: investmentOnly, group: 'SECURITIES' },
  { code: 'TOSS_SEC', name: '토스증권', shortName: '토스', color: '#2468e8', logoUrl: officialFinancialInstitutionLogos.toss, usages: investmentOnly, group: 'SECURITIES' },
  { code: 'LS_SEC', name: 'LS증권', shortName: 'LS', color: '#224c93', usages: investmentOnly, group: 'SECURITIES' },
  { code: 'SHINYOUNG_SEC', name: '신영증권', shortName: '신영', color: '#345c80', usages: investmentOnly, group: 'SECURITIES' },
]

const byCode = new Map(financialInstitutions.map((institution, index) => [institution.code, { institution, index }]))

export function financialInstitution(code: FinancialInstitutionCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.institution ?? financialInstitutions[0]
}

export function financialInstitutionsFor(usage: FinancialInstitutionUsage) {
  return financialInstitutions.filter((institution) => institution.usages.includes(usage))
}

export function financialInstitutionSupportsUsage(code: FinancialInstitutionCode, usage: FinancialInstitutionUsage) {
  return financialInstitution(code).usages.includes(usage)
}

export function financialInstitutionUsageFor(systemCode: string | undefined): FinancialInstitutionUsage | undefined {
  if (systemCode === 'BANK' || systemCode === 'SAVINGS') return 'DEPOSIT'
  if (systemCode === 'LOAN') return 'LOAN'
  if (systemCode === 'INVESTMENT') return 'INVESTMENT'
  return undefined
}

export function financialInstitutionName(code: FinancialInstitutionCode | null | undefined, usage?: FinancialInstitutionUsage) {
  const institution = financialInstitution(code)
  if (institution.code !== 'OTHER') return institution.name
  if (usage === 'LOAN') return '기타 대출 기관'
  if (usage === 'INVESTMENT') return '기타 증권사'
  return institution.name
}

export function financialInstitutionSortOrder(code: FinancialInstitutionCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.index ?? Number.MAX_SAFE_INTEGER
}
