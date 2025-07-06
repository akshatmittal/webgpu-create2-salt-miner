import { getContractAddress } from "viem";

import { getMiningShader } from "./mining-shader";

const debug = true;

async function getGPUDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw "No adapter";
  } else {
    return await adapter.requestDevice({
      requiredLimits: {
        maxStorageBuffersPerShaderStage: 10,
      },
    });
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

// Calculate CREATE2 address from salt and parameters using viem
function calculateCreate2Address(factoryAddress: string, salt: string, bytecodeHash: string): string {
  // Use viem's getContractAddress for proper CREATE2 address calculation
  // For CREATE2, we need to use bytecodeHash parameter, not bytecode
  return getContractAddress({
    opcode: "CREATE2",
    from: factoryAddress as `0x${string}`,
    salt: salt as `0x${string}`,
    bytecodeHash: bytecodeHash as `0x${string}`,
  });
}

export interface MiningParams {
  userAddress: string;
  factoryAddress: string;
  bytecodeHash: string;
  targetZeros: number;
  maxResults?: number;
  workgroupSize?: number;
  minScoreThreshold?: number; // New parameter for optimization
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
  currentThreshold: number; // Track current threshold
  iterationsCompleted: number; // Track completed iterations
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
    currentThreshold: 0,
    iterationsCompleted: 0,
  };
  private onStatsUpdate?: (stats: MiningStats) => void;

  constructor(onStatsUpdate?: (stats: MiningStats) => void) {
    this.onStatsUpdate = onStatsUpdate;
  }

  async init() {
    if (!miningGpu) {
      miningGpu = await new MiningGPU().init();
    }

    if (debug) {
      console.log("MiningGPU initialized successfully");
      console.log(`Device: ${miningGpu.device.label || "WebGPU Device"}`);
      console.log(`Compute pipeline: ${miningGpu.computePipeline ? "Ready" : "Not ready"}`);
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

    const {
      userAddress,
      factoryAddress,
      bytecodeHash,
      targetZeros,
      maxResults = 10,
      workgroupSize = 1024,
      minScoreThreshold = 0, // Start with 0 threshold to collect all results initially
    } = params;

    this.isRunning = true;
    this.stats.bestScore = 0;
    this.stats.results = [];
    this.stats.currentThreshold = minScoreThreshold;
    this.stats.iterationsCompleted = 0;
    this.updateStats();

    if (debug) {
      console.log(`Starting mining with initial threshold: ${minScoreThreshold}`);
    }

    try {
      // Convert addresses to Uint32Arrays
      const userAddressArray = hexToUint32Array(userAddress);
      const factoryAddressArray = hexToUint32Array(factoryAddress);
      const bytecodeHashArray = hexToUint32Array(bytecodeHash);

      if (debug) {
        console.log("Input validation:");
        console.log(`  userAddress: ${userAddress} -> ${userAddressArray.length} words`);
        console.log(`  factoryAddress: ${factoryAddress} -> ${factoryAddressArray.length} words`);
        console.log(`  bytecodeHash: ${bytecodeHash} -> ${bytecodeHashArray.length} words`);
        console.log(`  workgroupSize: ${workgroupSize}`);
        console.log(`  maxResults: ${maxResults}`);
      }

      // Generate random nonce for salt diversity
      const randomNonce = new Uint32Array(1);
      crypto.getRandomValues(randomNonce);

      if (debug) {
        console.log(`Generated random nonce: ${randomNonce[0]}`);
      }

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

      // Results buffer size: 9 words per result (1 score + 8 salt words)
      // Increased to 20 slots to match shader changes
      const resultsBufferSize = Math.max(maxResults, 20) * 9 * 4;
      let resultsBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: resultsBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      // Initialize with zeros
      new Uint32Array(resultsBuffer.getMappedRange()).fill(0);
      resultsBuffer.unmap();

      let resultCountBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      new Uint32Array(resultCountBuffer.getMappedRange()).set([0]);
      resultCountBuffer.unmap();

      let foundBetterBuffer = miningGpu.device.createBuffer({
        mappedAtCreation: true,
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      new Uint32Array(foundBetterBuffer.getMappedRange()).set([0]);
      foundBetterBuffer.unmap();

      let currentThreshold = minScoreThreshold;
      let totalIterations = 0;

      // Mine until we reach the target or user stops
      while (this.isRunning && this.stats.bestScore < targetZeros * 2) {
        const startTime = performance.now();
        const numWorkgroups = Math.ceil(workgroupSize / 8); // 8 threads per workgroup (matching shader)

        if (debug) {
          console.log(
            `Dispatching compute shader with threshold: ${currentThreshold}, ${numWorkgroups} workgroups, ${workgroupSize} total threads`,
          );
        }

        // Update threshold buffer
        const updateThresholdBuffer = miningGpu.device.createBuffer({
          mappedAtCreation: true,
          size: 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        new Uint32Array(updateThresholdBuffer.getMappedRange()).set([currentThreshold]);
        updateThresholdBuffer.unmap();

        // Update bind group with new threshold
        let updatedBindGroup = miningGpu.device.createBindGroup({
          layout: miningGpu.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: userAddressBuffer } },
            { binding: 1, resource: { buffer: factoryAddressBuffer } },
            { binding: 2, resource: { buffer: bytecodeHashBuffer } },
            { binding: 3, resource: { buffer: randomNonceBuffer } },
            { binding: 4, resource: { buffer: updateThresholdBuffer } },
            { binding: 5, resource: { buffer: resultsBuffer } },
            { binding: 6, resource: { buffer: resultCountBuffer } },
            { binding: 7, resource: { buffer: foundBetterBuffer } },
          ],
        });

        // Dispatch compute shader
        const commandEncoder = miningGpu.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(miningGpu.computePipeline);
        passEncoder.setBindGroup(0, updatedBindGroup);
        passEncoder.dispatchWorkgroups(numWorkgroups);
        passEncoder.end();

        // Copy results back to CPU
        const readThresholdBuffer = miningGpu.device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commandEncoder.copyBufferToBuffer(updateThresholdBuffer, 0, readThresholdBuffer, 0, 4);

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

        const readFoundBetterBuffer = miningGpu.device.createBuffer({
          size: 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        commandEncoder.copyBufferToBuffer(foundBetterBuffer, 0, readFoundBetterBuffer, 0, 4);

        const commands = commandEncoder.finish();
        miningGpu.device.queue.submit([commands]);

        if (debug) {
          console.log("Commands submitted, waiting for GPU...");
        }

        await readThresholdBuffer.mapAsync(GPUMapMode.READ);
        await readResultCountBuffer.mapAsync(GPUMapMode.READ);
        await readResultsBuffer.mapAsync(GPUMapMode.READ);
        await readFoundBetterBuffer.mapAsync(GPUMapMode.READ);

        const bestScore = new Uint32Array(readThresholdBuffer.getMappedRange())[0];
        const resultCount = new Uint32Array(readResultCountBuffer.getMappedRange())[0];
        const resultsData = new Uint32Array(readResultsBuffer.getMappedRange());
        const foundBetter = new Uint32Array(readFoundBetterBuffer.getMappedRange())[0];

        if (debug) {
          console.log(`GPU returned: bestScore=${bestScore}, resultCount=${resultCount}, foundBetter=${foundBetter}`);
          if (resultCount > 0) {
            console.log(`First result data: [${Array.from(resultsData.slice(0, 9)).join(", ")}]`);
          }
        }

        // Process results - now only 9 words per result
        const newResults: MiningResult[] = [];
        for (let i = 0; i < resultCount; i++) {
          const baseIdx = i * 9; // 1 score + 8 salt words
          const score = resultsData[baseIdx];

          if (debug && i === 0) {
            console.log(`Processing result ${i}: score=${score}, baseIdx=${baseIdx}`);
          }

          const saltArray = new Uint32Array(8);
          for (let j = 0; j < 8; j++) {
            saltArray[j] = resultsData[baseIdx + 1 + j];
          }

          const salt = uint32ArrayToHex(saltArray);

          if (debug && i === 0) {
            console.log(`Salt: ${salt}`);
          }

          // Calculate address on frontend using salt
          const address = calculateCreate2Address(factoryAddress, salt, bytecodeHash);

          if (debug && i === 0) {
            console.log(`Calculated address: ${address}`);
          }

          newResults.push({
            score,
            salt,
            address,
            zeros: Math.floor(score / 2),
          });
        }

        // Update stats - with 8 threads per workgroup, each thread processes 1024 iterations
        const attemptsThisRound = numWorkgroups * 8 * 1024;
        totalIterations++;
        this.stats.totalAttempts += attemptsThisRound;
        this.stats.bestScore = Math.max(this.stats.bestScore, bestScore);
        this.stats.hashRate = (attemptsThisRound / (performance.now() - startTime)) * 1000;
        this.stats.iterationsCompleted = totalIterations;

        // Add new results
        this.stats.results.push(...newResults);
        this.stats.results.sort((a, b) => b.score - a.score);
        this.stats.results = this.stats.results.slice(0, maxResults);

        // Update threshold based on results
        if (foundBetter && newResults.length > 0) {
          // Found better results, increase threshold slightly to encourage finding even better results
          const bestNewScore = Math.max(...newResults.map((r) => r.score));
          // Only increase threshold if we found significantly better results
          if (bestNewScore > currentThreshold + 1) {
            currentThreshold = bestNewScore;
          } else {
            // If we found results at or near current threshold, keep threshold the same
            // This allows us to collect more results at the same score level
            currentThreshold = Math.max(currentThreshold, bestNewScore);
          }
          this.stats.currentThreshold = currentThreshold;

          if (debug) {
            console.log(`Found better results! New threshold: ${currentThreshold}`);
          }
        } else {
          // No better results found, try a different approach
          // Instead of increasing threshold, let's try with a slightly lower threshold
          // to see if we can find more results at the current best score
          if (this.stats.bestScore > 0) {
            currentThreshold = Math.max(0, this.stats.bestScore - 1);
          }
          this.stats.currentThreshold = currentThreshold;

          if (debug) {
            console.log(`No better results found, trying with lower threshold: ${currentThreshold}`);
          }
        }

        // Reset result buffers for next iteration
        const resetResultCountBuffer = miningGpu.device.createBuffer({
          mappedAtCreation: true,
          size: 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        new Uint32Array(resetResultCountBuffer.getMappedRange()).set([0]);
        resetResultCountBuffer.unmap();

        const resetFoundBetterBuffer = miningGpu.device.createBuffer({
          mappedAtCreation: true,
          size: 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        new Uint32Array(resetFoundBetterBuffer.getMappedRange()).set([0]);
        resetFoundBetterBuffer.unmap();

        // Reset results buffer
        const resetResultsBuffer = miningGpu.device.createBuffer({
          mappedAtCreation: true,
          size: resultsBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        new Uint32Array(resetResultsBuffer.getMappedRange()).fill(0);
        resetResultsBuffer.unmap();

        // Update the original buffers for next iteration
        resultCountBuffer = resetResultCountBuffer;
        foundBetterBuffer = resetFoundBetterBuffer;
        resultsBuffer = resetResultsBuffer;

        // Update threshold buffer for next iteration
        const nextThresholdBuffer = miningGpu.device.createBuffer({
          mappedAtCreation: true,
          size: 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        new Uint32Array(nextThresholdBuffer.getMappedRange()).set([currentThreshold]);
        nextThresholdBuffer.unmap();

        // Update bind group with new buffers for next iteration
        const nextBindGroup = miningGpu.device.createBindGroup({
          layout: miningGpu.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: userAddressBuffer } },
            { binding: 1, resource: { buffer: factoryAddressBuffer } },
            { binding: 2, resource: { buffer: bytecodeHashBuffer } },
            { binding: 3, resource: { buffer: randomNonceBuffer } },
            { binding: 4, resource: { buffer: nextThresholdBuffer } },
            { binding: 5, resource: { buffer: resultsBuffer } },
            { binding: 6, resource: { buffer: resultCountBuffer } },
            { binding: 7, resource: { buffer: foundBetterBuffer } },
          ],
        });

        // Store the bind group for next iteration
        updatedBindGroup = nextBindGroup;

        this.updateStats();

        if (debug) {
          console.log(
            `Mining iteration ${totalIterations}: ${this.stats.totalAttempts} attempts (${attemptsThisRound} this round), best score: ${this.stats.bestScore}, threshold: ${currentThreshold}, ${newResults.length} new results, hashRate: ${this.stats.hashRate.toFixed(0)} H/s`,
          );
        }

        readThresholdBuffer.unmap();
        readResultCountBuffer.unmap();
        readResultsBuffer.unmap();
        readFoundBetterBuffer.unmap();

        // Small delay to prevent overwhelming the GPU
        await new Promise((resolve) => setTimeout(resolve, 10));
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
