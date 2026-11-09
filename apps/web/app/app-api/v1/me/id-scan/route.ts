import { IdScanSchema } from '@kando/contract'
import { MAX_PHOTO_BYTES, prepareChatPhoto, scanIdCard } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

// One photo of an ID card (field `file`); nothing is stored. Room for the multipart framing on top of the photo itself.
export const POST = appRequest({ auth: 'required', maxBodyBytes: MAX_PHOTO_BYTES + 65_536, prepare: (request) => prepareChatPhoto(request) }, async ({ user, prepared }) =>
  Response.json(IdScanSchema.parse(await scanIdCard(user!.id, prepared.data))),
)
