import { signedInOnly } from '@/components/signed-in-only'
import JobsScreen from '@/screens/jobs/jobs-screen'

export default signedInOnly(JobsScreen, 'tab.jobs')
