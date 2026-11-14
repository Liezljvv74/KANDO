import { signedInOnly } from '@/components/signed-in-only'
import AccountScreen from '@/screens/account-screen'

export default signedInOnly(AccountScreen, 'tab.account', true)
