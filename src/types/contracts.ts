export type DeckSource = "mtgtop8" | "mtggoldfish" | "mtgo";

export type DeckFormat = "Modern";

export type DeckZone = "mainboard" | "sideboard";

export type DeckCard = {
  readonly name: string;
  readonly copies: number;
};

export type RawDeck = {
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly eventName?: string;
  readonly eventDate?: string;
  readonly format: DeckFormat;
  readonly player?: string;
  readonly placement?: string;
  readonly reportedArchetype?: string;
  readonly mainboard: readonly DeckCard[];
  readonly sideboard: readonly DeckCard[];
};

export type NormalizedDeck = {
  readonly deckId: string;
  readonly rawDeckId?: string;
  readonly source: DeckSource;
  readonly sourceUrl: string;
  readonly eventDate: string;
  readonly year: number;
  readonly archetype: string;
  readonly archetypeFamily: string;
  readonly mainboard: readonly DeckCard[];
  readonly sideboard: readonly DeckCard[];
  readonly fingerprint: string;
  readonly weight: number;
};

export type CardArchetypeMatrixRow = {
  readonly cardName: string;
  readonly archetypeFamily: string;
  readonly decksWithCard: number;
  readonly totalDecksInArchetype: number;
  readonly mainboardCopies: number;
  readonly sideboardCopies: number;
  readonly affinity: number;
};

export type CardScoreRow = {
  readonly cardName: string;
  readonly frequency: number;
  readonly glueScore: number;
  readonly weightedGlueScore: number;
  readonly highestAffinity: number;
  readonly secondHighestAffinity: number;
  readonly exclusivityScore: number;
  readonly signpostScore: number;
  readonly parasiticScore: number;
  readonly cubeScore: number;
};

export type CandidatePool =
  | "auto_includes"
  | "glue_cards"
  | "signpost_cards"
  | "parasitic_review"
  | "sideboard_cards"
  | "lands"
  | "removal"
  | "threats";

export type CubeCardRole =
  | "glue"
  | "signpost"
  | "fixing"
  | "support"
  | "curve"
  | "role";

export type CubeCandidate = {
  readonly cardName: string;
  readonly pool: CandidatePool;
  readonly score: number;
  readonly roles: readonly CubeCardRole[];
  readonly explanation: string;
};

export type CubeValidationWarningLevel = "pass" | "warn" | "fail";

export type CubeValidationWarning = {
  readonly level: CubeValidationWarningLevel;
  readonly code: string;
  readonly message: string;
};

export type CubeValidationSummary = {
  readonly cubeRunId: string;
  readonly totalCards: number;
  readonly colorCounts: Readonly<Record<string, number>>;
  readonly warnings: readonly CubeValidationWarning[];
};

export type PipelineRun = {
  readonly id: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly configHash: string;
  readonly status: "running" | "completed" | "failed";
};

export type MetagamePeriodModel = "standard_set_release";

export type StandardSetType = "core" | "expansion";

export type SetRelease = {
  readonly setCode: string;
  readonly setName: string;
  readonly releaseDate: string;
  readonly setType: StandardSetType;
  readonly source: string;
  readonly metadata?: unknown;
};

export type MetaPeriod = {
  readonly periodId: string;
  readonly model: MetagamePeriodModel;
  readonly setCode: string;
  readonly setName: string;
  readonly releaseDate: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sortOrder: number;
};

export type DeckMetagamePeriodAssignment = {
  readonly deckId: string;
  readonly periodId: string;
};

export type MetagamePeriodAssignmentReviewReason = "missing_event_date" | "invalid_event_date" | "out_of_range";

export type MetagamePeriodAssignmentReview = {
  readonly deckId?: string;
  readonly eventDate?: string;
  readonly reason: MetagamePeriodAssignmentReviewReason;
  readonly metadata?: unknown;
};

export type HistoricalSourceCoverageStatus = "available" | "unavailable" | "unknown";

export type HistoricalCoverageInterpretation = "observed_play" | "no_observed_play" | "missing_source_coverage";

export type HistoricalCoverageWarningType = "empty_period" | "thin_period" | "missing_source_coverage";

export type SourceCoverageManifestEntry = {
  readonly source: DeckSource;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: HistoricalSourceCoverageStatus;
  readonly notes?: string;
};

export type HistoricalSourceCoverageRow = {
  readonly pipelineRunId: string;
  readonly periodId: string;
  readonly setCode: string;
  readonly setName: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly year: number;
  readonly source: DeckSource;
  readonly archetypeFamily: string;
  readonly deckCount: number;
  readonly sourceStatus: HistoricalSourceCoverageStatus;
  readonly coverageStatus: HistoricalCoverageInterpretation;
  readonly warningCodes: readonly HistoricalCoverageWarningType[];
};

export type HistoricalCoverageWarning = {
  readonly pipelineRunId: string;
  readonly periodId: string;
  readonly source?: DeckSource;
  readonly warningType: HistoricalCoverageWarningType;
  readonly severity: "warn" | "fail";
  readonly message: string;
  readonly metadata?: unknown;
};

export type CardPeriodMatrixRow = {
  readonly pipelineRunId: string;
  readonly cardName: string;
  readonly periodId: string;
  readonly setCode: string;
  readonly setName: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly decksWithCard: number;
  readonly totalDecksInPeriod: number;
  readonly metagameShare: number;
  readonly mainboardCopies: number;
  readonly sideboardCopies: number;
  readonly archetypeFamilies: readonly string[];
  readonly sortOrder: number;
};

export type ArchetypePeriodSummaryRow = {
  readonly pipelineRunId: string;
  readonly archetypeFamily: string;
  readonly periodId: string;
  readonly setCode: string;
  readonly setName: string;
  readonly periodStartDate: string;
  readonly periodEndDate: string;
  readonly totalDeckWeight: number;
  readonly uniqueCards: number;
  readonly representativeCards: readonly string[];
  readonly periodMetagameShare: number;
  readonly sortOrder: number;
};

export type HistoricalCardRole = "format_pillar" | "archetype_icon" | "flash_in_the_pan" | "role_player";

export type HistoricalCardScoreRow = {
  readonly pipelineRunId: string;
  readonly cardName: string;
  readonly eraScore: number;
  readonly peakScore: number;
  readonly longevityScore: number;
  readonly periodVariance: number;
  readonly archetypeImportanceScore: number;
  readonly glueScore: number;
  readonly modernLegacyScore: number;
  readonly historicalRole: HistoricalCardRole;
  readonly explanation: string;
  readonly config: unknown;
};
