import { NATIVE_MINT } from '@solana/spl-token';
import * as database from './db';
import * as constants from './uniconst';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import base58 from 'bs58';
import * as bot from './bot';
import dotenv from 'dotenv';

import * as afx from './global';
import {
  getWalletFromPrivateKey,
} from './utils';
import { getFeeInstruction, getJitoTipAccount, getVersionedTransaction, sendBundle } from './utils/jito';

dotenv.config();

export const disperse = async (chatid: string, amount: number) => {
  try {
    // Fetch the user data from the database
    const userData: any = await database.selectUser({ chatid });
    const depositWallet = getWalletFromPrivateKey(userData.depositWallet);

    const depositWalletSOLBalance: number = await afx.web3Conn.getBalance(depositWallet.wallet.publicKey);
    if (depositWalletSOLBalance <= constants.MAX_WALLET_SIZE * amount) {
      console.log('disperse error: no enough sol.', constants.MAX_WALLET_SIZE * amount);
      return false;
    }

    const wallets: any = await database.selectWallets({}, constants.MAX_WALLET_SIZE);
    if (wallets.length == 0) {
      console.log('disperse error: no wallet count.');
      return false;
    }

    const jitoInst = await getFeeInstruction(
      depositWallet.wallet.publicKey,
      new PublicKey(getJitoTipAccount().jitoAccount),
      constants.JITO_BUNDLE_TIP,
    );
    if (!jitoInst) return false;

    let instructions: TransactionInstruction[] = [];
    for (let i = 0; i < constants.MAX_WALLET_SIZE; i++) {
      const wallet = getWalletFromPrivateKey(wallets[i].prvKey);
      if (!wallet) continue;

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: depositWallet.wallet.publicKey,
          toPubkey: wallet.wallet.publicKey,
          lamports: LAMPORTS_PER_SOL * amount,
        }),
      );
    }

    if (instructions.length == 0) {
      console.log('No need to disperse sol');
      return false;
    }

    let finalTxs: VersionedTransaction[] = [];
    console.log('total instruction count ', instructions.length);

    let idx = 0;
    const instrunctionsPerTx = 20;
    while (idx < instructions.length) {
      let batchInstrunction = instructions.slice(idx, idx + instrunctionsPerTx);

      if (finalTxs.length === 0) {
        batchInstrunction.push(jitoInst);
        console.log('idx:', idx, idx + instrunctionsPerTx);
      }

      const tx = await getVersionedTransaction(depositWallet.wallet.publicKey, [...batchInstrunction]);

      finalTxs.push(tx);
      idx += instrunctionsPerTx;

      if (finalTxs.length == 5) {
        for (let i = 0; i < finalTxs.length; i++) {
          const tx = finalTxs[i];
          tx.sign([depositWallet.wallet]);
          // console.log(await G.conn().simulateTransaction(tx));
        }
        const result = await sendBundle(finalTxs, 'confirmed');
        if (!result) {
          console.log('disperse failed');
          return false;
        }

        finalTxs = [];
      }
    }

    if (finalTxs.length > 0) {
      for (const tx of finalTxs) {
        tx.sign([depositWallet.wallet]);
        // console.log(await G.conn().simulateTransaction(tx));
      }
      const result = await sendBundle(finalTxs, 'confirmed');
      if (!result) {
        console.log('disperse failed');
        return false;
      }
    }

    return true;
  } catch (error) {
    console.log(error);
  }

  return false;
};

export const withdraw = async (chatid: any, addr: any) => {
  await bot.sendMessage(chatid, 'Your withdrawal request is being processed. Please wait...');
  // Fetch the user data from the database
  const userData: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(userData.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  // Get token and SOL balance
  const senderBalance = await afx.web3Conn.getBalance(depositer.publicKey);
  console.log('senderBalance', senderBalance);
  if (senderBalance < 5000) {
    return false;
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: depositer.publicKey,
      toPubkey: new PublicKey(addr),
      lamports: senderBalance - 5000, // Send all lamports (entire balance)
    }),
  );

  let signatures = await sendAndConfirmTransaction(afx.web3Conn, transaction, [depositer], {
    skipPreflight: false,
    commitment: 'confirmed',
    maxRetries: 3,
  });
  console.log('transfer sol signatures', signatures);

  if (signatures) {
    console.log('------withdraw request is successed------');
    await bot.sendMessage(chatid, '✅ Withdraw Success');
  } else {
    console.log('------withdraw request is failed------');
    await bot.sendMessage(chatid, '❌ Withdraw Failed');
    return false;
  }

  return true;
};

export const registerToken = async (
  chatid: string, // this value is not filled in case of web request, so this could be 0
  addr: string,
  symbol: string,
  decimal: number,
) => {
  if (await database.selectToken({ chatid, addr })) {
    return constants.ResultCode.SUCCESS;
  }
  const regist = await database.registToken({
    chatid,
    addr,
    symbol,
    decimal,
    baseAddr: NATIVE_MINT.toString(),
    baseSymbol: 'SOL',
    baseDecimal: 9,
  });
  if (!regist) {
    return constants.ResultCode.INTERNAL;
  }
  return constants.ResultCode.SUCCESS;
};

export const setTargetAmount = async (chatid: string, addr: string, amount: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.targetVolume = amount;
    await token.save();
    return true;
  }
  return false;
};

export const setWithdrawAddress = async (chatid: string, withdrawWallet: string) => {
  const user: any = await database.selectUser({ chatid });
  if (user) {
    user.withdrawWallet = withdrawWallet;
    await user.save();
    return true;
  }
  return false;
};

export const setBuySellAmount = async (chatid: string, addr: string, amount: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.buysellAmount = amount;
    await token.save();
    return true;
  }
  return false;
};

export const setDelayTime = async (chatid: string, addr: string, amount: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.delayTime = amount;
    await token.save();
    return true;
  }
  return false;
};

export const setRating = async (chatid: string, addr: string, amount: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.ratingPer1H = amount;
    await token.save();
    return true;
  }
  return false;
};

export const setBuyAmount = async (chatid: string, addr: string, amount: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.buyAmount = amount;
    await token.save();
    return true;
  }
  return false;
};

export const setWalletSize = async (chatid: string, addr: string, size: number) => {
  const token: any = await database.selectToken({ chatid, addr });
  if (token) {
    token.walletSize = size;
    await token.save();
    return true;
  }
  return false;
};
