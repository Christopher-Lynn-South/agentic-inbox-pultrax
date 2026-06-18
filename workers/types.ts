// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	// Ollama Cloud (optional). When this secret is set, the email agent runs
	// on an Ollama Cloud model (e.g. `glm-5.2:cloud`) via Ollama's
	// OpenAI-compatible API instead of Cloudflare Workers AI. OLLAMA_MODEL and
	// OLLAMA_BASE_URL are declared as vars in wrangler.jsonc (generated into
	// Cloudflare.Env), so they are not redeclared here.
	OLLAMA_API_KEY?: string;
}
