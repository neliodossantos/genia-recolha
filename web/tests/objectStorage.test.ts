import { describe, expect, it, vi } from 'vitest'
import {
  createBindingStorage,
  createS3Storage,
  selectObjectStorage,
  type R2BucketBinding,
  type R2S3Config,
} from '../server/utils/objectStorage'

const s3Config: R2S3Config = {
  accountId: 'acc123',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret',
  bucket: 'lga-recordings',
}

function fakeFetch(status = 200) {
  return vi.fn(async (_request: Request) => new Response(null, { status }))
}

describe('createS3Storage', () => {
  it('PUTs a signed request to the bucket URL with the content type and body', async () => {
    const fetchFn = fakeFetch(200)
    const storage = createS3Storage(s3Config, fetchFn as unknown as typeof fetch)

    await storage.put('user-1/rec-1.webm', new Uint8Array([1, 2, 3]), 'video/webm')

    const request = fetchFn.mock.calls[0][0]
    expect(request.method).toBe('PUT')
    expect(request.url).toBe('https://acc123.r2.cloudflarestorage.com/lga-recordings/user-1/rec-1.webm')
    expect(request.headers.get('content-type')).toBe('video/webm')
    expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('throws when R2 rejects the upload', async () => {
    const storage = createS3Storage(s3Config, fakeFetch(403) as unknown as typeof fetch)
    await expect(storage.put('a/b.json', new Uint8Array(1), 'application/json')).rejects.toThrow('403')
  })

  it('DELETEs every key and tolerates keys that are already gone', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const storage = createS3Storage(s3Config, fetchFn as unknown as typeof fetch)

    await storage.delete(['u/1.webm', 'u/1.json'])

    const methods = fetchFn.mock.calls.map((call) => (call[0] as Request).method)
    const urls = fetchFn.mock.calls.map((call) => (call[0] as Request).url)
    expect(methods).toEqual(['DELETE', 'DELETE'])
    expect(urls).toEqual([
      'https://acc123.r2.cloudflarestorage.com/lga-recordings/u/1.webm',
      'https://acc123.r2.cloudflarestorage.com/lga-recordings/u/1.json',
    ])
  })

  it('throws when a delete fails for a reason other than "not found"', async () => {
    const storage = createS3Storage(s3Config, fakeFetch(500) as unknown as typeof fetch)
    await expect(storage.delete(['u/1.webm'])).rejects.toThrow('500')
  })
})

describe('createBindingStorage', () => {
  it('writes with the content type and deletes by keys', async () => {
    const bucket: R2BucketBinding = {
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    }
    const storage = createBindingStorage(bucket)
    const body = new Uint8Array([9])

    await storage.put('k', body, 'video/mp4')
    await storage.delete(['k', 'j'])

    expect(bucket.put).toHaveBeenCalledWith('k', body, { httpMetadata: { contentType: 'video/mp4' } })
    expect(bucket.delete).toHaveBeenCalledWith(['k', 'j'])
  })
})

describe('selectObjectStorage', () => {
  const binding: R2BucketBinding = { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) }

  it('uses the S3 API (not the binding) when the credentials are complete', async () => {
    const globalFetch = vi.fn(async (_request: Request) => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const bindingPut = vi.fn(async () => {})
    try {
      const storage = selectObjectStorage(s3Config, { put: bindingPut, delete: vi.fn(async () => {}) })
      await storage!.put('k', new Uint8Array(1), 'video/webm')
      expect(globalFetch).toHaveBeenCalledTimes(1)
      expect(bindingPut).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to the binding when the credentials are incomplete', async () => {
    const storage = selectObjectStorage({ ...s3Config, secretAccessKey: '' }, binding)
    await storage!.put('k', new Uint8Array(1), 'video/webm')
    expect(binding.put).toHaveBeenCalled()
  })

  it('returns null when neither S3 credentials nor a binding exist', () => {
    expect(selectObjectStorage({ accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }, null)).toBeNull()
  })
})
