import { getMiningShader } from "./mining-shader";

const debug = true;

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

function hexToUint32Array(hex: string): Uint32Array {
  // Remove 0x prefix if present
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;

  // Pad to multiple of 8 characters (32 bits)
  const paddedHex = cleanHex.padStart(Math.ceil(cleanHex.length / 8) * 8, "0");

  const result = new Uint32Array(paddedHex.length / 8);
  for (let i = 0; i < result.length; i++) {
    // Extract 8 hex characters (32 bits) and convert with proper byte order
    const hexChunk = paddedHex.slice(i * 8, (i + 1) * 8);

    // Convert 8 hex chars to 4 bytes and pack as little-endian uint32
    const byte0 = parseInt(hexChunk.slice(0, 2), 16);
    const byte1 = parseInt(hexChunk.slice(2, 4), 16);
    const byte2 = parseInt(hexChunk.slice(4, 6), 16);
    const byte3 = parseInt(hexChunk.slice(6, 8), 16);

    // Pack as little-endian: LSB first
    result[i] = byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24);
  }
  return result;
}

function uint32ArrayToHex(arr: Uint32Array): string {
  let hexStr = "0x";

  for (let i = 0; i < arr.length; i++) {
    const word = arr[i];
    // Extract bytes in little-endian order
    const byte0 = word & 0xff;
    const byte1 = (word >> 8) & 0xff;
    const byte2 = (word >> 16) & 0xff;
    const byte3 = (word >> 24) & 0xff;

    // Convert to hex with proper padding
    hexStr += byte0.toString(16).padStart(2, "0");
    hexStr += byte1.toString(16).padStart(2, "0");
    hexStr += byte2.toString(16).padStart(2, "0");
    hexStr += byte3.toString(16).padStart(2, "0");
  }

  return hexStr;
}

function addressFromUint32Array(arr: Uint32Array): string {
  // Convert 5 words (20 bytes) to hex address with correct byte order
  let hexStr = "0x";

  for (let i = 0; i < arr.length; i++) {
    const word = arr[i];
    // Extract bytes in little-endian order
    const byte0 = word & 0xff;
    const byte1 = (word >> 8) & 0xff;
    const byte2 = (word >> 16) & 0xff;
    const byte3 = (word >> 24) & 0xff;

    // Convert to hex with proper padding
    hexStr += byte0.toString(16).padStart(2, "0");
    hexStr += byte1.toString(16).padStart(2, "0");
    hexStr += byte2.toString(16).padStart(2, "0");
    hexStr += byte3.toString(16).padStart(2, "0");
  }

  return hexStr.slice(0, 42); // Take only first 42 chars (0x + 40 hex chars = 20 bytes)
}

export interface MiningParams {
  userAddress: string;
  factoryAddress: string;
  bytecodeHash: string;
  targetZeros: number;
  maxResults?: number;
  workgroupSize?: number;
}

export interface MiningResult {
  score: number;
  salt: string;
  address: string;
  zeros: number;
}

export interface MiningStats {
  totalAttempts: number;
  hashRate: number;
  bestScore: number;
  results: MiningResult[];
  isRunning: boolean;
}

class MiningGPU {
  #device: GPUDevice | null = null;
  #computePipeline: GPUComputePipeline | null = null;

  async init() {
    this.#device = await getGPUDevice();
    const shaderCode = getMiningShader();
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

let miningGpu: MiningGPU;

export class CREATE2Miner {
  private isRunning = false;
  private stats: MiningStats = {
    totalAttempts: 0,
    hashRate: 0,
    bestScore: 0,
    results: [],
    isRunning: false,
  };
  private onStatsUpdate?: (stats: MiningStats) => void;

  constructor(onStatsUpdate?: (stats: MiningStats) => void) {
    this.onStatsUpdate = onStatsUpdate;
  }

  async init() {
    if (!miningGpu) {
      miningGpu = await new MiningGPU().init();
    }
    return this;
  }

  private updateStats() {
    this.stats.isRunning = this.isRunning;
    if (this.onStatsUpdate) {
      this.onStatsUpdate({ ...this.stats });
    }
  }

  async mine(params: MiningParams): Promise<MiningResult[]> {
    await this.init();

    const { userAddress, factoryAddress, bytecodeHash, targetZeros, maxResults = 10, workgroupSize = 1024 } = params;

    this.isRunning = true;
    this.stats.bestScore = 0;
    this.stats.results = [];
    this.updateStats();

    try {
      // Convert addresses to Uint32Arrays
      const userAddressArray = hexToUint32Array(userAddress);
      const factoryAddressArray = hexToUint32Array(factoryAddress);
      const bytecodeHashArray = hexToUint32Array(bytecodeHash);

      // Generate random nonce for salt diversity
      const randomNonce = new Uint32Array(1);
      crypto.getRandomValues(randomNonce);

      // Create GPU buffers
      const userAddressBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: userAddressArray.byteLength,
        usage: GPUBufferUsage.STORAGE,
      });
      new Uint32Array(userAddressBuffer.getMappedRange()).set(userAddressArray);
      userAddressBuffer.unmap();

      const factoryAddressBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: factoryAddressArray.byteLength,
        usage: GPUBufferUsage.STORAGE,
      });
      new Uint32Array(factoryAddressBuffer.getMappedRange()).set(factoryAddressArray);
      factoryAddressBuffer.unmap();

      const bytecodeHashBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: bytecodeHashArray.byteLength,
        usage: GPUBufferUsage.STORAGE,
      });
      new Uint32Array(bytecodeHashBuffer.getMappedRange()).set(bytecodeHashArray);
      bytecodeHashBuffer.unmap();

      const randomNonceBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: randomNonce.byteLength,
        usage: GPUBufferUsage.STORAGE,
      });
      new Uint32Array(randomNonceBuffer.getMappedRange()).set(randomNonce);
      randomNonceBuffer.unmap();

      const bestScoreBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      new Uint32Array(bestScoreBuffer.getMappedRange()).set([0]);
      bestScoreBuffer.unmap();

      const resultsBufferSize = maxResults * 14 * 4; // 14 words per result
      const resultsBuffer = miningGpu.device.createBuffer({
        size: resultsBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      const resultCountBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      new Uint32Array(resultCountBuffer.getMappedRange()).set([0]);
      resultCountBuffer.unmap();

      const maxResultsBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: 4,
        usage: GPUBufferUsage.STORAGE,
      });
      new Uint32Array(maxResultsBuffer.getMappedRange()).set([maxResults]);
      maxResultsBuffer.unmap();

      const bindGroup = miningGpu.device.createBindGroup({
        layout: miningGpu.computePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: userAddressBuffer } },
          { binding: 1, resource: { buffer: factoryAddressBuffer } },
          { binding: 2, resource: { buffer: bytecodeHashBuffer } },
          { binding: 3, resource: { buffer: randomNonceBuffer } },
          { binding: 4, resource: { buffer: bestScoreBuffer } },
          { binding: 5, resource: { buffer: resultsBuffer } },
          { binding: 6, resource: { buffer: resultCountBuffer } },
          { binding: 7, resource: { buffer: maxResultsBuffer } },
        ],
      });

      // Mine until we reach the target or user stops
      while (this.isRunning && this.stats.bestScore < targetZeros * 2) {
        const startTime = performance.now();

        // Dispatch compute shader
        const commandEncoder = miningGpu.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(miningGpu.computePipeline);
        passEncoder.setBindGroup(0, bindGroup);

        const numWorkgroups = Math.ceil(workgroupSize / 64); // 64 threads per workgroup
        passEncoder.dispatchWorkgroups(numWorkgroups);
        passEncoder.end();

        // Copy results back to CPU
        const readBestScoreBuffer = miningGpu.device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commandEncoder.copyBufferToBuffer(bestScoreBuffer, 0, readBestScoreBuffer, 0, 4);

        const readResultCountBuffer = miningGpu.device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commandEncoder.copyBufferToBuffer(resultCountBuffer, 0, readResultCountBuffer, 0, 4);

        const readResultsBuffer = miningGpu.device.createBuffer({
          size: resultsBufferSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commandEncoder.copyBufferToBuffer(resultsBuffer, 0, readResultsBuffer, 0, resultsBufferSize);

        const commands = commandEncoder.finish();
        miningGpu.device.queue.submit([commands]);

        await readBestScoreBuffer.mapAsync(GPUMapMode.READ);
        await readResultCountBuffer.mapAsync(GPUMapMode.READ);
        await readResultsBuffer.mapAsync(GPUMapMode.READ);

        const bestScore = new Uint32Array(readBestScoreBuffer.getMappedRange())[0];
        const resultCount = new Uint32Array(readResultCountBuffer.getMappedRange())[0];
        const resultsData = new Uint32Array(readResultsBuffer.getMappedRange());

        // Process results
        const newResults: MiningResult[] = [];
        for (let i = 0; i < resultCount; i++) {
          const baseIdx = i * 14;
          const score = resultsData[baseIdx];

          const saltArray = new Uint32Array(8);
          for (let j = 0; j < 8; j++) {
            saltArray[j] = resultsData[baseIdx + 1 + j];
          }

          const addressArray = new Uint32Array(5);
          for (let j = 0; j < 5; j++) {
            addressArray[j] = resultsData[baseIdx + 9 + j];
          }

          newResults.push({
            score,
            salt: uint32ArrayToHex(saltArray),
            address: addressFromUint32Array(addressArray),
            zeros: Math.floor(score / 2),
          });
        }

        // Update stats - each thread now processes 1024 nonces
        const attemptsThisRound = workgroupSize * 1024;
        this.stats.totalAttempts += attemptsThisRound;
        this.stats.bestScore = Math.max(this.stats.bestScore, bestScore);
        this.stats.hashRate = (attemptsThisRound / (performance.now() - startTime)) * 1000;

        // Add new results
        this.stats.results.push(...newResults);
        this.stats.results.sort((a, b) => b.score - a.score);
        this.stats.results = this.stats.results.slice(0, maxResults);

        this.updateStats();

        if (debug) {
          console.log(
            `Mining iteration: ${this.stats.totalAttempts} attempts (${attemptsThisRound} this round), best score: ${this.stats.bestScore}, ${newResults.length} new results`,
          );
        }

        readBestScoreBuffer.unmap();
        readResultCountBuffer.unmap();
        readResultsBuffer.unmap();
      }

      return this.stats.results;
    } finally {
      this.isRunning = false;
      this.updateStats();
    }
  }

  stop() {
    this.isRunning = false;
    this.updateStats();
  }

  getStats(): MiningStats {
    return { ...this.stats };
  }
}

export async function mineCreate2Salt(params: MiningParams): Promise<MiningResult[]> {
  const miner = new CREATE2Miner();
  return await miner.mine(params);
}
