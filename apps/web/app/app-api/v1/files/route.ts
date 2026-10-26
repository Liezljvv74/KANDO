import { MAX_DOCUMENT_BYTES, preparePdf, uploadFile } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const POST = appRequest(
  { auth: 'required', maxBodyBytes: MAX_DOCUMENT_BYTES + 65_536, prepare: preparePdf },
  async ({ tx, user, prepared }) => Response.json(await uploadFile(tx, user!.id, prepared), { status: 201 }),
)
