import type { ReactNode } from 'react'

/**
 * THE SETTINGS PAGE'S THREE SHAPES — card, row, group. Nothing on the page is allowed a fourth.
 *
 * The page had grown into a flat scroll of cards that each batch of work had styled to its own
 * taste: some with a title and some without, some with their own marginTop, some rendering a
 * control above its label and some beside it. Reading it meant re-learning the layout at every
 * card. These primitives exist so that a setting looks the same whether it writes to core.SETTING,
 * to a role record or to localStorage — because to the person reading the page, that difference
 * does not exist.
 *
 * They are LAYOUT ONLY. No primitive here knows how anything saves, what permission it needs or
 * what it is called; all of that stays with the section that owns the setting.
 */

/**
 * One card. Title, an optional one-line description, then whatever it holds.
 *
 * Spacing between cards belongs to the stack that contains them (`.set-stack`), never to the card
 * — that is what stops a new section from arriving with its own idea of how far apart things go.
 */
export function SettingsCard({
  title,
  description,
  headExtra,
  children,
}: {
  title: ReactNode
  /** One line on what the card is for. Omitted when the rows already say it. */
  description?: ReactNode
  /** Trailing chrome for the head — a link, a count. Rides to the logical end of the line. */
  headExtra?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="set-card">
      <div className="set-card-head">
        <h2 className="set-card-title">{title}</h2>
        {headExtra}
      </div>
      {description && <p className="set-card-desc">{description}</p>}
      {children && <div className="set-card-body">{children}</div>}
    </section>
  )
}

/** The container that draws the hairlines between rows. */
export function SettingRows({ children }: { children: ReactNode }) {
  return <div className="set-rows">{children}</div>
}

/**
 * ONE SETTING, ONE ROW.
 *
 * Label and hint on the reading edge, control on the trailing edge. The control is passed in at
 * whatever size it already was — this component never wraps or re-sizes it, so a setting keeps the
 * exact editor it had before the page was reorganised.
 *
 * `htmlFor` makes the label a real <label> for controls that have an id. Left off for a Switch or
 * a Radio.Group, which carry their own labelling and would otherwise be announced twice.
 */
export function SettingRow({
  label,
  hint,
  note,
  meta,
  control,
  htmlFor,
  error,
}: {
  label: ReactNode
  /** What this setting does, in one line. */
  hint?: ReactNode
  /** What the CURRENT value means, when that is not obvious from the number itself. */
  note?: ReactNode
  /** Provenance — the database key, when it last changed. */
  meta?: ReactNode
  control: ReactNode
  htmlFor?: string
  /** A refusal from this row's own save. Takes the full width so it pushes nothing sideways. */
  error?: ReactNode
}) {
  return (
    <div className="set-row">
      <div className="set-row-main">
        {htmlFor ? (
          <label className="set-row-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="set-row-label">{label}</div>
        )}
        {hint && <p className="set-row-hint">{hint}</p>}
        {note && <p className="set-row-note">{note}</p>}
        {meta && <div className="set-row-meta">{meta}</div>}
      </div>

      <div className="set-row-control">{control}</div>

      {error && (
        <div className="set-row-error alert alert--error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/**
 * A named band of rows inside a card — for settings that are separately titled but are not a
 * separate decision from the card they sit in.
 *
 * Used once, by Punch direction: two settings that are one choice, and whose title and explanation
 * already exist as translated strings that must keep being shown.
 */
export function SettingGroup({
  title,
  hint,
  children,
}: {
  title: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="set-group">
      <div className="set-group-title">{title}</div>
      {hint && <p className="set-group-hint">{hint}</p>}
      {children}
    </div>
  )
}
