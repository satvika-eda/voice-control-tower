// src/utils/audio.ts

// NOTE: You do NOT need to import LiveServerMessage/Modality here.
// Keep this file focused on audio utilities.

// ---------------------------
// Environment-safe Base64
// ---------------------------

function hasBuffer(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (globalThis as any).Buffer !== "undefined";
}

function base64ToBytesBrowser(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Browser(bytes: Uint8Array): string {
  // Chunk to avoid call stack overflow
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytesNode(base64: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  return Uint8Array.from(B.from(base64, "base64"));
}

function bytesToBase64Node(bytes: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  return B.from(bytes).toString("base64");
}

/**
 * Convert base64 string to Uint8Array (browser + Node compatible).
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  return hasBuffer() ? base64ToBytesNode(base64) : base64ToBytesBrowser(base64);
}

/**
 * Convert ArrayBuffer to base64 string (browser + Node compatible).
 * Safe for large buffers.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return hasBuffer() ? bytesToBase64Node(bytes) : bytesToBase64Browser(bytes);
}

/**
 * Convert Uint8Array to base64 string (browser + Node compatible).
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return hasBuffer() ? bytesToBase64Node(bytes) : bytesToBase64Browser(bytes);
}

// ---------------------------
// PCM16 (Little Endian) <-> Float32
// ---------------------------

export type PcmMimeType = `audio/pcm;rate=${number}`;

/**
 * Encode Float32 samples [-1,1] to PCM16 little-endian bytes.
 */
export function float32ToPcm16LE(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    // Convert to signed 16-bit PCM
    const v = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(i * 2, v, true); // little-endian
  }
  return out;
}

/**
 * Decode PCM16 little-endian bytes into Float32 samples [-1,1].
 * Handles byteOffset/byteLength correctly.
 */
export function pcm16LEToFloat32(
  pcmBytes: Uint8Array,
  numChannels = 1
): Float32Array {
  if (pcmBytes.byteLength % 2 !== 0) {
    throw new Error(`PCM16 byteLength must be even. Got: ${pcmBytes.byteLength}`);
  }

  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const totalSamples = pcmBytes.byteLength / 2;
  const frames = totalSamples / numChannels;

  if (!Number.isInteger(frames)) {
    throw new Error(
      `PCM data does not align with numChannels=${numChannels}. ` +
        `TotalSamples=${totalSamples}`
    );
  }

  const out = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const s16 = view.getInt16(i * 2, true);
    out[i] = s16 / 32768;
  }
  return out;
}

/**
 * Interleave/deinterleave helpers (optional, but handy for stereo).
 */
export function deinterleave(
  interleaved: Float32Array,
  numChannels: number
): Float32Array[] {
  if (numChannels <= 1) return [interleaved];

  const frames = interleaved.length / numChannels;
  if (!Number.isInteger(frames)) {
    throw new Error("Interleaved buffer length is not divisible by numChannels.");
  }

  const channels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][f] = interleaved[f * numChannels + ch];
    }
  }
  return channels;
}

export function interleave(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];

  const frames = channels[0].length;
  for (let i = 1; i < channels.length; i++) {
    if (channels[i].length !== frames) throw new Error("All channels must have the same length.");
  }

  const out = new Float32Array(frames * channels.length);
  for (let f = 0; f < frames; f++) {
    for (let ch = 0; ch < channels.length; ch++) {
      out[f * channels.length + ch] = channels[ch][f];
    }
  }
  return out;
}

// ---------------------------
// AudioBuffer creation (for playback/visualization)
// ---------------------------

/**
 * Convert raw PCM16 bytes to an AudioBuffer for playback in WebAudio.
 * This is for *raw PCM* (not WAV/MP3).
 */
export async function decodeAudioData(
  pcmBytes: Uint8Array,
  ctx: AudioContext,
  sampleRate = 24000,
  numChannels = 1
): Promise<AudioBuffer> {
  const floats = pcm16LEToFloat32(pcmBytes, numChannels);
  const frameCount = floats.length / numChannels;

  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  if (numChannels === 1) {
    buffer.getChannelData(0).set(floats);
    return buffer;
  }

  const channelData = deinterleave(floats, numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    buffer.getChannelData(ch).set(channelData[ch]);
  }
  return buffer;
}

// ---------------------------
// Gemini / Live API payload helpers
// ---------------------------

/**
 * Create a base64 PCM payload from Float32 samples for models expecting PCM16.
 * Default sampleRate=16000 because many voice endpoints prefer 16k PCM.
 */
export function createPcmBlob(
  samples: Float32Array,
  sampleRate = 16000
): { data: string; mimeType: PcmMimeType } {
  const pcmBytes = float32ToPcm16LE(samples);
  return {
    data: uint8ArrayToBase64(pcmBytes),
    mimeType: `audio/pcm;rate=${sampleRate}`,
  };
}

/**
 * Convenience: base64 PCM16 -> Float32Array
 */
export function base64Pcm16ToFloat32(
  base64: string,
  numChannels = 1
): Float32Array {
  const bytes = base64ToUint8Array(base64);
  return pcm16LEToFloat32(bytes, numChannels);
}

/**
 * Convenience: base64 PCM16 -> AudioBuffer (for playback)
 */
export async function base64Pcm16ToAudioBuffer(
  base64: string,
  ctx: AudioContext,
  sampleRate = 24000,
  numChannels = 1
): Promise<AudioBuffer> {
  const bytes = base64ToUint8Array(base64);
  return decodePcm16ToAudioBuffer(bytes, ctx, sampleRate, numChannels);
}
