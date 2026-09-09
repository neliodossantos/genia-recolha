import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import {
  createLandmarkBuffer,
  addFrame,
  resetBuffer,
  serializeBuffer,
} from "./landmarks.js";
import { pickNextWord } from "./progress.js";

const TARGET_PER_WORD = 20;

const signerSetup = document.getElementById("signer-setup");
const signerIdInput = document.getElementById("signer-id");
const startSessionButton = document.getElementById("start-session");

const recordingSession = document.getElementById("recording-session");
const currentWordEl = document.getElementById("current-word");
const progressLabelEl = document.getElementById("progress-label");
const videoEl = document.getElementById("camera-preview");
const overlayEl = document.getElementById("landmark-overlay");
const recordButton = document.getElementById("record-button");
const nextWordButton = document.getElementById("next-word-button");
const statusEl = document.getElementById("status-message");

let signerId = "";
let vocabulary = [];
let counts = {};
let currentWord = null;
let handLandmarker = null;
let mediaRecorder = null;
let recordedChunks = [];
let landmarkBuffer = createLandmarkBuffer();
let skippedWords = new Set();

async function loadHandLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

async function fetchVocabulary() {
  const response = await fetch("/api/vocabulary");
  return response.json();
}

async function fetchProgress(forSignerId) {
  const response = await fetch(
    `/api/progress?signer_id=${encodeURIComponent(forSignerId)}`
  );
  return response.json();
}

function updateWordDisplay() {
  const availableWords = vocabulary.filter((w) => !skippedWords.has(w));
  currentWord = pickNextWord(availableWords, counts, TARGET_PER_WORD);
  if (currentWord === null) {
    currentWordEl.textContent = "Concluído!";
    progressLabelEl.textContent = `Todas as ${vocabulary.length} palavras atingiram ${TARGET_PER_WORD} gravações.`;
    recordButton.disabled = true;
    return;
  }
  currentWordEl.textContent = currentWord;
  const count = counts[currentWord] || 0;
  progressLabelEl.textContent = `${count}/${TARGET_PER_WORD} gravações`;
  recordButton.disabled = false;
}

function skipCurrentWord() {
  if (currentWord !== null) {
    skippedWords.add(currentWord);
  }
  const remaining = vocabulary.filter((w) => !skippedWords.has(w));
  if (remaining.length === 0) {
    skippedWords.clear();
  }
  updateWordDisplay();
}

function detectionLoop() {
  if (!handLandmarker || videoEl.readyState < 2) {
    requestAnimationFrame(detectionLoop);
    return;
  }
  const timestampMs = performance.now();
  const result = handLandmarker.detectForVideo(videoEl, timestampMs);

  const ctx = overlayEl.getContext("2d");
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  for (const hand of result.landmarks) {
    for (const point of hand) {
      ctx.beginPath();
      ctx.arc(
        point.x * overlayEl.width,
        point.y * overlayEl.height,
        3,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = "#00ff88";
      ctx.fill();
    }
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    addFrame(landmarkBuffer, timestampMs, result.landmarks);
  }

  requestAnimationFrame(detectionLoop);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = resolve;
  });
  overlayEl.width = videoEl.videoWidth;
  overlayEl.height = videoEl.videoHeight;
  return stream;
}

async function uploadRecording(word, videoBlob) {
  const formData = new FormData();
  formData.append("word", word);
  formData.append("signer_id", signerId);
  formData.append("landmarks", serializeBuffer(landmarkBuffer));
  formData.append("video", videoBlob, "clip.webm");

  const response = await fetch("/api/recordings", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`);
  }
  return response.json();
}

function startRecording(stream) {
  recordedChunks = [];
  resetBuffer(landmarkBuffer);
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.start();
}

function stopRecording() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      resolve(new Blob(recordedChunks, { type: "video/webm" }));
    };
    mediaRecorder.stop();
  });
}

async function onRecordButtonClick() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    recordButton.textContent = "Gravar";
    statusEl.textContent = "A enviar...";
    const videoBlob = await stopRecording();
    try {
      await uploadRecording(currentWord, videoBlob);
      counts[currentWord] = (counts[currentWord] || 0) + 1;
      skippedWords.delete(currentWord);
      statusEl.textContent = "Gravação guardada.";
      updateWordDisplay();
    } catch (error) {
      statusEl.textContent = `Erro ao enviar: ${error.message}`;
    }
    return;
  }

  recordButton.textContent = "Parar";
  statusEl.textContent = "A gravar...";
  startRecording(videoEl.srcObject);
}

async function startSession() {
  signerId = signerIdInput.value.trim();
  if (!signerId) {
    alert("Indica um identificador antes de começar.");
    return;
  }

  signerSetup.hidden = true;
  recordingSession.hidden = false;
  statusEl.textContent = "A carregar o modelo de deteção de mãos...";

  try {
    [vocabulary, counts, handLandmarker] = await Promise.all([
      fetchVocabulary(),
      fetchProgress(signerId),
      loadHandLandmarker(),
    ]);

    await startCamera();
    statusEl.textContent = "";
    updateWordDisplay();
    detectionLoop();
  } catch (error) {
    statusEl.textContent = `Erro ao iniciar: ${error.message}. Recarrega a página para tentar novamente.`;
    signerSetup.hidden = false;
    recordingSession.hidden = true;
  }
}

startSessionButton.addEventListener("click", startSession);
recordButton.addEventListener("click", onRecordButtonClick);
nextWordButton.addEventListener("click", skipCurrentWord);
