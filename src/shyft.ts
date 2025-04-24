import dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { Liquidity, LIQUIDITY_STATE_LAYOUT_V4, MAINNET_PROGRAM_ID, MARKET_STATE_LAYOUT_V3, poolKeys2JsonInfo, Token } from "@raydium-io/raydium-sdk";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
// import { gql, GraphQLClient } from "graphql-request";

dotenv.config();

// const endpoint = `https://programs.shyft.to/v0/graphql?api_key=${process.env.SHYFT_API_KEY}`; //Shyft's gQl endpoint

// export async function getPoolInfo(conn: Connection, token: string) {
//   const pool: any = await getPoolInfoShyft(token);
//   if (!pool) return null;
//   // return poolKeys2JsonInfo(await addMarketInfo(pool));
//   let tokenDecimals = pool.baseMint == "So11111111111111111111111111111111111111112" ? pool.quoteDecimal : pool.baseDecimal;
//   return poolKeys2JsonInfo(await getPoolKeysFromAddress(conn, pool.pubkey, token, tokenDecimals));
// }

export async function getPoolKeysFromAddress(conn: Connection, poolAddress: string, token: string, tokenDecimals: number = 0) {
  if (!poolAddress) return null;
  const baseMint = new PublicKey(token);
  if (!tokenDecimals) {
    const baseMintInfo = await getMint(conn, baseMint);
    tokenDecimals = baseMintInfo.decimals;
  }
  const baseToken = new Token(TOKEN_PROGRAM_ID, token, tokenDecimals);
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

  return poolKeys;
}

// const graphQLClient = new GraphQLClient(endpoint, {
//   method: `POST`,
//   jsonSerializer: {
//     parse: JSON.parse,
//     stringify: JSON.stringify,
//   },
// }); //Initialize gQL Client

// export async function getPoolInfoShyft(baseMint: string, quoteMint: string = "So11111111111111111111111111111111111111112") {
//   // We only fetch fields necessary for us
//   const query = gql`
//     query MyQuery($where: Raydium_LiquidityPoolv4_bool_exp) {
//   Raydium_LiquidityPoolv4(
//     where: { _or: [{ baseMint: {_eq: ${JSON.stringify(baseMint)}}, quoteMint: {_eq: ${JSON.stringify(quoteMint)}} },
//                   { baseMint: {_eq: ${JSON.stringify(quoteMint)}}, quoteMint: {_eq: ${JSON.stringify(baseMint)}} }]}
//   ) {
//     amountWaveRatio
//     baseDecimal
//     baseLotSize
//     baseMint
//     baseNeedTakePnl
//     baseTotalPnl
//     baseVault
//     depth
//     lpMint
//     lpReserve
//     lpVault
//     marketId
//     marketProgramId
//     maxOrder
//     maxPriceMultiplier
//     minPriceMultiplier
//     minSeparateDenominator
//     minSeparateNumerator
//     minSize
//     nonce
//     openOrders
//     orderbookToInitTime
//     owner
//     pnlDenominator
//     pnlNumerator
//     poolOpenTime
//     punishCoinAmount
//     punishPcAmount
//     quoteDecimal
//     quoteLotSize
//     quoteMint
//     quoteNeedTakePnl
//     quoteTotalPnl
//     quoteVault
//     resetFlag
//     state
//     status
//     swapBase2QuoteFee
//     swapBaseInAmount
//     swapBaseOutAmount
//     swapFeeDenominator
//     swapFeeNumerator
//     swapQuote2BaseFee
//     swapQuoteInAmount
//     swapQuoteOutAmount
//     systemDecimalValue
//     targetOrders
//     tradeFeeDenominator
//     tradeFeeNumerator
//     volMaxCutRatio
//     withdrawQueue
//     pubkey
//   }
// }`;
//   try {
//     const response: any = await graphQLClient.request(query);
//     const pools = response.Raydium_LiquidityPoolv4;
//     // if (pools && pools.length) return poolKeys2JsonInfo(await addMarketInfo(pools[0]));
//     if (pools && pools.length) return pools[0];
//     else return null;
//   } catch (error) {
//     console.error("Error fetching Raydium pool info:", error);
//     return null;
//   }
// }
