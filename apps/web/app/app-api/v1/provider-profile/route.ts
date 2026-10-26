import { parseBody, ProfileInputSchema } from '@kando/contract'
import { getMyProfile, upsertMyProfile } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json(await getMyProfile(tx, user!.id)),
)

export const PUT = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(ProfileInputSchema, request)
  const { profile, created } = await upsertMyProfile(tx, user!.id, input)
  return Response.json(profile, { status: created ? 201 : 200 })
})
