type ReviewRequest = { session: string | null; workspace: string | null; path: string; sequence: number }
let latest: ReviewRequest | null = null

export function requestReview(session: string | null, workspace: string | null, path: string): void {
  latest = { session, workspace, path, sequence: (latest?.sequence ?? 0) + 1 }
  window.dispatchEvent(new Event('pi:review-request'))
}

export function latestReview(): ReviewRequest | null { return latest }
