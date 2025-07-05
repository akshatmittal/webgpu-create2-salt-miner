// Production CREATE2 mining shader for WebGPU Keccak-256 implementation
const keccak256_wgsl = `const KECCAK_ROUND: u32 = 24;
const KECCAK256_OUTPUT_SIZE: u32 = 8; // 8 * 32bit = 256 bits

// Keccak-256 round constants
const SHA3_PI = array<u32, 24>(20, 14, 22, 34, 36, 6, 10, 32, 16, 42, 48, 8, 30, 46, 38, 26, 24, 4, 40, 28, 44, 18, 12, 2);
const SHA3_ROTL = array<u32, 24>(1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44);
const SHA3_IOTA_H = array<u32, 24>(1, 32898, 32906, 2147516416, 32907, 2147483649, 2147516545, 32777, 138, 136, 2147516425, 2147483658, 2147516555, 139, 32905, 32771, 32770, 128, 32778, 2147483658, 2147516545, 32896, 2147483649, 2147516424);
const SHA3_IOTA_L = array<u32, 24>(0, 0, 2147483648, 2147483648, 0, 0, 2147483648, 2147483648, 0, 0, 0, 0, 0, 2147483648, 2147483648, 2147483648, 2147483648, 2147483648, 0, 2147483648, 2147483648, 2147483648, 0, 2147483648);

// Left rotation (without 0, 32, 64)
fn rotlH(h: u32, l: u32, s: u32) -> u32 {
    if (s > 32) {
        return (l << (s - 32)) | (h >> (64 - s));
    }
    else {
        return (h << s) | (l >> (32 - s));
    }
}

fn rotlL(h: u32, l: u32, s: u32) -> u32 {
    if (s > 32) {
        return (h << (s - 32)) | (l >> (64 - s));
    }
    else {
        return (l << s) | (h >> (32 - s));
    }
}

struct Keccak {
    state: array<u32, 50>, // 25 64-bit words = 50 32-bit words
}

fn keccak_permute(state: ptr<function, array<u32, 50>>) {
    var B: array<u32, 10>;

    for (var round: u32 = 0; round < KECCAK_ROUND; round = round + 1) {
        // Theta
        for (var x: u32 = 0; x < 10; x = x + 1) {
            B[x] = (*state)[x] ^ (*state)[x + 10] ^ (*state)[x + 20] ^ (*state)[x + 30] ^ (*state)[x + 40];
        }

        for (var x: u32 = 0; x < 10; x += 2) {
            let idx0 = (x + 2) % 10;
            let idx1 = (x + 8) % 10;

            let B0 = B[idx0];
            let B1 = B[idx0 + 1];

            let Th = rotlH(B0, B1, 1) ^ B[idx1];
            let Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];

            for (var y: u32 = 0; y < 50; y += 10) {
                (*state)[x + y] ^= Th;
                (*state)[x + y + 1] ^= Tl;
            }
        }

        // Rho Pi
        var curH: u32 = (*state)[2];
        var curL: u32 = (*state)[3];

        for (var t: u32 = 0; t < 24; t = t + 1) {
            let shift: u32 = SHA3_ROTL[t];
            let Th: u32 = rotlH(curH, curL, shift);
            let Tl: u32 = rotlL(curH, curL, shift);

            let PI: u32 = SHA3_PI[t];
            curH = (*state)[PI];
            curL = (*state)[PI + 1];

            (*state)[PI] = Th;
            (*state)[PI + 1] = Tl;
        }

        // Chi
        for (var y: u32 = 0; y < 50; y = y + 10) {
            for (var x: u32 = 0; x < 10; x = x + 1) {
                B[x] = (*state)[y + x];
            }

            for (var x: u32 = 0; x < 10; x = x + 1) {
                (*state)[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
            }
        }

        // Iota
        (*state)[0] ^= SHA3_IOTA_H[round];
        (*state)[1] ^= SHA3_IOTA_L[round];
    }
}

@group(0) @binding(0)
var<storage, read_write> messages: array<u32>;
@group(0) @binding(1)
var<storage, read> num_messages: u32;
@group(0) @binding(2)
var<storage, read> message_sizes: array<u32>;
@group(0) @binding(3)
var<storage, read_write> hashes: array<u32>;
@group(0) @binding(4)
var<storage, read_write> log_buffer: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if (index >= num_messages) {
        return;
    }

    // Get buffer layout info
    let padded_len = message_sizes[1];  // Size of padded message in 32-bit words
    let hash_index = index * KECCAK256_OUTPUT_SIZE;  // Output index
    let start = index * padded_len;  // Input start index

    // Initialize Keccak state (all zeros)
    var state: array<u32, 50>;
    for (var i: u32 = 0; i < 50; i = i + 1) {
        state[i] = 0u;
    }

    // Process input in 136-byte (34 word) blocks
    let block_size = 34u; // 136 bytes / 4 = 34 words
    let num_blocks = (padded_len + block_size - 1u) / block_size;

    for (var block: u32 = 0; block < num_blocks; block = block + 1) {
        let block_start = start + block * block_size;
        let words_in_block = min(block_size, padded_len - block * block_size);
        
        // Absorb this block into state (XOR)
        for (var i: u32 = 0; i < words_in_block; i = i + 1) {
            if (block_start + i < start + padded_len) {
                state[i] ^= messages[block_start + i];
            }
        }
        
        // Run Keccak permutation
        keccak_permute(&state);
    }

    // Extract output (first 8 words = 256 bits)
    for (var i: u32 = 0; i < KECCAK256_OUTPUT_SIZE; i = i + 1) {
        hashes[hash_index + i] = state[i];
    }

    // Debug logging
    log_buffer[0] = num_messages;
    log_buffer[1] = padded_len;
    log_buffer[2] = hash_index;
    log_buffer[3] = start;
    log_buffer[4] = messages[start];  // First word of input
    log_buffer[5] = hashes[hash_index];  // First word of output
}`;

// Simplified shader exports - only the production shader
export const shader = keccak256_wgsl;

export function getShader(device: GPUDevice): string {
  return keccak256_wgsl;
}
