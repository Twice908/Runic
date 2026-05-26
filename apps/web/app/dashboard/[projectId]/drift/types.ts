export type DriftCellStatus = 'present' | 'missing' | 'extra' | 'stale' | 'ignored'

export type DriftEventType =
  | 'MISSING_KEY'
  | 'EXTRA_KEY'
  | 'STALE_ROTATION'
  | 'KEY_RESTORED'

export interface DriftEnvironmentSummary {
  id: string
  name: string
  isBaseline: boolean
  driftScore: number
  lastSeenAt: string | null
}

export interface DriftMatrixRow {
  keyName: string
  cells: Record<string, DriftCellStatus>
  firstSeenAt?: string | null
}

export interface DriftMatrixResponse {
  environments: DriftEnvironmentSummary[]
  rows: DriftMatrixRow[]
}

export interface DriftEvent {
  id: string
  keyName: string
  environmentId: string
  environmentName: string
  driftType: DriftEventType
  detectedAt: string
  resolvedAt: string | null
  resolved: boolean
}

export interface DriftEventsResponse {
  events: DriftEvent[]
  nextCursor: string | null
}
