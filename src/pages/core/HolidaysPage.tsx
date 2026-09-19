import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionIcon, Badge, Button, Group, Loader, Select, Switch, Table, TextInput } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCalendar, IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react'
import { Modal } from '../../components/dialogs'
import { getErrorMessage } from '../../api/errorMessage'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { holidaysService } from '../../services/coreService'
import { branchesService } from '../../services/hrService'
import type { Holiday } from '../../types/core'
import type { Branch } from '../../types/hr'

/**
 * Core → Holidays (D1).
 *
 * A HOLIDAY IS NOT A LABEL ON A CALENDAR. Recording one changes what that day is for everybody it applies to:
 * attendance writes it as Holiday (paid, never Absent), a leave request does not spend a day on it, a roster copy
 * leaves it free, and whoever works it earns the payslip line "Holiday Work". So the API re-derives the attendance
 * days it touches when one is saved — and refuses one on a month that is already paid, in a sentence shown as it is.
 *
 * "Every branch" is a real choice, not an empty field: it is stored as no branch at all and applies to all of them,
 * including branches opened later. The branch filter therefore keeps the every-branch holidays in view — they are
 * holidays of that branch too.
 */

const ALL = 'all'

function dayLabel(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export default function HolidaysPage() {
  const { t, i18n } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.CORE_MANAGE)

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState<string>(String(thisYear))
  const [branchFilter, setBranchFilter] = useState<string>(ALL)
  const [search, setSearch] = useState('')

  const [rows, setRows] = useState<Holiday[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Holiday | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [date, setDate] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [branchId, setBranchId] = useState<string>(ALL)
  const [isPaid, setIsPaid] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [deleting, setDeleting] = useState<Holiday | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await holidaysService.getAll(Number(year) || null, branchFilter === ALL ? null : Number(branchFilter))
      setRows(data)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [year, branchFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    branchesService
      .getAll()
      .then((all) => {
        if (!cancelled) setBranches(all.filter((b) => b.isActive !== false))
      })
      .catch(() => {
        /* The filter and the form degrade to "every branch"; the list itself does not need the branches. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const branchOptions = useMemo(
    () => [{ value: ALL, label: t('holidays.everyBranch') }, ...branches.map((b) => ({ value: String(b.branchId), label: b.name }))],
    [branches, t],
  )
  const yearOptions = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(String), [thisYear])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const sorted = [...rows].sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
    if (!needle) return sorted
    return sorted.filter((h) =>
      [h.name, h.nameAr ?? '', h.branchName ?? t('holidays.everyBranch'), h.holidayDate.slice(0, 10)].some((v) => v.toLowerCase().includes(needle)),
    )
  }, [rows, search, t])

  function openCreate() {
    setEditing(null)
    setDate(null)
    setName('')
    setNameAr('')
    setBranchId(branchFilter)
    setIsPaid(true)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(row: Holiday) {
    setEditing(row)
    setDate(row.holidayDate.slice(0, 10))
    setName(row.name)
    setNameAr(row.nameAr ?? '')
    setBranchId(row.branchId == null ? ALL : String(row.branchId))
    setIsPaid(row.isPaid)
    setFormError(null)
    setFormOpen(true)
  }

  async function submit() {
    if (!date) {
      setFormError(t('holidays.errors.date'))
      return
    }
    if (!name.trim()) {
      setFormError(t('holidays.errors.name'))
      return
    }
    setFormError(null)
    setSaving(true)
    const input = { holidayDate: date.slice(0, 10), name: name.trim(), nameAr: nameAr.trim() || null, isPaid, branchId: branchId === ALL ? null : Number(branchId) }
    try {
      if (editing) await holidaysService.update(editing.holidayId, input)
      else await holidaysService.create(input)
      notifications.show({ message: t(editing ? 'holidays.saved' : 'holidays.created'), color: 'green', autoClose: 2500 })
      setFormOpen(false)
      await load()
    } catch (err) {
      // The API's own sentence ("A holiday is already recorded on that date…", "This period is paid — raise a payroll
      // adjustment instead.") is the explanation; it stays in the form, where the date that caused it is.
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await holidaysService.remove(deleting.holidayId)
      notifications.show({ message: t('holidays.deleted'), color: 'green', autoClose: 2500 })
      setDeleting(null)
      await load()
    } catch (err) {
      notifications.show({ message: getErrorMessage(err), color: 'red', autoClose: 6000 })
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('holidays.title')}</h1>
          <p className="page-subtitle">{t('holidays.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <ActionIcon variant="default" size="lg" title={t('common.refresh', 'Refresh')} aria-label={t('common.refresh', 'Refresh')} onClick={() => void load()}>
            <IconRefresh size={16} />
          </ActionIcon>
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('holidays.new')}
            </Button>
          )}
        </div>
      </div>

      {/* wraps on a phone: three controls never fit 390 px on one line */}
      <Group mb="sm" gap="xs" wrap="wrap" align="flex-end">
        <Select label={t('holidays.year')} data={yearOptions} value={year} onChange={(v) => v && setYear(v)} w={110} size="xs" allowDeselect={false} />
        <Select label={t('holidays.branch')} data={branchOptions} value={branchFilter} onChange={(v) => setBranchFilter(v ?? ALL)} w={220} size="xs" allowDeselect={false} />
        <TextInput
          label={t('holidays.search')}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          w={220}
          size="xs"
        />
      </Group>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped withTableBorder verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 190 }}>{t('holidays.cols.date')}</Table.Th>
                <Table.Th>{t('holidays.cols.name')}</Table.Th>
                <Table.Th>{t('holidays.cols.nameAr')}</Table.Th>
                <Table.Th>{t('holidays.cols.branch')}</Table.Th>
                <Table.Th style={{ width: 110 }}>{t('holidays.cols.paid')}</Table.Th>
                {canManage && <Table.Th style={{ width: 170 }}>{t('holidays.cols.actions')}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={canManage ? 6 : 5}>
                    <div className="empty-hint" style={{ padding: 16 }}>
                      {t('holidays.empty', { year })}
                    </div>
                  </Table.Td>
                </Table.Tr>
              ) : (
                visible.map((h) => (
                  <Table.Tr key={h.holidayId}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{dayLabel(h.holidayDate, i18n.language)}</Table.Td>
                    <Table.Td>{h.name}</Table.Td>
                    <Table.Td dir="rtl" style={{ textAlign: 'start' }}>
                      {h.nameAr ?? '—'}
                    </Table.Td>
                    <Table.Td>{h.branchName ?? <Badge variant="light" color="gray">{t('holidays.everyBranch')}</Badge>}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={h.isPaid ? 'teal' : 'orange'}>
                        {t(h.isPaid ? 'holidays.paid' : 'holidays.unpaid')}
                      </Badge>
                    </Table.Td>
                    {canManage && (
                      <Table.Td>
                        <div className="grid-actions">
                          <Button variant="subtle" size="compact-sm" leftSection={<IconPencil size={14} />} onClick={() => openEdit(h)}>
                            {t('holidays.edit')}
                          </Button>
                          <Button variant="subtle" color="red" size="compact-sm" leftSection={<IconTrash size={14} />} onClick={() => setDeleting(h)}>
                            {t('holidays.delete')}
                          </Button>
                        </div>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={formOpen} onClose={() => !saving && setFormOpen(false)} title={t(editing ? 'holidays.editTitle' : 'holidays.newTitle')} size={440} centered>
        <div className="form-stack" style={{ display: 'grid', gap: 12 }}>
          <DatePickerInput
            label={t('holidays.fields.date')}
            value={date}
            onChange={(v) => setDate(v as string | null)}
            leftSection={<IconCalendar size={16} />}
            valueFormat="DD/MM/YYYY"
            required
          />
          <TextInput label={t('holidays.fields.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={100} required />
          <TextInput label={t('holidays.fields.nameAr')} value={nameAr} onChange={(e) => setNameAr(e.currentTarget.value)} maxLength={100} dir="rtl" />
          <Select
            label={t('holidays.fields.branch')}
            description={t('holidays.fields.branchHint')}
            data={branchOptions}
            value={branchId}
            onChange={(v) => setBranchId(v ?? ALL)}
            allowDeselect={false}
          />
          <Switch label={t('holidays.fields.paid')} description={t('holidays.fields.paidHint')} checked={isPaid} onChange={(e) => setIsPaid(e.currentTarget.checked)} />
          <p className="hint" style={{ margin: 0 }}>
            {t('holidays.formNote')}
          </p>
          {formError && (
            <div className="alert alert--error" role="alert">
              {formError}
            </div>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setFormOpen(false)} disabled={saving}>
              {t('holidays.cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              {t('holidays.save')}
            </Button>
          </Group>
        </div>
      </Modal>

      {/* The confirmation names the row: "are you sure?" over a list says nothing about WHICH holiday goes. */}
      <Modal opened={deleting !== null} onClose={() => !deleteBusy && setDeleting(null)} title={t('holidays.deleteTitle')} size={420} centered>
        <p style={{ marginTop: 0 }}>
          {deleting &&
            t('holidays.deleteBody', {
              name: deleting.name,
              date: dayLabel(deleting.holidayDate, i18n.language),
              branch: deleting.branchName ?? t('holidays.everyBranch'),
            })}
        </p>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleting(null)} disabled={deleteBusy}>
            {t('holidays.cancel')}
          </Button>
          <Button color="red" onClick={() => void confirmDelete()} loading={deleteBusy}>
            {t('holidays.delete')}
          </Button>
        </Group>
      </Modal>
    </div>
  )
}
