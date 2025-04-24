import mongoose from 'mongoose';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const User = mongoose.model(
  'User',
  new mongoose.Schema({
    chatid: String,
    username: String,
    depositWallet: String,
    withdrawWallet: String,
    gatherDate: Number,
    referredBy: String,
    referredTimestamp: Number,
    timestamp: Number,
    dexId: String,
    poolType: String,
    pairAddress: String
  }),
);

export const WhiteList = mongoose.model(
  'WhiteList',
  new mongoose.Schema({
    chatid: String,
    limitTokenCount: Number,
    timestamp: Number,
  }),
);

export const VolumeToken = mongoose.model(
  'VolumeToken',
  new mongoose.Schema({
    chatid: String,
    addr: String,
    baseAddr: String,
    symbol: String,
    baseSymbol: String,
    decimal: Number,
    baseDecimal: Number,
    currentVolume: Number,
    targetVolume: Number,
    timestamp: Number,
    totalPayed: Number,
    workingTime: Number,
    lastWorkedTime: Number,
    ratingPer1H: Number,
    buyAmount: Number,
    status: Boolean,
    botId: Number,
    walletSize: Number,
    mode: Number,
    buysellAmount: Number,
    delayTime: Number,
    curVolumeStep: Number
  }),
);

export const Wallet = mongoose.model(
  'Wallet',
  new mongoose.Schema({
    prvKey: String,
    usedTokenIdx: [String],
    timestamp: Number,
  })
);

export const TaxHistory = mongoose.model(
  'TaxHistory',
  new mongoose.Schema({
    chatid: String,
    addr: String,
    amount: Number,
    timestamp: Number,
  }),
);

export const Admin = mongoose.model(
  'Admin',
  new mongoose.Schema({
    name: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  }),
);

const TrxHistory = mongoose.model(
  'Trx_History',
  new mongoose.Schema({
    chatid: String,
    solAmount: Number,
    tokenAmount: Number,
    mode: String,
    trxId: String,
    timestamp: Number,
  }),
);

export const init = async () => {
  return new Promise(async (resolve: any, reject: any) => {
    mongoose
      .connect(`mongodb://localhost:27017/${process.env.DB_NAME}`)
      .then(() => {
        console.log(`Connected to MongoDB "${process.env.DB_NAME}"...`);

        resolve();
      })
      .catch((err) => {
        console.error('Could not connect to MongoDB...', err);
        reject();
      });
  });
};

export const updateUser = (params: any) => {
  return new Promise(async (resolve, reject) => {
    User.findOne({ chatid: params.chatid }).then(async (user: any) => {
      if (!user) {
        user = new User();
        user.depositWallet = params.depositWallet;
      }
      user.chatid = params.chatid;
      user.username = params.username ?? '';
      user.referredBy = params.referredBy;
      user.referredTimestamp = params.referredTimestamp;
      user.dexId = params.dexId;
      user.poolType = params.poolType;
      user.pairAddress = params.pairAddress;
      await user.save();
      resolve(user);
    });
  });
};

export const updateGatherDate = (params: any) => {
  return new Promise(async (resolve, reject) => {
    User.findOne({ chatid: params.chatid }).then(async (user: any) => {
      user.gatherDate = new Date().getTime();
      await user.save();
      resolve(user);
    });
  });
};

export const removeUser = (params: any) => {
  return new Promise((resolve, reject) => {
    User.deleteOne({ chatid: params.chatid }).then(() => {
      resolve(true);
    });
  });
};

export async function selectUsers(params: any = {}) {
  return new Promise(async (resolve, reject) => {
    User.find(params).then(async (users) => {
      resolve(users);
    });
  });
}

export async function countUsers(params: any = {}) {
  return new Promise(async (resolve, reject) => {
    User.countDocuments(params).then(async (users) => {
      resolve(users);
    });
  });
}

export async function selectUser(params: any) {
  return new Promise(async (resolve, reject) => {
    User.findOne(params).then(async (user) => {
      resolve(user);
    });
  });
}

export async function deleteUser(params: any) {
  return new Promise(async (resolve, reject) => {
    User.deleteOne(params).then(async (user) => {
      resolve(user);
    });
  });
}

export const registToken = (params: any) => {
  return new Promise(async (resolve, reject) => {
    const item = new VolumeToken();
    item.timestamp = new Date().getTime();
    item.chatid = params.chatid;
    item.addr = params.addr;
    item.baseAddr = params.baseAddr;
    item.symbol = params.symbol;
    item.baseSymbol = params.baseSymbol;
    item.decimal = params.decimal;
    item.baseDecimal = params.baseDecimal;
    item.currentVolume = 0;
    item.targetVolume = 1;
    item.workingTime = 0;
    item.lastWorkedTime = 0;
    item.ratingPer1H = 5;
    item.buyAmount = 70;
    item.status = false;
    item.botId = 0;
    item.walletSize = 0;
    item.mode = 0;
    item.buysellAmount = 1 * LAMPORTS_PER_SOL;
    item.delayTime = 30;
    item.curVolumeStep = 0;
    await item.save();
    resolve(item);
  });
};

export const removeToken = (params: any) => {
  return new Promise((resolve, reject) => {
    VolumeToken.deleteOne(params).then(() => {
      resolve(true);
    });
  });
};

export async function selectTokens(params: any = {}, limit: number = 0) {
  return new Promise(async (resolve, reject) => {
    if (limit) {
      VolumeToken.find(params)
        .limit(limit)
        .then(async (dcas) => {
          resolve(dcas);
        });
    } else {
      VolumeToken.find(params).then(async (dcas) => {
        resolve(dcas);
      });
    }
  });
}

export async function selectToken(params: any) {
  return new Promise(async (resolve, reject) => {
    VolumeToken.findOne(params).then(async (user) => {
      resolve(user);
    });
  });
}

export async function updateToken(params: any) {
  return new Promise(async (resolve, reject) => {
    VolumeToken.updateOne(params).then(async (user) => {
      resolve(user);
    });
  });
}

export async function selectTaxHistory(params: any) {
  return new Promise(async (resolve, reject) => {
    TaxHistory.findOne(params).then(async (history) => {
      resolve(history);
    });
  });
}

export async function updateTaxHistory(params: any, query: any) {
  return new Promise(async (resolve, reject) => {
    TaxHistory.updateOne(params, query).then(async (history) => {
      resolve(history);
    });
  });
}

export async function selectTaxHistories(params: any) {
  return new Promise(async (resolve, reject) => {
    TaxHistory.find(params).then(async (histories) => {
      resolve(histories);
    });
  });
}

export async function addTaxHistory(params: any) {
  return new Promise(async (resolve, reject) => {
    const item = new TaxHistory();
    item.timestamp = new Date().getTime();

    item.chatid = params.chatid;
    item.addr = params.solUp;
    item.amount = params.solDown;

    await item.save();

    resolve(item);
  });
}

export async function addTrxHistory(params: any = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      let item = new TrxHistory();

      item.chatid = params.chatid;
      item.solAmount = params.solAmount;
      item.tokenAmount = params.tokenAmount;
      item.mode = params.mode;
      item.trxId = params.trxId;
      item.timestamp = new Date().getTime();

      await item.save();

      resolve(true);
    } catch (err) {
      resolve(false);
    }
  });
}

export async function addWallet(params: any) {
  return new Promise(async (resolve, reject) => {
    const item = new Wallet();
    item.timestamp = new Date().getTime();

    item.prvKey = params.prvKey;

    await item.save();

    resolve(item);
  });
}

export async function udpateWallet() {
  return new Promise(async (resolve, reject) => {
    try {
      await Wallet.updateMany({}, { usedTokenIdx: '' });
      resolve(true);
    } catch (err) {
      resolve(false);
    }
  });
}

export async function countWallets(params: any = {}) {
  return new Promise(async (resolve, reject) => {
    Wallet.countDocuments(params).then(async (dcas) => {
      resolve(dcas);
    });
  });
}

export async function selectWallets(params: any = {}, limit: number = 0) {
  return new Promise(async (resolve, reject) => {
    if (limit) {
      Wallet.find(params)
        .limit(limit)
        .then(async (dcas) => {
          resolve(dcas);
        });
    } else {
      Wallet.find(params).then(async (dcas) => {
        resolve(dcas);
      });
    }
  });
}

export async function selectWalletsByTimestampAndChatId(chatid: string, anytime: number): Promise<any> {
  console.log('gatherDate:', anytime);
  if (anytime === undefined) anytime = 0;
  return new Promise(async (resolve, reject) => {
    const params = {
      chatid: chatid,
      timestamp: { $gt: anytime },
    };

    Wallet.find(params)
      .select('prvKey') // This selects only the 'prvKey' field
      .then((wallets) => {
        resolve(wallets);
      })
      .catch((error) => {
        reject(error);
      });
  });
}

export async function getAllWalletPrvKeys(): Promise<any> {
  return new Promise(async (resolve, reject) => {
    Wallet.find({})
      .select('prvKey') // Select only the 'prvKey' field
      .then((wallets) => {
        resolve(wallets);
      })
      .catch((error) => {
        reject(error);
      });
  });
}

export async function addWhiteList(params: any) {
  return new Promise(async (resolve, reject) => {
    const item = new WhiteList();
    item.timestamp = new Date().getTime();

    item.limitTokenCount = params.limitTokenCount;
    item.chatid = params.chatid;

    await item.save();

    resolve(item);
  });
}

export async function selectWhiteLists(params: any = {}) {
  return new Promise(async (resolve, reject) => {
    WhiteList.find(params).then(async (dcas) => {
      resolve(dcas);
    });
  });
}
