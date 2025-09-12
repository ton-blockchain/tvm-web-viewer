import React from 'react';
import {
    Modal,
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalCloseButton,
    Button,
    Input,
    Text,
    VStack,
    Link,
    FormControl,
    FormLabel,
} from '@chakra-ui/react';
import { useApiKeys } from '../contexts/ApiKeyContext';

interface ToncenterKeysModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ToncenterKeysModal: React.FC<ToncenterKeysModalProps> = ({
    isOpen,
    onClose,
}) => {
    const { apiKeys, setApiKeys } = useApiKeys();
    const [tempKeys, setTempKeys] = React.useState(apiKeys);

    const handleSave = () => {
        setApiKeys(tempKeys);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalOverlay />
            <ModalContent rounded="0">
                <ModalHeader fontFamily="IntelOneMono Bold">
                    Settings
                </ModalHeader>
                <ModalCloseButton />
                <ModalBody pb={6}>
                    <VStack spacing={4} align="stretch">
                        <Text fontSize="sm">
                            Enter Toncenter API keys. Get them{' '}
                            <Link
                                href="https://t.me/toncenter"
                                isExternal
                                color="blue.500"
                            >
                                here
                            </Link>
                        </Text>

                        <FormControl>
                            <FormLabel fontSize="sm">Mainnet API Key</FormLabel>
                            <Input
                                value={tempKeys.mainnet}
                                onChange={(e) =>
                                    setTempKeys({
                                        ...tempKeys,
                                        mainnet: e.target.value,
                                    })
                                }
                                placeholder="Enter mainnet API key"
                                size="sm"
                                rounded="0"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel fontSize="sm">Testnet API Key</FormLabel>
                            <Input
                                value={tempKeys.testnet}
                                onChange={(e) =>
                                    setTempKeys({
                                        ...tempKeys,
                                        testnet: e.target.value,
                                    })
                                }
                                placeholder="Enter testnet API key"
                                size="sm"
                                rounded="0"
                            />
                        </FormControl>

                        <Button
                            onClick={handleSave}
                            colorScheme="blue"
                            size="sm"
                            rounded="0"
                        >
                            Save
                        </Button>
                    </VStack>
                </ModalBody>
            </ModalContent>
        </Modal>
    );
};
