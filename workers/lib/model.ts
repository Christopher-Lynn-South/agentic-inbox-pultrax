// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Chat model selection for the email agent.
 *
 * By default the agent runs on Cloudflare Workers AI. When an Ollama Cloud
 * API key is configured, the agent instead talks to an Ollama Cloud model
 * (e.g. `glm-5.2:cloud`) through Ollama's OpenAI-compatible API. This lets
 * the inbox be driven by a hosted GLM model without changing any tool code.
 */

import { createWorkersAI } from "workers-ai-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { Env } from "../types";

/** Workers AI model used when no Ollama Cloud key is configured. */
const DEFAULT_WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.5";

/** Ollama Cloud defaults. The model can be overridden via OLLAMA_MODEL. */
const DEFAULT_OLLAMA_MODEL = "glm-5.2:cloud";
const DEFAULT_OLLAMA_BASE_URL = "https://ollama.com/v1";

/**
 * Resolve the language model the agent should use for chat and auto-drafting.
 *
 * Falls back to Workers AI when OLLAMA_API_KEY is not set so the app keeps
 * working out of the box on a vanilla Cloudflare deploy.
 */
export function getChatModel(env: Env): LanguageModel {
	if (env.OLLAMA_API_KEY) {
		const ollama = createOpenAICompatible({
			name: "ollama",
			baseURL: env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
			apiKey: env.OLLAMA_API_KEY,
		});
		return ollama(env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL);
	}

	const workersai = createWorkersAI({ binding: env.AI });
	return workersai(DEFAULT_WORKERS_AI_MODEL);
}
