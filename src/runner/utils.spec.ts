jest.mock('./runner', () => ({
    waitForRateLimit: jest.fn().mockResolvedValue(undefined),
    headers: undefined,
}));

import { Address } from '@ton/core';
import { resolveTxByHash } from './utils';
import { TransactionIndexed, TransactionList } from './types';

const makeTx = (overrides: Partial<TransactionIndexed>): TransactionIndexed =>
    ({
        account:
            '0:0000000000000000000000000000000000000000000000000000000000000000',
        hash: Buffer.from(
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            'hex'
        ).toString('base64'),
        lt: '1',
        now: 0,
        orig_status: 'active',
        end_status: 'active',
        total_fees: '0',
        prev_trans_hash: '',
        prev_trans_lt: '0',
        description: '',
        block_ref: { workchain: 0, shard: '0', seqno: 0 },
        in_msg: {
            hash: '',
            source: '',
            destination: '',
            value: '0',
            fwd_fee: '0',
            ihr_fee: '0',
            created_lt: '0',
            created_at: '0',
            opcode: '0',
            ihr_disabled: true,
            bounce: false,
            bounced: false,
            import_fee: '0',
            message_content: {
                hash: '',
                body: '',
                decoded: {},
            },
            init_state: {
                hash: '',
                body: '',
            },
        },
        out_msgs: [],
        account_state_before: null,
        account_state_after: null,
        mc_block_seqno: null,
        ...overrides,
    }) as TransactionIndexed;

const makeList = (txs: TransactionIndexed[]): TransactionList => ({
    transactions: txs,
    address_book: {},
});

describe('resolveTxByHash', () => {
    const hashHex =
        '9332cb256b820e4d7a980980bbb280419c1e0e5747f562a0a7a6f4ee16c3d879';
    const testnetAccount = Address.parse(
        'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_'
    );

    it('resolves testnet hash on first run when mainnet misses', async () => {
        const fetcher = jest
            .fn()
            .mockResolvedValueOnce(makeList([]))
            .mockResolvedValueOnce(
                makeList([
                    makeTx({
                        lt: '22552863000001',
                        hash: Buffer.from(hashHex, 'hex').toString('base64'),
                        account: testnetAccount.toRawString(),
                    }),
                ])
            );

        const result = await resolveTxByHash(hashHex, false, fetcher);

        expect(result.testnet).toBe(true);
        expect(result.tx.lt).toBe(22552863000001n);
        expect(result.tx.hash.toString('hex')).toBe(hashHex);
        expect(result.tx.addr.toRawString()).toBe(testnetAccount.toRawString());
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            { hash: hashHex, limit: 1 },
            false
        );
        expect(fetcher).toHaveBeenNthCalledWith(
            2,
            { hash: hashHex, limit: 1 },
            true
        );
    });

    it('falls back to testnet when mainnet lookup errors', async () => {
        const fetcher = jest
            .fn()
            .mockRejectedValueOnce(new Error('mainnet: 429 Too Many Requests'))
            .mockResolvedValueOnce(
                makeList([
                    makeTx({
                        lt: '2',
                        hash: Buffer.from(hashHex, 'hex').toString('base64'),
                        account: testnetAccount.toRawString(),
                    }),
                ])
            );

        const result = await resolveTxByHash(hashHex, false, fetcher);

        expect(result.testnet).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('queries only testnet when forced', async () => {
        const fetcher = jest.fn().mockResolvedValueOnce(
            makeList([
                makeTx({
                    lt: '3',
                    hash: Buffer.from(hashHex, 'hex').toString('base64'),
                    account: testnetAccount.toRawString(),
                }),
            ])
        );

        const result = await resolveTxByHash(hashHex, true, fetcher);

        expect(result.testnet).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(
            { hash: hashHex, limit: 1 },
            true
        );
    });

    it('returns a descriptive error when nothing is found', async () => {
        const fetcher = jest
            .fn()
            .mockResolvedValueOnce(makeList([]))
            .mockResolvedValueOnce(makeList([]));

        await expect(resolveTxByHash(hashHex, false, fetcher)).rejects.toThrow(
            "Couldn't find transaction by hash on mainnet or testnet."
        );
    });
});
