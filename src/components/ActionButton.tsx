import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, LoaderCircle } from 'lucide-react'

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean
  busyLabel?: ReactNode
  success?: boolean
  successLabel?: ReactNode
}

export function ActionButton({
  busy = false,
  busyLabel = '处理中…',
  success = false,
  successLabel = '已完成',
  className = '',
  disabled,
  children,
  ...props
}: ActionButtonProps) {
  const state = success ? 'success' : busy ? 'busy' : 'idle'

  return (
    <button
      {...props}
      className={`button action-button ${className}`.trim()}
      disabled={disabled || busy || success}
      aria-busy={busy || undefined}
      data-state={state}
    >
      <span className="action-button-state" aria-live={state === 'idle' ? undefined : 'polite'}>
        {busy ? <><LoaderCircle className="button-spinner" size={16} /><span>{busyLabel}</span></> : success ? <><Check className="button-success-icon" size={16} /><span>{successLabel}</span></> : children}
      </span>
    </button>
  )
}
