export function createLandmarkBuffer() {
  return { frames: [] };
}

export function addFrame(buffer, timestampMs, handLandmarksResult) {
  const hands = (handLandmarksResult || []).map((hand) =>
    hand.map((point) => ({ x: point.x, y: point.y, z: point.z }))
  );
  buffer.frames.push({ t: timestampMs, hands });
  return buffer;
}

export function resetBuffer(buffer) {
  buffer.frames = [];
  return buffer;
}

export function serializeBuffer(buffer) {
  return JSON.stringify(buffer.frames);
}
