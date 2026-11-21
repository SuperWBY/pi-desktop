import type { ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './ui'

export function MarketSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}): ReactNode {
  return <Popover align="left" matchTriggerWidth gap={2} className="market-select" animateExit trigger={(_open, toggle, expanded) =>
    <button type="button" className="settings-select-button" aria-label={label} onClick={toggle} {...expanded}>
      <span>{options.find((option) => option.value === value)?.label ?? value}</span><ChevronDown size={13} />
    </button>}>
    {(close) => <div className="menu"><div className="menu-list">{options.map((option) =>
      <button type="button" key={option.value} role="menuitemradio" aria-checked={value === option.value}
        className={`menu-item${value === option.value ? ' active' : ''}`} onClick={() => { onChange(option.value); close() }}>
        <span className="menu-item-main"><span className="menu-item-title">{option.label}</span></span>{value === option.value && <Check size={14} />}
      </button>)}</div></div>}
  </Popover>
}
