import { photoUrl } from '@kando/domain'

// The Android app file under the site's own address: https://skillweb.space/KANDO.apk. It sends the visitor on to the file (a redirect, not a
// stream: a 97 MB download must not run through a function with a time limit). First choice: `app/KANDO.apk` in the public media bucket;
// until it is uploaded, the EAS build file below. Change the address (or set ANDROID_APK_URL in Vercel) when a newer build is the one to share.
const KEY = 'app/KANDO.apk'
const BUILD_FILE = 'https://expo.dev/artifacts/eas/WyV9G4lrF_5w7U5cZ-nuc0T2l4-5F69EMVxHr6T6XPE.apk' // EAS build 91eaac9c, kept by Expo until 24 November 2026

export const dynamic = 'force-dynamic'

export async function GET() {
  let target = process.env.ANDROID_APK_URL || BUILD_FILE
  try {
    const own = photoUrl(KEY)
    if ((await fetch(own, { method: 'HEAD' })).ok) target = own
  } catch {
    // storage not configured or not reachable: the build file is used
  }
  return Response.redirect(target, 307)
}
