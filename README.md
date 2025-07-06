# ⚡ WebGPU Create2 Salt Miner

> [!WARNING]
> This is experimental software. I cooked this up in a matter of hours and the WebGPU Compte Shader is nowhere near optimized.

Proof of concept for a WebGPU Create2 Salt Miner. Finding salts for efficient CREATE2 contract deployment is extremely common but often requires a fair bit of compute, which often leads to GPU based solutions. Most popular implementations are binaries and are written in Rust. I wanted to create a web based solution for the problem and WebGPU came to mind. The spec itself is not finalized and is currently only supported in Chrome and it's derivatives.

The WebGPU Compute Shader is a port of the OpenCL Keccak F1600 implementation, but not optimized to the same level. The WebGPU implementation is currently ~25x slower than the OpenCL implementation (for my 3070), and since the difference is that high, I don't think it is possible to optimize it to the same level.

That said, it serves as a great proof of concept and if someone wants to take a stab at optimizing it, I'd be happy to integrate it.

## Code Quality

Near 90% of the frontend code is written by Claude, didn't want to bother with a UI if the compute shader wasn't going to be comparable at all. Doesn't implement Web Workers either, even though that would give a boost to the usability and overall performance. There are additionally some race conditions in the compute shader which results in same salts being found multiple times.

## Salt Format

12 bytes of entropy, of which 4 bytes is fixed per search.

```ml
Salt Structure
└── Full Salt (32 bytes)
    ├── Sender Address (20 bytes)
    ├── Nonce (4 bytes)
    ├── Execution ID (4 bytes)
    └── Incremental ID (4 bytes)
```
