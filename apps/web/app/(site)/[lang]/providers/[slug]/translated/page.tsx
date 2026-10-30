import { profileMetadata, renderProfile, type Args } from '../profile'

// /providers/x?translate=1 (the proxy rewrites it here): the stored translation, per request and never indexed.
export const dynamic = 'force-dynamic'

export const generateMetadata = (args: Args) => profileMetadata(args, true)

export default function TranslatedProviderPage(args: Args) {
  return renderProfile(args, true)
}
