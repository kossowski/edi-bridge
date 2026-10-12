import { pageMetadata } from '@/components/page-metadata'
import { TasksScreen } from '@/components/tasks/tasks-screen'

export const generateMetadata = pageMetadata('tasks')

export default function Page() {
  return <TasksScreen />
}
