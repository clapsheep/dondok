import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export type LegalDocuments = { version: string; terms: string; privacy: string; collection: string }
export type SignUpConsent = { version: string; age14OrOlder: boolean; termsAccepted: boolean; privacyAccepted: boolean }

export function useLegalDocuments() {
  return useQuery({ queryKey: ['legal-documents'], queryFn: () => api<LegalDocuments>('/api/legal'), staleTime: Infinity })
}
