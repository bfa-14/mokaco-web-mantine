import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActionIcon,
  Button,
  Checkbox,
  Loader,
  NumberInput,
  Table,
  TextInput,
} from '@mantine/core'
import { Modal } from '../../components/dialogs'
import { notifications } from '@mantine/notifications'
import {
  IconCalendarCheck,
  IconCheck,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { PageHelp } from '../../components/PageHelp'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { leavePolicyService, leaveTypesService } from '../../services/hrService'
import { fmtNumber } from './hrFormat'
import type { LeavePolicy, LeaveType, LeaveYearOpenSummary } from '../../types/hr'

/**
 * THE CAUTION, VERBATIM. These figures are the statutory minimums, and the screen must say so
 * before anyone edits them — and say the other thing people assume wrongly: nothing already
 * approved is recalculated when a figure changes.
 */
const CAUTION =
  'These figures follow Lebanese labour law. Changes apply to NEW requests only — nothing already ' +
  'approved is recalculated.'

/**
 * notify(msg, type, ms) → Mantine notifications, adapted once so every call site below
 * stays byte-identical to the original.
 */
function notify(message: string, type: 'success' | 'error', ms: number) {
  notifications.show({ message, color: type === 'success' ? 'green' : 'red', autoClose: ms })
}

/** The editable shape of a leave type. `null` id = the "+ New leave type" draft. */
interface TypeForm {
  leaveTypeId: number | null
  name: string
  isPaid: boolean
  carryOver: boolean
  requiresCertificate: boolean
  minServiceMonthsToUse: number
  noticePreferredDays: number
  /** Null is a real value here — "this type has no fixed entitlement" — not an empty field. */
  fixedEntitlementDays: number | null
}

function toForm(t: LeaveType): TypeForm {
  return {
    leaveTypeId: t.leaveTypeId,
    name: t.name,
    isPaid: t.isPaid,
    carryOver: t.carryOver,
    requiresCertificate: t.requiresCertificate,
    minServiceMonthsToUse: t.minServiceMonthsToUse,
    noticePreferredDays: t.noticePreferredDays,
    fixedEntitlementDays: t.fixedEntitlementDays,
  }
}

const BLANK: TypeForm = {
  leaveTypeId: null,
  name: '',
  isPaid: true,
  carryOver: false,
  requiresCertificate: false,
  minServiceMonthsToUse: 0,
  noticePreferredDays: 0,
  fixedEntitlementDays: null,
}

/** The tags on a master-list row — only what is true, so an ordinary type carries none. */
function TypeTags({ type }: { type: LeaveType }) {
  return (
    <span className="wf-policy-tags">
      <span className={type.isPaid ? 'badge badge--on' : 'badge badge--muted'}>
        {type.isPaid ? 'paid' : 'unpaid'}
      </span>
      {type.requiresCertificate && <span className="badge badge--muted">certificate</span>}
      {type.isDiscretionary && <span className="badge badge--muted">discretionary</span>}
    </span>
  )
}

/**
 * Leave policy — the figures behind entitlement, edited where they belong: HR, not Settings.
 *
 * ACCRUAL IS THE TIER GRID, FOR EVERY TYPE. There is no per-month rate any more: entitlement is
 * hr.LEAVE_ACCRUAL_TIER, read through fn_GetAnnualEntitlement, and the grid is shown on every type
 * because "no rows" is a meaningful setting — it says this type does not accrue — and it cannot be
 * chosen from a grid that is hidden. A flat entitlement is simply one row at 0 years.
 *
 * The OTHER two grids stay conditional: sick-pay tiers and relation caps appear only for a type
 * that has rows, because an empty "Sick pay by tenure" grid on Bereavement invites someone to fill
 * it in and invent a rule the request procedures never consult.
 */
export default function LeavePolicyPage() {
  /* LEAVE_POLICY_MANAGE, or the whole page is a reader. Every field, every grid row action and both
     buttons come off it — this page IS an editor, so without the trust it becomes the statement of
     what the policy currently is, which is still worth reading. */
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.LEAVE_POLICY_MANAGE)
  const [policy, setPolicy] = useState<LeavePolicy | null>(null)
  /** Which type the panel is on. NULL means the "+ New leave type" draft, which is in no list yet. */
  const [selectedId, setSelectedId] = useState<number | null>(null)
  /**
   * UNSAVED EDITS, tagged with the type they belong to. The panel is DERIVED from the selection and
   * the stored row; this only overrides it while someone is typing. Tagging is what removes the
   * usual "sync the form to the selection" effect: change the selection and the tag stops matching,
   * so the stored row shows again in the same render rather than one render later.
   */
  const [draft, setDraft] = useState<TypeForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** Every input and action on the page reads this: mid-save, or never allowed in the first place. */
  const locked = saving || !canManage
  const [error, setError] = useState<string | null>(null)
  /** The TYPE FORM's own refusal, separate from `error` so a failed load and a failed save cannot
      overwrite one another — they are about different things and sit in different places. */
  const [formError, setFormError] = useState<string | null>(null)

  /* ── OPENING THE LEAVE YEAR ──
     The grid above says what a year is WORTH; this is the act that grants it. Kept behind a modal
     with its own confirmation because it writes a ledger movement for every active employee at
     once — the largest single write this page can cause. */
  const [yearOpen, setYearOpen] = useState(false)
  /**
   * THE YEAR IS NOT A CHOICE — only the current one may be opened, so this is derived rather than
   * held in state. Computed at render, which also means a session left open across New Year's Eve
   * offers the new year rather than the stale one it started with.
   */
  const openYearValue = new Date().getFullYear()
  const [openingBusy, setOpeningBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  /** The run's per-type summary. Null until it has run; an EMPTY array is a real answer — see below. */
  const [openSummary, setOpenSummary] = useState<LeaveYearOpenSummary[] | null>(null)

  const load = useCallback(async (selectId?: number) => {
    try {
      const p = await leavePolicyService.getAll()
      setPolicy(p)
      setError(null)
      // Keep the panel on the same type across a reload; fall back to the first.
      setSelectedId((prev) => {
        const want = selectId ?? prev
        return p.types.some((t) => t.leaveTypeId === want) ? want! : (p.types[0]?.leaveTypeId ?? null)
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    async function initial() {
      await load()
    }
    void initial()
  }, [load])

  const selectedType = policy?.types.find((t) => t.leaveTypeId === selectedId) ?? null

  /**
   * What the panel shows: the unsaved draft when it belongs to THIS selection, otherwise the stored
   * row. Null when nothing is selected and nothing is being drafted.
   */
  const form: TypeForm | null =
    draft && draft.leaveTypeId === selectedId ? draft : selectedType ? toForm(selectedType) : null

  /* This type's own rows out of the policy payload. Declared HERE, above the writes, because the
     fixed-entitlement rule below needs them and so does the save — not only the JSX. */
  const typeId = form?.leaveTypeId ?? null
  const accrual = policy?.accrualTiers.filter((t) => t.leaveTypeId === typeId) ?? []
  const pay = policy?.payTiers.filter((t) => t.leaveTypeId === typeId) ?? []
  const relations = policy?.relations.filter((r) => r.leaveTypeId === typeId) ?? []

  /**
   * THE TYPE ALREADY ANSWERS "how many days" WITH ITS TIERS — accrual by tenure, sick pay by
   * tenure, or a relation cap. A fixed entitlement is a second answer to that same question, and
   * two figures that can disagree is one figure too many, so the field is closed on a tiered type
   * rather than left open to be quietly overruled.
   *
   * An event type with no rows at all (maternity) is exactly the case a fixed entitlement is FOR,
   * which is why the test is "has any rows" and not a list of type names.
   */
  const tiered = accrual.length > 0 || pay.length > 0 || relations.length > 0

  /**
   * WHY the fixed entitlement is closed, or null while it is open. Two independent reasons, so the
   * field says which one it is rather than just refusing to be typed in:
   *
   *  'unpaid' — unpaid leave entitles nobody to anything. Time off without pay is granted, not
   *             owed, so a figure saying how much of it is due is a category error.
   *  'tiered' — the tiers already answer "how many days". A fixed entitlement would be a second
   *             answer to the same question, and two figures that can disagree is one too many.
   *
   * UNPAID IS REPORTED FIRST when both apply, because "Paid" is a checkbox in this very panel: the
   * reason shown has to be the one the user just caused. Re-check it and the tier reason takes
   * over, which reads as one obstacle at a time rather than as a field that never explains itself.
   *
   * Open only for a PAID, TIER-LESS event type — maternity being the case the field exists for.
   */
  const fixedEntitlementBlockedBy: 'unpaid' | 'tiered' | null =
    form != null && !form.isPaid ? 'unpaid' : tiered ? 'tiered' : null

  /**
   * The figure the field shows AND the figure the save sends — one value, so the blanked input and
   * the stored row cannot drift apart. Null whenever the field is closed, which the save states as
   * an explicit clear rather than an omission.
   */
  const fixedEntitlementDays =
    fixedEntitlementBlockedBy != null ? null : (form?.fixedEntitlementDays ?? null)

  /** Edit one field. Seeds from whatever the panel is currently showing, stored row included. */
  function patch(change: Partial<TypeForm>) {
    if (!form) return
    setDraft({ ...form, ...change })
  }

  /** Runs a policy write, then reloads — every grid edit goes through here so failures read alike. */
  async function run(action: () => Promise<unknown>, done: string, keepId?: number) {
    setSaving(true)
    try {
      await action()
      await load(keepId)
      notify(done, 'success', 2200)
      return true
    } catch (err) {
      // The procedures refuse duplicates and bad figures with their own wording — shown verbatim.
      notify(getErrorMessage(err), 'error', 6000)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveType() {
    if (!form) return
    if (!form.name.trim()) {
      setFormError(t('hr.leavePolicy.nameRequired'))
      return
    }
    setFormError(null)
    const payload = {
      name: form.name.trim(),
      isPaid: form.isPaid,
      carryOver: form.carryOver,
      requiresCertificate: form.requiresCertificate,
      minServiceMonthsToUse: form.minServiceMonthsToUse,
      noticePreferredDays: form.noticePreferredDays,
      // The DERIVED figure, so a type that has grown tiers since its entitlement was set actually
      // loses that entitlement on the next save instead of keeping a figure the field no longer
      // shows and nothing consults.
      fixedEntitlementDays,
      // Null here means "no fixed entitlement", NOT "leave alone" — say so explicitly, or the
      // preserve rule on the server would keep the old figure forever.
      clearFixedEntitlement: fixedEntitlementDays == null,
    }

    setSaving(true)
    try {
      const saved = form.leaveTypeId
        ? await leaveTypesService.update(form.leaveTypeId, payload)
        : await leaveTypesService.create(payload)
      // Settle from the SAVE: the row comes back as stored, so the new type's id is known without
      // guessing which of the reloaded rows is the one just created. The draft is dropped, which
      // hands the panel back to the stored row — the proof that what was typed is what was kept.
      setDraft(null)
      setSelectedId(saved.leaveTypeId)
      await load(saved.leaveTypeId)
      notify('Leave type saved.', 'success', 2200)
    } catch (err) {
      // IN THE FORM, NOT A TOAST. A 400 here is the procedure's own refusal — a duplicate name, a
      // figure it will not take — and it belongs beside the fields that caused it, where it stays
      // readable while they are corrected instead of timing out.
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function openYearDialog() {
    setOpenError(null)
    setOpenSummary(null)
    setYearOpen(true)
  }

  async function runYearOpen() {
    setOpenError(null)
    setOpeningBusy(true)
    try {
      const summary = await leavePolicyService.openYear(openYearValue)
      setOpenSummary(summary)
      // The grants land in the ledger, so anything on this page derived from the policy is re-read.
      // Balances themselves live on the employee screens; the API raises its own live 'hr' event
      // for those, which is why this only refreshes what is actually on screen here.
      await load(selectedId ?? undefined)
    } catch (err) {
      // The procedure's refusal — "leave year 2025 has not been opened yet" — verbatim and in the
      // dialog, because it names the next thing to do.
      setOpenError(getErrorMessage(err))
    } finally {
      setOpeningBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  const types = policy?.types ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Leave policy</h1>
          <p className="page-subtitle">What each kind of leave entitles, and to whom.</p>
        </div>
        <div className="page-head-actions">
          {canManage && (
            <Button
              variant="default"
              disabled={locked}
              onClick={() => {
                // A new type belongs to no list row, so the selection moves to null and the draft
                // carries the blank form — the same tag rule, with null as the tag.
                setSelectedId(null)
                setFormError(null)
                setDraft({ ...BLANK })
              }}
            >
              + New leave type
            </Button>
          )}
        </div>
      </div>

      {/* The caution, verbatim and above everything — it governs every figure on the page. */}
      <div className="wf-policy-caution" role="note">
        {CAUTION}
      </div>

      <PageHelp>
        Pick a leave type to see what it entitles. Tiers are read as floors — the highest one at or
        below an employee’s tenure applies — so “0 → 15, 5 → 21” means fifteen days until five
        years’ service, twenty-one after.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="wf-policy-layout">
        {/* Master list */}
        <div className="card wf-policy-list">
          {types.map((t) => {
            const active = t.leaveTypeId === typeId
            return (
              <button
                key={t.leaveTypeId}
                type="button"
                className={active ? 'wf-policy-row wf-policy-row--active' : 'wf-policy-row'}
                aria-pressed={active}
                disabled={locked}
                onClick={() => {
                  // Drop any unsaved draft when another type is chosen — the panel then derives
                  // itself from the stored row. The refusal goes with it: it was about the type
                  // being left, and carrying it over would attach it to an innocent one.
                  setDraft(null)
                  setFormError(null)
                  setSelectedId(t.leaveTypeId)
                }}
              >
                <span className="wf-policy-row-name">{t.name}</span>
                <TypeTags type={t} />
              </button>
            )
          })}
          {types.length === 0 && <div className="hint">No leave types yet.</div>}
        </div>

        {/* Edit panel */}
        {form ? (
          <div className="wf-policy-panel">
            <div className="card">
              <div className="card-title">
                {form.leaveTypeId ? form.name || 'Leave type' : 'New leave type'}
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="lp-name">
                  Name
                </label>
                <TextInput
                  id="lp-name"
                  value={form.name}
                  disabled={locked}
                  onChange={(e) => patch({ name: e.currentTarget.value })}
                />
              </div>

              <div className="wf-policy-flags">
                <Checkbox
                  label="Paid"
                  checked={form.isPaid}
                  disabled={locked}
                  onChange={(e) => patch({ isPaid: e.currentTarget.checked })}
                />
                <Checkbox
                  label="Carries over"
                  checked={form.carryOver}
                  disabled={locked}
                  onChange={(e) => patch({ carryOver: e.currentTarget.checked })}
                />
                <Checkbox
                  label="Requires certificate"
                  checked={form.requiresCertificate}
                  disabled={locked}
                  onChange={(e) => patch({ requiresCertificate: e.currentTarget.checked })}
                />
                {/* NO "Discretionary" HERE ANY MORE. Waiving the deduction is decided per REQUEST,
                    by the approver who closes it (usp_LeaveRequest_Decide's @MakeDiscretionary), so
                    a type-level switch would state a rule nothing consults. */}
              </div>
              {form.requiresCertificate && (
                <div className="hint">
                  A request of this type cannot be approved until a document is attached to it.
                </div>
              )}

              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="form-field">
                  <label className="form-label">Min service to use (months)</label>
                  <NumberInput
                    value={form.minServiceMonthsToUse}
                    min={0}
                    disabled={locked}
                    onChange={(v) =>
                      patch({ minServiceMonthsToUse: typeof v === 'number' ? v : 0 })
                    }
                  />
                  <div className="hint">Balance accrues from hire; only USE is gated.</div>
                </div>
                <div className="form-field">
                  <label className="form-label">Preferred notice (days)</label>
                  <NumberInput
                    value={form.noticePreferredDays}
                    min={0}
                    disabled={locked}
                    onChange={(v) =>
                      patch({ noticePreferredDays: typeof v === 'number' ? v : 0 })
                    }
                  />
                  <div className="hint">Advisory — short notice warns, never blocks.</div>
                </div>
                {/* No accrual field. Entitlement is the "Accrual by tenure" grid below and nowhere
                    else — a single rate here could not express "15 days, then 21 after five years",
                    and two places to state it is one place to disagree. */}
                <div className="form-field">
                  <label className="form-label">Fixed entitlement (days)</label>
                  {/* PORT NOTE: NumberBox showClearButton → clearing the input is what sets null. */}
                  <NumberInput
                    /* Blank and closed for either reason — see `fixedEntitlementBlockedBy` above.
                       The value is the derived one, so what the field shows is what a save would
                       store. */
                    value={fixedEntitlementDays ?? ''}
                    min={0}
                    step={1}
                    placeholder={fixedEntitlementBlockedBy != null ? '' : 'None'}
                    disabled={locked || fixedEntitlementBlockedBy != null}
                    onChange={(v) =>
                      patch({ fixedEntitlementDays: typeof v === 'number' ? v : null })
                    }
                  />
                  <div className="hint">
                    {fixedEntitlementBlockedBy === 'unpaid'
                      ? t('hr.leavePolicy.fixedUnpaid')
                      : fixedEntitlementBlockedBy === 'tiered'
                        ? t('hr.leavePolicy.fixedFromTiers')
                        : 'A whole entitlement, e.g. maternity. Blank for none.'}
                  </div>
                </div>
              </div>

              {formError && (
                <div className="alert alert--error" role="alert">
                  {formError}
                </div>
              )}

              {canManage && (
                <div className="form-actions">
                  <Button disabled={locked} onClick={() => void saveType()}>
                    {saving ? 'Saving…' : form.leaveTypeId ? 'Save changes' : 'Create leave type'}
                  </Button>
                </div>
              )}
            </div>

            {/* The grids need an id to write against, so a type being created shows none until saved. */}
            {form.leaveTypeId == null ? (
              <p className="hint">Save the type first, then its tiers can be set.</p>
            ) : (
              <>
                {/* THE GRANTING ACT, beside the grid that decides what it grants. Not inside the
                    TierGrid: it is not an edit to this type's tiers — it opens the year for EVERY
                    type at once, which is why it sits above them all rather than in one. */}
                {canManage && (
                  /* flex-end, not `right` — a flex row already follows the writing direction, so
                     this sits at the inline end in both languages with no [dir] rule. */
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    {/* The page's secondary-action button, prop for prop: variant="default" with a
                        16px leading icon, exactly as "Print balances" carries its printer. Mantine
                        lays `leftSection` out with logical properties, so under DirectionProvider
                        the icon moves to the right of the label in Arabic on its own — the same way
                        every other icon button in the app flips, and why none of them hand-code it.
                        No colour props: the variant's theme tokens are the whole appearance. */}
                    <Button
                      variant="default"
                      leftSection={<IconCalendarCheck size={16} />}
                      disabled={locked}
                      onClick={openYearDialog}
                    >
                      {t('hr.leaveYear.action')}
                    </Button>
                  </div>
                )}

                {/* ALWAYS shown, for every type — see the note at the top of this file. */}
                <TierGrid
                  key={`accrual-${form.leaveTypeId}`}
                  title="Accrual by tenure"
                  subtitle="One row at 0 years = a flat rate. No rows = this type does not accrue."
                  rows={accrual}
                  keyField="minServiceYears"
                  columns={[
                    { field: 'minServiceYears', caption: 'From (years)' },
                    { field: 'annualDays', caption: 'Annual days' },
                  ]}
                  disabled={locked}
                  readOnly={!canManage}
                  onSet={(row) =>
                    run(
                      () =>
                        leavePolicyService.setAccrualTier(
                          form.leaveTypeId!,
                          Number(row.minServiceYears),
                          Number(row.annualDays),
                        ),
                      'Accrual tier saved.',
                      form.leaveTypeId!,
                    )
                  }
                  onDelete={(row) =>
                    run(
                      () =>
                        leavePolicyService.deleteAccrualTier(
                          form.leaveTypeId!,
                          Number(row.minServiceYears),
                        ),
                      'Accrual tier removed.',
                      form.leaveTypeId!,
                    )
                  }
                />

                {/* Sick pay and relations exist only where the type actually uses them. */}
                {pay.length > 0 && (
                  <TierGrid
                    key={`pay-${form.leaveTypeId}`}
                    title="Sick pay by tenure"
                    subtitle="Days at full pay and days at half, from this many years of service."
                    rows={pay}
                    keyField="minServiceYears"
                    columns={[
                      { field: 'minServiceYears', caption: 'From (years)' },
                      { field: 'fullPayDays', caption: 'Full pay' },
                      { field: 'halfPayDays', caption: 'Half pay' },
                    ]}
                    disabled={locked}
                    readOnly={!canManage}
                    onSet={(row) =>
                      run(
                        () =>
                          leavePolicyService.setPayTier(
                            form.leaveTypeId!,
                            Number(row.minServiceYears),
                            Number(row.fullPayDays),
                            Number(row.halfPayDays),
                          ),
                        'Sick pay tier saved.',
                        form.leaveTypeId!,
                      )
                    }
                    onDelete={(row) =>
                      run(
                        () =>
                          leavePolicyService.deletePayTier(
                            form.leaveTypeId!,
                            Number(row.minServiceYears),
                          ),
                        'Sick pay tier removed.',
                        form.leaveTypeId!,
                      )
                    }
                  />
                )}

                {relations.length > 0 && (
                  <TierGrid
                    key={`relations-${form.leaveTypeId}`}
                    title="Relations"
                    subtitle="Who the leave may be taken for, and the most days each allows."
                    rows={relations}
                    keyField="relation"
                    columns={[
                      { field: 'relation', caption: 'Relation', type: 'text' },
                      { field: 'days', caption: 'Days' },
                    ]}
                    disabled={locked}
                    readOnly={!canManage}
                    onSet={(row) =>
                      run(
                        () =>
                          leavePolicyService.setRelation(
                            form.leaveTypeId!,
                            String(row.relation).trim(),
                            Number(row.days),
                          ),
                        'Relation saved.',
                        form.leaveTypeId!,
                      )
                    }
                    onDelete={(row) =>
                      run(
                        () =>
                          leavePolicyService.deleteRelation(form.leaveTypeId!, String(row.relation)),
                        'Relation removed.',
                        form.leaveTypeId!,
                      )
                    }
                  />
                )}
              </>
            )}
          </div>
        ) : (
          <p className="hint">Choose a leave type to edit its policy.</p>
        )}
      </div>

      {yearOpen && (
        <Modal
          opened
          onClose={() => setYearOpen(false)}
          title={t('hr.leaveYear.title')}
          size={620}
          centered
          closeOnClickOutside={!openingBusy}
        >
          {/* The explanation is the substance of the dialog — this writes to every active
              employee's ledger, and "run it and see" is not an acceptable way to find that out. */}
          <p style={{ marginTop: 0 }}>{t('hr.leaveYear.explain')}</p>

          <div className="form-field">
            <label className="form-label" htmlFor="leave-year">
              {t('hr.leaveYear.year')}
            </label>
            {/* FIXED, NOT CHOSEN. Only the current year may be opened, so the box states which year
                that is and takes no input — read-only rather than hidden, because the year the run
                will act on is the single most important thing to have confirmed before pressing a
                button that writes to every active employee's ledger. No onChange: there is nothing
                to change, and a handler here would be dead code implying otherwise. */}
            <NumberInput id="leave-year" value={openYearValue} readOnly disabled w={160} />
            <p className="hint" style={{ marginTop: 6 }}>
              {t('hr.leaveYear.yearLocked')}
            </p>
          </div>

          {openError && (
            <div className="alert alert--error" role="alert">
              {openError}
            </div>
          )}

          {/* WHAT IT DID, per type. An empty result is a real answer, not a failure: it means every
              employee was already opened for that year, which is exactly what a safe second run
              looks like — so it is said in words rather than left as a blank table. */}
          {openSummary !== null &&
            (openSummary.length === 0 ? (
              <p className="hint">{t('hr.leaveYear.nothingToDo', { year: openYearValue })}</p>
            ) : (
              <>
                <Table striped withTableBorder verticalSpacing="xs" fz="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('hr.leaveYear.colType')}</Table.Th>
                      <Table.Th>{t('hr.leaveYear.colEmployees')}</Table.Th>
                      <Table.Th>{t('hr.leaveYear.colGranted')}</Table.Th>
                      <Table.Th>{t('hr.leaveYear.colCarried')}</Table.Th>
                      <Table.Th>{t('hr.leaveYear.colExpired')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {openSummary.map((row) => (
                      <Table.Tr key={row.leaveTypeName}>
                        <Table.Td>{row.leaveTypeName}</Table.Td>
                        <Table.Td>{row.employeesOpened}</Table.Td>
                        <Table.Td>{fmtDays(row.daysGranted)}</Table.Td>
                        <Table.Td>{fmtDays(row.daysCarriedOver)}</Table.Td>
                        <Table.Td>{fmtDays(row.daysExpired)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>

                {/* The figure that explains a total nobody expected: with part-year hires in the
                    run, headcount × annual entitlement will not match the granted days. */}
                {openSummary.some((row) => row.proratedEmployees > 0) && (
                  <p className="hint">
                    {t('hr.leaveYear.prorated', {
                      count: openSummary.reduce((sum, row) => sum + row.proratedEmployees, 0),
                    })}
                  </p>
                )}
              </>
            ))}

          {/* THE STANDARD MODAL PAIR, as DecidePopup states it: variant="default" to dismiss,
              the plain filled Button to commit — the same primary this page's "Save changes" is,
              carrying `loading` while the work is in flight rather than only being disabled. */}
          <div className="form-actions">
            <Button variant="default" onClick={() => setYearOpen(false)} disabled={openingBusy}>
              {openSummary !== null ? t('common.close') : t('common.cancel')}
            </Button>
            {/* Gone once it has run — the answer is on screen, and offering the button again beside
                it invites a second run whose only honest report would be "nothing to do". */}
            {openSummary === null && (
              <Button
                onClick={() => void runYearOpen()}
                loading={openingBusy}
                disabled={openingBusy}
              >
                {openingBusy ? t('hr.leaveYear.opening') : t('hr.leaveYear.confirm')}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

/** Leave days as the rest of the app prints them — up to two decimals, no trailing zeros. */
/* Was `(v: number) => v.toLocaleString(…)`. Same hazard as the profile tabs: the year-open summary
   is a stored-procedure result set, so a column the proc has not shipped yet arrives undefined and
   this threw instead of rendering. fmtNumber reads a missing figure as 0. */
const fmtDays = fmtNumber

/**
 * One inline-editable tier grid. Every write is an upsert keyed on the grid's own key column.
 *
 * PORT NOTE: the DevExtreme DataGrid with Editing mode="row" (allowAdding/Updating/Deleting,
 * useIcons) is rebuilt as a Mantine Table editing one row at a time — pencil/trash on each row,
 * check/X to commit or abandon, "Add row" for the insert editor. An inserted row and an edited one
 * still funnel into the SAME onSet call, exactly as onRowInserting/onRowUpdating both did: the
 * endpoints upsert on the key.
 */
function TierGrid({
  title,
  subtitle,
  rows,
  keyField,
  columns,
  disabled,
  readOnly,
  onSet,
  onDelete,
}: {
  title: string
  subtitle: string
  rows: object[]
  keyField: string
  columns: { field: string; caption: string; type?: 'text' | 'number' }[]
  disabled: boolean
  /**
   * No write trust at all — distinct from `disabled`, which is the transient mid-save state.
   * A greyed-out Delete comes back; this one never does, so it is removed rather than dimmed.
   */
  readOnly: boolean
  onSet: (row: Record<string, unknown>) => Promise<boolean>
  onDelete: (row: Record<string, unknown>) => Promise<boolean>
}) {
  /** The key of the stored row whose editor is open, or null. */
  const [editKey, setEditKey] = useState<string | null>(null)
  /** Whether the blank insert row is open. */
  const [adding, setAdding] = useState(false)
  /** The open editor's cells — '' is an empty editor, never a value to send. */
  const [cells, setCells] = useState<Record<string, string | number>>({})

  const editing = adding || editKey != null

  function startAdd() {
    const blank: Record<string, string | number> = {}
    for (const c of columns) blank[c.field] = ''
    setEditKey(null)
    setCells(blank)
    setAdding(true)
  }

  function startEdit(row: Record<string, unknown>) {
    const seed: Record<string, string | number> = {}
    for (const c of columns) seed[c.field] = row[c.field] as string | number
    setAdding(false)
    setCells(seed)
    setEditKey(String(row[keyField]))
  }

  function cancelEdit() {
    setAdding(false)
    setEditKey(null)
    setCells({})
  }

  /** A blank cell has nothing to upsert — the commit waits until every editor holds a value. */
  const incomplete = columns.some((c) => cells[c.field] === '' || cells[c.field] == null)

  async function commit() {
    if (incomplete) return
    // The row IS the write: the endpoints upsert on the key, so an inserted row and an edited
    // one are the same call, and the grid never has to know which it was.
    if (await onSet({ ...cells })) cancelEdit()
  }

  function editorRow(rowKey: string) {
    return (
      <Table.Tr key={rowKey}>
        {columns.map((c) => (
          <Table.Td key={c.field}>
            {c.type === 'text' ? (
              <TextInput
                size="xs"
                value={String(cells[c.field] ?? '')}
                aria-label={c.caption}
                disabled={disabled}
                onChange={(e) => {
                  const value = e.currentTarget.value
                  setCells((prev) => ({ ...prev, [c.field]: value }))
                }}
              />
            ) : (
              <NumberInput
                size="xs"
                value={cells[c.field]}
                min={0}
                aria-label={c.caption}
                disabled={disabled}
                onChange={(v) =>
                  setCells((prev) => ({ ...prev, [c.field]: typeof v === 'number' ? v : '' }))
                }
              />
            )}
          </Table.Td>
        ))}
        <Table.Td>
          <div className="grid-actions">
            <ActionIcon
              variant="subtle"
              title="Save"
              aria-label="Save"
              disabled={disabled || incomplete}
              onClick={() => void commit()}
            >
              <IconCheck size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              title="Cancel"
              aria-label="Cancel"
              disabled={disabled}
              onClick={cancelEdit}
            >
              <IconX size={16} />
            </ActionIcon>
          </div>
        </Table.Td>
      </Table.Tr>
    )
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="card-title">{title}</div>
        {!readOnly && (
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconPlus size={14} />}
            disabled={disabled || editing}
            onClick={startAdd}
          >
            Add row
          </Button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {subtitle}
      </p>
      <Table withTableBorder verticalSpacing="xs" fz="sm">
        <Table.Thead>
          <Table.Tr>
            {columns.map((c) => (
              <Table.Th key={c.field}>{c.caption}</Table.Th>
            ))}
            <Table.Th style={{ width: 90 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {adding && editorRow('__new__')}
          {rows.map((row) => {
            const r = row as Record<string, unknown>
            const key = String(r[keyField])
            if (editKey === key) return editorRow(key)
            return (
              <Table.Tr key={key}>
                {columns.map((c) => (
                  <Table.Td key={c.field}>{String(r[c.field] ?? '')}</Table.Td>
                ))}
                <Table.Td>
                  {!readOnly && (
                    <div className="grid-actions">
                      <ActionIcon
                        variant="subtle"
                        title="Edit"
                        aria-label="Edit"
                        disabled={disabled || editing}
                        onClick={() => startEdit(r)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        title="Delete"
                        aria-label="Delete"
                        disabled={disabled || editing}
                        onClick={() => {
                          // The DX grid confirmed deletion itself; window.confirm keeps that gate,
                          // with DevExtreme's own default wording.
                          if (window.confirm('Are you sure you want to delete this record?')) {
                            void onDelete(r)
                          }
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </div>
                  )}
                </Table.Td>
              </Table.Tr>
            )
          })}
          {rows.length === 0 && !adding && (
            <Table.Tr>
              <Table.Td colSpan={columns.length + 1}>
                <div className="hint" style={{ margin: 0 }}>
                  No data
                </div>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </div>
  )
}
