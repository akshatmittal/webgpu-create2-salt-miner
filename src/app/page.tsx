import { Create2Miner } from "@/components/Create2Miner";
import dynamic from "next/dynamic";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Create2Miner />
    </div>
  );
}
