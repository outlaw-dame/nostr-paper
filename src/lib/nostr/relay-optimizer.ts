/**
 * Relay Optimizer: Integrates Thompson Sampling + Latency Prediction
 * ===================================================================
 * 
 * Orchestrates relay selection strategy:
 * 1. Thompson Sampling bandit learns best relays over time
 * 2. Latency prediction forecasts performance for proactive routing
 * 3. Exposes optimized relay lists for queries
 * 
 * Reference: ML_RELAY_OPTIMIZATION.md Phase 1
 */

import { RelayBandit, RelayPerformanceAnalyzer } from './relay-bandit'
import { RelayLatencyPredictor } from './relay-latency-predictor'

/**
 * Main orchestrator for relay optimization
 */
export class RelayOptimizer {
  private bandit: RelayBandit
  private predictor: RelayLatencyPredictor
  private analyzer: RelayPerformanceAnalyzer
  private relays: string[]

  constructor(relayUrls: string[]) {
    this.relays = relayUrls
    this.analyzer = new RelayPerformanceAnalyzer()
    this.bandit = new RelayBandit(relayUrls, this.analyzer)
    this.predictor = new RelayLatencyPredictor()
  }

  /**
   * Select single best relay for query
   */
  selectRelay(): string {
    return this.bandit.selectRelay()
  }

  /**
   * Select top N relays for parallel queries
   */
  selectRelays(count: number = 3): string[] {
    // Clamp to available relays
    const n = Math.min(count, this.relays.length)
    return this.bandit.selectTopRelays(n)
  }

  /**
   * Select relays sorted by predicted latency (best first)
   */
  selectRelaysByLatency(count: number = 3): string[] {
    const ranked = this.predictor.rankRelaysByLatency(this.relays)
    return ranked.slice(0, count).map(r => r.relay).filter((r): r is string => r !== undefined)
  }

  /**
   * Record outcome of relay query
   */
  recordOutcome(relay: string, options: {
    success: boolean
    latency: number
    hitRate?: number
  }) {
    const { success, latency, hitRate = 1.0 } = options

    // Update bandit
    this.bandit.recordOutcome(relay, success, latency, hitRate)

    // Update predictor
    if (latency > 0) {
      this.predictor.addMeasurement(relay, latency)
    }
  }

  /**
   * 4-relay parallel strategy (recommended for thread queries)
   */
  recommendedParallelRelays(): string[] {
    // Use bandit + latency prediction for best coverage
    const banditRelays = this.bandit.selectTopRelays(3)
    const latencyRelays = this.predictor.rankRelaysByLatency(
      this.relays.filter(r => !banditRelays.includes(r))
    )

    // Combine: 3 high-confidence (bandit) + 1 diverse (latency-best)
    return [
      ...banditRelays,
      ...(latencyRelays[0]?.relay ? [latencyRelays[0].relay] : this.relays.slice(0, 1))
    ].slice(0, 4)
  }

  /**
   * Get performance dashboard data
   */
  getPerformanceSummary() {
    return {
      bandit: this.bandit.getStats(),
      predictions: this.predictor.getAllStats(),
      latencyRanking: this.predictor.rankRelaysByLatency(this.relays),
      memoryUsage: {
        predictorBytes: this.predictor.getMemoryUsage()
      }
    }
  }

  reset() {
    this.bandit.reset()
    this.analyzer = new RelayPerformanceAnalyzer()
    this.bandit = new RelayBandit(this.relays, this.analyzer)
    this.predictor = new RelayLatencyPredictor()
  }
}

// Global optimizer instance
let globalOptimizer: RelayOptimizer | null = null

/**
 * Initialize global relay optimizer
 */
export function initRelayOptimizer(relayUrls: string[]): RelayOptimizer {
  globalOptimizer = new RelayOptimizer(relayUrls)
  return globalOptimizer
}

/**
 * Get global relay optimizer instance
 */
export function getRelayOptimizer(): RelayOptimizer | null {
  return globalOptimizer
}
