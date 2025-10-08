import { Address, Builder, Cell, OutAction, Slice } from '@ton/core';

export type StateFromAPI =
    | {
          type: 'uninit';
      }
    | {
          data: string | null;
          code: string | null;
          type: 'active';
      }
    | {
          type: 'frozen';
          stateHash: string;
      };

export type AccountFromAPI = {
    balance: {
        coins: string;
        // currencies: Record<string, string>;
    };
    state: StateFromAPI;
    last: {
        lt: string;
        hash: string;
    } | null;
    storageStat: {
        lastPaid: number;
        duePayment: string | null;
        used: {
            bits: number;
            cells: number;
            // publicCells?: number | undefined;
        };
    } | null;
};


// runner return types
export type TVMLog = {
    instruction: string;
    price: number | undefined;
    gasRemaining: number;
    error?: { code: number; text: string };
    stackAfter: StackElement[];
};

export type TxLinks = {
    txtracer: string;
    tonviewer: string;
    tonscan: string;
    toncoin: string;
    dton: string;
};

export type StackElement =
    | bigint
    | Cell
    | Slice
    | Builder
    | Address
    | null
    | undefined
    | string
    | any[];

export interface C5Error {
    message: string;
    originalHex: string;
}

export type ComputeInfo =
    | 'skipped'
    | {
          success: boolean;
          exitCode: number;
          vmSteps: number;
          gasUsed: bigint;
          gasFees: bigint;
      };

export type EmulateWithStackResult = {
    sender: Address | undefined | null;
    contract: Address;
    amount: bigint | undefined;
    utime: number;
    lt: bigint;
    money: {
        balanceBefore: bigint;
        sentTotal: bigint;
        totalFees: bigint;
        balanceAfter: bigint;
    };
    computeInfo: ComputeInfo;
    computeLogs: TVMLog[];
    stateUpdateHashOk: boolean;
    executorLogs: string;
    emulatorVersion: {
        commitHash: string;
        commitDate: string;
    };
    links: TxLinks;
    actions: OutAction[];
    c5Error?: C5Error;
};

// Indexer v3 API types
export interface TransactionIndexed {
    account: string;
    hash: string;
    lt: string;
    now: number;
    orig_status: 'uninit' | 'frozen' | 'active' | 'nonexist';
    end_status: 'uninit' | 'frozen' | 'active' | 'nonexist';
    total_fees: string;
    prev_trans_hash: string;
    prev_trans_lt: string;
    description: string;
    block_ref: {
        workchain: number;
        shard: string;
        seqno: number;
    };
    in_msg: {
        hash: string;
        source: string;
        destination: string;
        value: string;
        fwd_fee: string;
        ihr_fee: string;
        created_lt: string;
        created_at: string;
        opcode: string;
        ihr_disabled: boolean;
        bounce: boolean;
        bounced: boolean;
        import_fee: string;
        message_content: {
            hash: string;
            body: string;
            decoded: Record<string, unknown>;
        };
        init_state: {
            hash: string;
            body: string;
        };
    };
    out_msgs: {
        hash: string;
        source: string;
        destination: string;
        value: string;
        fwd_fee: string;
        ihr_fee: string;
        created_lt: string;
        created_at: string;
        opcode: string;
        ihr_disabled: boolean;
        bounce: boolean;
        bounced: boolean;
        import_fee: string;
        message_content: {
            hash: string;
            body: string;
            decoded: Record<string, unknown>;
        };
        init_state: {
            hash: string;
            body: string;
        };
    }[];
    account_state_before: {
        hash: string;
        balance: string;
        account_status: 'uninit' | 'frozen' | 'active' | 'nonexist';
        frozen_hash: string;
        code_hash: string;
        data_hash: string;
    } | null;
    account_state_after: {
        hash: string;
        balance: string;
        account_status: 'uninit' | 'frozen' | 'active' | 'nonexist';
        frozen_hash: string;
        code_hash: string;
        data_hash: string;
    } | null;
    mc_block_seqno: number | null;
}

export interface AddressBookEntry {
    user_friendly: string;
}

export interface TransactionList {
    transactions: TransactionIndexed[];
    address_book: Record<string, AddressBookEntry>;
}

export interface GetTransactionsParams {
    workchain?: number | null;
    shard?: string | null;
    seqno?: number | null;
    account?: string[];
    exclude_account?: string[];
    hash?: string | null;
    lt?: number | null;
    start_utime?: number | null;
    end_utime?: number | null;
    start_lt?: number | null;
    end_lt?: number | null;
    limit?: number;
    offset?: number;
    sort?: 'asc' | 'desc';
}
export type BaseTxInfo = { lt: bigint; hash: Buffer; addr: Address };
