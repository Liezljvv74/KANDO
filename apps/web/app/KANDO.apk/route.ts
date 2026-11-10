// The Android app file under the site's own address: https://skillweb.space/KANDO.apk. The file itself is the EAS build artifact, streamed
// through (the visitor never sees where it is stored). Set ANDROID_APK_URL in Vercel, or change the default below, when a newer build is the one to share.
const DEFAULT_APK_URL = ''

export const dynamic = 'force-dynamic'

export async function GET() {
  const source = process.env.ANDROID_APK_URL || DEFAULT_APK_URL
  if (!source) return new Response('Not available yet', { status: 404 })
  const upstream = await fetch(source)
  if (!upstream.ok || !upstream.body) return new Response('Not available right now', { status: 502 })
  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="KANDO.apk"',
    'Cache-Control': 'public, max-age=300',
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['Content-Length'] = length
  return new Response(upstream.body, { headers })
}
