import React, { createContext, useContext, useState } from 'react';

interface ApiKeys {
  mainnet: string;
  testnet: string;
}

interface ApiKeyContextType {
  apiKeys: ApiKeys;
  setApiKeys: (keys: Partial<ApiKeys>) => void;
}

const ApiKeyContext = createContext<ApiKeyContextType>({
  apiKeys: { mainnet: '', testnet: '' },
  setApiKeys: () => {},
});

// helper to get keys from cookies
const getStoredApiKeys = (): ApiKeys => {
  const getKey = (name: string) => {
    const match = document.cookie.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]+)`));
    return match ? decodeURIComponent(match[1]) : '';
  };

  return {
    mainnet: getKey('toncenter_mainnet_key'),
    testnet: getKey('toncenter_testnet_key'),
  };
};

export const ApiKeyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiKeys, setApiKeysState] = useState<ApiKeys>(getStoredApiKeys());

  const setApiKeys = (newKeys: Partial<ApiKeys>) => {
    const updatedKeys = { ...apiKeys, ...newKeys };
    
    // save to cookies
    if (newKeys.mainnet !== undefined) {
      document.cookie = `toncenter_mainnet_key=${encodeURIComponent(newKeys.mainnet)}; max-age=34560000; path=/`;
    }
    if (newKeys.testnet !== undefined) {
      document.cookie = `toncenter_testnet_key=${encodeURIComponent(newKeys.testnet)}; max-age=34560000; path=/`;
    }
    
    setApiKeysState(updatedKeys);
  };

  return (
    <ApiKeyContext.Provider value={{ apiKeys, setApiKeys }}>
      {children}
    </ApiKeyContext.Provider>
  );
};

export const useApiKeys = () => useContext(ApiKeyContext);
