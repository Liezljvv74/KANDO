import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner'

export interface Storage {
  put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>
  getSignedUrl(bucket: string, key: string, seconds: number): Promise<string>
  delete(bucket: string, key: string): Promise<void>
  /** Public URL of an object in the media bucket. */
  publicUrl(key: string): string
}

export const mediaBucket = () => process.env.MEDIA_BUCKET ?? 'media'
export const documentsBucket = () => process.env.DOCUMENTS_BUCKET ?? 'documents'

/** Neon Object Storage (S3 API, path-style addressing). */
function s3Storage(): Storage {
  const endpoint = process.env.AWS_ENDPOINT
  const client = new S3Client({
    endpoint,
    region: process.env.AWS_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '' },
  })
  return {
    async put(Bucket, Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }))
    },
    getSignedUrl: (Bucket, Key, expiresIn) => presign(client, new GetObjectCommand({ Bucket, Key }), { expiresIn }),
    async delete(Bucket, Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }))
    },
    publicUrl: (key) => `${endpoint?.replace(/\/$/, '')}/${mediaBucket()}/${key}`,
  }
}

let current: Storage | undefined
/** The S3 implementation, created on first use (importing this module needs no env). */
export const storage = (): Storage => (current ??= s3Storage())
export const setStorageForTests = (impl: Storage | undefined) => {
  current = impl
}

export const photoUrl = (key: string): string => storage().publicUrl(key)
