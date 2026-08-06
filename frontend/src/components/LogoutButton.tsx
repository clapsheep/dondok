import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, clearCsrfToken } from '../lib/api'
import { Button } from './ui/Button'

type Props = {
  className?: string
  labelClassName?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
}

export function LogoutButton({ className, labelClassName, variant = 'ghost' }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: () => api<void>('/api/auth/session', { method: 'DELETE' }),
    onSuccess: () => {
      clearCsrfToken()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return (
    <Button className={className} variant={variant} aria-label="로그아웃" onClick={() => logout.mutate()} disabled={logout.isPending}>
      <LogOut size={18} aria-hidden="true" />
      <span className={labelClassName}>{logout.isPending ? '로그아웃 중…' : '로그아웃'}</span>
    </Button>
  )
}
