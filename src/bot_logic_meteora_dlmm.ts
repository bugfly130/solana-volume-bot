import * as database from './db';
import * as constants from './uniconst';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Wallet, AnchorProvider, BN } from '@coral-xyz/anchor';
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
  randomDivide,
} from './utils';
import { sendBundle } from './utils/jito';
import DLMM from '@meteora-ag/dlmm';

dotenv.config();

const SIMULATE_MODE = G.SIMULATE_MODE;

export const getPoolInfo = async (chatid: string, poolAddr: string) => {
  const userData: any = await database.selectUser({ chatid });
  const depositerWallet = new Wallet(Keypair.fromSecretKey(base58.decode(userData.depositWallet)));
  const provider = new AnchorProvider(afx.web3Conn, depositerWallet, {
    commitment: 'confirmed',
  });
  const pool: any = await DLMM.create(provider.connection, new PublicKey(poolAddr));
  return pool;
};

export const botRunRandom = async (chatid: string, addr: string, pool: DLMM) => {
  console.log('*************botRun*************');
  const token: any = await database.selectToken({ chatid, addr });
  let configBuySellAmount = token.buysellAmount;

  G.log('amount:*****************', configBuySellAmount, token.buysellAmount);
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  const solPrice = await getSOLPrice();
  let bUSD = false;
  if (pool.tokenY.publicKey.toBase58() == constants.USDC_ADDRESS) {
    const quoteBalance = Number(
      await getTokenBalanceWithDecimals(
        depositer.publicKey.toBase58(),
        constants.USDC_ADDRESS,
        afx.web3Conn,
      ),
    );

    G.log('convert sol to usd ammout');
    configBuySellAmount = (configBuySellAmount / LAMPORTS_PER_SOL) * solPrice * 10 ** pool.tokenY.decimal;
    bUSD = true;

    if (configBuySellAmount > quoteBalance) {
      G.log('🏷change amount quoteBalance: ', quoteBalance, configBuySellAmount);
      configBuySellAmount = quoteBalance;
    }
  }

  if (token.status === false) {
    if (token.botId !== 0) {
      clearTimeout(token.botId);
      token.status = false;
      token.lastWorkedTime = new Date().getTime();
      await token.save();
    }

    return;
  }

  if ((await getWalletSOLBalance(depositer)) < 0.1) {
    await stopBot(chatid, addr, pool);

    await bot.openMessage(chatid, '', 0, 'There is not enough sol in deposit wallet. Please charge some sol.');
    return;
  }

  /** ************* Generate wallets ******************* */
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
    if (reqWallets.length == 4) break;
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
  let bundleTransaction: VersionedTransaction[] = [];
  const signers: Keypair[] = [];
  let total_volume = 0;

  let restTokenBalance = await getTokenBalanceWithDecimals(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  G.log('🩸tokenBalance', restTokenBalance);

  const randomBuyAmounts = randomDivide(configBuySellAmount, 4);
  G.log('randomBuyAmounts:', randomBuyAmounts);
  const buyTokenAmount: BN = new BN(Number(restTokenBalance));

  for (let i = 0; i < 4; i++) {
    const buyAmount = Number(((randomBuyAmounts[i] * getRandomValue(80, 95)) / 100).toFixed(0));

    G.log('buyAmount', buyAmount);

    const buyInst = await buyDLMM(pool, depositer, new BN(buyAmount));

    if (bUSD) {
      total_volume += (buyAmount / 10 ** pool.tokenY.decimal / solPrice) * 2;
    } else total_volume += (buyAmount / LAMPORTS_PER_SOL) * 2;

    G.log('buyInstruction:', buyInst?.amountToken.toString());

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

      buyTokenAmount.add(buyInst.amountToken);
    }
  }

  if (bundleTransaction.length == 0) {
    G.log('❌ No transaction with buy/sell error')
    const timeOutId = setTimeout(() => {
      botRunRandom(chatid, addr, pool);
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

  if (bUSD) {
    const feeUSD = total_volume * solPrice * 10 ** pool.tokenY.decimal;
    jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, feeUSD * G.SWAP_FEE, true);
  } else {
    jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, total_volume * G.SWAP_FEE, false);
  }
  if (!jitoTransaction) return;

  jitoTransaction.message.recentBlockhash = hash1;
  jitoTransaction.sign([depositer]);
  let result = await sendBundle([...bundleTransaction, jitoTransaction]);

  if (result) {
    G.log('✅ buy token successfully');

    const now: number = new Date().getTime();
    token.currentVolume += total_volume;
    G.log('currentVolume --> ', token.currentVolume);
    token.workingTime += now - token.lastWorkedTime;
    token.lastWorkedTime = now;

    await G.sleep(1000);

    const randomSellAmounts = randomDivide(Number(buyTokenAmount), 4);
    bundleTransaction = [];
    for (let i = 0; i < 4; i++) {
      const sellAmount = (randomSellAmounts[i] * getRandomValue(80, 95)) / 100;
      const sellInst = await sellDLMM(pool, depositer, new BN(sellAmount));
      G.log('sellInstruction:', sellInst?.amountToken.toString());
      if (sellInst) {
        const sellTransaction = new VersionedTransaction(
          new TransactionMessage({
            payerKey: feeKeypairs[i].publicKey,
            recentBlockhash: '1',
            instructions: sellInst.instructions,
          }).compileToV0Message(),
        );

        bundleTransaction.push(sellTransaction);
      }
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
    jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, total_volume * G.SWAP_FEE, false);
    if (!jitoTransaction) return;

    jitoTransaction.message.recentBlockhash = hash1;
    jitoTransaction.sign([depositer]);
    result = await sendBundle([...bundleTransaction, jitoTransaction]);

    if (result) {
      G.log('✅ sell token successfully');
    }
  }

  const timeOutId = setTimeout(() => {
    botRunRandom(chatid, addr, pool);
  }, token.delayTime * 1000);
  token.botId = timeOutId;
  await token.save();
};

export const botRunBundle = async (chatid: string, addr: string, pool: DLMM) => {
  console.log('*************meteora dlmm botRunBundle*************');
  const token: any = await database.selectToken({ chatid, addr });
  const user: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(user.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  const solBalance = await getWalletSOLBalance(depositer);
  if (solBalance < 0.1) {
    await stopBot(chatid, addr, pool);

    await bot.openMessage(chatid, '', 0, 'There is not enough sol in deposit wallet. Please charge some sol.');
    return;
  }
  let amount = token.buysellAmount;
  if (amount + 0.1 > solBalance) {
    amount = solBalance - 0.1;
  }
  G.log('💦 amount:', amount);

  const solPrice = await getSOLPrice();
  let bUSD = false;
  if (pool.tokenY.publicKey.toBase58() == constants.USDC_ADDRESS) {
    bUSD = true;
    const quoteBalance = Number(
      await getTokenBalanceWithDecimals(
        depositer.publicKey.toBase58(),
        constants.USDC_ADDRESS,
        afx.web3Conn,
      ),
    );

    G.log('convert sol to usd ammout');
    amount = (amount / LAMPORTS_PER_SOL) * solPrice * 10 ** pool.tokenY.decimal;

    if (amount > quoteBalance) {
      G.log('🔗 change amount quoteBalance: ', quoteBalance, amount);
      amount = quoteBalance;
    }
  }

  if (token.status === false) {
    if (token.botId !== 0) {
      clearTimeout(token.botId);
      token.status = false;
      token.lastWorkedTime = new Date().getTime();
      await token.save();
    }

    return;
  }

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
    const buyInst = await buyDLMM(pool, depositer, new BN(buyAmount));

    if (bUSD) {
      total_volume += (buyAmount / 10 ** pool.tokenY.decimal / solPrice) * 2;
    } else total_volume += (buyAmount / LAMPORTS_PER_SOL) * 2;

    G.log('buyInstruction:', buyInst?.amountToken.toString());

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

      const sellInst = await sellDLMM(pool, depositer, buyInst.amountToken.add(new BN(Number(restTokenBalance))));
      restTokenBalance = BigInt(0);
      G.log('sellInstruction:', sellInst?.amountToken.toString());
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

  if (bUSD) {
    const feeUSD = total_volume * solPrice * 10 ** pool.tokenY.decimal;
    jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, feeUSD * G.SWAP_FEE, true);
  } else {
    jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, total_volume * G.SWAP_FEE, false);
  }
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
};

export const startBot = async (chatid: string, addr: string, pool: any) => {
  console.log('*************startBot*************', addr);
  const token: any = await database.selectToken({ chatid, addr });
  if (!token) {
    return constants.ResultCode.INTERNAL;
  }

  const userData: any = await database.selectUser({ chatid });
  const depositerSecretKey: Uint8Array = base58.decode(userData.depositWallet);
  const depositer = Keypair.fromSecretKey(depositerSecretKey);

  if ((await getWalletSOLBalance(depositer)) < constants.JITO_BUNDLE_TIP) {
    await stopBot(chatid, addr, pool);
    return constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL;
  }

  token.status = true;
  token.lastWorkedTime = new Date().getTime();
  await token.save();
  botRunBundle(chatid, addr, pool);
  return constants.ResultCode.SUCCESS;
};

export const stopBot = async (chatid: string, addr: string, pool: any) => {
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
    const sellInst = await sellDLMM(pool, depositer, new BN(Number(tokenBalance)));

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

      const jitoTransaction = await getJitoVersionedTransaction(depositer, referralWallet, 0.006, false);
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

export async function buyDLMM(pool: DLMM, payerWallet: Keypair, swapAmount: BN) {
  try {
    const swapXtoY = false;
    console.log('swapAmount:', swapAmount.toString());
    const binArrays = await pool.getBinArrayForSwap(swapXtoY);
    const swapQuote = await pool.swapQuote(swapAmount, swapXtoY, new BN(80), binArrays);

    // Swap
    const swapTx = await pool.swap({
      inToken: pool.tokenY.publicKey,
      outToken: pool.tokenX.publicKey,
      inAmount: swapAmount,
      minOutAmount: swapQuote.minOutAmount,
      lbPair: pool.pubkey,
      user: payerWallet.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
    });

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      amountToken: swapQuote.minOutAmount,
    };
  } catch (err) {
    G.log('❌ Buy error ->', err);
  }
}

export async function sellDLMM(pool: DLMM, payerWallet: Keypair, swapAmount: BN) {
  try {
    const swapXtoY = true;
    const binArrays = await pool.getBinArrayForSwap(swapXtoY);
    const swapQuote = await pool.swapQuote(swapAmount, swapXtoY, new BN(80), binArrays);

    // Swap
    const swapTx = await pool.swap({
      inToken: pool.tokenX.publicKey,
      outToken: pool.tokenY.publicKey,
      inAmount: swapAmount,
      minOutAmount: swapQuote.minOutAmount,
      lbPair: pool.pubkey,
      user: payerWallet.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
    });

    const instructions = swapTx.instructions.filter(Boolean);

    return {
      instructions,
      amountToken: swapQuote.minOutAmount,
    };
  } catch (err) {
    G.log('❌ Sell error ->', err);
  }
}