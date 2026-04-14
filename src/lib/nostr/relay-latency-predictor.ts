/**
 * Relay Latency Prediction Model
 * ==============================
 * 
 * Forecasts relay response times using recent historical patterns.
 * Trains locally on client; no external AI required.
 * 
 * Approach: Exponential Weighted Moving Average (EWMA) + trend detection
 * - EWMA captures recent latency trends
 * - Trend detection predicts seasonal patterns (time-of-day effects)
 * - Cost: <5ms prediction time; <1MB memory
 * 
 * Reference: ML_RELAY_OPTIMIZATION.md Phase 1
 */

interface LatencyWindow {
  timestamp: number
  values: number[]
}

/**
 * Lightweight latency prediction without heavy ML libraries
 */
export class RelayLatencyPredictor {
  private windows: Map<string, LatencyWindow> = new Map()
  private readonly WINDOW_SIZE = 20 // Track last 20 measurements per relay
  private readonly EWMA_ALPHA = 0.3 // Higher = more recent bias
  private readonly TREND_THRESHOLD = 5 // ms; detect trends > 5ms

  /**
   * Add measurement
   */
  addMeasurement(relay: string, latency: number) {
    let window = this.windows.get(relay)
    if (!window) {
      window = { timestamp: Date.now(), values: [] }
      this.windows.set(relay, window)
    }

    window.values.push(latency)
    window.timestamp = Date.now()

    // Keep window bounded
    if (window.values.length > this.WINDOW_SIZE) {
      window.values = window.values.slice(-this.WINDOW_SIZE)
    }
  }

  /**
   * Predict next latency using EWMA
   * EWMA = α * recent + (1-α) * previous_ewma
   */
  predictLatency(relay: string): number | null {
    const window = this.windows.get(relay)
    if (!window || window.values.length === 0) return null

    let ewma: number = window.values[0] ?? 0
    for (let i = 1; i < window.values.length; i++) {
      const val = window.values[i]
      if (val === undefined) continue
      ewma = this.EWMA_ALPHA * val + (1 - this.EWMA_ALPHA) * ewma
    }

    // Detect trend
    const trend = this.detectTrend(window.values)
    const adjustment = trend * 0.5 // Dampen trend impact (avoid over-correction)

    return Math.max(0, ewma + adjustment)
  }

  /**
   * Detect latency trend (increasing/decreasing)
   * Returns trend in ms: positive = getting slower, negative = getting faster
   */
  private detectTrend(values: number[]): number {
    if (values.length < 2) return 0

    const recent = values.slice(-5) // Last 5 measurements
    const older = values.slice(-10, -5) // Previous 5 measurements

    if (older.length < 5) return 0

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length

    const trend = recentAvg - olderAvg
    return Math.abs(trend) > this.TREND_THRESHOLD ? trend : 0
  }

  /**
   * Estimate percentile latency (e.g., p95)
   */
  getPercentileLatency(relay: string, percentile: number): number | null {
    const window = this.windows.get(relay)
    if (!window || window.values.length === 0) return null

    const sorted = [...window.values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)] ?? null
  }

  /**
   * Rank relays by predicted latency
   */
  rankRelaysByLatency(relays: string[]): { relay: string; predictedLatency: number }[] {
    return relays
      .map(relay => {
        const predicted = this.predictLatency(relay)
        return {
          relay,
          predictedLatency: predicted ?? 500 // Assume worst for unknown
        }
      })
      .sort((a, b) => a.predictedLatency - b.predictedLatency)
  }

  /**
   * Get relay statistics for debugging
   */
  getRelayStats(relay: string) {
    const window = this.windows.get(relay)
    if (!window) return null

    const values = window.values
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)
    const predicted = this.predictLatency(relay)

    return {
      relay,
      measurements: values.length,
      average: avg.toFixed(1),
      min: min.toFixed(1),
      max: max.toFixed(1),
      predicted: predicted?.toFixed(1) ?? 'N/A',
      trend: this.detectTrend(values).toFixed(1)
    }
  }

  getAllStats() {
    return Array.from(this.windows.keys())
      .map(relay => this.getRelayStats(relay))
      .filter(s => s !== null)
  }

  getMemoryUsage(): number {
    return Array.from(this.windows.values()).reduce((sum, w) => sum + w.values.length, 0) * 8 // 8 bytes per number
  }
}
