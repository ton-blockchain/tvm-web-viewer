import React, { useCallback, useEffect, useState, useRef } from 'react';

import {
    ChakraProvider,
    Button,
    Center,
    Flex,
    Box,
    Input,
    Heading,
    InputGroup,
    InputRightElement,
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalCloseButton,
    ModalBody,
    ModalFooter,
    Spinner,
    Text,
    Spacer,
    Grid,
    Link,
    Divider,
    useToast,
    Tooltip,
    TableContainer,
    Table,
    Tbody,
    Tr,
    Td,
    Icon,
    Card,
    CardHeader,
    CardBody,
    CardFooter,
    SimpleGrid,
    Thead,
    Th,
    Tfoot,
    TableCaption,
    IconButton,
    Collapse,
    useDisclosure,
} from '@chakra-ui/react';
import {
    ExternalLinkIcon,
    ChevronDownIcon,
    ChevronUpIcon,
} from '@chakra-ui/icons';
import { common, createStarryNight } from '@wooorm/starry-night';
import { toHtml } from 'hast-util-to-html';
import { fromHtml } from 'hast-util-from-html';
import {
    Address,
    beginCell,
    Builder,
    Cell,
    fromNano,
    OutAction,
    Slice,
    storeMessageRelaxed,
} from '@ton/core';
import { getEmulationWithStack } from './runner/runner';
import { EmulateWithStackResult, StackElement } from './runner/types';
import { customStringify, linkToTx } from './runner/utils';
import { GithubIcon } from './icons/github';
import { TonIcon } from './icons/ton';
import theme from './theme';
import { DocsIcon } from './icons/docs';
import { instruction, root_schema } from './instructions/schema';
import { ApiKeyProvider, useApiKeys } from './contexts/ApiKeyContext';
import { ToncenterKeysModal } from './components/ToncenterKeys';
import { TonCenterIcon } from './icons/toncenter';

type KeyPressHandler = () => void;
const OPCODES_JSON_URL =
    'https://raw.githubusercontent.com/ton-community/tvm-spec/refs/heads/dev/cp0.json';

const getCodeAroundLine = (
    content: string,
    targetLine: number
): { code: string; startLine: number } => {
    if (!content) return { code: 'loading...', startLine: 1 };

    // Show the entire file content
    return { code: content, startLine: 1 };
};

const useGlobalKeyPress = (key: string, action: KeyPressHandler) => {
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.key === key) {
                action();
            }
        };

        window.addEventListener('keyup', handleKeyPress);

        return () => {
            window.removeEventListener('keyup', handleKeyPress);
        };
    }, [key, action]);
};

export const getQueryParam = (param: string) => {
    const queryParams = new URLSearchParams(window.location.search);
    return queryParams.get(param);
};

function App() {
    const txFromArg = decodeURIComponent(getQueryParam('tx') || '');
    const [testnet, setTestnet] = useState<boolean>(
        getQueryParam('testnet') === 'true'
    );
    const [isToncenterKeysOpen, setIsToncenterKeysOpen] = useState(false);
    const { apiKeys } = useApiKeys();

    const [link, setLink] = useState<string>(txFromArg);
    const [isErrorOpen, setIsErrorOpen] = useState(false);
    const [areLogsOpen, setAreLogsOpen] = useState(false);
    const [isC5Open, setIsC5Open] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [emulationStatus, setEmulationStatus] = useState<string>('');
    const [emulationResult, setEmulationResult] = useState<
        EmulateWithStackResult | undefined
    >(undefined);
    const [processing, setProcessing] = useState(false);
    const [selectedStep, setSelectedStep] = useState<number>(0);
    const [isStackBefore, setIsStackBefore] = useState<boolean>(false);
    const [opcodes, setOpcodes] = useState<instruction[]>([]);
    const [selectedOpcode, setSelectedOpcode] = useState<instruction | null>(
        null
    );
    const [matchingOpcodes, setMatchingOpcodes] = useState<instruction[]>([]);
    const [selectedOpcodeStackDiff, setSelectedOpcodeStackDiff] = useState<
        [number, number] | null
    >(null);
    const [maxDocWindowHeight, setMaxDocWindowHeight] = useState<number>(0);
    const docBoxRef = useRef<HTMLDivElement>(null);
    const [isHoveringStack, setIsHoveringStack] = useState(false);
    const [fileCache, setFileCache] = useState<Map<string, string>>(new Map());
    const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
    const [starryNight, setStarryNight] = useState<any>(null);

    const updateURLWithTx = (tx: string) => {
        const encodedTx = encodeURIComponent(tx);
        const url = new URL(window.location.href);
        if (testnet) {
            url.searchParams.set('testnet', testnet.toString());
        }
        url.searchParams.set('tx', encodedTx);
        window.history.pushState({}, '', url.toString());
    };

    async function viewTransaction() {
        console.log('Viewing transaction:', link);
        setErrorText('');
        setEmulationResult(undefined);
        setProcessing(true);
        setEmulationStatus('Recognizing tx');
        try {
            const { tx, testnet: gotTestnet } = await linkToTx(link, testnet, apiKeys.mainnet, apiKeys.testnet);
            setTestnet(gotTestnet);
            const emulation = await getEmulationWithStack(
                tx,
                gotTestnet,
                setEmulationStatus,
                apiKeys.mainnet,
                apiKeys.testnet
            );
            setEmulationResult(emulation);
            updateURLWithTx(tx.hash.toString('hex') || '');
        } catch (e) {
            if (e instanceof Error) {
                setErrorText(e.message);
                setIsErrorOpen(true);
            }
            console.error(e);
        }
        setProcessing(false);
    }

    function onCloseErrorModal() {
        setIsErrorOpen(false);
        setErrorText('');
    }

    const toast = useToast();

    const handleCopy = useCallback((text: string) => {
        navigator.clipboard.writeText(text);
        toast({
            title: 'Copied to clipboard',
            status: 'success',
            duration: 3000,
            position: 'bottom-left',

            containerStyle: {
                background: 'green.600',
                rounded: '0',
                fontSize: '12',
            },
        });
    }, []);

    const prevStep = () => {
        if (selectedStep > 0) {
            setSelectedStep(selectedStep - 1);
            if (emulationResult) {
                const instruction =
                    emulationResult.computeLogs[selectedStep - 1].instruction;
                handleOpcodeClick(instruction);
            }
        }
    };

    useGlobalKeyPress('ArrowLeft', prevStep);

    const nextStep = () => {
        if (
            emulationResult &&
            selectedStep < emulationResult.computeLogs.length - 1
        ) {
            setSelectedStep(selectedStep + 1);
            const instruction =
                emulationResult.computeLogs[selectedStep + 1].instruction;
            handleOpcodeClick(instruction);
        }
    };
    useGlobalKeyPress('ArrowRight', nextStep);

    const loadOpcodesJson = useCallback(async () => {
        if (opcodes.length > 0) return;

        try {
            console.log('Loading opcodes json...');
            const response = await fetch(OPCODES_JSON_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data: root_schema = await response.json();
            setOpcodes(data.instructions);
        } catch (error) {
            console.error('Error loading opcodes:', error);
        }
    }, [opcodes]);

    useEffect(() => {
        // load opcodes on first render
        loadOpcodesJson();
        // initialize starry night
        initStarryNight();
    }, []);

    const initStarryNight = async () => {
        try {
            const starryNightInstance = await createStarryNight(common);
            setStarryNight(starryNightInstance);
        } catch (error) {
            console.error('Failed to initialize starry night:', error);
        }
    };

    const findOpcodeInfo = useCallback(
        (opcodeStr: string): instruction | null => {
            if (!opcodeStr || opcodes.length === 0) return null;

            let normalizedStr = opcodeStr.trim();
            if (normalizedStr.startsWith('implicit ')) {
                normalizedStr = normalizedStr.slice(9).trim();
            }

            // split into command name and parameters
            const parts = normalizedStr.split(/\s+|,/);
            const commandName = parts[0].toUpperCase();

            const exactMatch = opcodes.find(
                (op) => op.mnemonic.toUpperCase() === commandName
            );
            if (exactMatch) return exactMatch;

            if (commandName === 'XCHG') {
                const params = parts.slice(1).filter((p) => p.startsWith('s'));
                if (params.length >= 2) {
                    const i = parseInt(params[0].substring(1));
                    const j = parseInt(params[1].substring(1));

                    if (!isNaN(i) && !isNaN(j)) {
                        if (i === 0) {
                            // XCHG_0I (s0,si)
                            return (
                                opcodes.find(
                                    (op) => op.mnemonic === 'XCHG_0I'
                                ) || null
                            );
                        } else if (i === 1) {
                            // XCHG_1I (s1,si where i >= 2)
                            if (j >= 2) {
                                return (
                                    opcodes.find(
                                        (op) => op.mnemonic === 'XCHG_1I'
                                    ) || null
                                );
                            }
                        } else {
                            // XCHG_IJ (si,sj where 1 <= i < j <= 15)
                            if (i >= 1 && j > i && j <= 15) {
                                return (
                                    opcodes.find(
                                        (op) => op.mnemonic === 'XCHG_IJ'
                                    ) || null
                                );
                            }
                        }
                    }
                }
            }

            if (commandName === 'PUSHINT') {
                const params = parts.slice(1);
                if (params.length >= 1) {
                    const valueStr = params[0];
                    const value = parseInt(valueStr);
                    
                    if (!isNaN(value)) {
                        if (value >= -5 && value <= 10) {
                            // PUSHINT_4 for small values (-5 <= x <= 10)
                            return (
                                opcodes.find(
                                    (op) => op.mnemonic === 'PUSHINT_4'
                                ) || null
                            );
                        } else if (value >= -128 && value <= 127) {
                            // PUSHINT_8 for 8-bit values (-128 <= xx <= 127)
                            return (
                                opcodes.find(
                                    (op) => op.mnemonic === 'PUSHINT_8'
                                ) || null
                            );
                        } else if (value >= -32768 && value <= 32767) {
                            // PUSHINT_16 for 16-bit values (-2^15 <= xx < 2^15)
                            return (
                                opcodes.find(
                                    (op) => op.mnemonic === 'PUSHINT_16'
                                ) || null
                            );
                        } else {
                            // PUSHINT_LONG for large values
                            return (
                                opcodes.find(
                                    (op) => op.mnemonic === 'PUSHINT_LONG'
                                ) || null
                            );
                        }
                    }
                }
            }

            for (const op of opcodes) {
                if (op.doc.fift.includes('[') && op.doc.fift.includes(']')) {
                    const fiftParts = op.doc.fift.split(/\s+/);
                    const fiftCommand = fiftParts[0].toUpperCase();
                    if (fiftCommand === commandName) {
                        const paramPattern = fiftParts.slice(1).join(' ');
                        const userParams = parts.slice(1).join(' ');
                        if (
                            paramPattern.replace(/\[.*?\]/g, '*').includes('*')
                        ) {
                            return op;
                        }
                    }
                }
            }

            const matchingByDescription = opcodes.filter((op) =>
                op.doc.description.toUpperCase().includes(commandName)
            );

            if (matchingByDescription.length > 0) {
                return matchingByDescription[0];
            }

            const partialMatches = opcodes.filter(
                (op) => op.mnemonic.toUpperCase().includes(commandName)
                // ||
                // (op.aliases &&
                //     op.aliases.some(alias => alias.mnemonic.toUpperCase().includes(commandName)))
            );

            return partialMatches.length > 0 ? partialMatches[0] : null;
        },
        [opcodes]
    );

    const loadFileContent = useCallback(
        async (url: string): Promise<string> => {
            // check cache first
            if (fileCache.has(url)) {
                return fileCache.get(url)!;
            }

            // check if already loading
            if (loadingFiles.has(url)) {
                return '';
            }

            try {
                setLoadingFiles((prev) => new Set(prev).add(url));

                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const content = await response.text();

                setFileCache((prev) => new Map(prev).set(url, content));
                return content;
            } catch (error) {
                console.error('Error loading file:', error);
                return 'Error loading file content';
            } finally {
                setLoadingFiles((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(url);
                    return newSet;
                });
            }
        },
        [fileCache, loadingFiles]
    );

    const handleOpcodeClick = useCallback(
        (hexCode: string) => {
            if (opcodes.length === 0) {
                loadOpcodesJson();
                return;
            }

            const opcodeInfo = findOpcodeInfo(hexCode);
            const allMatches = findRelatedOpcodes(hexCode, opcodes);
            setMatchingOpcodes(allMatches);
            setSelectedOpcode(opcodeInfo);
            setSelectedOpcodeStackDiff(
                parseOpcodeStackDiff(opcodeInfo?.doc.stack || '')
            );
        },
        [opcodes, loadOpcodesJson, findOpcodeInfo]
    );

    const findRelatedOpcodes = (
        opcodeStr: string,
        allOpcodes: instruction[]
    ): instruction[] => {
        const normalizedStr = opcodeStr.trim().toUpperCase();
        const parts = normalizedStr.split(/\s+|,/);
        const commandName = parts[0];

        return allOpcodes
            .filter(
                (op) => op.mnemonic.toUpperCase().includes(commandName)
                // ||
                // (op.aliases &&
                //     op.aliases.some(alias => alias.mnemonic.toUpperCase().includes(commandName)))
            )
            .slice(0, 5);
    };

    // monitor and update maxDocWindowHeight when needed
    useEffect(() => {
        if (docBoxRef.current && selectedOpcode) {
            const currentHeight = docBoxRef.current.scrollHeight;
            if (currentHeight > maxDocWindowHeight) {
                setMaxDocWindowHeight(currentHeight);
            }
        }
    }, [selectedOpcode, maxDocWindowHeight]);

    const determineStackHighlightElements = useCallback(
        (stack: StackElement[], showBefore: boolean): number[] => {
            if (!selectedOpcodeStackDiff) return [];

            const elementsToHighlight: number[] = [];

            if (showBefore) {
                const consumed = selectedOpcodeStackDiff[0];
                for (let i = 0; i < consumed; i++) {
                    elementsToHighlight.push(i);
                }
            } else {
                const produced = selectedOpcodeStackDiff[1];
                for (let i = 0; i < produced; i++) {
                    elementsToHighlight.push(i);
                }
            }

            return elementsToHighlight;
        },
        [selectedOpcodeStackDiff]
    );

    return (
        <ChakraProvider theme={theme}>
            {testnet && (
                <Box bg={'red.500'} width="100%" mb="-13px">
                    <Center>
                        <Text color="white" mt="3px" mb="5px" fontSize="12">
                            Testnet version
                        </Text>
                    </Center>
                </Box>
            )}

            <Flex mt="2rem" mx="2rem">
                <Spacer />
                <Link
                    isExternal
                    aria-label="TVM Retracer GitHub page"
                    href="https://github.com/ton-blockchain/tvm-web-viewer/"
                >
                    <Icon
                        as={GithubIcon}
                        display="block"
                        transition="color 0.2s"
                        color="gray.500"
                        fontSize="1.5rem"
                        _hover={{ color: 'gray.800' }}
                    />
                </Link>
                <Link
                    ml="0.4rem"
                    isExternal
                    aria-label="TON Blockchain website"
                    href="https://ton.org"
                >
                    <Icon
                        as={TonIcon}
                        display="block"
                        transition="color 0.2s"
                        color="gray.500"
                        fontSize="1.5rem"
                        _hover={{ color: 'gray.800' }}
                    />
                </Link>
                <Link
                    ml="0.4rem"
                    isExternal
                    aria-label="TVM Docs"
                    href="https://docs.ton.org/learn/tvm-instructions/instructions"
                >
                    <Icon
                        as={DocsIcon}
                        display="block"
                        transition="color 0.2s"
                        color="gray.500"
                        fontSize="1.5rem"
                        _hover={{ color: 'gray.800' }}
                    />
                </Link>
                <Link
                    ml="0.4rem"
                    isExternal
                    aria-label="Toncenter Keys Settings"
                    onClick={() => setIsToncenterKeysOpen(true)}
                >
                    <Icon
                        as={TonCenterIcon}
                        display="block"
                        transition="color 0.2s"
                        color="gray.500"
                        fontSize="1.5rem"
                        _hover={{ color: 'gray.800' }}
                    />
                </Link>
            </Flex>
            <ToncenterKeysModal isOpen={isToncenterKeysOpen} onClose={() => setIsToncenterKeysOpen(false)} />
            <Center>
                <Box width="80%" alignContent="center" mt="4rem">
                    <Heading mb="0.5rem">TVM Retracer</Heading>
                    <InputGroup>
                        <Input
                            placeholder="Transaction link (any explorer)"
                            rounded="0"
                            size="md"
                            value={link}
                            onChange={(e) => setLink(e.target.value)}
                            type="url"
                            onKeyUp={(e) => {
                                if (e.key === 'Enter') {
                                    viewTransaction();
                                }
                            }}
                        ></Input>
                        <InputRightElement width="6rem">
                            <Button
                                fontSize="14.5px"
                                fontFamily="IntelOneMono Bold"
                                variant="solid"
                                h="95%"
                                rounded="0"
                                colorScheme="blue"
                                onClick={viewTransaction}
                            >
                                Emulate
                            </Button>
                        </InputRightElement>
                    </InputGroup>
                    {emulationResult ? (
                        <Box>
                            <Grid
                                mt="1rem"
                                fontSize="12"
                                templateColumns="repeat(3, 1fr)"
                                gap="1rem"
                            >
                                <Box>
                                    <Text>
                                        Sender: <br />
                                        {emulationResult.sender?.toString()}
                                    </Text>
                                    <Text>
                                        Contract: <br />
                                        {emulationResult.contract?.toString()}
                                    </Text>
                                    <Text>
                                        Amount:{' '}
                                        {emulationResult.amount
                                            ? fromNano(
                                                  emulationResult.amount || 0n
                                              ) + ' TON'
                                            : 'none'}
                                    </Text>
                                    <Text>
                                        Time:{' '}
                                        {new Date(
                                            emulationResult.utime * 1000 || 0
                                        ).toLocaleString()}
                                    </Text>
                                    <Text>
                                        Timestamp: {emulationResult.utime}
                                    </Text>
                                    <Text>
                                        Lt: {emulationResult.lt.toString()}
                                    </Text>
                                </Box>

                                {/* <Spacer /> */}
                                <Box ml="6rem">
                                    <Text>
                                        Balance before:{' '}
                                        {fromNano(
                                            emulationResult.money.balanceBefore
                                        )}{' '}
                                        TON
                                    </Text>

                                    <Text>
                                        Compute fees:{' '}
                                        {emulationResult.computeInfo !=
                                        'skipped'
                                            ? fromNano(
                                                  emulationResult.computeInfo
                                                      .gasFees
                                              ) + ' TON'
                                            : 'none'}
                                    </Text>
                                    <Text>
                                        Total fees:{' '}
                                        {fromNano(
                                            emulationResult.money.totalFees
                                        )}{' '}
                                        TON
                                    </Text>
                                    <Text>
                                        Total sent:{' '}
                                        {fromNano(
                                            emulationResult.money.sentTotal
                                        )}{' '}
                                        TON
                                    </Text>
                                    <Text>
                                        Balance after:{' '}
                                        {fromNano(
                                            emulationResult.money.balanceAfter
                                        )}{' '}
                                        TON
                                    </Text>
                                </Box>

                                <Box>
                                    <TxLink
                                        link={emulationResult.links.toncx}
                                        explorer="ton.cx"
                                    />

                                    <TxLink
                                        link={emulationResult.links.tonviewer}
                                        explorer="tonviewer.com"
                                    />
                                    <TxLink
                                        link={emulationResult.links.tonscan}
                                        explorer="tonscan.org"
                                    />
                                    <TxLink
                                        link={emulationResult.links.toncoin}
                                        explorer="explorer.toncoin.org"
                                    />
                                    <TxLink
                                        link={emulationResult.links.dton}
                                        explorer="dton.io"
                                    />
                                    <Flex mt="1.5rem">
                                        <Spacer />
                                        <Button
                                            px="2"
                                            mr="0.5rem"
                                            size="sm"
                                            rounded="0"
                                            fontSize="12"
                                            fontFamily="IntelOneMono"
                                            border="1px solid"
                                            borderColor="#979CCA"
                                            bg="#D5D9FF"
                                            leftIcon=<ExternalLinkIcon mr="-4px" />
                                            onClick={() => setIsC5Open(true)}
                                        >
                                            C5
                                        </Button>
                                        <Button
                                            size="sm"
                                            rounded="0"
                                            fontSize="12"
                                            fontFamily="IntelOneMono"
                                            border="1px solid"
                                            borderColor="#ACACAC"
                                            bg="#D9D9D9"
                                            leftIcon=<ExternalLinkIcon />
                                            onClick={() => setAreLogsOpen(true)}
                                        >
                                            Logs
                                        </Button>
                                    </Flex>
                                </Box>
                            </Grid>
                            {emulationResult.computeInfo !== 'skipped' ? (
                                <Box>
                                    <Box
                                        overflowY="scroll"
                                        height="34rem"
                                        border="solid"
                                        borderColor="#E2E8F0"
                                        bgColor="#F4F4F4"
                                        w="100%"
                                        mt="1rem"
                                        py="1.2rem"
                                        px="2rem"
                                    >
                                        <Flex fontSize="12">
                                            <Spacer />
                                            <Text>
                                                Success:{' '}
                                                {emulationResult.computeInfo.success.toString()}
                                            </Text>
                                            <Spacer />
                                            <Text>
                                                Exit code:{' '}
                                                {
                                                    emulationResult.computeInfo
                                                        .exitCode
                                                }
                                            </Text>
                                            <Spacer />
                                            <Text>
                                                Vm steps:{' '}
                                                {
                                                    emulationResult.computeInfo
                                                        .vmSteps
                                                }
                                            </Text>

                                            <Spacer />
                                            <Text>
                                                Gas used:{' '}
                                                {emulationResult.computeInfo.gasUsed.toString()}
                                            </Text>
                                            <Spacer />
                                        </Flex>
                                        <Flex mt="1rem">
                                            <Box>
                                                {emulationResult.computeLogs.map(
                                                    (log, i) => (
                                                        <Box key={i}>
                                                            <Button
                                                                variant="link"
                                                                fontFamily="IntelOneMono"
                                                                textColor="#5B5B5B"
                                                                fontSize="14"
                                                                onClick={() => {
                                                                    setSelectedStep(
                                                                        i
                                                                    );
                                                                    handleOpcodeClick(
                                                                        log.instruction
                                                                    );
                                                                }}
                                                            >
                                                                <Tooltip
                                                                    label={
                                                                        !log.error
                                                                            ? `${
                                                                                  log.price
                                                                                      ? `Step cost: ${log.price}  `
                                                                                      : ''
                                                                              }Gas remaining: ${
                                                                                  log.gasRemaining
                                                                              }`
                                                                            : `Exit code ${log.error.code}: ${log.error.text}`
                                                                    }
                                                                    placement="right"
                                                                    hasArrow
                                                                    openDelay={
                                                                        100
                                                                    }
                                                                    fontSize="12"
                                                                >
                                                                    <Text
                                                                        bgColor={
                                                                            log.error
                                                                                ? 'red.200'
                                                                                : selectedStep ==
                                                                                  i
                                                                                ? 'white'
                                                                                : undefined
                                                                        }
                                                                    >
                                                                        {i + 1}.{' '}
                                                                        {shortStep(
                                                                            log.instruction
                                                                        )}
                                                                    </Text>
                                                                </Tooltip>
                                                            </Button>
                                                        </Box>
                                                    )
                                                )}
                                            </Box>
                                            <Spacer />

                                            {emulationResult.computeLogs && (
                                                <Box position="relative">
                                                    <Box
                                                        position="sticky"
                                                        zIndex="1"
                                                        w="25rem"
                                                        bg="#D9D9D9"
                                                        top="1rem"
                                                        py="1rem"
                                                        border="1px dashed"
                                                        borderColor="#A2A2A2"
                                                    >
                                                        <Flex px="1rem">
                                                            <Tooltip
                                                                label="Use Left key"
                                                                openDelay={500}
                                                                fontSize="12"
                                                            >
                                                                <Button
                                                                    mt="0.5rem"
                                                                    mr="1rem"
                                                                    variant="link"
                                                                    p="0"
                                                                    fontSize="14"
                                                                    color="#000"
                                                                    onClick={
                                                                        prevStep
                                                                    }
                                                                >
                                                                    {'<'}
                                                                </Button>
                                                            </Tooltip>
                                                            <Spacer />
                                                            <Center>
                                                                <Text
                                                                    fontFamily="IntelOneMono Bold"
                                                                    fontSize="14"
                                                                    textAlign="center"
                                                                >
                                                                    {selectedStep +
                                                                        1}
                                                                    .{' '}
                                                                    {shortStep(
                                                                        emulationResult
                                                                            .computeLogs[
                                                                            selectedStep
                                                                        ]
                                                                            .instruction
                                                                    )}
                                                                </Text>
                                                            </Center>
                                                            <Spacer />
                                                            <Tooltip
                                                                label="Use Right key"
                                                                openDelay={500}
                                                                fontSize="12"
                                                            >
                                                                <Button
                                                                    mt="0.5rem"
                                                                    ml="1rem"
                                                                    variant="link"
                                                                    p="0"
                                                                    fontSize="14"
                                                                    color="#000"
                                                                    onClick={
                                                                        nextStep
                                                                    }
                                                                >
                                                                    {'>'}
                                                                </Button>
                                                            </Tooltip>
                                                        </Flex>
                                                        <Flex
                                                            justifyContent="center"
                                                            alignItems="center"
                                                            mb={2}
                                                        >
                                                            <Text
                                                                fontSize="12"
                                                                cursor={
                                                                    selectedStep >
                                                                    0
                                                                        ? 'help'
                                                                        : 'default'
                                                                }
                                                                textDecoration={
                                                                    isHoveringStack &&
                                                                    selectedStep >
                                                                        0
                                                                        ? 'underline'
                                                                        : 'none'
                                                                }
                                                                color={
                                                                    isHoveringStack &&
                                                                    selectedStep >
                                                                        0
                                                                        ? 'blue.500'
                                                                        : undefined
                                                                }
                                                                onMouseEnter={() =>
                                                                    selectedStep >
                                                                        0 &&
                                                                    setIsHoveringStack(
                                                                        true
                                                                    )
                                                                }
                                                                onMouseLeave={() =>
                                                                    selectedStep >
                                                                        0 &&
                                                                    setIsHoveringStack(
                                                                        false
                                                                    )
                                                                }
                                                            >
                                                                {isHoveringStack &&
                                                                selectedStep > 0
                                                                    ? 'Stack before:'
                                                                    : 'Stack after:'}
                                                            </Text>
                                                        </Flex>
                                                        <TableContainer
                                                            mt="0.5rem"
                                                            overflowY="scroll"
                                                            height="25rem"
                                                        >
                                                            {emulationResult
                                                                .computeLogs[
                                                                selectedStep
                                                            ].error && (
                                                                <Box
                                                                    bgColor="red.200"
                                                                    fontFamily="IntelOneMono Bold"
                                                                    fontSize="12"
                                                                >
                                                                    <Center pt="2">
                                                                        <Text>
                                                                            Failed
                                                                            with
                                                                            exit
                                                                            code{' '}
                                                                            {
                                                                                emulationResult
                                                                                    .computeLogs[
                                                                                    selectedStep
                                                                                ]
                                                                                    .error!
                                                                                    .code
                                                                            }
                                                                        </Text>
                                                                    </Center>
                                                                    <Center
                                                                        whiteSpace="pre-wrap"
                                                                        p="2"
                                                                        textAlign="center"
                                                                    >
                                                                        {
                                                                            emulationResult
                                                                                .computeLogs[
                                                                                selectedStep
                                                                            ]
                                                                                .error!
                                                                                .text
                                                                        }
                                                                    </Center>
                                                                </Box>
                                                            )}
                                                            <Table
                                                                size="sm"
                                                                variant="unstyled"
                                                            >
                                                                <Tbody>
                                                                    {(() => {
                                                                        const showBefore =
                                                                            isHoveringStack &&
                                                                            selectedStep >
                                                                                0;
                                                                        const stack =
                                                                            showBefore
                                                                                ? emulationResult
                                                                                      .computeLogs[
                                                                                      selectedStep -
                                                                                          1
                                                                                  ]
                                                                                      .stackAfter
                                                                                : emulationResult
                                                                                      .computeLogs[
                                                                                      selectedStep
                                                                                  ]
                                                                                      .stackAfter;

                                                                        const elementsToHighlight =
                                                                            determineStackHighlightElements(
                                                                                stack,
                                                                                showBefore
                                                                            );

                                                                        return stack
                                                                            .toReversed()
                                                                            .map(
                                                                                (
                                                                                    item,
                                                                                    i
                                                                                ) =>
                                                                                    stackItemElement(
                                                                                        item,
                                                                                        i,
                                                                                        handleCopy,
                                                                                        elementsToHighlight.includes(
                                                                                            i
                                                                                        ),
                                                                                        showBefore
                                                                                    )
                                                                            );
                                                                    })()}
                                                                </Tbody>
                                                            </Table>
                                                        </TableContainer>
                                                    </Box>
                                                </Box>
                                            )}
                                        </Flex>
                                    </Box>

                                    <Center>
                                        <Box
                                            mt="2rem"
                                            w="100%"
                                            position="relative"
                                            bg="white"
                                            overflow="hidden"
                                            pl="2rem"
                                            height={
                                                maxDocWindowHeight > 0
                                                    ? `${maxDocWindowHeight}px`
                                                    : 'auto'
                                            }
                                            minHeight="400px"
                                            overflowY="auto"
                                            ref={docBoxRef}
                                        >
                                            {selectedOpcode ? (
                                                <Flex
                                                    gap="2rem"
                                                    height="100%"
                                                    overflowX="auto"
                                                >
                                                    <Box flex="1" minW="50%">
                                                        <Flex alignItems="center">
                                                            <Text
                                                                fontSize="20"
                                                                fontFamily="IntelOneMono Bold"
                                                            >
                                                                {
                                                                    selectedOpcode.mnemonic
                                                                }
                                                            </Text>
                                                        </Flex>
                                                        <Text
                                                            fontSize="14"
                                                            lineHeight="1.5"
                                                            whiteSpace="pre-wrap"
                                                            sx={{
                                                                '& code': {
                                                                    bg: 'gray.100',
                                                                    p: '1px 4px',
                                                                    borderRadius:
                                                                        '3px',
                                                                    fontFamily:
                                                                        'IntelOneMono',
                                                                    fontSize:
                                                                        '90%',
                                                                },
                                                                '& em': {
                                                                    fontStyle:
                                                                        'italic',
                                                                    color: 'gray.700',
                                                                },
                                                            }}
                                                        >
                                                            <br />
                                                            <em>Fift:</em>{' '}
                                                            {selectedOpcode.doc.fift
                                                                .split('\n')
                                                                .map(
                                                                    (
                                                                        asm,
                                                                        index
                                                                    ) => (
                                                                        <code
                                                                            key={
                                                                                index
                                                                            }
                                                                        >
                                                                            {
                                                                                asm
                                                                            }
                                                                        </code>
                                                                    )
                                                                )
                                                                .reduce(
                                                                    (
                                                                        prev,
                                                                        curr,
                                                                        i
                                                                    ) => [
                                                                        ...prev,
                                                                        i > 0
                                                                            ? ','
                                                                            : null,
                                                                        curr,
                                                                    ],
                                                                    [] as React.ReactNode[]
                                                                )}
                                                            <br />
                                                            <em>TLB:</em>{' '}
                                                            <code>
                                                                {
                                                                    selectedOpcode
                                                                        .bytecode
                                                                        .tlb
                                                                }
                                                            </code>
                                                            <br />
                                                            <em>Stack:</em>{' '}
                                                            <code>
                                                                {
                                                                    selectedOpcode
                                                                        .doc
                                                                        .stack
                                                                }
                                                            </code>
                                                            <br />
                                                            <em>Gas:</em>{' '}
                                                            <code>
                                                                {
                                                                    selectedOpcode
                                                                        .doc.gas
                                                                }
                                                            </code>
                                                            <br />
                                                            <br />
                                                            <div
                                                                dangerouslySetInnerHTML={{
                                                                    __html: parseMarkdown(
                                                                        selectedOpcode
                                                                            .doc
                                                                            .description
                                                                    ),
                                                                }}
                                                            />
                                                        </Text>
                                                        {matchingOpcodes.length >
                                                            1 && (
                                                            <Box mt={4}>
                                                                <Text
                                                                    fontSize="12"
                                                                    fontWeight="bold"
                                                                >
                                                                    Similar
                                                                    opcodes:
                                                                </Text>
                                                                <Flex
                                                                    flexWrap="wrap"
                                                                    gap={2}
                                                                    mt={1}
                                                                >
                                                                    {matchingOpcodes.map(
                                                                        (
                                                                            op,
                                                                            idx
                                                                        ) => (
                                                                            <Button
                                                                                key={
                                                                                    idx
                                                                                }
                                                                                size="xs"
                                                                                variant={
                                                                                    op.mnemonic ===
                                                                                    selectedOpcode.mnemonic
                                                                                        ? 'solid'
                                                                                        : 'outline'
                                                                                }
                                                                                rounded="0"
                                                                                borderColor="#ACACAC"
                                                                                bg={
                                                                                    op.mnemonic ===
                                                                                    selectedOpcode.mnemonic
                                                                                        ? '#D9D9D9'
                                                                                        : '#ffffff'
                                                                                }
                                                                                onClick={() =>
                                                                                    setSelectedOpcode(
                                                                                        op
                                                                                    )
                                                                                }
                                                                            >
                                                                                {
                                                                                    op.mnemonic
                                                                                }
                                                                            </Button>
                                                                        )
                                                                    )}
                                                                </Flex>
                                                            </Box>
                                                        )}
                                                    </Box>
                                                    <ImplementationView
                                                        implementation={
                                                            selectedOpcode.implementation
                                                        }
                                                        loadFileContent={
                                                            loadFileContent
                                                        }
                                                        fileCache={fileCache}
                                                        loadingFiles={
                                                            loadingFiles
                                                        }
                                                        starryNight={
                                                            starryNight
                                                        }
                                                    />
                                                </Flex>
                                            ) : null}
                                        </Box>
                                    </Center>
                                    <Box
                                        m="1rem"
                                        fontSize="10"
                                        opacity="50%"
                                        fontFamily="IntelOneMono"
                                    >
                                        <Center>
                                            Used Emulator from commit{' '}
                                            <Link
                                                mx="1"
                                                href={`https://github.com/ton-blockchain/ton/tree/${emulationResult.emulatorVersion.commitHash}`}
                                            >
                                                {emulationResult.emulatorVersion.commitHash.slice(
                                                    0,
                                                    7
                                                )}
                                            </Link>
                                            at{' '}
                                            {
                                                emulationResult.emulatorVersion
                                                    .commitDate
                                            }
                                        </Center>
                                    </Box>
                                </Box>
                            ) : (
                                <Center>
                                    <Text>Compute phase was skipped</Text>
                                </Center>
                            )}
                        </Box>
                    ) : (
                        <></>
                    )}
                    {processing ? (
                        <Box>
                            <Center>
                                <Spinner
                                    mt="2rem"
                                    thickness="4px"
                                    speed="0.65s"
                                    emptyColor="gray.200"
                                    color="blue.500"
                                    size="xl"
                                />
                            </Center>
                            <Center>
                                <Text mt="0.5rem" fontSize="14">
                                    {emulationStatus}
                                </Text>
                            </Center>
                        </Box>
                    ) : (
                        <></>
                    )}
                </Box>
            </Center>

            <Modal
                isOpen={isC5Open}
                isCentered
                scrollBehavior="inside"
                size="full"
                onClose={() => setIsC5Open(false)}
            >
                <ModalOverlay />
                <ModalContent rounded="0">
                    <ModalHeader fontFamily="IntelOneMono Bold">
                        Actions cell (C5)
                    </ModalHeader>
                    <ModalCloseButton />
                    {emulationResult ? (
                        <ModalBody
                            fontSize="12"
                            fontFamily="IntelOneMono"
                            whiteSpace="pre-wrap"
                        >
                            {emulationResult.c5Error ? (
                                <Box>
                                    <Text
                                        color="red.500"
                                        fontSize="16"
                                        fontFamily="IntelOneMono Bold"
                                    >
                                        {emulationResult.c5Error.message}
                                    </Text>
                                    <Box mt="4">
                                        <Text
                                            fontSize="14"
                                            fontFamily="IntelOneMono Bold"
                                        >
                                            Original C5 (hex):
                                        </Text>
                                        <Box
                                            p="4"
                                            mt="2"
                                            bg="gray.100"
                                            fontFamily="IntelOneMono"
                                            wordBreak="break-all"
                                        >
                                            {
                                                emulationResult.c5Error
                                                    .originalHex
                                            }
                                        </Box>
                                        <Button
                                            mt="2"
                                            rounded="0"
                                            size="sm"
                                            fontFamily="IntelOneMono"
                                            colorScheme="blue"
                                            onClick={() =>
                                                handleCopy(
                                                    emulationResult.c5Error
                                                        ?.originalHex || ''
                                                )
                                            }
                                        >
                                            Copy hex
                                        </Button>
                                    </Box>
                                </Box>
                            ) : (
                                <SimpleGrid
                                    minChildWidth="27rem"
                                    spacing="2rem"
                                >
                                    {emulationResult.actions.length > 0 ? (
                                        emulationResult.actions.map(
                                            outActionElement
                                        )
                                    ) : (
                                        <Text>No actions</Text>
                                    )}
                                </SimpleGrid>
                            )}
                        </ModalBody>
                    ) : (
                        <></>
                    )}
                    <ModalFooter>
                        <Button
                            rounded="0"
                            size="sm"
                            fontFamily="IntelOneMono"
                            colorScheme="gray"
                            border="1px solid"
                            borderColor="#ACACAC"
                            bg="#D9D9D9"
                            mr={3}
                            onClick={() => setIsC5Open(false)}
                        >
                            Close
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal
                isOpen={areLogsOpen}
                isCentered
                scrollBehavior="inside"
                size="full"
                onClose={() => setAreLogsOpen(false)}
            >
                <ModalOverlay />
                <ModalContent rounded="0">
                    <ModalHeader fontFamily="IntelOneMono Bold">
                        Executor logs
                    </ModalHeader>
                    <ModalCloseButton />
                    {emulationResult ? (
                        <ModalBody
                            fontSize="12"
                            fontFamily="IntelOneMono"
                            whiteSpace="pre-wrap"
                        >
                            {emulationResult.executorLogs}
                        </ModalBody>
                    ) : (
                        <></>
                    )}
                    <ModalFooter>
                        <Button
                            rounded="0"
                            size="sm"
                            fontFamily="IntelOneMono"
                            colorScheme="gray"
                            border="1px solid"
                            borderColor="#ACACAC"
                            bg="#D9D9D9"
                            mr={3}
                            onClick={() => setAreLogsOpen(false)}
                        >
                            Close
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal isOpen={isErrorOpen} isCentered onClose={onCloseErrorModal}>
                <ModalOverlay />
                <ModalContent rounded="0">
                    <ModalHeader fontFamily="IntelOneMono Bold">
                        Error occured
                    </ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>{errorText}</ModalBody>
                    <ModalFooter>
                        <Button
                            rounded="0"
                            fontFamily="IntelOneMono Bold"
                            colorScheme="red"
                            mr={3}
                            onClick={onCloseErrorModal}
                        >
                            Close
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </ChakraProvider>
    );
}

interface ImplementationViewProps {
    implementation: Array<{
        path: string;
        line: number;
        function_name?: string;
        commit?: string;
    }>;
    loadFileContent: (url: string) => Promise<string>;
    fileCache: Map<string, string>;
    loadingFiles: Set<string>;
}

// helper functions for pretty GitHub links
const extractFileNameFromUrl = (url: string): string => {
    try {
        const parts = url.split('/');
        return parts[parts.length - 1];
    } catch {
        return url;
    }
};

const convertRawToGitHubUrl = (rawUrl: string, line?: number): string => {
    try {
        // convert raw.githubusercontent.com to github.com/blob format
        const converted = rawUrl
            .replace('raw.githubusercontent.com', 'github.com')
            .replace(/\/([a-f0-9]{40})\//, '/blob/$1/');

        return line ? `${converted}#L${line}` : converted;
    } catch {
        return rawUrl;
    }
};

const ImplementationView: React.FC<
    ImplementationViewProps & { starryNight: any }
> = ({
    implementation,
    loadFileContent,
    fileCache,
    loadingFiles,
    starryNight,
}) => {
    const [selectedImpl, setSelectedImpl] = useState<number>(0);
    const [fileContent, setFileContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const {
        isOpen: isExpanded,
        onToggle: toggleExpanded,
        onClose: closeExpanded,
    } = useDisclosure(); // collapsed by default
    const codeContainerRef = useRef<HTMLDivElement>(null);
    const fullscreenCodeRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (implementation.length > 0 && isExpanded) {
            const impl = implementation[selectedImpl];
            if (impl?.path) {
                setIsLoading(true);
                loadFileContent(impl.path).then((content) => {
                    setFileContent(content);
                    setIsLoading(false);
                });
            }
        }
    }, [implementation, selectedImpl, loadFileContent, isExpanded]);

    // Auto-scroll to target line when file loads
    useEffect(() => {
        if (
            !isLoading &&
            fileContent &&
            implementation.length > 0 &&
            isExpanded
        ) {
            const impl = implementation[selectedImpl];
            if (impl?.line) {
                // Small delay to ensure DOM is updated
                const timer = setTimeout(() => {
                    const targetElement = document.getElementById(
                        `target-line-${impl.line}`
                    );
                    if (targetElement && codeContainerRef.current) {
                        // Use container's scroll for more reliable scrolling
                        const container = codeContainerRef.current;
                        const targetRect =
                            targetElement.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();

                        const scrollTop =
                            container.scrollTop +
                            (targetRect.top - containerRect.top) -
                            20; // 20px offset from top

                        container.scrollTo({
                            top: scrollTop,
                            behavior: 'smooth',
                        });
                    }
                }, 150); // Slightly longer delay for better reliability

                return () => clearTimeout(timer);
            }
        }
    }, [isLoading, fileContent, selectedImpl, implementation, isExpanded]);

    // Auto-scroll when expanding already loaded content
    useEffect(() => {
        if (
            isExpanded &&
            !isLoading &&
            fileContent &&
            implementation.length > 0
        ) {
            const impl = implementation[selectedImpl];
            if (impl?.line) {
                // Longer delay to ensure collapse animation is complete
                const timer = setTimeout(() => {
                    const targetElement = document.getElementById(
                        `target-line-${impl.line}`
                    );
                    if (targetElement && codeContainerRef.current) {
                        const container = codeContainerRef.current;
                        const targetRect =
                            targetElement.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();

                        const scrollTop =
                            container.scrollTop +
                            (targetRect.top - containerRect.top) -
                            20;

                        container.scrollTo({
                            top: scrollTop,
                            behavior: 'smooth',
                        });
                    }
                }, 400); // Wait for collapse animation to complete

                return () => clearTimeout(timer);
            }
        }
    }, [isExpanded]);

    // Auto-scroll when opening fullscreen
    useEffect(() => {
        if (
            isFullscreen &&
            implementation.length > 0 &&
            !isLoading &&
            fileContent
        ) {
            const impl = implementation[selectedImpl];
            if (impl?.line) {
                const scrollToTarget = (attempt = 1) => {
                    const maxAttempts = 3;
                    const targetId = `fullscreen-target-line-${impl.line}`;

                    let fullscreenTarget = document.getElementById(targetId);

                    // check within modal if not found
                    if (!fullscreenTarget) {
                        const modal =
                            document.getElementById('fullscreen-modal');
                        if (modal) {
                            fullscreenTarget = modal.querySelector(
                                `[id="${targetId}"]`
                            );
                        }
                    }

                    if (fullscreenTarget) {
                        // use scrollIntoView directly - it's the only method that works reliably
                        fullscreenTarget.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                            inline: 'nearest',
                        });
                    } else if (attempt < maxAttempts) {
                        // retry with delay if element not found yet
                        setTimeout(
                            () => scrollToTarget(attempt + 1),
                            300 * attempt
                        );
                    }
                };

                const timer = setTimeout(() => scrollToTarget(), 400);

                return () => clearTimeout(timer);
            }
        }
    }, [isFullscreen, selectedImpl, implementation, isLoading, fileContent]);

    if (implementation.length === 0) {
        return (
            <Box flex="1" bg="gray.50" p="4" borderRadius="md">
                <Text fontSize="14" color="gray.500">
                    no implementation info available
                </Text>
            </Box>
        );
    }

    const impl = implementation[selectedImpl];
    const { code, startLine } = isExpanded
        ? getCodeAroundLine(fileContent, impl?.line || 0)
        : { code: '', startLine: 1 };

    const highlightCodeBlock = (codeText: string) => {
        if (!starryNight || !codeText) return null;

        try {
            // try to find C++ scope
            const cppScope =
                starryNight.flagToScope('cpp') ||
                starryNight.flagToScope('c++') ||
                'source.cpp';
            const tree = starryNight.highlight(codeText, cppScope);
            return toHtml(tree);
        } catch (error) {
            console.warn('Failed to highlight code:', error);
            return null;
        }
    };

    const addLineNumbers = (
        htmlContent: string,
        startLine: number,
        targetLine?: number
    ) => {
        const lines = htmlContent.split('\n');
        return lines
            .map((line, idx) => {
                const currentLineNumber = startLine + idx;
                const lineNumber = currentLineNumber
                    .toString()
                    .padStart(4, ' ');
                const isTarget = targetLine && currentLineNumber === targetLine;
                const bgColor = isTarget ? 'background-color: #e3f2fd;' : '';
                const lineNumColor = isTarget
                    ? 'color: #1976d2; font-weight: bold;'
                    : 'color: #999;';
                const lineId = isTarget ? `id="target-line-${targetLine}"` : '';
                return `<div ${lineId} style="display: flex; ${bgColor}"><span style="${lineNumColor} padding-right: 10px; user-select: none; white-space: pre;">${lineNumber}</span><span style="white-space: pre;">${line}</span></div>`;
            })
            .join('');
    };

    const codeViewer = (
        <Box
            bg="white"
            border="1px solid"
            borderColor="gray.300"
            borderRadius="0"
            overflow="hidden"
            height={isExpanded ? '100%' : 'auto'}
        >
            {isLoading && isExpanded ? (
                <Flex
                    justifyContent="center"
                    alignItems="center"
                    height="200px"
                >
                    <Spinner size="sm" />
                    <Text ml="2" fontSize="12">
                        loading implementation...
                    </Text>
                </Flex>
            ) : (
                <>
                    <Flex
                        bg="gray.50"
                        p="2"
                        pl="4"
                        borderColor="gray.200"
                        justifyContent="space-between"
                        alignItems="center"
                    >
                        <Link
                            href={convertRawToGitHubUrl(impl.path, impl.line)}
                            isExternal
                            fontSize="12"
                            color="gray.500"
                            //textDecoration="underline"
                            _hover={{ color: 'gray.600' }}
                        >
                            {extractFileNameFromUrl(impl.path)} : {impl.line}{' '}
                            {impl.function_name
                                ? `(${impl.function_name})`
                                : ''}
                        </Link>
                        <Flex gap="1">
                            <IconButton
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                icon={
                                    isExpanded ? (
                                        <ChevronUpIcon w={4} h={4} />
                                    ) : (
                                        <ChevronDownIcon w={4} h={4} />
                                    )
                                }
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                    toggleExpanded();
                                    if (isExpanded) {
                                        setIsFullscreen(false);
                                    }
                                }}
                            />
                            <IconButton
                                aria-label="Fullscreen"
                                icon={<ExternalLinkIcon />}
                                size="xs"
                                variant="ghost"
                                onClick={() => setIsFullscreen(true)}
                                isDisabled={!isExpanded}
                            />
                        </Flex>
                    </Flex>
                    <Collapse
                        in={isExpanded}
                        animateOpacity
                        transition={{
                            enter: { duration: 0.3 },
                            exit: { duration: 0.2 },
                        }}
                    >
                        <Box
                            overflowY="auto"
                            overflowX="auto"
                            maxHeight="400px"
                            ref={codeContainerRef}
                        >
                            <Box
                                fontFamily="IntelOneMono, monospace"
                                fontSize="12px"
                                lineHeight="1.4"
                                p="16px"
                                bg="white"
                                minW="max-content"
                                className="starry-night-code"
                            >
                                {(() => {
                                    const highlighted =
                                        highlightCodeBlock(code);
                                    if (highlighted) {
                                        return (
                                            <div
                                                dangerouslySetInnerHTML={{
                                                    __html: addLineNumbers(
                                                        highlighted,
                                                        startLine,
                                                        impl?.line
                                                    ),
                                                }}
                                            />
                                        );
                                    } else {
                                        return code
                                            .split('\n')
                                            .map((line, idx) => {
                                                const currentLineNumber =
                                                    startLine + idx;
                                                const isTarget =
                                                    impl?.line &&
                                                    currentLineNumber ===
                                                        impl.line;
                                                return (
                                                    <div
                                                        key={idx}
                                                        id={
                                                            isTarget
                                                                ? `target-line-${impl.line}`
                                                                : undefined
                                                        }
                                                        style={{
                                                            display: 'flex',
                                                            backgroundColor:
                                                                isTarget
                                                                    ? '#e3f2fd'
                                                                    : 'transparent',
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                color: isTarget
                                                                    ? '#1976d2'
                                                                    : '#999',
                                                                fontWeight:
                                                                    isTarget
                                                                        ? 'bold'
                                                                        : 'normal',
                                                                paddingRight:
                                                                    '10px',
                                                                userSelect:
                                                                    'none',
                                                                whiteSpace:
                                                                    'pre',
                                                            }}
                                                        >
                                                            {currentLineNumber
                                                                .toString()
                                                                .padStart(
                                                                    4,
                                                                    ' '
                                                                )}
                                                        </span>
                                                        <span
                                                            style={{
                                                                whiteSpace:
                                                                    'pre',
                                                            }}
                                                        >
                                                            {line}
                                                        </span>
                                                    </div>
                                                );
                                            });
                                    }
                                })()}
                            </Box>
                        </Box>
                    </Collapse>
                </>
            )}
        </Box>
    );

    return (
        <>
            <Box
                flex="1"
                maxW="50%"
                minW="400px"
                display="flex"
                flexDirection="column"
            >
                <Flex justifyContent="space-between" alignItems="center" mb="2">
                    <Text fontSize="16" fontFamily="IntelOneMono Bold">
                        Implementation
                    </Text>
                </Flex>

                {implementation.length > 1 && (
                    <Flex mb="2" gap="1">
                        {implementation.map((impl, idx) => (
                            <Button
                                key={idx}
                                size="xs"
                                variant={
                                    selectedImpl === idx ? 'solid' : 'outline'
                                }
                                rounded="0"
                                borderColor="#ACACAC"
                                bg={selectedImpl === idx ? '#D9D9D9' : 'white'}
                                onClick={() => setSelectedImpl(idx)}
                                fontSize="10"
                            >
                                {impl.function_name || `impl ${idx + 1}`}
                            </Button>
                        ))}
                    </Flex>
                )}

                {codeViewer}
            </Box>

            {/* fullscreen modal */}
            <Modal
                isOpen={isFullscreen}
                onClose={() => setIsFullscreen(false)}
                size="full"
                scrollBehavior="inside"
                id="fullscreen-modal"
            >
                <ModalOverlay />
                <ModalContent rounded="0">
                    <ModalHeader
                        fontFamily="IntelOneMono Bold"
                        bg="gray.50"
                        borderBottom="1px solid"
                        borderColor="gray.200"
                    >
                        <Flex
                            justifyContent="space-between"
                            alignItems="center"
                        >
                            <Flex alignItems="center" gap="2">
                                <Text>
                                    {impl.function_name || 'Implementation'} -
                                </Text>
                                <Link
                                    href={convertRawToGitHubUrl(
                                        impl.path,
                                        impl.line
                                    )}
                                    isExternal
                                    color="blue.600"
                                    textDecoration="underline"
                                    _hover={{ color: 'blue.800' }}
                                >
                                    {extractFileNameFromUrl(impl.path)}:
                                    {impl.line}
                                </Link>
                            </Flex>
                            <Flex gap="2">
                                {implementation.length > 1 &&
                                    implementation.map((impl, idx) => (
                                        <Button
                                            key={idx}
                                            size="xs"
                                            variant={
                                                selectedImpl === idx
                                                    ? 'solid'
                                                    : 'outline'
                                            }
                                            rounded="0"
                                            borderColor="#ACACAC"
                                            bg={
                                                selectedImpl === idx
                                                    ? '#D9D9D9'
                                                    : 'white'
                                            }
                                            onClick={() => setSelectedImpl(idx)}
                                            fontSize="10"
                                        >
                                            {impl.function_name ||
                                                `impl ${idx + 1}`}
                                        </Button>
                                    ))}
                            </Flex>
                        </Flex>
                    </ModalHeader>
                    <ModalCloseButton />
                    <ModalBody p="0">
                        <Box
                            height="calc(100vh - 80px)"
                            overflow="auto"
                            ref={fullscreenCodeRef}
                        >
                            <Box
                                fontFamily="IntelOneMono, monospace"
                                fontSize="14px"
                                lineHeight="1.4"
                                p="20px"
                                bg="white"
                                height="100%"
                                overflow="auto"
                                className="starry-night-code"
                            >
                                {(() => {
                                    const fullCode =
                                        fileContent || 'loading...';
                                    const highlighted =
                                        highlightCodeBlock(fullCode);
                                    if (highlighted) {
                                        const addFullLineNumbers = (
                                            htmlContent: string
                                        ) => {
                                            const lines =
                                                htmlContent.split('\n');
                                            return lines
                                                .map((line, idx) => {
                                                    const currentLineNumber =
                                                        idx + 1;
                                                    const lineNumber =
                                                        currentLineNumber
                                                            .toString()
                                                            .padStart(4, ' ');
                                                    const isTarget =
                                                        impl?.line &&
                                                        currentLineNumber ===
                                                            impl.line;
                                                    const bgColor = isTarget
                                                        ? 'background-color: #e3f2fd;'
                                                        : '';
                                                    const lineNumColor =
                                                        isTarget
                                                            ? 'color: #1976d2; font-weight: bold;'
                                                            : 'color: #999;';
                                                    const lineId = isTarget
                                                        ? `id="fullscreen-target-line-${impl.line}"`
                                                        : '';
                                                    return `<div ${lineId} style="display: flex; ${bgColor}"><span style="${lineNumColor} padding-right: 15px; user-select: none; white-space: pre;">${lineNumber}</span><span style="white-space: pre; word-break: break-all;">${line}</span></div>`;
                                                })
                                                .join('');
                                        };
                                        return (
                                            <div
                                                dangerouslySetInnerHTML={{
                                                    __html: addFullLineNumbers(
                                                        highlighted
                                                    ),
                                                }}
                                            />
                                        );
                                    } else {
                                        return fullCode
                                            .split('\n')
                                            .map((line, idx) => {
                                                const currentLineNumber =
                                                    idx + 1;
                                                const isTarget =
                                                    impl?.line &&
                                                    currentLineNumber ===
                                                        impl.line;
                                                return (
                                                    <div
                                                        key={idx}
                                                        id={
                                                            isTarget
                                                                ? `fullscreen-target-line-${impl.line}`
                                                                : undefined
                                                        }
                                                        style={{
                                                            display: 'flex',
                                                            backgroundColor:
                                                                isTarget
                                                                    ? '#e3f2fd'
                                                                    : 'transparent',
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                color: isTarget
                                                                    ? '#1976d2'
                                                                    : '#999',
                                                                fontWeight:
                                                                    isTarget
                                                                        ? 'bold'
                                                                        : 'normal',
                                                                paddingRight:
                                                                    '15px',
                                                                userSelect:
                                                                    'none',
                                                                whiteSpace:
                                                                    'pre',
                                                            }}
                                                        >
                                                            {currentLineNumber
                                                                .toString()
                                                                .padStart(
                                                                    4,
                                                                    ' '
                                                                )}
                                                        </span>
                                                        <span
                                                            style={{
                                                                wordBreak:
                                                                    'break-all',
                                                                whiteSpace:
                                                                    'pre',
                                                            }}
                                                        >
                                                            {line}
                                                        </span>
                                                    </div>
                                                );
                                            });
                                    }
                                })()}
                            </Box>
                        </Box>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
};

const highlightCodeAroundLine = (
    content: string,
    targetLine: number
): string => {
    if (!content) return 'loading...';

    const lines = content.split('\n');
    const contextLines = 15; // show 15 lines before and after
    const startLine = Math.max(0, targetLine - contextLines - 1);
    const endLine = Math.min(lines.length, targetLine + contextLines);

    const relevantLines = lines.slice(startLine, endLine);

    return relevantLines
        .map((line, idx) => {
            const lineNumber = startLine + idx + 1;
            const isTarget = lineNumber === targetLine;
            const prefix = isTarget ? '>>> ' : '    ';
            return `${lineNumber.toString().padStart(4, ' ')}:${prefix}${line}`;
        })
        .join('\n');
};

const parseMarkdown = (text: string): string => {
    if (!text) return '';
    let parsed = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    parsed = parsed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    parsed = parsed.replace(/\_([^_]+)\_/g, '<em>$1</em>');
    parsed = parsed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return parsed;
};

const parseOpcodeStackDiff = (text: string): [number, number] | null => {
    try {
        // parse stack description items count before and after
        // "x - x x" -> [1, 2]
        // "x -" -> [1, 0]
        // "c c' - c''" -> [2, 1]
        // and so on

        if (text.length === 0) return null;
        if (text === '-') return null;
        if (text.includes('or') && !text.includes('xor')) return null;
        if (text.includes('...')) return null;

        if (text.startsWith('- ')) {
            const afterPart = text.substring(2);
            return [0, countStackItems(afterPart)];
        }

        if (text.endsWith(' -')) {
            const beforePart = text.substring(0, text.length - 2);
            return [countStackItems(beforePart), 0];
        }

        const parts = text.split(' - ');
        if (parts.length !== 2) return null;

        return [countStackItems(parts[0]), countStackItems(parts[1])];
    } catch {
        return null;
    }
};

const countStackItems = (stackPart: string): number => {
    if (!stackPart.trim()) return 0;

    // replace "a mod b" or "a xor b" with one token, to count them as one element
    const normalized = stackPart
        .replace(/\w+\s+mod\s+\w+/g, 'X')
        .replace(/\w+\s+xor\s+\w+/g, 'X');

    // split string by spaces and count tokens
    const tokens = normalized.trim().split(' ');
    return tokens.length;
};

function outActionElement(action: OutAction, i: number) {
    const json = JSON.stringify(
        action,
        (_, v) => {
            if (typeof v === 'bigint') return v.toString();
            if (v instanceof Address) return v.toString();
            if (v instanceof Cell) return v.toBoc().toString('base64');
            return v;
        },
        2
    );
    const unquotedJson = json
        .replace(/"([a-zA-Z0-9_]+)":/g, '$1:') // Remove quotes from keys
        .replace(/"(\d+)"/g, '$1') // Remove quotes from numbers
        .replace(/"\[(.*?)\]"/g, '[$1]') // Remove quotes from arrays
        .replace(/"([^"]+?)":/g, '$1:') // Remove quotes from string values
        .replace(/: "([^"]+)"/g, ': $1'); // Remove quotes from values

    // const text = customStringify(json);
    if (action.type === 'sendMsg') {
        const msgCell = beginCell()
            .store(storeMessageRelaxed(action.outMsg))
            .asCell();
        return (
            <Card
                width="100%"
                m="1rem"
                rounded="0"
                border="1px solid"
                borderColor="#788892"
                bg="#D8F1FF"
                shadow="none"
            >
                <CardHeader
                    fontFamily="IntelOneMono Bold"
                    alignSelf="center"
                    fontSize="20"
                    mb="-1rem"
                >
                    {i + 1}. Send Message
                </CardHeader>
                <CardBody fontSize="10" whiteSpace="pre-wrap">
                    {unquotedJson}
                </CardBody>
                <CardFooter>
                    <Flex direction="column" width="100%" gap="0.5rem">
                        <CopyButton
                            text={'Copy message cell'}
                            copyContent={msgCell.toBoc().toString('base64')}
                            bg="#B5E4FF"
                        />
                        <CopyButton
                            text={'Copy message body'}
                            copyContent={
                                action.outMsg.body?.toString('base64') || ''
                            }
                            bg="#B5E4FF"
                        />
                        <CopyButton
                            text={'Copy action as json'}
                            copyContent={json}
                            bg="#B5E4FF"
                        />
                    </Flex>
                </CardFooter>
            </Card>
        );
    } else if (action.type === 'setCode') {
        return (
            <Card
                width="27rem"
                m="1rem"
                rounded="0"
                border="1px solid"
                borderColor="#A89871"
                bg="#FFEAB6"
                shadow="none"
            >
                <CardHeader
                    fontFamily="IntelOneMono Bold"
                    alignSelf="center"
                    fontSize="20"
                    mb="-1rem"
                >
                    {i + 1}. Set Code
                </CardHeader>
                <CardBody fontSize="10" whiteSpace="pre-wrap">
                    {unquotedJson}
                </CardBody>
                <CardFooter>
                    <Flex direction="column" width="100%" gap="0.5rem">
                        <CopyButton
                            text={'Copy new code cell'}
                            copyContent={action.newCode
                                .toBoc()
                                .toString('base64')}
                            bg="#FFD392"
                        />
                        <CopyButton
                            text={'Copy action as json'}
                            copyContent={json}
                            bg="#FFD392"
                        />
                    </Flex>
                </CardFooter>
            </Card>
        );
    } else if (action.type === 'reserve') {
        return (
            <Card
                width="27rem"
                m="1rem"
                rounded="0"
                border="1px solid"
                borderColor="#8100AE"
                bg="#F6DBFF"
                shadow="none"
            >
                <CardHeader
                    fontFamily="IntelOneMono Bold"
                    alignSelf="center"
                    fontSize="20"
                    mb="-1rem"
                >
                    {i + 1}. Raw Reserve
                </CardHeader>
                <CardBody fontSize="10" whiteSpace="pre-wrap">
                    {unquotedJson}
                </CardBody>
                <CardFooter>
                    <Flex direction="column" width="100%" gap="0.5rem">
                        <CopyButton
                            text={'Copy coins'}
                            copyContent={action.currency.coins.toString()}
                            bg="#EBB6FE"
                        />
                        <CopyButton
                            text={'Copy action as json'}
                            copyContent={json}
                            bg="#EBB6FE"
                        />
                    </Flex>
                </CardFooter>
            </Card>
        );
    } else if (action.type == 'changeLibrary') {
        return (
            <Card
                width="27rem"
                m="1rem"
                rounded="0"
                border="1px solid"
                borderColor="#039F01"
                bg="#DCFFDB"
                shadow="none"
            >
                <CardHeader
                    fontFamily="IntelOneMono Bold"
                    alignSelf="center"
                    fontSize="20"
                    mb="-1rem"
                >
                    {i + 1}. Change Library
                </CardHeader>
                <CardBody fontSize="10" whiteSpace="pre-wrap">
                    {unquotedJson}
                </CardBody>
                <CardFooter>
                    <Flex direction="column" width="100%" gap="0.5rem">
                        {action.libRef.type == 'hash' ? (
                            <CopyButton
                                text={'Copy lib hash'}
                                copyContent={action.libRef.libHash.toString(
                                    'base64'
                                )}
                                bg="#A4F7A3"
                            />
                        ) : (
                            <CopyButton
                                text={'Copy lib cell'}
                                copyContent={action.libRef.library
                                    .toBoc()
                                    .toString('base64')}
                                bg="#A4F7A3"
                            />
                        )}
                        <CopyButton
                            text={'Copy action as json'}
                            copyContent={json}
                            bg="#A4F7A3"
                        />
                    </Flex>
                </CardFooter>
            </Card>
        );
    }
    return <> </>;
}

function CopyButton({
    text,
    copyContent,
    bg,
}: {
    text: string;
    copyContent: string;
    bg: string;
}) {
    return (
        <Button
            width="100%"
            rounded="0"
            colorScheme="gray"
            border="1px solid"
            borderColor="#A3A3A3"
            bg={bg}
            fontSize="12"
            onClick={() => navigator.clipboard.writeText(copyContent)}
        >
            {text}
        </Button>
    );
}

function stackItemElement(
    item: StackElement,
    i: number,
    handleCopy: (text: string) => void,
    isHighlighted: boolean = false,
    isStackBefore: boolean = false
) {
    if (Array.isArray(item)) {
        return (
            <>
                <Tr p="0">
                    <Td p="0">
                        <Box
                            key={i}
                            p="0.5rem"
                            px="0.85rem"
                            backgroundColor={
                                i % 2 === 0 ? 'gray.100' : '#D9D9D9'
                            }
                        >
                            <Text>{i}. Tuple</Text>
                            <Flex mt="0.5rem">
                                <Divider orientation="vertical" />
                                <TableContainer>
                                    <Table size="sm" variant="unstyled">
                                        <Tbody>
                                            {item.map((subItem, j) =>
                                                stackItemElement(
                                                    subItem,
                                                    j,
                                                    handleCopy,
                                                    isHighlighted,
                                                    isStackBefore
                                                )
                                            )}
                                        </Tbody>
                                    </Table>
                                </TableContainer>
                            </Flex>
                        </Box>
                    </Td>
                </Tr>
            </>
        );
    }
    let strRes: string;
    let copyContent = '';
    if (item instanceof Cell) {
        strRes = item.bits.toString();
        if (strRes.length > 14)
            strRes = strRes.slice(0, 7) + '...' + strRes.slice(-7);
        strRes =
            `Cell {${strRes}}` +
            (item.refs.length > 0 ? ` + ${item.refs.length} refs` : '');
        copyContent = item.toBoc().toString('hex');
    }
    //
    else if (item instanceof Slice) {
        const itemCell = item.asCell();
        item = itemCell.asSlice();
        strRes = item.loadBits(item.remainingBits).toString();
        if (strRes.length > 14)
            strRes = strRes.slice(0, 7) + '...' + strRes.slice(-7);
        strRes =
            `Slice {${strRes}}` +
            (item.remainingRefs > 0 ? ` + ${item.remainingRefs} refs` : '');
        copyContent = itemCell.toBoc().toString('hex');
    }
    //
    else if (item instanceof Builder) {
        strRes = item.asCell().bits.toString();
        if (strRes.length > 14)
            strRes = strRes.slice(0, 7) + '...' + strRes.slice(-7);
        strRes =
            `Builder {${strRes}}` +
            (item.refs > 0 ? ` + ${item.refs} refs` : '');
        copyContent = item.asCell().toBoc().toString('hex');
    }
    //
    else if (item == null) {
        strRes = 'null';
        copyContent = 'null';
    }
    //
    else if (typeof item === 'string') {
        strRes = item;
        if (strRes.length > 30)
            strRes = strRes.slice(0, 26) + '...' + strRes.slice(-4);
        copyContent = item;
    }
    //
    else {
        strRes = item.toString();
        if (strRes.length > 30)
            strRes = strRes.slice(0, 15) + '...' + strRes.slice(-15);
        copyContent = item.toString();
    }

    const highlightColor = isHighlighted
        ? isStackBefore
            ? '#ECBC92'
            : '#68C8FF'
        : undefined;

    return (
        <Tr key={i} p="0">
            <Td p="0">
                <Flex backgroundColor={i % 2 === 0 ? 'gray.100' : '#D9D9D9'}>
                    <Box backgroundColor={highlightColor} w="5px" />
                    <Link p="0.5rem" onClick={() => handleCopy(copyContent)}>
                        {i}. {strRes}
                    </Link>
                </Flex>
            </Td>
        </Tr>
    );
}

function shortStep(step: string) {
    if (step.length > 24) return step.slice(0, 19) + '...' + step.slice(-5);
    return step;
}

function TxLink({ explorer, link }: { explorer: string; link: string }) {
    return (
        <Flex>
            <Spacer />
            <Link
                href={link}
                fontSize="12"
                color="blue.400"
                textAlign="right"
                isExternal
                _hover={{ textDecoration: 'none' }}
                textDecoration="underline"
            >
                {explorer}
            </Link>
        </Flex>
    );
}

export default function AppWithProviders() {
    return (
        <ApiKeyProvider>
            <App />
        </ApiKeyProvider>
    );
}
