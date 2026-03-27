import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { getBridgeContext } from 'claude-to-im/src/lib/bridge/context.js';
import { processMessage } from 'claude-to-im/src/lib/bridge/conversation-engine.js';
import { sendProactiveMessage } from 'claude-to-im/src/lib/bridge/bridge-manager.js';
import type { SchedulerGateway, ScheduledTaskRecord } from 'claude-to-im/src/lib/bridge/host.js';

import { CTI_HOME } from './config.js';

type ScheduledTask = ScheduledTaskRecord;

const DATA_DIR = path.join(CTI_HOME, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readTasks(): ScheduledTask[] {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')) as ScheduledTask[];
  } catch {
    return [];
  }
}

function writeTasks(tasks: ScheduledTask[]): void {
  ensureDataDir();
  const tmp = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8');
  fs.renameSync(tmp, TASKS_FILE);
}

function nextDailyRun(timeHHMM: string, base = new Date()): Date {
  const [h, m] = timeHHMM.split(':').map((v) => parseInt(v, 10));
  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= base.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export class SchedulerService implements SchedulerGateway {
  private tasks: ScheduledTask[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = new Set<string>();

  constructor() {
    this.tasks = readTasks();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  scheduleTaskAt(input: {
    channelType: string;
    chatId: string;
    title: string;
    description: string;
    instruction: string;
    runAt: string;
    timezone?: string;
  }): ScheduledTask {
    const runAtMs = new Date(input.runAt).getTime();
    if (!Number.isFinite(runAtMs) || runAtMs <= Date.now()) {
      throw new Error(`Invalid runAt timestamp: ${input.runAt}`);
    }

    const task: ScheduledTask = {
      id: crypto.randomUUID().slice(0, 8),
      channelType: input.channelType,
      chatId: input.chatId,
      kind: 'agent_once',
      createdAt: nowIso(),
      nextRunAt: new Date(runAtMs).toISOString(),
      payload: {
        title: input.title,
        description: input.description,
        instruction: input.instruction,
        timezone: input.timezone || 'local',
      },
    };
    this.tasks.push(task);
    writeTasks(this.tasks);
    return task;
  }

  scheduleTaskIn(input: {
    channelType: string;
    chatId: string;
    title?: string;
    description?: string;
    instruction: string;
    delayMs: number;
  }): ScheduledTask {
    const title = input.title?.trim() || input.instruction.trim() || 'Scheduled task';
    const description = input.description?.trim() || input.instruction.trim() || 'Scheduled task';
    const task: ScheduledTask = {
      id: crypto.randomUUID().slice(0, 8),
      channelType: input.channelType,
      chatId: input.chatId,
      kind: 'agent_once',
      createdAt: nowIso(),
      nextRunAt: new Date(Date.now() + input.delayMs).toISOString(),
      payload: {
        title,
        description,
        instruction: input.instruction,
      },
    };
    this.tasks.push(task);
    writeTasks(this.tasks);
    return task;
  }

  scheduleTaskDaily(input: {
    channelType: string;
    chatId: string;
    title: string;
    description: string;
    instruction: string;
    timeHHMM: string;
    timezone?: string;
  }): ScheduledTask {
    const task: ScheduledTask = {
      id: crypto.randomUUID().slice(0, 8),
      channelType: input.channelType,
      chatId: input.chatId,
      kind: 'agent_daily',
      createdAt: nowIso(),
      nextRunAt: nextDailyRun(input.timeHHMM).toISOString(),
      payload: {
        title: input.title,
        description: input.description,
        instruction: input.instruction,
        timeHHMM: input.timeHHMM,
        timezone: input.timezone || 'local',
      },
    };
    this.tasks.push(task);
    writeTasks(this.tasks);
    return task;
  }

  listTasks(channelType: string, chatId: string): ScheduledTask[] {
    return this.tasks.filter((task) => task.channelType === channelType && task.chatId === chatId);
  }

  removeTask(id: string, channelType: string, chatId: string): boolean {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => !(task.id === id && task.channelType === channelType && task.chatId === chatId));
    if (this.tasks.length === before) return false;
    writeTasks(this.tasks);
    return true;
  }

  private async tick(): Promise<void> {
    const due = this.tasks.filter((task) => new Date(task.nextRunAt).getTime() <= Date.now());
    if (due.length === 0) return;

    for (const task of due) {
      if (this.inFlight.has(task.id)) continue;
      this.inFlight.add(task.id);
      try {
        await this.runTask(task);
      } catch (err) {
        console.error('[scheduler] Task failed:', task.id, err instanceof Error ? err.message : err);
      } finally {
        this.inFlight.delete(task.id);
      }
      this.advanceTask(task);
    }
    writeTasks(this.tasks);
  }

  private advanceTask(task: ScheduledTask): void {
    if (task.kind === 'agent_once') {
      this.tasks = this.tasks.filter((entry) => entry.id !== task.id);
      return;
    }
    if (task.kind === 'agent_daily') {
      const timeHHMM = String(task.payload.timeHHMM || '09:30');
      task.nextRunAt = nextDailyRun(timeHHMM).toISOString();
    }
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    const { store } = getBridgeContext();
    const binding = store.getChannelBinding(task.channelType, task.chatId);
    const instruction = String(task.payload.instruction || '').trim();

    if (!binding) {
      throw new Error(`No binding found for ${task.channelType}:${task.chatId}`);
    }
    if (!instruction) {
      throw new Error(`Empty instruction for task ${task.id}`);
    }

    const result = await processMessage(binding, instruction);
    const responseText = result.hasError
      ? `Scheduled task failed.\n\nInstruction:\n${instruction}\n\nError:\n${result.errorMessage || 'Unknown error'}`
      : (result.responseText.trim() || 'Scheduled task completed with no text output.');

    const sendResult = await sendProactiveMessage({
      channelType: task.channelType,
      chatId: task.chatId,
      userId: task.chatId,
    }, responseText, 'plain');

    if (!sendResult.ok) {
      throw new Error(sendResult.error || 'proactive send failed');
    }
  }
}
