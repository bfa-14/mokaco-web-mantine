import { useCallback, useEffect, useState } from 'react'
import {
  ActionIcon,
  Button,
  Checkbox,
  Loader,
  NumberInput,
  Table,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { PageHelp } from '../../components/PageHelp'
import { getErrorMessage } from '../../api/errorMessage'
import { leavePolicyService, leaveTypesService } from '../../services/hrService'
import type { LeavePolicy, LeaveType } from '../../types/hr'

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
  isDiscretionary: boolean
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
    isDiscretionary: t.isDiscretionary,
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
  isDiscretionary: false,
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
  const [error, setError] = useState<string | null>(null)

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
      notify('Give the leave type a name.', 'error', 3000)
      return
    }
    const payload = {
      name: form.name.trim(),
      isPaid: form.isPaid,
      carryOver: form.carryOver,
      requiresCertificate: form.requiresCertificate,
      minServiceMonthsToUse: form.minServiceMonthsToUse,
      noticePreferredDays: form.noticePreferredDays,
      fixedEntitlementDays: form.fixedEntitlementDays,
      // Null here means "no fixed entitlement", NOT "leave alone" — say so explicitly, or the
      // preserve rule on the server would keep the old figure forever.
      clearFixedEntitlement: form.fixedEntitlementDays == null,
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
      notify(getErrorMessage(err), 'error', 6000)
    } finally {
      setSaving(false)
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
  const typeId = form?.leaveTypeId ?? null
  const accrual = policy?.accrualTiers.filter((t) => t.leaveTypeId === typeId) ?? []
  const pay = policy?.payTiers.filter((t) => t.leaveTypeId === typeId) ?? []
  const relations = policy?.relations.filter((r) => r.leaveTypeId === typeId) ?? []

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Leave policy</h1>
          <p className="page-subtitle">What each kind of leave entitles, and to whom.</p>
        </div>
        <div className="page-head-actions">
          <Button
            variant="default"
            disabled={saving}
            onClick={() => {
              // A new type belongs to no list row, so the selection moves to null and the draft
              // carries the blank form — the same tag rule, with null as the tag.
              setSelectedId(null)
              setDraft({ ...BLANK })
            }}
          >
            + New leave type
          </Button>
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
                disabled={saving}
                onClick={() => {
                  // Drop any unsaved draft when another type is chosen — the panel then derives
                  // itself from the stored row.
                  setDraft(null)
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
                  disabled={saving}
                  onChange={(e) => patch({ name: e.currentTarget.value })}
                />
              </div>

              <div className="wf-policy-flags">
                <Checkbox
                  label="Paid"
                  checked={form.isPaid}
                  disabled={saving}
                  onChange={(e) => patch({ isPaid: e.currentTarget.checked })}
                />
                <Checkbox
                  label="Carries over"
                  checked={form.carryOver}
                  disabled={saving}
                  onChange={(e) => patch({ carryOver: e.currentTarget.checked })}
                />
                <Checkbox
                  label="Requires certificate"
                  checked={form.requiresCertificate}
                  disabled={saving}
                  onChange={(e) => patch({ requiresCertificate: e.currentTarget.checked })}
                />
                <Checkbox
                  label="Discretionary"
                  checked={form.isDiscretionary}
                  disabled={saving}
                  onChange={(e) => patch({ isDiscretionary: e.currentTarget.checked })}
                />
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
                    disabled={saving}
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
                    disabled={saving}
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
                    value={form.fixedEntitlementDays ?? ''}
                    min={0}
                    step={1}
                    placeholder="None"
                    disabled={saving}
                    onChange={(v) =>
                      patch({ fixedEntitlementDays: typeof v === 'number' ? v : null })
                    }
                  />
                  <div className="hint">A whole entitlement, e.g. maternity. Blank for none.</div>
                </div>
              </div>

              <div className="form-actions">
                <Button disabled={saving} onClick={() => void saveType()}>
                  {saving ? 'Saving…' : form.leaveTypeId ? 'Save changes' : 'Create leave type'}
                </Button>
              </div>
            </div>

            {/* The grids need an id to write against, so a type being created shows none until saved. */}
            {form.leaveTypeId == null ? (
              <p className="hint">Save the type first, then its tiers can be set.</p>
            ) : (
              <>
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
                  disabled={saving}
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
                    disabled={saving}
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
                    disabled={saving}
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
    </div>
  )
}

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
  onSet,
  onDelete,
}: {
  title: string
  subtitle: string
  rows: object[]
  keyField: string
  columns: { field: string; caption: string; type?: 'text' | 'number' }[]
  disabled: boolean
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
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          disabled={disabled || editing}
          onClick={startAdd}
        >
          Add row
        </Button>
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
