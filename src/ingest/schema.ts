import { z } from 'zod';

export const OUTCOMES = ['ok', 'retrieval_failed', 'stream_failed', 'aborted'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const IngestEvent = z
  .object({
    source: z.string().min(1).max(64),
    event: z.literal('ask'),
    ts: z.string().datetime(),
    model: z.string().min(1),
    question: z.string().max(2000),
    outcome: z.enum(OUTCOMES),
    retrievedIds: z.array(z.number().int()).default([]),
    citationCount: z.number().int().min(0),
    retrievalMs: z.number().int().min(0),
    firstTokenMs: z.number().int().nullable(),
    totalMs: z.number().int().min(0),
    errorMessage: z.string().nullable().optional(),
  })
  .passthrough();

export type IngestEvent = z.infer<typeof IngestEvent>;
