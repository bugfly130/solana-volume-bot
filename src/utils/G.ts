import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config()
const connection = process.env.RPC_CONNECTION || "";
export const SWAP_FEE = 0.005
export const SIMULATE_MODE = false
export type LogMode = "dev" | "pro"
export const LOG_MODE: LogMode = "dev"
export function log(...args: any) {
  if (LOG_MODE === "dev") console.log(...args);
  else return;
}
export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const conn = () => {
  return new Connection(connection);
}