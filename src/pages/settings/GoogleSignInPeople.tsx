import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Pagination, Select, Switch, Table, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconSearch } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { accessService } from '../../services/accessService'
import { dateTime } from '../workflow/workflowFormat'
import { SettingsCard } from './SettingsCard'
import { ServerText } from './GoogleSignInDialogs'
import type { GatePerson, GatePersonStatus } from '../../types/access'

const STATUSES: GatePersonStatus[] = ['Allowed', 'Blocked', 'NoEmail', 'NoUser', 'UserDisabled', 'Left']

const PAGE_SIZE = 25

/** Green for in, red for switched off, grey for the states only another page can change. */
function badgeClass(status: GatePersonStatus): string {
  if (status === 'Allowed') return 'badge badge--on'
  if (status === 'Blocked') return 'badge badge--off'
  return 'badge badge--muted'
}

/**
 * WHO CAN OPEN THE HRMS — every employee, and what the gate makes of them.
 *
 * The Allowed switch is the one thing changed here, and only for someone who would otherwise pass:
 * a missing Gmail, a missing or disabled login, or a leaving date are facts about the employee and
 * are fixed where they live (the employee record, Employee accounts, Users). So the switch is live
 * only for Allowed and Blocked.
 *
 * It saves on change. The new position shows at once and the switch is held while the write is in
 * flight; a refusal ("You can't block yourself …") puts it back and says why.
 */
export function GoogleSignInPeople({
  people,
  onChanged,
}: {
  people: GatePerson[]
  /** Reload the tab — a block changes the status, and the summary line with it. */
  onChanged: () => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [page, setPage] = useState(1)
  /** The row being saved and the position it is moving to. */
  const [pending, setPending] = useState<{ employeeId: number; allowed: boolean } | null>(null)

  const allowedCount = people.filter((p) => p.status === 'Allowed').length

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return people.filter((p) => {
      if (status !== 'all' && p.status !== status) return false
      if (!needle) return true
      return [p.fullName, p.email, p.branchName, p.username].some((v) =>
        (v ?? '').toLowerCase().includes(needle),
      )
    })
  }, [people, search, status])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  async function setAllowed(person: GatePerson, allowed: boolean) {
    if (pending) return
    setPending({ employeeId: person.employeeId, allowed })
    try {
      await accessService.setBlocked(person.employeeId, !allowed)
      notifications.show({
        message: allowed
          ? t('googleGate.people.unblocked', { name: person.fullName })
          : t('googleGate.people.blocked', { name: person.fullName }),
        color: 'green',
        autoClose: 2500,
      })
      await onChanged()
    } catch (err) {
      notifications.show({ message: <ServerText text={getErrorMessage(err)} />, color: 'red', autoClose: 6000 })
    } finally {
      setPending(null)
    }
  }

  return (
    <SettingsCard
      title={t('googleGate.people.title')}
      description={t('googleGate.people.description')}
    >
      <p className="gate-summary">
        {t('googleGate.people.summary', { allowed: allowedCount, total: people.length })}
      </p>

      <Group gap="xs" mb="xs" wrap="wrap">
        <TextInput
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value)
            setPage(1)
          }}
          placeholder={t('googleGate.people.search')}
          aria-label={t('googleGate.people.search')}
          leftSection={<IconSearch size={14} />}
          w={260}
          maw="100%"
          size="xs"
        />
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v ?? 'all')
            setPage(1)
          }}
          data={[
            { value: 'all', label: t('googleGate.people.allStatuses') },
            ...STATUSES.map((s) => ({ value: s, label: t(`googleGate.people.status.${s}`) })),
          ]}
          aria-label={t('googleGate.people.statusFilter')}
          allowDeselect={false}
          w={180}
          size="xs"
        />
      </Group>

      <Table.ScrollContainer minWidth={640}>
        <Table striped withTableBorder verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('googleGate.people.cols.name')}</Table.Th>
              <Table.Th>{t('googleGate.people.cols.email')}</Table.Th>
              <Table.Th>{t('googleGate.people.cols.status')}</Table.Th>
              <Table.Th>{t('googleGate.people.cols.lastSignIn')}</Table.Th>
              <Table.Th style={{ width: 90 }}>{t('googleGate.people.cols.allowed')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <div className="empty-hint" style={{ padding: 16 }}>
                    {t('googleGate.people.empty')}
                  </div>
                </Table.Td>
              </Table.Tr>
            ) : (
              shown.map((person) => {
                const switchable = person.status === 'Allowed' || person.status === 'Blocked'
                const allowed =
                  pending && pending.employeeId === person.employeeId
                    ? pending.allowed
                    : person.status === 'Allowed'
                return (
                  <Table.Tr key={person.employeeId}>
                    <Table.Td>
                      <div className="gate-person">{person.fullName}</div>
                      {person.branchName && <div className="gate-sub">{person.branchName}</div>}
                    </Table.Td>
                    <Table.Td>
                      {person.email ? <bdi className="gate-email">{person.email}</bdi> : t('common.dash')}
                    </Table.Td>
                    <Table.Td>
                      <span className={badgeClass(person.status)}>
                        {t(`googleGate.people.status.${person.status}`)}
                      </span>
                    </Table.Td>
                    <Table.Td>
                      {person.lastSignInAt ? dateTime(person.lastSignInAt) : t('googleGate.people.never')}
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={allowed}
                        disabled={!switchable || pending != null}
                        onChange={(e) => void setAllowed(person, e.currentTarget.checked)}
                        aria-label={t('googleGate.people.allowAria', { name: person.fullName })}
                      />
                    </Table.Td>
                  </Table.Tr>
                )
              })
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {pageCount > 1 && (
        <Group justify="flex-end" mt="xs">
          <Pagination value={current} onChange={setPage} total={pageCount} size="sm" />
        </Group>
      )}
    </SettingsCard>
  )
}
