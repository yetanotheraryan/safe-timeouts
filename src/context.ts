import { AsyncLocalStorage } from 'node:async_hooks';
import { TimeoutContext } from './types';

export const timeoutContext =
  new AsyncLocalStorage<TimeoutContext>();