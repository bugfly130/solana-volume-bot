import * as database from './db';
import * as constants from './uniconst';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import base58 from 'bs58';
import * as G from './utils/G';
import * as bot from './bot';
import dotenv from 'dotenv';
import {
  getJitoVersionedTransaction,
  getTokenBalanceWithDecimals,
  getWalletSOLBalance,
} from './utils/index';
import * as afx from './global';
import {
  getCreateAccountTransaction,
  getRandomValue,
  getWalletFromPrivateKey,
  IsTokenAccountInWallet,
} from './utils';
import { sendBundle } from './utils/jito';
import { TxVersion } from '@raydium-io/raydium-sdk';
import { BN } from 'bn.js';
import { PoolFetchType, CurveCalculator, Raydium, SOLMint } from "@raydium-io/raydium-sdk-v2";
import { raydiumSDKList } from './amm/constants';
import { isValidCpmm } from './utils/sdkv2';

dotenv.config();

const SIMULATE_MODE = G.SIMULATE_MODE;

export async function getPoolInfo(raydium: Raydium | undefined, token: string) {
  console.log("Getting pool info...");

  if (raydium == undefined) {
    return null;
  }

  try {
    const data = await raydium.api.fetchPoolByMints({
      mint1: SOLMint,
      mint2: new PublicKey(token),
      type: PoolFetchType.All
    }) as any;

    // console.log(data);
    const poolNum = data.data.length;
    for (let i = 0; i < poolNum; i++) {
      if (isValidCpmm(data.data[i].programId)) {
        return data.data[i];
      }
    }
  } catch {
    console.log("Getting poolKeys Unknown Error.");
  }
  return null;
}

export const botRunBundle = async (chatid: string, addr: string, pool: any) => {
  console.log("*************meteora amm botRunBundle*************");
  const token: any = await database.selectToken({ chatid, addr });
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  if (token.status === false) {
    if (token.botId !== 0) {
      clearTimeout(token.botId);
      token.status = false
      token.lastWorkedTime = new Date().getTime()
      await token.save()
    }

    return;
  }

  const solBalance = await getWalletSOLBalance(depositer);
  if (solBalance < 0.1) {
    await stopBot(chatid, addr, pool);

    await bot.openMessage(chatid, "", 0, "There is not enough sol in deposit wallet. Please charge some sol.")
    return;
  }
  let amount = token.buysellAmount;
  if (amount + 0.1 > solBalance) {
    amount = solBalance - 0.1;
  }
  G.log('💦 amount:', amount);

  /** ************* Select wallets ******************* */
  const feeKeypairs: any[] = [];
  const reqWallets: any[] = [];
  const wallets: any = await database.selectWallets({}, constants.MAX_WALLET_SIZE);
  for (let i = 0; i < wallets.length; i++) {
    let usedTokens = wallets[i].usedTokenIdx;
    if (usedTokens.indexOf(token.addr) >= 0) {
      if (i === wallets.length - 1) {
        const result = await database.udpateWallet();
        console.log('💦 updateWallet: ', result);
        i = 0;
      }
      continue;
    }

    reqWallets.push(wallets[i]);
    G.log('🎈wallets:', i);
    feeKeypairs.push(Keypair.fromSecretKey(base58.decode(wallets[i].prvKey)));
    if (reqWallets.length == 2) break;

    if (i === wallets.length - 1) {
      const result = await database.udpateWallet();
      console.log('💦 updateWallet: ', result);
      i = 0;
    }
  }

  for (let wallet of reqWallets) {
    wallet.usedTokenIdx.push(addr);
    await wallet.save();
  }

  if (!(await IsTokenAccountInWallet(depositer.publicKey, addr))) {
    const versionedTransaction = await getCreateAccountTransaction(depositer, token.addr);
    if (!versionedTransaction) return constants.ResultCode.INTERNAL;
    await sendBundle([versionedTransaction], 'finalized');
  }

  /* *********************** buy/sell token on deposit wallet ********************************* */
  const bundleTransaction: VersionedTransaction[] = [];
  const signers: Keypair[] = [];
  let total_volume = 0;

  let restTokenBalance = await getTokenBalanceWithDecimals(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  console.log('🩸restTokenBalance', restTokenBalance);

  for (let i = 0; i < 2; i++) {
    const buyAmount = (amount * getRandomValue()) / 100;
    console.log(buyAmount);
    const buyInst = await buyCPMM(raydiumSDKList.get(depositer.publicKey.toBase58()), token.addr, pool, depositer, buyAmount);

    total_volume += (buyAmount / LAMPORTS_PER_SOL) * 2;

    G.log('buyInstruction:', buyInst?.amountToken.toFixed(0));
    if (buyInst) {
      const buyTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: feeKeypairs[i].publicKey,
          recentBlockhash: '1',
          instructions: buyInst.instructions,
        }).compileToV0Message(),
      );

      bundleTransaction.push(buyTransaction);
      signers.push(feeKeypairs[i]);

      const sellTokenAmount = Number(buyInst.amountToken.toFixed(0)) + Number(restTokenBalance);
      const sellInst = await sellCPMM(raydiumSDKList.get(depositer.publicKey.toBase58()), token.addr, pool, depositer, sellTokenAmount);
      restTokenBalance = BigInt(0);
      G.log('sellInstruction:', sellInst?.amountToken.toFixed(0));
      if (sellInst) {
        const sellTransaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: feeKeypairs[i].publicKey,
            recentBlockhash: '1',
            instructions: sellInst.instructions,
          }).compileToV0Message(),
        );

        bundleTransaction.push(sellTransaction);
        signers.push(feeKeypairs[i]);
      }
    }
  }

  if (bundleTransaction.length == 0) {
    G.log('❌ No transaction with buy/sell error')
    const timeOutId = setTimeout(() => {
      botRunBundle(chatid, addr, pool);
    }, token.delayTime * 1000);
    token.botId = timeOutId;
    return
  }

  let j = 0;
  const hash1 = (await G.conn().getLatestBlockhash()).blockhash;
  for (const tx of bundleTransaction) {
    tx.message.recentBlockhash = hash1;
    tx.sign([signers[j], depositer]);

    j++;
    if (SIMULATE_MODE) {
      G.log('SIMULATE_MODE---------------', await G.conn().simulateTransaction(tx));
    }
  }

  // Prepare and sign Jito versioned transaction
  G.log('💦', total_volume * G.SWAP_FEE);
  let referrer_wallet: string = afx.getTaxWallet1();
  if (user.referredBy) {
    const referrer: any = await database.selectUser({
      chatid: user.referredBy,
    });
    if (referrer) {
      const referrer_wallet_ = getWalletFromPrivateKey(
        referrer.depositWallet
      );
      if (referrer_wallet_) {
        referrer_wallet = referrer_wallet_.publicKey;
      }
    }
  }
  const referralWallet = new PublicKey(referrer_wallet);

  const jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, total_volume * G.SWAP_FEE, false);
  if (!jitoTransaction) return;

  jitoTransaction.message.recentBlockhash = hash1;
  jitoTransaction.sign([depositer]);
  let result = await sendBundle([...bundleTransaction, jitoTransaction]);

  if (result) {
    const now: number = new Date().getTime();
    token.currentVolume += total_volume;
    G.log('currentVolume --> ', token.currentVolume);
    token.workingTime += now - token.lastWorkedTime;
    token.lastWorkedTime = now;
  }

  G.log('🩸delay time:', token.delayTime);

  const timeOutId = setTimeout(() => {
    botRunBundle(chatid, addr, pool);
  }, token.delayTime * 1000);
  token.botId = timeOutId;
  await token.save();
}

export const startBot = async (chatid: string, addr: string, pool: any) => {
  console.log("*************startBot*************", addr);
  const token: any = await database.selectToken({ chatid, addr });
  if (!token) {
    return constants.ResultCode.INTERNAL
  }

  const userData: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(userData.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  if (await getWalletSOLBalance(depositer) < constants.JITO_BUNDLE_TIP) {
    await stopBot(chatid, addr, pool)
    return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL;
  }

  token.status = true
  token.lastWorkedTime = new Date().getTime()
  await token.save()
  botRunBundle(chatid, addr, pool);
  return constants.ResultCode.SUCCESS
}

export const stopBot = async (chatid: string, addr: string, pool: any) => {
  console.log("*************stopBot*************");
  const token: any = await database.selectToken({ chatid, addr });

  // Fetch the user data from the database
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  // Get token and SOL balance
  const tokenBalance = await getTokenBalanceWithDecimals(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  G.log('token balance -> ', tokenBalance);

  if (tokenBalance) {
    const sellInst = await sellCPMM(raydiumSDKList.get(depositer.publicKey.toBase58()), token.addr, pool, depositer, Number(tokenBalance));

    if (sellInst) {
      // Build the transaction
      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: depositer.publicKey,
          recentBlockhash: '1',
          instructions: sellInst?.instructions,
        }).compileToV0Message(),
      );

      // Prepare and sign Jito versioned transaction
      let referrer_wallet: string = afx.getTaxWallet1();
      if (user.referredBy) {
        const referrer: any = await database.selectUser({
          chatid: user.referredBy,
        });
        if (referrer) {
          const referrer_wallet_ = getWalletFromPrivateKey(
            referrer.depositWallet
          );
          if (referrer_wallet_) {
            referrer_wallet = referrer_wallet_.publicKey;
          }
        }
      }
      const referralWallet = new PublicKey(referrer_wallet);

      const jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, 0, false);
      if (!jitoTransaction) return;
      const hash = (await G.conn().getLatestBlockhash()).blockhash;
      versionedTransaction.message.recentBlockhash = hash;
      versionedTransaction.sign([depositer]);

      jitoTransaction.message.recentBlockhash = hash;
      jitoTransaction.sign([depositer]);

      // Send the bundle
      let result = await sendBundle([versionedTransaction, jitoTransaction]);

      if (result) {
        G.log('✅ Transfer token Success');
      }
    }
  }

  clearTimeout(token.botId);
  token.status = false
  token.lastWorkedTime = new Date().getTime()
  await token.save()
  G.log("stopBot:___2");
}

export async function buyCPMM(raydium: Raydium | undefined, token: string, poolInfo: any, payerWallet: Keypair, amount: number) {
  try {
    if (raydium === undefined) return null;

    const rpcData = await raydium.cpmm.getRpcPoolInfo(poolInfo.id, true);

    const baseIn = token === poolInfo.mintB.address;
    const inputAmount = new BN(Math.floor(amount));

    // swap pool mintA for mintB
    const swapResult = CurveCalculator.swap(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo ? rpcData.configInfo.tradeFeeRate : new BN(0),
    )

    const { transaction } = await raydium.cpmm.swap<TxVersion.LEGACY>({
      poolInfo: poolInfo as any,
      payer: payerWallet.publicKey,
      baseIn,
      slippage: 0.05, // range: 1 ~ 0.0001, means 100% ~ 0.01%
      swapResult: swapResult,
      inputAmount,
      txVersion: TxVersion.LEGACY,
    })

    return { instructions: transaction.instructions, amountToken: swapResult.destinationAmountSwapped.toNumber() };
  } catch (err) {
    G.log('❌ Buy error ->', err);
  }
}

export async function sellCPMM(raydium: Raydium | undefined, token: string, poolInfo: any, payerWallet: Keypair, amount: number) {
  try {
    if (raydium == undefined) return null;

    const rpcData = await raydium.cpmm.getRpcPoolInfo(poolInfo.id, true)

    const baseIn = token === poolInfo.mintA.address
    const inputAmount = new BN(Math.floor(amount));

    // swap pool mintA for mintB
    const swapResult = CurveCalculator.swap(
      inputAmount,
      baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
      baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
      rpcData.configInfo ? rpcData.configInfo.tradeFeeRate : new BN(0),
    )

    const { transaction } = await raydium.cpmm.swap<TxVersion.LEGACY>({
      poolInfo: poolInfo as any,
      payer: payerWallet.publicKey,
      baseIn,
      slippage: 0.05, // range: 1 ~ 0.0001, means 100% ~ 0.01%
      swapResult: swapResult,
      inputAmount,
      txVersion: TxVersion.LEGACY,
    })

    return { instructions: transaction.instructions, amountToken: swapResult.destinationAmountSwapped.toNumber() };
  } catch (err) {
    G.log('❌ Sell error ->', err);
  }
}