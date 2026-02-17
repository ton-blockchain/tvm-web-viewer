import { Buffer } from 'buffer';
import { Blockchain, Executor } from '@ton/sandbox';
import {
    AccountState,
    Address,
    beginCell,
    Cell,
    ShardAccount,
    storeMessage,
    storeShardAccount,
    loadShardAccount,
    Transaction,
    loadTransaction,
    Dictionary,
    OutAction,
} from '@ton/core';
import { TonClient, TonClient4 } from '@ton/ton';
import {
    AccountFromAPI,
    BaseTxInfo,
    ComputeInfo,
    EmulateWithStackResult,
    StateFromAPI,
    TVMLog,
    C5Error,
} from './types';
import { parseC5, parseStack } from './stack';
import {
    getConfigAll,
    getLib,
    linkToTx,
    mcSeqnoByShard,
    txToLinks,
} from './utils';

// api key islimited to retracer.ton.org origin and 10 rps per IP
const TONCENTER_API_KEY =
    typeof window !== 'undefined' &&
    window.location.origin === 'https://retracer.ton.org'
        ? '7ae896e0a87e0a2b2d3238c228ffb9758f65d9f311c8dc0a91cb89cbab642e18'
        : undefined;
export const headers = TONCENTER_API_KEY
    ? {
          'X-API-KEY': TONCENTER_API_KEY,
      }
    : undefined;

export async function waitForRateLimit() {
    if (TONCENTER_API_KEY) {
        return;
    }
    return new Promise((resolve) => setTimeout(resolve, 1000));
}

function b64ToBigInt(b64: string): bigint {
    return BigInt('0x' + Buffer.from(b64, 'base64').toString('hex'));
}

function normalizeStateFromAPI(givenState: StateFromAPI): AccountState {
    if (givenState.type === 'uninit')
        return {
            type: 'uninit',
        };
    if (givenState.type === 'frozen')
        return {
            type: 'frozen',
            stateHash: b64ToBigInt(givenState.stateHash),
        };
    else
        return {
            type: 'active',
            state: {
                code: givenState.code
                    ? Cell.fromBase64(givenState.code)
                    : undefined,
                data: givenState.data
                    ? Cell.fromBase64(givenState.data)
                    : undefined,
            },
        };
}

function createShardAccountFromAPI(
    apiAccount: AccountFromAPI,
    address: Address
): ShardAccount {
    function toMaybeBN(num: number | undefined): bigint {
        return num !== undefined ? BigInt(num) : 0n;
    }
    return {
        account: {
            addr: address,
            storage: {
                lastTransLt: BigInt(apiAccount.last?.lt || 0),
                balance: { coins: BigInt(apiAccount.balance.coins || 0) },
                state: normalizeStateFromAPI(apiAccount.state),
            },
            storageStats: {
                // waiting for updates
                // storageExtra: apiAccount.storageStat?.storageExtra,
                storageExtra: null,
                used: {
                    cells: toMaybeBN(apiAccount.storageStat?.used.cells),
                    bits: toMaybeBN(apiAccount.storageStat?.used.bits),
                    // publicCells: toMaybeBN(
                    //     apiAccount.storageStat?.used.publicCells
                    // ),
                },
                lastPaid: apiAccount.storageStat?.lastPaid || 0,
                duePayment:
                    typeof apiAccount.storageStat?.duePayment === 'string'
                        ? BigInt(apiAccount.storageStat?.duePayment)
                        : null,
            },
        },
        lastTransactionLt: BigInt(apiAccount.last?.lt || 0),
        lastTransactionHash: apiAccount.last?.hash
            ? b64ToBigInt(apiAccount.last?.hash)
            : 0n,
    };
}

async function getOtherTxs(
    client: TonClient,
    opts: {
        address: Address;
        lt: number | bigint | string;
        minLt?: number | bigint | string;
        hash?: string;
    }
): Promise<Transaction[]> {
    const txsInBlock = await client.getTransactions(opts.address, {
        inclusive: true,
        // last - requested tx lt
        lt: opts.lt.toString(),
        to_lt:
            opts.minLt?.toString() ||
            // to the first tx in the block for this addr (it starts from 462xxxxx000001 lt)
            // e.g.:  46297691000025, 46297691000043 -> 46297691000000
            ((BigInt(opts.lt) / 10000n) * 10000n).toString(),
        hash: opts.hash,
        archival: true,
        limit: 1000,
    });
    return txsInBlock;
}

export async function getEmulationWithStack(
    txLink: string | BaseTxInfo,
    forcedTestnet: boolean = false,
    sendStatus: (status: string) => void = () => {}
): Promise<EmulateWithStackResult> {
    let txInfo: BaseTxInfo;
    let testnet = forcedTestnet || false;
    if (typeof txLink == 'string') {
        let txGot = await linkToTx(txLink, forcedTestnet);
        txInfo = txGot.tx;
        testnet = txGot.testnet;
    } else {
        txInfo = txLink;
    }

    let { lt, hash, addr: address } = txInfo;

    const endpointV4 = `https://${
        testnet ? 'sandbox' : 'mainnet'
    }-v4.tonhubapi.com`;
    const endpointV2 = `https://${
        testnet ? 'testnet.' : ''
    }toncenter.com/api/v2/jsonRPC`;

    const clientV4 = new TonClient4({
        endpoint: endpointV4,
        timeout: 20000,
        requestInterceptor: (config) => {
            config.headers['Content-Type'] = 'application/json';
            return config;
        },
    });
    const clientV2 = new TonClient({
        endpoint: endpointV2,
        timeout: 10000,
        apiKey: TONCENTER_API_KEY,
    });

    // 1. get tx alone to get the mc block seqno
    sendStatus('Getting the tx');
    const tx = (await clientV4.getAccountTransactions(address, lt, hash))[0];
    console.log(tx.tx.now, 'tx time');
    await waitForRateLimit();
    const { mcSeqno, randSeed } = await mcSeqnoByShard(tx.block, testnet);
    await waitForRateLimit();
    const fullBlock = await clientV4.getBlock(mcSeqno);
    const mcBlockSeqno = fullBlock.shards[0].seqno;

    // 2. find min lt tx on account in block
    let isOurTxLastTx = true;
    let minLt = tx.tx.lt;
    let addrStr = address.toString();
    for (let shard of fullBlock.shards) {
        for (let txInBlock of shard.transactions) {
            if (txInBlock.account === addrStr) {
                if (BigInt(txInBlock.lt) < minLt) {
                    minLt = BigInt(txInBlock.lt);
                }
                // won't check balance at the end if our tx
                // is not last in block
                if (BigInt(txInBlock.lt) > tx.tx.lt) {
                    isOurTxLastTx = false;
                }
            }
        }
    }

    // 3. get txs from the mc block (maybe many shard blocks)
    sendStatus('Getting previous txs');
    const txs = await getOtherTxs(clientV2, {
        address,
        lt,
        minLt: minLt - 1n,
        hash: hash.toString('base64'),
    });

    console.log(txs.length, 'transactions found');
    console.log('first:', txs[txs.length - 1].lt, 'last:', txs[0].lt);

    // 3.1 get blockchain config
    sendStatus('Getting blockchain config');
    await waitForRateLimit();
    const configBase64 = await getConfigAll(testnet, mcBlockSeqno);

    // 4. get prev. state from prev. block
    sendStatus('Getting account state');
    const getAccountResult = await clientV4.getAccount(
        mcBlockSeqno - 1,
        address
    );
    let account = getAccountResult.account;
    let initialShardAccount = createShardAccountFromAPI(account, address);

    // 4.1 Get libs if needed
    const _libs = Dictionary.empty(
        Dictionary.Keys.BigUint(256),
        Dictionary.Values.Cell()
    );

    async function tryAddLib(code?: Cell | null) {
        if (code instanceof Cell && code.bits.length == 256 + 8) {
            const cs = code.beginParse(true);
            const tag = cs.loadUint(8);
            if (tag == 2) {
                sendStatus('Getting libs');
                const libHash = cs.loadBuffer(32);
                const libHashHex = libHash.toString('hex').toUpperCase();
                console.log('Found lib:', libHashHex);
                const actualCode = await getLib(libHashHex, testnet);
                _libs.set(BigInt(`0x${libHashHex}`), actualCode);
            }
        }
    }

    const state = initialShardAccount.account?.storage.state;
    if (state?.type == 'active') {
        await tryAddLib(state.state.code);
    }
    const msgInit = tx.tx.inMessage?.init;
    if (msgInit) {
        await tryAddLib(msgInit.code);
    }
    let libs: Cell | null = null;
    if (_libs.size > 0) libs = beginCell().storeDictDirect(_libs).endCell();

    // 5. prep. emulator
    sendStatus('Creating emulator');
    let blockchain = await Blockchain.create();
    const executor = blockchain.executor;
    let version = { commitHash: '', commitDate: '' };
    // must be Executor
    if (executor instanceof Executor) {
        version = executor.getVersion();
    }

    // function - to use in with prev txs
    async function _emulate(_tx: Transaction, _shardAccountStr: string) {
        const _msg = _tx.inMessage;
        if (!_msg) throw new Error('No in_message was found in tx');

        let _txRes = executor.runTransaction({
            config: configBase64,
            libs,
            verbosity: 'full_location_stack_verbose',
            shardAccount: _shardAccountStr,
            message: beginCell().store(storeMessage(_msg)).endCell(),
            now: _tx.now,
            lt: _tx.lt,
            randomSeed: randSeed,
            ignoreChksig: false,
            debugEnabled: true,
        });

        return _txRes;
    }

    // reverse the array because first txs
    // in inital list are the new ones
    let prevTxsInBlock = txs.slice(1);
    prevTxsInBlock.reverse();

    // for first transaction (executor doesn't know about last tx):
    initialShardAccount.lastTransactionLt = 0n;
    initialShardAccount.lastTransactionHash = 0n;

    let shardAccountStr = beginCell()
        .store(storeShardAccount(initialShardAccount))
        .endCell()
        .toBoc()
        .toString('base64');

    // 6. emulate prev. txs in block
    sendStatus('Emulating');
    let prevBalance = BigInt(account.balance.coins);
    let prevBalanceEC = account.balance.currencies;
    if (prevTxsInBlock.length > 0) {
        let on = 1;
        for (let _tx of prevTxsInBlock) {
            sendStatus(`Emulating ${on}/${prevTxsInBlock.length}`);
            let midRes = await _emulate(_tx, shardAccountStr);

            if (!midRes.result.success) {
                console.log(midRes.logs);
                console.log(midRes.debugLogs);
                throw new Error(`Transaction failed for lt: ${_tx.lt}`);
            }

            const midTxOccured = loadTransaction(
                Cell.fromBase64(midRes.result.transaction).asSlice()
            );
            const stateOk = midTxOccured.stateUpdate.newHash.equals(
                _tx.stateUpdate.newHash
            );

            console.log('State update ok:', stateOk);

            shardAccountStr = midRes.result.shardAccount;

            let parsedShardAccount = loadShardAccount(
                Cell.fromBase64(shardAccountStr).asSlice()
            );
            console.log('parsedShardAccount', parsedShardAccount);

            const newBalance =
                parsedShardAccount.account?.storage.balance.coins;
            const newBalanceEC =
                parsedShardAccount.account?.storage.balance.other;
            console.log(`lt: ${_tx.lt} balance: ${newBalance}`);

            prevBalance = newBalance || 0n;
            prevBalanceEC = {};
            if (newBalanceEC) {
                for (const key of newBalanceEC.keys()) {
                    const value = newBalanceEC.get(key);
                    prevBalanceEC[key.toString()] = value?.toString() || '0';
                }
            }
            console.log('Emulated mid tx:', _tx.lt, 'new balance:', newBalance);
            on++;
        }
    }

    // 7. run the target tx

    const msg = txs[0].inMessage;
    if (!msg) throw new Error('No in_message was found in tx');

    sendStatus('Emulating transaction');
    let txRes = await _emulate(txs[0], shardAccountStr);

    if (
        tx.tx.description.type === 'generic' &&
        tx.tx.description.computePhase.type === 'vm'
    ) {
        console.log('Api gasUsed:', tx.tx.description.computePhase.gasUsed);
    }

    console.log('logs:', txRes.logs);

    // 8. process stack and instructions

    sendStatus('Reading stack');
    if (!txRes.result.success) {
        console.error('Transaction (with stack) failed:', txRes);
        throw new Error(`Transaction failed: ${txRes.result.error}`);
    }
    let TVMResult: TVMLog[] = [];
    let finalC5Error: C5Error | undefined = undefined;
    let finalActions: OutAction[] = [];
    let instruction = '';
    let prevGasRemaining = 0;
    let gasRemaining = 0;
    let tryCatchError: { code: number; text: string } | undefined = undefined;
    const logs = txRes.result.vmLog;
    const lines = logs.split('\n');
    let isStackAfter = (i: number) => {
        // go for all next lines until we find one starting with "stack:""
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith('stack:')) {
                return true;
            }
        }
        return false;
    };
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.startsWith('execute')) {
            if (instruction) {
                console.warn('No stack was for instruction:', instruction);
            }
            instruction = line.slice(8);
        }

        if (line.startsWith('gas remaining:')) {
            if (gasRemaining != 0 || !instruction) {
                console.warn('Unexpected line:', line);
            }
            gasRemaining = Number(line.slice(15));
        }

        if (line.startsWith('stack:')) {
            const stack = parseStack(line);
            // got stack. now link it with the instruction and gas

            let price: number | undefined = prevGasRemaining - gasRemaining;
            if (price < 0) price = undefined; // maybe SETGASLIMIT

            if (instruction) {
                TVMResult.push({
                    instruction,
                    price,
                    gasRemaining,
                    error: tryCatchError, // mostly undefined
                    stackAfter: stack,
                });
            } else {
                if (TVMResult.length > 0) {
                    // bad behavior
                    console.error('No instruction for stack:', stack);
                    console.error(
                        `last instruction: #${
                            TVMResult.length - 1
                        }. ${instruction}`
                    );
                    TVMResult.push({
                        // push stack without instruction
                        instruction: 'unknown instruction',
                        price,
                        gasRemaining,
                        stackAfter: stack,
                        error: tryCatchError,
                    });
                }
            }

            instruction = '';
            prevGasRemaining = gasRemaining;
            gasRemaining = 0;
            tryCatchError = undefined;
        }

        if (
            line.startsWith('handling exception code') ||
            line.startsWith(
                'default exception handler, terminating vm with exit code'
            )
        ) {
            let exitCode: number;
            let explanation: string;
            if (line.startsWith('handling')) {
                // when error occurs on ordinary instruction
                exitCode = Number(line.slice(24, line.indexOf(':')));
                explanation = line.slice(line.indexOf(':') + 2);
            } else {
                // or when it's THROW (IF/UNLESS)
                exitCode = Number(line.slice(57));
                explanation = line;
            }
            if (!isStackAfter(i)) {
                // if last
                TVMResult.push({
                    instruction,
                    price: undefined,
                    gasRemaining,
                    error: { code: exitCode, text: explanation },
                    stackAfter: [],
                });
                console.log(
                    `Found terminal error ${exitCode} on instruction ${instruction}`
                );
                break;
            } else {
                console.log(
                    `Found try/catch exception ${exitCode} on instruction ${instruction}`
                );
                tryCatchError = { code: exitCode, text: explanation };
            }
        }
        if (line.startsWith('final c5:')) {
            const parseResult = parseC5(line);
            if (parseResult.error) {
                finalC5Error = parseResult.error;
                finalActions = [];
            } else {
                finalActions = parseResult.actions || [];
            }
        }
    }

    // 9. process c5

    // 10. parse, compile and return the result
    sendStatus('Packing the result');

    let parsedShardAccount = loadShardAccount(
        Cell.fromBase64(txRes.result.shardAccount).asSlice()
    );
    const endBalance = parsedShardAccount.account?.storage.balance.coins || 0n;

    const theTx = loadTransaction(
        Cell.fromBase64(txRes.result.transaction).asSlice()
    );
    const oldStateHashOk = theTx.stateUpdate.oldHash.equals(
        txs[0].stateUpdate.oldHash
    );
    if (!oldStateHashOk) {
        console.warn(
            'State update oldHash mismatch:',
            txs[0].stateUpdate.oldHash.toString('hex'),
            '!=',
            theTx.stateUpdate.oldHash.toString('hex')
        );
    } else {
        console.log('State update oldHash ok');
    }

    const stateUpdateHashOk = theTx.stateUpdate.newHash.equals(
        txs[0].stateUpdate.newHash
    );
    if (!stateUpdateHashOk) {
        console.warn('State update hash mismatch. Maybe random in txs?');
    } else {
        console.log('State update hash ok');
    }

    if (!theTx.inMessage)
        throw new Error('No in_message was found in result tx');

    const src = theTx.inMessage.info.src;
    const dest = theTx.inMessage.info.dest;

    if (src !== undefined && src !== null && !Address.isAddress(src)) {
        console.log(`Src: ${src}`);
        throw new Error('Invalid src address');
    }
    if (!Address.isAddress(dest)) {
        console.log(`Dest: ${dest}`);
        throw new Error('Invalid dest address');
    }

    const amount =
        theTx.inMessage?.info.type == 'internal'
            ? theTx.inMessage?.info.value.coins
            : undefined;

    let sentTotal = 0n;
    for (let outMsg of theTx.outMessages.values()) {
        if (outMsg.info.type == 'internal') {
            sentTotal += outMsg.info.value.coins;
        }
    }
    const totalFees = theTx.totalFees.coins;

    const balanceAfter = endBalance;

    if (theTx.description.type !== 'generic') {
        throw new Error(
            'No support for non-generic txs. Given type: ' +
                theTx.description.type
        );
    }

    const computePhase = theTx.description.computePhase;
    const computeInfo: ComputeInfo =
        computePhase.type === 'skipped'
            ? 'skipped'
            : {
                  success: computePhase.success,
                  exitCode:
                      // if success in compute, there's action phase.
                      // so put its result code as exit too (if not 0)
                      computePhase.exitCode == 0
                          ? theTx.description.actionPhase?.resultCode || 0
                          : computePhase.exitCode,
                  vmSteps: computePhase.vmSteps,
                  gasUsed: computePhase.gasUsed,
                  gasFees: computePhase.gasFees,
              };

    return {
        sender: src,
        contract: dest,
        amount,
        utime: theTx.now,
        lt: theTx.lt,
        money: {
            balanceBefore: prevBalance,
            sentTotal,
            totalFees,
            balanceAfter,
        },
        computeInfo,
        computeLogs: TVMResult,
        stateUpdateHashOk,
        executorLogs: txRes.logs,
        emulatorVersion: version,
        links: txToLinks({ addr: address, lt, hash }, testnet),
        actions: finalActions,
        c5Error: finalC5Error,
    };
}
