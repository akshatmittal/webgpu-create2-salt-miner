import { arrayify, BytesLike } from "./utils";
import { getShader } from "./shader";

const debug = false;

async function getGPUDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw "No adapter";
  } else {
    return await adapter.requestDevice();
  }
}

function padMessage(bytes: Uint8Array, size: number): Uint32Array {
  const arrBuff = new ArrayBuffer(size * 4);
  new Uint8Array(arrBuff).set(bytes);
  return new Uint32Array(arrBuff);
}

function getMessageSizes(bytes: Uint8Array): Uint32Array {
  // For Keccak-256, we need to know:
  // 1. The size of the original message in 32-bit words (for input_len in shader)
  // 2. The size of the padded message in 32-bit words (for buffer allocation)

  const originalMessageLen = bytes.length;
  const paddedMessage = padMessageForKeccak(bytes);
  const paddedLen = paddedMessage.length;

  // Convert to 32-bit words
  const originalSizeIn32BitWords = Math.ceil(originalMessageLen / 4);
  const paddedSizeIn32BitWords = paddedLen / 4;

  return new Uint32Array([originalSizeIn32BitWords, paddedSizeIn32BitWords]);
}

function padMessageForKeccak(bytes: Uint8Array): Uint8Array {
  const rate = 136; // 136 bytes for Keccak-256
  const messageLen = bytes.length;

  // Calculate total padded length
  const paddingNeeded = rate - (messageLen % rate);
  const paddedLen = messageLen + paddingNeeded;

  // Create padded array
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);

  // Apply Keccak padding: pad10*1
  padded[messageLen] = 0x01; // First padding bit
  padded[paddedLen - 1] |= 0x80; // Last padding bit

  return padded;
}

function calcNumWorkgroups(device: GPUDevice, messages: Uint8Array[]): number {
  const numWorkgroups = Math.ceil(messages.length / device.limits.maxComputeWorkgroupSizeX);
  if (numWorkgroups > device.limits.maxComputeWorkgroupsPerDimension) {
    throw `Input array too large. Max size is ${
      device.limits.maxComputeWorkgroupsPerDimension * device.limits.maxComputeWorkgroupSizeX
    }.`;
  }
  return numWorkgroups;
}

function check(messages: Uint8Array[]) {
  for (const message of messages) {
    if (message.length !== messages[0].length) throw "Messages must have the same size";
    // if (message.length % 4 !== 0) throw "Message must be 32-bit aligned";
  }
}

class GPU {
  #device: GPUDevice | null = null;
  #computePipeline: GPUComputePipeline | null = null;

  async init() {
    this.#device = await getGPUDevice();
    const shaderCode = getShader(this.#device);
    this.#computePipeline = this.#device.createComputePipeline({
      compute: {
        module: this.#device.createShaderModule({ code: shaderCode }),
        entryPoint: "main",
      },
      layout: "auto",
    });
    return this;
  }

  get device() {
    if (!this.#device) {
      throw new Error("Device is not initialized");
    }
    return this.#device;
  }

  get computePipeline() {
    if (!this.#computePipeline) {
      throw new Error("Compute pipeline is not initialized");
    }
    return this.#computePipeline;
  }
}

let gpu: GPU;

/**
 * Init GPU
 *
 */
export async function gpu_init() {
  return gpu ? gpu : await new GPU().init();
}

/**
 * Force GPU re-initialization
 */
export async function gpu_reinit() {
  gpu = await new GPU().init();
  return gpu;
}

/**
 * Batch keccak256
 *
 * @param {Uint8Array[]} messages messages to hash. Each message must be 32-bit aligned with the same size
 * @returns {Uint8Array} the set of resulting hashes
 */
export async function keccak256_gpu_batch(messages: Uint8Array[]) {
  check(messages);

  gpu = await gpu_init();

  const numWorkgroups = calcNumWorkgroups(gpu.device, messages);

  // Apply correct Keccak padding
  const paddedMessages = messages.map((msg) => padMessageForKeccak(msg));
  const messageSizes = getMessageSizes(messages[0]);

  const messageArray = new Uint32Array(messageSizes[1] * messages.length);

  let offset = 0;
  for (const paddedMessage of paddedMessages) {
    const messagePad = padMessage(paddedMessage, messageSizes[1]);
    // messagePad is the padded version of the input message with proper Keccak-256 padding
    messageArray.set(messagePad, offset);
    offset += messagePad.length;
  }

  // messages
  const messageArrayBuffer = gpu.device.createBuffer({
    mappedAtCreation: true,
    size: messageArray.byteLength,
    usage: GPUBufferUsage.STORAGE,
  });
  new Uint32Array(messageArrayBuffer.getMappedRange()).set(messageArray);
  messageArrayBuffer.unmap();

  // num_messages
  const numMessagesBuffer = gpu.device.createBuffer({
    mappedAtCreation: true,
    size: Uint32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });
  new Uint32Array(numMessagesBuffer.getMappedRange()).set([messages.length]);
  numMessagesBuffer.unmap();

  // message_sizes
  const messageSizesBuffer = gpu.device.createBuffer({
    mappedAtCreation: true,
    size: messageSizes.byteLength,
    usage: GPUBufferUsage.STORAGE,
  });
  new Uint32Array(messageSizesBuffer.getMappedRange()).set(messageSizes);
  messageSizesBuffer.unmap();

  // Result
  const resultBufferSize = (256 / 8) * messages.length;
  const resultBuffer = gpu.device.createBuffer({
    size: resultBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // Log Buffer
  const logBufferSize = 256;
  const logBuffer = gpu.device.createBuffer({
    size: logBufferSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const bindGroup = gpu.device.createBindGroup({
    layout: gpu.computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: messageArrayBuffer,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: numMessagesBuffer,
        },
      },
      {
        binding: 2,
        resource: {
          buffer: messageSizesBuffer,
        },
      },
      {
        binding: 3,
        resource: {
          buffer: resultBuffer,
        },
      },
      {
        binding: 4,
        resource: {
          buffer: logBuffer,
        },
      },
    ],
  });

  const commandEncoder = gpu.device.createCommandEncoder();

  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(gpu.computePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(numWorkgroups);
  passEncoder.end();

  const gpuReadBuffer = gpu.device.createBuffer({
    size: resultBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  commandEncoder.copyBufferToBuffer(resultBuffer, 0, gpuReadBuffer, 0, resultBufferSize);

  const gpuLogReadBuffer = gpu.device.createBuffer({
    size: logBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  commandEncoder.copyBufferToBuffer(logBuffer, 0, gpuLogReadBuffer, 0, logBufferSize);

  const gpuCommands = commandEncoder.finish();
  gpu.device.queue.submit([gpuCommands]);

  await gpuReadBuffer.mapAsync(GPUMapMode.READ);
  await gpuLogReadBuffer.mapAsync(GPUMapMode.READ);

  if (debug) {
    const logContent = new Uint32Array(gpuLogReadBuffer.getMappedRange());
    console.log("[Shader Log]:", logContent);
  }

  return new Uint8Array(gpuReadBuffer.getMappedRange());
}

export async function keccak256_gpu(data: string) {
  const hashes = await keccak256_gpu_batch([arrayify(data)]);

  return "0x" + hashes.subarray(0, 32).reduce((a: any, b: any) => a + b.toString(16).padStart(2, "0"), "");
}

// Aliases for convenience
export const initGpu = gpu_init;
