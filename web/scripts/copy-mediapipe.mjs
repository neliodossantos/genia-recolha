import { cpSync, mkdirSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
const to = 'public/mediapipe/wasm'
mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
console.log(`MediaPipe wasm copied to ${to}`)
