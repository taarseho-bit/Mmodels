/**
 * 「中文即键」英文覆盖词典 —— 按域分片，避免多人/多代理改同一文件。
 *
 * 收录范围：本项目新增、项目契约词典（zh.ts/en.ts）里没有条目的界面文案。
 * 当前有的文案一律用 tx('项目契约键')，不进这里。
 */
import { settingsOv } from './settings';
import { extensionsOv } from './extensions';
import { coreOv } from './core';

export const enOverrides: Record<string, string> = {
  ...settingsOv,
  ...extensionsOv,
  ...coreOv,
};
