import { LookupGridPage } from '../../components/LookupGridPage'
import { branchesService } from '../../services/hrService'

export default function BranchesPage() {
  return (
    <LookupGridPage
      title="Branches"
      subtitle="Physical locations employees belong to."
      keyField="branchId"
      textField="name"
      textLabel="Name"
      load={branchesService.getAll}
      create={branchesService.create}
      update={branchesService.update}
    />
  )
}
