import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import * as botLogic from './bot_logic';
import * as botLogicPumpfun from './bot_logic_pumpfun';
import * as botLogicPumpswap from './bot_logic_pumpswap';
import * as botLogicRaydiumAMM from './bot_logic_raydium_amm';
import * as botLogicRaydiumCPMM from './bot_logic_raydium_cpmm';
import * as botLogicRaydiumCLMM from './bot_logic_raydium_clmm';
import * as botLogicMeteoraDLMM from './bot_logic_meteora_dlmm';
import * as botLogicMeteoraDYN from './bot_logic_meteora_dyn';
import * as privateBot from './bot_private';
import * as database from './db';
import * as afx from './global';
import * as utils from './utils';
import * as constants from './uniconst';
import { generateNewWallet, getTokenData } from './utils';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as G from './utils/G';
import fs from "fs";
import path from 'path';
import { raydiumSDKList } from './amm/constants';

dotenv.config();

export const COMMAND_START = 'start';

export enum OptionCode {
  BACK = -100,
  CLOSE,
  TITLE,
  WELCOME = 0,
  MAIN_MENU,
  MAIN_HELP,
  MAIN_NEW_TOKEN,
  MAIN_START_STOP,
  MAIN_SET_TARGET,
  MAIN_SET_BUY_SELL_AMOUNT,
  MAIN_SET_DELAY_TIME,
  MAIN_SET_RATING,
  MAIN_SET_BUY_AMOUNT,
  MAIN_DIVIDE_SOL,
  MAIN_WITHDRAW_SOL,
  MAIN_SET_WALLET_SIZE,
  MAIN_REFRESH,
  MAIN_CANCEL,
  HELP_BACK,
  MENU_BACK,
  MENU_POOL_TYPE,
  POOL_TYPE_RAYDIUM_AMM,
  POOL_TYPE_RAYDIUM_CPMM,
  POOL_TYPE_RAYDIUM_CLMM,
  POOL_TYPE_METEORA_DLMM,
  POOL_TYPE_METEORA_DYN,
  POOL_TYPE_PUMPFUN,
  POOL_TYPE_PUMPSWAP,
}

export enum StateCode {
  IDLE = 1000,
  WAIT_WITHDRAW_WALLET_ADDRESS,
  WAIT_DIVIDE_SOL,
  WAIT_SET_WALLET_SIZE,
  WAIT_SET_TOKEN_SYMBOL,
  WAIT_SET_TARGET,
  WAIT_SET_RATING,
  WAIT_SET_BUY_AMOUNT,
  DELAY_SET_TIME,
  BUY_SELL_AMOUNT,
}

export let bot: TelegramBot;
export let myInfo: TelegramBot.User;
export const sessions = new Map();
export const stateMap = new Map();
export const tokenInfo = new Map();

export let busy = true;

export const setTokenPairInfo = (chatid: string, pairData: any) => {
  let item = tokenInfo.get(chatid);
  if (!item) tokenInfo.set(chatid, pairData);
};

export const getTokenPairInfo = (chatid: string) => {
  const item = tokenInfo.get(chatid);
  if (!item) return [];
  return item;
};

export const stateMap_setFocus = (chatid: string, state: any, data: any = {}) => {
  let item = stateMap.get(chatid);
  if (!item) {
    item = stateMap_init(chatid);
  }

  if (!data) {
    let focusData = {};
    if (item.focus && item.focus.data) {
      focusData = item.focus.data;
    }

    item.focus = { state, data: focusData };
  } else {
    item.focus = { state, data };
  }

  // stateMap.set(chatid, item)
};

export const stateMap_getFocus = (chatid: string) => {
  const item = stateMap.get(chatid);
  if (item) {
    let focusItem = item.focus;
    return focusItem;
  }

  return null;
};

export const stateMap_init = (chatid: string) => {
  let item = {
    focus: { state: StateCode.IDLE, data: { sessionId: chatid } },
    message: new Map(),
  };

  stateMap.set(chatid, item);

  return item;
};

export const stateMap_setMessage_Id = (chatid: string, messageType: number, messageId: number) => {
  let item = stateMap.get(chatid);
  if (!item) {
    item = stateMap_init(chatid);
  }

  item.message.set(`t${messageType}`, messageId);
  //stateMap.set(chatid, item)
};

export const stateMap_getMessage = (chatid: string) => {
  const item = stateMap.get(chatid);
  if (item) {
    let messageItem = item.message;
    return messageItem;
  }

  return null;
};

export const stateMap_getMessage_Id = (chatid: string, messageType: number) => {
  const messageItem = stateMap_getMessage(chatid);
  if (messageItem) {
    return messageItem.get(`t${messageType}`);
  }

  return null;
};

export const stateMap_get = (chatid: string) => {
  return stateMap.get(chatid);
};

export const stateMap_remove = (chatid: string) => {
  stateMap.delete(chatid);
};

export const stateMap_clear = () => {
  stateMap.clear();
};

export const json_buttonItem = (key: string, cmd: number, text: string) => {
  return {
    text: text,
    callback_data: JSON.stringify({ k: key, c: cmd }),
  };
};

const json_url_buttonItem = (text: string, url: string) => {
  return {
    text: text,
    url: url,
  };
};

const json_webapp_buttonItem = (text: string, url: any) => {
  return {
    text: text,
    web_app: {
      url,
    },
  };
};

export const removeMenu = async (chatId: string, messageType: number) => {
  const msgId = stateMap_getMessage_Id(chatId, messageType);

  if (msgId) {
    try {
      await bot.deleteMessage(chatId, msgId);
    } catch (error) {
      //afx.errorLog('deleteMessage', error)
    }
  }
};

// export const openMenu = async (chatId: string, messageType: number, menuTitle: string, json_buttons: any = []) => {
//   const keyboard = {
//     inline_keyboard: json_buttons,
//     resize_keyboard: false,
//     one_time_keyboard: true,
//     force_reply: true,
//   };

//   return new Promise(async (resolve, reject) => {
//     await removeMenu(chatId, messageType);

//     try {
//       let msg: TelegramBot.Message = await bot.sendMessage(chatId, menuTitle, {
//         reply_markup: keyboard,
//         parse_mode: 'HTML',
//         disable_web_page_preview: true,
//       });

//       stateMap_setMessage_Id(chatId, messageType, msg.message_id);
//       resolve({ messageId: msg.message_id, chatid: msg.chat.id });
//     } catch (error) {
//       afx.errorLog('openMenu', error);
//       resolve(null);
//     }
//   });
// };

const logo_path = path.resolve(__dirname, "../logo.png");
let logo_url = "";
let logo_check_time = 0;
let logo_file_id = "";
let logo_file_size = 0;

export const isImageAvailable = async (fileId: string) => {
  try {
    const file_info = await bot.getFile(fileId);
    // if (file_info.file_size == logo_file_size)
    return true;
  } catch (error) {
    console.error("Error checking file availability:", error);
    return false;
  }
};


export const getLogoFileId = async () => {
  if (!logo_file_id || Date.now() - logo_check_time > 60000) {
    // console.log("check failed getLogoFileId", logo_file_id);
    logo_check_time = Date.now();
    if (!logo_file_id || !(await isImageAvailable(logo_file_id))) {
      logo_file_id = "";
      logo_file_size = 0;
      return null;
    }
  }
  return logo_file_id;
};

export const openMenu = async (chatId: string, type: number, title: string, json_buttons: any = []) => {
  const keyboard = {
    inline_keyboard: json_buttons,
    resize_keyboard: false,
    one_time_keyboard: true,
    force_reply: true,
  };

  return new Promise(async (resolve, reject) => {
    try {
      await removeMenu(chatId, type);
      let msg;
      let file_id = await getLogoFileId();
      if (!file_id) {
        let fs_stream;
        try {
          fs_stream = fs.createReadStream(logo_path);
          console.log("-------------- Uploading Logo Image to Telegram Server ---------------- ");
          msg = await bot.sendPhoto(chatId, fs_stream, {
            caption: title,
            reply_markup: keyboard,
            parse_mode: "HTML",
            // disable_web_page_preview: true,
          });
          // console.log(msg.photo);
          if (msg.photo && msg.photo.length > 0) {
            logo_file_id = msg.photo[msg.photo.length - 1].file_id;
            logo_file_size = msg.photo[msg.photo.length - 1].file_size!;
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        // console.log("use cache image");
        msg = await bot.sendPhoto(chatId, file_id, {
          caption: title,
          reply_markup: keyboard,
          parse_mode: "HTML",
          // disable_web_page_preview: true,
        });
      }

      if (msg) {
        stateMap_setMessage_Id(chatId, type, msg.message_id);
        resolve({ messageId: msg.message_id, chatid: msg.chat.id });
      }
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
};

export const openMessage = async (chatId: string, bannerId: string, messageType: number, menuTitle: string) => {
  return new Promise(async (resolve, reject) => {
    await removeMenu(chatId, messageType);

    let msg: TelegramBot.Message;

    try {
      if (bannerId) {
        msg = await bot.sendPhoto(chatId, bannerId, {
          caption: menuTitle,
          parse_mode: 'HTML',
        });
      } else {
        msg = await bot.sendMessage(chatId, menuTitle, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }

      stateMap_setMessage_Id(chatId, messageType, msg.message_id);
      resolve({ messageId: msg.message_id, chatid: msg.chat.id });
    } catch (error) {
      afx.errorLog('openMenu', error);
      resolve(null);
    }
  });
};

export async function switchMenu(chatId: string, messageId: number, title: string, json_buttons: any) {
  const keyboard = {
    inline_keyboard: json_buttons,
    resize_keyboard: false,
    one_time_keyboard: true,
    force_reply: true,
  };

  return new Promise(async (resolve, reject) => {
    try {
      await removeMenu(chatId, messageId);
      let msg;
      let file_id = await getLogoFileId();
      if (!file_id) {
        let fs_stream;
        try {
          fs_stream = fs.createReadStream(logo_path);
          console.log("-------------- Uploading Logo Image to Telegram Server ---------------- ");
          msg = await bot.sendPhoto(chatId, fs_stream, {
            caption: title,
            reply_markup: keyboard,
            parse_mode: "HTML",
            // disable_web_page_preview: true,
          });
          // console.log(msg.photo);
          if (msg.photo && msg.photo.length > 0) {
            logo_file_id = msg.photo[msg.photo.length - 1].file_id;
            logo_file_size = msg.photo[msg.photo.length - 1].file_size!;
          }
        } catch (err) {
          console.error(err);
        }
      } else {
        // console.log("use cache image");
        msg = await bot.sendPhoto(chatId, file_id, {
          caption: title,
          reply_markup: keyboard,
          parse_mode: "HTML",
          // disable_web_page_preview: true,
        });
      }

      if (msg) {
        stateMap_setMessage_Id(chatId, messageId, msg.message_id);
        resolve({ messageId: msg.message_id, chatid: msg.chat.id });
      }
    } catch (error) {
      console.error(error);
      resolve(null);
    }
  });
}

export const replaceMenu = async (
  chatId: string,
  messageId: number,
  messageType: number,
  menuTitle: string,
  json_buttons: any = [],
) => {
  const keyboard = {
    inline_keyboard: json_buttons,
    resize_keyboard: true,
    one_time_keyboard: true,
    force_reply: true,
  };

  return new Promise(async (resolve, reject) => {
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch (error) {
      //afx.errorLog('deleteMessage', error)
    }

    await removeMenu(chatId, messageType);

    try {
      let msg: TelegramBot.Message = await bot.sendMessage(chatId, menuTitle, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      stateMap_setMessage_Id(chatId, messageType, msg.message_id);
      resolve({ messageId: msg.message_id, chatid: msg.chat.id });
    } catch (error) {
      afx.errorLog('openMenu', error);
      resolve(null);
    }
  });
};

export const get_menuTitle = (sessionId: string, subTitle: string) => {
  const session = sessions.get(sessionId);
  if (!session) {
    return 'ERROR ' + sessionId;
  }

  let result =
    session.type === 'private'
      ? `@${session.username}'s configuration setup`
      : `@${session.username} group's configuration setup`;

  if (subTitle && subTitle !== '') {
    //subTitle = subTitle.replace('%username%', `@${session.username}`)
    result += `\n${subTitle}`;
  }

  return result;
};

export const removeMessage = async (sessionId: string, messageId: number) => {
  if (sessionId && messageId) {
    try {
      await bot.deleteMessage(sessionId, messageId);
    } catch (error) {
      //console.error(error)
    }
  }
};

export const sendReplyMessage = async (chatid: string, message: string) => {
  try {
    const keyboard = {
      inline_keyboard: [[json_buttonItem(chatid, OptionCode.MENU_BACK, '➖ Cancel')]],
      resize_keyboard: false,
      one_time_keyboard: false,
      force_reply: true,
    };
    let data: any = {
      parse_mode: 'HTML',
      disable_forward: true,
      disable_web_page_preview: true,
      //  reply_markup: {force_reply: true},
      reply_markup: keyboard,
    };

    const msg = await bot.sendMessage(chatid, message, data);
    return {
      cancel_id: msg.message_id,
      chatid: msg.chat ? msg.chat.id : null,
    };
  } catch (error) {
    afx.errorLog('sendReplyMessage', error);
    return null;
  }
};

export const sendMessage = async (chatid: string, message: string, info: any = {}) => {
  try {
    let data: any = { parse_mode: 'HTML' };

    data.disable_web_page_preview = true;
    data.disable_forward = true;

    if (info && info.message_thread_id) {
      data.message_thread_id = info.message_thread_id;
    }

    const msg = await bot.sendMessage(chatid, message, data);
    return {
      messageId: msg.message_id,
      chatid: msg.chat ? msg.chat.id : null,
    };
  } catch (error: any) {
    if (error.response && error.response.body && error.response.body.error_code === 403) {
      info.blocked = true;
      if (error?.response?.body?.description == 'Forbidden: bot was blocked by the user') {
        // database.removeUser({ chatid });
        // sessions.delete(chatid);
      }
    }

    G.log(error?.response?.body);
    afx.errorLog('sendMessage', error);
    return null;
  }
};

export const sendInfoMessage = async (chatid: string, message: string) => {
  let json = [[json_buttonItem(chatid, OptionCode.CLOSE, '✖️ Close')]];

  return sendOptionMessage(chatid, message, json);
};

export const sendOptionMessage = async (chatid: string, message: string, option: any) => {
  try {
    const keyboard = {
      inline_keyboard: option,
      resize_keyboard: true,
      one_time_keyboard: true,
    };

    const msg = await bot.sendMessage(chatid, message, {
      reply_markup: keyboard,
      disable_web_page_preview: true,
      parse_mode: 'HTML',
    });
    return {
      messageId: msg.message_id,
      chatid: msg.chat ? msg.chat.id : null,
    };
  } catch (error) {
    afx.errorLog('sendOptionMessage', error);

    return null;
  }
};

export const pinMessage = (chatid: string, messageId: number) => {
  try {
    bot.pinChatMessage(chatid, messageId);
  } catch (error) {
    console.error(error);
  }
};

export const checkWhitelist = (chatid: string) => {
  return true;
};

export const getMainMenuMessage = async (sessionId: string): Promise<string> => {
  const session = sessions.get(sessionId);
  if (!session || !session.addr) {
    return '';
  }

  let token: any = null;
  if (session.addr != '') {
    token = await database.selectToken({
      chatid: sessionId,
      addr: session.addr,
    });
  }
  const user: any = await database.selectUser({ chatid: sessionId });
  const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet);
  const SOLBalance: number = await utils.getWalletSOLBalance(depositWallet);
  console.log('Sol Bal = ', SOLBalance, session.addr, sessionId);
  let depositSol: number = 0.5;

  const newSolPrice = await utils.getSOLPrice();

  const pairInfo: any = await utils.getTokenDatawithPairaddress(session.addr, session.pairAddress, depositWallet.wallet);
  const pairData = pairInfo.data;
  if (!pairData) {
    return `🏅 Welcome to ${process.env.BOT_TITLE} 🏅.`;
  }

  let poolType = '-';
  if (pairData.labels)
    poolType = pairData.labels[0];
  let MESSAGE = `🏅 Welcome to ${process.env.BOT_TITLE} 🏅.

  Solana Raydium(AMM, CPMM, CLMM) & Meteora(DYN & DLMM) & Pump.fun & Pumpswap Volume Bot

  🟢 Token address: 
  <code>${token.addr}</code>`;

  if (pairData.pairAddress && pairData.pairAddress != '') {
    MESSAGE += `  
  🧿 Pair address: 
  <code>${pairData.pairAddress}</code>`;
  }
  MESSAGE += `
  🔗 Pair: ${token.symbol} / SOL (${pairData.dexId} : ${poolType})

  🕐 Delay Time: ${token.delayTime} s
  💸 Buy SOL Amount: ${token.buysellAmount / LAMPORTS_PER_SOL} SOL

  ⌛ Bot worked: ${utils.roundDecimal(token.workingTime / constants.MINUTE, 1)} min
  💹 Bot made: ${utils.roundBigUnit(token.currentVolume * newSolPrice, 2)}

  💳 Your Deposit Wallet: 
  <code>${depositWallet.publicKey}</code>
  💰 Balance: ${utils.roundSolUnit(SOLBalance, 3)}
  Please deposit ${depositSol} SOL at least into this wallet.

  ${constants.BOT_FOOTER_DASH}`;
  return MESSAGE;
};

export const json_main = async (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) {
    return '';
  }

  const token: any = await database.selectToken({
    chatid: sessionId,
    addr: session.addr,
  });
  const itemData = `${sessionId}`;
  const json = [
    [json_buttonItem(itemData, OptionCode.MAIN_START_STOP, token?.status ? '⏹️ Stop' : '▶️ Start')],
    [json_buttonItem(itemData, OptionCode.MAIN_SET_DELAY_TIME, `🕐 Set Delay Time`)],
    [json_buttonItem(itemData, OptionCode.MAIN_SET_BUY_SELL_AMOUNT, `💸 Set Buy Amount`)],
    [
      json_buttonItem(itemData, OptionCode.MAIN_WITHDRAW_SOL, '💵 Withdraw'),
      json_buttonItem(itemData, OptionCode.MAIN_REFRESH, '🔄 Refresh'),
    ]
  ];

  const childWallets: any = await database.selectWallets({}, 1);
  const childFirstWallet: any = utils.getWalletFromPrivateKey(childWallets[0].prvKey);
  const childFirstSolAmount: number = parseFloat((await utils.getWalletSOLBalance(childFirstWallet)).toFixed(5));

  // G.log('❓ childFirstSolAmount:', childFirstWallet.publicKey, childFirstSolAmount);

  let needPrepare = false;
  if (childFirstSolAmount < 0.0001) {
    needPrepare = true;
  }

  if (needPrepare)
    json.push([json_buttonItem(itemData, OptionCode.MAIN_DIVIDE_SOL, '💦 Prepare(only once for bot service init)')]);

  return { title: '', options: json };
};

export const json_help = async (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const title = `📕 Help:

  This bot uses 8 wallets for volume increasing.
  You have to deposit some sol to your deposit wallet.

  When bot starts working, bot takes tax from deposit wallet.
  Tax is 10 * Target Volume Amount SOL

  🎚️ Bot Settings:
  🔹Target Volume Amount: This spec is amount of volume bot has to achieve. Bot stop automatically when achieves target.
  🔹TRX Rating: This spec is transaction count per min.
  🔹Set Wallet Size: This spec is size of wallet bot uses.
  🔹Buy with SOL: This spec is amount of SOL to buy per transaction.

  You can withdraw SOL from deposit wallet

  If need more features, cotact here: @GreenBlockBuilder
  ${constants.BOT_FOOTER_DASH}`;

  let json = [[json_buttonItem(sessionId, OptionCode.HELP_BACK, 'Back to Main')]];
  return { title: title, options: json };
};

export const openConfirmMenu = async (
  sessionId: string,
  pairData: any,
) => {
  const menu: any = await json_pool(sessionId, pairData);
  if (menu) {
    await openMenu(sessionId, OptionCode.MENU_POOL_TYPE, menu.title, menu.options);
  }
};

export const json_pool = async (sessionId: string, pairData: any) => {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const title = `😎 Please select your pool type`;
  const json: any = [];
  for (let i = 0; i < pairData.data.length; i++) {
    // console.log(pairData.data[i].dexId, pairData.data[i].labels);
    const dexId = pairData.data[i].dexId;
    const poolType = pairData.data[i].labels[0];

    let optionCode = OptionCode.POOL_TYPE_RAYDIUM_AMM;
    if (dexId == 'raydium' && poolType == 'AMM') {
      optionCode = OptionCode.POOL_TYPE_RAYDIUM_AMM;
    }
    else if (dexId == 'raydium' && poolType == 'CPMM') {
      optionCode = OptionCode.POOL_TYPE_RAYDIUM_CPMM;
    }
    else if (dexId == 'raydium' && poolType == 'CLMM') {
      optionCode = OptionCode.POOL_TYPE_RAYDIUM_CLMM;
    }
    else if (dexId == 'meteora' && poolType == 'DLMM') {
      optionCode = OptionCode.POOL_TYPE_METEORA_DLMM;
    }
    else if (dexId == 'meteora' && poolType == 'DYN') {
      optionCode = OptionCode.POOL_TYPE_METEORA_DYN;
    }
    else if (dexId == 'pumpfun') {
      optionCode = OptionCode.POOL_TYPE_PUMPFUN;
    }
    else if (dexId == 'pumpswap') {
      optionCode = OptionCode.POOL_TYPE_PUMPSWAP;
    }

    json.push([json_buttonItem(sessionId, optionCode, `${dexId} -- ${poolType}`)])
  }
  return { title, options: json };
};

export const createSession = async (
  chatid: string,
  username: string,
  // type: string
) => {
  let session: any = {};

  session.chatid = chatid;
  session.username = username;
  session.addr = '';
  const wallet = generateNewWallet();
  session.depositWallet = wallet?.secretKey;

  await setDefaultSettings(session);
  console.log('Create session...');
  sessions.set(session.chatid, session);
  showSessionLog(session);

  return session;
};

export function showSessionLog(session: any) {
  if (session.type === 'private') {
    G.log(
      `@${session.username} user${session.wallet ? ' joined' : "'s session has been created (" + session.chatid + ')'}`,
    );
  } else if (session.type === 'group') {
    G.log(
      `@${session.username} group${session.wallet ? ' joined' : "'s session has been created (" + session.chatid + ')'
      }`,
    );
  } else if (session.type === 'channel') {
    G.log(`@${session.username} channel${session.wallet ? ' joined' : "'s session has been created"}`);
  }
}

export const defaultConfig = {
  vip: 0,
};

export const setDefaultSettings = async (session: any) => {
  session.timestamp = new Date().getTime();

  G.log('==========setDefaultSettings===========');

  const depositWallet = utils.generateNewWallet();
  session.depositWallet = depositWallet?.secretKey;
};

export async function init() {
  busy = true;
  bot = new TelegramBot(process.env.BOT_TOKEN as string, {
    polling: true,
  });

  bot.getMe().then((info: TelegramBot.User) => {
    myInfo = info;
  });

  bot.on('message', async (message: any) => {
    // G.log(`========== message ==========`);
    const msgType = message?.chat?.type;
    if (msgType === 'private') {
      privateBot.procMessage(message, database);
    } else if (msgType === 'group' || msgType === 'supergroup') {
    } else if (msgType === 'channel') {
    }
  });

  bot.on('callback_query', async (callbackQuery: TelegramBot.CallbackQuery) => {
    // G.log('========== callback query ==========')
    const message = callbackQuery.message;
    if (!message) {
      return;
    }
    const option = JSON.parse(callbackQuery.data as string);
    let chatid = message.chat.id.toString();
    executeCommand(chatid, message.message_id, callbackQuery.id, option);
  });

  G.log('========bot started========');
  busy = false;
}

export const sessionInit = async () => {
  await database.init();

  const countWallets = (await database.countWallets()) as number;
  G.log('countWallets:', countWallets);
  for (let i = countWallets; i < constants.MAX_WALLET_SIZE; i++) {
    const botWallet = utils.generateNewWallet();
    await database.addWallet({ prvKey: botWallet?.secretKey });
  }

  const users: any = await database.selectUsers();
  let loggedin = 0;
  let session;
  for (const user of users) {
    session = JSON.parse(JSON.stringify(user));
    session = utils.objectDeepCopy(session, ['_id', '__v']);

    console.log('Session Init...');
    sessions.set(session.chatid, session);
  }

  const tokens: any = await database.selectTokens();
  for (let token of tokens) {
    if (token) {
      if (token.status) {
        token.status = false;
        await token.save();
      }
      session.addr = token.addr;
      sessions.set(session.chatid, session);
    }
  }

  G.log(`${users.length} users, ${loggedin} logged in`);
};

export const reloadCommand = async (chatid: string, messageId: number, callbackQueryId: string, option: any) => {
  await removeMessage(chatid, messageId);
  executeCommand(chatid, messageId, callbackQueryId, option);
};

export const executeCommand = async (
  chatid: string,
  _messageId: number | undefined,
  _callbackQueryId: string | undefined,
  option: any,
) => {
  const cmd = option.c;
  const id = option.k;

  const session = sessions.get(chatid);
  if (!session) {
    return;
  }

  //stateMap_clear();

  let messageId = Number(_messageId ?? 0);
  let callbackQueryId = _callbackQueryId ?? '';

  const sessionId: string = chatid;
  let cancel_id: number = 0;
  const stateData: any = { sessionId, messageId, callbackQueryId, cmd, cancel_id };

  stateData.message_id = messageId;
  stateData.callback_query_id = callbackQueryId;

  try {
    if (cmd === OptionCode.MAIN_NEW_TOKEN) {
      const { exist, symbol, decimal }: any = await utils.getTokenInfo(session.addr);
      if (!exist) {
        await openMessage(chatid, '', 0, `❌ Token is invalide. Please try again later.`);
        return;
      }
      const registered = await botLogic.registerToken(chatid, session.addr, symbol, decimal);
      if (registered === constants.ResultCode.SUCCESS) {
        await removeMessage(chatid, messageId);
        await openMessage(chatid, '', 0, `✔️ Token is registered successfully.`);
        const menu: any = await json_main(chatid);
        let title: string = await getMainMenuMessage(chatid);

        await openMenu(chatid, cmd, title, menu.options);
      } else {
        await openMessage(chatid, '', 0, `❌ Token is not registered. Please try again later.`);
      }
    } else if (cmd === OptionCode.MAIN_REFRESH) {
      const user: any = await database.selectUser({ chatid });
      const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet);

      const pairData = await getTokenData(session.addr, depositWallet.wallet);
      if (pairData.data.length === 0) return;

      setTokenPairInfo(chatid, pairData.data);

      const menu: any = await json_main(sessionId);
      let title: string = await getMainMenuMessage(sessionId);

      switchMenu(chatid, messageId, title, menu.options);
    } else if (cmd === OptionCode.MAIN_MENU) {
      const menu: any = await json_main(sessionId);
      let title: string = await getMainMenuMessage(sessionId);

      await openMenu(chatid, cmd, title, menu.options);
    } else if (cmd === OptionCode.POOL_TYPE_RAYDIUM_AMM) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "raydium" && item.labels[0] === "AMM");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.POOL_TYPE_RAYDIUM_CPMM) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "raydium" && item.labels[0] === "CPMM");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.POOL_TYPE_RAYDIUM_CLMM) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "raydium" && item.labels[0] === "CLMM");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.POOL_TYPE_METEORA_DLMM) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "meteora" && item.labels[0] === "DLMM");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.POOL_TYPE_METEORA_DYN) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "meteora" && item.labels[0] === "DYN");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.POOL_TYPE_PUMPSWAP) {
      if (session.pairData) {
        const pairItem = session.pairData.find((item) => item.dexId === "pumpswap");
        session.dexId = pairItem.dexId;
        session.poolType = pairItem.labels[0];
        session.pairAddress = pairItem.pairAddress;
        await database.updateUser(session);

        await removeMessage(chatid, messageId);
        const token: any = await database.selectToken({ chatid, addr: session.addr });
        if (token) {
          await executeCommand(chatid, messageId, undefined, {
            c: OptionCode.MAIN_MENU,
            k: 1,
          });
        } else {
          if (token && token.status) {
            openMessage(
              chatid,
              '',
              0,
              `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
            );
          } else {
            executeCommand(chatid, messageId, undefined, {
              c: OptionCode.MAIN_NEW_TOKEN,
              k: 1,
            });
          }
        }
      }
    } else if (cmd === OptionCode.MAIN_START_STOP) {
      if (!session.addr) {
        bot.answerCallbackQuery(callbackQueryId, {
          text: `😢 Sorry, Please input token address again`,
        });
        return;
      }

      const user: any = await database.selectUser({ chatid: sessionId });
      const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet);
      const SOLBalance: number = await utils.getWalletSOLBalance(depositWallet);
      if (SOLBalance === 0) {
        bot.answerCallbackQuery(callbackQueryId, {
          text: `😢 Sorry, There is not enough sol in deposit wallet. please deposit enough sol to start and try again. 0.5 Sol at least.`,
        });
        return;
      }

      bot.answerCallbackQuery(callbackQueryId, {
        text: `⏱️ Please wait a sec...`,
      });
      // bot start or stop
      console.log('Waiting for start...', chatid, session.addr);
      const token: any = await database.selectToken({
        chatid,
        addr: session.addr,
      });
      let result = 0;
      const pairInfo: any = await utils.getTokenDatawithPairaddress(session.addr, session.pairAddress, depositWallet.wallet);
      const pairData = pairInfo.data;

      if (!token || !pairData) {
        bot.answerCallbackQuery(callbackQueryId, {
          text: `😢 Sorry, Session Error`,
        });
        return;
      }

      console.log('Start Bot: Sol Balance = ', SOLBalance, 'Compare Amount = ', 0.1);
      if (session.dexId === 'pumpfun') {
        if (token.status) {
          await botLogicPumpfun.stopBot(chatid, session.addr);
        } else if (token.status === false) {
          result = await botLogicPumpfun.startBot(chatid, session.addr);
        }
      }
      else if (session.dexId === 'pumpswap') {
        if (token.status) {
          await botLogicPumpswap.stopBot(chatid, session.addr);
        } else if (token.status === false) {
          result = await botLogicPumpswap.startBot(chatid, session.addr);
        }
      }
      else if (session.dexId === 'raydium' && session.poolType === 'AMM') {
        const pool = await botLogicRaydiumAMM.getPoolInfo(afx.web3Conn, session.addr, pairData.pairAddress);
        if (token.status) {
          await botLogicRaydiumAMM.stopBot(chatid, session.addr, pool);
        } else if (token.status === false) {
          result = await botLogicRaydiumAMM.startBot(chatid, session.addr, pool);
        }
      }
      else if (session.dexId === 'raydium' && session.poolType === 'CPMM') {
        await utils.initSDKs(depositWallet.wallet.publicKey);
        const pool = await botLogicRaydiumCPMM.getPoolInfo(raydiumSDKList.get(depositWallet.publicKey), session.addr);
        if (token.status) {
          await botLogicRaydiumCPMM.stopBot(chatid, session.addr, pool);
        } else if (token.status === false) {
          result = await botLogicRaydiumCPMM.startBot(chatid, session.addr, pool);
        }
      }
      else if (session.dexId === 'raydium' && session.poolType === 'CLMM') {
        await utils.initSDKs(depositWallet.wallet.publicKey);
        const pool = await botLogicRaydiumCLMM.getPoolInfo(raydiumSDKList.get(depositWallet.publicKey), session.addr);
        if (token.status) {
          await botLogicRaydiumCLMM.stopBot(chatid, session.addr, pool);
        } else if (token.status === false) {
          result = await botLogicRaydiumCLMM.startBot(chatid, session.addr, pool);
        }
      }
      else if (session.dexId === 'meteora' && session.poolType === 'DYN') {
        const pool = await botLogicMeteoraDYN.getPoolInfo(chatid, pairData.pairAddress);
        if (token.status) {
          await botLogicMeteoraDYN.stopBot(chatid, session.addr, pool);
        } else if (token.status === false) {
          result = await botLogicMeteoraDYN.startBot(chatid, session.addr, pool);
        }
      }
      else if (session.dexId === 'meteora' && session.poolType === 'DLMM') {
        const pool = await botLogicMeteoraDLMM.getPoolInfo(chatid, pairData.pairAddress);
        if (token.status) {
          await botLogicMeteoraDLMM.stopBot(chatid, session.addr, pool);
        } else if (token.status === false) {
          result = await botLogicMeteoraDLMM.startBot(chatid, session.addr, pool);
        }
      }

      //
      switch (result) {
        case constants.ResultCode.USER_INSUFFICIENT_SOL:
        case constants.ResultCode.USER_INSUFFICIENT_ENOUGH_SOL:
        case constants.ResultCode.USER_INSUFFICIENT_JITO_FEE_SOL:
          openMessage(
            chatid,
            '',
            0,
            `😢 Sorry, There is not enough sol in deposit wallet. please deposit enough sol to start and try again. 0.5 Sol at least.`,
          );
          break;
        default:
          break;
      }

      const menu: any = await json_main(sessionId);
      let title: string = await getMainMenuMessage(sessionId);

      await switchMenu(chatid, messageId, title, menu.options);
    } else if (cmd === OptionCode.MAIN_SET_TARGET) {
      const msgData = await sendReplyMessage(
        stateData.sessionId,
        `📨 Reply to this message with amount of volume to make.\nMin: 0.1`,
      );
      stateData.cancel_id = msgData?.cancel_id;
      stateData.menu_id = messageId;
      stateMap_setFocus(chatid, StateCode.WAIT_SET_TARGET, stateData);
    } else if (cmd === OptionCode.MAIN_SET_BUY_SELL_AMOUNT) {
      const msgData = await sendReplyMessage(
        stateData.sessionId,
        `📨 Reply to this message with amount of Sol for each trade.\nExample: 2.5 for 2.5 SOL`,
      );
      G.log('sendReply-------------------------1');
      stateData.cancel_id = msgData?.cancel_id;
      stateData.menu_id = messageId;
      stateMap_setFocus(chatid, StateCode.BUY_SELL_AMOUNT, stateData);
    } else if (cmd === OptionCode.MAIN_SET_DELAY_TIME) {
      const msgData = await sendReplyMessage(
        stateData.sessionId,
        `⏱️ Please enter period per each trade in seconds. Example: 15 for 15s`,
      );
      stateData.cancel_id = msgData?.cancel_id;
      stateData.menu_id = messageId;
      stateMap_setFocus(chatid, StateCode.DELAY_SET_TIME, stateData);
    } else if (cmd === OptionCode.MAIN_WITHDRAW_SOL) {
      const msgData = await sendReplyMessage(
        stateData.sessionId,
        `⏱️ Reply to this message with your phantom wallet address to withdraw.`,
      );
      stateData.cancel_id = msgData?.cancel_id;
      stateData.menu_id = messageId;
      stateMap_setFocus(chatid, StateCode.WAIT_WITHDRAW_WALLET_ADDRESS, stateData);
    } else if (cmd === OptionCode.MAIN_DIVIDE_SOL) {
      await sendReplyMessage(
        stateData.sessionId,
        `📨 Reply to this message with amount of SOL(0.002) to disperse ${constants.MAX_WALLET_SIZE} wallets.`,
      );
      stateMap_setFocus(chatid, StateCode.WAIT_DIVIDE_SOL, stateData);
    } else if (cmd === OptionCode.MENU_BACK) {
      await removeMessage(sessionId, messageId);
      const menu: any = await json_main(sessionId);
      let title: string = await getMainMenuMessage(sessionId);

      await openMenu(chatid, cmd, title, menu.options);
    }
  } catch (error) {
    G.log(error);
    sendMessage(chatid, `😢 Sorry, Bot server restarted. Please try again with input token address 😉`);
    if (callbackQueryId)
      await bot.answerCallbackQuery(callbackQueryId, {
        text: `😢 Sorry, Bot server restarted. Please try again with input token address 😉`,
      });

    // stateData.cancel_id = msgData?.cancel_id;
    stateData.menu_id = messageId;
    stateMap_setFocus(chatid, StateCode.WAIT_SET_TOKEN_SYMBOL, stateData);
  }
};
