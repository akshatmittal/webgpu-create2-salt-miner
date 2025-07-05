// CREATE2-specific test cases for GPU validation
export interface Create2TestCase {
  deployer: `0x${string}`;
  salt: `0x${string}`;
  bytecodeHash: `0x${string}`;
  description: string;
}

export const CREATE2_TEST_CASES: Create2TestCase[] = [
  {
    deployer: "0x0000000000000000000000000000000000000000",
    salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    bytecodeHash: "0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a",
    description: 'Zero deployer, zero salt, keccak256("00") bytecode hash',
  },
  {
    deployer: "0x1234567890123456789012345678901234567890",
    salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    bytecodeHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    description: "Real deployer, zero salt, custom bytecode hash",
  },
  {
    deployer: "0x5555555555555555555555555555555555555555",
    salt: "0x1111111111111111111111111111111111111111111111111111111111111111",
    bytecodeHash: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    description: 'Real deployer, real salt, keccak256("") bytecode hash',
  },
  {
    deployer: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    salt: "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",
    bytecodeHash: "0x8b1a944cf13a9a1c08facb2c9e98623ef3254d2ddb48113885c3e8e97fec8db9",
    description: 'Real deployer, real salt, keccak256("ff") bytecode hash',
  },
  {
    deployer: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    salt: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    bytecodeHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890acdef1",
    description: "vitalik.eth deployer, custom salt, custom bytecode hash",
  },
];

// Helper function to construct the CREATE2 input data
export function constructCreate2Input(testCase: Create2TestCase): string {
  // CREATE2 input format: 0xff + deployer (20 bytes) + salt (32 bytes) + bytecodeHash (32 bytes)
  const prefix = "ff";
  const deployer = testCase.deployer.slice(2); // Remove 0x prefix
  const salt = testCase.salt.slice(2); // Remove 0x prefix
  const bytecodeHash = testCase.bytecodeHash.slice(2); // Remove 0x prefix

  return prefix + deployer + salt + bytecodeHash;
}

export type TestCase = Create2TestCase;
