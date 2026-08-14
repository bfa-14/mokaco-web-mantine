import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button, Select, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { employeeLabel } from '../../types/hr'
import { ChainFlow } from './workflowShared'
import { toFlowSteps } from './workflowFormat'
import { FormErrorBoundary } from './FormErrorBoundary'
import { GROUP_ORDER, groupLabel, groupOfType } from './newRequestShared'
import { localised } from '../../i18n/referenceName'
import type { RaiseContext, RequestFormBody } from './newRequestShared'

/**
 * THE FRAME every "raise a request" screen shares: which kind, who it is for, the chain that will
 * run, the title, the submit button and the errors. A typed FORM BODY is rendered inside it and
 * owns only the fields peculiar to its own type. (Unchanged contract; DevExtreme controls are
 * Mantine now, and the ValidationGroup is gone — `missing` was already the real gate, reported by
 * the body and the shell's own employee check, and the submit button obeys it.)
 */
export function NewRequestShell({
  ctx,
  body,
}: {
  ctx: RaiseContext
  /** The selected type's fields and its three answers. Null when no type is chosen, or it has no form yet. */
  body: RequestFormBody | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [titleOverride, setTitleOverride] = useState('')
  const [saving, setSaving] = useState(false)
  /** The API's refusal, shown verbatim ON the form — never only as a toast that vanishes. */
  const [error, setError] = useState<string | null>(null)

  const { types, me, employees, canRaiseOthers, selfBlocked, type, employeeId, chain } = ctx

  /* ── the type picker: search, grouping, and the narrow-screen equivalent ────────────────────── */

  const [search, setSearch] = useState('')

  /** The types with their DISPLAY label resolved once — list, search, dropdown and header agree. */
  const labelled = useMemo(
    () =>
      types.map((rt) => ({
        ...rt,
        label: localised(rt.menuLabel || rt.name, rt.menuLabelAr || rt.nameAr),
      })),
    [types],
  )

  /** Matches on the label AND the code, so typing "exp" or "EXPENSE" both find it. */
  const matching = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return labelled
    return labelled.filter(
      (rt) => rt.label.toLowerCase().includes(q) || rt.code.toLowerCase().includes(q),
    )
  }, [labelled, search])

  /** Grouped in GROUP_ORDER, empty groups dropped; the unmapped land in "Other". (Unchanged.) */
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: groupLabel(group),
        items: matching.filter((rt) => groupOfType(rt.code) === group),
      })).filter((g) => g.items.length > 0),
    [matching],
  )

  /** The same groups in Mantine Select's grouped shape. */
  const narrowItems = useMemo(
    () =>
      groups.map((g) => ({
        group: g.label,
        items: g.items.map((rt) => ({ value: rt.code, label: rt.label })),
      })),
    [groups],
  )

  const selectedType = useMemo(
    () => labelled.find((rt) => rt.code === type) ?? null,
    [labelled, type],
  )

  const onNarrowTypeChanged = useCallback(
    (value: string | null) => ctx.setType(value),
    [ctx],
  )

  const autoTitle = body?.autoTitle ?? null
  const effectiveTitle = titleOverride.trim() || autoTitle

  /**
   * Some types HAVE no subject employee — for those the field is REMOVED, not hidden to tidy up:
   * whatever was picked in it was discarded on the way to the database. Hidden means hidden
   * everywhere — the control and the missing-field check. (Unchanged.)
   */
  const hidesEmployee = body?.hidesEmployee === true

  const missing =
    !hidesEmployee && !employeeId ? t('requests.new.missingEmployee') : (body?.missing ?? null)

  async function submit() {
    if (!body) return
    if (!hidesEmployee && !employeeId) return

    setSaving(true)
    setError(null)
    try {
      // Send a title only when the user typed one; otherwise the procedure composes the default.
      const result = await body.submit(employeeId, titleOverride.trim() || null)
      notifications.show({ message: t('requests.new.submitted'), color: 'green' })
      // An advisory travels WITH the navigation, so it lands on the request it belongs to.
      navigate(`/requests/${result.requestId}`, {
        state: result.notice ? { notice: result.notice } : undefined,
      })
    } catch (err) {
      // Kept ON the form: a refusal is an instruction, and the user needs it while they fix things.
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {types.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('requests.new.nothingRaisable')}</div>
            {t('requests.new.nothingRaisableHint')}
          </div>
        </div>
      ) : (
        <div className="wf-raise-layout">
          {/* LEFT: the type list — fixed column, scrolls on its own. Below the breakpoint the CSS
              swaps this for the dropdown, and only one of the two is ever visible. (Unchanged.) */}
          <div className="wf-type-list wf-type-list--wide">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value.trimStart())}
              placeholder={t('requests.new.searchTypes')}
              leftSection={<IconSearch size={14} />}
              disabled={saving}
              aria-label={t('requests.new.searchTypesLabel')}
            />

            <div className="wf-type-groups">
              {groups.map((g) => (
                <div key={g.group} className="wf-type-group">
                  {/* The group's dot, shown once on its heading — where the hub's type dots get
                      their meaning. */}
                  <div className="wf-type-group-head">
                    <span
                      className={`wf-type-dot wf-type-dot--${g.group.toLowerCase()}`}
                      aria-hidden="true"
                    />
                    {g.label}
                  </div>
                  {g.items.map((rt) => {
                    const selected = type === rt.code
                    return (
                      <button
                        key={rt.code}
                        type="button"
                        className={
                          selected ? 'wf-type-row wf-type-row--selected' : 'wf-type-row'
                        }
                        aria-pressed={selected}
                        disabled={saving}
                        onClick={() => ctx.setType(rt.code)}
                      >
                        {rt.label}
                      </button>
                    )
                  })}
                </div>
              ))}
              {groups.length === 0 && (
                <p className="hint">{t('requests.new.noTypeMatch', { query: search })}</p>
              )}
            </div>
          </div>

          {/* NARROW: the same choice as one control — reads and writes the identical ctx.type. */}
          <div className="wf-type-list--narrow">
            <Select
              id="wf-type-picker"
              label={t('requests.new.requestType')}
              data={narrowItems}
              value={type}
              searchable
              placeholder={t('requests.new.chooseType')}
              disabled={saving}
              onChange={onNarrowTypeChanged}
            />
          </div>

          {/* RIGHT: the selected type's description and the chain that will run, then the form. */}
          <div className="wf-raise-main">
            {selectedType && (
              <div className="wf-type-header">
                <div className="wf-type-header-name">{selectedType.label}</div>
                {selectedType.description && (
                  <div className="wf-type-header-desc">
                    {localised(selectedType.description, selectedType.descriptionAr)}
                  </div>
                )}
                <ChainFlow steps={toFlowSteps(ctx.chains[selectedType.code] ?? [])} />
              </div>
            )}

            {/* A crash inside a body replaces THIS, leaving the picker and header usable. */}
            <FormErrorBoundary resetKey={type}>{renderForm()}</FormErrorBoundary>
          </div>
        </div>
      )}
    </>
  )

  /** The form column. (Unchanged in structure; controls are Mantine.) */
  function renderForm() {
    return selfBlocked ? (
      <div className="card">
        <div className="empty-hint">
          <div className="empty-hint-main">{t('requests.new.notLinked')}</div>
          {t('requests.new.notLinkedHint')}
        </div>
      </div>
    ) : body ? (
      <div className="card" style={{ maxWidth: 560 }}>
        {/* Employee. A self-service user sees a locked display of themselves; only a
            raise-for-others user gets the searchable list. Absent entirely for a branch-scoped
            type — see hidesEmployee above. */}
        {!hidesEmployee && (
          <div className="form-field">
            {canRaiseOthers ? (
              <>
                <Select
                  label={t('requests.new.employee')}
                  data={employees.map((e) => ({
                    value: String(e.employeeId),
                    label: employeeLabel(e),
                  }))}
                  value={employeeId != null ? String(employeeId) : null}
                  searchable
                  placeholder={t('requests.new.chooseEmployee')}
                  disabled={saving}
                  onChange={(v) => ctx.setEmployeeId(v != null ? Number(v) : null)}
                />
                <div className="hint">
                  {employeeId != null && employeeId !== me?.employeeId
                    ? t('requests.new.onBehalf')
                    : t('requests.new.defaultsToYou')}
                </div>
              </>
            ) : (
              me && (
                <>
                  <label className="form-label">{t('requests.new.employee')}</label>
                  <div className="metric">
                    {me.fullName} — {me.branchName}{' '}
                    <span className="form-optional">{t('requests.new.thisIsYou')}</span>
                  </div>
                </>
              )
            )}
          </div>
        )}

        {/* THE TYPED BODY — the only part that differs between one kind of request and another. */}
        {body.node}

        {/* Optional title, with the auto-title as the placeholder and a live "listed as" preview. */}
        <div className="form-field">
          <TextInput
            id="req-title"
            label={
              <>
                {t('requests.new.titleLabel')}{' '}
                <span className="form-optional">{t('common.optional')}</span>
              </>
            }
            value={titleOverride}
            onChange={(e) => setTitleOverride(e.currentTarget.value)}
            placeholder={autoTitle ?? t('requests.new.titlePlaceholder')}
            disabled={saving}
          />
          <div className="wf-title-preview">
            <span className="wf-title-preview-label">{t('requests.new.listedAs')}</span>
            <span className="wf-title-preview-value">
              {effectiveTitle ?? t('requests.new.listedAsEmpty')}
            </span>
          </div>
        </div>

        {/* The chain, before submitting — nobody should be surprised about who signs. */}
        <div className="form-field">
          <label className="form-label">{t('requests.new.thisWillNeed')}</label>
          <ChainFlow
            steps={toFlowSteps(chain)}
            skipStepNo={ctx.willSkipStep1 ? chain[0]?.stepNo : undefined}
          />
          {ctx.willSkipStep1 && <div className="hint">{t('requests.new.step1Skipped')}</div>}
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        {/* The button reflects real validity: off only when a required field is actually missing,
            and it says which one — never a dead button with no explanation. */}
        {missing && !saving && (
          <p className="hint" style={{ textAlign: 'end', marginTop: 0 }}>
            {t('requests.new.addToSubmit', { what: missing })}
          </p>
        )}
        <div className="form-actions">
          <Button variant="default" onClick={() => navigate('/requests')} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || missing != null} loading={saving}>
            {saving ? t('requests.new.submitting') : t('requests.new.submit')}
          </Button>
        </div>
      </div>
    ) : type ? (
      <div className="card">
        <div className="empty-hint">
          <div className="empty-hint-main">{t('requests.new.noFormYet')}</div>
          {t('requests.new.noFormYetHint')}
        </div>
      </div>
    ) : (
      <p className="hint">{t('requests.new.chooseToBegin')}</p>
    )
  }
}
