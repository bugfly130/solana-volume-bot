import assert from 'assert';
import dotenv from 'dotenv';
import * as instance from './bot';
import { OptionCode, StateCode } from './bot';
import * as botLogic from './bot_logic';
import * as utils from './utils';
import * as G from './utils/G';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getTokenData } from './utils';

dotenv.config();

const parseCode = async (database: any, session: any, wholeCode: string) => {
  let codes: string[] = wholeCode.split("_");

  if (codes.length % 2 === 0) {
    for (let i = 0; i < codes.length; i += 2) {
      const type = codes[i];
      const code = codes[i + 1];

      if (type === "ref") {
        if (!session.referredBy) {
          let referredBy: string = "";

          referredBy = utils.decodeChatId(code);
          if (referredBy === "" || referredBy === session.chatid) {
            continue;
          }

          if (referredBy.length > 0) {
            const refSession = instance.sessions.get(referredBy);
            if (refSession) {
              console.log(
                `${session.username} has been invited by @${refSession.username} (${refSession.chatid})`
              );
            }

            instance.sendInfoMessage(
              referredBy,
              `Great news! You have invited @${session.username}
You can earn 10% of their earning forever!`
            );

            session.referredBy = referredBy;
            session.referredTimestamp = new Date().getTime();

            await database.updateUser(session);
          }
        }
      }
    }
  }
  return false;
};

export const toastMessage = async (chatid: any, message: string) => {
  const msgInvalidAddress = await instance.sendMessage(chatid, message);

  if (msgInvalidAddress) {
    setTimeout(() => instance.removeMessage(chatid, msgInvalidAddress.messageId), 1000);
  }
};

export const procMessage = async (message: any, database: any) => {
  let chatid = message.chat.id.toString();
  let session = instance.sessions.get(chatid);
  let userName = message?.chat?.username;
  let messageId = message?.messageId;
  G.log('message-procMessage:', instance.busy);

  if (instance.busy) {
    return;
  }

  if (message.photo) {
    processSettings(message, database);
  }

  if (message.animation) {
    processSettings(message, database);
  }

  if (!message.text) return;

  let command = message.text;
  if (message.entities) {
    for (const entity of message.entities) {
      if (entity.type === 'bot_command') {
        command = command.substring(entity.offset, entity.offset + entity.length);
        break;
      }
    }
  }

  if (command.startsWith('/')) {
    instance.stateMap_init(chatid);
    if (!session) {
      if (!userName) {
        G.log(`Rejected anonymous incoming connection. chatid = ${chatid}`);
        instance.sendMessage(
          chatid,
          `Welcome to ${process.env.BOT_TITLE} bot. We noticed that your telegram does not have a username. Please create username [Setting]->[Username] and try again.`,
        );
        return;
      }

      G.log(`@${userName} session has been permitted through whitelist`);

      session = await instance.createSession(chatid, userName);
      await database.updateUser(session);
    }

    if (userName && session.username !== userName) {
      session.username = userName;
      await database.updateUser(session);
    }

    let params = message.text.split(' ');
    if (params.length > 0 && params[0] === command) {
      params.shift();
    }

    command = command.slice(1);

    if (command === instance.COMMAND_START) {
      console.log('userName:', userName);
      if (params.length == 1 && params[0].trim() !== '') {
        let wholeCode = params[0].trim();
        await parseCode(database, session, wholeCode);

        await instance.removeMessage(chatid, message.message_id);
      }

      instance.openMessage(chatid, '', 0, `🙌 Welcome to the BallotAI Ballot Access Bot for the future of decentralized government! 
⛓️✍🏼🗳️📜⚖️

🤖This bot offers market leading functionality and customisation. You are now able to generate volume from over 5000 unique wallets, for no additional cost, as we pay all transaction fees!🙏

💰Refer a project or individual with the below link, and earn 50% of the new clients fees forever while ensuring our DEV team gets 15% for support, 15% to our DAO-Launchpad for our “Policy Tokens” and 20% to the DEX for locked liquidity. 💎

<code>https://t.me/${process.env.BOT_USERNAME}?start=ref_${utils.encodeChatId(
          chatid
        )}</code>

⚜️To get started, please enter the token address:`);
    }
  }
  else {
    if (!session) {
      G.log(`@${userName} session has been permitted through whitelist`);
      session = await instance.createSession(chatid, userName);
      await database.updateUser(session);
    }

    const stateData = instance.stateMap_getFocus(chatid);
    if (stateData != null && stateData.state != StateCode.IDLE) {
      processSettings(message, database);
      return;
    }

    if (!utils.isValidAddress(command)) {
      await instance.removeMessage(chatid, messageId);
      await toastMessage(chatid, '⚠️ Invalid token address.');
      return;
    }

    session.addr = command;
    await database.updateUser(session);

    const user: any = await database.selectUser({ chatid });
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet);

    const pairData = await getTokenData(command, depositWallet.wallet);
    if (pairData.result === false) {
      await toastMessage(chatid, '⚠️ Invalid Meteora token address.');
      await instance.removeMessage(chatid, messageId);
      return;
    }

    if (pairData.data.length === 0) {
      await toastMessage(chatid, '⚠️ Not Found Pool.');
      await instance.removeMessage(chatid, messageId);
      return;
    }

    await instance.removeMessage(chatid, messageId);
    
    session.pairData = pairData.data;
    if (pairData.data.length > 1) {
      instance.openConfirmMenu(chatid, pairData);
      return;
    };

    // console.log(pairData.data);
    session.dexId = pairData.data[0].dexId;
    session.poolType = pairData.data[0].labels[0];
    session.pairAddress = pairData.data[0].pairAddress;
    await database.updateUser(session);

    const token: any = await database.selectToken({ chatid, addr: command });
    if (token) {
      await instance.executeCommand(chatid, messageId, undefined, {
        c: OptionCode.MAIN_MENU,
        k: 1,
      });
    } else {
      if (token && token.status) {
        await instance.removeMessage(chatid, message.message_id);
        instance.openMessage(
          chatid,
          '',
          0,
          `⚠️ Warning, Bot is working now. If you need to start with new token, please stop the bot and try again.`,
        );
      } else {
        instance.executeCommand(chatid, messageId, undefined, {
          c: OptionCode.MAIN_NEW_TOKEN,
          k: 1,
        });
      }
    }
  }
};

const processSettings = async (msg: any, database: any) => {
  const sessionId = msg.chat?.id.toString();
  let messageId = msg?.message_id;

  const session = instance.sessions.get(sessionId);
  if (!session) {
    return;
  }

  let stateNode = instance.stateMap_getFocus(sessionId);
  if (!stateNode) {
    instance.stateMap_setFocus(sessionId, StateCode.IDLE, {
      sessionId: sessionId,
    });
    stateNode = instance.stateMap_get(sessionId);

    assert(stateNode);
  }

  const stateData = stateNode.data;

  if (stateNode.state === StateCode.WAIT_WITHDRAW_WALLET_ADDRESS) {
    const user: any = await database.selectUser({ chatid: sessionId });
    const depositWallet: any = utils.getWalletFromPrivateKey(user.depositWallet);
    const SOLBalance: number = await utils.getWalletSOLBalance(depositWallet);
    if (SOLBalance < 0.005) {
      instance.openMessage(sessionId, '', 0, `⛔ Sorry, Deposit wallet has not enough sol to withdraw!`);
      return;
    }

    const addr = msg.text.trim();
    if (!addr || addr === '' || !utils.isValidAddress(addr)) {
      instance.openMessage(sessionId, '', 0, `⛔ Sorry, the token address you entered is invalid. Please try again`);
      return;
    }
    // process wallet withdraw
    await G.sleep(500);
    await instance.removeMessage(sessionId, messageId);
    await botLogic.setWithdrawAddress(sessionId, addr);
    const token: any = await database.selectToken({ chatid: sessionId, addr: session.addr });
    if (token && token.status === true) {
      instance.openMessage(sessionId, '', 0, `⛔ Sorry, Please stop the bot`);
      return;
    }

    await instance.removeMessage(sessionId, stateData.cancel_id);
    let result: any = 0;
    if (session.addr !== '') {
      result = await botLogic.withdraw(sessionId, addr);
    }

    if (result) {
      await instance.bot.answerCallbackQuery(stateData.callback_query_id, {
        text: `✔️ Withdraw is completed successfully.`,
      });
    } else {
      await instance.bot.answerCallbackQuery(stateData.callback_query_id, {
        text: `✔️ Withdraw is failed.`,
      });
    }

    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, messageId, title, menu.options);
    //
  } else if (stateNode.state === StateCode.WAIT_SET_TARGET) {
    G.log('WAIT_SET_TARGET:******************');
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount < 0.1) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the amount you entered is invalid. Please try again`);
      return;
    }
    // process set target amount
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setTargetAmount(sessionId, session.addr, amount);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.BUY_SELL_AMOUNT) {
    G.log('BUY_SELL_AMOUNT:******************');
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount < 0.001) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the amount you entered is invalid. Please try again`);
      return;
    }
    // process set target amount
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setBuySellAmount(sessionId, session.addr, amount * LAMPORTS_PER_SOL);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.DELAY_SET_TIME) {
    G.log('DELAY_SET_TIME:******************');
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount < 1) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the time you entered is invalid. Please try again`);
      return;
    }
    // process set target amount
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setDelayTime(sessionId, session.addr, amount);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.WAIT_SET_WALLET_SIZE) {
    const size = Number(msg.text.trim());
    if (isNaN(size) || size <= 0) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the number you entered is invalid. Please try again`);
      return;
    }
    // process set trx rating
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setWalletSize(sessionId, session.addr, size);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.WAIT_SET_RATING) {
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount <= 0) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the amount you entered is invalid. Please try again`);
      return;
    }
    // process set trx rating
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setRating(sessionId, session.addr, amount);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.WAIT_SET_BUY_AMOUNT) {
    G.log('set volume amount*************************');
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount <= 0) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the amount you entered is invalid. Please try again`);
      return;
    }
    // process set buy amount
    await instance.removeMessage(sessionId, messageId);
    await G.sleep(500);
    await instance.removeMessage(sessionId, stateData.cancel_id);
    await botLogic.setBuyAmount(sessionId, session.addr, amount);
    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, stateData.menu_id, title, menu.options);
    //
  } else if (stateNode.state === StateCode.WAIT_DIVIDE_SOL) {
    const amount = Number(msg.text.trim());
    if (isNaN(amount) || amount < 0.002) {
      await instance.openMessage(sessionId, '', 0, `⛔ Sorry, the amount you entered is invalid. Please try again`);
      return;
    }
    // process wallet withdraw
    await instance.removeMessage(sessionId, messageId);
    const result = await botLogic.disperse(sessionId, amount);
    if (result) {
      await instance.bot.answerCallbackQuery(stateData.callback_query_id, {
        text: `✔️ Prepare is completed successfully.`,
      });
    } else {
      await instance.bot.answerCallbackQuery(stateData.callback_query_id, {
        text: `❌ Prepare failed. Please check deposit SOL and try again`,
      });
    }

    const menu: any = await instance.json_main(sessionId);
    let title: string = await instance.getMainMenuMessage(sessionId);

    await instance.switchMenu(sessionId, messageId, title, menu.options);
  }
};
