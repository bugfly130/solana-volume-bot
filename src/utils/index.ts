import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import * as G from './G';
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { getFeeInstruction, getJitoTipAccount } from './jito';
import { JITO_BUNDLE_TIP, USDC_ADDRESS } from '../uniconst';
import { getTaxWallet1, getTaxWallet2, getTaxWallet3 } from '../global';

export const getWalletSOLBalance = async (wallet: Keypair): Promise<number> => {
  try {
    let balance: number = await G.conn().getBalance(new PublicKey(wallet.publicKey));
    return balance;
  } catch (error) {
    G.log('❌ Get Sol balance error --> ', error);
  }
  return 0;
};

export const getTokenBalance = async (
  walletAddress: string,
  tokenMintAddress: string,
  connection: Connection,
): Promise<number> => {
  // Convert string addresses to PublicKey objects
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);

  // Get the associated token address
  const tokenAddress = await getAssociatedTokenAddress(mint, wallet);

  try {
    // Fetch the token account
    const tokenAccount = await getAccount(connection, tokenAddress);

    // Fetch the mint info to get decimals
    const mintInfo = await getMint(connection, mint);

    // Return the balance as a number
    return Number(tokenAccount.amount) / Math.pow(10, mintInfo.decimals);
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return 0; // Return 0 if there's an error or the account doesn't exist
  }
};

export const getTokenBalanceWithDecimals = async (
  walletAddress: string,
  tokenMintAddress: string,
  connection: Connection,
): Promise<bigint> => {
  // Convert string addresses to PublicKey objects
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);

  // Get the associated token address
  const tokenAddress = await getAssociatedTokenAddress(mint, wallet);

  try {
    // Fetch the token account
    const tokenAccount = await getAccount(connection, tokenAddress);

    // Return the balance as a number
    return tokenAccount.amount;
  } catch (error) {
    console.error('Error fetching token balance:', error);
    return BigInt(0); // Return 0 if there's an error or the account doesn't exist
  }
};

export const getJitoVersionedTransaction = async (payer: Keypair, referralWallet: PublicKey, feeAmount = 0, bUSD = false) => {
  const tipAccount = new PublicKey(getJitoTipAccount().jitoAccount);
  const jitoInst = await getFeeInstruction(payer.publicKey, tipAccount, JITO_BUNDLE_TIP);
  if (!jitoInst)
    return null;

  const taxWallet1 = new PublicKey(getTaxWallet1());
  const taxWallet2 = new PublicKey(getTaxWallet2());
  const taxWallet3 = new PublicKey(getTaxWallet3());
  if (bUSD) {
    const instructions = await getTransferTokenUSD(payer.publicKey, taxWallet1, feeAmount);

    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: '1',
        instructions: [...instructions, jitoInst],
      }).compileToV0Message(),
    );
  }

  if (feeAmount === 0) {
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: '1',
        instructions: [jitoInst],
      }).compileToV0Message(),
    );
  }
  const tax1Inst = await getFeeInstruction(payer.publicKey, taxWallet1, feeAmount * 0.2);
  const tax2Inst = await getFeeInstruction(payer.publicKey, taxWallet2, feeAmount * 0.15);
  const tax3Inst = await getFeeInstruction(payer.publicKey, taxWallet3, feeAmount * 0.15);
  const referralInst = await getFeeInstruction(payer.publicKey, referralWallet, feeAmount * 0.5);

  if (!tax1Inst || !tax2Inst || !tax3Inst || !referralInst) return null;

  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: '1',
      instructions: [tax1Inst, tax2Inst, tax3Inst, referralInst, jitoInst],
    }).compileToV0Message(),
  );
};

export const getTransferTokenUSD = async (payer: PublicKey, taxWallet: PublicKey, feeAmount: number = 0) => {
  const mint = new PublicKey(USDC_ADDRESS);
  let fromTokenATA = getAssociatedTokenAddressSync(mint, payer);

  const toTokenAccount = getAssociatedTokenAddressSync(mint, taxWallet);

  let instructions: TransactionInstruction[] = [];

  try {
    const info = await G.conn().getAccountInfo(toTokenAccount);
    if (!info) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payer,
          toTokenAccount,
          taxWallet,
          mint
        )
      );
    }
  } catch (err) {
    console.log(err);
  }

  const transferAmount = Number(feeAmount.toFixed(0));

  instructions.push(
    createTransferInstruction(
      fromTokenATA,
      toTokenAccount,
      payer,
      transferAmount
    )
  );

  if (instructions.length == 0) {
    console.log("No need to create accounts");
    return [];
  }

  return instructions;
};
