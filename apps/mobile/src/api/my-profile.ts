import type { Document, MyProfile, OwnReference, OwnService, Photo } from '@kando/contract'

import { api, ApiError, upload, type PickedFile } from '@/api/client'

const json = (method: string, body?: unknown) => ({ method, body })

/** null when the user has no profile yet (the server answers 200 null; an older 404 counts the same). */
export async function getMyProfile(): Promise<MyProfile | null> {
  try {
    return await api<MyProfile | null>('/app-api/v1/provider-profile')
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}
/** Creates the draft profile when there is none (the server answers with the existing one otherwise). */
export const ensureDraft = () => api<MyProfile>('/app-api/v1/provider-profile', json('POST', {}))
export const saveMyProfile = (body: object) => api<MyProfile>('/app-api/v1/provider-profile', json('PUT', body))
export const publishProfile = () => api<MyProfile>('/app-api/v1/provider-profile/publish', json('POST'))
export const unpublishProfile = () => api<MyProfile>('/app-api/v1/provider-profile/unpublish', json('POST'))

/** Services and references share the same four calls. */
function items<T>(base: string) {
  return {
    list: async () => (await api<{ docs: T[] }>(base)).docs,
    create: (body: object) => api<T>(base, json('POST', body)),
    update: (id: string, body: object) => api<T>(`${base}/${id}`, json('PATCH', body)),
    remove: (id: string) => api<unknown>(`${base}/${id}`, json('DELETE')),
  }
}
export const servicesApi = items<OwnService>('/app-api/v1/services')
export const referencesApi = items<OwnReference>('/app-api/v1/references')

export const photosApi = {
  list: async () => (await api<{ docs: Photo[] }>('/app-api/v1/photos')).docs,
  // No description: the public profile describes photos by the current public name, so a rename never leaves old ones.
  add: (file: PickedFile, kind: Photo['kind']) => upload<Photo>('/app-api/v1/photos', file, { kind }),
  remove: (id: string) => api<unknown>(`/app-api/v1/photos/${id}`, json('DELETE')),
}

export const documentsApi = {
  list: async () => (await api<{ docs: Document[] }>('/app-api/v1/verifications')).docs,
  async submit(file: PickedFile, requirement: string) {
    const { id } = await upload<{ id: string }>('/app-api/v1/files', file, {})
    try {
      return await api<Document>('/app-api/v1/verifications', json('POST', { requirement, document: id }))
    } catch (e) {
      // No check was created, so the uploaded document would sit in storage unseen; the server keeps it if a check
      // does use it (the reply was lost). A failed clean-up must not hide the real error.
      await api(`/app-api/v1/files/${id}`, { method: 'DELETE' }).catch(() => {})
      throw e
    }
  },
}

export const removeDocument = (id: string) => api<unknown>(`/app-api/v1/verifications/${id}`, json('DELETE'))

export const notificationsApi = {
  mark: (id: string, body: { seen?: true; dismissed?: true }) => api<unknown>(`/app-api/v1/notifications/${id}`, json('PATCH', body)),
}
