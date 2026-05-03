/**
 * Cloudflare Workers AI Configuration Guide
 * 
 * Follow these steps to enable Cloudflare Workers AI support in nostr-paper.
 */

// ════════════════════════════════════════════════════════════════
// 1. GET CLOUDFLARE CREDENTIALS
// ════════════════════════════════════════════════════════════════

/*
Step 1: Sign up or log into Cloudflare
  - Visit https://dash.cloudflare.com
  - Create account if needed

Step 2: Create Workers AI API Token
  - Go to Account Settings → API Tokens
  - Click "Create Token"
  - Select "Custom token"
  - Permissions needed:
    * Account → AI → Read
  - Copy the token

Step 3: Get Account ID
  - In Cloudflare Dashboard, look for "Account ID"
  - Usually visible in the right sidebar
  - Or find in API documentation
*/

// ════════════════════════════════════════════════════════════════
// 2. CONFIGURE ENVIRONMENT VARIABLES
// ════════════════════════════════════════════════════════════════

/*
Create or update .env.local file in project root:

# Cloudflare Workers AI Configuration
VITE_CLOUDFLARE_ACCOUNT_ID=your_account_id_here
VITE_CLOUDFLARE_API_TOKEN=your_api_token_here

# Keep existing configuration
VITE_GEMINI_API_KEY=...
VITE_RELAY_URL=...
# etc.
*/

// ════════════════════════════════════════════════════════════════
// 3. VERIFY CONFIGURATION
// ════════════════════════════════════════════════════════════════

/*
In browser console, test configuration:

import { isCloudflareAiAvailable } from '@/lib/ai/cloudflareAiProviders'

// Should return true if credentials are valid
console.log('Cloudflare AI Available:', isCloudflareAiAvailable())

// Check which features are using Cloudflare
import { routeAiTask } from '@/lib/ai/taskRouting'
const decision = routeAiTask('compose_assist_quality')
console.log('Compose routing decision:', decision)
*/

// ════════════════════════════════════════════════════════════════
// 4. AVAILABLE MODELS
// ════════════════════════════════════════════════════════════════

/*
The following models are available through Cloudflare Workers AI:

TEXT GENERATION:
  ├─ llama-3.1-70b-instruct (70B parameters)
  │  └─ Used for: Compose assistance, profile insights, article summaries
  │
  └─ llama-3.1-8b-instruct (8B parameters)
     └─ Used for: Fast classification, caution detection, search intent

CONTENT SAFETY:
  └─ llama-guard-3-8b
     └─ Used for: Content moderation and safety classification

TRANSLATION:
  └─ m2m100-1.2b (Many-to-Many)
     └─ Used for: 100+ language pairs

EMBEDDINGS:
  └─ embeddinggemma-300m
     └─ Used for: Semantic search and similarity computation

RERANKING:
  └─ bge-reranker-base
     └─ Used for: Search result ranking and relevance scoring
*/

// ════════════════════════════════════════════════════════════════
// 5. FEATURE MATRIX
// ════════════════════════════════════════════════════════════════

/*
Feature               | Status | Model(s) | Fallback
─────────────────────┼────────┼──────────┼─────────────────
Compose Improvement  | Active | 70B      | Gemma → Gemini
Caution Detection    | Active | 8B       | Gemma
Profile Insights     | Active | 70B      | Fallback template
Article Summary      | Active | 70B      | Gemma
Content Moderation   | Active | Guard 3  | ONNX models
Translation          | Active | M2M100   | No-op fallback
Search Embeddings    | Ready  | Gemma    | Browser embeddings
Result Reranking     | Ready  | BGE      | Untouched results
*/

// ════════════════════════════════════════════════════════════════
// 6. PRICING
// ════════════════════════════════════════════════════════════════

/*
Cloudflare Workers AI Pricing (as of 2024):

Free Tier:
  - 10,000 requests per day across all models
  - Great for development and testing
  - No credit card required

Paid Plans:
  - Pay-as-you-go: $0.10 per 1M tokens (approximate)
  - Billed on token usage, not requests
  - See https://developers.cloudflare.com/workers-ai/pricing

Cost Comparison:
  - Compose 512 tokens: ~$0.000051
  - Profile insights 256 tokens: ~$0.000026
  - Safety check 128 tokens: ~$0.000013
  - Translate 256 tokens: ~$0.000026
  - Embedding 1K documents × 100 tokens: ~$0.0001

Local Browser Models (Your Device):
  - Compute cost: Your device's battery
  - API cost: $0
  - Latency: Higher (depends on device)
  - Quality: Lower (smaller models)

Gemini API Fallback:
  - ~$2.50 per 1M input tokens
  - More expensive but high quality
  - Used as fallback only
*/

// ════════════════════════════════════════════════════════════════
// 7. ROUTING BEHAVIOR
// ════════════════════════════════════════════════════════════════

/*
Device Type Detection:
┌────────────────────────────────────────────────────────┐
│ Device Memory | Route Decision | Primary Model         │
├────────────────────────────────────────────────────────┤
│ ≤ 2GB         | Cloudflare     | Fast (8B) or Primary │
│ 2-8GB         | Local/Browser  | Gemma (WebGPU)       │
│ > 8GB         | Local/Browser  | Gemma (preferred)    │
│ Unknown       | Cloudflare     | Depends on network   │
└────────────────────────────────────────────────────────┘

Network Detection:
┌────────────────────────────────────────────────────────┐
│ Connection  | Route Decision | Preferred Model       │
├────────────────────────────────────────────────────────┤
│ 5G / WiFi   | Cloudflare     | Primary (70B)         │
│ 4G / LTE    | Cloudflare     | Fast (8B)             │
│ 3G / 2G     | Local          | Browser only          │
│ Offline     | Local/Fallback | Rule-based heuristics │
└────────────────────────────────────────────────────────┘
*/

// ════════════════════════════════════════════════════════════════
// 8. MONITORING & DEBUGGING
// ════════════════════════════════════════════════════════════════

/*
Enable detailed logging:

// In src/lib/ai/cloudflareAiProviders.ts, add:
const DEBUG = true // Set to false for production

async function callCloudflareAi(...) {
  if (DEBUG) {
    console.debug('[Cloudflare AI] Calling model:', modelId)
    console.time(`cloudflare-${modelId}`)
  }
  // ... execution ...
  if (DEBUG) {
    console.timeEnd(`cloudflare-${modelId}`)
  }
}

Check routing decisions:

import { routeAiTask } from '@/lib/ai/taskRouting'

const decision = routeAiTask('compose_assist_quality')
console.log('Routing decision:', {
  tier: decision.tier,
  rationale: decision.rationale,
  fallback_chain: decision.fallback,
  timeout_ms: decision.timeout_ms
})

This shows why a specific model was chosen and fallback order.
*/

// ════════════════════════════════════════════════════════════════
// 9. TROUBLESHOOTING
// ════════════════════════════════════════════════════════════════

/*
Problem: "Cloudflare AI requires VITE_CLOUDFLARE_ACCOUNT_ID..."
  ✓ Solution: Add credentials to .env.local and restart dev server
  ✓ Verify: Visit https://dash.cloudflare.com to get credentials
  ✓ Test: Call isCloudflareAiAvailable() in console

Problem: 401/403 Unauthorized errors
  ✓ Solution: Check API token has "Workers AI → Read" permission
  ✓ Solution: Verify Account ID matches token's account
  ✓ Solution: Tokens can expire; regenerate in Cloudflare dashboard

Problem: Rate limiting (429 errors)
  ✓ Solution: On free tier, max 10,000 requests/day
  ✓ Solution: Upgrade to paid plan or batch requests
  ✓ Note: Local models serve as automatic rate-limit fallback

Problem: High latency to Cloudflare
  ✓ Solution: Network latency is normal for edge requests
  ✓ Solution: Browser models will be faster for low-latency needs
  ✓ Note: Routing system prefers local models on poor connections

Problem: "Empty response" from Cloudflare
  ✓ Solution: May indicate API format change
  ✓ Solution: Check Cloudflare API docs for model response format
  ✓ Solution: File an issue with response details

Problem: Compose assistance always using fallback
  ✓ Solution: Check if Cloudflare credentials are valid
  ✓ Solution: Check browser console for API errors
  ✓ Solution: Verify device has internet connection
  ✓ Solution: Local Gemma is still working (good fallback)
*/

// ════════════════════════════════════════════════════════════════
// 10. QUICK START CHECKLIST
// ════════════════════════════════════════════════════════════════

/*
□ Create Cloudflare account (or use existing)
□ Generate API token with Workers AI permissions
□ Copy Account ID
□ Add VITE_CLOUDFLARE_ACCOUNT_ID to .env.local
□ Add VITE_CLOUDFLARE_API_TOKEN to .env.local
□ Restart development server (npm run dev)
□ Open browser console and test:
  - import { isCloudflareAiAvailable } from '@/lib/ai/cloudflareAiProviders'
  - isCloudflareAiAvailable() // Should return true
□ Try compose assistance (should show "cloudflare" or similar source)
□ Check network tab - should see API calls to api.cloudflare.com
□ Monitor costs at https://dash.cloudflare.com/billing

You're done! Cloudflare Workers AI is now active.
*/

// ════════════════════════════════════════════════════════════════
// 11. ADVANCED CONFIGURATION
// ════════════════════════════════════════════════════════════════

/*
Custom Retry Logic:
  - Edit cloudflareAiProviders.ts callCloudflareAi() maxAttempts
  - Default: 2 attempts, 300ms base delay
  - Exponential backoff: 300ms → 600ms → 1200ms

Fallback Strategy:
  - Edit taskRouting.ts fallback arrays per task
  - Example: Change compose_quality fallback to prefer Gemini

Model Selection:
  - Change CLOUDFLARE_PRIMARY_LLM_ID for custom 70B model
  - Change CLOUDFLARE_FAST_MODEL_ID for alternative 8B model
  - See https://developers.cloudflare.com/workers-ai/models/

Timeout Adjustment:
  - Edit taskRouting.ts timeout_ms for each task
  - Shorter timeouts = faster fallback to local models
  - Longer timeouts = more reliance on Cloudflare edge
*/

export {}
