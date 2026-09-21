<script setup lang="ts">
import { createHandTracker } from '~/composables/useHandTracker'
import { createRecorder, openCamera, type RecordedClip } from '~/composables/useRecorder'
import { averageLuma, handStatus, isTooDark, noHandsHint } from '~/utils/guidance'
import { addFrame, createLandmarkBuffer, serializeBuffer, type LandmarkBuffer } from '~/utils/landmarks'
import { uploadRecording } from '~/utils/uploadClient'
import { pickNextWord, type VocabWord } from '~/utils/words'

const COUNTDOWN_SECONDS = 3
const MAX_RECORDING_MS = 14_000
const TIPS_SEEN_KEY = 'lga.tips-seen'
const LUMA_INTERVAL_MS = 500

type Phase = 'intro' | 'loading' | 'ready' | 'countdown' | 'recording' | 'uploading' | 'retry' | 'fatal'

const { $supabase } = useNuxtApp()
const { session, signOut } = useAuth()

const phase = ref<Phase>('loading')
const fatalError = ref('')
const message = ref('')
const countdown = ref(COUNTDOWN_SECONDS)

const showTips = ref(false)
const handsCount = ref(0)
const noHandsMessage = ref<string | null>(null)
const tooDark = ref(false)

const words = ref<VocabWord[]>([])
const counts = ref<Record<number, number>>({})
const skipped = ref(new Set<number>())
const currentWord = ref<VocabWord | null>(null)

const videoEl = ref<HTMLVideoElement | null>(null)
const overlayEl = ref<HTMLCanvasElement | null>(null)

let stream: MediaStream | null = null
let tracker: Awaited<ReturnType<typeof createHandTracker>> | null = null
let recorder: ReturnType<typeof createRecorder> | null = null
let buffer: LandmarkBuffer | null = null
let frameHandle = 0
let lastDetectMs = 0
let noHandsSince: number | null = null
let lastLumaMs = 0
let lumaCanvas: HTMLCanvasElement | null = null
let stopTimer: ReturnType<typeof setTimeout> | null = null
let pending: { clip: RecordedClip; landmarksJson: string; wordId: number } | null = null

const totalDone = computed(() =>
  words.value.reduce((sum, w) => sum + Math.min(counts.value[w.id] ?? 0, TARGET_PER_WORD), 0),
)
const totalTarget = computed(() => words.value.length * TARGET_PER_WORD)
const wordCount = computed(() => (currentWord.value ? counts.value[currentWord.value.id] ?? 0 : 0))
const busy = computed(() => ['countdown', 'recording', 'uploading'].includes(phase.value))

function chooseWord() {
  currentWord.value = pickNextWord(words.value, counts.value, TARGET_PER_WORD, skipped.value)
}

function nextWord() {
  if (currentWord.value) skipped.value.add(currentWord.value.id)
  chooseWord()
}

async function logout() {
  await signOut()
  await navigateTo('/login')
}

function drawOverlay(landmarks: { x: number; y: number }[][]) {
  const canvas = overlayEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#22c55e'
  for (const hand of landmarks) {
    for (const p of hand) {
      ctx.beginPath()
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}

function updateGuidance(now: number, count: number) {
  handsCount.value = count
  if (count > 0) {
    noHandsSince = null
    noHandsMessage.value = null
    return
  }
  if (noHandsSince === null) noHandsSince = now
  noHandsMessage.value = noHandsHint(now - noHandsSince)
}

function checkBrightness(video: HTMLVideoElement, now: number) {
  if (now - lastLumaMs < LUMA_INTERVAL_MS) return
  lastLumaMs = now
  lumaCanvas ??= document.createElement('canvas')
  lumaCanvas.width = 32
  lumaCanvas.height = 24
  const ctx = lumaCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  ctx.drawImage(video, 0, 0, 32, 24)
  tooDark.value = isTooDark(averageLuma(ctx.getImageData(0, 0, 32, 24).data))
}

function detectionLoop() {
  try {
    const video = videoEl.value
    if (tracker && video && video.readyState >= 2) {
      const now = performance.now()
      // MediaPipe detectForVideo requires strictly increasing timestamps.
      if (now > lastDetectMs) {
        lastDetectMs = now
        const result = tracker.detect(video, now)
        drawOverlay(result.landmarks)
        updateGuidance(now, result.landmarks.length)
        checkBrightness(video, now)
        if (phase.value === 'recording' && buffer) addFrame(buffer, now, result)
      }
    }
  } catch {
    message.value = 'O detetor de mãos falhou. Recarrega a página.'
  }
  frameHandle = requestAnimationFrame(detectionLoop)
}

async function loadData() {
  const userId = session.value!.user.id
  const [vocab, progress] = await Promise.all([
    $supabase.from('vocabulary').select('id, word, position').eq('active', true).order('position'),
    $supabase.from('recording_counts').select('word_id, count').eq('user_id', userId),
  ])
  if (vocab.error) throw new Error(vocab.error.message)
  if (progress.error) throw new Error(progress.error.message)
  words.value = vocab.data as VocabWord[]
  counts.value = Object.fromEntries(progress.data.map((row) => [row.word_id, row.count]))
}

function readTipsSeen(): boolean {
  try {
    return localStorage.getItem(TIPS_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function markTipsSeen() {
  try {
    localStorage.setItem(TIPS_SEEN_KEY, '1')
  } catch {
    // private mode: the tips will simply show again next time
  }
}

function startFromIntro() {
  markTipsSeen()
  void start()
}

async function start() {
  phase.value = 'loading'
  try {
    await loadData()
    stream = await openCamera()
    const video = videoEl.value!
    video.srcObject = stream
    await video.play()
    overlayEl.value!.width = video.videoWidth
    overlayEl.value!.height = video.videoHeight
    tracker = await createHandTracker()
    recorder = createRecorder(stream)
    chooseWord()
    phase.value = 'ready'
    detectionLoop()
  } catch (error) {
    fatalError.value = error instanceof Error ? error.message : 'Erro ao iniciar a sessão.'
    phase.value = 'fatal'
  }
}

function beginCountdown() {
  message.value = ''
  phase.value = 'countdown'
  countdown.value = COUNTDOWN_SECONDS
  const timer = setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      clearInterval(timer)
      beginRecording()
    }
  }, 1000)
}

function beginRecording() {
  try {
    const startMs = recorder!.start()
    buffer = createLandmarkBuffer(startMs)
    phase.value = 'recording'
    stopTimer = setTimeout(finishRecording, MAX_RECORDING_MS)
  } catch (error) {
    if (stopTimer) clearTimeout(stopTimer)
    stopTimer = null
    buffer = null
    message.value = `Não foi possível iniciar a gravação: ${error instanceof Error ? error.message : 'erro desconhecido'}`
    phase.value = 'ready'
  }
}

async function finishRecording() {
  if (phase.value !== 'recording') return
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  phase.value = 'uploading'
  message.value = 'A finalizar…'
  const word = currentWord.value!
  let clip: RecordedClip
  try {
    clip = await recorder!.stop()
  } catch (error) {
    message.value = `Não foi possível terminar a gravação: ${error instanceof Error ? error.message : 'erro desconhecido'}`
    phase.value = 'ready'
    return
  }
  if (!buffer || !buffer.frames.some((frame) => frame.hands.length > 0)) {
    message.value = 'Não foram detetadas mãos. Grava de novo com as mãos visíveis.'
    phase.value = 'ready'
    return
  }
  pending = { clip, landmarksJson: serializeBuffer(buffer!), wordId: word.id }
  await sendPending()
}

async function sendPending() {
  if (!pending) return
  phase.value = 'uploading'
  message.value = 'A enviar…'
  try {
    await uploadRecording(fetch, session.value!.access_token, {
      wordId: pending.wordId,
      durationMs: pending.clip.durationMs,
      width: pending.clip.width,
      height: pending.clip.height,
      video: pending.clip.blob,
      landmarksJson: pending.landmarksJson,
    })
    counts.value = { ...counts.value, [pending.wordId]: (counts.value[pending.wordId] ?? 0) + 1 }
    skipped.value.delete(pending.wordId)
    pending = null
    message.value = 'Gravação guardada.'
    phase.value = 'ready'
  } catch (error) {
    message.value = `Não foi possível enviar: ${error instanceof Error ? error.message : 'erro desconhecido'}`
    phase.value = 'retry'
  }
}

function discardPending() {
  pending = null
  message.value = ''
  phase.value = 'ready'
}

onMounted(() => {
  if (readTipsSeen()) void start()
  else phase.value = 'intro'
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameHandle)
  if (stopTimer) clearTimeout(stopTimer)
  stream?.getTracks().forEach((track) => track.stop())
  tracker?.close()
})
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-4">
    <header class="flex items-center justify-between">
      <div class="flex gap-2">
        <UButton to="/progress" variant="ghost" size="sm">Progresso</UButton>
        <UButton to="/admin" variant="ghost" size="sm">Admin</UButton>
        <UButton variant="ghost" size="sm" @click="() => { showTips = true }">Dicas</UButton>
      </div>
      <UButton variant="ghost" size="sm" @click="logout">Sair</UButton>
    </header>

    <UModal v-model:open="showTips" title="Dicas para gravar bem">
      <template #body>
        <TipsCard />
      </template>
    </UModal>

    <UCard v-if="phase === 'intro'">
      <template #header>
        <h1 class="text-xl font-semibold">Antes de começares</h1>
        <p class="text-sm text-muted">Cinco dicas rápidas para as gravações ficarem boas.</p>
      </template>
      <TipsCard />
      <template #footer>
        <UButton size="lg" block @click="startFromIntro">Começar</UButton>
      </template>
    </UCard>

    <UAlert
      v-if="phase === 'fatal'"
      color="error"
      variant="subtle"
      title="Não foi possível iniciar"
      :description="fatalError"
    >
      <template #actions>
        <UButton size="sm" @click="reloadNuxtApp()">Tentar de novo</UButton>
      </template>
    </UAlert>

    <div v-show="phase !== 'intro' && phase !== 'fatal'" class="space-y-4">
      <div v-if="currentWord" class="text-center space-y-1">
        <p class="text-sm text-muted">Faz o gesto para:</p>
        <h1 class="text-5xl font-bold">{{ currentWord.word }}</h1>
        <p class="text-sm">{{ wordCount }}/{{ TARGET_PER_WORD }} gravações desta palavra</p>
        <UProgress :model-value="Math.min(wordCount, TARGET_PER_WORD)" :max="TARGET_PER_WORD" />
      </div>
      <UAlert
        v-else-if="phase !== 'loading' && words.length === 0"
        color="warning"
        variant="subtle"
        title="Ainda não há palavras para gravar"
        description="O vocabulário está vazio. Pede ao administrador para carregar as palavras (seed.sql) no Supabase e recarrega a página."
      />
      <div v-else-if="phase !== 'loading'" class="text-center space-y-1">
        <h1 class="text-4xl font-bold">Concluído!</h1>
        <p class="text-muted">Todas as palavras atingiram {{ TARGET_PER_WORD }} gravações.</p>
      </div>

      <div class="relative w-full overflow-hidden rounded-xl bg-black">
        <video ref="videoEl" class="w-full -scale-x-100" autoplay muted playsinline />
        <canvas ref="overlayEl" class="absolute inset-0 w-full h-full -scale-x-100" />
        <div
          v-if="phase === 'countdown'"
          class="absolute inset-0 flex items-center justify-center bg-black/40 text-8xl font-bold text-white"
        >
          {{ countdown }}
        </div>
        <div
          v-if="phase === 'recording'"
          class="absolute top-3 left-3 rounded-full bg-red-600 px-3 py-1 text-sm font-medium text-white"
        >
          A gravar
        </div>
        <div
          v-if="phase === 'loading'"
          class="absolute inset-0 flex items-center justify-center text-white"
        >
          A preparar a câmara e o detetor de mãos…
        </div>
        <div
          v-if="phase !== 'loading'"
          class="absolute top-3 right-3 rounded-full px-3 py-1 text-sm font-medium text-white"
          :class="handStatus(handsCount).tone === 'good' ? 'bg-green-600/90' : 'bg-amber-500/90'"
        >
          {{ handStatus(handsCount).label }}
        </div>
        <div
          v-if="phase !== 'loading' && noHandsMessage"
          class="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white"
        >
          {{ noHandsMessage }}
        </div>
      </div>

      <UAlert
        v-if="tooDark && phase !== 'loading'"
        color="warning"
        variant="subtle"
        title="Pouca luz"
        description="Vira-te para uma janela ou acende uma luz à tua frente para as mãos serem detetadas."
      />

      <div class="flex gap-2">
        <UButton
          v-if="phase !== 'recording'"
          size="xl"
          class="flex-1 justify-center"
          :disabled="!currentWord || busy || phase === 'loading' || phase === 'retry'"
          @click="beginCountdown"
        >
          Gravar
        </UButton>
        <UButton
          v-else
          size="xl"
          color="error"
          class="flex-1 justify-center"
          @click="finishRecording"
        >
          Parar
        </UButton>
        <UButton
          size="xl"
          variant="outline"
          :disabled="!currentWord || busy || phase === 'loading' || phase === 'retry'"
          @click="nextWord"
        >
          Próxima palavra
        </UButton>
      </div>

      <UAlert
        v-if="phase === 'retry'"
        color="warning"
        variant="subtle"
        :title="message"
      >
        <template #actions>
          <UButton size="sm" @click="sendPending">Tentar de novo</UButton>
          <UButton size="sm" variant="outline" @click="discardPending">Descartar</UButton>
        </template>
      </UAlert>
      <p v-else-if="message" class="text-center text-sm">{{ message }}</p>

      <div class="space-y-1">
        <p class="text-sm text-muted">Progresso total: {{ totalDone }}/{{ totalTarget }}</p>
        <UProgress :model-value="totalDone" :max="totalTarget || 1" />
      </div>
    </div>
  </div>
</template>
