import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Loader } from '@mantine/core'
import { IconChevronDown, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { getErrorMessage } from '../../api/errorMessage'
import { employeesService } from '../../services/hrService'
import { PageHelp } from '../../components/PageHelp'
import { approvalTierLabel } from '../../types/hr'
import type { OrgTreeNode } from '../../types/hr'
import { chevronForward } from '../../i18n/physical'

/**
 * The direction-aware "forward" chevron. chevronForward() still speaks DevExtreme's icon
 * vocabulary ('chevronleft' / 'chevronright'), mapped here to the Tabler glyphs.
 */
function ForwardChevron() {
  return chevronForward() === 'chevronleft' ? (
    <IconChevronLeft size={16} />
  ) : (
    <IconChevronRight size={16} />
  )
}

/**
 * The org chart — every employee as an indented tree by reporting depth. READ-ONLY: reporting lines
 * are edited on the employee form (the "Reports to" field), which is where the loop guard and the
 * no-login warning live, so a row here just opens that person. The rows come back pre-sorted
 * depth-first from usp_Employee_GetOrgTree, so this only has to render them in order and indent by
 * Depth — no tree needs building.
 *
 * PORT NOTE: the source was already a hand-built nested list (no DX TreeList/diagram) — only the
 * Button/LoadIndicator and the dx-icon chevron were swapped; data flow and CSS classes are as-is.
 */
export default function OrgChartPage() {
  const navigate = useNavigate()

  const [nodes, setNodes] = useState<OrgTreeNode[]>([])
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const tree = await employeesService.getOrgTree()
        if (!cancelled) {
          setNodes(tree)
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
  }, [])

  /** Everyone who has at least one direct report — drives the collapse toggle and the split below. */
  const managers = useMemo(
    () =>
      new Set(
        nodes
          .map((n) => n.reportsToEmployeeId)
          .filter((id): id is number => id != null),
      ),
    [nodes],
  )

  /**
   * A depth-0 row means "no manager", which covers two very different people: the real top of the
   * company, and someone whose "Reports to" was simply never set. Having reports is what separates
   * them — the root manages a tree, the unset person hangs off nothing at all.
   */
  const unplaced = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.depth === 0 &&
          n.reportsToEmployeeId == null &&
          !managers.has(n.employeeId),
      ),
    [nodes, managers],
  )

  const placed = useMemo(() => {
    const unplacedIds = new Set(unplaced.map((n) => n.employeeId))
    return nodes.filter((n) => !unplacedIds.has(n.employeeId))
  }, [nodes, unplaced])

  /**
   * Depth-first order is what makes collapsing cheap: a collapsed node's subtree is exactly the run
   * of rows that follows it while the depth stays greater than its own, so hide that run and stop as
   * soon as the list climbs back out.
   */
  const visible = useMemo(() => {
    const out: OrgTreeNode[] = []
    let hideDeeperThan: number | null = null
    for (const n of placed) {
      if (hideDeeperThan !== null) {
        if (n.depth > hideDeeperThan) continue
        hideDeeperThan = null
      }
      out.push(n)
      if (collapsed.has(n.employeeId)) hideDeeperThan = n.depth
    }
    return out
  }, [placed, collapsed])

  function toggle(employeeId: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(employeeId)) next.add(employeeId)
      return next
    })
  }

  function collapseAll() {
    setCollapsed(new Set(placed.filter((n) => managers.has(n.employeeId)).map((n) => n.employeeId)))
  }

  /** One person. `indent` is separate from depth so the not-placed group can render flat. */
  function renderRow(n: OrgTreeNode, indent: number) {
    const expandable = managers.has(n.employeeId)
    const isCollapsed = collapsed.has(n.employeeId)
    const open = () => navigate(`/hr/employees/${n.employeeId}`)

    return (
      <div
        key={n.employeeId}
        className="wf-org-row"
        role="button"
        tabIndex={0}
        title={`Open ${n.fullName}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
        {/* One indent guide per depth level — the visual nesting. */}
        {Array.from({ length: indent }).map((_, i) => (
          <span key={i} className="wf-org-indent" aria-hidden="true" />
        ))}

        {expandable ? (
          <button
            type="button"
            className="wf-org-toggle"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Show who reports to ${n.fullName}`
                : `Hide who reports to ${n.fullName}`
            }
            // The row opens the employee; the chevron must not, or the tree is unusable.
            onClick={(e) => {
              e.stopPropagation()
              toggle(n.employeeId)
            }}
          >
            {/* PORT NOTE: the dx-icon chevrondown <i> → Tabler IconChevronDown, keeping the same
                wf-org-chevron classes so the collapse rotation CSS still applies. */}
            <IconChevronDown
              size={14}
              className={`wf-org-chevron${isCollapsed ? ' wf-org-chevron--closed' : ''}`}
              aria-hidden="true"
            />
          </button>
        ) : (
          /* Keeps leaf names aligned with the names of nodes that do have a chevron. */
          <span className="wf-org-toggle wf-org-toggle--leaf" aria-hidden="true" />
        )}

        <span className="wf-org-name">{n.fullName}</span>
        <span className="wf-org-branch">{n.branchName}</span>
        {n.approvalTier > 1 && (
          <span className="badge badge--muted">{approvalTierLabel(n.approvalTier)}</span>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Org chart</h1>
          <p className="page-subtitle">Who reports to whom, across the company.</p>
        </div>
        {placed.length > 0 && (
          <div className="page-head-actions">
            <Button
              variant="default"
              leftSection={
                collapsed.size > 0 ? <IconChevronDown size={16} /> : <ForwardChevron />
              }
              onClick={() => (collapsed.size > 0 ? setCollapsed(new Set()) : collapseAll())}
            >
              {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
            </Button>
          </div>
        )}
      </div>

      <PageHelp>
        Each person sits under their manager. A line-manager approval step climbs this tree from the
        requester. Click anyone to open their record; to change a reporting line, edit them and set
        their “Reports to”.
      </PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : nodes.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">No employees to chart yet.</div>
            Add employees and set who they report to, and the tree will build itself.
          </div>
        </div>
      ) : (
        <>
          {placed.length > 0 && (
            <div className="card">{visible.map((n) => renderRow(n, n.depth))}</div>
          )}

          {/* Nobody above them and nobody below them: their "Reports to" was never set. They are
              real employees, so they are listed rather than dropped — just held apart from the tree
              so the hierarchy above stays true. */}
          {unplaced.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2 className="card-title">Not placed in the hierarchy</h2>
              <p className="wf-org-note">
                {unplaced.length === 1 ? 'This person has' : 'These people have'} no “Reports to”
                set, so they do not appear in the tree above. Open{' '}
                {unplaced.length === 1 ? 'them' : 'each of them'} and set a manager on their
                employee form.
              </p>
              {unplaced.map((n) => renderRow(n, 0))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
