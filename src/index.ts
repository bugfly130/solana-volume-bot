import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import * as bot from './bot';
import * as afx from './global';
dotenv.config()

//@ts-ignore
const conn: Connection = new Connection(process.env.RPC_CONNECTION, "confirmed");

afx.setWeb3(conn)

bot.init()
bot.sessionInit()


