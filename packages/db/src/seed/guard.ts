/** kando-dev's compute endpoint id; override with NEON_DEV_ENDPOINT_ID if the branch is recreated. */
const DEV_ENDPOINT = 'ep-steep-scene-b9p4f2v6'

type Env = Record<string, string | undefined>

export const isDevBranch = (branch: string | undefined) => branch === 'kando-dev' || branch === 'dev'

export const hostOf = (url?: string) => {
  try {
    return new URL(url ?? '').host
  } catch {
    return '(unset)'
  }
}

/** True only when NEON_BRANCH names the dev branch AND DATABASE_URL points at the dev endpoint (the branch name alone is a variable anyone can leave wrong). */
export function isDevTarget(env: Env): boolean {
  return isDevBranch(env.NEON_BRANCH) && hostOf(env.DATABASE_URL).includes(env.NEON_DEV_ENDPOINT_ID ?? DEV_ENDPOINT)
}

/** Refuses anywhere but the dev branch and database, no override. */
export function assertDevTarget(env: Env): void {
  if (!isDevTarget(env)) {
    throw new Error(`Dev branch only (NEON_BRANCH=kando-dev or dev and the dev database host); got branch ${env.NEON_BRANCH ?? 'unset'}, host ${hostOf(env.DATABASE_URL)}`)
  }
}
