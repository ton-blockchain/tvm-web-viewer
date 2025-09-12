import { Address, Cell } from '@ton/core';
import axios, { AxiosResponse } from 'axios';
import {
    AddressBookEntry,
    BaseTxInfo,
    GetTransactionsParams,
    TransactionIndexed,
    TransactionList,
    TxLinks,
} from './types';
import { waitForRateLimit } from './runner';

export async function fetchTransactions(
    params: GetTransactionsParams,
    testnet: boolean,
    apiKey?: string
): Promise<TransactionList> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }

        const response: AxiosResponse<{
            transactions: TransactionIndexed[];
            address_book: Record<string, AddressBookEntry>;
        }> = await axios.get(
            `https://${
                testnet ? 'testnet.' : ''
            }toncenter.com/api/v3/transactions`,
            {
                params,
                headers,
            }
        );
        return response.data;
    } catch (error) {
        console.error('Error fetching transactions from toncenter:', error);
        if (error instanceof Error) {
            throw Error('Get transactions on Toncenter V3: ' + error.message);
        } else {
            throw error;
        }
    }
}

export async function mcSeqnoByShard(
    shard: {
        workchain: number;
        seqno: number;
        shard: string;
        rootHash: string;
        fileHash: string;
    },
    testnet: boolean,
    apiKey?: string
): Promise<{
    mcSeqno: number;
    randSeed: Buffer;
}> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }

        const shardInt = BigInt(shard.shard);
        const shardUint =
            shardInt < 0 ? shardInt + BigInt('0x10000000000000000') : shardInt;
        const response: AxiosResponse<any> = await axios.get(
            `https://${testnet ? 'testnet.' : ''}toncenter.com/api/v3/blocks`,
            {
                params: {
                    workchain: shard.workchain,
                    shard: '0x' + shardUint.toString(16),
                    seqno: shard.seqno,
                },
                headers,
            }
        );
        const block = response.data.blocks[0];
        if (block.root_hash != shard.rootHash) {
            throw new Error(
                'rootHash mismatch in mc_seqno getter: ' +
                    shard.rootHash +
                    ' != ' +
                    block.root_hash
            );
        }
        return {
            mcSeqno: block.masterchain_block_ref.seqno,
            randSeed: Buffer.from(block.rand_seed, 'base64'),
        };
    } catch (error) {
        console.error('Error fetching mc block from toncenter:', error);
        if (error instanceof Error) {
            throw Error('Get blocks on Toncenter V3: ' + error.message);
        } else {
            throw error;
        }
    }
}

export async function getLib(libhash: string, testnet: boolean): Promise<Cell> {
    // gets a library by its hash from dton's graphql
    const dtonEndpoint = `https://${testnet ? 'testnet.' : ''}dton.io/graphql`;
    const graphqlQuery = {
        query: `
            query fetchAuthor {
                get_lib(lib_hash: "${libhash}")
            }
        `,
        variables: {},
    };
    try {
        const res = await axios.post(dtonEndpoint, graphqlQuery, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const libB64 = res.data.data.get_lib;
        return Cell.fromBase64(libB64);
    } catch (error) {
        console.error('Error fetching libs from dton:', error);
        if (error instanceof Error) {
            throw Error("Get libs on dton's graphql: " + error.message);
        } else {
            throw error;
        }
    }
}

export async function getConfigAll(
    testnet: boolean,
    mcBlockSeqno: number,
    apiKey?: string
): Promise<string> {
    // https://toncenter.com/api/v2/getConfigAll?seqno=32569332
    // {
    //   "ok": true,
    //   "result": {
    //     "@type": "configInfo",
    //     "config": {
    //       "@type": "tvm.cell",
    //       "bytes": "..."
    //     }
    //   }
    // }
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiKey) {
            headers['X-API-Key'] = apiKey;
        }

        const response: AxiosResponse<{
            ok: boolean;
            result: {
                '@type': 'configInfo';
                config: {
                    '@type': 'tvm.cell';
                    bytes: string;
                };
            };
        }> = await axios.get(
            `https://${
                testnet ? 'testnet.' : ''
            }toncenter.com/api/v2/getConfigAll`,
            {
                params: {
                    seqno: mcBlockSeqno,
                },
                headers,
            }
        );
        return response.data.result.config.bytes;
    } catch (error) {
        console.error('Error fetching config from Toncenter V2:', error);
        if (error instanceof Error) {
            throw Error('Get config on Toncenter V2: ' + error.message);
        } else {
            throw error;
        }
    }
}

export async function linkToTx(
    txLink: string,
    forcedTestnet?: boolean,
    apiKey?: string,
    apiKeyTestnet?: string
): Promise<{ tx: BaseTxInfo; testnet: boolean }> {
    console.log('linkToTx', apiKey, apiKeyTestnet);
    // break given tx link to lt, hash, addr

    let lt: bigint, hash: Buffer, addr: Address;
    let testnet: boolean;

    if (
        txLink.startsWith('https://ton.cx/tx/') ||
        txLink.startsWith('https://testnet.ton.cx/tx/')
    ) {
        // example:
        // https://ton.cx/tx/47670702000009:Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=:EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_
        testnet = forcedTestnet || txLink.includes('testnet.');
        const infoPart = testnet ? txLink.slice(26) : txLink.slice(18);
        let [ltStr, hashStr, addrStr] = infoPart.split(':');
        lt = BigInt(ltStr);
        hash = Buffer.from(hashStr, 'base64');
        addr = Address.parse(addrStr);
    } else if (
        txLink.startsWith('https://tonviewer.com/') ||
        txLink.startsWith('https://testnet.tonviewer.com/')
    ) {
        // example:
        // https://tonviewer.com/transaction/3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        testnet = forcedTestnet || txLink.includes('testnet.');
        const infoPart = testnet ? txLink.slice(42) : txLink.slice(34);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet
        );
        hash = Buffer.from(infoPart, 'hex');
        addr = Address.parseRaw(res.transactions[0].account);
        lt = BigInt(res.transactions[0].lt);
    } else if (
        txLink.startsWith('https://tonscan.org/tx/') ||
        txLink.startsWith('https://testnet.tonscan.org/tx/')
    ) {
        // example:
        // https://tonscan.org/tx/Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=
        testnet = forcedTestnet || txLink.includes('testnet.');
        const infoPart = testnet ? txLink.slice(31) : txLink.slice(23);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet
        );
        hash = Buffer.from(infoPart, 'base64');
        addr = Address.parseRaw(res.transactions[0].account);
        lt = BigInt(res.transactions[0].lt);
    } else if (
        txLink.startsWith('https://explorer.toncoin.org/transaction') ||
        txLink.startsWith('https://test-explorer.toncoin.org/transaction')
    ) {
        // example:
        // https://explorer.toncoin.org/transaction?account=EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_&lt=47670702000009&hash=3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        testnet = forcedTestnet || txLink.includes('test-');
        const url = new URL(txLink);
        lt = BigInt(url.searchParams.get('lt') || '0');
        hash = Buffer.from(url.searchParams.get('hash') || '', 'hex');
        addr = Address.parse(url.searchParams.get('account') || '');
    } else if (
        txLink.startsWith('https://dton.io/tx') ||
        txLink.startsWith('https://testnet.dton.io/tx')
    ) {
        // example:
        // https://dton.io/tx/F64C6A3CDF3FAD1D786AACF9A6130F18F3F76EEB71294F53BBD812AD3703E70A
        testnet = forcedTestnet || txLink.includes('testnet.');
        const infoPart = testnet ? txLink.slice(27) : txLink.slice(19);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet,
            testnet ? apiKeyTestnet : apiKey
        );
        hash = Buffer.from(infoPart, 'hex');
        addr = Address.parseRaw(res.transactions[0].account);
        lt = BigInt(res.transactions[0].lt);
    } else {
        let triedFormats: string[] = [
            'ton.cx',
            'tonviewer',
            'tonscan',
            'toncoin.org',
            'dton',
        ];
        try {
            // try bare hash first
            console.log('Trying bare hash formats...');
            try {
                if (txLink.endsWith('=')) {
                    // convert base64 to hex (if base64)
                    txLink = Buffer.from(txLink, 'base64').toString('hex');
                }

                if (txLink.length !== 64)
                    throw new Error(
                        'Seems like hash, but not of length 64. Probably missing letters'
                    );

                // (just hash)
                // examples:
                // fyGURCMaAmBYVk39QcE/ToX7zQUVA2cyRsO6/U52HW8=
                // 3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
                let res: TransactionList;
                testnet = forcedTestnet || false;

                // await waitForRateLimit(testnet ? apiKeyTestnet : apiKey);
                // it's first api call, so do not wait
                if (forcedTestnet)
                    res = await fetchTransactions(
                        { hash: txLink, limit: 1 },
                        forcedTestnet,
                        testnet ? apiKeyTestnet : apiKey
                    );
                else
                    try {
                        console.log(
                            `Trying bare hash mainnet for ${txLink}...`
                        );
                        res = await fetchTransactions(
                            { hash: txLink, limit: 1 },
                            testnet,
                            apiKey
                        );
                        if (res.transactions.length === 0) {
                            triedFormats.push('bare hash mainnet');
                            throw new Error('nope');
                        }
                    } catch {
                        console.log(
                            `Trying bare hash testnet for ${txLink}...`
                        );
                        testnet = true;
                        await waitForRateLimit(apiKeyTestnet);
                        res = await fetchTransactions(
                            { hash: txLink, limit: 1 },
                            testnet,
                            apiKeyTestnet
                        );
                        if (res.transactions.length === 0) {
                            triedFormats.push('bare hash testnet');
                            throw new Error('nope');
                        }
                    }
                hash = Buffer.from(res.transactions[0].hash, 'base64');
                lt = BigInt(res.transactions[0].lt);
                addr = Address.parseRaw(res.transactions[0].account);
            } catch (e) {
                // try lt:hash format
                console.log('Trying lt:hash format...');
                try {
                    // example: 47670702000009:3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
                    let [ltStr, hashStr] = txLink.split(':');
                    lt = BigInt(ltStr);
                    hash = Buffer.from(hashStr, 'hex');

                    let res: TransactionList;
                    testnet = forcedTestnet || false;

                    if (forcedTestnet) {
                        await waitForRateLimit(apiKeyTestnet);
                        res = await fetchTransactions(
                            { hash: hashStr, limit: 1 },
                            forcedTestnet,
                            apiKeyTestnet
                        );
                    } else
                        try {
                            // value may be set by forcedTestnet
                            await waitForRateLimit(
                                testnet ? apiKeyTestnet : apiKey
                            );
                            res = await fetchTransactions(
                                { hash: hashStr, limit: 1 },
                                testnet,
                                testnet ? apiKeyTestnet : apiKey
                            );
                            if (res.transactions.length === 0) {
                                triedFormats.push('lt:hash mainnet');
                                throw new Error('nope');
                            }
                        } catch {
                            console.log(
                                `Trying lt:hash testnet for ${hashStr}...`
                            );
                            testnet = true;
                            await waitForRateLimit(apiKeyTestnet);
                            res = await fetchTransactions(
                                { hash: hashStr, limit: 1 },
                                testnet,
                                apiKeyTestnet
                            );
                            if (res.transactions.length === 0) {
                                triedFormats.push('lt:hash testnet');
                                throw new Error('nope');
                            }
                        }
                    addr = Address.parseRaw(res.transactions[0].account);
                } catch (e) {
                    let maybeMsg = '';
                    if (e instanceof Error && e.message != 'nope') {
                        maybeMsg = 'Got strange error: ' + e.message;
                    }
                    const formatsStr = triedFormats.join(', ');
                    throw new Error(
                        `Coudn't recognize such link, tried all formats: ${formatsStr}. ${maybeMsg}`
                    );
                }
            }
        } catch (e) {
            let maybeMsg = '';
            if (e instanceof Error && e.message != 'nope') {
                maybeMsg = 'Got strange error: ' + e.message;
            }
            const formatsStr = triedFormats.join(', ');
            throw new Error(
                `Coudn't recognize such link, tried all formats: ${formatsStr}. ${maybeMsg}`
            );
        }
    }
    return { tx: { lt, hash, addr }, testnet };
}

export function txToLinks(opts: BaseTxInfo, testnet: boolean): TxLinks {
    return {
        toncx: `https://${testnet ? 'testnet.' : ''}ton.cx/tx/${
            opts.lt
        }:${opts.hash.toString('base64')}:${opts.addr.toString()}`,
        tonviewer: `https://${
            testnet ? 'testnet.' : ''
        }tonviewer.com/transaction/${opts.hash.toString('hex')}`,
        tonscan: `https://${
            testnet ? 'testnet.' : ''
        }tonscan.org/tx/${opts.hash.toString('base64')}`,
        toncoin: `https://${
            testnet ? 'test-' : ''
        }explorer.toncoin.org/transaction?account=${opts.addr.toString()}&lt=${
            opts.lt
        }&hash=${opts.hash.toString('hex')}`,
        dton: `https://${
            testnet ? 'testnet.' : ''
        }dton.io/tx/F64C6A3CDF3FAD1D786AACF9A6130F18F3F76EEB71294F53BBD812AD3703E70A`,
    };
}

export function customStringify(obj: any, indent = 2, level = 0): string {
    const indentation = ' '.repeat(level * indent);
    const nextIndentation = ' '.repeat((level + 1) * indent);

    if (typeof obj !== 'object' || obj === null) {
        if (typeof obj === 'string') {
            return obj;
        }
        return String(obj);
    }

    if (Array.isArray(obj)) {
        const arrayElements = obj
            .map((element) => customStringify(element, indent, level + 1))
            .join(',\n' + nextIndentation);
        return `[\n${nextIndentation}${arrayElements}\n${indentation}]`;
    }

    const entries = Object.entries(obj)
        .map(([key, value]) => {
            const formattedValue = customStringify(value, indent, level + 1);
            return `${nextIndentation}${key}: ${formattedValue}`;
        })
        .join(',\n');

    return `{\n${entries}\n${indentation}}`;
}
