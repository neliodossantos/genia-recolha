import { describe, expect, it } from 'vitest'
import { addFrame, createLandmarkBuffer, serializeBuffer } from '../utils/landmarks'

const point = { x: 0.1, y: 0.2, z: 0.3 }

describe('landmark buffer', () => {
  it('starts empty', () => {
    expect(createLandmarkBuffer(1000).frames).toEqual([])
  })

  it('stores timestamps relative to the start and the swapped handedness', () => {
    const buffer = createLandmarkBuffer(1000)
    addFrame(buffer, 1250.4, {
      landmarks: [[point]],
      handedness: [[{ categoryName: 'Left' }]],
    })
    expect(buffer.frames).toEqual([
      { t: 250, hands: [{ handedness: 'Right', points: [point] }] },
    ])
  })

  it('swaps MediaPipe handedness to the signer physical hand', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 10, {
      landmarks: [[point]],
      handedness: [[{ categoryName: 'Right' }]],
    })
    expect(buffer.frames[0].hands[0].handedness).toBe('Left')
  })

  it('records no hands when the result is null', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 100, null)
    expect(buffer.frames[0].hands).toEqual([])
  })

  it('uses null handedness when it is missing or unknown', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 100, { landmarks: [[point]] })
    addFrame(buffer, 200, {
      landmarks: [[point]],
      handedness: [[{ categoryName: 'Other' }]],
    })
    expect(buffer.frames[0].hands[0].handedness).toBeNull()
    expect(buffer.frames[1].hands[0].handedness).toBeNull()
  })

  it('serializes the frames as JSON', () => {
    const buffer = createLandmarkBuffer(0)
    addFrame(buffer, 50, { landmarks: [[point]] })
    expect(JSON.parse(serializeBuffer(buffer))).toEqual(buffer.frames)
  })
})
