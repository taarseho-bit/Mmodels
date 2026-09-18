import type { MathModelApi } from '../preload/index';

declare global {
  interface Window {
    mathmodel: MathModelApi;
  }
}

export {};
