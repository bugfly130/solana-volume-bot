import assert from 'assert';
import axios from 'axios';
import base58 from 'bs58';
import * as dotenv from 'dotenv';
import EventEmitter from 'events';
import * as fs from 'fs';
import moment from 'moment';

import { Metaplex } from '@metaplex-foundation/js';
import { ENV, TokenListProvider } from '@solana/spl-token-registry';
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import * as afx from './global';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SPL_ACCOUNT_LAYOUT } from '@raydium-io/raydium-sdk';
import { JITO_BUNDLE_TIP } from './uniconst';
import { getFeeInstruction, getJitoTipAccount } from './utils/jito';
import { conn } from './utils/G';
import AmmImpl from './amm';
import { raydiumSDKList } from './amm/constants';
import { initSdk } from './utils/sdkv2';
import { isPumpFun } from './pumpfun/pumpfun_swap';
dotenv.config();

export const getSOLPrice = async () => {
  try {
    const { solana } = await fetchAPI(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      'GET',
    );
    return solana.usd as number;
  } catch (error) {
    return 150;
  }
};

export const getTokenInfo = async (addr: string) => {
  const metaplex = Metaplex.make(afx.web3Conn);

  const mintAddress = new PublicKey(addr);

  const metadataAccount = metaplex.nfts().pdas().metadata({ mint: mintAddress });

  const metadataAccountInfo = await afx.web3Conn.getAccountInfo(metadataAccount);

  if (metadataAccountInfo) {
    const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
    if (token) {
      return { exist: true, symbol: token.mint.currency.symbol, decimal: token.mint.currency.decimals };
    } else {
      return { exist: false, symbol: '', decimal: 0 };
    }
  } else {
    const provider = await new TokenListProvider().resolve();
    const tokenList = provider.filterByChainId(ENV.MainnetBeta).getList();
    const tokenMap = tokenList.reduce((map, item) => {
      map.set(item.address, item);
      return map;
    }, new Map());

    const token = tokenMap.get(mintAddress.toBase58());

    if (token) {
      return { exist: true, symbol: token.mint.currency.symbol, decimal: token.mint.currency.decimals };
    } else {
      return { exist: false, symbol: '', decimal: 0 };
    }
  }
};

export const isValidAddress = (address: string) => {
  try {
    const publicKey = new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
};

export function isValidPrivateKey(privateKey: string) {
  try {
    const key = base58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(key);
    return true;
  } catch (error) {
    return false;
  }
}

export function getWalletFromPrivateKey(privateKey: string): any | null {
  try {
    const key: Uint8Array = base58.decode(privateKey);
    const keypair: Keypair = Keypair.fromSecretKey(key);

    const publicKey = keypair.publicKey.toBase58();
    const secretKey = base58.encode(keypair.secretKey);

    return { publicKey, secretKey, wallet: keypair };
  } catch (error) {
    return null;
  }
}

export const generateNewWallet = () => {
  try {
    const keypair: Keypair = Keypair.generate();

    const publicKey = keypair.publicKey.toBase58();
    const secretKey = base58.encode(keypair.secretKey);

    return { publicKey, secretKey };
  } catch (error) {
    return null;
  }
};

export const roundDecimal = (number: number, digits: number = 5) => {
  return number.toLocaleString('en-US', { maximumFractionDigits: digits });
};

export const roundDecimalWithUnit = (number: number, digits: number = 5, unit: string = '') => {
  if (!number) {
    return afx.NOT_ASSIGNED;
  }
  return number.toLocaleString('en-US', { maximumFractionDigits: digits }) + unit;
};


export const roundSolUnit = (number: number, digits: number = 5) => {
  if (Math.abs(number) >= 0.00001 || number === 0) {
    return `${roundDecimal(number, digits)} SOL`;
  }

  number *= 1000000000;

  return `${roundDecimal(number, digits)} lamports`;
};

export const roundBigUnit = (number: number, digits: number = 5) => {
  let unitNum = 0;
  const unitName = ['', 'K', 'M', 'B'];
  while (number >= 1000) {
    unitNum++;
    number /= 1000;

    if (unitNum > 2) {
      break;
    }
  }

  return `${roundDecimal(number, digits)} ${unitName[unitNum]}`;
};

export const shortenAddress = (address: string, length: number = 6) => {
  if (address.length < 2 + 2 * length) {
    return address; // Not long enough to shorten
  }

  const start = address.substring(0, length + 2);
  const end = address.substring(address.length - length);

  return start + '...' + end;
};

export const shortenString = (str: string, length: number = 8) => {
  if (length < 3) {
    length = 3;
  }

  if (!str) {
    return 'undefined';
  }

  if (str.length < length) {
    return str; // Not long enough to shorten
  }

  const temp = str.substring(0, length - 3) + '...';

  return temp;
};

export const limitString = (str: string, length: number = 8) => {
  if (length < 3) {
    length = 3;
  }

  if (!str) {
    return 'undefined';
  }

  if (str.length < length) {
    return str; // Not long enough to shorten
  }

  const temp = str.substring(0, length);

  return temp;
};

export const getTimeStringUTC = (timestamp: Date) => {
  const options: any = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZone: 'UTC',
  };

  const formattedDate = timestamp.toLocaleString('en-US', options);

  return formattedDate;
};

export const getTimeStringFormat = (timestamp: number) => {
  let date = new Date(timestamp);
  let year = date.getFullYear();
  let month = String(date.getMonth() + 1).padStart(2, '0');
  let day = String(date.getDate()).padStart(2, '0');
  let hours = String(date.getHours()).padStart(2, '0');
  let minutes = String(date.getMinutes()).padStart(2, '0');
  // let seconds = String(date.getSeconds()).padStart(2, '0');

  // return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

export const getTimeStringUTCFromNumber = (timestamp: number) => {
  try {
    return getTimeStringUTC(new Date(timestamp));
  } catch (error) { }

  return 'None';
};

export const fetchAPI = async (
  url: string,
  method: 'GET' | 'POST',
  data: Record<string, any> = {},
): Promise<any | null> => {
  return new Promise((resolve) => {
    if (method === 'POST') {
      axios
        .post(url, data)
        .then((response) => {
          let json = response.data;
          resolve(json);
        })
        .catch((error) => {
          resolve(null);
        });
    } else {
      axios
        .get(url)
        .then((response) => {
          let json = response.data;
          resolve(json);
        })
        .catch((error) => {
          resolve(null);
        });
    }
  });
};

export const addressToHex = (address: string) => {
  const hexString = '0x' + address.slice(2).toLowerCase().padStart(64, '0');
  return hexString.toLowerCase();
};

export const createDirectoryIfNotExists = (directoryPath: string) => {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath);
    // console.log(`The directory '${directoryPath}' has been created.`);
  } else {
  }
};

export const getShortenedAddress = (address: string) => {
  if (!address) {
    return '';
  }

  let str = address.slice(0, 24) + '...';

  return str;
};

export function waitForEvent(eventEmitter: EventEmitter, eventName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    eventEmitter.on(eventName, resolve);
  });
}

export async function waitSeconds(seconds: number) {
  const eventEmitter = new EventEmitter();

  setTimeout(() => {
    eventEmitter.emit('TimeEvent');
  }, seconds * 1000);

  await waitForEvent(eventEmitter, 'TimeEvent');
}

export async function waitMilliseconds(ms: number) {
  const eventEmitter = new EventEmitter();

  setTimeout(() => {
    eventEmitter.emit('TimeEvent');
  }, ms);

  await waitForEvent(eventEmitter, 'TimeEvent');
}

export const getFullTimeElapsedFromSeconds = (totalSecs: number) => {
  if (totalSecs < 0) {
    totalSecs = 0;
  }

  let sec = 0,
    min = 0,
    hour = 0,
    day = 0;

  sec = totalSecs;
  if (sec > 60) {
    min = Math.floor(sec / 60);
    sec = sec % 60;
  }

  if (min > 60) {
    hour = Math.floor(min / 60);
    min = min % 60;
  }

  if (hour > 24) {
    day = Math.floor(hour / 24);
    hour = hour % 60;
  }

  let timeElapsed = '';

  if (day > 0) {
    timeElapsed += `${day}d`;
  }

  if (hour > 0) {
    if (timeElapsed !== '') {
      timeElapsed += ' ';
    }

    timeElapsed += `${hour}h`;
  }

  if (min > 0) {
    if (timeElapsed !== '') {
      timeElapsed += ' ';
    }

    timeElapsed += `${min}m`;
  }

  if (sec > 0) {
    if (timeElapsed !== '') {
      timeElapsed += ' ';
    }

    timeElapsed += `${sec}s`;
  }

  return timeElapsed;
};

export const getFullMinSecElapsedFromSeconds = (totalSecs: number) => {
  let sec = 0,
    min = 0,
    hour = 0,
    day = 0;

  sec = totalSecs;
  if (sec > 60) {
    min = Math.floor(sec / 60);
    sec = sec % 60;
  }

  let timeElapsed = `${min}:${sec}`;

  return timeElapsed;
};

export const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const getDateTimeFromTimestamp = (timestmp: number) => {
  const value = new Date(timestmp);
  let month = (value.getMonth() + 1).toString();
  let day = value.getDate().toString();
  let year = value.getFullYear().toString();

  return `${month}/${day}/${year}`;
};

export const getConfigString_Default = (
  value: string,
  defaultValue: string,
  unit: string = '',
  prefix: string = '',
  digit: number = 9,
) => {
  let output;

  const value2 = typeof value === 'number' ? roundDecimal(value, digit) : value;

  let temp;
  if (unit === 'USD') {
    temp = `$${value2}`;
  } else if (unit === '%') {
    temp = `${value2}%`;
  } else {
    temp = `${value2}${unit.length > 0 ? ' ' + unit : ''}`;
  }

  if (value === defaultValue) {
    output = `Default (${prefix}${temp})`;
  } else {
    output = `${prefix}${temp}`;
  }

  return output;
};

export const getConfigString_Text = (
  text: string,
  value: number,
  autoValue: number,
  unit: string = '',
  digit: number = 9,
) => {
  let output;

  if (value === autoValue) {
    output = text;
  } else {
    const value2 = typeof value === 'number' ? roundDecimal(value, digit) : value;
    if (unit === 'USD') {
      output = `$${value2}`;
    } else if (unit === '%') {
      output = `${value2}%`;
    } else {
      output = `${value2}${unit.length > 0 ? ' ' + unit : ''}`;
    }
  }

  return output;
};

export const getConfigString_Checked = (value: number) => {
  let output: string;

  if (value === 2) {
    output = '🌐';
  } else if (value === 1) {
    output = '✅';
  } else {
    output = '❌';
  }

  return output;
};

export const getConfigWallet_Checked = (value: number) => {
  let output;

  if (value === 1) {
    output = '✅';
  } else {
    output = '';
  }

  return output;
};

export function objectDeepCopy(obj: any, keysToExclude: string[] = []): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj; // Return non-objects as is
  }

  const copiedObject: Record<string, any> = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !keysToExclude.includes(key)) {
      copiedObject[key] = obj[key];
    }
  }

  return copiedObject;
}

export const nullWalk = (val: any) => {
  if (!val) {
    return afx.NOT_ASSIGNED;
  }

  return val;
};

const ReferralCodeBase = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function encodeChatId(chatId: string) {
  const baseLength = ReferralCodeBase.length;

  let temp = Number(chatId);
  let encoded = '';
  while (temp > 0) {
    const remainder = temp % baseLength;
    encoded = ReferralCodeBase[remainder] + encoded;
    temp = Math.floor(temp / baseLength);
  }

  // Pad with zeros to make it 5 characters
  return encoded.padStart(5, '0');
}

export function decodeChatId(encoded: string) {
  const baseLength = ReferralCodeBase.length;

  let decoded = 0;
  const reversed = encoded.split('').reverse().join('');

  for (let i = 0; i < reversed.length; i++) {
    const char = reversed[i];
    const charValue = ReferralCodeBase.indexOf(char);
    decoded += charValue * Math.pow(baseLength, i);
  }

  return decoded.toString();
}

export const getCurrentTimeTick = (ms: boolean = false) => {
  if (ms) {
    return new Date().getTime();
  }

  return Math.floor(new Date().getTime() / 1000);
};

export const getWalletSOLBalance = async (wallet: any): Promise<number> => {
  assert(afx.web3Conn);
  try {
    let balance: number = (await afx.web3Conn.getBalance(new PublicKey(wallet.publicKey))) / LAMPORTS_PER_SOL;
    return balance;
  } catch (error) {
    console.log(error);
  }

  return 0;
};

export const getTokenData = async (tokenAddress: string, wallet: Keypair) => {
  try {
    const response: any = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const tokenData = response.data;
    // console.log(tokenData);
    if (tokenData.pairs === null) {
      let pairItem: any = {};

      //check old meteora amm pool
      const res = await AmmImpl.searchPoolsByToken(afx.web3Conn, new PublicKey(tokenAddress))
      for (let i = 0; i < res.length; i++) {
        const totalLockedLp = res[i].account.totalLockedLp;
        if ((res[i].account.tokenAMint.toString() == "So11111111111111111111111111111111111111112" || res[i].account.tokenBMint.toString() == "So11111111111111111111111111111111111111112") && Number(totalLockedLp) > 0) {
          pairItem.dexId = 'meteora';
          pairItem.labels = ['DYN'];
          pairItem.pairAddress = res[i].publicKey;

          return { result: true, data: [pairItem] };
        }
      }

      //check pump.fun pool
      const isFlag = await isPumpFun(wallet, tokenAddress);
      if (isFlag) {
        pairItem.dexId = 'pumpfun';
        pairItem.labels = [''];
        pairItem.pairAddress = '';

        return { result: true, data: [pairItem] };
      }

      return { result: false, data: [] };
    }

    let pumpfunPairItems: any = [];
    if (tokenData.pairs.length === 1) {
      let pair = tokenData.pairs[0];
      if (pair.dexId === "pumpfun") {
        pair.labels = [""];
        pumpfunPairItems.push(pair);
      }
    }
    else {
      for (let i = 0; i < tokenData.pairs.length; i++) {
        let pair = tokenData.pairs[i];
        if (pair.dexId.toLowerCase() == "pumpswap") {
          pair.labels = [""];
          pumpfunPairItems.push(pair);
        }
      }
    }

    let raydiumPairItems: any = [];
    for (let i = 0; i < tokenData.pairs.length; i++) {
      let pair = tokenData.pairs[i];
      if (pair.dexId.toLowerCase() === "raydium") {
        let label = "AMM";
        if (pair.labels && pair.labels.length > 0)
          label = pair.labels[0];
        let isFind = false;
        for (let j = 0; j < raydiumPairItems.length; j++) {
          if (raydiumPairItems[j].labels[0] === label) {
            isFind = true;
            break;
          }
        }

        if (!isFind) {
          if (label === "AMM") {
            pair.labels = ["AMM"];
          }
          raydiumPairItems.push(pair);
        }
      }
    }

    let meteoraPairItems: any = [];
    for (let i = 0; i < tokenData.pairs.length; i++) {
      const pair = tokenData.pairs[i];
      if (pair.dexId.toLowerCase() == "meteora" && pair.labels && pair.labels.length > 0) {
        const label = pair.labels[0];
        let isFind = false;
        for (let j = 0; j < meteoraPairItems.length; j++) {
          if (meteoraPairItems[j].labels[0] === label) {
            isFind = true;
            break;
          }
        }

        if (!isFind)
          meteoraPairItems.push(pair);
      }
    }

    // const pairItems: any = [...meteoraPairItems];
    const pairItems: any = [...pumpfunPairItems, ...raydiumPairItems, ...meteoraPairItems];

    if (!pairItems) return { result: false, data: [] };
    // console.log('❓ Token Data:', pairItems);
    return { result: true, data: pairItems };
  } catch (error) {
    console.error('Error fetching token data:', error);
    return { result: false, data: [] };
  }
};

export const getTokenDatawithPairaddress = async (tokenAddress: string, pairAddress: string, wallet: Keypair) => {
  try {
    const response: any = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const tokenData = response.data;
    if (tokenData.pairs === null) {
      const res = await AmmImpl.searchPoolsByToken(afx.web3Conn, new PublicKey(tokenAddress))

      let pairItem: any = {};
      for (let i = 0; i < res.length; i++) {
        const totalLockedLp = res[i].account.totalLockedLp;
        if ((res[i].account.tokenAMint.toString() == "So11111111111111111111111111111111111111112" || res[i].account.tokenBMint.toString() == "So11111111111111111111111111111111111111112") && Number(totalLockedLp) > 0) {
          pairItem.dexId = 'meteora';
          pairItem.labels = ['DYN'];
          pairItem.pairAddress = res[i].publicKey;

          return { result: true, data: pairItem };
        }
      }

      //check pump.fun pool
      const isFlag = await isPumpFun(wallet, tokenAddress);
      if (isFlag) {
        pairItem.dexId = 'pumpfun';
        pairItem.labels = [''];
        pairItem.pairAddress = '';

        return { result: true, data: pairItem };
      }

      return { result: false, data: [] };
    }

    const pairItem = tokenData.pairs.find((item: any) => item.pairAddress == pairAddress);
    // console.log(pairAddress, pairItem);
    return { result: true, data: pairItem };
  } catch (error) {
    console.error('Error fetching token data:', error);
    return { result: false, data: [] };
  }
};

export const getTimeDifference = (timestamp: number): string => {
  const now = moment(); // Get the current time
  const createdTime = moment(timestamp); // Convert the timestamp to a moment object

  // console.log("now:", now);
  // console.log("createdTime:", createdTime);

  // Get the difference in days, hours, and minutes
  const duration = moment.duration(now.diff(createdTime));

  const days = Math.floor(duration.asDays());
  const hours = duration.hours();
  const minutes = duration.minutes();

  return `${days} days, ${hours} hours, ${minutes} minutes`;
};

export const formatNumber = (value: number): string => {
  try {
    if (value >= 1_000_000) {
      return (value / 1_000_000).toFixed(2) + 'M';
    } else if (value >= 1_000) {
      return (value / 1_000).toFixed(2) + 'K';
    } else {
      return value.toString();
    }
  }
  catch (err) {
    return '-';
  }
};

export const getRandomValue = (min: number = 60, max: number = 90): number => {
  const result = Math.floor(Math.random() * (max - min + 1)) + min;
  return result;
};

export const IsTokenAccountInWallet = async (wallet: any, addr: string) => {
  const walletTokenAccount = await afx.web3Conn.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });

  for (let item of walletTokenAccount.value) {
    const accountInfo = SPL_ACCOUNT_LAYOUT.decode(item.account.data);
    if (accountInfo.mint.toString() == addr) {
      return true;
    }
  }
  return false;
};

export const getCreateAccountTransaction = async (payer: Keypair, addr: string) => {
  const jitoInst = await getFeeInstruction(
    payer.publicKey,
    new PublicKey(getJitoTipAccount().jitoAccount),
    JITO_BUNDLE_TIP,
  );
  if (!jitoInst) return null;

  const associatedToken = getAssociatedTokenAddressSync(
    new PublicKey(addr),
    payer.publicKey,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const transaction = new Transaction().add(
    jitoInst,
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      associatedToken,
      payer.publicKey,
      new PublicKey(addr),
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );
  const recentBlockhashForSwap = await conn().getLatestBlockhash('finalized');
  const instructions = transaction.instructions;

  const versionedTransaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: recentBlockhashForSwap.blockhash,
      instructions: instructions,
    }).compileToV0Message(),
  );

  versionedTransaction.sign([payer]);

  return versionedTransaction;
};

export function randomDivide(tokenAmount: number, numWallets: number) {
  let walletAmounts: number[] = [];
  let remainingAmount = tokenAmount;

  for (let i = 0; i < numWallets - 1; i++) {
    let randomAmount = Math.floor(Math.random() * remainingAmount);
    walletAmounts.push(randomAmount);
    remainingAmount -= randomAmount;
  }
  walletAmounts.push(remainingAmount); // Add the remaining amount to the last wallet

  return walletAmounts;
}

const addRaydiumSDK = async (publicKey: PublicKey) => {
  const raydium = raydiumSDKList.get(publicKey.toString());

  if (raydium) {
    return;
  }

  const newRaydium = await initSdk(afx.web3Conn);
  newRaydium.setOwner(publicKey);
  raydiumSDKList.set(publicKey.toString(), newRaydium);
};

export async function initSDKs(mainWallet: PublicKey) {
  await addRaydiumSDK(mainWallet);

  //maybe add childwallets
}