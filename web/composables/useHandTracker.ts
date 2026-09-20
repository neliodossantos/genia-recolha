import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { RawHandResult } from '~/utils/landmarks'

export async function createHandTracker() {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task' },
    runningMode: 'VIDEO',
    numHands: 2,
  })

  return {
    detect(video: HTMLVideoElement, nowMs: number): RawHandResult {
      const result = landmarker.detectForVideo(video, nowMs)
      return { landmarks: result.landmarks, handedness: result.handedness }
    },
    close() {
      landmarker.close()
    },
  }
}
