import { LookupGridPage } from '../../components/LookupGridPage'
import { departmentsService } from '../../services/hrService'

export default function DepartmentsPage() {
  return (
    <LookupGridPage
      title="Departments"
      subtitle="Organisational groupings for employees."
      keyField="departmentId"
      textField="name"
      textLabel="Name"
      load={departmentsService.getAll}
      create={departmentsService.create}
      update={departmentsService.update}
    />
  )
}
