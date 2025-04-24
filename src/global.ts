import dotenv from 'dotenv';
import { ENV } from '@solana/spl-token-registry';
import { Connection } from '@solana/web3.js';

dotenv.config()

export const NOT_ASSIGNED = '- Not assigned -'
export const PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS

export const errorLog = (summary: string, error: any): void => {
    if (error?.response?.body?.description) {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error.response.body.description}`);
    } else {
        console.log('\x1b[31m%s\x1b[0m', `[error] ${summary} ${error}`);
    }
};

export const parseError = (error: any): string => {
    let msg = '';
    try {
        error = JSON.parse(JSON.stringify(error));
        msg =
            error?.error?.reason ||
            error?.reason ||
            JSON.parse(error)?.error?.error?.response?.error?.message ||
            error?.response ||
            error?.message ||
            error;
    } catch (_error) {
        msg = error;
    }

    return msg;
};

export const Max_Sell_Count = 10
export const Mainnet = 'mainnet-beta'
export const Testnet = 'testnet'
export const Devnet = 'devnet'

export let web3Conn: Connection
export let quoteToken: any = {
    address: process.env.COMMUNITY_TOKEN,
    name: 'OF',
    symbol: 'ONLYFINS',
    decimals: 9
}

export const setWeb3 = (conn: Connection) => {
    web3Conn = conn
}

export const getCluserApiType = (): string => {

    switch (get_net_mode()) {
        case ENV.MainnetBeta: {

            return Mainnet;
        }
        case ENV.Testnet: {
            return Testnet;
        }
        case ENV.Devnet: {

            return Devnet
        }
        default: {
            return ''
        }
    }
}

export const get_net_mode = () => {

    return Number(process.env.NET_MODE)
}

export const getTaxWallet1 = () => {
    return process.env.TAX_WALLET1 || 'FEE1QhTscRTPYwFv4hhVRdofcVE1pTemZUcxEeTtfWCs'
}

export const getTaxWallet2 = () => {
    return process.env.TAX_WALLET2 || 'FEE1QhTscRTPYwFv4hhVRdofcVE1pTemZUcxEeTtfWCs'
}

export const getTaxWallet3 = () => {
    return process.env.TAX_WALLET3 || 'FEE1QhTscRTPYwFv4hhVRdofcVE1pTemZUcxEeTtfWCs'
}
