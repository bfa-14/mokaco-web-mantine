import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Loader, Tabs } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconPencil } from '@tabler/icons-react'
import { employeesService } from '../../services/hrService'
import { getErrorMessage } from '../../api/errorMessage'
import { EmployeeFormPopup } from './EmployeeFormPopup'
import { SalaryComponentsTab } from './SalaryComponentsTab'
import { LeaveTab } from './LeaveTab'
import { DocumentsTab } from './DocumentsTab'
import type { EmployeeProfile } from '../../types/hr'
import { chevronBack } from '../../i18n/physical'

/**
 * The direction-aware "back" chevron. chevronBack() still speaks DevExtreme's icon vocabulary
 * ('chevronleft' / 'chevronright'), mapped here to the Tabler glyphs.
 */
function BackChevron() {
  return chevronBack() === 'chevronleft' ? (
    <IconChevronLeft size={16} />
  ) : (
    <IconChevronRight size={16} />
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="detail">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value || '—'}</span>
    </div>
  )
}

export default function EmployeeProfilePage() {
  const { id } = useParams()
  const employeeId = Number(id)
  const navigate = useNavigate()

  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editVisible, setEditVisible] = useState(false)

  async function reload() {
    setProfile(await employeesService.getProfile(employeeId))
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await employeesService.getProfile(employeeId)
        if (!cancelled) {
          setProfile(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [employeeId])

  if (loading) {
    return (
      <div className="page-loading">
        <Loader size={40} />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div>
        <Button
          variant="subtle"
          leftSection={<BackChevron />}
          onClick={() => navigate('/hr/employees')}
        >
          Back
        </Button>
        <div className="alert alert--error" role="alert" style={{ marginTop: 12 }}>
          {error ?? 'Employee not found.'}
        </div>
      </div>
    )
  }

  const terminated = Boolean(profile.terminationDate)

  return (
    <div>
      <Button
        variant="subtle"
        leftSection={<BackChevron />}
        onClick={() => navigate('/hr/employees')}
      >
        Back to employees
      </Button>

      <div className="profile-head">
        <div className="profile-avatar">
          {profile.fullName
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </div>
        <div className="profile-head-main">
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            {profile.fullName}
          </h1>
          <p className="profile-subline">
            {profile.positionTitle} · {profile.departmentName} · {profile.branchName}
          </p>
        </div>
        <div className="profile-head-side">
          <span className={terminated ? 'badge badge--off' : 'badge badge--on'}>
            {terminated ? 'Terminated' : 'Active'}
          </span>
          <Button leftSection={<IconPencil size={16} />} onClick={() => setEditVisible(true)}>
            Edit
          </Button>
        </div>
      </div>

      {/* PORT NOTE: DX TabPanel deferRendering → Mantine Tabs with keepMounted={false}, so a tab's
          content still mounts (and fetches) only when first shown; swipeEnabled has no equivalent. */}
      <Tabs defaultValue="overview" keepMounted={false} className="profile-tabs">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="salary">Salary Components</Tabs.Tab>
          <Tabs.Tab value="leave">Leave</Tabs.Tab>
          <Tabs.Tab value="documents">Documents</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview">
          <div className="card" style={{ marginTop: 16 }}>
            <div className="detail-grid">
              <Detail label="Employee ID" value={profile.employeeId} />
              <Detail label="National ID" value={profile.nationalId} />
              <Detail label="NSSF number" value={profile.nssfNumber} />
              <Detail label="Hire date" value={profile.hireDate?.slice(0, 10)} />
              <Detail
                label="Termination date"
                value={profile.terminationDate?.slice(0, 10)}
              />
              <Detail
                label="Linked login"
                value={profile.userId ? `User #${profile.userId}` : 'None'}
              />
            </div>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="salary">
          <div style={{ marginTop: 16 }}>
            <SalaryComponentsTab employeeId={employeeId} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="leave">
          <div style={{ marginTop: 16 }}>
            <LeaveTab employeeId={employeeId} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="documents">
          <div style={{ marginTop: 16 }}>
            <DocumentsTab employeeId={employeeId} />
          </div>
        </Tabs.Panel>
      </Tabs>

      <EmployeeFormPopup
        visible={editVisible}
        employee={profile}
        onClose={() => setEditVisible(false)}
        onSaved={() => void reload()}
      />
    </div>
  )
}
