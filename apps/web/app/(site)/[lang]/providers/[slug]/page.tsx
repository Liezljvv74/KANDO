import { profileMetadata, renderProfile, type Args } from './profile'

// Cached; a profile, service, photo or review change refreshes it at once (public-cache.ts).
export const revalidate = 300
export async function generateStaticParams() {
  return []
}

export const generateMetadata = (args: Args) => profileMetadata(args, false)

export default function ProviderPage(args: Args) {
  return renderProfile(args, false)
}
