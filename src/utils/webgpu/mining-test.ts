import { CREATE2Miner, MiningParams } from "./mining";
import { getContractAddress } from "viem";

// Add debug function to test specific salt values
export async function debugCreate2Calculation() {
  console.log("=== CREATE2 Debug Test ===");

  const testParams = {
    userAddress: "0x742d35Cc6634C0532925a3b8D84A7dd2C6F4c80A",
    factoryAddress: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    bytecodeHash: "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
  };

  // Test with a known salt value
  const testSalt = "0x742d35cc6634c0532925a3b8d84a7dd2c6f4c80a3f81d9f4af46fc580000012d";

  console.log("Factory:", testParams.factoryAddress);
  console.log("Salt:", testSalt);
  console.log("Bytecode Hash:", testParams.bytecodeHash);

  // Calculate expected address using viem
  const expectedAddress = getContractAddress({
    from: testParams.factoryAddress as `0x${string}`,
    salt: testSalt as `0x${string}`,
    bytecodeHash: testParams.bytecodeHash as `0x${string}`,
    opcode: "CREATE2",
  });

  console.log("Expected address (viem):", expectedAddress);

  // Show CREATE2 input construction
  const create2Input =
    "0xff" + testParams.factoryAddress.slice(2) + testSalt.slice(2) + testParams.bytecodeHash.slice(2);

  console.log("CREATE2 input:", create2Input);
  console.log("Input length:", create2Input.length, "chars,", (create2Input.length - 2) / 2, "bytes");

  // Test hex conversion functions
  console.log("\n=== Testing Hex Conversion Functions ===");

  // Test with the expected address - recreate the conversion logic
  console.log("Original address:", expectedAddress);

  // Recreate hexToUint32Array logic
  const cleanHex = expectedAddress.slice(2); // Remove 0x
  const paddedHex = cleanHex.padStart(Math.ceil(cleanHex.length / 8) * 8, "0");
  const uint32Array = new Uint32Array(paddedHex.length / 8);

  for (let i = 0; i < uint32Array.length; i++) {
    const hexChunk = paddedHex.slice(i * 8, (i + 1) * 8);
    const byte0 = parseInt(hexChunk.slice(0, 2), 16);
    const byte1 = parseInt(hexChunk.slice(2, 4), 16);
    const byte2 = parseInt(hexChunk.slice(4, 6), 16);
    const byte3 = parseInt(hexChunk.slice(6, 8), 16);
    uint32Array[i] = byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24);
  }

  console.log("Converted to uint32 array:", uint32Array);

  // Recreate addressFromUint32Array logic
  let backToHex = "0x";
  for (let i = 0; i < Math.min(uint32Array.length, 5); i++) {
    const word = uint32Array[i];
    const byte0 = word & 0xff;
    const byte1 = (word >> 8) & 0xff;
    const byte2 = (word >> 16) & 0xff;
    const byte3 = (word >> 24) & 0xff;

    backToHex += byte0.toString(16).padStart(2, "0");
    backToHex += byte1.toString(16).padStart(2, "0");
    backToHex += byte2.toString(16).padStart(2, "0");
    backToHex += byte3.toString(16).padStart(2, "0");
  }
  backToHex = backToHex.slice(0, 42); // Take only first 42 chars

  console.log("Converted back to address:", backToHex);
  console.log("Round-trip match:", expectedAddress.toLowerCase() === backToHex.toLowerCase());

  return expectedAddress;
}

export async function testMiningSystem() {
  console.log("=== CREATE2 Mining System Test ===");

  // Test parameters
  const testParams: MiningParams = {
    userAddress: "0x742d35Cc6634C0532925a3b8D84A7dd2C6F4c80A",
    factoryAddress: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    bytecodeHash: "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
    targetZeros: 1, // Start with a low target for testing
    maxResults: 5,
    workgroupSize: 256, // Reduced since each thread now does 1024x more work
  };

  console.log("Test parameters:", testParams);

  // Run debug test first
  await debugCreate2Calculation();

  try {
    // Initialize miner
    const miner = new CREATE2Miner();
    console.log("Initializing miner...");
    await miner.init();
    console.log("✅ Miner initialized successfully");

    // Start mining for a short time to test the system
    console.log("Starting mining test...");

    // Mine for 3 seconds then stop
    const miningPromise = miner.mine(testParams);

    setTimeout(() => {
      console.log("Stopping mining test...");
      miner.stop();
    }, 3000);

    const results = await miningPromise;
    console.log(`✅ Mining test completed, found ${results.length} results`);

    // Validate results
    let validationPassed = true;

    for (let i = 0; i < Math.min(results.length, 3); i++) {
      const result = results[i];
      console.log(`\nValidating result ${i + 1}:`);
      console.log(`  Score: ${result.score}`);
      console.log(`  Zeros: ${result.zeros}`);
      console.log(`  Salt: ${result.salt}`);
      console.log(`  Address: ${result.address}`);

      // Validate with viem
      try {
        const expectedAddress = getContractAddress({
          from: testParams.factoryAddress as `0x${string}`,
          salt: result.salt as `0x${string}`,
          bytecodeHash: testParams.bytecodeHash as `0x${string}`,
          opcode: "CREATE2",
        });

        const addressMatch = result.address.toLowerCase() === expectedAddress.toLowerCase();
        console.log(`  Expected: ${expectedAddress}`);
        console.log(`  Match: ${addressMatch ? "✅" : "❌"}`);

        if (!addressMatch) {
          validationPassed = false;
        }

        // Check if salt has correct structure
        const saltHex = result.salt.slice(2); // Remove 0x
        const userAddressPart = saltHex.slice(0, 40); // First 20 bytes (bytes 0-19)
        const randomNoncePart = saltHex.slice(40, 48); // Next 4 bytes (bytes 20-23)
        const threadIdPart = saltHex.slice(48, 56); // Next 4 bytes (bytes 24-27)
        const loopCounterPart = saltHex.slice(56, 64); // Last 4 bytes (bytes 28-31)

        const expectedUserAddress = testParams.userAddress.slice(2).toLowerCase();

        const userAddressMatch = userAddressPart.toLowerCase() === expectedUserAddress;
        console.log(`  User address in salt: ${userAddressMatch ? "✅" : "❌"}`);
        console.log(`  Salt structure:`);
        console.log(`    User address: ${userAddressPart}`);
        console.log(`    Random nonce: ${randomNoncePart}`);
        console.log(`    Thread ID: ${threadIdPart}`);
        console.log(`    Loop counter: ${loopCounterPart}`);

        if (!userAddressMatch) {
          validationPassed = false;
        }

        // Check leading zeros (score should match actual leading zeros)
        const actualZeros = countLeadingZeros(result.address);
        const expectedScore = calculateScore(result.address);

        console.log(
          `  Leading zeros: ${actualZeros} chars, expected score: ${expectedScore}, actual score: ${result.score}`,
        );
        console.log(`  Score validation: ${result.score === expectedScore ? "✅" : "❌"}`);

        if (result.score !== expectedScore) {
          validationPassed = false;
        }
      } catch (error) {
        console.error(`  ❌ Validation error: ${error}`);
        validationPassed = false;
      }
    }

    console.log(`\n=== Mining System Test Summary ===`);
    console.log(`Results found: ${results.length}`);
    console.log(`Validation: ${validationPassed ? "✅ PASSED" : "❌ FAILED"}`);

    if (validationPassed) {
      console.log("🎉 CREATE2 Mining System is working correctly!");
      console.log("🚀 Ready for production use!");
    } else {
      console.log("❌ Mining system needs debugging");
    }

    return validationPassed;
  } catch (error) {
    console.error("❌ Mining system test failed:", error);
    return false;
  }
}

function countLeadingZeros(address: string): number {
  const hex = address.slice(2); // Remove 0x prefix
  let count = 0;

  for (let i = 0; i < hex.length; i++) {
    if (hex[i] === "0") {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function calculateScore(address: string): number {
  // Match the shader's scoring logic exactly
  const hex = address.slice(2); // Remove 0x prefix
  let score = 0;

  console.log(`  Calculating score for: ${address}`);
  console.log(`  Hex chars: ${hex}`);

  for (let i = 0; i < hex.length; i += 2) {
    const byteStr = hex.slice(i, i + 2);
    const byteVal = parseInt(byteStr, 16);

    console.log(`    Byte ${i / 2}: ${byteStr} (0x${byteVal.toString(16)})`);

    if (byteVal === 0) {
      score += 2; // 2 points for zero byte
      console.log(`      Zero byte: +2, score now ${score}`);
    } else {
      const highNibble = (byteVal >> 4) & 0xf;
      console.log(`      Non-zero byte, high nibble: 0x${highNibble.toString(16)}`);

      if (highNibble === 0) {
        score += 1; // 1 point for zero high nibble
        console.log(`      Zero high nibble: +1, score now ${score}`);
      }

      // Stop at first non-zero nibble
      console.log(`      Stopping at first non-zero nibble, final score: ${score}`);
      break;
    }
  }

  return score;
}

// Export for use in components
export { countLeadingZeros };
