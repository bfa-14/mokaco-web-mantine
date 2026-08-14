import { LookupGridPage } from '../../components/LookupGridPage'
import { positionsService } from '../../services/hrService'

export default function PositionsPage() {
  return (
    <LookupGridPage
      title="Positions"
      subtitle="Job titles assigned to employees."
      keyField="positionId"
      textField="title"
      textLabel="Title"
      load={positionsService.getAll}
      create={positionsService.create}
      update={positionsService.update}
    />
  )
}
