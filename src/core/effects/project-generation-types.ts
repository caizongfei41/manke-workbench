import type { ComfyUiPromptProgress } from '@/core/effects/comfyui-progress';
import type { GenerationStatus } from './record-generation';

// Pure shapes for what a generation record looks like on the client.
//
// These lived in project-generations.ts next to the query builder, which meant any component
// that needed the type also pulled drizzle-orm and the schema into the browser bundle
// (139 KB of ORM reachable from a <div>). Types move; the queries stay server-side.

export type ProjectGenerationItem = {
  id: string;
  status: GenerationStatus;
  prompt: string | null;
  modelId: string | null;
  modelName: string | null;
  mediaType: 'image' | 'video' | 'analysis' | 'audio';
  resultUrl: string | null;
  resultText: string | null;
  paramsLabel: string | null;
  aspectRatio: string | null;
  outputQuality: string | null;
  mode: string | null;
  duration: string | null;
  referenceImages: string[];
  referenceVideos: string[];
  error: string | null;
  createdAt: string;
  /**
   * Live step progress for locally-run jobs, read from ComfyUI's WebSocket.
   *
   * Optional so existing construction sites keep compiling; absent, null and
   * "not started yet" all mean the same to the UI.
   */
  progress?: ComfyUiPromptProgress | null;
};
