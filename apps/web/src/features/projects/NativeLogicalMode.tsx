import { createContext, useContext, type ReactNode } from 'react';

export interface NativeLogicalModeValue {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

const NativeLogicalModeContext = createContext<NativeLogicalModeValue>({
  enabled: false,
  onEnabledChange: () => {},
});

export function NativeLogicalModeProvider({
  enabled,
  onEnabledChange,
  children,
}: NativeLogicalModeValue & { children: ReactNode }) {
  return (
    <NativeLogicalModeContext.Provider value={{ enabled, onEnabledChange }}>
      {children}
    </NativeLogicalModeContext.Provider>
  );
}

/** Display preference only: never deletes or rewrites logical design data. */
export function useNativeLogicalMode() {
  return useContext(NativeLogicalModeContext);
}
