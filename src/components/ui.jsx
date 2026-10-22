import { Search, Inbox, AlertTriangle, Info, CheckCircle2, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { logoUrl } from '../lib/schoolLogo.js'
import { cloneElement, isValidElement, useId, useState } from 'react'

export function Button({ variant = 'default', size, icon: Icon, children, className = '', ...props }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, !children && 'btn-icon', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} {...props}>
      {Icon && <Icon size={size === 'sm' ? 15 : 17} aria-hidden />}
      {children}
    </button>
  )
}

export function Spinner() {
  return <span className="spinner" role="progressbar" aria-label="Loading" />
}

export function Loading({ label = 'Loading...' }) {
  return (
    <div className="loading">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={38} aria-hidden />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

export function Alert({ type = 'info', children, className = '' }) {
  const Icon = type === 'ok' ? CheckCircle2 : type === 'info' ? Info : AlertTriangle
  return (
    <div className={`alert ${type} ${className}`} role={type === 'danger' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

/** Label + control + help/error text, wired together for screen readers. */
export function Field({ label, error, help, className = '', children }) {
  const id = useId()
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-e` : undefined })
    : children
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {help && !error && <span className="help">{help}</span>}
      {error && <span className="err" id={`${id}-e`}>{error}</span>}
    </div>
  )
}

/** The school's logo, shown right before its name. Renders nothing when no logo has been uploaded. */
export function SchoolLogo({ school, size = 32 }) {
  const url = logoUrl(school?.logo_path)
  if (!url) return null
  return <img className="school-logo" src={url} alt="" width={size} height={size} style={{ height: size, maxWidth: size * 2 }} />
}

/** Password input with a show/hide toggle. Props go to the <input>, so it works inside <Field>. */
export function PasswordInput({ className = '', icon: Icon, ...props }) {
  const [shown, setShown] = useState(false)
  const label = shown ? 'Hide password' : 'Show password'
  return (
    <div className="password-wrap">
      {Icon && <Icon className="input-lead" size={19} aria-hidden />}
      <input {...props} className={`input ${Icon ? 'has-lead ' : ''}${className}`.trim()} type={shown ? 'text' : 'password'} />
      <button type="button" className="password-toggle" onClick={() => setShown((v) => !v)} aria-label={label} aria-pressed={shown} title={label}>
        {shown ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  )
}

export function Select({ value, onChange, options, placeholder, className = '', ...props }) {
  return (
    <select className={`select ${className}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="search">
      <Search size={17} aria-hidden />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

export function Badge({ tone = 'default', children }) {
  return <span className={`badge ${tone === 'default' ? '' : tone}`}>{children}</span>
}

export function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="card stat">
      <span className="label">{Icon && <Icon size={16} aria-hidden />}{label}</span>
      <span className="value mono">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header no-print">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="pager">
      <span className="muted small">{from}-{to} of {total}</span>
      <div className="row">
        <Button size="sm" icon={ChevronLeft} disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="small">Page {page + 1} of {pages}</span>
        <Button size="sm" icon={ChevronRight} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </div>
  )
}

export function VerifiedBadge({ verified }) {
  return verified ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">Not verified</Badge>
}

export function StatusBadge({ status }) {
  const map = {
    incomplete: ['warn', 'Incomplete'],
    provisional: ['info', 'Provisional'],
    finalized: ['ok', 'Finalized'],
    approved: ['ok', 'Approved'],
  }
  const [tone, label] = map[status] ?? ['muted', status ?? '-']
  return <Badge tone={tone}>{label}</Badge>
}
