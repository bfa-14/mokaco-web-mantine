import { LookupGridPage } from '../../components/LookupGridPage'
import { PERMISSION } from '../../auth/routeAccess'
import { departmentsService } from '../../services/hrService'

export default function DepartmentsPage() {
  return (
    <LookupGridPage
      title="Departments"
      subtitle="Organisational groupings for employees."
      managePermission={PERMISSION.ORG_MANAGE}
      keyField="departmentId"
      textField="name"
      textLabel="Name"
      load={departmentsService.getAll}
      create={departmentsService.create}
      update={departmentsService.update}
    />
  )
}
