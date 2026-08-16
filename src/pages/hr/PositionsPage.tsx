import { LookupGridPage } from '../../components/LookupGridPage'
import { PERMISSION } from '../../auth/routeAccess'
import { positionsService } from '../../services/hrService'

export default function PositionsPage() {
  return (
    <LookupGridPage
      title="Positions"
      subtitle="Job titles assigned to employees."
      managePermission={PERMISSION.ORG_MANAGE}
      keyField="positionId"
      textField="title"
      textLabel="Title"
      load={positionsService.getAll}
      create={positionsService.create}
      update={positionsService.update}
    />
  )
}
