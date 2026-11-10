import { photoUrl } from '@kando/domain'

// The Android app file under the site's own address: https://skillweb.space/KANDO.apk. The file is `app/KANDO.apk` in the public media bucket
// (uploaded by the owner's team after each Android build) and is streamed through, so the visitor never sees where it is stored.
const KEY = 'app/KANDO.apk'

export const dynamic = 'force-dynamic'

export async function GET() {
  let upstream: Response | undefined
  try {
    upstream = await fetch(photoUrl(KEY))
  } catch {
    // storage not configured or not reachable: answered below
  }
  if (!upstream?.ok || !upstream.body) return new Response('Not available right now', { status: 404 })
  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="KANDO.apk"',
    'Cache-Control': 'public, max-age=300',
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['Content-Length'] = length
  return new Response(upstream.body, { headers })
}
