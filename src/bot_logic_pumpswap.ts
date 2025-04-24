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
  getSOLPrice,
  getWalletFromPrivateKey,
  IsTokenAccountInWallet,
} from './utils';
import { sendBundle } from './utils/jito';
import { Direction, poolPda, PumpAmmSdk, pumpPoolAuthorityPda } from '@pump-fun/pump-swap-sdk';
import { BN } from 'bn.js';
import { NATIVE_MINT } from '@solana/spl-token';

dotenv.config();

const SIMULATE_MODE = G.SIMULATE_MODE;

export const botRunBundle = async (chatid: string, addr: string) => {
  console.log('************* botRunBundle*************');
  const token: any = await database.selectToken({ chatid, addr });
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  if (token.status === false) {
    if (token.botId !== 0) {
      clearTimeout(token.botId);
      token.status = false;
      token.lastWorkedTime = new Date().getTime();
      await token.save();
    }

    return;
  }

  const solBalance = await getWalletSOLBalance(depositer);
  if (solBalance < 0.1) {
    await stopBot(chatid, addr);

    await bot.openMessage(chatid, '', 0, 'There is not enough sol in deposit wallet. Please charge some sol.');
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
    const buyAmount = (amount * getRandomValue()) / 100 / LAMPORTS_PER_SOL;
    const buyInst = await buy(depositer, addr, buyAmount);

    total_volume += buyAmount * 2;
    G.log('buyInstruction:', buyInst?.amountToken.toString());

    if (buyInst && buyInst.instructions) {
      const buyTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: feeKeypairs[i].publicKey,
          recentBlockhash: '1',
          instructions: buyInst.instructions,
        }).compileToV0Message(),
      );

      bundleTransaction.push(buyTransaction);
      signers.push(feeKeypairs[i]);

      const sellTokenAmount = Number(buyInst.amountToken) + Number(restTokenBalance);
      const sellInst = await sell(depositer, addr, sellTokenAmount);
      restTokenBalance = BigInt(0);
      G.log('sellInstruction:', sellInst?.amountToken.toString());
      if (sellInst && sellInst.instructions) {
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
      botRunBundle(chatid, addr);
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

  G.log('💦', total_volume * G.SWAP_FEE);
  let jitoTransaction;
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

  jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, total_volume * G.SWAP_FEE, false);

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
    botRunBundle(chatid, addr);
  }, token.delayTime * 1000);
  token.botId = timeOutId;
  await token.save();
};

export const startBot = async (chatid: string, addr: string) => {
  console.log('*************startBot*************', addr);
  const token: any = await database.selectToken({ chatid, addr });
  if (!token) {
    return constants.ResultCode.INTERNAL;
  }

  const userData: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(userData.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  if ((await getWalletSOLBalance(depositer)) < constants.JITO_BUNDLE_TIP) {
    await stopBot(chatid, addr);
    return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL;
  }

  token.status = true;
  token.lastWorkedTime = new Date().getTime();
  await token.save();
  botRunBundle(chatid, addr);
  return constants.ResultCode.SUCCESS;
};

export const stopBot = async (chatid: string, addr: string) => {
  console.log('*************stopBot*************');
  const token: any = await database.selectToken({ chatid, addr });

  // Fetch the user data from the database
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  // Get token and SOL balance
  const tokenBalance = await getTokenBalanceWithDecimals(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  G.log('token balance -> ', tokenBalance);

  if (tokenBalance) {
    const sellInst = await sell(depositer, addr, Number(tokenBalance));

    if (sellInst && sellInst.instructions) {
      // Build the transaction
      const versionedTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: depositer.publicKey,
          recentBlockhash: '1',
          instructions: sellInst.instructions,
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
  token.status = false;
  token.lastWorkedTime = new Date().getTime();
  await token.save();
};

export async function swapTrade(
  signer: Keypair,
  _pool: string,
  _amount: number,
  isBuy: boolean,
  slippage: number = 100
) {
  const pumpAmmSdk = new PumpAmmSdk(afx.web3Conn);
  const pool = new PublicKey(_pool)
  let direction: Direction
  if (isBuy) {
    direction = "quoteToBase"
    return pumpAmmSdk.swapQuoteInstructions(
      pool,
      new BN(_amount * LAMPORTS_PER_SOL),
      slippage,
      direction,
      signer.publicKey
    )
  } else {
    direction = "baseToQuote"
    return await pumpAmmSdk.swapBaseInstructions(
      pool,
      new BN(_amount),
      slippage,
      direction,
      signer.publicKey
    )
  }
}

export function swapFetchPoolId(_token: string): string {
  const token = new PublicKey(_token)
  const [poolAuthority,] = pumpPoolAuthorityPda(token)
  const [pool,] = poolPda(0, poolAuthority, token, NATIVE_MINT)
  return pool.toBase58()
}

export async function swapCalcAmount(_pool: string, _amount: number, isBuy: boolean, slippage: number = 100): Promise<bigint> {
  const pumpAmmSdk = new PumpAmmSdk(afx.web3Conn);
  const pool = new PublicKey(_pool)
  let swapAmount
  if (isBuy) {
    swapAmount = await pumpAmmSdk.swapAutocompleteBaseFromQuote(
      pool,
      new BN(_amount * LAMPORTS_PER_SOL),
      slippage,
      "quoteToBase"
    );
  } else {
    swapAmount = await pumpAmmSdk.swapAutocompleteQuoteFromBase(
      pool,
      new BN(_amount),
      slippage,
      "quoteToBase"
    );
  }
  return swapAmount
}

export async function buy(payerWallet: Keypair, tokenAddress: string, amount: number) {
  try {
    const pool = swapFetchPoolId(tokenAddress);
    const amountToken = await swapCalcAmount(pool, amount, true, 5);
    const instructions = await swapTrade(payerWallet, pool, amount, true, 5);

    return { instructions: instructions, amountToken }
  } catch (err) {
    G.log('❌ Buy error ->', err);
  }
}

export async function sell(payerWallet: Keypair, tokenAddress: string, amount: number) {
  try {
    const pool = swapFetchPoolId(tokenAddress);
    const amountToken = await swapCalcAmount(pool, amount, false, 5);
    const instructions = await swapTrade(payerWallet, pool, amount, false, 5);

    return { instructions: instructions, amountToken }
  } catch (err) {
    G.log('❌ Sell error ->', err);
  }
}