"use client";

import { useState, useEffect, useRef } from "react";

import Link from "next/link";

import { CREATE2Miner, MiningParams, MiningStats } from "@/utils/webgpu/mining";

export function Create2Miner() {
  const [miningParams, setMiningParams] = useState<MiningParams>({
    userAddress: "0x0000000000000000000000000000000000000000",
    factoryAddress: "0x0000000000000000000000000000000000000000",
    bytecodeHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    targetZeros: 6,
    maxResults: 10,
    workgroupSize: 1024,
  });

  const [stats, setStats] = useState<MiningStats>({
    totalAttempts: 0,
    hashRate: 0,
    bestScore: 0,
    results: [],
    isRunning: false,
    currentThreshold: 0,
    iterationsCompleted: 0,
  });

  const [error, setError] = useState<string>("");
  const [isValid, setIsValid] = useState(false);
  const [isTestingSystem, setIsTestingSystem] = useState(false);
  const minerRef = useRef<CREATE2Miner | null>(null);

  // Validate inputs
  useEffect(() => {
    const isAddressValid = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr);
    const isHashValid = (hash: string) => /^0x[a-fA-F0-9]{64}$/.test(hash);

    const valid =
      isAddressValid(miningParams.userAddress) &&
      isAddressValid(miningParams.factoryAddress) &&
      isHashValid(miningParams.bytecodeHash) &&
      miningParams.targetZeros > 0 &&
      miningParams.targetZeros <= 20;

    setIsValid(valid);
  }, [miningParams]);

  const handleInputChange = (field: keyof MiningParams, value: string | number) => {
    setMiningParams((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const startMining = async () => {
    if (!isValid) return;

    setError("");
    try {
      minerRef.current = new CREATE2Miner(setStats);
      await minerRef.current.init();

      // Start mining in background
      minerRef.current.mine(miningParams).catch((err) => {
        setError(err.message || "Mining failed");
      });
    } catch (err: any) {
      setError(err.message || "Failed to start mining");
    }
  };

  const stopMining = () => {
    if (minerRef.current) {
      minerRef.current.stop();
    }
  };

  const formatHashRate = (rate: number) => {
    if (rate > 1000000) return `${(rate / 1000000).toFixed(1)}M H/s`;
    if (rate > 1000) return `${(rate / 1000).toFixed(1)}K H/s`;
    return `${rate.toFixed(0)} H/s`;
  };

  const formatAddress = (addr: string) => {
    return addr;
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "text-purple-600";
    if (score >= 6) return "text-blue-600";
    if (score >= 4) return "text-green-600";
    if (score >= 2) return "text-yellow-600";
    return "text-gray-600";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="rounded-lg bg-white p-6 shadow-lg">
        <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold text-gray-800">
          ⚡ WebGPU Create2 Salt Miner
          <span className="rounded bg-blue-100 px-2 py-1 text-sm text-blue-800">GPU Accelerated</span>
        </h1>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Input Form */}
          <div className="space-y-4">
            <h2 className="mb-4 text-xl font-semibold text-gray-700">Mining Parameters</h2>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                User Address (will be first 20 bytes of salt)
              </label>
              <input
                type="text"
                placeholder="0x742d35Cc6634C0532925a3b8D84A7dd2C6F4c80A"
                value={miningParams.userAddress}
                onChange={(e) => handleInputChange("userAddress", e.target.value)}
                className="w-full rounded-md border border-gray-300 p-3 font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Factory Address (CREATE2 deployer)</label>
              <input
                type="text"
                placeholder="0x4e59b44847b379578588920cA78FbF26c0B4956C"
                value={miningParams.factoryAddress}
                onChange={(e) => handleInputChange("factoryAddress", e.target.value)}
                className="w-full rounded-md border border-gray-300 p-3 font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Bytecode Hash (keccak256 of contract initcode)
              </label>
              <input
                type="text"
                placeholder="0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a"
                value={miningParams.bytecodeHash}
                onChange={(e) => handleInputChange("bytecodeHash", e.target.value)}
                className="w-full rounded-md border border-gray-300 p-3 font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Target Leading Zero Bytes</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={miningParams.targetZeros}
                  onChange={(e) => handleInputChange("targetZeros", parseInt(e.target.value))}
                  className="w-full rounded-md border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Max Results</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={miningParams.maxResults}
                  onChange={(e) => handleInputChange("maxResults", parseInt(e.target.value))}
                  className="w-full rounded-md border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                GPU Workgroup Size (higher = faster, but uses more memory)
              </label>
              <select
                value={miningParams.workgroupSize}
                onChange={(e) => handleInputChange("workgroupSize", parseInt(e.target.value))}
                className="w-full rounded-md border border-gray-300 p-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              >
                <option value={1024}>1K (Low)</option>
                <option value={4096}>4K (Medium)</option>
                <option value={16384}>16K (High)</option>
                <option value={65536}>64K (Very High)</option>
              </select>
            </div>

            <div className="flex gap-4">
              <button
                onClick={startMining}
                disabled={!isValid || stats.isRunning}
                className={`flex-1 rounded-md px-6 py-3 font-medium transition-colors ${
                  !isValid || stats.isRunning
                    ? "cursor-not-allowed bg-gray-300 text-gray-500"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {stats.isRunning ? "Mining..." : "Start Mining"}
              </button>

              <button
                onClick={stopMining}
                disabled={!stats.isRunning}
                className={`rounded-md px-6 py-3 font-medium transition-colors ${
                  !stats.isRunning
                    ? "cursor-not-allowed bg-gray-300 text-gray-500"
                    : "bg-red-600 text-white hover:bg-red-700"
                }`}
              >
                Stop
              </button>
            </div>

            {/* <div className="mt-4">
              <button
                onClick={runSystemTest}
                disabled={isTestingSystem || stats.isRunning}
                className={`w-full rounded-md px-4 py-2 font-medium transition-colors ${
                  isTestingSystem || stats.isRunning
                    ? "cursor-not-allowed bg-gray-300 text-gray-500"
                    : "bg-purple-600 text-white hover:bg-purple-700"
                }`}
              >
                {isTestingSystem ? "Running Test..." : "🧪 Test Mining System"}
              </button>
            </div> */}

            {error && <div className="rounded-md border border-red-400 bg-red-100 p-4 text-red-700">{error}</div>}
          </div>

          {/* Mining Stats */}
          <div className="space-y-4">
            <h2 className="mb-4 text-xl font-semibold text-gray-700">Mining Statistics</h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-sm text-gray-600">Total Attempts</div>
                <div className="text-2xl font-bold text-gray-800">{stats.totalAttempts.toLocaleString()}</div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-sm text-gray-600">Hash Rate</div>
                <div className="text-2xl font-bold text-gray-800">{formatHashRate(stats.hashRate)}</div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-sm text-gray-600">Best Score</div>
                <div className={`text-2xl font-bold ${getScoreColor(stats.bestScore)}`}>
                  {stats.bestScore} ({Math.floor(stats.bestScore / 2)} zero bytes)
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-sm text-gray-600">Results Found</div>
                <div className="text-2xl font-bold text-gray-800">{stats.results.length}</div>
              </div>
            </div>

            <div className="rounded-lg bg-green-50 p-4">
              <p className="text-sm">This is experimental software. Please see GitHub for details.</p>
            </div>

            <div className="flex gap-2 rounded-lg bg-green-50 p-4">
              <Link
                href="https://github.com/akshatmittal/webgpu-create2-salt-miner"
                target="_blank"
              >
                <img
                  className="rounded-md"
                  src="https://img.shields.io/badge/GitHub-181717.svg?logo=GitHub&logoColor=white"
                />
              </Link>
              <Link
                href="https://x.com/iakshatmittal"
                target="_blank"
              >
                <img
                  className="rounded-md"
                  src="https://img.shields.io/badge/iakshatmittal-000000.svg?logo=X&logoColor=white"
                />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {stats.results.length > 0 && (
        <div className="rounded-lg bg-white p-6 shadow-lg">
          <h2 className="mb-4 text-xl font-semibold text-gray-700">Mining Results ({stats.results.length})</h2>

          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Rank</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Score</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Address</th>
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Salt</th>
                </tr>
              </thead>
              <tbody>
                {stats.results.map((result, index) => (
                  <tr
                    key={index}
                    className="border-t hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 text-sm text-gray-600">#{index + 1}</td>
                    <td className={`px-4 py-2 text-sm font-medium ${getScoreColor(result.score)}`}>{result.score}</td>
                    <td className="px-4 py-2 font-mono text-sm text-gray-800">
                      <span title={result.address}>{formatAddress(result.address)}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm text-gray-800">
                      <span title={result.salt}>{formatAddress(result.salt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
