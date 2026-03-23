import React from 'react'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default to button to prevent accidental form submit behavior */
  type?: 'button' | 'submit' | 'reset'
}

export function ActionButton({ type = 'button', className = '', children, ...props }: ActionButtonProps) {
  return (
    <button
      type={type}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}
