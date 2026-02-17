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
import { waitForRateLimit, headers } from './runner';

export async function fetchTransactions(
    params: GetTransactionsParams,
    testnet: boolean
): Promise<TransactionList> {
    try {
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
    testnet: boolean
): Promise<{
    mcSeqno: number;
    randSeed: Buffer;
}> {
    try {
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
    mcBlockSeqno: number
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

type FetchTransactionsFn = (
    params: GetTransactionsParams,
    testnet: boolean
) => Promise<TransactionList>;

function normalizeHexHash(input: string): string {
    const trimmed = input.trim();
    const withoutPrefix = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;

    if (!/^[0-9a-fA-F]{64}$/.test(withoutPrefix)) {
        throw new Error(
            'Expected a 64-char hex hash (optionally with 0x prefix)'
        );
    }

    return withoutPrefix.toLowerCase();
}

function tryDecodeBase64Hash(input: string): string | null {
    const trimmed = input.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
        return null;
    }

    try {
        const decoded = Buffer.from(trimmed, 'base64');
        if (decoded.length !== 32) {
            return null;
        }
        return decoded.toString('hex');
    } catch {
        return null;
    }
}

function parseBareHash(input: string): string {
    const decodedHash = tryDecodeBase64Hash(input);
    if (decodedHash) {
        return decodedHash;
    }
    return normalizeHexHash(input);
}

function parseLtHash(input: string): { lt: bigint; hashHex: string } {
    const trimmed = input.trim();
    const parts = trimmed.split(':');
    if (parts.length !== 2) {
        throw new Error('Expected lt:hash format');
    }

    const lt = BigInt(parts[0]);
    const hashHex = normalizeHexHash(parts[1]);
    return { lt, hashHex };
}

function formatLookupError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function firstTxOrThrow(
    res: TransactionList,
    source: string
): TransactionIndexed {
    if (res.transactions.length === 0) {
        throw new Error(`No transaction found for ${source}`);
    }
    return res.transactions[0];
}

export async function resolveTxByHash(
    hashHex: string,
    forcedTestnet: boolean = false,
    fetcher: FetchTransactionsFn = fetchTransactions
): Promise<{ tx: BaseTxInfo; testnet: boolean }> {
    const networks = forcedTestnet ? [true] : [false, true];
    const errors: string[] = [];

    for (let i = 0; i < networks.length; i++) {
        const testnet = networks[i];
        const networkName = testnet ? 'testnet' : 'mainnet';

        if (i > 0) {
            await waitForRateLimit();
        }

        try {
            const res = await fetcher({ hash: hashHex, limit: 1 }, testnet);
            if (res.transactions.length === 0) {
                continue;
            }

            const tx = res.transactions[0];
            return {
                tx: {
                    lt: BigInt(tx.lt),
                    hash: Buffer.from(tx.hash, 'base64'),
                    addr: Address.parseRaw(tx.account),
                },
                testnet,
            };
        } catch (error) {
            errors.push(`${networkName}: ${formatLookupError(error)}`);
        }
    }

    const scope = forcedTestnet ? 'testnet' : 'mainnet or testnet';
    const maybeErrors =
        errors.length > 0 ? ` Lookup errors: ${errors.join('; ')}` : '';
    throw new Error(
        `Couldn't find transaction by hash on ${scope}.${maybeErrors}`
    );
}

export async function linkToTx(
    txLink: string,
    forcedTestnet?: boolean
): Promise<{ tx: BaseTxInfo; testnet: boolean }> {
    // break given tx link to lt, hash, addr
    const normalizedInput = txLink.trim();
    let lt: bigint, hash: Buffer, addr: Address;
    let testnet: boolean;
    const forced = forcedTestnet || false;

    if (
        normalizedInput.startsWith('https://ton.cx/tx/') ||
        normalizedInput.startsWith('https://testnet.ton.cx/tx/')
    ) {
        // example:
        // https://ton.cx/tx/47670702000009:Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=:EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_
        testnet = forced || normalizedInput.includes('testnet.');
        const infoPart = testnet
            ? normalizedInput.slice(26)
            : normalizedInput.slice(18);
        let [ltStr, hashStr, addrStr] = infoPart.split(':');
        lt = BigInt(ltStr);
        hash = Buffer.from(hashStr, 'base64');
        addr = Address.parse(addrStr);
    } else if (
        normalizedInput.startsWith('https://tonviewer.com/') ||
        normalizedInput.startsWith('https://testnet.tonviewer.com/')
    ) {
        // example:
        // https://tonviewer.com/transaction/3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        testnet = forced || normalizedInput.includes('testnet.');
        const infoPart = testnet
            ? normalizedInput.slice(42)
            : normalizedInput.slice(34);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet
        );
        const tx = firstTxOrThrow(res, 'tonviewer');
        hash = Buffer.from(infoPart, 'hex');
        addr = Address.parseRaw(tx.account);
        lt = BigInt(tx.lt);
    } else if (
        normalizedInput.startsWith('https://tonscan.org/tx/') ||
        normalizedInput.startsWith('https://testnet.tonscan.org/tx/')
    ) {
        // example:
        // https://tonscan.org/tx/Pl9JeY3iOdpdj4C03DACBNN2E+QgOj97h3wEqIyBhWs=
        testnet = forced || normalizedInput.includes('testnet.');
        const infoPart = testnet
            ? normalizedInput.slice(31)
            : normalizedInput.slice(23);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet
        );
        const tx = firstTxOrThrow(res, 'tonscan');
        hash = Buffer.from(infoPart, 'base64');
        addr = Address.parseRaw(tx.account);
        lt = BigInt(tx.lt);
    } else if (
        normalizedInput.startsWith('https://explorer.toncoin.org/transaction') ||
        normalizedInput.startsWith('https://test-explorer.toncoin.org/transaction')
    ) {
        // example:
        // https://explorer.toncoin.org/transaction?account=EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_&lt=47670702000009&hash=3e5f49798de239da5d8f80b4dc300204d37613e4203a3f7b877c04a88c81856b
        testnet = forced || normalizedInput.includes('test-');
        const url = new URL(normalizedInput);
        lt = BigInt(url.searchParams.get('lt') || '0');
        hash = Buffer.from(url.searchParams.get('hash') || '', 'hex');
        addr = Address.parse(url.searchParams.get('account') || '');
    } else if (
        normalizedInput.startsWith('https://dton.io/tx') ||
        normalizedInput.startsWith('https://testnet.dton.io/tx')
    ) {
        // example:
        // https://dton.io/tx/F64C6A3CDF3FAD1D786AACF9A6130F18F3F76EEB71294F53BBD812AD3703E70A
        testnet = forced || normalizedInput.includes('testnet.');
        const infoPart = testnet
            ? normalizedInput.slice(27)
            : normalizedInput.slice(19);
        const res = await fetchTransactions(
            { hash: infoPart, limit: 1 },
            testnet
        );
        const tx = firstTxOrThrow(res, 'dton');
        hash = Buffer.from(infoPart, 'hex');
        addr = Address.parseRaw(tx.account);
        lt = BigInt(tx.lt);
    } else {
        const triedFormats = [
            'ton.cx',
            'tonviewer',
            'tonscan',
            'toncoin.org',
            'dton',
            'lt:hash',
            'hash',
        ];
        try {
            if (normalizedInput.includes(':')) {
                const parsedLtHash = parseLtHash(normalizedInput);
                const resolved = await resolveTxByHash(
                    parsedLtHash.hashHex,
                    forced
                );
                return {
                    tx: {
                        lt: parsedLtHash.lt,
                        hash: Buffer.from(parsedLtHash.hashHex, 'hex'),
                        addr: resolved.tx.addr,
                    },
                    testnet: resolved.testnet,
                };
            }

            const normalizedHash = parseBareHash(normalizedInput);
            return await resolveTxByHash(normalizedHash, forced);
        } catch (error) {
            const maybeMsg = error instanceof Error ? error.message : '';
            throw new Error(
                `Couldn't recognize transaction reference, tried formats: ${triedFormats.join(
                    ', '
                )}. ${maybeMsg}`
            );
        }
    }
    return { tx: { lt, hash, addr }, testnet };
}

export function txToLinks(opts: BaseTxInfo, testnet: boolean): TxLinks {
    const txtracer = `https://txtracer.ton.org/?tx=${opts.hash.toString('hex')}`;
    const tonscan = `https://${testnet ? 'testnet.' : ''}tonscan.org/tx/${opts.hash.toString('hex')}`;
    return {
        txtracer: txtracer,
        toncx: `https://${testnet ? 'testnet.' : ''}ton.cx/tx/${
            opts.lt
        }:${opts.hash.toString('base64')}:${opts.addr.toString()}`,
        tonviewer: `https://${
            testnet ? 'testnet.' : ''
        }tonviewer.com/transaction/${opts.hash.toString('hex')}`,
        tonscan: tonscan,
        toncoin: `https://${
            testnet ? 'test-' : ''
        }explorer.toncoin.org/transaction?account=${opts.addr.toString()}&lt=${
            opts.lt
        }&hash=${opts.hash.toString('hex')}`,
        dton: `https://${
            testnet ? 'testnet.' : ''
        }dton.io/tx/${opts.hash.toString('hex')}`,
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
