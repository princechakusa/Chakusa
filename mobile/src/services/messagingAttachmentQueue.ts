import { File, Paths } from 'expo-file-system';
import { messagingApi } from './endpoints';

export type QueuedAttachment = { id: string; fileName: string; mimeType: string; dataBase64: string; status: 'PENDING' | 'UPLOADING' | 'FAILED' | 'QUEUED_FOR_SCAN'; progress: number; error?: string; createdAt: string };
const queueFile = new File(Paths.document, 'messaging-attachment-queue.json');

async function readQueue(): Promise<QueuedAttachment[]> { if (!queueFile.exists) return []; try { const value = await queueFile.text(); return JSON.parse(value) as QueuedAttachment[]; } catch { return []; } }
function writeQueue(items: QueuedAttachment[]) { if (!queueFile.exists) queueFile.create({ intermediates: true }); queueFile.write(JSON.stringify(items)); }
export async function queuedAttachments() { return readQueue(); }
export async function enqueueAttachment(input: Omit<QueuedAttachment, 'id' | 'status' | 'progress' | 'createdAt'>) { const item: QueuedAttachment = { ...input, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'PENDING', progress: 0, createdAt: new Date().toISOString() }; const items = await readQueue(); writeQueue([...items, item]); return item; }
export async function flushAttachmentQueue(onChange?: (items: QueuedAttachment[]) => void) { let items = await readQueue(); for (const item of items.filter(row => row.status === 'PENDING' || row.status === 'FAILED')) { items = items.map(row => row.id === item.id ? { ...row, status: 'UPLOADING', progress: 25, error: undefined } : row); writeQueue(items); onChange?.(items); try { await messagingApi.uploadAttachment(item); items = items.map(row => row.id === item.id ? { ...row, status: 'QUEUED_FOR_SCAN', progress: 100 } : row); } catch (caught) { items = items.map(row => row.id === item.id ? { ...row, status: 'FAILED', progress: 0, error: caught instanceof Error ? caught.message : 'Upload failed' } : row); } writeQueue(items); onChange?.(items); } return items; }
export async function removeQueuedAttachment(id: string) { const items = (await readQueue()).filter(item => item.id !== id); writeQueue(items); return items; }
