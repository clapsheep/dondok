export const financialInstitutionCodes = [
  'OTHER', 'KB_KOOKMIN', 'SHINHAN', 'HANA', 'WOORI', 'NH', 'IBK', 'KAKAO_BANK',
  'K_BANK', 'TOSS_BANK', 'SC', 'CITI', 'KDB', 'SUHYUP', 'POST_OFFICE', 'MG',
  'CREDIT_UNION', 'SAVINGS_BANK', 'BNK_BUSAN', 'BNK_GYEONGNAM', 'IM_BANK',
  'GWANGJU', 'JEONBUK', 'JEJU',
] as const

export type FinancialInstitutionCode = (typeof financialInstitutionCodes)[number]

export type FinancialInstitution = {
  code: FinancialInstitutionCode
  name: string
  shortName: string
  color: string
  logoUrl?: string
  popular?: boolean
}

export const financialInstitutions: readonly FinancialInstitution[] = [
  { code: 'OTHER', name: '기타 금융기관', shortName: '기타', color: '#647067', popular: true },
  { code: 'KB_KOOKMIN', name: 'KB국민은행', shortName: 'KB', color: '#6b5b32', logoUrl: officialFinancialInstitutionLogos.kb, popular: true },
  { code: 'SHINHAN', name: '신한은행', shortName: '신한', color: '#2459a9', logoUrl: officialFinancialInstitutionLogos.shinhan, popular: true },
  { code: 'HANA', name: '하나은행', shortName: '하나', color: '#008375', logoUrl: officialFinancialInstitutionLogos.hana, popular: true },
  { code: 'WOORI', name: '우리은행', shortName: '우리', color: '#1672b9', logoUrl: officialFinancialInstitutionLogos.woori, popular: true },
  { code: 'NH', name: 'NH농협은행', shortName: 'NH', color: '#168554', popular: true },
  { code: 'IBK', name: 'IBK기업은행', shortName: 'IBK', color: '#246bad', logoUrl: officialFinancialInstitutionLogos.ibk, popular: true },
  { code: 'KAKAO_BANK', name: '카카오뱅크', shortName: '카카오', color: '#3c3525', logoUrl: officialFinancialInstitutionLogos.kakao, popular: true },
  { code: 'K_BANK', name: '케이뱅크', shortName: '케이', color: '#5d3bc4', logoUrl: officialFinancialInstitutionLogos.kbank, popular: true },
  { code: 'TOSS_BANK', name: '토스뱅크', shortName: '토스', color: '#2468e8', logoUrl: officialFinancialInstitutionLogos.toss, popular: true },
  { code: 'SC', name: 'SC제일은행', shortName: 'SC', color: '#118c75' },
  { code: 'CITI', name: '한국씨티은행', shortName: '씨티', color: '#1868a7' },
  { code: 'KDB', name: 'KDB산업은행', shortName: 'KDB', color: '#1671a9' },
  { code: 'SUHYUP', name: 'Sh수협은행', shortName: '수협', color: '#1672a8' },
  { code: 'POST_OFFICE', name: '우체국예금', shortName: '우체국', color: '#d44736' },
  { code: 'MG', name: '새마을금고', shortName: 'MG', color: '#176947' },
  { code: 'CREDIT_UNION', name: '신협', shortName: '신협', color: '#1f648f' },
  { code: 'SAVINGS_BANK', name: '저축은행', shortName: '저축', color: '#52705f' },
  { code: 'BNK_BUSAN', name: 'BNK부산은행', shortName: '부산', color: '#c53d46' },
  { code: 'BNK_GYEONGNAM', name: 'BNK경남은행', shortName: '경남', color: '#c53d46' },
  { code: 'IM_BANK', name: 'iM뱅크', shortName: 'iM', color: '#236cb4' },
  { code: 'GWANGJU', name: '광주은행', shortName: '광주', color: '#cf3b43' },
  { code: 'JEONBUK', name: '전북은행', shortName: '전북', color: '#3569a6' },
  { code: 'JEJU', name: '제주은행', shortName: '제주', color: '#2872ae' },
]

const byCode = new Map(financialInstitutions.map((institution, index) => [institution.code, { institution, index }]))

export function financialInstitution(code: FinancialInstitutionCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.institution ?? financialInstitutions[0]
}

export function financialInstitutionSortOrder(code: FinancialInstitutionCode | null | undefined) {
  return byCode.get(code ?? 'OTHER')?.index ?? Number.MAX_SAFE_INTEGER
}
import { officialFinancialInstitutionLogos } from './financialInstitutionLogos.ts'
