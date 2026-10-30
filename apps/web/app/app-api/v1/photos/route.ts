import { PhotoSchema, PhotosListSchema } from '@kando/contract'
import { addPhoto, listPhotos, MAX_PHOTO_BYTES, preparePhoto } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'
import { refreshPublicPages } from '../../../../lib/public-cache'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user }) =>
  Response.json(PhotosListSchema.parse({ docs: await listPhotos(tx, user!.id) })),
)

// Room for the multipart framing on top of the photo itself.
export const POST = appRequest(
  { auth: 'required', maxBodyBytes: MAX_PHOTO_BYTES + 65_536, prepare: preparePhoto },
  async ({ tx, user, prepared, afterCommit }) => {
    const created = await addPhoto(tx, user!.id, prepared, afterCommit)
    PhotoSchema.parse(created) // the answer also carries width and height
    refreshPublicPages('providers')
    return Response.json(created, { status: 201 })
  },
)
