import { MAX_PHOTO_BYTES, prepareChatPhoto, sendPhoto } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', maxBodyBytes: MAX_PHOTO_BYTES + 65_536, prepare: prepareChatPhoto }, async ({ tx, user, params, prepared, afterCommit, onFailure }) =>
  Response.json(await sendPhoto(tx, user!.id, params.id!, prepared, afterCommit, onFailure), { status: 201 }),
)
