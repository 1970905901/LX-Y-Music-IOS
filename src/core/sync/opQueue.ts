import { saveData, getData } from '@/plugins/storage';
import { storageDataPrefix } from '@/config/constant';

export type ListOperation = LX.Sync.List.ActionList;

let operationQueue: ListOperation[] = [];
const STORAGE_KEY = storageDataPrefix.sync + 'op_queue_v2';

/**
 * Load local unsynced operation queue
 */
export async function loadOperationQueue(): Promise<void> {
  const storedQueue = await getData<ListOperation[]>(STORAGE_KEY);
  operationQueue = storedQueue || [];
  console.log('[Sync OpQueue] Loaded operations:', operationQueue.length);
}

/**
 * Log a new operation to the queue
 * @param operation the operation object
 */
export async function logOperation(operation: ListOperation): Promise<void> {
  operationQueue.push(operation);
  await saveData(STORAGE_KEY, operationQueue);
}

/**
 * Get all current operation queue
 */
export function getOperationQueue(): ListOperation[] {
  return [...operationQueue];
}

/**
 * Clear operation queue
 */
export async function clearOperationQueue(): Promise<void> {
  operationQueue = [];
  await saveData(STORAGE_KEY, []);
}
