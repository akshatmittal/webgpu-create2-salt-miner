export type BytesLike = string | number[] | ArrayBuffer | Uint8Array;

export function arrayify(hexString: string): Uint8Array {
  if (hexString.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(hexString.length / 2);

  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }

  return bytes;
}

export function isBytesLike(value: unknown): value is BytesLike {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((v) => typeof v === "number")) ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array
  );
}

// WebGPU utility functions for performance optimization

export interface GPUMemoryInfo {
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  bufferCount: number;
}

export class GPUMemoryManager {
  private bufferSizes: Map<GPUBuffer, number> = new Map();
  private totalAllocated = 0;

  trackBuffer(buffer: GPUBuffer, size: number) {
    this.bufferSizes.set(buffer, size);
    this.totalAllocated += size;
  }

  untrackBuffer(buffer: GPUBuffer) {
    const size = this.bufferSizes.get(buffer);
    if (size) {
      this.bufferSizes.delete(buffer);
      this.totalAllocated -= size;
    }
  }

  getMemoryInfo(): GPUMemoryInfo {
    return {
      totalMemory: 0, // WebGPU doesn't expose total memory
      usedMemory: this.totalAllocated,
      availableMemory: 0,
      bufferCount: this.bufferSizes.size,
    };
  }

  clear() {
    this.bufferSizes.clear();
    this.totalAllocated = 0;
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private timings: Map<string, number[]> = new Map();

  startTimer(name: string) {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      if (!this.timings.has(name)) {
        this.timings.set(name, []);
      }
      this.timings.get(name)!.push(duration);
    };
  }

  getAverageTime(name: string): number {
    const times = this.timings.get(name);
    if (!times || times.length === 0) return 0;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  getStats() {
    const stats: Record<string, { avg: number; min: number; max: number; count: number }> = {};
    for (const [name, times] of this.timings) {
      if (times.length > 0) {
        stats[name] = {
          avg: times.reduce((a, b) => a + b, 0) / times.length,
          min: Math.min(...times),
          max: Math.max(...times),
          count: times.length,
        };
      }
    }
    return stats;
  }

  clear() {
    this.timings.clear();
  }
}

// Workgroup size optimization based on device capabilities
export function getOptimalWorkgroupSize(device: GPUDevice): number {
  const maxWorkgroupSize = device.limits.maxComputeWorkgroupSizeX;
  
  // Prefer power-of-2 sizes for better GPU utilization
  const optimalSizes = [32, 64, 128, 256, 512, 1024];
  
  for (const size of optimalSizes) {
    if (size <= maxWorkgroupSize) {
      return size;
    }
  }
  
  return Math.min(64, maxWorkgroupSize);
}

// Buffer pooling with automatic cleanup
export class BufferPool {
  private pools: Map<string, GPUBuffer[]> = new Map();
  private maxPoolSize: number;

  constructor(maxPoolSize = 5) {
    this.maxPoolSize = maxPoolSize;
  }

  getBuffer(device: GPUDevice, size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    const key = `${size}-${usage}`;
    const pool = this.pools.get(key) || [];
    
    if (pool.length > 0) {
      return pool.pop()!;
    }
    
    return device.createBuffer({ size, usage });
  }

  returnBuffer(buffer: GPUBuffer, size: number, usage: GPUBufferUsageFlags) {
    const key = `${size}-${usage}`;
    const pool = this.pools.get(key) || [];
    
    if (pool.length < this.maxPoolSize) {
      pool.push(buffer);
      this.pools.set(key, pool);
    } else {
      buffer.destroy();
    }
  }

  clear() {
    for (const pool of this.pools.values()) {
      for (const buffer of pool) {
        buffer.destroy();
      }
    }
    this.pools.clear();
  }
}
