import { createContext, useContext } from 'react';
import type { PracticeProvider } from './types';
import { serverProvider } from './serverProvider';

/** 預設 localhost 模式;網頁版(GitHub Pages)由 StaticApp 覆蓋成 staticProvider */
export const PracticeCtx = createContext<PracticeProvider>(serverProvider);

export function usePractice(): PracticeProvider {
  return useContext(PracticeCtx);
}
