import type { ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './ui'

/** A single-choice control whose menu follows the trigger's width. */
export function DesktopSelect({ label, value, options, onChange, disabled = false, className = '' }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}): ReactNode {
  const selected = options.find((option) => option.value === value)
  return <Popover align="left" matchTriggerWidth gap={2} className={`desktop-select ${className}`} animateExit
    trigger={(_open, toggle, expanded) => <button type="button" className="settings-select-button" aria-label={label}
      title={selected?.label} disabled={disabled} onClick={toggle} {...expanded}>
      <span>{selected?.label ?? value}</span><ChevronDown size={13} />
    </button>}>
    {(close) => <div className="menu"><div className="menu-list">{options.map((option) =>
      <button type="button" key={option.value} role="menuitemradio" aria-checked={value === option.value}
        title={option.label} className={`menu-item${value === option.value ? ' active' : ''}`}
        onClick={() => { if (value !== option.value) onChange(option.value); close() }}>
        <span className="menu-item-main"><span className="menu-item-title">{option.label}</span></span>
        {value === option.value && <Check size={14} />}
      </button>)}</div></div>}
  </Popover>
}
