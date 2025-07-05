// CREATE2 Mining Shader for WebGPU
const create2_mining_wgsl = `const KECCAK_ROUND: u32 = 24;
const KECCAK256_OUTPUT_SIZE: u32 = 8; // 8 * 32bit = 256 bits

// Keccak-256 round constants
const SHA3_PI = array<u32, 24>(20, 14, 22, 34, 36, 6, 10, 32, 16, 42, 48, 8, 30, 46, 38, 26, 24, 4, 40, 28, 44, 18, 12, 2);
const SHA3_ROTL = array<u32, 24>(1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44);
const SHA3_IOTA_H = array<u32, 24>(1, 32898, 32906, 2147516416, 32907, 2147483649, 2147516545, 32777, 138, 136, 2147516425, 2147483658, 2147516555, 139, 32905, 32771, 32770, 128, 32778, 2147483658, 2147516545, 32896, 2147483649, 2147516424);
const SHA3_IOTA_L = array<u32, 24>(0, 0, 2147483648, 2147483648, 0, 0, 2147483648, 2147483648, 0, 0, 0, 0, 0, 2147483648, 2147483648, 2147483648, 2147483648, 2147483648, 0, 2147483648, 2147483648, 2147483648, 0, 2147483648);

// Left rotation
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

fn keccak_permute(state: ptr<function, array<u32, 50>>) {
    var B: array<u32, 10>;

    for (var round: u32 = 0; round < KECCAK_ROUND; round = round + 1u) {
        // Theta
        for (var x: u32 = 0; x < 10u; x = x + 1u) {
            B[x] = (*state)[x] ^ (*state)[x + 10u] ^ (*state)[x + 20u] ^ (*state)[x + 30u] ^ (*state)[x + 40u];
        }

        for (var x: u32 = 0; x < 10u; x += 2u) {
            let idx0 = (x + 2u) % 10u;
            let idx1 = (x + 8u) % 10u;

            let B0 = B[idx0];
            let B1 = B[idx0 + 1u];

            let Th = rotlH(B0, B1, 1u) ^ B[idx1];
            let Tl = rotlL(B0, B1, 1u) ^ B[idx1 + 1u];

            for (var y: u32 = 0; y < 50u; y += 10u) {
                (*state)[x + y] ^= Th;
                (*state)[x + y + 1u] ^= Tl;
            }
        }

        // Rho Pi
        var curH: u32 = (*state)[2u];
        var curL: u32 = (*state)[3u];

        for (var t: u32 = 0; t < 24u; t = t + 1u) {
            let shift: u32 = SHA3_ROTL[t];
            let Th: u32 = rotlH(curH, curL, shift);
            let Tl: u32 = rotlL(curH, curL, shift);

            let PI: u32 = SHA3_PI[t];
            curH = (*state)[PI];
            curL = (*state)[PI + 1u];

            (*state)[PI] = Th;
            (*state)[PI + 1u] = Tl;
        }

        // Chi
        for (var y: u32 = 0; y < 50u; y = y + 10u) {
            for (var x: u32 = 0; x < 10u; x = x + 1u) {
                B[x] = (*state)[y + x];
            }

            for (var x: u32 = 0; x < 10u; x = x + 1u) {
                (*state)[y + x] ^= ~B[(x + 2u) % 10u] & B[(x + 4u) % 10u];
            }
        }

        // Iota
        (*state)[0u] ^= SHA3_IOTA_H[round];
        (*state)[1u] ^= SHA3_IOTA_L[round];
    }
}

// Calculate Keccak-256 of a message
fn keccak256(message: ptr<function, array<u32, 34>>) -> array<u32, 8> {
    var state: array<u32, 50>;
    for (var i: u32 = 0; i < 50u; i = i + 1u) {
        state[i] = 0u;
    }

    // Absorb the message (136 bytes = 34 words)
    for (var i: u32 = 0; i < 34u; i = i + 1u) {
        state[i] ^= (*message)[i];
    }
    
    keccak_permute(&state);
    
    // Extract first 8 words (256 bits)
    var result: array<u32, 8>;
    for (var i: u32 = 0; i < 8u; i = i + 1u) {
        result[i] = state[i];
    }
    return result;
}

// Score an address based on leading zeros (last 20 bytes of hash)
fn scoreAddress(hash: array<u32, 8>) -> u32 {
    var score: u32 = 0u;
    
    // Address is the last 20 bytes of the 32-byte hash (words 3-7)
    // Process bytes in the same order as TypeScript addressFromUint32Array
    for (var word_idx: u32 = 3u; word_idx < 8u; word_idx = word_idx + 1u) {
        let word = hash[word_idx];
        
        // Extract bytes in little-endian order (same as TypeScript function)
        let byte0 = word & 0xFFu;
        let byte1 = (word >> 8u) & 0xFFu;
        let byte2 = (word >> 16u) & 0xFFu;
        let byte3 = (word >> 24u) & 0xFFu;
        
        // Process bytes in order: byte0, byte1, byte2, byte3
        // Check byte0
        if (byte0 == 0u) {
            score = score + 2u; // 2 points for zero byte
        } else {
            let high_nibble = (byte0 >> 4u) & 0xFu;
            if (high_nibble == 0u) {
                score = score + 1u; // 1 point for zero nibble
            }
            return score; // Stop at first non-zero nibble
        }
        
        // Check byte1
        if (byte1 == 0u) {
            score = score + 2u;
        } else {
            let high_nibble = (byte1 >> 4u) & 0xFu;
            if (high_nibble == 0u) {
                score = score + 1u;
            }
            return score;
        }
        
        // Check byte2
        if (byte2 == 0u) {
            score = score + 2u;
        } else {
            let high_nibble = (byte2 >> 4u) & 0xFu;
            if (high_nibble == 0u) {
                score = score + 1u;
            }
            return score;
        }
        
        // Check byte3
        if (byte3 == 0u) {
            score = score + 2u;
        } else {
            let high_nibble = (byte3 >> 4u) & 0xFu;
            if (high_nibble == 0u) {
                score = score + 1u;
            }
            return score;
        }
    }
    
    return score;
}

// Input parameters
@group(0) @binding(0)
var<storage, read> user_address: array<u32, 5>; // 20 bytes = 5 words

@group(0) @binding(1)
var<storage, read> factory_address: array<u32, 5>; // 20 bytes = 5 words

@group(0) @binding(2)
var<storage, read> bytecode_hash: array<u32, 8>; // 32 bytes = 8 words

@group(0) @binding(3)
var<storage, read> random_nonce: u32; // 4 bytes random from TypeScript

@group(0) @binding(4)
var<storage, read_write> best_score: atomic<u32>; // Current best score

@group(0) @binding(5)
var<storage, read_write> results: array<u32>; // Results buffer: [score, salt_word0, salt_word1, ..., salt_word7, address_word0, ..., address_word4]

@group(0) @binding(6)
var<storage, read_write> result_count: atomic<u32>; // Number of results found

@group(0) @binding(7)
var<storage, read> max_results: u32; // Maximum number of results to store

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let thread_id = global_id.x;
    
    // Generate salt with 3-part uniqueness guarantee:
    // user_address (20 bytes) + random_from_ts (4 bytes) + thread_id (4 bytes) + loop_counter (4 bytes)
    var salt: array<u32, 8>; // 32 bytes = 8 words
    
    // Copy user address (20 bytes = 5 words)
    for (var i: u32 = 0; i < 5u; i = i + 1u) {
        salt[i] = user_address[i];
    }
    
    // Set random nonce from TypeScript (4 bytes)
    salt[5] = random_nonce;
    
    // Set unique thread ID (4 bytes) 
    salt[6] = thread_id;
    
    // Loop through different counters per thread
    for (var loop_counter: u32 = 0u; loop_counter < 1024u; loop_counter = loop_counter + 1u) {
        // Set unique loop counter (4 bytes)
        salt[7] = loop_counter;
    
        // Construct CREATE2 input: 0xff + factory_address + salt + bytecode_hash
        var create2_input: array<u32, 34>; // 136 bytes = 34 words (padded for Keccak)
        
        // 0xff prefix (1 byte) + factory_address (20 bytes) + salt (32 bytes) + bytecode_hash (32 bytes) = 85 bytes
        // Need to pad to 136 bytes for Keccak rate
        
        // Initialize with zeros
        // for (var i: u32 = 0; i < 34u; i = i + 1u) {
        //     create2_input[i] = 0u;
        // }
        
        // Simplified approach: construct the CREATE2 input byte by byte
        // CREATE2 input = 0xff + factory_address + salt + bytecode_hash (85 bytes total)
        
        // Copy data in correct order with proper byte alignment
        // 0xff (1 byte) + factory_address (20 bytes) = 21 bytes
        create2_input[0] = 0xFFu;
        
        // Copy factory address starting at word 0, byte 1
        for (var i: u32 = 0; i < 5u; i = i + 1u) {
            let word_idx = (i * 4u + 1u) / 4u;
            let byte_offset = (i * 4u + 1u) % 4u;
            
            // Extract bytes from factory_address[i] and place at correct position
            let word_val = factory_address[i];
            for (var j: u32 = 0; j < 4u; j = j + 1u) {
                let byte_val = (word_val >> (j * 8u)) & 0xFFu;
                let target_word = (i * 4u + j + 1u) / 4u;
                let target_byte = (i * 4u + j + 1u) % 4u;
                create2_input[target_word] |= byte_val << (target_byte * 8u);
            }
        }
        
        // Copy salt starting at byte 21
        for (var i: u32 = 0; i < 8u; i = i + 1u) {
            let word_val = salt[i];
            for (var j: u32 = 0; j < 4u; j = j + 1u) {
                let byte_val = (word_val >> (j * 8u)) & 0xFFu;
                let target_word = (i * 4u + j + 21u) / 4u;
                let target_byte = (i * 4u + j + 21u) % 4u;
                create2_input[target_word] |= byte_val << (target_byte * 8u);
            }
        }
        
        // Copy bytecode hash starting at byte 53
        for (var i: u32 = 0; i < 8u; i = i + 1u) {
            let word_val = bytecode_hash[i];
            for (var j: u32 = 0; j < 4u; j = j + 1u) {
                let byte_val = (word_val >> (j * 8u)) & 0xFFu;
                let target_word = (i * 4u + j + 53u) / 4u;
                let target_byte = (i * 4u + j + 53u) % 4u;
                create2_input[target_word] |= byte_val << (target_byte * 8u);
            }
        }
        
        // Apply Keccak padding at byte 85
        let pad_word = 85u / 4u; // Word 21
        let pad_byte = 85u % 4u; // Byte 1
        create2_input[pad_word] |= 0x01u << (pad_byte * 8u);
        
        // Set final padding bit at last byte (byte 135 = word 33, byte 3)
        create2_input[33] |= 0x80u << (3u * 8u);
        
        // Calculate CREATE2 address
        let address_hash = keccak256(&create2_input);
        
        // Score the address
        let score = scoreAddress(address_hash);
        
        // Only store results that actually improve the best score
        if (score > 0u) {
            // First check if it's worth trying (avoid unnecessary atomic operations)
            let current_best = atomicLoad(&best_score);
            if (score > current_best) {
                // Try to atomically update the best score
                let old_best = atomicMax(&best_score, score);
                
                // Only store if WE were the thread that actually improved the score
                // (i.e., the old value was actually less than our score)
                if (score > old_best) {
                    let result_index = atomicAdd(&result_count, 1u);
                    
                    if (result_index < max_results) {
                        let base_idx = result_index * 14u; // 1 score + 8 salt words + 5 address words
                        
                        results[base_idx] = score;
                        
                        // Store salt
                        for (var i: u32 = 0; i < 8u; i = i + 1u) {
                            results[base_idx + 1u + i] = salt[i];
                        }
                        
                        // Store address (last 20 bytes of hash)
                        // Extract the last 20 bytes (5 words) from the 32-byte hash
                        for (var i: u32 = 0; i < 5u; i = i + 1u) {
                            results[base_idx + 9u + i] = address_hash[i + 3u]; // Skip first 3 words (12 bytes)
                        }
                    }
                }
            }
        }
    } // End of nonce loop
} // End of main function
`;

export const miningShader = create2_mining_wgsl;

export function getMiningShader(): string {
  return create2_mining_wgsl;
}
