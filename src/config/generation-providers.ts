import {
  COMFYUI_PROVIDER_ID,
  comfyUiGenerationProvider,
} from '@/core/generation-providers/comfyui-provider';
import type { GenerationProviderRegistrar } from '@/core/generation-providers/contracts';

/**
 * Source-level extension point for open-source forks.
 *
 * BeatAPI is registered by the core and remains the default. This workspace
 * activates the local ComfyUI provider by default; switch back to BeatAPI by
 * setting BEATDESIGN_GENERATION_PROVIDER=beatapi, or edit
 * ACTIVE_GENERATION_PROVIDER_ID here.
 * Keep credentials inside that provider's server-only implementation.
 */
export const ACTIVE_GENERATION_PROVIDER_ID =
  process.env.BEATDESIGN_GENERATION_PROVIDER?.trim() || COMFYUI_PROVIDER_ID;

export function registerProjectGenerationProviders(
  register: GenerationProviderRegistrar
) {
  register(comfyUiGenerationProvider);
}
