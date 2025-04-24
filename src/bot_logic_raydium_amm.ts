import * as database from './db';
import * as constants from './uniconst';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import base58 from 'bs58';
import * as G from './utils/G';
import * as bot from './bot';
import dotenv from 'dotenv';
import {
  getJitoVersionedTransaction,
  getTokenBalance,
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
import { MARKET_STATE_LAYOUT_V3 } from "@project-serum/serum";
import { jsonInfo2PoolKeys, Liquidity, LIQUIDITY_STATE_LAYOUT_V4, LiquidityPoolInfo, LiquidityPoolKeys, MAINNET_PROGRAM_ID, Percent, poolKeys2JsonInfo, SPL_ACCOUNT_LAYOUT, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { getMint, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from 'bn.js';

dotenv.config();

const SIMULATE_MODE = G.SIMULATE_MODE;

export async function getPoolInfo(conn: Connection, token: string, poolAddress: string) {
  if (!poolAddress) return null;
  const baseMint = new PublicKey(token);
  const baseMintInfo = await getMint(conn, baseMint);
  const baseToken = new Token(TOKEN_PROGRAM_ID, token, baseMintInfo.decimals);
  const quoteToken = new Token(TOKEN_PROGRAM_ID, "So11111111111111111111111111111111111111112", 9, "WSOL", "WSOL");
  const PROGRAMIDS = MAINNET_PROGRAM_ID;

  const marketAccounts = await conn.getMultipleAccountsInfo([new PublicKey(poolAddress)]);

  const marketInfo4 = marketAccounts.map((v) => LIQUIDITY_STATE_LAYOUT_V4.decode(v!.data));
  const marketInfo3 = marketAccounts.map((v) => MARKET_STATE_LAYOUT_V3.decode(v!.data));

  let poolKeys: any = Liquidity.getAssociatedPoolKeys({
    version: 4,
    marketVersion: 3,
    baseMint: baseToken.mint,
    quoteMint: quoteToken.mint,
    baseDecimals: baseToken.decimals,
    quoteDecimals: quoteToken.decimals,
    marketId: marketInfo4[0].marketId,
    programId: PROGRAMIDS.AmmV4,
    marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
  });
  poolKeys.marketBaseVault = marketInfo3[0].baseVault;
  poolKeys.marketQuoteVault = marketInfo3[0].quoteVault;
  poolKeys.marketBids = marketInfo3[0].bids;
  poolKeys.marketAsks = marketInfo3[0].asks;
  poolKeys.marketEventQueue = marketInfo3[0].eventQueue;

  const poolInfo = poolKeys2JsonInfo(poolKeys);
  return poolInfo;
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

  let restTokenBalance = await getTokenBalance(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  console.log('🩸restTokenBalance', restTokenBalance);

  const poolKeys = jsonInfo2PoolKeys(pool);
  for (let i = 0; i < 2; i++) {
    const buyAmount = (amount * getRandomValue()) / 100 / LAMPORTS_PER_SOL;
    console.log(buyAmount);
    const buyInst = await buyAMM(token.addr, poolKeys, depositer, buyAmount);

    total_volume += buyAmount * 2;

    G.log('buyInstruction:', buyInst?.amountToken.toFixed(token.decimal));
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

      const sellTokenAmount = Number(buyInst.amountToken.toFixed(token.decimal)) + restTokenBalance;
      const sellInst = await sellAMM(token.addr, poolKeys, depositer, sellTokenAmount);
      restTokenBalance = 0;
      G.log('sellInstruction:', sellInst?.amountToken.toFixed(5));
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
  const tokenBalance = await getTokenBalance(depositer.publicKey.toBase58(), addr, afx.web3Conn);
  G.log('token balance -> ', tokenBalance);

  const poolKeys = jsonInfo2PoolKeys(pool);
  if (tokenBalance) {
    const sellInst = await sellAMM(token.addr, poolKeys, depositer, Number(tokenBalance));

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

const calculateReserves = async (poolKeys: LiquidityPoolKeys, connection: Connection): Promise<LiquidityPoolInfo> => {
  try {

    const baseReserve = (await connection.getTokenAccountBalance(poolKeys.baseVault)).value;
    const quoteReserve = (await connection.getTokenAccountBalance(poolKeys.quoteVault)).value;

    const status = new BN(1); // this isn't used so just send back a default value
    const lpDecimals = poolKeys.lpDecimals;
    // const lpSupply = new BN(await getTokenAmount(poolKeys.lpVault, connection));
    const lpSupply = new BN(1);// this isn't used so just send back a default value
    const startTime = new BN(0); // this isn't used so just send back a default value
    const poolInfo = {
      status,
      baseDecimals: poolKeys.baseDecimals,
      quoteDecimals: poolKeys.quoteDecimals,
      lpDecimals,
      baseReserve: new BN(baseReserve.amount),
      quoteReserve: new BN(quoteReserve.amount),
      lpSupply: lpSupply.div(new BN(10).pow(new BN(lpDecimals))),
      startTime,
    };
    return poolInfo;
  } catch (error) {
    console.error('Failed to calculate reserves:', error);
    throw error;
  }
}

const calcAmountOut = async (
  poolKeys: any,
  rawAmountIn: number,
  swapInDirection: boolean
) => {
  const poolInfo = await calculateReserves(poolKeys, afx.web3Conn);

  let currencyInMint = poolKeys.baseMint;
  let currencyInDecimals = poolInfo.baseDecimals;
  let currencyOutMint = poolKeys.quoteMint;
  let currencyOutDecimals = poolInfo.quoteDecimals;

  if (!swapInDirection) {
    currencyInMint = poolKeys.quoteMint;
    currencyInDecimals = poolInfo.quoteDecimals;
    currencyOutMint = poolKeys.baseMint;
    currencyOutDecimals = poolInfo.baseDecimals;
  }

  const currencyIn = new Token(
    TOKEN_PROGRAM_ID,
    currencyInMint,
    currencyInDecimals
  );
  const amountIn = new TokenAmount(currencyIn, rawAmountIn, false);
  const currencyOut = new Token(
    TOKEN_PROGRAM_ID,
    currencyOutMint,
    currencyOutDecimals
  );

  const {
    amountOut,
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
  } = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut,
    slippage: new Percent(5, 100),
  });

  return {
    amountIn,
    amountOut,
    minAmountOut,
    currentPrice,
    executionPrice,
    priceImpact,
    fee,
  };
};

const getOwnerTokenAccounts = async (wallet: PublicKey) => {
  const walletTokenAccount = await afx.web3Conn.getTokenAccountsByOwner(
    wallet,
    {
      programId: TOKEN_PROGRAM_ID,
    }
  );

  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
};

export async function buyAMM(token: string, poolKeys: any, payerWallet: Keypair, amount: number) {
  try {
    const directionIn = poolKeys.quoteMint.toString() == token;
    const { minAmountOut, amountIn } = await calcAmountOut(
      poolKeys,
      amount,
      directionIn
    );

    const userTokenAccounts = await getOwnerTokenAccounts(payerWallet.publicKey);
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
      connection: afx.web3Conn,
      makeTxVersion: 0,
      poolKeys,
      userKeys: {
        tokenAccounts: userTokenAccounts,
        owner: payerWallet.publicKey,
      },
      amountIn: amountIn,
      amountOut: minAmountOut,
      fixedSide: "in",
      config: {
        bypassAssociatedCheck: false,
        checkCreateATAOwner: false,
      },
    });
    return {
      instructions: swapTransaction.innerTransactions[0].instructions,
      amountToken: minAmountOut,
    };
  } catch (err) {
    G.log('❌ Buy error ->', err);
  }
}

export async function sellAMM(token: string, poolKeys: any, payerWallet: Keypair, amount: number) {
  try {
    const directionIn = poolKeys.quoteMint.toString() == NATIVE_MINT.toString();
    const { amountOut, minAmountOut, amountIn } = await calcAmountOut(
      poolKeys,
      amount,
      directionIn
    );

    const userTokenAccounts = await getOwnerTokenAccounts(payerWallet.publicKey);
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
      connection: afx.web3Conn,
      makeTxVersion: 0,
      poolKeys,
      userKeys: {
        tokenAccounts: userTokenAccounts,
        owner: payerWallet.publicKey,
      },
      amountIn: amountIn,
      amountOut: minAmountOut,
      fixedSide: "in",
      config: {
        bypassAssociatedCheck: false,
      },
    });

    return {
      instructions: swapTransaction.innerTransactions[0].instructions,
      amountToken: amountOut,
    };
  } catch (err) {
    G.log('❌ Sell error ->', err);
  }
}