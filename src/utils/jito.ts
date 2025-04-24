import {
  Blockhash,
  Finality,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as G from './G';
import fs from 'fs';
import base58 from 'bs58';
import { SIMULATE_MODE } from './G';
import axios from 'axios';
import { getTransferTokenUSD } from '.';

export const JITO_TIMEOUT = 30000;

export function getJitoTipAccount() {
  const tipAccounts = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'Aqm1Pw7r1JxBtn91kcmvJEZedLVv6TGLRBrKzEiVXSiu',
  ];
  // Randomly select one of the tip addresses
  const random = Math.floor(Math.random() * tipAccounts.length);
  const selectedTipAccount = tipAccounts[random == 0 ? 0 : random - 1];
  const priorityTipAccount = tipAccounts[tipAccounts.length - 1];
  return {
    jitoAccount: selectedTipAccount,
    jitoPriorityAccount: priorityTipAccount,
  };
}

export async function getTipTransaction(ownerPubkey: PublicKey, tip: number, recentBlockhash: Blockhash) {
  try {
    const tipAccount = new PublicKey(getJitoTipAccount().jitoAccount);
    const instructions = [
      SystemProgram.transfer({
        fromPubkey: ownerPubkey,
        toPubkey: tipAccount,
        lamports: tip,
      }),
    ];
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
  } catch (err) {
    G.log(err);
  }
  return null;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getFeeInstruction(payer: PublicKey, received: PublicKey, fee: number) {
  try {
    const instruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: received,
      lamports: Number(fee.toFixed(9)) * LAMPORTS_PER_SOL,
    });
    return instruction;
  } catch (err) {
    G.log(err);
  }
  return null;
}

export async function getVersionedTransaction(
  ownerPubkey: PublicKey,
  instructionArray: TransactionInstruction[],
  lookupTableAccount = null,
) {
  const recentBlockhash = (await G.conn().getLatestBlockhash()).blockhash;
  const messageV0 = new TransactionMessage({
    payerKey: ownerPubkey,
    instructions: instructionArray,
    recentBlockhash: recentBlockhash,
  }).compileToV0Message(lookupTableAccount ? lookupTableAccount : undefined);
  return new VersionedTransaction(messageV0);
}

export async function sendBundleConfirmTxId(
  transactions: any[],
  txHashs: string[],
  commitment: Finality = 'confirmed',
) {
  try {
    if (transactions.length === 0) return false;

    let bundleIds: any = [];
    const jito_endpoint = 'https://frankfurt.mainnet.block-engine.jito.wtf';

    for (let i = 0; i < transactions.length; i++) {
      const rawTransactions = transactions[i].map((item: any) => base58.encode(item.serialize()));
      const { data } = await axios.post(
        jito_endpoint + '/api/v1/bundles',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [rawTransactions],
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
      if (data) {
        bundleIds = [...bundleIds, data.result];
      }
    }
    // G.log("bundleIds:************************", bundleIds)
    const sentTime = Date.now();
    while (Date.now() - sentTime < JITO_TIMEOUT) {
      try {
        let success = true;
        for (let i = 0; i < bundleIds.length; i++) {
          let txResult = await G.conn().getTransaction(txHashs[i], {
            commitment: commitment,
            maxSupportedTransactionVersion: 1,
          });

          if (txResult === null) {
            success = false;
            break;
          } else {
          }
        }

        if (success) {
          G.log('=== Success sendBundleConfirmTxId ===');
          return true;
        }
      } catch (err) {
        G.log(err);
        if (SIMULATE_MODE) {
          fs.appendFileSync('errorLog.txt', '**************sendBundleConfirmTxId-Error-While**************\n');
          fs.appendFileSync('errorLog.txt', JSON.stringify(err));
          fs.appendFileSync('errorLog.txt', '**************SendBundle-End**************\n');
        }
      }

      await sleep(500);
    }
  } catch (err) {
    G.log(err);
    if (SIMULATE_MODE) {
      fs.appendFileSync('errorLog.txt', '**************sendBundleConfirmTxId-Error**************\n');
      fs.appendFileSync('errorLog.txt', JSON.stringify(err));
      fs.appendFileSync('errorLog.txt', '**************SendBundle-End**************\n');
    }
  }
  await sleep(1000);
  return false;
}

export async function sendBundle(finalTxs: VersionedTransaction[], commitment: Finality = 'confirmed') {
  try {
    if (SIMULATE_MODE) {
      fs.appendFileSync('errorLog.txt', '**************SendBundle-Start**************\n');
      for (let j = 0; j < finalTxs.length; j++) {
        fs.appendFileSync('errorLog.txt', `**************SendBundle-Start---${j}**************\n`);
        fs.appendFileSync('errorLog.txt', JSON.stringify(await G.conn().simulateTransaction(finalTxs[j]), null, 2));
        fs.appendFileSync('errorLog.txt', '\n');
      }
      fs.appendFileSync('errorLog.txt', '**************SendBundle-End**************\n');

      return true;
    }
    const txHash = base58.encode(finalTxs[0].signatures[0]);
    G.log('bundle txHash :>> ', txHash);
    const result = await sendBundleConfirmTxId([finalTxs], [txHash], commitment);
    if (!result) return false;
    return true;
  } catch (err) {
    G.log('Bundle trx error -> ', err);
    fs.appendFileSync('errorLog.txt', '**************sendBundle-Error**************\n');
    fs.appendFileSync('errorLog.txt', JSON.stringify(err));
    fs.appendFileSync('errorLog.txt', '**************sendBundle-End**************\n');
  }
}
