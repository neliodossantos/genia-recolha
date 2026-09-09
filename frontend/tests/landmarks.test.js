import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLandmarkBuffer,
  addFrame,
  resetBuffer,
  serializeBuffer,
} from "../js/landmarks.js";

test("createLandmarkBuffer starts empty", () => {
  const buffer = createLandmarkBuffer();
  assert.deepEqual(buffer.frames, []);
});

test("addFrame appends a frame with timestamp and hand points", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, [[{ x: 0.1, y: 0.2, z: 0.3 }]]);
  assert.equal(buffer.frames.length, 1);
  assert.equal(buffer.frames[0].t, 100);
  assert.deepEqual(buffer.frames[0].hands, [[{ x: 0.1, y: 0.2, z: 0.3 }]]);
});

test("addFrame records an empty hands array when no hand is detected", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 200, []);
  assert.deepEqual(buffer.frames[0].hands, []);
});

test("addFrame treats a null result as no hand detected", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 300, null);
  assert.deepEqual(buffer.frames[0].hands, []);
});

test("resetBuffer clears accumulated frames", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, []);
  resetBuffer(buffer);
  assert.deepEqual(buffer.frames, []);
});

test("serializeBuffer returns a JSON string of the frames", () => {
  const buffer = createLandmarkBuffer();
  addFrame(buffer, 100, [[{ x: 1, y: 2, z: 3 }]]);
  const parsed = JSON.parse(serializeBuffer(buffer));
  assert.deepEqual(parsed, [{ t: 100, hands: [[{ x: 1, y: 2, z: 3 }]] }]);
});
