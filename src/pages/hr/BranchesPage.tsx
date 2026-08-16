import { LookupGridPage } from '../../components/LookupGridPage'
import { PERMISSION } from '../../auth/routeAccess'
import { branchesService } from '../../services/hrService'

export default function BranchesPage() {
  return (
    <LookupGridPage
      title="Branches"
      subtitle="Physical locations employees belong to."
      managePermission={PERMISSION.ORG_MANAGE}
      keyField="branchId"
      textField="name"
      textLabel="Name"
      load={branchesService.getAll}
      create={branchesService.create}
      update={branchesService.update}
    />
  )
}
