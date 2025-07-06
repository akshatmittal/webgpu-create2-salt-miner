import { getContractAddress } from "viem";

import { keccak256_gpu, gpu_reinit } from "./index";
import { CREATE2_TEST_CASES, constructCreate2Input } from "./test-cases";

export async function validateGPUImplementation() {
  console.log("🧪 === Final GPU CREATE2 Validation Test ===");

  // Initialize GPU
  await gpu_reinit();

  let allMatched = true;

  for (const testCase of CREATE2_TEST_CASES) {
    try {
      console.log(`\n🔍 Testing: ${testCase.description}`);
      console.log(`   Deployer: ${testCase.deployer}`);
      console.log(`   Salt: ${testCase.salt}`);
      console.log(`   Bytecode Hash: ${testCase.bytecodeHash}`);

      // Get expected CREATE2 address using viem's getContractAddress
      const expectedAddress = getContractAddress({
        from: testCase.deployer,
        salt: testCase.salt,
        bytecodeHash: testCase.bytecodeHash,
        opcode: "CREATE2",
      });

      // Get GPU result by hashing the CREATE2 input
      const create2Input = constructCreate2Input(testCase);
      const gpuHashResult = await keccak256_gpu(create2Input);

      // Extract the address from the GPU hash (last 20 bytes)
      const gpuAddress = "0x" + gpuHashResult.slice(-40);

      const matches = gpuAddress.toLowerCase() === expectedAddress.toLowerCase();

      console.log(`   GPU Address:      ${gpuAddress}`);
      console.log(`   Expected Address: ${expectedAddress}`);
      console.log(`   ${matches ? "✅ PERFECT MATCH" : "❌ MISMATCH"}`);

      if (!matches) {
        allMatched = false;
        console.log(`   🔧 Debug info:`);
        console.log(`      CREATE2 input: ${create2Input}`);
        console.log(`      GPU hash:      ${gpuHashResult}`);
      }
    } catch (error) {
      console.error(`❌ Error testing "${testCase.description}":`, error);
      allMatched = false;
    }
  }

  console.log("\n🏁 === FINAL CREATE2 RESULT ===");
  if (allMatched) {
    console.log("🎉 GPU CREATE2 IMPLEMENTATION IS WORKING PERFECTLY!");
    console.log("🚀 All CREATE2 test cases match Viem exactly!");
    console.log("✅ Ready for production CREATE2 mining!");
  } else {
    console.log("❌ GPU CREATE2 implementation has issues");
    console.log("🔧 Check the debug info above for details");
  }

  return allMatched;
}
