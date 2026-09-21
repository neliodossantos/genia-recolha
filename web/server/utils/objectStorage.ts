import { AwsClient } from 'aws4fetch'

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  delete(keys: string[]): Promise<void>
}

export interface R2S3Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export interface R2BucketBinding {
  put(key: string, body: Uint8Array, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
}

function objectUrl(config: R2S3Config, key: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${path}`
}

// R2 over its S3-compatible API, for hosts without a Cloudflare binding (e.g. Vercel).
export function createS3Storage(config: R2S3Config, fetchFn: typeof fetch = fetch): ObjectStorage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })

  return {
    async put(key, body, contentType) {
      const request = await client.sign(objectUrl(config, key), {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: body as Uint8Array<ArrayBuffer>,
      })
      const response = await fetchFn(request)
      if (!response.ok) throw new Error(`R2 PUT failed with status ${response.status}`)
    },

    async delete(keys) {
      for (const key of keys) {
        const request = await client.sign(objectUrl(config, key), { method: 'DELETE' })
        const response = await fetchFn(request)
        if (!response.ok && response.status !== 404) {
          throw new Error(`R2 DELETE failed with status ${response.status}`)
        }
      }
    },
  }
}

// R2 through a Cloudflare binding (Cloudflare Pages/Workers and the local dev emulator).
export function createBindingStorage(bucket: R2BucketBinding): ObjectStorage {
  return {
    async put(key, body, contentType) {
      await bucket.put(key, body, { httpMetadata: { contentType } })
    },
    async delete(keys) {
      await bucket.delete(keys)
    },
  }
}

export function selectObjectStorage(
  config: R2S3Config,
  binding: R2BucketBinding | null,
): ObjectStorage | null {
  if (config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket) {
    return createS3Storage(config)
  }
  return binding ? createBindingStorage(binding) : null
}
