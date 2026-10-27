import { MAX_DOCUMENT_BYTES, prepareDocument, uploadFile } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const POST = appRequest(
  { auth: 'required', maxBodyBytes: MAX_DOCUMENT_BYTES + 65_536, prepare: prepareDocument },
  async ({ tx, user, prepared }) => Response.json(await uploadFile(tx, user!.id, prepared), { status: 201 }),
)
